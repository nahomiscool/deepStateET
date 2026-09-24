// Minimal KML reading for the sync scripts (Node has no DOM). It reads the parts
// needed to compare two versions of a My Maps layer: folder, name, style and data columns.

const decode = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  .trim();

// Returns [{ group, name, key, style, fields, polygon }] in document order.
export function readPlacemarks(kml, fallbackGroup) {
  const out = [];
  const folders = [];
  const token = /<Folder\b[^>]*>|<\/Folder>|<Placemark\b[^>]*>[\s\S]*?<\/Placemark>/g;
  let m;
  while ((m = token.exec(kml))) {
    const tag = m[0];
    if (tag.startsWith('</Folder')) { folders.pop(); continue; }
    if (tag.startsWith('<Folder')) {
      // The folder's own <name> comes before any child element that has a name.
      const rest = kml.slice(token.lastIndex, token.lastIndex + 2000);
      const nm = rest.match(/^\s*<name>([\s\S]*?)<\/name>/);
      folders.push(nm ? decode(nm[1]) : 'Untitled layer');
      continue;
    }
    const name = decode((tag.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '');
    const style = ((tag.match(/<styleUrl>\s*#?([\s\S]*?)\s*<\/styleUrl>/) || [])[1] || '')
      .replace(/-(normal|highlight)$/, '');
    const fields = {};
    for (const d of tag.matchAll(/<Data name="([^"]*)">\s*<value>([\s\S]*?)<\/value>\s*<\/Data>/g)) {
      const v = decode(d[2]);
      if (v) fields[decode(d[1])] = v;
    }
    out.push({
      group: folders.length ? folders.join(' / ') : fallbackGroup,
      name,
      style,
      fields,
      polygon: /<Polygon\b/.test(tag)
    });
  }
  // Keys match the site's: "<layer>|<name>", with "#2", "#3"... for repeated names.
  const seen = new Map();
  for (const p of out) {
    const base = p.group + '|' + (p.name || '#');
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    p.key = n > 1 ? base + '#' + n : base;
  }
  return out;
}

// Same idea as the site: find the data column whose values match the styles one-to-one.
export function styleLabels(placemarks) {
  const styles = new Set(placemarks.map((p) => p.style));
  const labels = new Map();
  if (styles.size < 2) return labels;
  const columns = new Map();
  for (const p of placemarks) {
    for (const [col, val] of Object.entries(p.fields)) {
      if (!columns.has(col)) columns.set(col, new Map());
      const byStyle = columns.get(col);
      if (!byStyle.has(p.style)) byStyle.set(p.style, new Set());
      byStyle.get(p.style).add(val);
    }
  }
  for (const [, byStyle] of columns) {
    if (byStyle.size !== styles.size) continue;
    const values = [...byStyle.values()];
    if (!values.every((v) => v.size === 1)) continue;
    const flat = values.map((v) => [...v][0]);
    if (new Set(flat).size !== flat.length) continue;
    for (const [style, vals] of byStyle) labels.set(style, [...vals][0]);
    break;
  }
  return labels;
}

// Polygon changes between two versions of a layer file.
export function diffLayers(beforeKml, afterKml, fallbackGroup) {
  const describe = (kml) => {
    const placemarks = readPlacemarks(kml, fallbackGroup).filter((p) => p.polygon);
    const byGroup = new Map();
    for (const p of placemarks) {
      if (!byGroup.has(p.group)) byGroup.set(p.group, []);
      byGroup.get(p.group).push(p);
    }
    const map = new Map();
    for (const [, list] of byGroup) {
      const labels = styleLabels(list);
      for (const p of list) map.set(p.key, { name: p.name, group: p.group, label: labels.get(p.style) || '', state: labels.get(p.style) || p.style });
    }
    return map;
  };
  const before = describe(beforeKml);
  const after = describe(afterKml);
  const changes = [];
  for (const [key, a] of after) {
    const b = before.get(key);
    if (!b) changes.push({ type: 'added', key, name: a.name, layer: a.group, to: a.label });
    else if (b.state !== a.state) changes.push({ type: 'changed', key, name: a.name, layer: a.group, from: b.label || b.state, to: a.label || a.state });
  }
  for (const [key, b] of before) {
    if (!after.has(key)) changes.push({ type: 'removed', key, name: b.name, layer: b.group, from: b.label });
  }
  return changes;
}
