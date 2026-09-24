(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const main = $('#main');
  const headerActions = $('#header-actions');
  const dialogRoot = $('#dialog-root');
  const toast = $('#toast');
  const state = { user: null, donations: [] };
  let route = 'home';
  let role = 'restaurant';
  let pendingCoords = null;
  let toastTimer;
  let eventSource = null;
  let eventUserId = null;
  let refreshInProgress = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = name => (name || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase();
  const numberOf = value => new Intl.NumberFormat().format(Number(value) || 0);
  const dateString = iso => { const date = new Date(iso); return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date); };
  const localDateTimeValue = date => { const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return adjusted.toISOString().slice(0, 16); };
  const canDonate = user => user?.role === 'restaurant';

  async function request(path, { method = 'GET', body, form = false } = {}) {
    const headers = {};
    const options = { method, credentials: 'same-origin', headers };
    if (body !== undefined) {
      if (form) options.body = body;
      else { headers['Content-Type'] = 'application/json'; options.body = JSON.stringify(body); }
    }
    const response = await fetch(path, options);
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('The Goodplate database server did not return a response. Start it with the instructions in README.md.'); }
    if (!response.ok) throw new Error(payload.error || 'Goodplate could not complete that action. Please try again.');
    return payload;
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
    headerActions.innerHTML = `${updates}${donate}<span class="avatar-chip"><span class="avatar-dot">${esc(initials(user.name))}</span><span>${esc(user.name.split(' ')[0])}</span></span><button type="button" class="link-button signout-link" aria-label="Sign out" data-action="signout"><span class="signout-label">Sign out</span><span class="signout-icon" aria-hidden="true">↪</span></button>`;
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
    if (refreshInProgress) return refreshInProgress;
    refreshInProgress = (async () => {
      const previousId = state.user?.id || null;
      const result = await request('/api/me');
      state.user = result.user;
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
      <section class="hero" aria-labelledby="hero-title">
        <div class="hero-copy">
          <p class="eyebrow">Good food. Shared locally.</p>
          <h1 id="hero-title">A little extra can go <em>a long way.</em></h1>
          <p class="hero-lede">Goodplate connects restaurants with nearby volunteers, so fresh surplus food can find its way to people who need it.</p>
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
        <div class="why-copy"><p class="eyebrow">Our why</p><h2>Good food still has somewhere to go.</h2><p>Every day, kitchens make a little more than they need. Goodplate makes the next step clearer: a local connection, a quick message, and a pickup that works for everyone.</p></div>
        <div class="why-aside"><p class="why-aside-label">Built around real life</p><div class="why-points"><div class="why-point"><span class="check">✓</span><span>Quick to use on a phone, even on a slower connection.</span></div><div class="why-point"><span class="check">✓</span><span>Pickup details stay clear, from the food to its location.</span></div><div class="why-point"><span class="check">✓</span><span>Restaurants and volunteers each get a view that fits their role.</span></div></div></div>
      </section>
      <section class="join-strip"><div><h2>Make a little extra mean a lot.</h2><p>Sign up as a restaurant or volunteer and start nearby.</p></div><button class="button button-primary" type="button" data-action="signup">Join Goodplate <span class="button-arrow">→</span></button></section>
    </div>`;
  }

  function aside(kind) {
    const isLogin = kind === 'signin';
    return `<aside class="auth-aside"><p class="eyebrow">${isLogin ? 'Welcome back' : 'Better together'}</p><h1>${isLogin ? 'Good to see you again.' : 'Good food. Good neighbours.'}</h1><p>${isLogin ? 'Sign in to see food offers, nearby pickups, and the latest from your community.' : 'A few details help us connect restaurant kitchens with volunteers nearby.'}</p><div class="aside-foot"><span>✳</span>${isLogin ? 'Your local food rescue community' : 'Small steps add up to something good'}</div></aside>`;
  }

  function authPage(kind) {
    const isLogin = kind === 'signin';
    if (isLogin) return `<div class="auth-layout">${aside(kind)}<section class="form-panel"><div class="form-topline"><span>Sign in to Goodplate</span><button type="button" data-action="signup">Create an account →</button></div><h2>Pick up where you left off.</h2><p class="form-subtitle">Sign in to the shared Goodplate database from any device.</p><form id="signin-form" novalidate><div class="form-grid"><div class="field field-full"><label for="login-email">Email address</label><input id="login-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required /></div><div class="field field-full"><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Your password" required /></div></div><p id="signin-error" class="error-message" role="alert"></p><div class="form-actions"><button class="button button-primary button-wide" type="submit">Sign in <span class="button-arrow">→</span></button></div><p class="form-notice"><span>●</span>Your password is checked by the server; only a salted password hash is stored in SQLite.</p></form></section></div>`;
    return `<div class="auth-layout">${aside(kind)}<section class="form-panel"><div class="form-topline"><span>Join the Goodplate community</span><button type="button" data-action="signin">Already joined? Sign in</button></div><h2>Join your local food rescue.</h2><p class="form-subtitle">Choose how you’d like to help. Your location lets us find nearby matches.</p><div class="role-switch" role="group" aria-label="Choose account type"><button type="button" data-action="set-role" data-role="restaurant" aria-pressed="${role === 'restaurant'}">Restaurant</button><button type="button" data-action="set-role" data-role="volunteer" aria-pressed="${role === 'volunteer'}">Volunteer</button></div>
      <form id="signup-form" novalidate><div class="form-grid">
        <div class="field ${role === 'restaurant' ? '' : 'field-full'}"><label for="signup-name">${role === 'restaurant' ? 'Owner / contact name' : 'Your name'}</label><input id="signup-name" name="name" autocomplete="name" placeholder="Full name" required /></div>
        ${role === 'restaurant' ? `<div class="field"><label for="signup-restaurant">Restaurant name</label><input id="signup-restaurant" name="restaurantName" autocomplete="organization" placeholder="Name on your storefront" required /></div>` : ''}
        <div class="field"><label for="signup-email">Email address</label><input id="signup-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required /></div>
        <div class="field"><label for="signup-phone">Mobile number</label><input id="signup-phone" name="phone" type="tel" autocomplete="tel" placeholder="Include country code" required /><span class="field-hint">Used for pickup coordination.</span></div>
        <div class="field"><label for="signup-password">Create a password</label><input id="signup-password" name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" placeholder="At least 8 characters" required /></div>
        <div class="field"><label for="signup-area">${role === 'restaurant' ? 'Restaurant area / address' : 'Your area / address'}</label><input id="signup-area" name="area" autocomplete="street-address" placeholder="Street, neighbourhood, city" required /></div>
        <div class="field field-full"><label>Tag your pickup area</label><div class="gps-row"><button class="button button-outline button-small" type="button" data-action="get-gps">⌖ Use my GPS location</button><span id="gps-status" class="gps-status">Location is needed to find nearby matches.</span></div><span class="field-hint">Your browser will ask permission. GPS coordinates are used for nearby matching.</span></div>
        ${role === 'restaurant' ? `<div class="field field-full"><label for="proof-file">Restaurant proof</label><div class="upload-box"><span aria-hidden="true">▧</span><label for="proof-file">Choose a file</label><input id="proof-file" name="proof" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" required /><span id="upload-name" class="upload-name">Business licence, registration, or storefront photo</span></div><span class="field-hint">PDF, JPG, PNG, or WebP · up to 5 MB. The file is stored on the Goodplate server for review.</span></div>` : ''}
      </div><p id="signup-error" class="error-message" role="alert"></p><p class="form-notice"><span>●</span>${role === 'restaurant' ? 'Your pickup pin is shared with nearby volunteers when you post an offer.' : 'Your location is used to find nearby offers. Your exact pin stays private to you.'}</p><div class="form-actions"><button class="button button-primary button-wide" type="submit">Create ${role === 'restaurant' ? 'restaurant' : 'volunteer'} account <span class="button-arrow">→</span></button></div></form></section></div>`;
  }

  function nearbyForVolunteer(user) {
    return state.donations.filter(d => d.status === 'open' && d.distanceKm <= user.radiusKm)
      .sort((a, b) => (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999));
  }

  function donationCard(d, user, volunteerView = false) {
    const distance = typeof d.distanceKm === 'number' ? d.distanceKm : null;
    const status = d.status === 'open' ? '<span class="status-label open">Available</span>' : `<span class="status-label accepted">${d.status === 'accepted' ? 'Volunteer on the way' : 'Picked up'}</span>`;
    const details = `${numberOf(d.people)} people · Prepared ${esc(dateString(d.madeAt))}`;
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
      <aside class="impact-card"><span class="card-label">Your Goodplate so far</span><div class="impact-number"><strong>${numberOf(servings)}</strong><span>estimated servings shared</span></div><div class="impact-foot">${open ? `${open} open pickup${open === 1 ? '' : 's'} waiting for a neighbour.` : own.length ? 'Thanks for sharing with your neighbourhood.' : 'Your first donation can start right here.'}</div></aside></div>
      <section class="content-section"><div class="content-heading"><div><h2>Your food offers</h2><p>Pickup status and handoff details.</p></div><span class="count-pill">${own.length}</span></div>${own.length ? `<div class="listing-list">${own.map(d => donationCard(d, user)).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">♡</span><h3>Your first food offer will show up here.</h3><p>Share a fresh surplus meal and nearby volunteers can accept the pickup.</p></div>`}</section>
      <div class="demo-message"><strong>Live in-app updates.</strong> Food offers and pickup changes save in the shared SQLite database. WhatsApp or SMS messages are not connected yet.</div>
    </div>`;
  }

  function volunteerDashboard(user) {
    const nearby = nearbyForVolunteer(user);
    const accepted = state.donations.filter(d => d.volunteerId === user.id && d.status !== 'open').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const radiusOptions = [2, 5, 10, 20, 50].map(n => `<option value="${n}" ${Number(user.radiusKm) === n ? 'selected' : ''}>${n} km</option>`).join('');
    return `<div class="dashboard" id="home"><div class="welcome-line"><div><p class="eyebrow">Your community, nearby</p><h1>Hi, ${esc(user.name.split(' ')[0])}. Ready to lend a hand?</h1></div><span class="status-label open">Available for pickups</span></div>
      <section class="volunteer-top"><p class="eyebrow">A good match starts close by</p><h2>Food offers around you.</h2><p>Accept a pickup to let the restaurant know you’re on your way. Distance is estimated from the location each person shared.</p></section>
      <section class="content-section"><div class="content-heading with-controls"><div><h2>Available pickups <span class="count-pill">${nearby.length}</span></h2><p>Fresh offers within your pickup radius.</p></div><label class="radius-control" for="radius-select">Show me within <select id="radius-select" aria-label="Pickup radius">${radiusOptions}</select></label></div>${nearby.length ? `<div class="listing-list">${nearby.map(d => donationCard(d, user, true)).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">⌖</span><h3>No offers within ${Number(user.radiusKm) || 10} km right now.</h3><p>When a local restaurant posts food, it will appear here. Widen your pickup radius or check back soon.</p></div>`}</section>
      <section class="content-section"><div class="content-heading"><div><h2>Your accepted pickups</h2><p>Offers you’ve accepted and their current status.</p></div><span class="count-pill">${accepted.length}</span></div>${accepted.length ? `<div class="listing-list">${accepted.map(d => donationCard(d, user, true)).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">↗</span><h3>No pickups accepted yet.</h3><p>Once you accept a nearby offer, it will be listed here.</p></div>`}</section>
      <div class="demo-message"><strong>Live in-app updates.</strong> Nearby offers and pickup changes are shared through the Goodplate server. WhatsApp or SMS messages are not connected yet.</div>
    </div>`;
  }

  function render() {
    setHeader(state.user);
    if (state.user?.role === 'restaurant') main.innerHTML = restaurantDashboard(state.user);
    else if (state.user?.role === 'volunteer') main.innerHTML = volunteerDashboard(state.user);
    else main.innerHTML = route === 'signin' ? authPage('signin') : route === 'signup' ? authPage('signup') : guestPage();
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
    dialogRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="donate-title"><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button><p class="eyebrow">A little extra can go a long way</p><h2 id="donate-title">Add a food offer</h2><p class="modal-intro">A few clear details help a nearby volunteer plan a quick pickup.</p>
      <form id="donate-form" novalidate><div class="form-grid"><div class="field field-full"><label for="food-name">What food is available?</label><input id="food-name" name="food" placeholder="e.g. Vegetable rice and dal" maxlength="90" required /></div><div class="field"><label for="food-people">Approx. servings</label><input id="food-people" name="people" type="number" min="1" max="5000" step="1" placeholder="e.g. 12" required /></div><div class="field"><label for="food-made">When was it prepared?</label><input id="food-made" name="madeAt" type="datetime-local" value="${now}" required /></div><div class="field field-full"><label for="food-notes">Pickup notes <span style="font-weight:400;color:#8a948b">(optional)</span></label><textarea id="food-notes" name="notes" maxlength="240" placeholder="Packaging, entrance, or best time to arrive"></textarea></div><div class="field field-full"><label>Tagged pickup spot</label><div class="gps-row"><span class="gps-status is-set">⌖ ${esc(user.area)}${user.city ? ` · ${esc(user.city)}` : ''}</span><span class="field-hint">From your restaurant profile.</span></div></div></div><p id="donate-error" class="error-message" role="alert"></p><div class="form-actions"><button class="button button-primary button-wide" type="submit">Share this food offer <span class="button-arrow">→</span></button></div><p class="modal-footnote">Nearby volunteers receive an in-app update. No WhatsApp or SMS will be sent.</p></form></section></div>`;
    $('#food-name', dialogRoot).focus();
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
    dialogRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="alerts-title"><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button><p class="eyebrow">In-app updates</p><h2 id="alerts-title">Your pickup activity</h2><p class="modal-intro">New offers and pickup changes from your Goodplate community.</p>${nearbyRows}${rows}${empty}<p class="modal-footnote">Text and WhatsApp alerts are not connected yet.</p></section></div>`;
  }

  async function submitSignup(form) {
    const error = $('#signup-error');
    const fields = new FormData(form);
    const name = String(fields.get('name') || '').trim();
    const email = String(fields.get('email') || '').trim();
    const password = String(fields.get('password') || '');
    const area = String(fields.get('area') || '').trim();
    const phone = String(fields.get('phone') || '').trim();
    const restaurantName = String(fields.get('restaurantName') || '').trim();
    const proof = fields.get('proof');
    if (!name || (role === 'restaurant' && !restaurantName) || !email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !phone || !area) {
      error.textContent = 'Please complete the required fields, use a valid email, and choose a password of at least 8 characters.'; return;
    }
    if (!pendingCoords) { error.textContent = 'Tag your GPS location before creating your account.'; return; }
    if (role === 'restaurant' && (!proof || !proof.name)) { error.textContent = 'Please choose a restaurant proof document or photo.'; return; }
    fields.set('role', role);
    fields.set('latitude', String(pendingCoords.lat));
    fields.set('longitude', String(pendingCoords.lon));
    try {
      await request('/api/signup', { method: 'POST', body: fields, form: true });
      route = 'home'; pendingCoords = null; await refresh();
      notify(`Welcome to Goodplate, ${role === 'restaurant' ? restaurantName : name}.`);
    } catch (e) { error.textContent = e.message; }
  }

  async function submitSignin(form) {
    const error = $('#signin-error');
    const fields = new FormData(form);
    try {
      await request('/api/login', { method: 'POST', body: { email: fields.get('email'), password: fields.get('password') } });
      route = 'home'; await refresh(); notify(`Welcome back, ${state.user.name.split(' ')[0]}.`);
    } catch (e) { error.textContent = e.message; }
  }

  async function submitDonation(form) {
    const error = $('#donate-error');
    const fields = new FormData(form);
    const food = String(fields.get('food') || '').trim();
    const people = Number(fields.get('people'));
    const madeAt = new Date(fields.get('madeAt'));
    if (!food || food.length > 90 || !Number.isInteger(people) || people < 1 || people > 5000 || Number.isNaN(madeAt.valueOf())) {
      error.textContent = 'Add a food description, a serving count from 1 to 5,000, and a valid preparation time.'; return;
    }
    try {
      const result = await request('/api/donations', { method: 'POST', body: { food, people, madeAt: madeAt.toISOString(), notes: fields.get('notes') } });
      dialogRoot.innerHTML = ''; await refresh();
      notify(result.nearbyVolunteers ? `Offer shared. ${result.nearbyVolunteers} nearby volunteer${result.nearbyVolunteers === 1 ? '' : 's'} can see it now.` : 'Offer shared. Nearby volunteers can see it now.');
    } catch (e) { error.textContent = e.message; }
  }

  async function acceptDonation(id) {
    try {
      await request(`/api/donations/${encodeURIComponent(id)}/accept`, { method: 'POST', body: {} });
      await refresh(); notify('Pickup accepted. The restaurant has been updated.');
    } catch (e) { notify(e.message); await refresh(); }
  }

  async function completeDonation(id) {
    try {
      await request(`/api/donations/${encodeURIComponent(id)}/complete`, { method: 'POST', body: {} });
      await refresh(); notify('Pickup marked complete. Thank you for lending a hand.');
    } catch (e) { notify(e.message); await refresh(); }
  }

  async function signOut() {
    try { await request('/api/logout', { method: 'POST', body: {} }); }
    catch (e) { notify(e.message); }
    route = 'home'; dialogRoot.innerHTML = ''; await refresh(); notify('You have signed out.');
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'signup' || action === 'signin') go(action);
    else if (action === 'home') go('home');
    else if (action === 'set-role') { role = button.dataset.role; pendingCoords = null; render(); }
    else if (action === 'get-gps') getGPS($('#gps-status'));
    else if (action === 'donate-gate') { if (state.user) showDonateModal(); else go('signin'); }
    else if (action === 'open-donate') showDonateModal();
    else if (action === 'notifications') showAlerts();
    else if (action === 'close-modal') { if (event.target.classList.contains('modal-backdrop') || button.classList.contains('modal-close')) dialogRoot.innerHTML = ''; }
    else if (action === 'accept') void acceptDonation(button.dataset.id);
    else if (action === 'complete') void completeDonation(button.dataset.id);
    else if (action === 'signout') void signOut();
  });

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
        await request('/api/me/radius', { method: 'PUT', body: { radiusKm: Number(event.target.value) } });
        await refresh();
      } catch (e) { notify(e.message); }
    }
  });

  window.addEventListener('focus', () => { void refresh().catch(() => {}); });
  window.addEventListener('pageshow', () => { void refresh().catch(() => {}); });

  main.innerHTML = `<div class="loading-state"><span class="loading-ornament">✳</span><p>Opening your neighbourhood table…</p></div>`;
  refresh().catch(error => {
    state.user = null; state.donations = []; render();
    notify(error.message);
  });
})();
