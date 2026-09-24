/**
 * DeepState ET live data proxy (Google Apps Script).
 *
 * Lets the website load the current layers of your Google My Map directly,
 * without the GitHub sync workflow. It only serves the one map below, so it
 * can't be used to fetch anything else.
 *
 * Setup (about 2 minutes):
 *  1. Go to https://script.google.com and click "New project".
 *  2. Delete the sample code, paste this whole file, and click Save.
 *  3. Click Deploy → New deployment → the gear icon → "Web app".
 *     - Execute as: Me
 *     - Who has access: Anyone
 *  4. Click Deploy, allow the permissions it asks for, and copy the "Web app URL"
 *     (it ends in /exec).
 *  5. Put that URL in data/config.json as "liveProxy".
 *
 * The map itself must be shared as "Anyone with this link can view".
 */
const MAP_ID = '1XPJWGQgVK216o5nXwIpydH-y5ebbj24';
const CACHE_SECONDS = 300; // Google is asked at most once every 5 minutes per layer

function doGet(e) {
  const lid = String((e && e.parameter && e.parameter.lid) || '').replace(/[^A-Za-z0-9_-]/g, '');
  const kml = getKml_(lid);
  return ContentService.createTextOutput(kml).setMimeType(ContentService.MimeType.XML);
}

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
