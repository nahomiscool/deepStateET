# DeepState ET

A [DeepState](https://deepstatemap.live)-style situation map of Ethiopia:
**https://nahomiscool.github.io/deepStateET/**

## How it works

There are only two places where you change anything:

| What | Where |
| --- | --- |
| **Areas of control** (the coloured zones) | Your Google My Map: https://www.google.com/maps/d/edit?mid=1XPJWGQgVK216o5nXwIpydH-y5ebbj24 |
| **News and events** (clashes, airstrikes, captures…) | The dashboard: https://nahomiscool.github.io/deepStateET/admin.html |

A small Google Apps Script in your Google account (`tools/live-proxy.gs`) passes both to the site.
Changes show up the next time someone opens or refreshes the page (map zones within about 5 minutes).

## Posting news and events

1. Open the dashboard and log in with your password.
2. Pick what kind of post it is. Each type has its own icon on the map:
   News, Clash, Airstrike, Drone strike, Shelling, Captured / control change, Displacement, Protest, Other.
   The dashboard suggests a type from the words you type ("taken control" → Captured).
3. Write what happened, click the map where it happened (or search for a town), and press **Publish**.

News posts don't need a location. Events do, so they can appear on the map. Everything appears in the
"Latest news" list on the site, and anything with a location also appears on the map with its icon.
To remove a post, click **Delete** under "Your posts".

## Changing the zones

Edit the "Ethiopia Control Zones (by administrative zone)" layer in My Maps as usual.
For the "Who controls what" summary, give each zone a `Controller` value in the layer's data table and use
*Style by data column → Controller*. Keep zone names the same over time.

Points you add in My Maps also get icons: add a `Type` column (e.g. `Clash`, `Airstrike`), or use a word
like "drone" or "clash" in the name.

## Updating the Google Apps Script

Only needed when `tools/live-proxy.gs` changes:

1. Open https://script.google.com and your project.
2. Replace all the code with the new `tools/live-proxy.gs`, put your password back in `ADMIN_PASSWORD`, and **Save**.
3. **Deploy → Manage deployments → ✏️ → Version: New version → Deploy.** The URL stays the same.

The script only serves your own map and needs no extra permissions. It stores posts in its own storage
(about 500 KB, several hundred posts).

---

## Advanced

<details>
<summary>Files, settings and optional extras</summary>

- `index.html`, `js/app.js`, `css/style.css`: the public map. `js/events.js`: event types and icons
  ([Lucide](https://lucide.dev), ISC licence). `js/i18n.js`: English, Amharic and Afaan Oromo text
  (the Amharic and Oromo should be checked by a native speaker).
- `admin.html`, `js/admin.js`, `css/admin.css`: the dashboard.
- `data/config.json`: title, map id, `liveProxy` (the Apps Script URL), layers, start view, default basemap.
- `data/updates.json`: optional posts kept in the repository, e.g.
  `{ "date": "2026-09-25T10:00", "type": "clash", "text": "…", "location": [11.6, 37.4] }`.
- `data/*.geojson`: regions, zones, woredas (geoBoundaries, CC BY 4.0), roads and towns (Natural Earth).
- **History, change map, RSS and Telegram** come from the GitHub workflow `.github/workflows/sync-and-deploy.yml`,
  which saves a copy of the map every day. It is set to run by hand only, because GitHub Actions can't start
  jobs on this account at the moment. Once Actions works, add the `schedule` back (see the comment in the file).
  Telegram needs the repository secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
- More My Maps layers: export a layer with "Keep data up to date with network link KML", then run
  `node scripts/add-layer.mjs <file>.kml`.
- Local preview: `python3 -m http.server 8000`, then open http://localhost:8000. Dropping a `.kml`/`.kmz`
  file on the map previews it.

</details>
