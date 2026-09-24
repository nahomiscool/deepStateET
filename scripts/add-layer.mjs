// Adds the layers from Google My Maps "network link" KML files to data/config.json.
// In My Maps: layer menu (⋮) → Export to KML/KMZ → pick the layer →
// tick "Keep data up to date with network link KML" → download.
// Usage: node scripts/add-layer.mjs path/to/layer.kml [more.kml ...]
import { readFile, writeFile } from 'node:fs/promises';

const configUrl = new URL('../data/config.json', import.meta.url);
const config = JSON.parse(await readFile(configUrl, 'utf8'));
config.layers = config.layers || [];

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'layer';
const decode = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node scripts/add-layer.mjs layer.kml [...]');
  process.exit(1);
}

for (const file of files) {
  const xml = await readFile(file, 'utf8');
  const docName = decode((xml.match(/<Document>\s*<name>([\s\S]*?)<\/name>/) || [])[1] || '');
  const links = [...xml.matchAll(/<NetworkLink>([\s\S]*?)<\/NetworkLink>/g)];
  if (!links.length) console.warn(`${file}: no NetworkLink found`);
  for (const [, body] of links) {
    const href = decode((body.match(/<href>([\s\S]*?)<\/href>/) || [])[1] || '');
    if (!href) continue;
    const name = docName || decode((body.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '') || 'Layer';
    if (config.layers.some((l) => l.url === href)) {
      console.log(`Already added: ${name}`);
      continue;
    }
    let id = slug(name);
    for (let n = 2; config.layers.some((l) => l.id === id); n++) id = `${slug(name)}-${n}`;
    config.layers.push({ id, name, url: href });
    console.log(`Added layer "${name}" as ${id}`);
  }
}

await writeFile(configUrl, JSON.stringify(config, null, 2) + '\n');
