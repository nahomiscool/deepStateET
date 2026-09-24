// Downloads each Google My Maps layer listed in data/config.json ("layers") as KML
// into data/layers/<id>.kml. Keeps one snapshot per day in data/history/<date>/
// so the site can show earlier dates.
// Usage: node scripts/sync-map.mjs   (Node 18+, no dependencies)
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { diffLayers } from './lib/kml.mjs';

const root = new URL('../', import.meta.url);
const path = (p) => new URL(p, root);

const config = JSON.parse(await readFile(path('data/config.json'), 'utf8'));
let layers = config.layers || [];
if (!layers.length && config.googleMyMapsId) {
  // No layers listed: sync the whole map as a single file.
  layers = [{ id: 'map', name: 'Map', url: `https://www.google.com/maps/d/kml?forcekml=1&mid=${config.googleMyMapsId}` }];
}
if (!layers.length) {
  console.error('::error::No layers in data/config.json');
  process.exit(1);
}

async function download(url) {
  const u = new URL(url);
  u.searchParams.set('forcekml', '1'); // plain KML instead of a zipped KMZ
  // Links copied while signed in carry an account path (/u/0/); try without it too.
  const candidates = [u.toString()];
  const plain = u.toString().replace(/\/maps\/d\/u\/\d+\//, '/maps/d/');
  if (plain !== candidates[0]) candidates.push(plain);
  let lastError;
  for (const candidate of candidates) {
    const res = await fetch(candidate, { headers: { 'User-Agent': 'Mozilla/5.0 (DeepStateET map sync)' } });
    const text = await res.text();
    if (res.ok && text.includes('<kml')) return text;
    lastError = `HTTP ${res.status} from ${candidate}: ${text.slice(0, 200).replace(/\s+/g, ' ')}`;
  }
  throw new Error(lastError);
}

const now = new Date();
const day = now.toISOString().slice(0, 10);
const changed = [];
const detected = [];
let failed = 0;

await mkdir(path('data/layers/'), { recursive: true });
for (const layer of layers) {
  let kml;
  try {
    kml = await download(layer.url);
  } catch (err) {
    failed++;
    console.error(`::error::Layer "${layer.id}" failed to download (${err.message}). Make sure the map is shared as "Anyone with the link can view".`);
    continue;
  }
  const file = `data/layers/${layer.id}.kml`;
  const previous = await readFile(path(file), 'utf8').catch(() => null);
  if (previous === kml) {
    console.log(`${layer.id}: unchanged`);
    continue;
  }
  if (previous !== null) {
    for (const c of diffLayers(previous, kml, layer.name)) {
      detected.push({ id: `${now.toISOString()}|${c.key}`, date: now.toISOString(), ...c });
    }
  }
  await writeFile(path(file), kml);
  changed.push(layer.id);
  console.log(`${layer.id}: updated (${kml.length} bytes)`);
}

if (detected.length) {
  // Automatic entries for the updates feed, RSS and Telegram (newest 500 kept).
  const log = JSON.parse(await readFile(path('data/changes.json'), 'utf8').catch(() => '[]'));
  log.push(...detected);
  await writeFile(path('data/changes.json'), JSON.stringify(log.slice(-500), null, 2) + '\n');
  console.log(`${detected.length} zone change(s) recorded.`);
}

if (changed.length) {
  // Snapshot every layer (not just the changed ones) so each day is complete.
  await mkdir(path(`data/history/${day}/`), { recursive: true });
  const saved = [];
  for (const layer of layers) {
    const kml = await readFile(path(`data/layers/${layer.id}.kml`), 'utf8').catch(() => null);
    if (kml === null) continue;
    await writeFile(path(`data/history/${day}/${layer.id}.kml`), kml);
    saved.push(layer.id);
  }
  const index = JSON.parse(await readFile(path('data/history/index.json'), 'utf8').catch(() => '[]'))
    .filter((h) => h.date !== day);
  index.push({ date: day, layers: saved });
  index.sort((a, b) => a.date.localeCompare(b.date));
  await writeFile(path('data/history/index.json'), JSON.stringify(index, null, 2) + '\n');
  await writeFile(path('data/meta.json'), JSON.stringify({ syncedAt: now.toISOString() }, null, 2) + '\n');
}

if (failed === layers.length) process.exit(1);
