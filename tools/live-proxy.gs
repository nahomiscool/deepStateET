/**
 * DeepState ET: live data and dashboard backend (Google Apps Script).
 *
 * 1. Serves the current layers of your Google My Map to the website, so the map
 *    works without the GitHub sync workflow. Only the map below is served.
 * 2. Stores the written updates and event markers you add in the dashboard
 *    (admin.html). They're kept in the script's own storage, which needs no
 *    extra Google permissions.
 *
 * First-time setup:
 *  1. Go to https://script.google.com and click "New project".
 *  2. Delete the sample code, paste this whole file, and click Save.
 *  3. Change ADMIN_PASSWORD below to your own password.
 *  4. Click Deploy → New deployment → gear icon → "Web app".
 *     Execute as: Me. Who has access: Anyone. Click Deploy and allow the permissions.
 *  5. Put the "Web app URL" (ends in /exec) in data/config.json as "liveProxy".
 *
 * Updating an existing deployment (keeps the same URL):
 *  Paste the new code, set ADMIN_PASSWORD again, click Save, then
 *  Deploy → Manage deployments → pencil icon → Version: "New version" → Deploy.
 *
 * The map itself must be shared as "Anyone with this link can view".
 */
const MAP_ID = '1XPJWGQgVK216o5nXwIpydH-y5ebbj24';
const ADMIN_PASSWORD = 'change-me'; // ← choose your own password (at least 8 characters)
const CACHE_SECONDS = 300;          // Google is asked for each map layer at most once every 5 minutes

// Updates and markers are stored as script properties: "u:<id>" and "m:<id>" → JSON.
const LISTS = { Updates: 'u:', Markers: 'm:' };
const MAX_STORAGE = 480000; // Apps Script allows about 500 KB of properties in total

// ---------- web app entry points ----------

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === 'data') return json_(readData_());
  const lid = String(params.lid || '').replace(/[^A-Za-z0-9_-]/g, '');
  return ContentService.createTextOutput(getKml_(lid)).setMimeType(ContentService.MimeType.XML);
}

// The dashboard sends JSON as text/plain (this avoids a CORS preflight request).
function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Bad request' });
  }
  const auth = checkPassword_(req.password);
  if (auth) return json_({ ok: false, error: auth });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    switch (req.action) {
      case 'check': return json_({ ok: true });
      case 'addUpdate': return json_(addUpdate_(req.item || {}));
      case 'addMarker': return json_(addMarker_(req.item || {}));
      case 'delete': return json_(deleteRow_(req.sheet, req.id));
      default: return json_({ ok: false, error: 'Unknown action' });
    }
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- password ----------

// After 10 wrong passwords in 15 minutes, all attempts are refused for 15 minutes.
function checkPassword_(password) {
  if (ADMIN_PASSWORD === 'change-me' || ADMIN_PASSWORD.length < 8) {
    return 'Set ADMIN_PASSWORD in the Apps Script (at least 8 characters) and deploy a new version.';
  }
  const cache = CacheService.getScriptCache();
  const failures = Number(cache.get('failures') || 0);
  if (failures >= 10) return 'Too many wrong passwords. Try again in 15 minutes.';
  if (String(password || '') !== ADMIN_PASSWORD) {
    cache.put('failures', String(failures + 1), 900);
    return 'Wrong password';
  }
  return null;
}

// ---------- updates and markers ----------

function store_() {
  return PropertiesService.getScriptProperties();
}

function items_(prefix) {
  const all = store_().getProperties();
  const out = [];
  for (const key of Object.keys(all)) {
    if (key.indexOf(prefix) !== 0) continue;
    try { out.push(JSON.parse(all[key])); } catch (err) { /* skip damaged entries */ }
  }
  return out;
}

function save_(prefix, item) {
  const value = JSON.stringify(item);
  const all = store_().getProperties();
  const used = Object.keys(all).reduce((sum, k) => sum + k.length + all[k].length, 0);
  if (used + value.length > MAX_STORAGE) {
    throw new Error('Storage is full. Delete some old updates or markers in the Manage tab first.');
  }
  store_().setProperty(prefix + item.id, value);
}

