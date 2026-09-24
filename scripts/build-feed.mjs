// Builds feed.xml (RSS 2.0) from data/updates.json and the automatic data/changes.json.
// Usage: node scripts/build-feed.mjs
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = async (p, fallback) => JSON.parse(await readFile(new URL(p, root), 'utf8').catch(() => JSON.stringify(fallback)));

const config = await read('data/config.json', {});
const site = (config.siteUrl || 'https://nahomiscool.github.io/deepStateET/').replace(/\/?$/, '/');
const title = config.title || 'DeepState ET';
const escape = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

export function describeChange(c) {
  if (c.type === 'added') return `${c.name}: added${c.to ? ` (${c.to})` : ''}`;
  if (c.type === 'removed') return `${c.name}: removed`;
  return `${c.name}: ${c.from} → ${c.to}`;
}

const updates = (await read('data/updates.json', [])).map((u) => ({
  id: `update|${u.date}|${u.text}`, date: u.date, title: u.text, text: u.text
}));
const changes = (await read('data/changes.json', [])).map((c) => ({
  id: c.id, date: c.date, title: describeChange(c), text: `${describeChange(c)} (${c.layer})`
}));
const items = [...updates, ...changes]
  .sort((a, b) => (a.date < b.date ? 1 : -1))
  .slice(0, 100);

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escape(title)}</title>
  <link>${escape(site)}</link>
  <atom:link href="${escape(site)}feed.xml" rel="self" type="application/rss+xml"/>
  <description>Updates and changes of control on the ${escape(title)} map of Ethiopia.</description>
  <language>en</language>
${items.map((i) => `  <item>
    <title>${escape(i.title)}</title>
    <link>${escape(site)}</link>
    <guid isPermaLink="false">${escape(i.id)}</guid>
    <pubDate>${new Date(i.date).toUTCString()}</pubDate>
    <description>${escape(i.text)}</description>
  </item>`).join('\n')}
</channel>
</rss>
`;
await writeFile(new URL('feed.xml', root), xml);
console.log(`feed.xml: ${items.length} item(s)`);
