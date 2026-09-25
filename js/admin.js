/* Dashboard: posts updates and event markers through the Google Apps Script
   (config.liveProxy), which stores them in a Google Sheet. */
(function () {
  'use strict';

  const state = { proxy: '', password: '', data: { updates: [], markers: [] }, pickFor: 'u-loc' };
  const $ = (id) => document.getElementById(id);

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
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
    toast.timer = setTimeout(() => { node.hidden = true; }, isError ? 5000 : 2600);
  }

  const store = {
    get() {
      try { return sessionStorage.getItem('dash-pw') || localStorage.getItem('dash-pw') || ''; } catch (e) { return ''; }
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
    if (!body.ok) throw new Error(body.error || 'Request failed');
    return body;
  }

  async function loadData() {
    const sep = state.proxy.includes('?') ? '&' : '?';
    const res = await fetch(state.proxy + sep + 'action=data&t=' + Date.now());
    const body = await res.json();
    state.data = { updates: body.updates || [], markers: body.markers || [] };
    renderLists();
    renderExisting();
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
    await loadData().catch(() => toast('Could not load existing updates and markers.', true));
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

  // ---------- tabs ----------

  function setupTabs() {
    document.querySelectorAll('[role=tab]').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('[role=tab]').forEach((t) => t.setAttribute('aria-selected', String(t === tab)));
      document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== tab.dataset.tab; });
      state.pickFor = tab.dataset.tab === 'marker' ? 'm-loc' : 'u-loc';
      $('map-hint').hidden = tab.dataset.tab === 'manage';
      syncPin();
    }));
  }

  // ---------- map for picking locations ----------

  const map = L.map('admin-map', { minZoom: 4, maxBounds: [[-5, 20], [25, 60]] }).setView([9.1, 40.5], 6);
  L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}', {
    subdomains: '0123', maxZoom: 20, attribution: 'Map data &copy; Google'
  }).addTo(map);
  map.attributionControl.setPrefix(false);
  const existingLayer = L.layerGroup().addTo(map);
  const pin = L.marker([0, 0], {
    draggable: true,
    icon: L.divIcon({ className: '', html: '<div class="pick-pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] })
  });

  function parseLoc(value) {
    const m = String(value).match(/(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)/);
    if (!m) return null;
    const lat = +m[1];
    const lng = +m[2];
    return lat >= -5 && lat <= 25 && lng >= 20 && lng <= 60 ? { lat, lng } : null;
  }

  function setLoc(latlng) {
    $(state.pickFor).value = latlng.lat.toFixed(5) + ', ' + latlng.lng.toFixed(5);
    syncPin();
  }

  function syncPin() {
    const loc = parseLoc($(state.pickFor).value);
    if (loc) pin.setLatLng(loc).addTo(map);
    else map.removeLayer(pin);
  }

  function setupMap() {
    map.on('click', (e) => setLoc(e.latlng));
    pin.on('dragend', () => setLoc(pin.getLatLng()));
    ['u-loc', 'm-loc'].forEach((id) => $(id).addEventListener('input', syncPin));
    document.querySelectorAll('[data-clear]').forEach((b) => b.addEventListener('click', () => {
      $(b.dataset.clear).value = '';
      syncPin();
    }));

    fetch('data/regions.geojson').then((r) => r.json()).then((data) => {
      L.geoJSON(data, { interactive: false, style: { color: '#4a5261', weight: 1.2, dashArray: '5 4', fill: false } }).addTo(map);
    }).catch(() => {});

    // Town search to jump around the map quickly.
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

  function renderExisting() {
    existingLayer.clearLayers();
    state.data.markers.forEach((m) => {
      if (!isFinite(m.lat) || !isFinite(m.lng)) return;
      L.circleMarker([m.lat, m.lng], {
        radius: 6, color: '#0f1115', weight: 1.5, fillColor: eventColor(m.type), fillOpacity: 0.9, bubblingMouseEvents: false
      }).bindTooltip(m.title).addTo(existingLayer);
    });
  }

  // ---------- forms ----------

  function pad(n) { return String(n).padStart(2, '0'); }
  function nowLocal() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  async function submit(form, work) {
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    try {
      await work();
      await loadData().catch(() => {});
    } catch (err) {
      toast(err.message, true);
    } finally {
      btn.disabled = false;
    }
  }

  function setupForms() {
    const select = $('m-type');
    EVENT_TYPES.forEach((t) => select.append(el('option', { value: t.id, text: t.id })));
    $('u-date').value = nowLocal();
    $('m-date').value = nowLocal().slice(0, 10);
    $('u-text').addEventListener('input', () => { $('u-count').textContent = $('u-text').value.length; });

    $('update-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submit(e.target, async () => {
        const loc = parseLoc($('u-loc').value);
        if ($('u-loc').value.trim() && !loc) throw new Error('The location should look like "11.6, 37.4" and be inside the map area.');
        await call('addUpdate', { item: {
          text: $('u-text').value,
          date: new Date($('u-date').value).toISOString(),
          lat: loc ? loc.lat : '', lng: loc ? loc.lng : '',
          zoom: $('u-zoom').value
        } });
        e.target.reset();
        $('u-date').value = nowLocal();
        $('u-zoom').value = 10;
        $('u-count').textContent = '0';
        syncPin();
        toast('Update posted. It shows on the site the next time the page loads.');
      });
    });

    $('marker-form').addEventListener('submit', (e) => {
      e.preventDefault();
      submit(e.target, async () => {
        const loc = parseLoc($('m-loc').value);
        if (!loc) throw new Error('Choose a location: click the map, or type it like "11.6, 37.4".');
        await call('addMarker', { item: {
          title: $('m-title').value,
          type: $('m-type').value,
          date: $('m-date').value,
          lat: loc.lat, lng: loc.lng,
          description: $('m-desc').value,
          source: $('m-source').value
        } });
        const type = $('m-type').value;
        e.target.reset();
        $('m-type').value = type;
        $('m-date').value = nowLocal().slice(0, 10);
        syncPin();
        toast('Marker added. It shows on the site the next time the page loads.');
      });
    });

    $('refresh').addEventListener('click', () => loadData().then(() => toast('Refreshed.')).catch((err) => toast(err.message, true)));
  }

  // ---------- manage ----------

  function formatDate(value, withTime) {
    const d = new Date(value);
    if (isNaN(d)) return String(value);
    const opts = { year: 'numeric', month: 'short', day: 'numeric' };
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString(undefined, opts);
  }

  function deleteButton(sheet, item, label) {
    return el('button', {
      class: 'btn danger', type: 'button', text: 'Delete',
      onclick: async (e) => {
        if (!confirm('Delete "' + label + '"? This cannot be undone.')) return;
        e.target.disabled = true;
        try {
          await call('delete', { sheet, id: item.id });
          toast('Deleted.');
          await loadData();
        } catch (err) {
          toast(err.message, true);
          e.target.disabled = false;
        }
      }
    });
  }

  function renderLists() {
    const updates = $('list-updates');
    const markers = $('list-markers');
    updates.textContent = '';
    markers.textContent = '';
    const byDate = (a, b) => (a.date < b.date ? 1 : -1);
    const u = state.data.updates.slice().sort(byDate);
    const m = state.data.markers.slice().sort(byDate);
    if (!u.length) updates.append(el('li', { class: 'empty', text: 'No updates yet.' }));
    if (!m.length) markers.append(el('li', { class: 'empty', text: 'No markers yet.' }));
    u.forEach((item) => updates.append(el('li', {}, [
      el('div', { class: 'body' }, [
        el('div', { class: 'meta', text: formatDate(item.date, true) + (item.location ? ' · has location' : '') }),
        el('p', { text: item.text })
      ]),
      deleteButton('Updates', item, item.text.slice(0, 60))
    ])));
    m.forEach((item) => {
      const dot = el('span', { class: 'swatch point' });
      dot.style.background = eventColor(item.type);
      markers.append(el('li', {}, [
        el('div', { class: 'body' }, [
          el('div', { class: 'meta' }, [dot, item.type + ' · ' + formatDate(item.date)]),
          el('p', {
            text: item.title,
            style: 'cursor:pointer',
            title: 'Show on the map',
            onclick: () => map.setView([item.lat, item.lng], 11)
          })
        ]),
        deleteButton('Markers', item, item.title)
      ]));
    });
  }

  // ---------- boot ----------

  async function init() {
    setupLogin();
    setupTabs();
    setupMap();
    setupForms();
    let config = {};
    try { config = await (await fetch('data/config.json', { cache: 'no-cache' })).json(); } catch (e) { /* handled below */ }
    state.proxy = config.liveProxy || '';
    if (!state.proxy) {
      $('setup-hint').textContent = 'The dashboard needs the Google Apps Script set up first (see "Live data" in the README), with its URL in data/config.json as "liveProxy".';
      $('setup-hint').hidden = false;
      $('login-form').querySelector('button[type=submit]').disabled = true;
      return;
    }
    const saved = store.get();
    if (saved) {
      try { await login(saved, !!localStorage.getItem('dash-pw')); } catch (e) { store.clear(); }
    }
  }

  init();
})();
