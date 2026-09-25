/* Dashboard: publishes posts (news and events) through the Google Apps Script
   (config.liveProxy), which stores them for the map. */
(function () {
  'use strict';

  const state = { proxy: '', password: '', posts: [], type: 'update' };
  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    for (const c of [].concat(children || [])) if (c) node.append(c);
    return node;
  }

  function toast(message, isError) {
    const node = $('toast');
    node.textContent = message;
    node.classList.toggle('error', !!isError);
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, isError ? 6000 : 2600);
  }

  const store = {
    get() {
      try { return sessionStorage.getItem('dash-pw') || localStorage.getItem('dash-pw') || ''; } catch (e) { return ''; }
    },
    remembered() {
      try { return !!localStorage.getItem('dash-pw'); } catch (e) { return false; }
    },
    set(pw, remember) {
      try {
        sessionStorage.setItem('dash-pw', pw);
        if (remember) localStorage.setItem('dash-pw', pw); else localStorage.removeItem('dash-pw');
      } catch (e) { /* storage unavailable: stay logged in for this page only */ }
    },
    clear() {
      try { sessionStorage.removeItem('dash-pw'); localStorage.removeItem('dash-pw'); } catch (e) { /* ignore */ }
    }
  };

  // ---------- talking to the Apps Script ----------

  async function call(action, extra) {
    // text/plain keeps this a "simple" request, which Apps Script accepts cross-origin.
    const res = await fetch(state.proxy, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(Object.assign({ action, password: state.password }, extra || {}))
    });
    let body;
    try { body = await res.json(); } catch (e) { throw new Error('The Google script sent an unexpected reply. Is the latest version deployed?'); }
    if (!body.ok) {
      const msg = body.error || 'Request failed';
      if (/Unknown action/i.test(msg)) throw new Error('Your Google script is an older version. Paste the latest tools/live-proxy.gs and deploy a new version.');
      throw new Error(msg);
    }
    return body;
  }

  async function loadPosts() {
    const sep = state.proxy.includes('?') ? '&' : '?';
    const res = await fetch(state.proxy + sep + 'action=data&t=' + Date.now());
    const body = await res.json();
    state.posts = Array.isArray(body.posts) ? body.posts : [];
    renderPosts();
  }

  // ---------- login ----------

  async function login(password, remember) {
    state.password = password;
    await call('check');
    store.set(password, remember);
    $('login-view').hidden = true;
    $('dash-view').hidden = false;
    $('logout').hidden = false;
    setTimeout(() => map.invalidateSize(), 50);
    await loadPosts().catch(() => toast('Could not load your posts.', true));
  }

  function setupLogin() {
    $('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      btn.disabled = true;
      $('login-error').hidden = true;
      try {
        await login($('password').value, $('remember').checked);
      } catch (err) {
        $('login-error').textContent = err.message;
        $('login-error').hidden = false;
      } finally {
        btn.disabled = false;
      }
    });
    $('logout').addEventListener('click', () => {
      store.clear();
      location.reload();
    });
  }

  // ---------- map for picking locations ----------

  const map = L.map('admin-map', { minZoom: 4, maxBounds: [[-5, 20], [25, 60]] }).setView([9.1, 40.5], 6);
  L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}', {
    subdomains: '0123', maxZoom: 20, attribution: 'Map data &copy; Google'
  }).addTo(map);
  map.attributionControl.setPrefix(false);
  const postsLayer = L.layerGroup().addTo(map);
  const pin = L.marker([0, 0], { draggable: true, zIndexOffset: 1000 });

  function pinIcon() {
    return L.divIcon({ className: 'event-icon picking', html: eventIconHtml(eventType(state.type), 36), iconSize: [36, 36], iconAnchor: [18, 18] });
  }

  function parseLoc(value) {
    const m = String(value).match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const lat = +m[1];
    const lng = +m[2];
    return lat >= -5 && lat <= 25 && lng >= 20 && lng <= 60 ? { lat, lng } : null;
  }

  function setLoc(latlng) {
    $('p-loc').value = latlng.lat.toFixed(5) + ', ' + latlng.lng.toFixed(5);
    syncPin();
  }

  function syncPin() {
    const loc = parseLoc($('p-loc').value);
    if (loc) pin.setLatLng(loc).setIcon(pinIcon()).addTo(map);
    else map.removeLayer(pin);
  }

  function setupMap() {
    map.on('click', (e) => setLoc(e.latlng));
    pin.on('dragend', () => setLoc(pin.getLatLng()));
    $('p-loc').addEventListener('input', syncPin);
    $('clear-loc').addEventListener('click', () => { $('p-loc').value = ''; syncPin(); });

    fetch('data/regions.geojson').then((r) => r.json()).then((data) => {
      L.geoJSON(data, { interactive: false, style: { color: '#4a5261', weight: 1.2, dashArray: '5 4', fill: false } }).addTo(map);
    }).catch(() => {});

    let towns = [];
    fetch('data/towns.geojson').then((r) => r.json()).then((data) => {
      towns = data.features.map((f) => ({ name: f.properties.name, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }));
    }).catch(() => {});
    const input = $('town-search');
    const results = $('town-results');
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      results.textContent = '';
      const matches = q ? towns.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 8) : [];
      matches.forEach((t) => results.append(el('li', {
        text: t.name,
        onmousedown: (e) => {
          e.preventDefault();
          map.setView([t.lat, t.lng], 11);
          setLoc({ lat: t.lat, lng: t.lng });
          results.hidden = true;
          input.value = t.name;
        }
      })));
      results.hidden = !matches.length;
    });
    input.addEventListener('blur', () => { results.hidden = true; });
  }

  // ---------- the post form ----------

  function pad(n) { return String(n).padStart(2, '0'); }
  function nowLocal() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function selectType(id) {
    state.type = id;
    document.querySelectorAll('#type-grid button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.type === id)));
    $('loc-note').textContent = id === 'update' ? '(optional for news: click the map)' : '(required: click the map)';
    syncPin();
  }

  function setupForm() {
    const grid = $('type-grid');
    EVENT_TYPES.forEach((t) => grid.append(el('button', {
      type: 'button', role: 'radio', 'data-type': t.id, 'aria-checked': 'false', title: t.label,
      onclick: () => selectType(t.id)
    }, [el('span', { html: eventIconHtml(t, 30) }), el('span', { class: 'type-label', text: t.id === 'captured' ? 'Captured' : t.label })])));
    selectType('update');
    $('p-date').value = nowLocal();

    // Suggest a type from the words typed, until one is picked by hand.
    let picked = false;
    grid.addEventListener('click', () => { picked = true; });
    $('p-text').addEventListener('input', () => {
      if (picked) return;
      const guess = guessEventType({ name: $('p-text').value });
      selectType(guess ? guess.id : 'update');
    });

    $('post-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button[type=submit]');
      const loc = parseLoc($('p-loc').value);
      if ($('p-loc').value.trim() && !loc) return toast('The location should look like "13.49, 39.47" and be inside the map area.', true);
      if (state.type !== 'update' && !loc) return toast('Click the map to show where it happened.', true);
      btn.disabled = true;
      try {
        await call('addPost', { item: {
          type: state.type,
          text: $('p-text').value,
          date: new Date($('p-date').value).toISOString(),
          lat: loc ? loc.lat : '', lng: loc ? loc.lng : '',
          source: $('p-source').value
        } });
        e.target.reset();
        picked = false;
        selectType('update');
        $('p-date').value = nowLocal();
        syncPin();
        toast('Published. It shows on the site the next time the page loads.');
        await loadPosts().catch(() => {});
      } catch (err) {
        toast(err.message, true);
      } finally {
        btn.disabled = false;
      }
    });

    $('refresh').addEventListener('click', () => loadPosts().then(() => toast('Refreshed.')).catch((err) => toast(err.message, true)));
  }

  // ---------- your posts ----------

  function formatDate(value) {
    const d = new Date(value);
    if (isNaN(d)) return String(value);
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function renderPosts() {
    const list = $('post-list');
    list.textContent = '';
    postsLayer.clearLayers();
    if (!state.posts.length) {
      list.append(el('li', { class: 'empty', text: 'Nothing published yet.' }));
      return;
    }
    state.posts.forEach((post) => {
      const type = eventType(post.type) || eventType('update');
      const hasLoc = post.lat !== '' && post.lng !== '' && isFinite(post.lat) && isFinite(post.lng);
      if (hasLoc) {
        L.marker([post.lat, post.lng], {
          icon: L.divIcon({ className: 'event-icon', html: eventIconHtml(type, 26), iconSize: [26, 26], iconAnchor: [13, 13] })
        }).bindTooltip(post.text.slice(0, 80)).addTo(postsLayer);
      }
      list.append(el('li', {}, [
        el('span', { class: 'post-icon', html: eventIconHtml(type, 28) }),
        el('div', { class: 'body' }, [
          el('div', { class: 'meta', text: type.label + ' · ' + formatDate(post.date) }),
          el('p', { text: post.text }),
          hasLoc ? el('button', { type: 'button', class: 'link-btn small', text: 'Show on map', onclick: () => map.setView([post.lat, post.lng], 11) }) : null
        ]),
        el('button', {
          class: 'btn danger', type: 'button', text: 'Delete',
          onclick: async (e) => {
            if (!confirm('Delete this post? This cannot be undone.\n\n' + post.text.slice(0, 120))) return;
            e.target.disabled = true;
            try {
              await call('deletePost', { id: post.id });
              toast('Deleted.');
              await loadPosts();
            } catch (err) {
              toast(err.message, true);
              e.target.disabled = false;
            }
          }
        })
      ]));
    });
  }

  // ---------- boot ----------

  async function init() {
    setupLogin();
    setupMap();
    setupForm();
    let config = {};
    try { config = await (await fetch('data/config.json', { cache: 'no-cache' })).json(); } catch (e) { /* handled below */ }
    state.proxy = config.liveProxy || '';
    if (!state.proxy) {
      $('setup-hint').textContent = 'The dashboard needs the Google Apps Script set up first, with its URL in data/config.json as "liveProxy".';
      $('setup-hint').hidden = false;
      $('login-form').querySelector('button[type=submit]').disabled = true;
      return;
    }
    const saved = store.get();
    if (saved) {
      try { await login(saved, store.remembered()); } catch (e) { store.clear(); }
    }
  }

  init();
})();