function readData_() {
  return {
    updates: items_(LISTS.Updates).map((r) => ({
      id: r.id, date: r.date, text: r.text,
      location: r.lat !== '' && r.lng !== '' ? [r.lat, r.lng] : undefined,
      zoom: r.zoom || undefined
    })),
    markers: items_(LISTS.Markers)
  };
}

function clean_(value, max) {
  return String(value === undefined || value === null ? '' : value).trim().slice(0, max);
}

function coordinate_(value, min, max) {
  if (value === '' || value === null || value === undefined) return '';
  const n = Number(value);
  if (!isFinite(n) || n < min || n > max) throw new Error('Location is outside the map area');
  return Math.round(n * 100000) / 100000;
}

function date_(value) {
  const d = value ? new Date(value) : new Date();
  if (isNaN(d.getTime())) throw new Error('Invalid date');
  return Utilities.formatDate(d, 'Etc/UTC', "yyyy-MM-dd'T'HH:mm'Z'");
}

function addUpdate_(item) {
  const text = clean_(item.text, 1000);
  if (!text) throw new Error('The update text is empty');
  const lat = coordinate_(item.lat, -5, 25);
  const lng = coordinate_(item.lng, 20, 60);
  const zoom = item.zoom ? Math.max(4, Math.min(16, Math.round(Number(item.zoom)) || 10)) : '';
  const id = Utilities.getUuid();
  save_(LISTS.Updates, { id, date: date_(item.date), text, lat, lng, zoom: lat === '' ? '' : zoom });
  return { ok: true, id };
}

function addMarker_(item) {
  const title = clean_(item.title, 200);
  if (!title) throw new Error('The marker needs a title');
  const lat = coordinate_(item.lat, -5, 25);
  const lng = coordinate_(item.lng, 20, 60);
  if (lat === '' || lng === '') throw new Error('The marker needs a location');
  const source = clean_(item.source, 500);
  if (source && !/^https?:\/\//i.test(source)) throw new Error('The source must be a link starting with http:// or https://');
  const id = Utilities.getUuid();
  save_(LISTS.Markers, {
    id, date: date_(item.date), title, type: clean_(item.type, 40) || 'Other',
    description: clean_(item.description, 2000), source, lat, lng
  });
  return { ok: true, id };
}

function deleteRow_(list, id) {
  const prefix = LISTS[list];
  if (!prefix) throw new Error('Unknown list');
  const key = prefix + String(id);
  if (store_().getProperty(key) === null) throw new Error('Not found (it may already be deleted)');
  store_().deleteProperty(key);
  return { ok: true };
}

// ---------- My Maps layers ----------

function getKml_(lid) {
  const cache = CacheService.getScriptCache();
  const key = 'kml_' + lid;
  const cached = readCache_(cache, key);
  if (cached) return cached;

  const url = 'https://www.google.com/maps/d/kml?forcekml=1&mid=' + MAP_ID + (lid ? '&lid=' + lid : '');
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const text = res.getContentText('UTF-8');
  if (res.getResponseCode() !== 200 || text.indexOf('<kml') === -1) {
    throw new Error('Could not load the map (HTTP ' + res.getResponseCode() + '). Is it shared as "Anyone with this link can view"?');
  }
  writeCache_(cache, key, text);
  return text;
}

// Cache values are limited to 100 KB, so large layers are stored in pieces.
function readCache_(cache, key) {
  const count = Number(cache.get(key + '_n') || 0);
  if (!count) return null;
  const parts = cache.getAll(Array.from({ length: count }, (_, i) => key + '_' + i));
  const chunks = [];
  for (let i = 0; i < count; i++) {
    if (parts[key + '_' + i] === undefined) return null;
    chunks.push(parts[key + '_' + i]);
  }
  return chunks.join('');
}

function writeCache_(cache, key, text) {
  const size = 90000;
  const values = {};
  const count = Math.ceil(text.length / size);
  if (count > 50) return; // too big to cache; serve it uncached
  for (let i = 0; i < count; i++) values[key + '_' + i] = text.slice(i * size, (i + 1) * size);
  values[key + '_n'] = String(count);
  cache.putAll(values, CACHE_SECONDS);
}
