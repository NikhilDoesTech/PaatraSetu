(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const main = $('#main');
  const headerActions = $('#header-actions');
  const dialogRoot = $('#dialog-root');
  const toast = $('#toast');
  const state = { user: null, donations: [], mealsSaved: 0, demoMode: false };
  const demoUser = { id: 'demo-admin', role: 'restaurant', name: 'PaatraSetu Admin', restaurantName: 'Demo Restaurant', email: 'admin@paatrasetu.demo', phone: '0000000000', area: 'Bengaluru', city: 'Bengaluru', state: 'Karnataka', town: 'Bengaluru', pincode: '560001', coords: { lat: 12.9716, lon: 77.5946 }, radiusKm: 50 };
  let route = 'home';
  let role = 'restaurant';
  let pendingCoords = null;
  let toastTimer;
  let eventSource = null;
  let eventUserId = null;
  let refreshInProgress = null;
  const signupDrafts = {};
  const staticDemoHost = location.hostname.endsWith('github.io') || (['localhost', '127.0.0.1'].includes(location.hostname) && location.port !== '8001');
  const fallbackCoords = { lat: 12.9716, lon: 77.5946 };
  const indianStates = ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'];
  const knownLocations = { jaipur: { lat: 26.9124, lon: 75.7873 }, achrol: { lat: 27.1332, lon: 75.9566 }, bengaluru: { lat: 12.9716, lon: 77.5946 }, delhi: { lat: 28.6139, lon: 77.209 }, mumbai: { lat: 19.076, lon: 72.8777 }, hyderabad: { lat: 17.385, lon: 78.4867 }, chennai: { lat: 13.0827, lon: 80.2707 }, kolkata: { lat: 22.5726, lon: 88.3639 } };

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
  const numberOf = value => new Intl.NumberFormat().format(Number(value) || 0);
  const dateString = iso => { const date = new Date(iso); return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date); };
  const localDateTimeValue = date => { const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return adjusted.toISOString().slice(0, 16); };
  const canDonate = user => user?.role === 'restaurant';
  const haversineKm = (a, b) => {
    if (!a || !b) return null;
    const radians = Math.PI / 180;
    const dLat = (b.lat - a.lat) * radians;
    const dLon = (b.lon - a.lon) * radians;
    const value = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
  };
  async function resolvePincode(pincode, town, stateName) {
    if (!/^\d{6}$/.test(pincode)) throw new Error('Enter a valid 6-digit Indian pincode.');
    const known = knownLocations[town.trim().toLowerCase()];
    if (known) return known;
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&country=India&postalcode=${encodeURIComponent(pincode)}`);
      const places = await response.json();
      if (places[0]) return { lat: Number(places[0].lat), lon: Number(places[0].lon) };
    } catch { /* The server/GPS coordinates remain the fallback when geocoding is unavailable. */ }
    if (pendingCoords) return pendingCoords;
    if (staticDemoHost) return fallbackCoords;
    throw new Error(`We could not locate pincode ${pincode}. Check the pincode or use GPS.`);
  }

  async function request(path, { method = 'GET', body, form = false } = {}) {
    const headers = {};
    const options = { method, credentials: 'same-origin', headers };
    if (body !== undefined) {
      if (form) options.body = body;
      else { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    }

    let response;
    try { response = await fetch(path, options); }
    catch {
      throw new Error('Cannot reach the PaatraSetu API. Do not open index.html as a file. Run `python3 server.py` from the outputs folder, then open http://localhost:8001.');
    }
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('This page is not connected to the PaatraSetu API. A basic static server or GitHub Pages cannot handle sign-in. Stop that server, run `python3 server.py` from the outputs folder, then open http://localhost:8001.'); }
    if (!response.ok) throw new Error(payload.error || 'PaatraSetu could not complete that action. Please try again.');
    return payload;
  }

  function saveSignupDraft() {
    const form = $('#signup-form');
    if (!form) return;
    const draft = {};
    form.querySelectorAll('input:not([type="file"]), textarea, select').forEach(field => {
      draft[field.name] = field.value;
    });
    const proof = $('#proof-file', form)?.files?.[0];
    if (proof) draft.proof = proof;
    draft.coords = pendingCoords;
    signupDrafts[role] = draft;
  }

  function restoreSignupDraft() {
    const form = $('#signup-form');
    const draft = signupDrafts[role];
    if (!form || !draft) return;
    form.querySelectorAll('input:not([type="file"]), textarea, select').forEach(field => {
      if (draft[field.name] !== undefined) field.value = draft[field.name];
    });
    const proofInput = $('#proof-file', form);
    if (proofInput && draft.proof && typeof DataTransfer !== 'undefined') {
      const transfer = new DataTransfer();
      transfer.items.add(draft.proof);
      proofInput.files = transfer.files;
      const label = $('#upload-name', form);
      if (label) label.textContent = `${draft.proof.name} · ${(draft.proof.size / 1024).toFixed(0)} KB`;
    }
    if (draft.coords) {
      pendingCoords = draft.coords;
      const status = $('#gps-status', form);
      if (status) {
        status.textContent = `Location tagged · ${pendingCoords.lat.toFixed(4)}, ${pendingCoords.lon.toFixed(4)}`;
        status.classList.add('is-set');
      }
    }
  }

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
  }

  function setHeader(user) {
    if (!user) {
      headerActions.innerHTML = `<button type="button" class="link-button" data-action="signin">Sign in</button><button type="button" class="button button-primary button-small header-donate" data-action="donate-gate">Donate food <span class="button-arrow">→</span></button>`;
      return;
    }
    const offers = user.role === 'volunteer' ? nearbyForVolunteer(user).length : 0;
    const updatesCount = user.role === 'restaurant'
      ? state.donations.filter(d => d.status !== 'open').length
      : offers + state.donations.filter(d => d.volunteerId === user.id && d.status !== 'open').length;
    const donate = canDonate(user) ? `<button type="button" class="button button-primary button-small header-donate" data-action="open-donate">Donate food <span class="button-arrow">→</span></button>` : '';
    const updates = `<button type="button" class="link-button" aria-label="Pickup updates" data-action="notifications"><span class="updates-label">Updates</span>${updatesCount ? ` <span class="count-pill">${updatesCount}</span>` : ''}</button>`;
    headerActions.innerHTML = `${updates}${donate}<button type="button" class="avatar-chip" aria-expanded="false" aria-controls="profile-menu" data-action="profile"><span class="avatar-dot">${esc(initials(user.name))}</span><span>${esc(user.name.split(' ')[0])}</span><span class="profile-chevron" aria-hidden="true">⌄</span></button><button type="button" class="link-button signout-link" aria-label="Sign out" data-action="signout"><span class="signout-label">Sign out</span><span class="signout-icon" aria-hidden="true">↪</span></button>`;
  }

  function showProfileMenu() {
    const user = state.user;
    if (!user) return;
    const existing = $('#profile-menu');
    if (existing) {
      existing.remove();
      return;
    }
    const chip = $('[data-action="profile"]');
    chip?.setAttribute('aria-expanded', 'true');
    const menu = document.createElement('section');
    menu.id = 'profile-menu';
    menu.className = 'profile-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', 'Registered user details');
    menu.innerHTML = `<div class="profile-menu-heading"><span class="profile-menu-kicker">Your PaatraSetu profile</span><button type="button" class="profile-close" aria-label="Close profile" data-action="profile-close">×</button></div><div class="profile-summary"><span class="profile-large-avatar">${esc(initials(user.name))}</span><div><strong>${esc(user.name)}</strong><span>${user.role === 'volunteer' ? 'Volunteer' : esc(user.restaurantName || 'Individual donor')}</span></div></div><dl class="profile-details"><div><dt>Email</dt><dd>${esc(user.email)}</dd></div><div><dt>Phone</dt><dd>${esc(user.phone)}</dd></div><div><dt>Location</dt><dd>${esc(user.town || user.city)}, ${esc(user.state || '')} ${esc(user.pincode || '')}</dd></div>${user.role === 'volunteer' ? `<div><dt>Pickup radius</dt><dd>${numberOf(user.radiusKm)} km</dd></div>` : ''}</dl>`;
    headerActions.appendChild(menu);
  }

  function openUpdates(userId) {
    if (eventUserId === userId && eventSource) return;
    eventSource?.close();
    eventUserId = userId;
    eventSource = new EventSource('/api/events');
    eventSource.addEventListener('change', () => { void refresh(); });
    eventSource.onerror = () => { /* EventSource retries automatically if the connection drops. */ };
  }

  async function refresh() {
    if (state.demoMode) {
      state.donations = JSON.parse(localStorage.getItem('paatrasetu_demo_donations') || '[]');
      state.mealsSaved = state.donations.reduce((sum, donation) => sum + Number(donation.people || 0), 0);
      if (state.user?.role === 'volunteer') {
        state.donations = state.donations.map(d => ({ ...d, distanceKm: haversineKm(state.user.coords, d.coords) }));
      }
      render();
      return;
    }
    if (refreshInProgress) return refreshInProgress;
    refreshInProgress = (async () => {
      const previousId = state.user?.id || null;
      const result = await request('/api/me');
      state.user = result.user;
        state.mealsSaved = (await request('/api/stats')).mealsSaved;
      state.donations = state.user ? (await request('/api/donations')).donations : [];
      if (state.user) openUpdates(state.user.id);
      else {
        eventSource?.close(); eventSource = null; eventUserId = null;
        if (previousId) route = 'home';
      }
      render();
    })();
    try { await refreshInProgress; }
    finally { refreshInProgress = null; }
  }

  function guestPage() {
    return `<div class="page-shell" id="home">
      <section class="impact-meter" aria-label="PaatraSetu impact"><span class="impact-meter-icon" aria-hidden="true">✦</span><div><strong>${numberOf(state.mealsSaved)}</strong><span>meals saved and shared</span></div><small>Every meal you add grows this community counter.</small></section>
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-copy">
          <p class="eyebrow">Good food. Shared locally.</p>
          <h1 id="hero-title">Once, about to be wasted, now feeds <span class="hero-quote-accent">the ones needed.</span></h1>
          <p class="hero-lede">PaatraSetu connects restaurants with nearby volunteers, so fresh surplus food can find its way to people who need it.</p>
          <div class="hero-actions"><button class="button button-primary" type="button" data-action="signup">Join the community <span class="button-arrow">→</span></button><button class="button button-outline" type="button" data-action="signin">I already have an account</button></div>
          <p class="hero-note">A neighbourhood at a time. A meal at a time.</p>
        </div>
        <div class="hero-visual" aria-hidden="true">
          <div class="hero-orbit"></div><div class="plate"><div class="plate-inner"><i class="plate-leaf"></i><i class="plate-leaf"></i><i class="plate-leaf"></i><i class="plate-leaf"></i><i class="plate-tomato one"></i><i class="plate-tomato two"></i><i class="plate-carrot"></i><i class="plate-bean"></i></div></div>
          <span class="spark">✳</span><div class="floating-note note-one"><span class="floating-icon">⌖</span><span class="floating-copy"><strong>Closer, kinder pickups</strong><span>Matched around your neighbourhood</span></span></div>
          <div class="floating-note note-two"><span class="floating-icon orange">♡</span><span class="floating-copy"><strong>Good food, shared well</strong><span>Quick handoffs. Less food wasted.</span></span></div>
          <div class="hero-seal">MADE FOR<br>NEIGHBOURS<br><span>✳</span></div>
        </div>
      </section>
      <section class="how-section" id="how-it-works" aria-labelledby="how-title">
        <div class="section-heading"><div><p class="eyebrow">Simple by design</p><h2 id="how-title">Three small steps.<br>A better kind of handoff.</h2></div><p>Sharing should feel easy, whether you’re in the kitchen, on the road, or lending a hand nearby.</p></div>
        <div class="steps-grid">
          <article class="step-card"><div class="step-number"><span>01</span><span>⌖</span></div><h3>Share where you are</h3><p>Restaurants add a quick profile and tag their pickup spot using their phone’s location.</p></article>
          <article class="step-card"><div class="step-number"><span>02</span><span>↗</span></div><h3>Post what’s available</h3><p>Describe the food, how many people it can serve, and when it was prepared.</p></article>
          <article class="step-card"><div class="step-number"><span>03</span><span>♡</span></div><h3>A neighbour picks it up</h3><p>Nearby volunteers can accept a pickup. The restaurant sees who is coming in the app.</p></article>
        </div>
      </section>
      <section class="why-section" id="our-why" aria-labelledby="why-title">
        <div class="why-copy"><p class="eyebrow">Our why</p><h2>Good food still has somewhere to go.</h2><p>Every day, kitchens make a little more than they need. PaatraSetu makes the next step clearer: a local connection, a quick message, and a pickup that works for everyone.</p></div>
        <div class="why-aside"><p class="why-aside-label">Built around real life</p><div class="why-points"><div class="why-point"><span class="check">✓</span><span>Quick to use on a phone, even on a slower connection.</span></div><div class="why-point"><span class="check">✓</span><span>Pickup details stay clear, from the food to its location.</span></div><div class="why-point"><span class="check">✓</span><span>Restaurants and volunteers each get a view that fits their role.</span></div></div></div>
      </section>
      <section class="join-strip"><div><h2>Make a little extra mean a lot.</h2><p>Choose how you would like to contribute to your neighbourhood.</p></div><div class="role-choice-group"><div class="role-choice-donors"><span class="role-choice-label">Donate food</span><div class="hero-actions"><button class="button button-outline" type="button" data-action="join-role" data-role="restaurant">Restaurant</button><button class="button button-outline" type="button" data-action="join-role" data-role="individual">Individual</button></div></div><button class="button button-volunteer" type="button" data-action="join-role" data-role="volunteer">Volunteer for pickups <span class="button-arrow">→</span></button></div></section>
    </div>`;
  }

  function aside(kind) {
    const isLogin = kind === 'signin';
    return `<aside class="auth-aside"><p class="eyebrow">${isLogin ? 'Welcome back' : 'Better together'}</p><h1>${isLogin ? 'Good to see you again.' : 'Good food. Good neighbours.'}</h1><p>${isLogin ? 'Sign in to see food offers, nearby pickups, and the latest from your community.' : 'A few details help us connect restaurant kitchens with volunteers nearby.'}</p><div class="aside-foot"><span>✳</span>${isLogin ? 'Your local food rescue community' : 'Small steps add up to something good'}</div></aside>`;
  }

  function authPage(kind) {
    const isLogin = kind === 'signin';
    if (isLogin) return `<div class="auth-layout">${aside(kind)}<section class="form-panel"><div class="form-topline"><span>Sign in to PaatraSetu</span><button type="button" data-action="signup">Create an account →</button></div><h2>Pick up where you left off.</h2><p class="form-subtitle">Sign in with your account to see food offers, nearby pickups, and community updates.</p><form id="signin-form" novalidate><div class="form-grid"><div class="field field-full"><label for="login-email">Username or email address</label><input id="login-email" name="email" type="text" autocomplete="username" placeholder="Username or email address" required /></div><div class="field field-full"><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Your password" required /></div></div><p id="signin-error" class="error-message" role="alert"></p><div class="form-actions"><button class="button button-primary button-wide" type="submit">Sign in <span class="button-arrow">→</span></button></div><p class="form-notice"><span>●</span>Your account details are handled securely by the PaatraSetu sign-in service.</p></form></section></div>`;
    return `<div class="auth-layout">${aside(kind)}<section class="form-panel"><div class="form-topline"><span>Join the PaatraSetu community</span><button type="button" data-action="signin">Already joined? Sign in</button></div><h2>Join your local food rescue.</h2><p class="form-subtitle">Choose how you’d like to help. Your location lets us find nearby matches.</p><div class="role-switch" role="group" aria-label="Choose account type"><div class="role-switch-donors"><span>Donate food</span><button type="button" data-action="set-role" data-role="restaurant" aria-pressed="${role === 'restaurant'}">Restaurant</button><button type="button" data-action="set-role" data-role="individual" aria-pressed="${role === 'individual'}">Individual</button></div><button class="role-volunteer" type="button" data-action="set-role" data-role="volunteer" aria-pressed="${role === 'volunteer'}">Volunteer</button></div>
      <form id="signup-form" novalidate><div class="form-grid">
        <div class="field ${role === 'restaurant' ? '' : 'field-full'}"><label for="signup-name">${role === 'restaurant' ? 'Owner / contact name' : 'Your name'}</label><input id="signup-name" name="name" autocomplete="name" placeholder="Full name" required /></div>
        ${role === 'restaurant' ? `<div class="field"><label for="signup-restaurant">Restaurant name</label><input id="signup-restaurant" name="restaurantName" autocomplete="organization" placeholder="Name on your storefront" required /></div>` : ''}
        <div class="field"><label for="signup-email">Email address</label><input id="signup-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required /></div>
        <div class="field"><label for="signup-phone">Mobile number</label><input id="signup-phone" name="phone" type="tel" autocomplete="tel" placeholder="Include country code" required /><span class="field-hint">Used for pickup coordination.</span></div>
        <div class="field"><label for="signup-password">Create a password</label><input id="signup-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="At least 8 characters" required /></div>
        <div class="field"><label for="signup-state">State / union territory</label><select id="signup-state" name="state" required><option value="">Select your state</option>${indianStates.map(stateName => `<option value="${esc(stateName)}">${esc(stateName)}</option>`).join('')}</select></div>
        <div class="field"><label for="signup-town">Town / city</label><input id="signup-town" name="town" autocomplete="address-level2" placeholder="e.g. Jaipur or Achrol" required /></div>
        <div class="field"><label for="signup-pincode">Pincode</label><input id="signup-pincode" name="pincode" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" placeholder="6-digit pincode" required /></div>
        <div class="field"><label for="signup-area">${role === 'restaurant' ? 'Street / pickup address' : 'Street / area'}</label><input id="signup-area" name="area" autocomplete="street-address" placeholder="Street, neighbourhood, city" required /></div>
        <div class="field field-full"><label>Tag your pickup area</label><div class="gps-row"><button class="button button-outline button-small" type="button" data-action="get-gps">⌖ Use my GPS location</button><span id="gps-status" class="gps-status">Location is needed to find nearby matches.</span></div><span class="field-hint">Your browser will ask permission. GPS coordinates are used for nearby matching.</span></div>
        ${role === 'restaurant' ? `<div class="field field-full"><label for="proof-file">Restaurant proof <span style="font-weight:400;color:#8a948b">(optional)</span></label><div class="upload-box"><span aria-hidden="true">▧</span><label for="proof-file">Choose a file</label><input id="proof-file" name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" /><span id="upload-name" class="upload-name">Business licence, registration, or storefront photo</span></div><span class="field-hint">PDF, JPG, PNG, or WebP · up to 5 MB. Optional for this demo. If uploaded, the file is stored on the PaatraSetu server for review.</span></div>` : ''}
      </div><p id="signup-error" class="error-message" role="alert"></p><p class="form-notice"><span>●</span>${role === 'restaurant' ? 'Your pickup pin is shared with nearby volunteers when you post an offer.' : 'Your location is used to find nearby offers. Your exact pin stays private to you.'}</p><div class="form-actions"><button class="button button-primary button-wide" type="submit">Create ${role === 'restaurant' ? 'restaurant' : 'volunteer'} account <span class="button-arrow">→</span></button></div></form></section></div>`;
  }

  function nearbyForVolunteer(user) {
    return state.donations.filter(d => d.status === 'open' && d.distanceKm <= user.radiusKm)
      .sort((a, b) => (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999));
  }

  function donationCard(d, user, volunteerView = false) {
    const distance = typeof d.distanceKm === 'number' ? d.distanceKm : null;
    const status = d.status === 'open' ? '<span class="status-label open">Available</span>' : `<span class="status-label accepted">${d.status === 'accepted' ? 'Volunteer on the way' : 'Picked up'}</span>`;
    const details = `${numberOf(d.people)} people can be fed · Made ${esc(dateString(d.madeAt))}`;
    const location = [d.area, d.city].filter(Boolean).map(esc).join(', ');
    const mapLink = volunteerView && d.coords && Number.isFinite(d.coords.lat) && Number.isFinite(d.coords.lon)
      ? `<a class="distance-label" href="https://maps.google.com/?q=${d.coords.lat},${d.coords.lon}" target="_blank" rel="noopener noreferrer">Open pickup map ↗</a>` : '';
    const action = volunteerView && d.status === 'open'
      ? `<button class="button button-primary button-small" type="button" data-action="accept" data-id="${esc(d.id)}">Accept pickup</button>`
      : volunteerView && d.status === 'accepted' && d.volunteerId === user.id
        ? `<button class="button button-outline button-small" type="button" data-action="complete" data-id="${esc(d.id)}">Mark picked up</button>` : '';
    const extra = volunteerView ? `Pickup at ${location}${d.restaurantName ? ` · ${esc(d.restaurantName)}` : ''}` : `Pickup · ${location}`;
    return `<article class="listing-card"><div class="listing-main"><span class="food-icon" aria-hidden="true">◉</span><div class="listing-copy"><h3>${esc(d.food)}</h3><p>${details}<br>${extra}${d.notes ? `<br>Note · ${esc(d.notes)}` : ''}</p></div></div><div class="listing-action">${distance != null && volunteerView ? `<span class="distance-label">${distance < 1 ? `${Math.max(1, Math.round(distance * 1000))} m away` : `${distance.toFixed(1)} km away`}</span>` : status}${mapLink}${action}</div></article>`;
  }

  function restaurantDashboard(user) {
    const own = state.donations.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const open = own.filter(d => d.status === 'open').length;
    const servings = own.reduce((sum, d) => sum + Number(d.people || 0), 0);
    return `<div class="dashboard" id="home"><div class="welcome-line"><div><p class="eyebrow">Your community, nearby</p><h1>Good to see you, ${esc(user.name.split(' ')[0])}.</h1></div><p>Pickup spot · ${esc(user.area)}${user.city ? `, ${esc(user.city)}` : ''}</p></div>
      <div class="dashboard-grid"><section class="donate-card"><div><div class="donate-card-label"><span></span>For ${esc(user.restaurantName)}</div><h2>Got good food to share?</h2><p>Post what’s ready and nearby volunteers can see it straight away.</p></div><div class="donate-card-bottom"><button class="button button-lime" type="button" data-action="open-donate">Donate food <span class="button-arrow">→</span></button><span class="tiny-note">Add the food, serving estimate, and preparation time. A volunteer can accept the pickup.</span></div></section>
      <aside class="impact-card"><span class="card-label">Your PaatraSetu so far</span><div class="impact-number"><strong>${numberOf(servings)}</strong><span>estimated servings shared</span></div><div class="impact-foot">${open ? `${open} open pickup${open === 1 ? '' : 's'} waiting for a neighbour.` : own.length ? 'Thanks for sharing with your neighbourhood.' : 'Your first donation can start right here.'}</div></aside></div>
      <section class="content-section"><div class="content-heading"><div><h2>Your food offers</h2><p>Pickup status and handoff details.</p></div><span class="count-pill">${own.length}</span></div>${own.length ? `<div class="listing-list">${own.map(d => donationCard(d, user)).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">♡</span><h3>Your first food offer will show up here.</h3><p>Share a fresh surplus meal and nearby volunteers can accept the pickup.</p></div>`}</section>
      <div class="demo-message"><strong>Live in-app updates.</strong> Food offers and pickup changes save in the shared SQLite database. WhatsApp or SMS messages are not connected yet.</div>
    </div>`;
  }

  function volunteerDashboard(user) {
    const nearby = nearbyForVolunteer(user);
    const accepted = state.donations.filter(d => d.volunteerId === user.id && d.status !== 'open').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const radiusOptions = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map(n => `<option value="${n}" ${Number(user.radiusKm) === n ? 'selected' : ''}>${n} km</option>`).join('');
    return `<div class="dashboard" id="home"><div class="welcome-line"><div><p class="eyebrow">Your community, nearby</p><h1>Hi, ${esc(user.name.split(' ')[0])}. Ready to lend a hand?</h1></div><span class="status-label open">Available for pickups</span></div>
      <section class="volunteer-top"><p class="eyebrow">A good match starts close by</p><h2>Food offers around you.</h2><p>Accept a pickup to let the restaurant know you’re on your way. Distance is estimated from the location each person shared.</p></section>
      <section class="content-section"><div class="content-heading with-controls"><div><h2>Available pickups <span class="count-pill">${nearby.length}</span></h2><p>Fresh offers within your pickup radius.</p></div><label class="radius-control" for="radius-select">Show me within <select id="radius-select" aria-label="Pickup radius">${radiusOptions}</select></label></div>${nearby.length ? `<div class="listing-list">${nearby.map(d => donationCard(d, user, true)).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">⌖</span><h3>No offers within ${Number(user.radiusKm) || 10} km right now.</h3><p>When a local restaurant posts food, it will appear here. Widen your pickup radius or check back soon.</p></div>`}</section>
      <section class="content-section"><div class="content-heading"><div><h2>Your accepted pickups</h2><p>Offers you’ve accepted and their current status.</p></div><span class="count-pill">${accepted.length}</span></div>${accepted.length ? `<div class="listing-list">${accepted.map(d => donationCard(d, user, true)).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">↗</span><h3>No pickups accepted yet.</h3><p>Once you accept a nearby offer, it will be listed here.</p></div>`}</section>
      <div class="demo-message"><strong>Live in-app updates.</strong> Nearby offers and pickup changes are shared through the PaatraSetu server. WhatsApp or SMS messages are not connected yet.</div>
    </div>`;
  }

  function render() {
    saveSignupDraft();
    setHeader(state.user);
    if (state.user?.role === 'restaurant') main.innerHTML = restaurantDashboard(state.user);
    else if (state.user?.role === 'volunteer') main.innerHTML = volunteerDashboard(state.user);
    else main.innerHTML = route === 'signin' ? authPage('signin') : route === 'signup' ? authPage('signup') : guestPage();
    if (route === 'signup' && !state.user) restoreSignupDraft();
  }

  function go(nextRoute) {
    route = nextRoute;
    if (nextRoute === 'signup') role = 'restaurant';
    pendingCoords = null;
    dialogRoot.innerHTML = '';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getGPS(statusEl) {
    if (!navigator.geolocation) { if (statusEl) statusEl.textContent = 'Location is not available in this browser.'; return; }
    if (statusEl) { statusEl.classList.remove('is-set'); statusEl.textContent = 'Finding your location…'; }
    navigator.geolocation.getCurrentPosition(position => {
      pendingCoords = { lat: position.coords.latitude, lon: position.coords.longitude };
      if (statusEl) { statusEl.textContent = `Location tagged · ${pendingCoords.lat.toFixed(4)}, ${pendingCoords.lon.toFixed(4)}`; statusEl.classList.add('is-set'); }
    }, error => {
      pendingCoords = null;
      if (statusEl) statusEl.textContent = error.code === 1 ? 'Location permission was not granted. Allow it in your browser and try again.' : 'Could not get your location. Check GPS access and try again.';
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  function showDonateModal() {
    const user = state.user;
    if (!canDonate(user)) { go('signin'); return; }
    const now = localDateTimeValue(new Date());
    dialogRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="donate-title"><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button><p class="eyebrow">A little extra can go a long way</p><h2 id="donate-title">Add food offers</h2><p class="modal-intro">Add one or more items from this kitchen. Each item will be visible to nearby volunteers.</p>
    <form id="donate-form" novalidate><div id="food-items" class="food-items"><div class="food-item" data-item-index="0"><div class="food-item-heading"><strong>Food item 1</strong><button class="link-button remove-food" type="button" data-action="remove-food" aria-label="Remove food item" disabled>Remove</button></div><div class="form-grid"><div class="field field-full"><label>What is the food item?</label><input name="food" placeholder="e.g. Vegetable rice and dal" maxlength="90" required /></div><div class="field"><label>Approx. people it can feed</label><input name="people" type="number" min="1" max="5000" step="1" placeholder="e.g. 12" required /></div><div class="field"><label>When was it made?</label><input name="madeAt" type="datetime-local" value="${now}" required /></div><div class="field field-full"><label>Expiry window / pickup notes <span style="font-weight:400;color:#8a948b">(optional)</span></label><textarea name="notes" maxlength="240" placeholder="e.g. Best collected within 2 hours; packaging or entrance details"></textarea></div></div></div></div><button class="button button-outline add-food-button" type="button" data-action="add-food">+ Add another food item</button><div class="tagged-spot"><label>Tagged pickup spot</label><span class="gps-status is-set">⌖ ${esc(user.area)}${user.city ? ` · ${esc(user.city)}` : ''}</span></div><p id="donate-error" class="error-message" role="alert"></p><div class="form-actions"><button class="button button-primary button-wide" type="submit">Share all food offers <span class="button-arrow">→</span></button></div><p class="modal-footnote">The nearest eligible volunteer is identified for each item. SMS remains a server-side integration hook.</p></form></section></div>`;
    $('[name="food"]', dialogRoot)?.focus();
  }

  function showAlerts() {
    const user = state.user;
    const nearby = user.role === 'volunteer' ? nearbyForVolunteer(user) : [];
    const nearbyRows = nearby.slice(0, 5).map(d => `<div class="alert-item"><span class="alert-bullet">⌖</span><div class="alert-copy"><strong>Food nearby: ${esc(d.food)}</strong><p>${d.distanceKm == null ? 'In your pickup area' : `${d.distanceKm.toFixed(1)} km away`} · ${esc(d.restaurantName || 'Local restaurant')}</p></div></div>`).join('');
    const relevant = state.donations.filter(d => (user.role === 'restaurant' && d.restaurantId === user.id && d.status !== 'open') || (user.role === 'volunteer' && d.volunteerId === user.id && d.status !== 'open')).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const rows = relevant.map(d => {
      const title = user.role === 'restaurant' ? `${d.volunteerName || 'A volunteer'} accepted your pickup` : `${d.food} pickup update`;
      const body = `${d.status === 'accepted' ? 'Volunteer on the way' : 'Picked up'} · ${dateString(d.updatedAt || d.createdAt)}`;
      return `<div class="alert-item"><span class="alert-bullet">✓</span><div class="alert-copy"><strong>${esc(title)}</strong><p>${esc(body)}</p></div></div>`;
    }).join('');
    const empty = !nearbyRows && !rows ? `<div class="empty-state"><span class="empty-icon">♡</span><h3>All caught up.</h3><p>New food offers and pickup updates will show here.</p></div>` : '';
    dialogRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="alerts-title"><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button><p class="eyebrow">In-app updates</p><h2 id="alerts-title">Your pickup activity</h2><p class="modal-intro">New offers and pickup changes from your PaatraSetu community.</p>${nearbyRows}${rows}${empty}<p class="modal-footnote">Text and WhatsApp alerts are not connected yet.</p></section></div>`;
  }

  async function submitSignup(form) {
    const error = $('#signup-error');
    const fields = new FormData(form);
    const name = String(fields.get('name') || '').trim();
    const email = String(fields.get('email') || '').trim();
    const password = String(fields.get('password') || '');
    const area = String(fields.get('area') || '').trim();
    const stateName = String(fields.get('state') || '').trim();
    const town = String(fields.get('town') || '').trim();
    const pincode = String(fields.get('pincode') || '').trim();
    const phone = String(fields.get('phone') || '').trim();
    const restaurantName = String(fields.get('restaurantName') || '').trim();
    const proof = fields.get('proof');
    if (!name || (role === 'restaurant' && !restaurantName) || !email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !phone || !area) {
      error.textContent = 'Please complete the required fields, use a valid email, and choose a password of at least 8 characters.'; return;
    }
    if (!stateName || !town || !/^\d{6}$/.test(pincode)) { error.textContent = 'Choose your state, enter your town or city, and provide a valid 6-digit pincode.'; return; }
    try { pendingCoords = await resolvePincode(pincode, town, stateName); } catch (e) { error.textContent = e.message; return; }
    fields.set('state', stateName);
    if (role === 'restaurant' && proof && proof.name && proof.size > 0) {
      const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
      if (!allowed.includes(proof.type)) {
        error.textContent = 'If you upload a restaurant proof file, use a PDF, JPG, PNG, or WebP file.';
        return;
      }
      if (proof.size > 5 * 1024 * 1024) {
        error.textContent = 'Restaurant proof must be 5 MB or smaller.';
        return;
      }
    }
    fields.set('role', role === 'individual' ? 'restaurant' : role);
    if (role === 'individual' && !fields.get('restaurantName')) fields.set('restaurantName', `${name}'s kitchen`);
    fields.set('latitude', String(pendingCoords.lat));
    fields.set('longitude', String(pendingCoords.lon));
    if (staticDemoHost) {
      const accounts = JSON.parse(localStorage.getItem('paatrasetu_demo_accounts') || '[]');
      if (accounts.some(account => account.email.toLowerCase() === email.toLowerCase())) {
        error.textContent = 'An account with this email already exists in this browser.';
        return;
      }
      const account = {
        id: `demo-user-${Date.now()}`,
        role: role === 'individual' ? 'restaurant' : role,
        name,
        restaurantName: role === 'individual' ? `${name}'s kitchen` : restaurantName,
        email,
        phone,
        area,
        city: town,
        state: stateName,
        town,
        pincode,
        coords: pendingCoords,
        radiusKm: 10,
        password
      };
      localStorage.setItem('paatrasetu_demo_accounts', JSON.stringify([...accounts, account]));
      state.user = { ...account };
      delete state.user.password;
      state.demoMode = true;
      localStorage.setItem('paatrasetu_demo_session', JSON.stringify(state.user));
      route = 'home'; pendingCoords = null; await refresh();
      notify(`Welcome to PaatraSetu, ${name}. This browser demo account is ready.`);
      return;
    }
    try {
      await request('/api/signup', { method: 'POST', body: fields, form: true });
      route = 'home'; pendingCoords = null; await refresh();
      notify(`Welcome to PaatraSetu, ${role === 'restaurant' ? restaurantName : name}.`);
    } catch (e) { error.textContent = e.message; }
  }

  async function submitSignin(form) {
    const error = $('#signin-error');
    const fields = new FormData(form);
    try {
      await request('/api/login', { method: 'POST', body: { email: fields.get('email'), password: fields.get('password') } });
      state.demoMode = false;
      route = 'home'; await refresh(); notify(`Welcome back, ${state.user.name.split(' ')[0]}.`);
    } catch (e) {
      if (String(fields.get('email')).trim().toLowerCase() === 'admin' && fields.get('password') === 'admin') {
        state.demoMode = true;
        state.user = demoUser;
        route = 'home';
        await refresh();
        notify('Welcome to the presentation demo.');
        return;
      }
      const accounts = JSON.parse(localStorage.getItem('paatrasetu_demo_accounts') || '[]');
      const account = accounts.find(item => item.email.toLowerCase() === String(fields.get('email')).trim().toLowerCase() && item.password === fields.get('password'));
      if (account) {
        state.demoMode = true;
        state.user = { ...account };
        delete state.user.password;
        localStorage.setItem('paatrasetu_demo_session', JSON.stringify(state.user));
        route = 'home';
        await refresh();
        notify(`Welcome back, ${state.user.name.split(' ')[0]}.`);
      } else error.textContent = e.message;
    }
  }

  async function submitDonation(form) {
    const error = $('#donate-error');
    const items = [...form.querySelectorAll('.food-item')].map(item => {
      const value = name => item.querySelector(`[name="${name}"]`)?.value || '';
      return { food: String(value('food')).trim(), people: Number(value('people')), madeAt: new Date(value('madeAt')), notes: String(value('notes')).trim() };
    });
    if (!items.length || items.some(item => !item.food || item.food.length > 90 || !Number.isInteger(item.people) || item.people < 1 || item.people > 5000 || Number.isNaN(item.madeAt.valueOf()) || item.notes.length > 240)) {
      error.textContent = 'Complete every food item with a description, 1 to 5,000 people, and a valid preparation time.'; return;
    }
    try {
      if (state.demoMode) {
        const donations = JSON.parse(localStorage.getItem('paatrasetu_demo_donations') || '[]');
        const newDonations = items.map((item, index) => ({ id: `demo-${Date.now()}-${index}`, restaurantId: state.user.id, restaurantName: state.user.restaurantName, food: item.food, people: item.people, madeAt: item.madeAt.toISOString(), notes: item.notes, status: 'open', volunteerId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), area: state.user.area, city: state.user.city, coords: state.user.coords, distanceKm: 0 }));
        localStorage.setItem('paatrasetu_demo_donations', JSON.stringify([...newDonations, ...donations]));
        dialogRoot.innerHTML = ''; await refresh(); notify('Offer shared in presentation mode. Volunteers can be connected when the server is available.');
        return;
      }
      const results = [];
      for (const item of items) results.push(await request('/api/donations', { method: 'POST', body: { food: item.food, people: item.people, madeAt: item.madeAt.toISOString(), notes: item.notes } }));
      dialogRoot.innerHTML = ''; await refresh();
      const nearest = results.find(result => result.nearestVolunteer)?.nearestVolunteer;
      notify(`${items.length} food offer${items.length === 1 ? '' : 's'} shared${nearest ? `. ${nearest.name} is the nearest volunteer.` : '.'}`);
    } catch (e) { error.textContent = e.message; }
  }

  async function acceptDonation(id) {
    try {
      if (state.demoMode) {
        updateDemoDonation(id, { status: 'accepted', volunteerId: state.user.id, volunteerName: state.user.name });
        await refresh(); notify('Pickup accepted. The donor has been updated.'); return;
      }
      await request(`/api/donations/${encodeURIComponent(id)}/accept`, { method: 'POST', body: {} });
      await refresh(); notify('Pickup accepted. The restaurant has been updated.');
    } catch (e) { notify(e.message); await refresh(); }
  }

  async function completeDonation(id) {
    try {
      if (state.demoMode) {
        updateDemoDonation(id, { status: 'completed', updatedAt: new Date().toISOString() });
        await refresh(); notify('Pickup marked complete. Thank you for lending a hand.'); return;
      }
      await request(`/api/donations/${encodeURIComponent(id)}/complete`, { method: 'POST', body: {} });
      await refresh(); notify('Pickup marked complete. Thank you for lending a hand.');
    } catch (e) { notify(e.message); await refresh(); }
  }

  function updateDemoDonation(id, changes) {
    const donations = JSON.parse(localStorage.getItem('paatrasetu_demo_donations') || '[]');
    localStorage.setItem('paatrasetu_demo_donations', JSON.stringify(donations.map(d => d.id === id ? { ...d, ...changes, updatedAt: new Date().toISOString() } : d)));
  }

  async function signOut() {
    const wasDemo = state.demoMode;
    state.user = null;
    state.donations = [];
    state.demoMode = false;
    localStorage.removeItem('paatrasetu_demo_session');
    eventSource?.close(); eventSource = null; eventUserId = null;
    route = 'home'; dialogRoot.innerHTML = ''; render();
    try {
      if (!wasDemo) await request('/api/logout', { method: 'POST', body: {} });
    } catch (e) { notify(e.message); }
    notify('You have signed out.');
  }

  document.addEventListener('click', event => {
    if (!event.target.closest('#header-actions') && !event.target.closest('#profile-menu')) {
      $('#profile-menu')?.remove();
    }
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'signup' || action === 'signin') go(action);
    else if (action === 'home') go('home');
    else if (action === 'set-role') { saveSignupDraft(); role = button.dataset.role; pendingCoords = signupDrafts[role]?.coords || null; render(); }
    else if (action === 'join-role') { saveSignupDraft(); role = button.dataset.role; pendingCoords = signupDrafts[role]?.coords || null; route = 'signup'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (action === 'profile') showProfileMenu();
    else if (action === 'profile-close') $('#profile-menu')?.remove();
    else if (action === 'add-food') addFoodItem();
    else if (action === 'remove-food') removeFoodItem(button);
    else if (action === 'get-gps') getGPS($('#gps-status'));
    else if (action === 'donate-gate') { if (state.user) showDonateModal(); else go('signin'); }
    else if (action === 'open-donate') showDonateModal();
    else if (action === 'notifications') showAlerts();
    else if (action === 'close-modal') { if (event.target.classList.contains('modal-backdrop') || button.classList.contains('modal-close')) dialogRoot.innerHTML = ''; }
    else if (action === 'accept') void acceptDonation(button.dataset.id);
    else if (action === 'complete') void completeDonation(button.dataset.id);
    else if (action === 'signout') void signOut();
  });

  function addFoodItem() {
    const items = $('#food-items');
    if (!items) return;
    const index = items.children.length;
    const now = localDateTimeValue(new Date());
    const item = document.createElement('div');
    item.className = 'food-item';
    item.dataset.itemIndex = index;
    item.innerHTML = `<div class="food-item-heading"><strong>Food item ${index + 1}</strong><button class="link-button remove-food" type="button" data-action="remove-food" aria-label="Remove food item">Remove</button></div><div class="form-grid"><div class="field field-full"><label>What is the food item?</label><input name="food" placeholder="e.g. Vegetable rice and dal" maxlength="90" required /></div><div class="field"><label>Approx. people it can feed</label><input name="people" type="number" min="1" max="5000" step="1" placeholder="e.g. 12" required /></div><div class="field"><label>When was it made?</label><input name="madeAt" type="datetime-local" value="${now}" required /></div><div class="field field-full"><label>Expiry window / pickup notes <span style="font-weight:400;color:#8a948b">(optional)</span></label><textarea name="notes" maxlength="240" placeholder="e.g. Best collected within 2 hours; packaging or entrance details"></textarea></div></div>`;
    items.appendChild(item);
    item.querySelector('[name="food"]')?.focus();
  }

  function removeFoodItem(button) {
    const item = button.closest('.food-item');
    const items = $('#food-items');
    if (!item || !items || items.children.length <= 1) return;
    item.remove();
    [...items.children].forEach((entry, index) => {
      entry.dataset.itemIndex = index;
      const heading = $('.food-item-heading strong', entry);
      if (heading) heading.textContent = `Food item ${index + 1}`;
    });
  }

  document.addEventListener('submit', event => {
    if (event.target.id === 'signup-form') { event.preventDefault(); void submitSignup(event.target); }
    else if (event.target.id === 'signin-form') { event.preventDefault(); void submitSignin(event.target); }
    else if (event.target.id === 'donate-form') { event.preventDefault(); void submitDonation(event.target); }
  });

  document.addEventListener('change', async event => {
    if (event.target.id === 'proof-file') {
      const file = event.target.files?.[0];
      const label = $('#upload-name');
      if (label && file) label.textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
    }
    if (event.target.id === 'radius-select' && state.user?.role === 'volunteer') {
      try {
        if (state.demoMode) {
          state.user.radiusKm = Number(event.target.value);
          localStorage.setItem('paatrasetu_demo_session', JSON.stringify(state.user));
          render();
          return;
        }
        await request('/api/me/radius', { method: 'PUT', body: { radiusKm: Number(event.target.value) } });
        await refresh();
      } catch (e) { notify(e.message); }
    }
  });

  window.addEventListener('focus', () => { void refresh().catch(() => {}); });
  window.addEventListener('pageshow', () => { void refresh().catch(() => {}); });

  main.innerHTML = `<div class="loading-state"><span class="loading-ornament">✳</span><p>Opening your neighbourhood table…</p></div>`;
  if (staticDemoHost) {
    state.demoMode = true;
    const savedSession = JSON.parse(localStorage.getItem('paatrasetu_demo_session') || 'null');
    if (savedSession) {
      state.user = savedSession;
    }
  }
  refresh().catch(error => {
    state.user = null; state.donations = []; render();
    notify(error.message);
  });
})();
