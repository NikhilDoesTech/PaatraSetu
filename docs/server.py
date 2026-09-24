#!/usr/bin/env python3
"""PaatraSetu's small SQLite-backed web server (Python standard library only)."""

from __future__ import annotations

import hashlib
import hmac
import json
import math
import mimetypes
import os
import queue
import re
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from email.parser import BytesParser
from email.policy import default as email_policy
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("PAATRA_SETU_DATA_DIR", ROOT / "data")).expanduser().resolve()
UPLOAD_DIR = DATA_DIR / "proofs"
DB_PATH = DATA_DIR / "paatrasetu.sqlite3"
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8001"))
SESSION_DAYS = 30
MAX_REQUEST_BYTES = 8 * 1024 * 1024
PASSWORD_ITERATIONS = 310_000
TOKEN_RE = re.compile(r"^[0-9a-f]{32}$")
SERVER = None

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 15000")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def initialize_database():
    with db() as conn:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                role TEXT NOT NULL CHECK(role IN ('restaurant', 'volunteer')),
                name TEXT NOT NULL,
                restaurant_name TEXT,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                phone TEXT NOT NULL,
                password_salt BLOB NOT NULL,
                password_hash BLOB NOT NULL,
                area TEXT NOT NULL,
                city TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                radius_km REAL NOT NULL DEFAULT 10,
                proof_path TEXT,
                proof_name TEXT,
                created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS donations (
                id TEXT PRIMARY KEY,
                restaurant_id TEXT NOT NULL REFERENCES users(id),
                food TEXT NOT NULL,
                people INTEGER NOT NULL,
                made_at TEXT NOT NULL,
                notes TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL CHECK(status IN ('open', 'accepted', 'picked_up')),
                volunteer_id TEXT REFERENCES users(id),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS donations_restaurant_created
                ON donations(restaurant_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS donations_status_created
                ON donations(status, created_at DESC);
            CREATE INDEX IF NOT EXISTS donations_volunteer
                ON donations(volunteer_id, status);
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
            """
        )


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def hash_password(password, salt=None):
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_ITERATIONS)
    return salt, digest


def haversine_km(lat1, lon1, lat2, lon2):
    radians = math.pi / 180
    dlat = (lat2 - lat1) * radians
    dlon = (lon2 - lon1) * radians
    value = math.sin(dlat / 2) ** 2 + math.cos(lat1 * radians) * math.cos(lat2 * radians) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.atan2(math.sqrt(value), math.sqrt(max(0, 1 - value)))


def safe_user(row):
    if row is None:
        return None
    return {
        "id": row["id"],
        "role": row["role"],
        "name": row["name"],
        "restaurantName": row["restaurant_name"],
        "email": row["email"],
        "phone": row["phone"],
        "area": row["area"],
        "city": row["city"],
        "coords": {"lat": row["latitude"], "lon": row["longitude"]},
        "radiusKm": row["radius_km"],
        "proofName": row["proof_name"],
        "createdAt": row["created_at"],
    }


def donation_dict(row, distance=None):
    result = {
        "id": row["id"],
        "restaurantId": row["restaurant_id"],
        "restaurantName": row["restaurant_name"],
        "food": row["food"],
        "people": row["people"],
        "madeAt": row["made_at"],
        "notes": row["notes"],
        "status": row["status"],
        "volunteerId": row["volunteer_id"],
        "volunteerName": row["volunteer_name"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "area": row["area"],
        "city": row["city"],
        "coords": {"lat": row["latitude"], "lon": row["longitude"]},
    }
    if distance is not None:
        result["distanceKm"] = distance
    return result


def make_session(conn, user_id):
    conn.execute("DELETE FROM sessions WHERE expires_at<?", (int(time.time()),))
    token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(token.encode("ascii")).hexdigest()
    expires = int(time.time()) + SESSION_DAYS * 86400
    conn.execute("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)", (token_hash, user_id, expires))
    return token


class PaatraSetuServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(self, address, handler):
        super().__init__(address, handler)
        self.event_lock = threading.Lock()
        self.event_queues = set()

    def publish(self):
        with self.event_lock:
            for event_queue in tuple(self.event_queues):
                try:
                    event_queue.put_nowait("change")
                except queue.Full:
                    pass


class Handler(BaseHTTPRequestHandler):
    server_version = "PaatraSetu/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):
        # Keep the console quiet; request data and password fields are never logged.
        return

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'")
        super().end_headers()

    def send_json(self, status, payload, extra_headers=None):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        if extra_headers:
            for key, value in extra_headers:
                self.send_header(key, value)
        self.end_headers()
        self.wfile.write(body)

    def read_body(self, limit=MAX_REQUEST_BYTES):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid request size.")
        if size < 0 or size > limit:
            raise OverflowError("The uploaded request is too large (8 MB maximum).")
        return self.rfile.read(size)

    def read_json(self):
        raw = self.read_body(256 * 1024)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("Please send valid form details.")

    def read_form(self):
        raw = self.read_body()
        content_type = self.headers.get("Content-Type", "")
        if not content_type.lower().startswith("multipart/form-data"):
            raise ValueError("Please submit the signup form again.")
        envelope = (f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n").encode("utf-8") + raw
        try:
            message = BytesParser(policy=email_policy).parsebytes(envelope)
            if not message.is_multipart():
                raise ValueError("The signup form could not be read.")
            fields = {}
            for part in message.iter_parts():
                field_name = part.get_param("name", header="content-disposition")
                if not field_name:
                    continue
                content = part.get_payload(decode=True) or b""
                filename = part.get_filename()
                if filename:
                    fields[field_name] = {
                        "filename": Path(filename.replace("\\", "/")).name[:200],
                        "content_type": part.get_content_type(),
                        "content": content,
                    }
                else:
                    fields[field_name] = content.decode(part.get_content_charset() or "utf-8", errors="replace")
            return fields
        except (TypeError, AttributeError):
            raise ValueError("The signup form could not be read.")

    def session_token(self):
        try:
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            return cookies["paatrasetu_session"].value if "paatrasetu_session" in cookies else None
        except Exception:
            return None

    def current_user(self, conn):
        token = self.session_token()
        if not token or len(token) > 128:
            return None
        token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest()
        row = conn.execute(
            "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
            (token_hash, int(time.time())),
        ).fetchone()
        return row

    def cookie_header(self, token, max_age=SESSION_DAYS * 86400):
        secure = self.headers.get("X-Forwarded-Proto", "").lower() == "https" or self.server.server_address[1] == 443
        return "paatrasetu_session={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{}".format(token, max_age, "; Secure" if secure else "")

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        if path.startswith("/api/"):
            try:
                self.api_get(path)
            except Exception as exc:
                self.send_json(500, {"error": "The server could not complete that request."})
                print("API GET error:", type(exc).__name__)
            return
        self.serve_static(path)

    def do_HEAD(self):
        self.serve_static(urlparse(self.path).path, head=True)

    def do_POST(self):
        try:
            self.api_post(urlparse(self.path).path)
        except OverflowError as exc:
            self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": str(exc)})
        except (ValueError, TypeError) as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "The server could not complete that request."})
            print("API POST error:", type(exc).__name__)

    def do_PUT(self):
        if urlparse(self.path).path != "/api/me/radius":
            self.send_json(HTTPStatus.NOT_FOUND, {"error": "That page was not found."})
            return
        try:
            self.update_radius()
        except (ValueError, TypeError) as exc:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        except Exception as exc:
            self.send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "The server could not update your pickup radius."})
            print("API PUT error:", type(exc).__name__)

    def api_get(self, path):
        if path == "/api/events":
            with db() as conn:
                user = self.current_user(conn)
            if user is None:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Please sign in first."})
                return
            self.serve_events()
            return
        with db() as conn:
            user = self.current_user(conn)
            if path == "/api/me":
                self.send_json(HTTPStatus.OK, {"user": safe_user(user)})
                return
            if path == "/api/donations":
                if user is None:
                    self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Please sign in first."})
                    return
                self.send_json(HTTPStatus.OK, {"donations": self.visible_donations(conn, user)})
                return
        self.send_json(HTTPStatus.NOT_FOUND, {"error": "That page was not found."})

    def visible_donations(self, conn, user):
        base = """
            SELECT d.*, r.restaurant_name, r.area, r.city, r.latitude, r.longitude,
                   v.name AS volunteer_name, v.latitude AS volunteer_latitude,
                   v.longitude AS volunteer_longitude
            FROM donations d
            JOIN users r ON r.id=d.restaurant_id
            LEFT JOIN users v ON v.id=d.volunteer_id
        """
        if user["role"] == "restaurant":
            rows = conn.execute(base + " WHERE d.restaurant_id=? ORDER BY d.created_at DESC", (user["id"],)).fetchall()
            return [donation_dict(row) for row in rows]
        rows = conn.execute(base + " WHERE d.status='open' OR d.volunteer_id=? ORDER BY d.created_at DESC", (user["id"],)).fetchall()
        results = []
        for row in rows:
            distance = haversine_km(user["latitude"], user["longitude"], row["latitude"], row["longitude"])
            if row["volunteer_id"] == user["id"] or (row["status"] == "open" and distance <= user["radius_km"]):
                results.append(donation_dict(row, distance))
        return results

    def serve_events(self):
        event_queue = queue.Queue(maxsize=1)
        with self.server.event_lock:
            self.server.event_queues.add(event_queue)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        try:
            self.wfile.write(b": PaatraSetu updates connected\n\n")
            self.wfile.flush()
            while True:
                try:
                    event_queue.get(timeout=25)
                    payload = b"event: change\ndata: {}\n\n"
                except queue.Empty:
                    payload = b": keep-alive\n\n"
                self.wfile.write(payload)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            with self.server.event_lock:
                self.server.event_queues.discard(event_queue)

    def api_post(self, path):
        if path == "/api/signup":
            self.signup()
        elif path == "/api/login":
            self.login()
        elif path == "/api/logout":
            self.logout()
        elif path == "/api/donations":
            self.create_donation()
        else:
            match = re.fullmatch(r"/api/donations/([0-9a-f-]{20,40})/(accept|complete)", path)
            if not match:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "That page was not found."})
                return
            self.change_donation(match.group(1), match.group(2))

    def signup(self):
        fields = self.read_form()
        role = fields.get("role", "")
        name = fields.get("name", "").strip()
        restaurant_name = fields.get("restaurantName", "").strip()
        email = fields.get("email", "").strip().lower()
        phone = fields.get("phone", "").strip()
        password = fields.get("password", "")
        area = fields.get("area", "").strip()
        try:
            latitude = float(fields.get("latitude", ""))
            longitude = float(fields.get("longitude", ""))
        except (TypeError, ValueError):
            raise ValueError("Tag your GPS location before creating an account.")
        if role not in ("restaurant", "volunteer"):
            raise ValueError("Choose a restaurant or volunteer account.")
        if not name or len(name) > 100 or (role == "restaurant" and (not restaurant_name or len(restaurant_name) > 120)):
            raise ValueError("Please enter your name and restaurant name.")
        if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
            raise ValueError("Please enter a valid email address.")
        if not 7 <= len(re.sub(r"\D", "", phone)) <= 18:
            raise ValueError("Please enter a valid mobile number with its country code.")
        if not 8 <= len(password) <= 128:
            raise ValueError("Use a password between 8 and 128 characters.")
        if not area or len(area) > 220:
            raise ValueError("Please add your area or pickup address.")
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
            raise ValueError("The GPS location is not valid. Please tag it again.")

        proof = fields.get("proof") if role == "restaurant" else None
        if role == "restaurant" and proof:
            if not proof.get("filename") or not proof.get("content"):
                raise ValueError("The uploaded restaurant proof is empty. Please choose a valid file or leave it blank.")
            allowed_types = {"application/pdf", "image/jpeg", "image/png", "image/webp"}
            if proof.get("content_type") not in allowed_types:
                raise ValueError("Choose a PDF, JPG, PNG, or WebP restaurant proof file.")
            if len(proof["content"]) > 5 * 1024 * 1024:
                raise OverflowError("Restaurant proof must be 5 MB or smaller.")

        user_id = uuid.uuid4().hex
        city = area.rsplit(",", 1)[-1].strip()[:100]
        created_at = utc_now()
        salt, password_hash = hash_password(password)
        proof_path = None
        proof_name = None
        if proof:
            extension = {"application/pdf": ".pdf", "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[proof["content_type"]]
            file_id = uuid.uuid4().hex + extension
            proof_path = file_id
            proof_name = proof["filename"]
            (UPLOAD_DIR / file_id).write_bytes(proof["content"])
        try:
            with db() as conn:
                conn.execute(
                    """INSERT INTO users(id,role,name,restaurant_name,email,phone,password_salt,password_hash,
                       area,city,latitude,longitude,radius_km,proof_path,proof_name,created_at)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (user_id, role, name, restaurant_name or None, email, phone, salt, password_hash,
                     area, city, latitude, longitude, 10, proof_path, proof_name, created_at),
                )
                token = make_session(conn, user_id)
                user = conn.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
        except sqlite3.IntegrityError:
            if proof_path:
                (UPLOAD_DIR / proof_path).unlink(missing_ok=True)
            self.send_json(HTTPStatus.CONFLICT, {"error": "An account with this email already exists. Sign in instead."})
            return
        self.send_json(HTTPStatus.CREATED, {"user": safe_user(user)}, [("Set-Cookie", self.cookie_header(token))])
        self.server.publish()

    def login(self):
        body = self.read_json()
        email = str(body.get("email", "")).strip().lower()
        password = str(body.get("password", ""))
        if not email or not 1 <= len(password) <= 128:
            raise ValueError("Enter your email and password.")
        with db() as conn:
            user = conn.execute("SELECT * FROM users WHERE email=? COLLATE NOCASE", (email,)).fetchone()
            if user is None:
                # Keep invalid-email attempts close to the normal password check duration.
                hash_password(password, b"paatrasetu-demo-salt")
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Email or password is incorrect."})
                return
            candidate = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), user["password_salt"], PASSWORD_ITERATIONS)
            if not hmac.compare_digest(candidate, user["password_hash"]):
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Email or password is incorrect."})
                return
            token = make_session(conn, user["id"])
        self.send_json(HTTPStatus.OK, {"user": safe_user(user)}, [("Set-Cookie", self.cookie_header(token))])

    def logout(self):
        token = self.session_token()
        if token:
            token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).hexdigest()
            with db() as conn:
                conn.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash,))
        cookie = "paatrasetu_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
        if self.headers.get("X-Forwarded-Proto", "").lower() == "https":
            cookie += "; Secure"
        self.send_json(HTTPStatus.OK, {"ok": True}, [("Set-Cookie", cookie)])

    def create_donation(self):
        body = self.read_json()
        with db() as conn:
            user = self.current_user(conn)
            if user is None:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Sign in as a restaurant to share food."})
                return
            if user["role"] != "restaurant":
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "Volunteer accounts cannot post restaurant food offers."})
                return
            food = str(body.get("food", "")).strip()
            try:
                people = int(body.get("people", 0))
                made_at = datetime.fromisoformat(str(body.get("madeAt", "")).replace("Z", "+00:00"))
            except (ValueError, TypeError):
                raise ValueError("Add a valid serving count and preparation time.")
            notes = str(body.get("notes") or "").strip()
            if not food or len(food) > 90 or not 1 <= people <= 5000 or len(notes) > 240:
                raise ValueError("Add a food description, a serving count from 1 to 5,000, and pickup notes up to 240 characters.")
            if made_at.tzinfo is None:
                made_at = made_at.astimezone()
            now = utc_now()
            donation_id = uuid.uuid4().hex
            conn.execute(
                "INSERT INTO donations(id,restaurant_id,food,people,made_at,notes,status,created_at,updated_at) VALUES(?,?,?,?,?,?,'open',?,?)",
                (donation_id, user["id"], food, people, made_at.astimezone(timezone.utc).isoformat(timespec="seconds"), notes, now, now),
            )
            volunteers = conn.execute("SELECT latitude,longitude,radius_km FROM users WHERE role='volunteer'").fetchall()
            matches = sum(1 for volunteer in volunteers if haversine_km(user["latitude"], user["longitude"], volunteer["latitude"], volunteer["longitude"]) <= volunteer["radius_km"])
        self.server.publish()
        self.send_json(HTTPStatus.CREATED, {"id": donation_id, "nearbyVolunteers": matches})

    def change_donation(self, donation_id, action):
        with db() as conn:
            user = self.current_user(conn)
            if user is None:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Please sign in first."})
                return
            if user["role"] != "volunteer":
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "Only volunteers can accept or complete a pickup."})
                return
            donation = conn.execute(
                "SELECT d.*,r.latitude,r.longitude FROM donations d JOIN users r ON r.id=d.restaurant_id WHERE d.id=?",
                (donation_id,),
            ).fetchone()
            if donation is None:
                self.send_json(HTTPStatus.NOT_FOUND, {"error": "This food offer is no longer available."})
                return
            now = utc_now()
            if action == "accept":
                distance = haversine_km(user["latitude"], user["longitude"], donation["latitude"], donation["longitude"])
                if distance > user["radius_km"]:
                    self.send_json(HTTPStatus.FORBIDDEN, {"error": "This pickup is outside your selected radius."})
                    return
                result = conn.execute(
                    "UPDATE donations SET status='accepted',volunteer_id=?,updated_at=? WHERE id=? AND status='open'",
                    (user["id"], now, donation_id),
                )
                if result.rowcount == 0:
                    self.send_json(HTTPStatus.CONFLICT, {"error": "Another volunteer has already accepted this pickup."})
                    return
            else:
                result = conn.execute(
                    "UPDATE donations SET status='picked_up',updated_at=? WHERE id=? AND status='accepted' AND volunteer_id=?",
                    (now, donation_id, user["id"]),
                )
                if result.rowcount == 0:
                    self.send_json(HTTPStatus.CONFLICT, {"error": "Only the volunteer who accepted this pickup can complete it."})
                    return
        self.server.publish()
        self.send_json(HTTPStatus.OK, {"ok": True})

    def update_radius(self):
        body = self.read_json()
        radius = body.get("radiusKm")
        if not isinstance(radius, (int, float)) or radius not in (2, 5, 10, 20, 50):
            raise ValueError("Choose a pickup radius from the available options.")
        with db() as conn:
            user = self.current_user(conn)
            if user is None:
                self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Please sign in first."})
                return
            if user["role"] != "volunteer":
                self.send_json(HTTPStatus.FORBIDDEN, {"error": "Only volunteers can set a pickup radius."})
                return
            conn.execute("UPDATE users SET radius_km=? WHERE id=?", (radius, user["id"]))
        self.server.publish()
        self.send_json(HTTPStatus.OK, {"radiusKm": radius})

    def serve_static(self, raw_path, head=False):
        path = unquote(raw_path or "/")
        if path == "/":
            path = "/index.html"
        target = (ROOT / path.lstrip("/")).resolve()
        in_private_data = target == DATA_DIR or DATA_DIR in target.parents
        if ROOT not in target.parents or in_private_data or not target.is_file() or target.name == "server.py":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        content = target.read_bytes()
        content_type = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if content_type.startswith("text/") or content_type in ("application/javascript", "application/json"):
            content_type += "; charset=utf-8"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache" if target.name in ("index.html", "app.js", "styles.css") else "public, max-age=3600")
        self.end_headers()
        if not head:
            self.wfile.write(content)


def main():
    global SERVER
    initialize_database()
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at<?", (int(time.time()),))
    SERVER = PaatraSetuServer((HOST, PORT), Handler)
    print(f"PaatraSetu is running at http://{HOST}:{PORT}")
    print(f"SQLite database: {DB_PATH}")
    try:
        SERVER.serve_forever()
    except KeyboardInterrupt:
        print("\nPaatraSetu server stopped.")
    finally:
        SERVER.server_close()


if __name__ == "__main__":
    main()
