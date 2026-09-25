/**
 * DeepState ET: live data and dashboard backend (Google Apps Script).
 *
 * 1. Serves the current layers of your Google My Map to the website, so the map
 *    works without the GitHub sync workflow. Only the map below is served.
 * 2. Stores the written updates and event markers you add in the dashboard
 *    (admin.html) in a Google Sheet called "DeepState ET data" in your Drive.
 *
 * First-time setup:
 *  1. Go to https://script.google.com and click "New project".
 *  2. Delete the sample code, paste this whole file, and click Save.
 *  3. Change ADMIN_PASSWORD below to your own password.
 *  4. Choose "setup" in the function menu next to ▶ Run, click Run, and allow the permissions.
 *  5. Click Deploy → New deployment → gear icon → "Web app".
 *     Execute as: Me. Who has access: Anyone. Click Deploy and allow the permissions.
 *  6. Put the "Web app URL" (ends in /exec) in data/config.json as "liveProxy".
 *
 *  If posting says "You do not have permission to call SpreadsheetApp": choose "setup"
 *  in the function menu next to ▶ Run, click Run, and allow the permissions.
 *
 * Updating an existing deployment (keeps the same URL):
 *  Paste the new code, click Save, then Deploy → Manage deployments → pencil icon →
 *  Version: "New version" → Deploy.
 *
 * The map itself must be shared as "Anyone with this link can view".
 */
const MAP_ID = '1XPJWGQgVK216o5nXwIpydH-y5ebbj24';
const ADMIN_PASSWORD = 'change-me'; // ← choose your own password (at least 8 characters)
const CACHE_SECONDS = 300;          // Google is asked for each map layer at most once every 5 minutes

const SHEETS = {
  Updates: ['id', 'date', 'text', 'lat', 'lng', 'zoom'],
  Markers: ['id', 'date', 'title', 'type', 'description', 'source', 'lat', 'lng']
};

// ---------- one-time setup ----------

// Run this once from the editor: pick "setup" in the function menu next to ▶ Run, then click Run.
// Google then asks you to allow access to Sheets and external requests, which the web app
// needs but can't ask for by itself. The log shows the address of the data sheet.
function setup() {
  const ss = spreadsheet_();
  UrlFetchApp.fetch('https://www.google.com/maps/d/kml?forcekml=1&mid=' + MAP_ID, { muteHttpExceptions: true });
  console.log('Setup done. Data sheet: ' + ss.getUrl());
  if (ADMIN_PASSWORD === 'change-me' || ADMIN_PASSWORD.length < 8) {
    console.log('Now set ADMIN_PASSWORD at the top of the script (at least 8 characters), then deploy a new version.');
  }
}

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

// ---------- updates and markers (Google Sheet) ----------

function spreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SHEET_ID');
  let ss = null;
  if (id) {
    try { ss = SpreadsheetApp.openById(id); } catch (err) { ss = null; }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('DeepState ET data');
    props.setProperty('SHEET_ID', ss.getId());
  }
  for (const [name, headers] of Object.entries(SHEETS)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    }
  }
  const blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1) ss.deleteSheet(blank);
  return ss;
}

function rows_(ss, name) {
  const sheet = ss.getSheetByName(name);
  const values = sheet.getDataRange().getValues();
  const headers = values.shift();
  return values
    .filter((row) => row[0] !== '')
    .map((row) => Object.fromEntries(headers.map((h, i) => [h, row[i] instanceof Date ? row[i].toISOString() : row[i]])));
}

function readData_() {
  const ss = spreadsheet_();
  const num = (v) => (v === '' || v === null ? null : Number(v));
  return {
    updates: rows_(ss, 'Updates').map((r) => ({
      id: String(r.id), date: String(r.date), text: String(r.text),
      location: r.lat !== '' && r.lng !== '' ? [num(r.lat), num(r.lng)] : undefined,
      zoom: num(r.zoom) || undefined
    })),
    markers: rows_(ss, 'Markers').map((r) => ({
      id: String(r.id), date: String(r.date), title: String(r.title), type: String(r.type),
      description: String(r.description), source: String(r.source), lat: num(r.lat), lng: num(r.lng)
    }))
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
  spreadsheet_().getSheetByName('Updates').appendRow([id, date_(item.date), text, lat, lng, lat === '' ? '' : zoom]);
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
  spreadsheet_().getSheetByName('Markers').appendRow([
    id, date_(item.date), title, clean_(item.type, 40) || 'Other', clean_(item.description, 2000), source, lat, lng
  ]);
  return { ok: true, id };
}

function deleteRow_(sheetName, id) {
  if (!SHEETS[sheetName]) throw new Error('Unknown list');
  const sheet = spreadsheet_().getSheetByName(sheetName);
  const ids = sheet.getRange(1, 1, sheet.getLastRow(), 1).getValues();
  for (let i = ids.length - 1; i >= 1; i--) {
    if (String(ids[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  throw new Error('Not found (it may already be deleted)');
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
