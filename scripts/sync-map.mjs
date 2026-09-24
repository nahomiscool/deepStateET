// Downloads the Google My Maps layer data as KML into data/map.kml.
// Keeps one snapshot per day in data/history/ so the site can show earlier dates.
// Usage: node scripts/sync-map.mjs   (Node 18+, no dependencies)
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const path = (p) => new URL(p, root);

const config = JSON.parse(await readFile(path('data/config.json'), 'utf8'));
const mid = process.env.MY_MAPS_ID || config.googleMyMapsId;
if (!mid) {
  console.error('No map id: set googleMyMapsId in data/config.json');
  process.exit(1);
}

const url = `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(mid)}&forcekml=1`;
const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (DeepStateET map sync)' } });
const kml = await res.text();
if (!res.ok || !kml.includes('<kml')) {
  console.error(`::error::Failed to download KML (HTTP ${res.status}). Make sure the map is shared as "Anyone with the link can view".`);
  process.exit(1);
}

const previous = await readFile(path('data/map.kml'), 'utf8').catch(() => null);
if (previous === kml) {
  console.log('Map unchanged.');
  process.exit(0);
}

const now = new Date();
const day = now.toISOString().slice(0, 10);
await mkdir(path('data/history/'), { recursive: true });
await writeFile(path('data/map.kml'), kml);
await writeFile(path(`data/history/${day}.kml`), kml);

const index = JSON.parse(await readFile(path('data/history/index.json'), 'utf8').catch(() => '[]'))
  .filter((h) => h.date !== day);
index.push({ date: day, file: `${day}.kml` });
index.sort((a, b) => a.date.localeCompare(b.date));
await writeFile(path('data/history/index.json'), JSON.stringify(index, null, 2) + '\n');
await writeFile(path('data/meta.json'), JSON.stringify({ syncedAt: now.toISOString() }, null, 2) + '\n');

console.log(`Map updated (${kml.length} bytes), snapshot ${day}.`);
