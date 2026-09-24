// Posts new updates and zone changes to a Telegram channel or group.
// Needs the TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID environment variables
// (GitHub: Settings → Secrets and variables → Actions). Does nothing without them.
// Remembers what it already posted in data/notified.json.
import { readFile, writeFile } from 'node:fs/promises';

const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_CHAT_ID;
if (!token || !chat) {
  console.log('Telegram not configured; skipping.');
  process.exit(0);
}

const root = new URL('../', import.meta.url);
const read = async (p, fallback) => JSON.parse(await readFile(new URL(p, root), 'utf8').catch(() => JSON.stringify(fallback)));
const config = await read('data/config.json', {});
const site = (config.siteUrl || 'https://nahomiscool.github.io/deepStateET/').replace(/\/?$/, '/');
const notified = await read('data/notified.json', null);

const describe = (c) => c.type === 'added' ? `${c.name}: added${c.to ? ` (${c.to})` : ''}`
  : c.type === 'removed' ? `${c.name}: removed` : `${c.name}: ${c.from} → ${c.to}`;
const items = [
  ...(await read('data/updates.json', [])).map((u) => ({ id: `update|${u.date}|${u.text}`, text: u.text })),
  ...(await read('data/changes.json', [])).map((c) => ({ id: c.id, text: describe(c) }))
];

if (notified === null) {
  // First run: remember everything that exists so old items aren't posted.
  await writeFile(new URL('data/notified.json', root), JSON.stringify(items.map((i) => i.id), null, 2) + '\n');
  console.log(`Telegram: marked ${items.length} existing item(s) as posted.`);
  process.exit(0);
}

const done = new Set(notified);
const fresh = items.filter((i) => !done.has(i.id));
if (!fresh.length) {
  console.log('Telegram: nothing new.');
  process.exit(0);
}

const lines = fresh.slice(0, 30).map((i) => '• ' + i.text);
if (fresh.length > 30) lines.push(`…and ${fresh.length - 30} more`);
const text = `${config.title || 'DeepState ET'} update\n\n${lines.join('\n')}\n\n${site}`;
const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chat_id: chat, text: text.slice(0, 4000), disable_web_page_preview: false })
});
if (!res.ok) {
  console.error(`::error::Telegram API returned HTTP ${res.status}`);
  process.exit(1);
}
fresh.forEach((i) => done.add(i.id));
await writeFile(new URL('data/notified.json', root), JSON.stringify([...done].slice(-2000), null, 2) + '\n');
console.log(`Telegram: posted ${fresh.length} item(s).`);
