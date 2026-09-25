/* DeepState ET: renders Google My Maps layers (synced into data/layers/) as a situation map,
   with a timeline of daily snapshots, a change map, control statistics and reference layers. */
(function () {
  'use strict';

  const DEFAULT_CONFIG = {
    title: 'DeepState ET',
    googleMyMapsId: '',
    repo: 'nahomiscool/deepStateET',
    center: [9.1, 40.5],
    zoom: 6,
    basemap: 'google-roadmap',
    layers: [],
    legend: []
  };

  const state = {
    config: DEFAULT_CONFIG,
    lang: 'en',
    meta: {},
    timeline: [],         // [{ date, snapshot }], oldest first; snapshot null = latest files
    index: 0,             // position in timeline being viewed
    compare: 'prev',      // 'prev' or a number of days
    datasets: new Map(),  // cache: timeline key -> dataset
    current: null,        // dataset on the map
    baseline: null,       // dataset compared against
    groups: [],           // rendered groups: { name, layer, count, styles }
    records: [],          // rendered features: { key, group, feature, layer, kind, state, color, area, date }
    searchIndex: [],
    changes: [],
    posts: [],            // news and events: { id, date, type, text, lat, lng, source }
    eventDays: 0,
    embed: false,
    live: false,
    preview: false
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
      else if (k === 'html') node.innerHTML = v; // only used with our own icon markup
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v);
    }
    for (const c of [].concat(children || [])) if (c !== null && c !== undefined && c !== false) node.append(c);
    return node;
  }

  function t(key, vars) {
    const table = I18N.strings[state.lang] || I18N.strings.en;
    let s = table[key] !== undefined ? table[key] : (I18N.strings.en[key] !== undefined ? I18N.strings.en[key] : key);
    for (const [k, v] of Object.entries(vars || {})) s = s.split('{' + k + '}').join(v);
    return s;
  }

  function locale() {
    return { en: 'en-GB', am: 'am-ET', om: 'om-ET' }[state.lang] || undefined;
  }

  function formatDate(value, withTime) {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d)) return String(value);
    const opts = { year: 'numeric', month: 'short', day: 'numeric' };
    if (withTime) Object.assign(opts, { hour: '2-digit', minute: '2-digit' });
    try { return d.toLocaleString(locale(), opts); } catch (e) { return d.toLocaleString(undefined, opts); }
  }

  const dayDate = (iso) => new Date(iso + 'T12:00:00');
  const escapeText = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  function storage(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { /* storage unavailable */ }
    return null;
  }

  function toast(message) {
    const node = document.getElementById('toast');
    node.textContent = message;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, 2200);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* fall through */ }
    const area = el('textarea', { style: 'position:fixed;opacity:0' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* unsupported */ }
    area.remove();
    return ok;
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

  // ---------- i18n ----------

  function applyTranslations() {
    document.documentElement.lang = state.lang;
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((n) => { n.placeholder = t(n.dataset.i18nPlaceholder); });
    document.querySelectorAll('[data-i18n-aria]').forEach((n) => { n.setAttribute('aria-label', t(n.dataset.i18nAria)); });
  }

  function setupLanguage() {
    const select = document.getElementById('lang-select');
    for (const [code, name] of Object.entries(I18N.languages)) select.append(el('option', { value: code, text: name }));
    const fromUrl = new URLSearchParams(location.search).get('lang');
    const browser = (navigator.language || 'en').slice(0, 2);
    const chosen = [fromUrl, storage('lang'), browser, 'en'].find((c) => c && I18N.strings[c]);
    state.lang = chosen;
    select.value = chosen;
    select.addEventListener('change', () => {
      state.lang = select.value;
      storage('lang', state.lang);
      applyTranslations();
      renderAll();
    });
    applyTranslations();
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

  // Event type of a point: set by the dashboard, or guessed from a My Maps "Type" column or name.
  function pointType(p) {
    return eventType(p._type) || guessEventType(p);
  }

  function geometryKind(feature) {
    const type = feature.geometry && feature.geometry.type;
    if (!type) return null;
    if (/Point/.test(type)) return 'point';
    if (/LineString/.test(type)) return 'line';
    return 'polygon';
  }

  function featureColor(feature) {
    const p = feature.properties || {};
    const kind = geometryKind(feature);
    if (kind === 'point') {
      const type = pointType(p);
      return type ? type.color : pointColor(p);
    }
    if (kind === 'line') return p.stroke || '#e5484d';
    return p.fill || p.stroke || '#e5484d';
  }

  function styleKey(feature) {
    return geometryKind(feature) + '|' + featureColor(feature);
  }

  function swatch(kind, color) {
    const s = el('span', { class: 'swatch ' + (kind === 'polygon' ? '' : kind) });
    s.style.background = color;
    if (kind === 'polygon') s.style.borderColor = color;
    return s;
  }

  // Properties that come from KML styling or structure rather than My Maps data columns.
  const INTERNAL_PROPS = /^(name|description|styleUrl|styleHash|styleMap|stroke|stroke-opacity|stroke-width|fill|fill-opacity|icon|icon-color|icon-opacity|icon-scale|icon-heading|icon-offset|icon-offset-units|label-scale|label-color|label-opacity|visibility|timespan|timestamp|gx_media_links|marker-color|_type|_postId)$/i;
  const DATE_PROPS = /^(date|time|when|day|event date|date of event|ቀን|guyyaa)$/i;

  function dataFields(p) {
    return Object.entries(p)
      .filter(([k, v]) => !INTERNAL_PROPS.test(k) && v !== '' && v !== null && typeof v !== 'object')
      .map(([k, v]) => [k, String(v)]);
  }

  function featureDate(p) {
    if (p.timestamp) return Geo.parseDate(p.timestamp);
    if (p.timespan && p.timespan.begin) return Geo.parseDate(p.timespan.begin);
    for (const [k, v] of Object.entries(p)) if (DATE_PROPS.test(k)) return Geo.parseDate(v);
    return null;
  }

  // My Maps "style by data column" gives each value its own colour, but the KML only
  // keeps the colours. Find the column whose values line up one-to-one with the
  // colours and use those values as labels.
  function styleLabels(features) {
    const styles = new Set(features.map(styleKey));
    const labels = new Map();
    if (styles.size < 2) return labels;
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
      const values = [...byStyle.values()];
      if (!values.every((v) => v.size === 1)) continue;
      const flat = values.map((v) => [...v][0]);
      if (new Set(flat).size !== flat.length) continue;
      for (const [key, vals] of byStyle) labels.set(key, [...vals][0]);
      break;
    }
    return labels;
  }

  // ---------- map setup ----------

  const map = L.map('map', {
    zoomControl: true,
    worldCopyJump: true,
    minZoom: 4,
    maxBounds: [[-5, 20], [25, 60]]
  });
  map.createPane('refPane').style.zIndex = 350;        // boundaries and roads, under the data
  map.createPane('highlightPane').style.zIndex = 450;  // change outlines, over the data
  map.createPane('townPane').style.zIndex = 550;       // towns, under event markers
  map.getPane('refPane').style.pointerEvents = 'none';
  map.getPane('highlightPane').style.pointerEvents = 'none';
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

  const googleTiles = (lyrs) => L.tileLayer('https://mt{s}.google.com/vt/lyrs=' + lyrs + '&hl=en&x={x}&y={y}&z={z}', {
    subdomains: '0123', maxZoom: 20, attribution: 'Map data &copy; Google'
  });
  const BASEMAPS = {
    'google-roadmap': { label: 'Google Maps', layer: googleTiles('m'), light: true },
    'google-hybrid': { label: 'Google Satellite (labels)', layer: googleTiles('y') },
    'google-satellite': { label: 'Google Satellite', layer: googleTiles('s') },
    'google-terrain': { label: 'Google Terrain', layer: googleTiles('p'), light: true },
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
    document.body.classList.toggle('light-basemap', !!BASEMAPS[key].light);
    document.getElementById('basemap-select').value = key;
    storage('basemap', key);
    restyleReference();
  }
  const basemapSelect = document.getElementById('basemap-select');
  for (const [key, b] of Object.entries(BASEMAPS)) basemapSelect.append(el('option', { value: key, text: b.label }));
  basemapSelect.addEventListener('change', () => setBasemap(basemapSelect.value));

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
  map.on('zoomend', () => {
    const z = map.getZoom();
    const container = map.getContainer();
    container.classList.toggle('z-low', z < 7);
    container.classList.toggle('z-high', z >= 9);
    updateReferenceVisibility();
  });

  // URL hash keeps the view shareable: #zoom/lat/lng[/YYYY-MM-DD]
  function readHash() {
    const m = location.hash.match(/^#(\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)(?:\/(\d{4}-\d{2}-\d{2}))?/);
    return m ? { zoom: +m[1], center: [+m[2], +m[3]], date: m[4] || null } : null;
  }
  function writeHash() {
    const c = map.getCenter();
    const entry = state.timeline[state.index];
    const date = entry && entry.snapshot && state.index < state.timeline.length - 1 ? '/' + entry.date : '';
    history.replaceState(null, '', location.pathname + location.search + '#' + map.getZoom() + '/' + c.lat.toFixed(4) + '/' + c.lng.toFixed(4) + date);
  }
  map.on('moveend', writeHash);

  // ---------- reference layers ----------

  const reference = {};
  const REFERENCE_SOURCES = {
    regions: 'data/regions.geojson',
    zones: 'data/zones.geojson',
    woredas: 'data/woredas.geojson',
    roads: 'data/roads.geojson',
    towns: 'data/towns.geojson'
  };

  function refColors() {
    const light = document.body.classList.contains('light-basemap');
    return {
      region: light ? '#4a5261' : '#9aa3b2',
      admin: light ? '#6b7383' : '#7d8696',
      road: light ? '#b0662a' : '#d9a066'
    };
  }

  function buildReference(name, data) {
    const c = refColors();
    if (name === 'regions') {
      const lines = L.geoJSON(data, {
        pane: 'refPane', interactive: false,
        style: { color: c.region, weight: 1.4, opacity: 0.8, dashArray: '5 4', fill: false }
      });
      // City-regions are tiny, so leave their labels to the towns layer.
      const small = new Set(['ET-AA', 'ET-DD', 'ET-HA']);
      const labels = data.features.filter((f) => !small.has(f.properties.iso)).map((f) =>
        L.tooltip({ permanent: true, direction: 'center', className: 'region-label', interactive: false })
          .setLatLng(L.geoJSON(f).getBounds().getCenter()).setContent(f.properties.name));
      return { layer: L.layerGroup([lines, ...labels]), restyle: () => lines.setStyle({ color: refColors().region }) };
    }
    if (name === 'zones' || name === 'woredas') {
      const weight = name === 'zones' ? 0.9 : 0.5;
      const layer = L.geoJSON(data, {
        pane: 'refPane', interactive: false,
        style: { color: c.admin, weight, opacity: 0.7, fill: false }
      });
      return { layer, restyle: () => layer.setStyle({ color: refColors().admin }) };
    }
    if (name === 'roads') {
      const layer = L.geoJSON(data, {
        pane: 'refPane', interactive: false,
        style: { color: c.road, weight: 1.3, opacity: 0.75 }
      });
      return { layer, restyle: () => layer.setStyle({ color: refColors().road }) };
    }
    if (name === 'towns') {
      const layer = L.geoJSON(data, {
        pointToLayer: (f, latlng) => {
          const p = f.properties;
          const major = (p.pop || 0) >= 300000 || /capital/i.test(p.capital || '');
          return L.circleMarker(latlng, {
            pane: 'townPane', radius: major ? 4 : 3, color: '#111', weight: 1,
            fillColor: '#fff', fillOpacity: 1, interactive: false,
            className: major ? 'town-dot' : 'town-dot town-minor'
          }).bindTooltip(p.name, {
            permanent: true, direction: 'right', offset: [5, 0], interactive: false,
            className: 'town-label ' + (major ? 'town-major' : 'town-minor'), pane: 'townPane'
          });
        }
      });
      return { layer, restyle: () => {} };
    }
    return null;
  }

  async function ensureReference(name) {
    if (reference[name]) return reference[name];
    const data = await fetchJSON(REFERENCE_SOURCES[name], null);
    if (!data) return null;
    reference[name] = buildReference(name, data);
    return reference[name];
  }

  function refChecked(name) {
    const box = document.querySelector('[data-ref="' + name + '"]');
    return box && box.checked;
  }

  async function updateReferenceVisibility() {
    for (const name of Object.keys(REFERENCE_SOURCES)) {
      let show = refChecked(name) && !state.embed;
      if (name === 'woredas') show = show && map.getZoom() >= 8;
      if (show) {
        const ref = await ensureReference(name);
        if (ref && !map.hasLayer(ref.layer)) ref.layer.addTo(map);
      } else if (reference[name] && map.hasLayer(reference[name].layer)) {
        map.removeLayer(reference[name].layer);
      }
    }
  }

  function restyleReference() {
    for (const ref of Object.values(reference)) if (ref) ref.restyle();
  }

  function setupReference() {
    document.querySelectorAll('[data-ref]').forEach((box) => {
      const saved = storage('ref-' + box.dataset.ref);
      if (saved !== null) box.checked = saved === '1';
      box.addEventListener('change', () => {
        storage('ref-' + box.dataset.ref, box.checked ? '1' : '0');
        updateReferenceVisibility();
      });
    });
  }

  // ---------- KML loading ----------

  async function parseKml(source) {
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
    return toGeoJSON.kmlWithFolders(dom);
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

  // A dataset is every layer at one point in time, with a record per feature.
  function buildDataset(groups) {
    const records = [];
    groups.forEach((g) => {
      const labels = styleLabels(g.features);
      const seen = new Map();
      g.features.forEach((feature) => {
        const kind = geometryKind(feature);
        if (!kind) return;
        const p = feature.properties || {};
        const base = g.name + '|' + (p.name || '#');
        const n = (seen.get(base) || 0) + 1;
        seen.set(base, n);
        const sk = styleKey(feature);
        records.push({
          key: n > 1 ? base + '#' + n : base,
          group: g.name,
          feature,
          kind,
          color: featureColor(feature),
          label: labels.get(sk) || null,
          state: labels.get(sk) || featureColor(feature),
          area: kind === 'polygon' ? Geo.areaKm2(feature.geometry) : 0,
          date: kind === 'point' ? featureDate(p) : null
        });
      });
    });
    return { groups, records, byKey: new Map(records.map((r) => [r.key, r])) };
  }

  // The Google Apps Script proxy (config.liveProxy) serves the current My Maps layers
  // directly, so the latest map works even when the sync workflow can't run.
  function liveUrl(layer) {
    if (!state.config.liveProxy || !layer.url) return null;
    let lid = '';
    try { lid = new URL(layer.url).searchParams.get('lid') || ''; } catch (e) { /* no layer id */ }
    return state.config.liveProxy + (state.config.liveProxy.includes('?') ? '&' : '?') + 'lid=' + encodeURIComponent(lid);
  }

  function configuredLayers() {
    const layers = state.config.layers || [];
    return layers.length ? layers : [{ id: 'map', name: 'Map' }];
  }

  async function loadDataset(entry) {
    const cacheKey = entry.snapshot ? entry.date : 'latest';
    if (state.datasets.has(cacheKey)) return state.datasets.get(cacheKey);
    const layers = configuredLayers().filter((l) => !entry.snapshot || !entry.snapshot.layers || entry.snapshot.layers.includes(l.id));
    const results = await Promise.all(layers.map(async (l) => {
      const urls = entry.snapshot
        ? ['data/history/' + entry.date + '/' + l.id + '.kml']
        : [liveUrl(l), 'data/layers/' + l.id + '.kml'].filter(Boolean);
      for (const url of urls) {
        try {
          const groups = collectGroups(await parseKml({ url }), l.name);
          if (url === urls[0] && !entry.snapshot && state.config.liveProxy) state.live = true;
          return groups;
        } catch (err) { /* try the next source */ }
      }
      return null;
    }));
    const groups = results.filter(Boolean).flat();
    const events = postFeatures(entry.snapshot ? dayDate(entry.date) : null);
    if (events.length) groups.push({ name: t('events'), features: events });
    const dataset = groups.length ? buildDataset(groups) : null;
    state.datasets.set(cacheKey, dataset);
    return dataset;
  }

  // Posts from the dashboard (admin.html) and data/updates.json that have a location,
  // as GeoJSON points. For a past snapshot, only posts up to that day are included.
  function postFeatures(until) {
    const end = until ? until.getTime() + 12 * 3600000 : Infinity;
    return state.posts
      .filter((post) => post.lat !== '' && post.lng !== '' && isFinite(post.lat) && isFinite(post.lng) &&
        (Geo.parseDate(post.date) || new Date(0)).getTime() <= end)
      .map((post) => {
        const type = eventType(post.type) || eventType('update');
        const firstLine = post.text.split('\n')[0];
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [+post.lng, +post.lat] },
          properties: Object.assign(
            {
              name: firstLine.length > 90 ? firstLine.slice(0, 87) + '…' : firstLine,
              'marker-color': type.color, _type: type.id, _postId: post.id, timestamp: post.date
            },
            post.text !== firstLine || firstLine.length > 90 ? { description: post.text } : {},
            post.source ? { Source: post.source } : {}
          )
        };
      });
  }

  // ---------- rendering the data ----------

  const highlightLayer = L.layerGroup().addTo(map);

  function popupContent(record) {
    const p = record.feature.properties || {};
    const wrap = el('div');
    const ptype = record.kind === 'point' ? pointType(p) : null;
    wrap.append(el('div', { class: 'layer-tag' }, ptype
      ? [el('span', { class: 'mini-icon', html: eventIconHtml(ptype, 18) }), typeLabel(ptype)]
      : [record.group]));
    wrap.append(el('h3', { text: p.name || t('untitled') }));
    const change = state.changes.find((c) => c.key === record.key);
    if (change && change.type === 'changed') {
      wrap.append(el('div', { class: 'change-tag', text: t('changedFromTo', { from: change.from, to: change.to }) }));
    }
    if (record.date) wrap.append(el('div', { class: 'coords', text: formatDate(record.date) }));
    const desc = p.description && (typeof p.description === 'string' ? p.description : p.description.value);
    if (desc) {
      const d = el('div', { class: 'desc' });
      d.innerHTML = sanitize(desc);
      wrap.append(d);
    }
    const fields = dataFields(p);
    if (fields.length) {
      const table = el('table', { class: 'fields' });
      fields.forEach(([k, v]) => {
        let value = v;
        if (/^https?:\/\/\S+$/i.test(v.trim())) {
          let host = v;
          try { host = new URL(v.trim()).hostname.replace(/^www\./, ''); } catch (e) { /* keep raw */ }
          value = el('a', { href: v.trim(), target: '_blank', rel: 'noopener noreferrer', text: host + ' ↗' });
        }
        table.append(el('tr', {}, [el('th', { text: k }), el('td', {}, value)]));
      });
      wrap.append(table);
    }
    if (record.kind === 'point') {
      const [lng, lat] = record.feature.geometry.coordinates;
      wrap.append(el('div', { class: 'coords', text: lat.toFixed(5) + ', ' + lng.toFixed(5) }));
    }
    return wrap;
  }

  function clearRendered() {
    for (const g of state.groups) map.removeLayer(g.layer);
    highlightLayer.clearLayers();
    state.groups = [];
    state.records = [];
    state.searchIndex = [];
  }

  function renderDataset(dataset) {
    const hidden = new Set(state.groups.filter((g) => !map.hasLayer(g.layer)).map((g) => g.name));
    clearRendered();
    if (!dataset) return;
    const panes = { polygon: 'overlayPane', line: 'overlayPane', point: 'markerPane' };
    const byGroup = new Map();
    dataset.records.forEach((r) => {
      if (!byGroup.has(r.group)) byGroup.set(r.group, []);
      byGroup.get(r.group).push(r);
    });
    dataset.groups.forEach((g) => {
      const layer = L.featureGroup();
      const styles = new Map();
      (byGroup.get(g.name) || []).forEach((r) => {
        const p = r.feature.properties || {};
        const gj = L.geoJSON(r.feature, {
          pane: panes[r.kind],
          style: () => (r.kind === 'point' ? {} : pathStyle(p)),
          pointToLayer: (f, latlng) => {
            const type = pointType(p);
            if (type) {
              return L.marker(latlng, {
                riseOnHover: true,
                icon: L.divIcon({ className: 'event-icon', html: eventIconHtml(type, 28), iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -12] })
              });
            }
            return L.circleMarker(latlng, { radius: 6, color: '#0f1115', weight: 1.5, fillColor: pointColor(p), fillOpacity: 0.95 });
          }
        });
        gj.bindPopup(() => popupContent(r), { maxWidth: 320 });
        const rendered = Object.assign({}, r, { layer: gj, groupLayer: layer });
        state.records.push(rendered);
        if (!eventHidden(rendered)) gj.addTo(layer);
        const sk = r.kind + '|' + r.color;
        const entry = styles.get(sk) || { kind: r.kind, color: r.color, label: r.label, count: 0 };
        entry.count++;
        styles.set(sk, entry);
        if (p.name) state.searchIndex.push({ name: String(p.name), group: g.name, record: rendered });
      });
      if (!hidden.has(g.name)) layer.addTo(map);
      state.groups.push({ name: g.name, layer, count: (byGroup.get(g.name) || []).length, styles: [...styles.values()] });
    });
  }

  // ---------- events filter ----------

  function viewDate() {
    const entry = state.timeline[state.index];
    if (!entry || !entry.snapshot || state.index === state.timeline.length - 1) return new Date();
    return dayDate(entry.date);
  }

  function eventHidden(record) {
    if (!state.eventDays || record.kind !== 'point' || !record.date) return false;
    const age = (viewDate() - record.date) / 86400000;
    return age > state.eventDays || age < -1;
  }

  function applyEventFilter() {
    state.records.forEach((r) => {
      if (r.kind !== 'point') return;
      const hide = eventHidden(r);
      if (hide && r.groupLayer.hasLayer(r.layer)) r.groupLayer.removeLayer(r.layer);
      if (!hide && !r.groupLayer.hasLayer(r.layer)) r.groupLayer.addLayer(r.layer);
    });
  }

  function setupEventFilter() {
    const box = document.getElementById('events-filter');
    box.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      state.eventDays = +b.dataset.days;
      box.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
      applyEventFilter();
      renderUpdates();
    }));
  }

  // ---------- changes ----------

  function computeChanges(current, baseline) {
    if (!current || !baseline) return [];
    const changes = [];
    for (const r of current.records) {
      if (r.kind !== 'polygon') continue;
      const before = baseline.byKey.get(r.key);
      if (!before) changes.push({ type: 'added', key: r.key, record: r, name: r.feature.properties.name, to: r.label || '' });
      else if (before.state !== r.state) {
        changes.push({
          type: 'changed', key: r.key, record: r, before,
          name: r.feature.properties.name,
          from: before.label || t('other'), to: r.label || t('other')
        });
      }
    }
    for (const b of baseline.records) {
      if (b.kind !== 'polygon' || current.byKey.has(b.key)) continue;
      changes.push({ type: 'removed', key: b.key, record: b, name: b.feature.properties.name, from: b.label || '' });
    }
    return changes;
  }

  function renderHighlights() {
    highlightLayer.clearLayers();
    if (!document.getElementById('toggle-highlight').checked) return;
    state.changes.forEach((c) => {
      const removed = c.type === 'removed';
      L.geoJSON(c.record.feature, {
        pane: 'highlightPane', interactive: false,
        style: {
          color: removed ? '#9aa3b2' : '#ffd23f', weight: 3, opacity: 1,
          dashArray: removed ? '4 4' : null, fill: removed, fillOpacity: 0.08,
          className: removed ? '' : 'pulse'
        }
      }).addTo(highlightLayer);
    });
  }

  function flyToRecord(record, openPopup) {
    const b = L.geoJSON(record.feature).getBounds();
    if (!b.isValid()) return;
    if (b.getNorthEast().equals(b.getSouthWest())) map.flyTo(b.getCenter(), Math.max(map.getZoom(), 11));
    else map.flyToBounds(b, { padding: [40, 40], maxZoom: 11 });
    if (openPopup) {
      const rendered = state.records.find((r) => r.key === record.key);
      if (rendered) {
        const g = state.groups.find((x) => x.name === rendered.group);
        if (g && !map.hasLayer(g.layer)) { g.layer.addTo(map); renderLayerList(); }
        map.once('moveend', () => rendered.layer.openPopup());
      }
    }
    closePanelOnMobile();
  }

  function renderChanges() {
    const list = document.getElementById('changes');
    list.textContent = '';
    if (!state.baseline) {
      const earliest = state.timeline.length > 1 && state.index === 0;
      list.append(el('li', { class: 'muted small', text: t(earliest ? 'earliest' : 'noHistory') }));
      return;
    }
    if (!state.changes.length) {
      list.append(el('li', { class: 'muted small', text: t('noChanges') }));
      return;
    }
    const colorOf = (label, fallback) => {
      const r = state.current && state.current.records.find((x) => x.label === label);
      return r ? r.color : fallback;
    };
    state.changes.forEach((c) => {
      let detail;
      if (c.type === 'changed') {
        detail = el('span', { class: 'change-detail' }, [
          swatch('polygon', c.before.color), ' ' + c.from + ' → ', swatch('polygon', c.record.color), ' ' + c.to
        ]);
      } else {
        const label = c.to || c.from;
        detail = el('span', { class: 'change-detail' }, [
          (c.type === 'added' ? t('added') : t('removed')) + (label ? ': ' : ''),
          label ? swatch('polygon', colorOf(label, c.record.color)) : null,
          label ? ' ' + label : ''
        ]);
      }
      list.append(el('li', { onclick: () => flyToRecord(c.record, c.type !== 'removed') }, [
        el('span', { class: 'change-name', text: c.name || t('untitled') }),
        detail
      ]));
    });
  }

  // ---------- overview statistics ----------

  function tally(dataset) {
    const out = new Map();
    if (!dataset) return out;
    dataset.records.forEach((r) => {
      if (r.kind !== 'polygon') return;
      const e = out.get(r.state) || { label: r.label || null, color: r.color, count: 0, area: 0 };
      e.count++;
      e.area += r.area;
      out.set(r.state, e);
    });
    return out;
  }

  function renderOverview() {
    const section = document.getElementById('overview-section');
    const list = document.getElementById('overview');
    list.textContent = '';
    const labelled = [...tally(state.current).values()].filter((e) => e.label);
    section.hidden = !labelled.length;
    if (!labelled.length) return;
    const before = tally(state.baseline);
    const total = labelled.reduce((s, e) => s + e.area, 0) || 1;
    labelled.sort((a, b) => b.area - a.area).forEach((e) => {
      const prev = before.get(e.label);
      let delta = null;
      if (state.baseline) {
        const d = e.area - (prev ? prev.area : 0);
        if (Math.abs(d) >= 1) {
          delta = el('span', { class: 'delta ' + (d > 0 ? 'up' : 'down'), title: t('lastWeek'),
            text: (d > 0 ? '+' : '−') + Geo.formatNumber(Math.abs(d)) + ' km²' });
        }
      }
      const pct = (100 * e.area / total).toFixed(1) + '%';
      const fill = el('span');
      fill.style.width = pct;
      fill.style.background = e.color;
      list.append(el('li', {}, [
        el('div', { class: 'overview-row' }, [
          swatch('polygon', e.color),
          el('span', { class: 'name', text: e.label }),
          el('span', { class: 'pct', text: pct })
        ]),
        el('div', { class: 'bar' }, fill),
        el('div', { class: 'overview-meta' }, [
          el('span', { text: t(e.count === 1 ? 'zone' : 'zones', { n: e.count }) + ' · ' + t('area', { n: Geo.formatNumber(e.area) }) }),
          delta
        ])
      ]));
    });
  }

  // ---------- layer list ----------

  function renderLayerList() {
    const list = document.getElementById('layer-list');
    list.textContent = '';
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
    (state.config.legend || []).forEach((item) => {
      list.append(el('li', { class: 'manual-legend' }, [swatch(item.type || 'polygon', item.color), el('span', { class: 'name', text: item.label })]));
    });
  }

  // ---------- timeline ----------

  function compareIndex() {
    if (state.timeline.length < 2 || state.index === 0) return -1;
    if (state.compare === 'prev') return state.index - 1;
    const target = viewDate().getTime() - state.compare * 86400000;
    let best = -1;
    state.timeline.forEach((e, i) => {
      if (i < state.index && e.date && dayDate(e.date).getTime() <= target) best = i;
    });
    return best >= 0 ? best : 0;
  }

  function timelineLabel(i) {
    const e = state.timeline[i];
    if (!e) return '';
    if (i === state.timeline.length - 1 && state.live) return t('live');
    if (i === state.timeline.length - 1 && state.meta.syncedAt) return formatDate(state.meta.syncedAt, true);
    return e.date ? formatDate(dayDate(e.date)) : t('latest');
  }

  async function showIndex(i) {
    state.preview = false;
    state.index = Math.max(0, Math.min(i, state.timeline.length - 1));
    const entry = state.timeline[state.index];
    const ci = compareIndex();
    const [current, baseline] = await Promise.all([
      loadDataset(entry),
      ci >= 0 ? loadDataset(state.timeline[ci]) : Promise.resolve(null)
    ]);
    state.current = current;
    state.baseline = baseline;
    state.changes = computeChanges(current, baseline);
    renderDataset(current);
    renderAll();
    document.getElementById('timeline-range').value = state.index;
    if (!current) showNotice(escapeText(t('noData')), true);
    else document.getElementById('notice').hidden = true;
    writeHash();
  }

  function renderCompareSelect() {
    const select = document.getElementById('compare-select');
    const value = String(state.compare);
    select.textContent = '';
    select.append(el('option', { value: 'prev', text: t('previousSnapshot') }));
    [7, 30].forEach((n) => select.append(el('option', { value: String(n), text: t('daysAgo', { n }) })));
    select.value = value;
  }

  let playTimer = null;
  function setPlaying(on) {
    clearInterval(playTimer);
    playTimer = null;
    document.getElementById('play-icon').setAttribute('d', on ? 'M7 5h4v14H7zM13 5h4v14h-4z' : 'M7 5l12 7-12 7z');
    const btn = document.getElementById('play-btn');
    btn.dataset.i18nAria = on ? 'pause' : 'play';
    btn.setAttribute('aria-label', t(btn.dataset.i18nAria));
    if (!on) return;
    if (state.index >= state.timeline.length - 1) showIndex(0);
    playTimer = setInterval(() => {
      if (state.index >= state.timeline.length - 1) { setPlaying(false); return; }
      showIndex(state.index + 1);
    }, 1400);
  }

  function setupTimeline() {
    const bar = document.getElementById('timeline');
    const range = document.getElementById('timeline-range');
    range.max = Math.max(0, state.timeline.length - 1);
    bar.hidden = state.timeline.length < 2;
    range.addEventListener('input', () => {
      setPlaying(false);
      document.getElementById('timeline-label').textContent = timelineLabel(+range.value);
    });
    range.addEventListener('change', () => showIndex(+range.value));
    document.getElementById('play-btn').addEventListener('click', () => setPlaying(!playTimer));
    const select = document.getElementById('compare-select');
    select.addEventListener('change', () => {
      state.compare = select.value === 'prev' ? 'prev' : +select.value;
      showIndex(state.index);
    });
    document.getElementById('toggle-highlight').addEventListener('change', renderHighlights);
  }

  // ---------- updates feed ----------

  let autoUpdates = [];

  function typeLabel(type) {
    const key = 'type.' + type.id;
    const label = t(key);
    return label === key ? type.label : label;
  }

  function inPeriod(date) {
    if (!state.eventDays) return true;
    const d = Geo.parseDate(date);
    if (!d) return true;
    const age = (viewDate() - d) / 86400000;
    return age <= state.eventDays && age >= -1;
  }

  function renderUpdates() {
    const list = document.getElementById('updates');
    list.textContent = '';
    const items = [
      ...state.posts.map((u) => Object.assign({ auto: false }, u)),
      ...autoUpdates.map((u) => Object.assign({ auto: true }, u))
    ].filter((u) => inPeriod(u.date)).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 80);
    if (!items.length) {
      list.append(el('li', { class: 'empty' }, [el('p', { class: 'muted', text: t('noUpdates') })]));
      return;
    }
    items.forEach((u) => {
      const type = u.auto ? eventType('captured') : (eventType(u.type) || eventType('update'));
      const text = u.auto
        ? (u.name || t('untitled')) + ': ' + (u.type === 'added' ? t('added') + (u.to ? ' (' + u.to + ')' : '')
          : u.type === 'removed' ? t('removed') : t('changedFromTo', { from: u.from, to: u.to }))
        : u.text;
      const body = el('div', { class: 'update-body' }, [
        el('time', { datetime: u.date }, [
          typeLabel(type) + ' · ' + formatDate(u.date, /T/.test(u.date)),
          u.auto ? el('span', { class: 'badge', text: t('automatic') }) : null
        ]),
        el('p', { text })
      ]);
      const links = el('div', { class: 'update-links' });
      const record = u.auto
        ? state.current && state.current.byKey.get(u.key)
        : state.records.find((r) => r.feature.properties._postId === u.id);
      if (record) {
        links.append(el('a', { class: 'go', href: '#', text: t('showOnMap'), onclick: (e) => {
          e.preventDefault(); flyToRecord(record, true);
        } }));
      } else if (u.lat !== undefined && u.lat !== '' && isFinite(u.lat)) {
        links.append(el('a', { class: 'go', href: '#', text: t('showOnMap'), onclick: (e) => {
          e.preventDefault(); map.flyTo([+u.lat, +u.lng], u.zoom || 10); closePanelOnMobile();
        } }));
      }
      if (u.source && /^https?:\/\//i.test(u.source)) {
        let host = u.source;
        try { host = new URL(u.source).hostname.replace(/^www\./, ''); } catch (e) { /* keep raw */ }
        links.append(el('a', { class: 'go', href: u.source, target: '_blank', rel: 'noopener noreferrer', text: t('source') + ': ' + host }));
      }
      if (links.children.length) body.append(links);
      const item = el('li', {}, [el('span', { class: 'update-icon', html: eventIconHtml(type, 26) }), body]);
      if (record) {
        item.classList.add('clickable');
        item.addEventListener('click', (e) => { if (e.target.tagName !== 'A') flyToRecord(record, true); });
      }
      list.append(item);
    });
  }

  // Icon key: the event types that are on the map right now.
  function renderIconKey() {
    const key = document.getElementById('icon-key');
    key.textContent = '';
    const present = new Map();
    state.records.forEach((r) => {
      if (r.kind !== 'point') return;
      const type = pointType(r.feature.properties || {});
      if (type) present.set(type.id, type);
    });
    EVENT_TYPES.filter((type) => present.has(type.id)).forEach((type) => {
      key.append(el('li', {}, [el('span', { html: eventIconHtml(type, 18) }), typeLabel(type)]));
    });
    key.hidden = !key.children.length;
  }

  // ---------- search ----------

  function setupSearch() {
    const input = document.getElementById('search');
    const results = document.getElementById('search-results');
    let active = -1;
    let matches = [];

    const choose = (m) => {
      results.hidden = true;
      input.value = m.name;
      if (m.record) flyToRecord(m.record, true);
      else { map.flyTo(m.latlng, 10); closePanelOnMobile(); }
    };

    const render = () => {
      results.textContent = '';
      matches.forEach((m, i) => {
        const li = el('li', { class: i === active ? 'active' : '' }, [
          m.record ? swatch(m.record.kind, m.record.color) : el('span', { class: 'swatch point town' }),
          el('span', { text: m.name }),
          el('span', { class: 'sub', text: m.group })
        ]);
        li.addEventListener('mousedown', (e) => { e.preventDefault(); choose(m); });
        results.append(li);
      });
      results.hidden = !matches.length;
    };

    input.addEventListener('input', async () => {
      const q = input.value.trim().toLowerCase();
      active = -1;
      if (!q) { matches = []; render(); return; }
      const towns = await ensureReference('towns');
      const townMatches = [];
      if (towns) towns.layer.eachLayer((l) => {
        const name = l.feature.properties.name;
        if (name.toLowerCase().includes(q)) townMatches.push({ name, group: t('towns'), latlng: l.getLatLng() });
      });
      matches = state.searchIndex.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 25).concat(townMatches.slice(0, 8));
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

  // ---------- sharing and corrections ----------

  function shareText() {
    return state.config.title + ' · ' + t('mapAsOf') + ' ' + document.getElementById('as-of-date').textContent;
  }

  function setupShare() {
    const btn = document.getElementById('share-btn');
    const menu = document.getElementById('share-menu');
    const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        try { await navigator.share({ title: state.config.title, text: shareText(), url: location.href }); return; } catch (err) { /* cancelled */ }
      }
      menu.hidden = !menu.hidden;
      btn.setAttribute('aria-expanded', String(!menu.hidden));
    });
    document.addEventListener('click', close);
    menu.addEventListener('click', async (e) => {
      e.stopPropagation();
      const kind = e.target.dataset.share;
      if (!kind) return;
      const url = encodeURIComponent(location.href);
      const text = encodeURIComponent(shareText());
      const targets = {
        telegram: 'https://t.me/share/url?url=' + url + '&text=' + text,
        whatsapp: 'https://wa.me/?text=' + text + '%20' + url,
        x: 'https://twitter.com/intent/tweet?url=' + url + '&text=' + text,
        facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + url
      };
      if (kind === 'copy') {
        if (await copyText(location.href)) toast(t('copied'));
      } else {
        window.open(targets[kind], '_blank', 'noopener');
      }
      close();
    });
  }

  function reportUrl(latlng) {
    const params = new URLSearchParams({ template: 'correction.yml', title: 'Correction: ' });
    if (latlng) params.set('location', latlng.lat.toFixed(5) + ', ' + latlng.lng.toFixed(5));
    params.set('link', location.href);
    return 'https://github.com/' + state.config.repo + '/issues/new?' + params.toString();
  }

  function setupCorrections() {
    const link = document.getElementById('report-link');
    link.href = reportUrl(null);
    link.addEventListener('click', () => { link.href = reportUrl(null); });
    map.on('contextmenu', (e) => {
      const text = e.latlng.lat.toFixed(5) + ', ' + e.latlng.lng.toFixed(5);
      const content = el('div', { class: 'context-menu' }, [
        el('div', { class: 'coords', text }),
        el('a', { href: reportUrl(e.latlng), target: '_blank', rel: 'noopener', text: t('reportHere') }),
        el('a', { href: '#', text: t('copyCoords'), onclick: async (ev) => {
          ev.preventDefault();
          if (await copyText(text)) toast(t('copied'));
        } })
      ]);
      L.popup({ maxWidth: 240 }).setLatLng(e.latlng).setContent(content).openOn(map);
    });
  }

  // ---------- panel ----------

  const isMobile = () => window.matchMedia('(max-width: 720px)').matches;
  const toggleBtn = document.getElementById('panel-toggle');
  function setPanel(open) {
    document.body.classList.toggle('panel-closed', !open);
    if (!open) document.body.classList.remove('sheet-full');
    toggleBtn.setAttribute('aria-expanded', String(open));
    setTimeout(() => map.invalidateSize(), 220);
  }
  function closePanelOnMobile() {
    if (isMobile()) setPanel(false);
  }
  toggleBtn.addEventListener('click', () => setPanel(document.body.classList.contains('panel-closed')));
  document.getElementById('sheet-handle').addEventListener('click', () => {
    document.body.classList.toggle('sheet-full');
  });
  if (isMobile()) setPanel(false);

  // ---------- notices, embed, drag & drop ----------

  function showNotice(html, dismissable) {
    const n = document.getElementById('notice');
    n.innerHTML = '';
    if (dismissable) n.append(el('button', { class: 'close', 'aria-label': 'Dismiss', text: '×', onclick: () => { n.hidden = true; } }));
    const body = el('div');
    body.innerHTML = html;
    n.append(body);
    n.hidden = false;
  }

  // Embed mode shows Google's own My Maps viewer, with all its layers, in place of
  // the Leaflet map. It needs no synced data, so the site works before the first sync.
  function setEmbedMode(on) {
    state.embed = on;
    const frame = document.getElementById('embed');
    document.body.classList.toggle('embed-mode', on);
    if (on && !frame.src) {
      const c = map.getCenter();
      frame.src = 'https://www.google.com/maps/d/embed?mid=' + encodeURIComponent(state.config.googleMyMapsId) +
        '&ll=' + c.lat.toFixed(4) + '%2C' + c.lng.toFixed(4) + '&z=' + map.getZoom();
    }
    document.getElementById('embed-info').hidden = !on;
    if (!on) map.invalidateSize();
    updateReferenceVisibility();
  }

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
      try {
        const groups = collectGroups(await parseKml({ file }), file.name.replace(/\.km[lz]$/i, ''));
        setPlaying(false);
        setEmbedMode(false);
        state.preview = true;
        state.current = buildDataset(groups);
        state.baseline = null;
        state.changes = [];
        renderDataset(state.current);
        renderAll();
        const bounds = L.latLngBounds([]);
        state.groups.forEach((g) => bounds.extend(g.layer.getBounds()));
        if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 9 });
        showNotice(escapeText(t('previewing', { file: file.name })), true);
      } catch (err) {
        showNotice(escapeText(t('readError', { file: file.name, error: err.message })), true);
      }
    });
  }

  // ---------- app install (PWA) ----------

  function setupInstall() {
    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is optional */ });
    }
    let deferred = null;
    const btn = document.getElementById('install-btn');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferred = e;
      btn.hidden = false;
    });
    btn.addEventListener('click', async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
      btn.hidden = true;
    });
  }

  // ---------- boot ----------

  function renderAll() {
    renderCompareSelect();
    renderLayerList();
    renderOverview();
    renderChanges();
    renderHighlights();
    renderUpdates();
    renderIconKey();
    document.getElementById('changes-section').hidden = state.preview || state.timeline.length < 2;
    document.getElementById('timeline-label').textContent = timelineLabel(state.index);
    document.getElementById('as-of-date').textContent = state.preview ? '–' : timelineLabel(state.index);
  }

  async function init() {
    const [config, meta, snapshots, updates, changes] = await Promise.all([
      fetchJSON('data/config.json', {}),
      fetchJSON('data/meta.json', {}),
      fetchJSON('data/history/index.json', []),
      fetchJSON('data/updates.json', []),
      fetchJSON('data/changes.json', [])
    ]);
    state.config = Object.assign({}, DEFAULT_CONFIG, config);
    state.meta = meta || {};
    autoUpdates = Array.isArray(changes) ? changes : [];
    // Posts: data/updates.json (edited on GitHub) plus everything published from the dashboard.
    state.posts = (Array.isArray(updates) ? updates : []).map((u, i) => ({
      id: 'file-' + i, date: u.date, type: u.type || 'update', text: String(u.text || ''),
      lat: Array.isArray(u.location) ? u.location[0] : '', lng: Array.isArray(u.location) ? u.location[1] : '',
      zoom: u.zoom, source: u.source || ''
    }));
    if (state.config.liveProxy) {
      const sep = state.config.liveProxy.includes('?') ? '&' : '?';
      const posted = await fetchJSON(state.config.liveProxy + sep + 'action=data', null);
      if (posted && Array.isArray(posted.posts)) {
        state.posts = state.posts.concat(posted.posts.map((p) => Object.assign({}, p, { text: String(p.text || '') })));
      }
    }

    setupLanguage();
    document.title = state.config.title;
    document.getElementById('site-title').textContent = state.config.title;
    const src = document.getElementById('source-link');
    if (state.config.googleMyMapsId) src.href = 'https://www.google.com/maps/d/viewer?mid=' + encodeURIComponent(state.config.googleMyMapsId);
    else src.hidden = true;

    const fromHash = readHash();
    if (fromHash) map.setView(fromHash.center, fromHash.zoom);
    else map.setView(state.config.center, state.config.zoom);

    setBasemap(storage('basemap') || state.config.basemap);
    setupReference();
    setupSearch();
    setupShare();
    setupCorrections();
    setupDrop();
    setupEventFilter();
    setupInstall();

    // Timeline: one entry per daily snapshot; the newest uses the latest synced files.
    const sorted = (Array.isArray(snapshots) ? snapshots : []).slice().sort((a, b) => a.date.localeCompare(b.date));
    state.timeline = sorted.map((s) => ({ date: s.date, snapshot: s }));
    if (state.timeline.length) state.timeline[state.timeline.length - 1].snapshot = null;
    else state.timeline = [{ date: null, snapshot: null }];
    setupTimeline();

    const latest = await loadDataset(state.timeline[state.timeline.length - 1]);
    if (!latest && state.config.googleMyMapsId) {
      // No synced data yet: show the live Google My Maps view instead of an empty map.
      setEmbedMode(true);
      renderAll();
      return;
    }
    map.fire('zoomend');
    let start = state.timeline.length - 1;
    if (fromHash && fromHash.date) {
      const i = state.timeline.findIndex((e) => e.date === fromHash.date);
      if (i >= 0) start = i;
    }
    await showIndex(start);
  }

  init();
})();
