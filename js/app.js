/* DeepState ET: renders a Google My Maps export (data/map.kml) as a situation map. */
(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    title: 'DeepState ET',
    googleMyMapsId: '',
    center: [9.1, 40.5],
    zoom: 6,
    legend: []
  };

  const state = {
    config: DEFAULT_CONFIG,
    groups: [],        // { name, layer, features: [{ feature, layer }], visible }
    searchIndex: [],   // { name, group, layer }
    regionsLayer: null,
    regionLabels: null
  };

  // ---------- helpers ----------

  async function fetchJSON(url, fallback) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) return fallback;
      return await res.json();
    } catch (e) {
      return fallback;
    }
  }

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

  function formatDate(value, withTime) {
    const d = new Date(value);
    if (isNaN(d)) return String(value);
    const opts = { year: 'numeric', month: 'short', day: 'numeric' };
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleString(undefined, opts);
  }

  // Descriptions from My Maps can contain HTML. Keep a small safe subset.
  const ALLOWED_TAGS = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'BR', 'P', 'UL', 'OL', 'LI', 'A', 'IMG', 'SPAN', 'DIV']);
  function sanitize(html) {
    const doc = new DOMParser().parseFromString('<div>' + String(html) + '</div>', 'text/html');
    const walk = (node) => {
      for (const child of Array.from(node.children)) {
        if (!ALLOWED_TAGS.has(child.tagName)) {
          child.replaceWith(document.createTextNode(child.textContent));
          continue;
        }
        for (const attr of Array.from(child.attributes)) {
          const keep = (child.tagName === 'A' && attr.name === 'href') ||
                       (child.tagName === 'IMG' && attr.name === 'src');
          if (!keep || !/^https?:/i.test(attr.value.trim())) child.removeAttribute(attr.name);
        }
        if (child.tagName === 'A') { child.target = '_blank'; child.rel = 'noopener noreferrer'; }
        walk(child);
      }
    };
    const root = doc.body.firstChild;
    walk(root);
    // Plain-text descriptions: turn bare URLs into links and keep line breaks.
    if (!root.children.length) {
      const text = root.textContent;
      root.textContent = '';
      text.split(/(https?:\/\/[^\s<]+)/g).forEach((part, i) => {
        if (i % 2) root.append(el('a', { href: part, target: '_blank', rel: 'noopener noreferrer', text: part }));
        else part.split('\n').forEach((line, j) => { if (j) root.append(el('br')); root.append(line); });
      });
    }
    return root.innerHTML;
  }

  // ---------- styling ----------

  function num(v, fallback) {
    const n = parseFloat(v);
    return isNaN(n) ? fallback : n;
  }

  function pathStyle(p) {
    return {
      color: p.stroke || '#e5484d',
      weight: Math.max(1, num(p['stroke-width'], 2)),
      opacity: num(p['stroke-opacity'], 1),
      fillColor: p.fill || p.stroke || '#e5484d',
      fillOpacity: num(p['fill-opacity'], 0.35)
    };
  }

  function pointColor(p) {
    return p['icon-color'] || p['marker-color'] || p.stroke || '#e5484d';
  }

  function geometryKind(feature) {
    const t = feature.geometry && feature.geometry.type;
    if (!t) return null;
    if (/Point/.test(t)) return 'point';
    if (/LineString/.test(t)) return 'line';
    if (/Polygon/.test(t)) return 'polygon';
    return 'polygon'; // GeometryCollection etc.
  }

  function styleKey(feature) {
    const p = feature.properties || {};
    const kind = geometryKind(feature);
    if (kind === 'point') return 'point|' + pointColor(p);
    if (kind === 'line') return 'line|' + (p.stroke || '');
    return 'polygon|' + (p.fill || p.stroke || '');
  }

  function swatch(kind, color) {
    const s = el('span', { class: 'swatch ' + (kind === 'polygon' ? '' : kind) });
    s.style.background = color;
    if (kind === 'polygon') s.style.borderColor = color;
    return s;
  }

  // ---------- map setup ----------

  const map = L.map('map', {
    zoomControl: true,
    worldCopyJump: true,
    minZoom: 4,
    maxBounds: [[-5, 20], [25, 60]],
    preferCanvas: false
  });

  const GOOGLE_ATTR = 'Map data &copy; Google';
  const googleTiles = (lyrs) => L.tileLayer('https://mt{s}.google.com/vt/lyrs=' + lyrs + '&hl=en&x={x}&y={y}&z={z}', {
    subdomains: '0123', maxZoom: 20, attribution: GOOGLE_ATTR
  });
  const BASEMAPS = {
    'google-roadmap': { label: 'Google Maps', layer: googleTiles('m') },
    'google-hybrid': { label: 'Google Satellite (labels)', layer: googleTiles('y') },
    'google-satellite': { label: 'Google Satellite', layer: googleTiles('s') },
    'google-terrain': { label: 'Google Terrain', layer: googleTiles('p') },
    'dark': {
      label: 'Dark',
      layer: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        subdomains: 'abcd',
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
      })
    }
  };
  let currentBasemap = null;
  function setBasemap(key) {
    if (!BASEMAPS[key]) key = 'google-roadmap';
    if (currentBasemap) map.removeLayer(currentBasemap);
    currentBasemap = BASEMAPS[key].layer.addTo(map);
    currentBasemap.bringToBack();
    document.body.classList.toggle('light-basemap', key === 'google-roadmap' || key === 'google-terrain');
    document.getElementById('basemap-select').value = key;
    try { localStorage.setItem('basemap', key); } catch (e) { /* storage unavailable */ }
  }
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  const CoordControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd() {
      this._div = L.DomUtil.create('div', 'coord-readout');
      this._div.hidden = true;
      return this._div;
    },
    update(latlng) {
      this._div.hidden = !latlng;
      if (latlng) this._div.textContent = latlng.lat.toFixed(4) + ', ' + latlng.lng.toFixed(4);
    }
  });
  const coords = new CoordControl().addTo(map);
  map.on('mousemove', (e) => coords.update(e.latlng));
  map.on('mouseout', () => coords.update(null));

  const basemapSelect = document.getElementById('basemap-select');
  for (const [key, b] of Object.entries(BASEMAPS)) basemapSelect.append(el('option', { value: key, text: b.label }));
  basemapSelect.addEventListener('change', () => setBasemap(basemapSelect.value));

  // URL hash keeps the current view shareable: #zoom/lat/lng
  function readHash() {
    const m = location.hash.match(/^#(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/);
    return m ? { zoom: +m[1], center: [+m[2], +m[3]] } : null;
  }
  function writeHash() {
    const c = map.getCenter();
    history.replaceState(null, '', '#' + map.getZoom() + '/' + c.lat.toFixed(4) + '/' + c.lng.toFixed(4));
  }
  map.on('moveend', writeHash);

  // ---------- regions ----------

  async function loadRegions() {
    const data = await fetchJSON('data/regions.geojson', null);
    if (!data) return;
    state.regionsLayer = L.geoJSON(data, {
      interactive: false,
      style: { color: '#5b6472', weight: 1.2, opacity: 0.7, dashArray: '4 4', fill: false }
    });
    // City-regions are tiny, so only label them once zoomed in.
    const small = new Set(['ET-AA', 'ET-DD', 'ET-HA']);
    state.regionLabels = L.layerGroup(data.features.filter((f) => !small.has(f.properties.iso)).map((f) => {
      const center = L.geoJSON(f).getBounds().getCenter();
      return L.tooltip({ permanent: true, direction: 'center', className: 'region-label', interactive: false })
        .setLatLng(center).setContent(f.properties.name);
    }));
    state.regionsLayer.addTo(map);
    updateRegionLabels();
    map.on('zoomend', updateRegionLabels);
    document.getElementById('toggle-regions').addEventListener('change', (e) => {
      if (e.target.checked) state.regionsLayer.addTo(map); else map.removeLayer(state.regionsLayer);
      updateRegionLabels();
    });
  }

  function updateRegionLabels() {
    if (!state.regionLabels) return;
    const show = document.getElementById('toggle-regions').checked && map.getZoom() >= 5 && map.getZoom() <= 8;
    if (show) state.regionLabels.addTo(map); else map.removeLayer(state.regionLabels);
  }

  // ---------- KML loading ----------

  async function parseKmlSource(source) {
    // source: { url } or { file }
    let buffer;
    if (source.file) {
      buffer = await source.file.arrayBuffer();
    } else {
      const res = await fetch(source.url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      buffer = await res.arrayBuffer();
    }
    const bytes = new Uint8Array(buffer);
    let text;
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) { // "PK": a KMZ (zip)
      const zip = await JSZip.loadAsync(buffer);
      const entry = zip.file(/\.kml$/i)[0];
      if (!entry) throw new Error('No KML inside KMZ');
      text = await entry.async('string');
    } else {
      text = new TextDecoder('utf-8').decode(bytes);
    }
    const dom = new DOMParser().parseFromString(text, 'text/xml');
    if (dom.getElementsByTagName('parsererror').length) throw new Error('Invalid KML');
    const docName = dom.querySelector('Document > name');
    return { tree: toGeoJSON.kmlWithFolders(dom), name: docName ? docName.textContent.trim() : '' };
  }

  // Flatten the folder tree into one group per My Maps layer.
  function collectGroups(tree, fallbackName) {
    const groups = [];
    const loose = [];
    const visit = (node, path) => {
      for (const child of node.children || []) {
        if (child.type === 'folder') {
          const name = (child.meta && child.meta.name) || 'Untitled layer';
          const full = path ? path + ' / ' + name : name;
          const features = [];
          const inner = { children: [] };
          for (const c of child.children || []) (c.type === 'Feature' ? features : inner.children).push(c);
          if (features.length) groups.push({ name: full, features });
          visit(inner, full);
        } else if (child.type === 'Feature') {
          loose.push(child);
        }
      }
    };
    visit(tree, '');
    if (loose.length) groups.unshift({ name: fallbackName || 'Map', features: loose });
    return groups;
  }

  // Properties that come from KML styling or structure rather than My Maps data columns.
  const INTERNAL_PROPS = /^(name|description|styleUrl|styleHash|styleMap|stroke|stroke-opacity|stroke-width|fill|fill-opacity|icon|icon-color|icon-opacity|icon-scale|icon-heading|icon-offset|icon-offset-units|label-scale|label-color|label-opacity|visibility|timespan|timestamp|gx_media_links|marker-color)$/i;
  function dataFields(p) {
    return Object.entries(p)
      .filter(([k, v]) => !INTERNAL_PROPS.test(k) && v !== '' && v !== null && typeof v !== 'object')
      .map(([k, v]) => [k, String(v)]);
  }

  function popupHtml(feature, groupName) {
    const p = feature.properties || {};
    const wrap = el('div');
    wrap.append(el('div', { class: 'layer-tag', text: groupName }));
    wrap.append(el('h3', { text: p.name || 'Untitled' }));
    const desc = p.description && (typeof p.description === 'string' ? p.description : p.description.value);
    if (desc) {
      const d = el('div', { class: 'desc' });
      d.innerHTML = sanitize(desc);
      wrap.append(d);
    }
    const fields = dataFields(p);
    if (fields.length) {
      const table = el('table', { class: 'fields' });
      fields.forEach(([k, v]) => table.append(el('tr', {}, [el('th', { text: k }), el('td', { text: v })])));
      wrap.append(table);
    }
    if (feature.geometry && feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates;
      wrap.append(el('div', { class: 'coords', text: lat.toFixed(5) + ', ' + lng.toFixed(5) }));
    }
    return wrap;
  }

  function clearGroups() {
    for (const g of state.groups) map.removeLayer(g.layer);
    state.groups = [];
    state.searchIndex = [];
  }

  function renderGroups(rawGroups) {
    clearGroups();
    // Polygons render first (bottom), then lines, then points on top.
    const panes = { polygon: 'overlayPane', line: 'overlayPane', point: 'markerPane' };
    rawGroups.forEach((g) => {
      const layer = L.featureGroup();
      const styles = new Map();
      g.features.forEach((feature) => {
        const kind = geometryKind(feature);
        if (!kind) return;
        const p = feature.properties || {};
        const gj = L.geoJSON(feature, {
          pane: panes[kind],
          style: () => (kind === 'point' ? {} : pathStyle(p)),
          pointToLayer: (f, latlng) => L.circleMarker(latlng, {
            radius: 6,
            color: '#0f1115',
            weight: 1.5,
            fillColor: pointColor(p),
            fillOpacity: 0.95
          })
        });
        gj.bindPopup(() => popupHtml(feature, g.name), { maxWidth: 320 });
        gj.addTo(layer);
        const key = styleKey(feature);
        const entry = styles.get(key) || { kind, color: key.split('|')[1] || '#e5484d', count: 0 };
        entry.count++;
        styles.set(key, entry);
        if (p.name) state.searchIndex.push({ name: String(p.name), group: g.name, layer: gj, kind, color: entry.color });
      });
      layer.addTo(map);
      labelStyles(g.features, styles);
      state.groups.push({ name: g.name, layer, count: g.features.length, styles: [...styles.values()] });
    });
    renderLayerList();
    renderLegend();
  }

  // My Maps "style by data column" gives each value its own colour, but the KML only
  // keeps the colours. Find the column whose values line up one-to-one with the
  // colours and use those values as legend labels.
  function labelStyles(features, styles) {
    if (styles.size < 2) return;
    const columns = new Map(); // column -> Map(styleKey -> Set(values))
    features.forEach((f) => {
      const key = styleKey(f);
      dataFields(f.properties || {}).forEach(([col, val]) => {
        if (!columns.has(col)) columns.set(col, new Map());
        const byStyle = columns.get(col);
        if (!byStyle.has(key)) byStyle.set(key, new Set());
        byStyle.get(key).add(val);
      });
    });
    for (const [, byStyle] of columns) {
      if (byStyle.size !== styles.size) continue;
      const labels = [...byStyle.values()];
      if (!labels.every((v) => v.size === 1)) continue;
      const flat = labels.map((v) => [...v][0]);
      if (new Set(flat).size !== flat.length) continue;
      for (const [key, vals] of byStyle) styles.get(key).label = [...vals][0];
      return;
    }
  }

  function renderLayerList() {
    const list = document.getElementById('layer-list');
    list.textContent = '';
    if (!state.groups.length) {
      list.append(el('li', { class: 'empty', text: 'No map data loaded yet.' }));
      return;
    }
    state.groups.forEach((g) => {
      const main = g.styles.slice().sort((a, b) => b.count - a.count)[0];
      const cb = el('input', { type: 'checkbox' });
      cb.checked = map.hasLayer(g.layer);
      cb.addEventListener('change', () => {
        if (cb.checked) g.layer.addTo(map); else map.removeLayer(g.layer);
      });
      const item = el('li', {}, [
        el('label', {}, [
          cb,
          main ? swatch(main.kind, main.color) : null,
          el('span', { class: 'name', text: g.name, title: g.name }),
          el('span', { class: 'count', text: String(g.count) })
        ])
      ]);
      const labelled = g.styles.filter((st) => st.label).sort((a, b) => b.count - a.count);
      if (labelled.length) {
        item.append(el('ul', { class: 'sublegend' }, labelled.map((st) => el('li', {}, [
          swatch(st.kind, st.color),
          el('span', { class: 'name', text: st.label }),
          el('span', { class: 'count', text: String(st.count) })
        ]))));
      }
      list.append(item);
    });
  }

  function renderLegend() {
    const legend = document.getElementById('legend');
    const entries = state.config.legend || [];
    legend.textContent = '';
    entries.forEach((item) => {
      legend.append(el('li', {}, [swatch(item.type || 'polygon', item.color), el('span', { text: item.label })]));
    });
    document.getElementById('legend-section').hidden = !entries.length;
  }

  function fitToData() {
    const bounds = L.latLngBounds([]);
    state.groups.forEach((g) => { if (map.hasLayer(g.layer)) bounds.extend(g.layer.getBounds()); });
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
  }

  function showNotice(html, dismissable) {
    const n = document.getElementById('notice');
    n.innerHTML = '';
    if (dismissable) n.append(el('button', { class: 'close', 'aria-label': 'Dismiss', text: '×', onclick: () => { n.hidden = true; } }));
    const body = el('div');
    body.innerHTML = html;
    n.append(body);
    n.hidden = false;
  }

  function configuredLayers() {
    const layers = state.config.layers || [];
    return layers.length ? layers : [{ id: 'map', name: 'Map' }];
  }

  // snapshot: null for the latest data, or an entry from data/history/index.json
  async function loadLayers(snapshot) {
    const layers = configuredLayers().filter((l) => !snapshot || !snapshot.layers || snapshot.layers.includes(l.id));
    const results = await Promise.all(layers.map(async (l) => {
      const url = snapshot ? 'data/history/' + snapshot.date + '/' + l.id + '.kml' : 'data/layers/' + l.id + '.kml';
      try {
        const { tree } = await parseKmlSource({ url });
        return collectGroups(tree, l.name);
      } catch (err) {
        return null;
      }
    }));
    const groups = results.filter(Boolean).flat();
    renderGroups(groups);
    if (groups.length) {
      document.getElementById('notice').hidden = true;
      return true;
    }
    const mid = state.config.googleMyMapsId;
    showNotice(
      '<b>No map data yet.</b> Layers appear once the <b>Sync map</b> GitHub Action has downloaded them' +
      (mid ? ' from <a target="_blank" rel="noopener" href="https://www.google.com/maps/d/viewer?mid=' + encodeURIComponent(mid) + '">the source map</a>' : '') +
      ' into <code>data/layers/</code>. You can also drop a <code>.kml</code>/<code>.kmz</code> export onto the map to preview it.', true);
    return false;
  }

  async function loadFile(file) {
    try {
      const { tree } = await parseKmlSource({ file });
      renderGroups(collectGroups(tree, file.name.replace(/\.km[lz]$/i, '')));
      fitToData();
      return true;
    } catch (err) {
      showNotice('Could not read <b>' + file.name.replace(/[<>&]/g, '') + '</b>: ' + err.message, true);
      return false;
    }
  }

  // ---------- snapshots ----------

  async function setupSnapshots(meta) {
    const select = document.getElementById('snapshot-select');
    const snapshots = await fetchJSON('data/history/index.json', []);
    select.append(el('option', { value: '', text: meta.syncedAt ? formatDate(meta.syncedAt, true) : 'Latest' }));
    snapshots.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).forEach((h) => {
      select.append(el('option', { value: h.date, text: formatDate(h.date + 'T12:00:00') }));
    });
    select.addEventListener('change', () => loadLayers(snapshots.find((h) => h.date === select.value) || null));
  }

  // ---------- updates feed ----------

  async function loadUpdates() {
    const updates = await fetchJSON('data/updates.json', []);
    const list = document.getElementById('updates');
    list.textContent = '';
    if (!updates.length) {
      list.append(el('li', {}, [el('p', { class: 'muted', text: 'No updates posted yet.' })]));
      return;
    }
    updates.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).forEach((u) => {
      const item = el('li', {}, [
        el('time', { datetime: u.date, text: formatDate(u.date, /T/.test(u.date)) }),
        el('p', { text: u.text })
      ]);
      if (Array.isArray(u.location) && u.location.length === 2) {
        item.append(el('a', {
          class: 'go', text: 'Show on map →',
          onclick: () => { map.flyTo(u.location, u.zoom || 10); closePanelOnMobile(); }
        }));
      }
      list.append(item);
    });
  }

  // ---------- search ----------

  function setupSearch() {
    const input = document.getElementById('search');
    const results = document.getElementById('search-results');
    let active = -1;
    let matches = [];

    const choose = (m) => {
      const b = m.layer.getBounds();
      if (b.isValid()) {
        if (b.getNorthEast().equals(b.getSouthWest())) map.flyTo(b.getCenter(), Math.max(map.getZoom(), 11));
        else map.flyToBounds(b, { padding: [40, 40], maxZoom: 11 });
      }
      const g = state.groups.find((x) => x.name === m.group);
      if (g && !map.hasLayer(g.layer)) { g.layer.addTo(map); renderLayerList(); }
      map.once('moveend', () => m.layer.openPopup());
      results.hidden = true;
      input.value = m.name;
      closePanelOnMobile();
    };

    const render = () => {
      results.textContent = '';
      matches.forEach((m, i) => {
        const li = el('li', { class: i === active ? 'active' : '' }, [
          swatch(m.kind, m.color),
          el('span', { text: m.name }),
          el('span', { class: 'sub', text: m.group })
        ]);
        li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(m); });
        results.append(li);
      });
      results.hidden = !matches.length;
    };

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      active = -1;
      matches = q ? state.searchIndex.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 30) : [];
      render();
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { active = Math.min(active + 1, matches.length - 1); render(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(active - 1, 0); render(); e.preventDefault(); }
      else if (e.key === 'Enter' && matches.length) choose(matches[Math.max(active, 0)]);
      else if (e.key === 'Escape') { results.hidden = true; }
    });
    input.addEventListener('blur', () => { results.hidden = true; });
  }

  // ---------- panel ----------

  const toggleBtn = document.getElementById('panel-toggle');
  function setPanel(open) {
    document.body.classList.toggle('panel-closed', !open);
    toggleBtn.setAttribute('aria-expanded', String(open));
    setTimeout(() => map.invalidateSize(), 220);
  }
  function closePanelOnMobile() {
    if (window.matchMedia('(max-width: 720px)').matches) setPanel(false);
  }
  toggleBtn.addEventListener('click', () => setPanel(document.body.classList.contains('panel-closed')));
  if (window.matchMedia('(max-width: 720px)').matches) setPanel(false);

  // ---------- drag & drop preview ----------

  function setupDrop() {
    const hint = document.getElementById('drop-hint');
    let depth = 0;
    window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; hint.hidden = false; });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; hint.hidden = true; } });
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      depth = 0; hint.hidden = true;
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (await loadFile(file)) {
        showNotice('Previewing <b>' + file.name.replace(/[<>&]/g, '') + '</b> locally. Reload the page to return to the published map.', true);
      }
    });
  }

  // ---------- boot ----------

  async function init() {
    const [config, meta] = await Promise.all([
      fetchJSON('data/config.json', {}),
      fetchJSON('data/meta.json', {})
    ]);
    state.config = Object.assign({}, DEFAULT_CONFIG, config);

    document.title = state.config.title;
    document.getElementById('site-title').textContent = state.config.title;
    const src = document.getElementById('source-link');
    if (state.config.googleMyMapsId) src.href = 'https://www.google.com/maps/d/viewer?mid=' + encodeURIComponent(state.config.googleMyMapsId);
    else src.hidden = true;

    const fromHash = readHash();
    if (fromHash) map.setView(fromHash.center, fromHash.zoom);
    else map.setView(state.config.center, state.config.zoom);

    setupSearch();
    setupDrop();
    renderLegend();
    let savedBasemap = null;
    try { savedBasemap = localStorage.getItem('basemap'); } catch (e) { /* storage unavailable */ }
    setBasemap(savedBasemap || state.config.basemap);
    await Promise.all([loadRegions(), loadUpdates(), setupSnapshots(meta)]);
    await loadLayers(null);
  }

  init();
})();
