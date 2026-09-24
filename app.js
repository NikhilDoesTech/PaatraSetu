(() => {
  const KEYS = { accounts: 'goodplate.accounts.v1', donations: 'goodplate.donations.v1', session: 'goodplate.session.v1' };
  const $ = (s, root = document) => root.querySelector(s);
  const main = $('#main');
  const headerActions = $('#header-actions');
  const dialogRoot = $('#dialog-root');
  const toast = $('#toast');
  let role = 'restaurant';
  let pendingCoords = null;
  let toastTimer;

  const read = (key, fallback) => { try { const x = JSON.parse(localStorage.getItem(key)); return x ?? fallback; } catch { return fallback; } };
  const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
  const accounts = () => read(KEYS.accounts, []);
  const donations = () => read(KEYS.donations, []);
  const accountById = id => accounts().find(a => a.id === id);
  const currentUser = () => accountById(read(KEYS.session, null));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = name => (name || '?').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase();
  const makeId = () => (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const dateString = iso => { const date = new Date(iso); return Number.isNaN(date.valueOf()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date); };
  const localDateTimeValue = date => { const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000); return d.toISOString().slice(0,16); };
  const numberOf = value => new Intl.NumberFormat().format(Number(value) || 0);
  const roleWord = user => user?.role === 'volunteer' ? 'volunteer' : 'restaurant';
  const accountLabel = user => user?.role === 'restaurant' ? user.restaurantName : user?.name;
  const canDonate = user => user?.role === 'restaurant';

  function notify(message) {
    toast.textContent = message;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3300);
  }

  function setSession(user) { write(KEYS.session, user.id); render(); }
  function signOut() { localStorage.removeItem(KEYS.session); render(); notify('You have signed out.'); }

  function setHeader(user) {
    if (!user) {
      headerActions.innerHTML = `<button type="button" class="link-button" data-action="signin">Sign in</button><button type="button" class="button button-primary button-small header-donate" data-action="donate-gate">Donate food <span class="button-arrow">→</span></button>`;
      return;
    }
    const action = canDonate(user)
      ? `<button type="button" class="button button-primary button-small header-donate" data-action="open-donate">Donate food <span class="button-arrow">→</span></button>`
      : '';
    const updateCount = donations().filter(d => user.role === 'restaurant' ? d.restaurantId === user.id && d.status !== 'open' : (d.volunteerId === user.id && d.status !== 'open')).length;
    const updates = `<button type="button" class="link-button" aria-label="Pickup updates" data-action="notifications"><span class="updates-label">Updates</span>${updateCount ? ` <span class="count-pill">${updateCount}</span>` : ''}</button>`;
    headerActions.innerHTML = `${updates}${action}<span class="avatar-chip"><span class="avatar-dot">${esc(initials(user.name))}</span><span>${esc(user.name.split(' ')[0])}</span></span><button type="button" class="link-button signout-link" aria-label="Sign out" data-action="signout"><span class="signout-label">Sign out</span><span class="signout-icon" aria-hidden="true">↪</span></button>`;
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
    const top = isLogin
      ? `<div class="form-topline"><span>Sign in to Goodplate</span><button type="button" data-action="signup">Create an account →</button></div>`
      : `<div class="form-topline"><span>Join the Goodplate community</span><button type="button" data-action="signin">I have an account →</button></div>`;
    if (isLogin) return `<div class="auth-layout">${aside(kind)}<section class="form-panel"><div class="form-topline"><span>Sign in to Goodplate</span><button type="button" data-action="signup">Create an account →</button></div><h2>Pick up where you left off.</h2><p class="form-subtitle">Use the email and password you signed up with on this device.</p><form id="signin-form" novalidate><div class="form-grid"><div class="field field-full"><label for="login-email">Email address</label><input id="login-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required /></div><div class="field field-full"><label for="login-password">Password</label><input id="login-password" name="password" type="password" autocomplete="current-password" placeholder="Your password" required /></div></div><p id="signin-error" class="error-message" role="alert"></p><div class="form-actions"><button class="button button-primary button-wide" type="submit">Sign in <span class="button-arrow">→</span></button></div><p class="form-notice"><span>●</span>This preview keeps your profile in this browser. Use demo details only.</p></form></section></div>`;
    return `<div class="auth-layout">${aside(kind)}<section class="form-panel"><div class="form-topline"><span>Let’s get you set up</span><button type="button" data-action="signin">Already joined? Sign in</button></div><h2>Join your local food rescue.</h2><p class="form-subtitle">Choose how you’d like to help. Your location lets us find nearby matches.</p><div class="role-switch" role="group" aria-label="Choose account type"><button type="button" data-action="set-role" data-role="restaurant" aria-pressed="${role === 'restaurant'}">Restaurant</button><button type="button" data-action="set-role" data-role="volunteer" aria-pressed="${role === 'volunteer'}">Volunteer</button></div>
      <form id="signup-form" novalidate><div class="form-grid">
        <div class="field ${role === 'restaurant' ? '' : 'field-full'}"><label for="signup-name">${role === 'restaurant' ? 'Owner / contact name' : 'Your name'}</label><input id="signup-name" name="name" autocomplete="name" placeholder="Full name" required /></div>
        ${role === 'restaurant' ? `<div class="field"><label for="signup-restaurant">Restaurant name</label><input id="signup-restaurant" name="restaurantName" autocomplete="organization" placeholder="Name on your storefront" required /></div>` : ''}
        <div class="field"><label for="signup-email">Email address</label><input id="signup-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" required /></div>
        <div class="field"><label for="signup-phone">Mobile number</label><input id="signup-phone" name="phone" type="tel" autocomplete="tel" placeholder="Include country code" required /><span class="field-hint">Used for pickup coordination.</span></div>
        <div class="field"><label for="signup-password">Create a password</label><input id="signup-password" name="password" type="password" autocomplete="new-password" minlength="6" placeholder="At least 6 characters" required /></div>
        <div class="field"><label for="signup-area">${role === 'restaurant' ? 'Restaurant area / address' : 'Your area / address'}</label><input id="signup-area" name="area" autocomplete="street-address" placeholder="Street, neighbourhood, city" required /></div>
        <div class="field field-full"><label>Tag your pickup area</label><div class="gps-row"><button class="button button-outline button-small" type="button" data-action="get-gps">⌖ Use my GPS location</button><span id="gps-status" class="gps-status">Location is needed to find nearby matches.</span></div><span class="field-hint">Your browser will ask permission. Exact coordinates are used for distance matching.</span></div>
        ${role === 'restaurant' ? `<div class="field field-full"><label for="proof-file">Restaurant proof</label><div class="upload-box"><span aria-hidden="true">▧</span><label for="proof-file">Choose a file</label><input id="proof-file" name="proof" type="file" accept="image/*,.pdf" required /><span id="upload-name" class="upload-name">Business document, licence, or storefront photo</span></div><span class="field-hint">This browser preview stores the file name only. A secure service is needed to keep the actual document.</span></div>` : ''}
      </div><p id="signup-error" class="error-message" role="alert"></p><p class="form-notice"><span>●</span>${role === 'restaurant' ? 'Your pickup pin is shared with nearby volunteers when you post an offer. It helps them find the handoff.' : 'Your location is used to find nearby offers. Your exact pin stays private to you.'}</p><div class="form-actions"><button class="button button-primary button-wide" type="submit">Create ${role === 'restaurant' ? 'restaurant' : 'volunteer'} account <span class="button-arrow">→</span></button></div></form></section></div>`;
  }

  function haversine(a, b) {
    if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(b.lat)) return null;
    const rad = n => n * Math.PI / 180;
    const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
    const x = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
    return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1-x));
  }
  function distanceToVolunteer(donation, volunteer) { return haversine(donation.coords, volunteer.coords); }
  function allOpen() { return donations().filter(d => d.status === 'open'); }
  function nearbyForVolunteer(user) {
    const radius = Number(user.radiusKm) || 10;
    return allOpen().map(d => ({ ...d, distanceKm: distanceToVolunteer(d, user) }))
      .filter(d => d.distanceKm != null ? d.distanceKm <= radius : d.city && d.city.toLowerCase() === (user.city || '').toLowerCase())
      .sort((a,b) => (a.distanceKm ?? 99999) - (b.distanceKm ?? 99999));
  }
  function matchingVolunteers(donation) {
    return accounts().filter(a => a.role === 'volunteer').map(a => ({ a, dist: distanceToVolunteer(donation, a) }))
      .filter(x => x.dist != null && x.dist <= (Number(x.a.radiusKm) || 10));
  }
  function donationCard(d, user, volunteerView = false) {
    const owner = accountById(d.restaurantId);
    const dist = volunteerView ? d.distanceKm : null;
    const state = d.status === 'open' ? '<span class="status-label open">Available</span>' : `<span class="status-label accepted">${d.status === 'accepted' ? 'Volunteer on the way' : 'Picked up'}</span>`;
    const details = `${numberOf(d.people)} people · Prepared ${esc(dateString(d.madeAt))}`;
    const location = [d.area, d.city].filter(Boolean).map(esc).join(', ');
    const mapLink = volunteerView && d.coords && Number.isFinite(d.coords.lat) && Number.isFinite(d.coords.lon)
      ? `<a class="distance-label" href="https://maps.google.com/?q=${d.coords.lat},${d.coords.lon}" target="_blank" rel="noopener noreferrer">Open pickup map ↗</a>` : '';
    const action = volunteerView && d.status === 'open'
      ? `<button class="button button-primary button-small" type="button" data-action="accept" data-id="${esc(d.id)}">Accept pickup</button>`
      : d.status === 'accepted' && d.volunteerId === user.id && !volunteerView
        ? `<button class="button button-outline button-small" type="button" data-action="complete" data-id="${esc(d.id)}">Mark picked up</button>`
        : '';
    return `<article class="listing-card"><div class="listing-main"><span class="food-icon" aria-hidden="true">◉</span><div class="listing-copy"><h3>${esc(d.food)}</h3><p>${details}<br>${volunteerView ? `Pickup at ${location}` : (location ? `Pickup · ${location}` : '')}${volunteerView && owner ? ` · ${esc(owner.restaurantName)}` : ''}</p></div></div><div class="listing-action">${dist != null ? `<span class="distance-label">${dist < 1 ? `${Math.max(1,Math.round(dist*1000))} m away` : `${dist.toFixed(1)} km away`}</span>` : state}${mapLink}${action}</div></article>`;
  }
  function restaurantDashboard(user) {
    const own = donations().filter(d => d.restaurantId === user.id).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    const openOwn = own.filter(d => d.status === 'open').length;
    const totalMeals = own.reduce((sum,d) => sum + Number(d.people || 0), 0);
    return `<div class="dashboard"><div class="welcome-line"><div><p class="eyebrow">Your community, nearby</p><h1>Good to see you, ${esc(user.name.split(' ')[0])}.</h1></div><p>Pickup spot · ${esc(user.area)}${user.city ? `, ${esc(user.city)}` : ''}</p></div>
      <div class="dashboard-grid"><section class="donate-card"><div><div class="donate-card-label"><span></span>For ${esc(user.restaurantName)}</div><h2>Got good food to share?</h2><p>Post what’s ready and we’ll make it visible to nearby volunteers in this preview.</p></div><div class="donate-card-bottom"><button class="button button-lime" type="button" data-action="open-donate">Donate food <span class="button-arrow">→</span></button><span class="tiny-note">Add the food, serving estimate, and preparation time. A volunteer can accept the pickup.</span></div></section>
      <aside class="impact-card"><span class="card-label">Your Goodplate so far</span><div class="impact-number"><strong>${numberOf(totalMeals)}</strong><span>estimated servings shared</span></div><div class="impact-foot">${openOwn ? `${openOwn} open pickup${openOwn === 1 ? '' : 's'} waiting for a neighbour.` : own.length ? 'Thanks for sharing with your neighbourhood.' : 'Your first donation can start right here.'}</div></aside></div>
      <section class="content-section"><div class="content-heading"><div><h2>Your food offers</h2><p>Pickup status and handoff details.</p></div><span class="count-pill">${own.length}</span></div>${own.length ? `<div class="listing-list">${own.map(d => donationCard(d,user)).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">♡</span><h3>Your first food offer will show up here.</h3><p>Share a fresh surplus meal and nearby volunteers can accept the pickup.</p></div>`}</section>
      <div class="demo-message"><strong>Neighbourhood preview.</strong> Profiles and pickups save in this browser. Nearby volunteers will see new offers here; background WhatsApp or SMS alerts need a connected messaging service.</div>
    </div>`;
  }
  function volunteerDashboard(user) {
    const nearby = nearbyForVolunteer(user);
    const accepted = donations().filter(d => d.volunteerId === user.id && d.status !== 'open').sort((a,b) => b.createdAt.localeCompare(a.createdAt));
    const radius = Number(user.radiusKm) || 10;
    const radiusOptions = [2,5,10,20,50].map(n => `<option value="${n}" ${radius === n ? 'selected' : ''}>${n} km</option>`).join('');
    return `<div class="dashboard"><div class="welcome-line"><div><p class="eyebrow">Your community, nearby</p><h1>Hi, ${esc(user.name.split(' ')[0])}. Ready to lend a hand?</h1></div><span class="status-label open">Available for pickups</span></div>
      <section class="volunteer-top"><p class="eyebrow">A good match starts close by</p><h2>Food offers around you.</h2><p>Accept a pickup to let the restaurant know you’re on your way. Distance is estimated from the location each person shared.</p></section>
      <section class="content-section"><div class="content-heading with-controls"><div><h2>Available pickups <span class="count-pill">${nearby.length}</span></h2><p>Fresh offers within your pickup radius.</p></div><label class="radius-control" for="radius-select">Show me within <select id="radius-select" aria-label="Pickup radius">${radiusOptions}</select></label></div>${nearby.length ? `<div class="listing-list">${nearby.map(d => donationCard(d,user,true)).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">⌖</span><h3>No offers within ${radius} km right now.</h3><p>When a local restaurant posts food, it will appear here. Widen your pickup radius or check back soon.</p></div>`}</section>
      <section class="content-section"><div class="content-heading"><div><h2>Your accepted pickups</h2><p>Offers you’ve accepted and their current status.</p></div><span class="count-pill">${accepted.length}</span></div>${accepted.length ? `<div class="listing-list">${accepted.map(d => donationCard(d,user,true)).join('')}</div>` : `<div class="empty-state"><span class="empty-icon">↗</span><h3>No pickups accepted yet.</h3><p>Once you accept a nearby offer, it will be listed here.</p></div>`}</section>
      <div class="demo-message"><strong>Preview notifications.</strong> Offer updates are saved in this browser only. WhatsApp or SMS pings need a server and messaging provider.</div>
    </div>`;
  }

  function render() {
    const user = currentUser();
    setHeader(user);
    if (user?.role === 'restaurant') main.innerHTML = restaurantDashboard(user);
    else if (user?.role === 'volunteer') main.innerHTML = volunteerDashboard(user);
    else main.innerHTML = localStorage.getItem(KEYS.route) === 'signin' ? authPage('signin') : localStorage.getItem(KEYS.route) === 'signup' ? authPage('signup') : guestPage();
  }

  function go(route) {
    localStorage.setItem(KEYS.route, route);
    if (route === 'signup') role = 'restaurant';
    pendingCoords = null;
    dialogRoot.innerHTML = '';
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getGPS(statusEl, onSuccess) {
    if (!navigator.geolocation) { if (statusEl) statusEl.textContent = 'Location is not available in this browser.'; return; }
    if (statusEl) { statusEl.classList.remove('is-set'); statusEl.textContent = 'Finding your location…'; }
    navigator.geolocation.getCurrentPosition(position => {
      pendingCoords = { lat: position.coords.latitude, lon: position.coords.longitude };
      if (statusEl) { statusEl.textContent = `Location tagged · ${pendingCoords.lat.toFixed(4)}, ${pendingCoords.lon.toFixed(4)}`; statusEl.classList.add('is-set'); }
      if (onSuccess) onSuccess(pendingCoords);
    }, error => {
      pendingCoords = null;
      if (statusEl) statusEl.textContent = error.code === 1 ? 'Location permission was not granted. Allow it in your browser and try again.' : 'Could not get your location. Check GPS access and try again.';
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  function showDonateModal() {
    const user = currentUser();
    if (!canDonate(user)) { go('signin'); return; }
    const now = localDateTimeValue(new Date());
    dialogRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="donate-title"><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button><p class="eyebrow">A little extra can go a long way</p><h2 id="donate-title">Add a food offer</h2><p class="modal-intro">A few clear details help a nearby volunteer plan a quick pickup.</p>
      <form id="donate-form" novalidate><div class="form-grid"><div class="field field-full"><label for="food-name">What food is available?</label><input id="food-name" name="food" placeholder="e.g. Vegetable rice and dal" maxlength="90" required /></div><div class="field"><label for="food-people">Approx. servings</label><input id="food-people" name="people" type="number" min="1" max="5000" step="1" placeholder="e.g. 12" required /></div><div class="field"><label for="food-made">When was it prepared?</label><input id="food-made" name="madeAt" type="datetime-local" value="${now}" required /></div><div class="field field-full"><label for="food-notes">Pickup notes <span style="font-weight:400;color:#8a948b">(optional)</span></label><textarea id="food-notes" name="notes" maxlength="240" placeholder="Packaging, entrance, or best time to arrive"></textarea></div><div class="field field-full"><label>Tagged pickup spot</label><div class="gps-row"><span class="gps-status is-set">⌖ ${esc(user.area)}${user.city ? ` · ${esc(user.city)}` : ''}</span><span class="field-hint">From your verified restaurant profile.</span></div></div></div><p id="donate-error" class="error-message" role="alert"></p><div class="form-actions"><button class="button button-primary button-wide" type="submit">Share this food offer <span class="button-arrow">→</span></button></div><p class="modal-footnote">This preview notifies nearby volunteers in the app. No WhatsApp or SMS will be sent.</p></form></section></div>`;
    $('#food-name', dialogRoot).focus();
  }

  function showAlerts() {
    const user = currentUser();
    const relevant = donations().filter(d => (user.role === 'restaurant' && d.restaurantId === user.id) || (user.role === 'volunteer' && d.volunteerId === user.id)).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);
    const rows = relevant.map(d => {
      const volunteer = accountById(d.volunteerId);
      const title = user.role === 'restaurant' ? (volunteer ? `${volunteer.name} accepted your pickup` : `Food offer: ${d.food}`) : `${d.food} pickup update`;
      const body = d.status === 'open' ? 'Your offer is visible to nearby volunteers.' : `${d.status === 'accepted' ? 'On the way' : 'Picked up'} · ${dateString(d.updatedAt || d.createdAt)}`;
      return `<div class="alert-item"><span class="alert-bullet">${d.status === 'open' ? '⌖' : '✓'}</span><div class="alert-copy"><strong>${esc(title)}</strong><p>${esc(body)}</p></div></div>`;
    }).join('');
    const nearbyRows = user.role === 'volunteer' ? nearbyForVolunteer(user).slice(0, 5).map(d => `<div class="alert-item"><span class="alert-bullet">⌖</span><div class="alert-copy"><strong>New nearby offer: ${esc(d.food)}</strong><p>${d.distanceKm == null ? 'In your area' : `${d.distanceKm.toFixed(1)} km away`} · ${esc(accountById(d.restaurantId)?.restaurantName || 'Local restaurant')}</p></div></div>`).join('') : '';
    dialogRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="alerts-title"><button class="modal-close" type="button" data-action="close-modal" aria-label="Close">×</button><p class="eyebrow">In-app updates</p><h2 id="alerts-title">Your pickup activity</h2><p class="modal-intro">Updates from your Goodplate offers on this device.</p>${nearbyRows}${rows || (!nearbyRows ? `<div class="empty-state"><span class="empty-icon">♡</span><h3>All caught up.</h3><p>New offer and pickup updates will show here.</p></div>` : '')}<p class="modal-footnote">Text and WhatsApp alerts are not active in this preview.</p></section></div>`;
  }

  async function passwordDigest(password, saltText) {
    if (!globalThis.crypto?.subtle) throw new Error('Use a modern browser on a secure connection to create an account.');
    const salt = saltText ? Uint8Array.from(atob(saltText), c => c.charCodeAt(0)) : crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 120000, hash: 'SHA-256' }, key, 256);
    const hash = btoa(String.fromCharCode(...new Uint8Array(bits)));
    return { salt: saltText || btoa(String.fromCharCode(...salt)), hash };
  }

  async function submitSignup(form) {
    const fd = new FormData(form);
    const error = $('#signup-error');
    const name = fd.get('name')?.trim();
    const restaurantName = fd.get('restaurantName')?.trim();
    const email = fd.get('email')?.trim().toLowerCase();
    const password = fd.get('password') || '';
    const phone = fd.get('phone')?.trim();
    const area = fd.get('area')?.trim();
    const file = fd.get('proof');
    if (!name || (role === 'restaurant' && !restaurantName) || !email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !phone || !area) { error.textContent = 'Please complete each required field with a valid email and a password of at least 8 characters.'; return; }
    if (!pendingCoords) { error.textContent = 'Tag your GPS location before creating your account.'; return; }
    if (role === 'restaurant' && (!file || !file.name)) { error.textContent = 'Please choose a restaurant proof document or photo.'; return; }
    if (accounts().some(a => a.email === email)) { error.textContent = 'An account with this email already exists on this device. Sign in instead.'; return; }
    const city = area.split(',').map(x => x.trim()).slice(-1)[0] || '';
    let credential;
    try { credential = await passwordDigest(password); } catch (e) { error.textContent = e.message; return; }
    const user = { id: makeId(), role, name, restaurantName: role === 'restaurant' ? restaurantName : null, email, passwordSalt: credential.salt, passwordHash: credential.hash, phone, area, city, coords: pendingCoords, radiusKm: 10, proofName: role === 'restaurant' ? file.name : null, createdAt: new Date().toISOString() };
    const data = accounts(); data.push(user); write(KEYS.accounts, data);
    localStorage.removeItem(KEYS.route); setSession(user);
    notify(`Welcome to Goodplate, ${role === 'restaurant' ? restaurantName : name}.`);
  }

  async function submitSignin(form) {
    const fd = new FormData(form), error = $('#signin-error');
    const email = fd.get('email')?.trim().toLowerCase(), password = fd.get('password') || '';
    const user = accounts().find(a => a.email === email);
    let credentialsMatch = false;
    try { if (user?.passwordSalt && user?.passwordHash) credentialsMatch = (await passwordDigest(password, user.passwordSalt)).hash === user.passwordHash; } catch { credentialsMatch = false; }
    if (!user || !credentialsMatch) { error.textContent = 'We couldn’t find those sign-in details on this device. Check them or create an account.'; return; }
    localStorage.removeItem(KEYS.route); setSession(user); notify(`Welcome back, ${user.name.split(' ')[0]}.`);
  }

  function submitDonation(form) {
    const user = currentUser(), fd = new FormData(form), error = $('#donate-error');
    const food = fd.get('food')?.trim(), people = Number(fd.get('people')), madeAt = new Date(fd.get('madeAt'));
    if (!food || food.length > 90 || !Number.isInteger(people) || people < 1 || people > 5000 || Number.isNaN(madeAt.valueOf())) { error.textContent = 'Add a food description, a serving count from 1 to 5,000, and a valid preparation time.'; return; }
    const item = { id: makeId(), restaurantId: user.id, food, people, madeAt: madeAt.toISOString(), notes: fd.get('notes')?.trim() || '', area: user.area, city: user.city, coords: user.coords, status: 'open', volunteerId: null, createdAt: new Date().toISOString() };
    const data = donations(); data.push(item); write(KEYS.donations, data); dialogRoot.innerHTML = '';
    const count = matchingVolunteers(item).length;
    render();
    notify(count ? `Offer shared. ${count} nearby volunteer${count === 1 ? '' : 's'} can see it in their Goodplate preview.` : 'Offer shared. Nearby volunteers will see it in their Goodplate preview.');
  }

  function acceptDonation(id) {
    const user = currentUser();
    if (user?.role !== 'volunteer') { go('signin'); return; }
    const data = donations(), item = data.find(d => d.id === id);
    if (!item || item.status !== 'open') { notify('This pickup has already been accepted.'); render(); return; }
    item.status = 'accepted'; item.volunteerId = user.id; item.updatedAt = new Date().toISOString(); write(KEYS.donations, data);
    render(); notify('Pickup accepted. The restaurant can see that you’re on the way in this preview.');
  }

  function completeDonation(id) {
    const data = donations(), item = data.find(d => d.id === id), user = currentUser();
    if (!item || item.volunteerId !== user?.id) return;
    item.status = 'picked_up'; item.updatedAt = new Date().toISOString(); write(KEYS.donations, data); render(); notify('Pickup marked complete. Thank you for lending a hand.');
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'signup' || action === 'signin') go(action);
    else if (action === 'set-role') { role = button.dataset.role; pendingCoords = null; render(); }
    else if (action === 'get-gps') getGPS($('#gps-status'));
    else if (action === 'donate-gate') { if (currentUser()) showDonateModal(); else go('signin'); }
    else if (action === 'open-donate') showDonateModal();
    else if (action === 'notifications') showAlerts();
    else if (action === 'close-modal') { if (event.target.classList.contains('modal-backdrop') || button.classList.contains('modal-close')) dialogRoot.innerHTML = ''; }
    else if (action === 'accept') acceptDonation(button.dataset.id);
    else if (action === 'complete') completeDonation(button.dataset.id);
    else if (action === 'signout') signOut();
  });

  document.addEventListener('submit', event => {
    if (event.target.id === 'signup-form') { event.preventDefault(); void submitSignup(event.target); }
    else if (event.target.id === 'signin-form') { event.preventDefault(); void submitSignin(event.target); }
    else if (event.target.id === 'donate-form') { event.preventDefault(); submitDonation(event.target); }
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'proof-file') {
      const file = event.target.files?.[0];
      const text = $('#upload-name');
      if (text && file) text.textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
    }
    if (event.target.id === 'radius-select') {
      const user = currentUser();
      if (!user || user.role !== 'volunteer') return;
      user.radiusKm = Number(event.target.value);
      write(KEYS.accounts, accounts().map(a => a.id === user.id ? user : a));
      render();
    }
  });

  window.addEventListener('storage', event => {
    if (Object.values(KEYS).includes(event.key)) render();
  });
  render();
})();
