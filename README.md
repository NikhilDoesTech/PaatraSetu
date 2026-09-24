# PaatraSetu
It's a project for AMIHACKS, But also a foundation for something bigger, Something that can be implemented at a large scale and can be made into an organization. It contains all the Ideas we have gathered as a team and the various ways that it can be solved.

## Presentation demo

For the complete shared SQLite/API demo, run the app through the Python server:

```bash
cd docs
python3 server.py
```

Open `http://localhost:8001` and sign in with:

- Username: `admin`
- Password: `admin`

The demo account can post food offers. Volunteers can be created from the Join section and
will see eligible nearby offers in their volunteer dashboard, where they can accept or complete
a pickup. SMS delivery is intentionally represented by a server-side notification hook in
`docs/server.py`; connect that hook to an SMS provider for production use.

GitHub Pages also includes a browser-only presentation mode. Open the Pages URL, use **Join the
community** to create a restaurant, individual, or volunteer account, and then sign in again
with the same email and password. Accounts and demo food offers are stored only in that browser;
GPS and restaurant proof upload are optional in this mode. Select the Indian state or union
territory, enter the town/city and six-digit pincode; the app geocodes that location and uses
the resulting distance for volunteer radius filtering. The `admin` / `admin` presentation login
remains available but is intentionally not displayed in the website UI.
