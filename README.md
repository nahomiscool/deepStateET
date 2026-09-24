# DeepState ET

A [DeepState](https://deepstatemap.live)-style situation map for Ethiopia. It shows layers from a
Google My Maps map ([source](https://www.google.com/maps/d/viewer?mid=1XPJWGQgVK216o5nXwIpydH-y5ebbj24))
on top of Google Maps, with layer toggles, a colour legend, search, dated snapshots and an updates feed.
You can switch the background between Google Maps, Satellite, Terrain and a dark map.

It is a static site with no build step. The libraries (Leaflet, togeojson, JSZip) are copied into `vendor/`.

## Features

- **Change map.** Zones that changed hands since an earlier date are outlined and listed. You can compare with the previous snapshot, 7 days ago or 30 days ago. Click a change to fly to it.
- **Timeline.** Drag the slider or press play to watch control shift day by day. A link to a past date opens that date.
- **Control overview.** Zones, area in km² and share of territory for each controlling group, with the change against the comparison date.
- **Sources in popups.** Every data column of a zone or marker shows in its popup, and link values become "Source: site.com" links.
- **Events.** Markers with a `Date` column (or a KML timestamp) can be filtered to the last 7 or 30 days.
- **Three languages.** English, Amharic and Afaan Oromo, with a language menu in the top bar and a `?lang=am` / `?lang=om` link option.
- **Sharing.** Copy link, Telegram, WhatsApp, X and Facebook, plus a preview image for link cards (`img/og-image.png`).
- **Installs as an app.** Phones can add it to the home screen, and it shows the last loaded map offline. On phones the panel is a bottom drawer.
- **Reference layers.** Regions, administrative zones, woredas (shown from zoom 8), main roads and towns.
- **Updates feed, RSS and Telegram.** Manual updates plus automatic entries whenever a zone changes, published as `feed.xml` and optionally posted to Telegram.
- **Corrections.** "Report a correction" (or right-click / long-press the map) opens a GitHub issue form with the location filled in.
- **Fallback.** Until the first sync has run, the site shows the live Google My Maps view of the map.

## How the data gets in

You keep editing the map in **Google My Maps** as usual. The GitHub Action
`.github/workflows/sync-and-deploy.yml` ("Sync map") runs every 30 minutes and does the rest:

1. It downloads each layer listed under `layers` in `data/config.json` into `data/layers/<id>.kml`.
2. If a zone changed hands, it records the change in `data/changes.json` (these become the automatic updates).
3. If anything changed, it saves a daily snapshot in `data/history/<date>/`, rebuilds `feed.xml`, posts to Telegram if set up, and commits.
4. GitHub Pages publishes the updated site.

**Tip for the change map and statistics:** in My Maps, give your control layer a column such as `Controller`
and use *Style by data column* on it. The site then uses the column values as labels ("Group A: 14 zones").
Change detection matches zones by layer and name, so keep zone names stable.

Each layer becomes a toggle in the sidebar. The site keeps the colours, line widths and
fill opacity you set in My Maps. Popups show each place's description and its data columns.
If you styled a layer by a data column (for example "Controller"), the sidebar lists each colour with its value.

## Live data without GitHub Actions (Google Apps Script)

If the GitHub workflow can't run, the site can load your layers straight from Google through a small
script in your own Google account:

1. Open https://script.google.com and click **New project**.
2. Delete the sample code, paste the contents of [`tools/live-proxy.gs`](tools/live-proxy.gs), and click **Save**.
3. Click **Deploy → New deployment**, click the gear icon and choose **Web app**.
   Set *Execute as* to **Me** and *Who has access* to **Anyone**, then click **Deploy** and allow the permissions.
4. Copy the **Web app URL** (it ends in `/exec`) into `"liveProxy"` in `data/config.json`.

The map then shows your current layers, with switches, legend, search and statistics, and the date reads "Live".
The script only serves your own map, and asks Google for it at most once every 5 minutes.
The day-by-day history, change map, RSS and Telegram still come from the GitHub workflow.

## Adding a layer

1. In My Maps, open the layer's ⋮ menu and choose **Export to KML/KMZ**.
2. Pick the layer, tick **Keep data up to date with network link KML (KML only)**, and download the file.
3. Put it in `data/sources/` and run:

   ```sh
   node scripts/add-layer.mjs data/sources/<file>.kml
   ```

   This adds the layer's link to `layers` in `data/config.json`. You can also add an entry there by hand:
   `{ "id": "short-id", "name": "Layer name", "url": "<the href from the file>" }`.

The "Ethiopia Control Zones (by administrative zone)" layer is already added (`data/sources/control-zones.kml`).

## Setup

1. **Share the map publicly.** In My Maps, click *Share* and turn on *Anyone with this link can view*.
   If you skip this, Google won't serve the KML file and the sync step fails.
2. **Enable Pages.** In the repo, go to *Settings → Pages → Build and deployment*, choose **Deploy from a branch**,
   and pick the repository's default branch with the `/ (root)` folder.
3. **Check Actions.** In *Settings → Actions → General*, make sure Actions are allowed, and under *Workflow permissions*
   choose **Read and write permissions**. The **Sync map** workflow runs every 30 minutes, on every push, or from the *Actions* tab (*Run workflow*).

## Telegram (optional)

1. Create a bot with [@BotFather](https://t.me/BotFather) and add it as an admin of your channel.
2. In the repo, go to *Settings → Secrets and variables → Actions* and add `TELEGRAM_BOT_TOKEN`
   and `TELEGRAM_CHAT_ID` (for example `@yourchannel`).

The first run only records what already exists. After that, each sync posts new updates and zone changes.

## Configuration: `data/config.json`

| Key | Meaning |
| --- | --- |
| `title` | Name shown in the top bar and browser tab |
| `siteUrl` | Public address of the site, used by the RSS feed and Telegram posts |
| `repo` | `owner/name` of this repository, used for "Report a correction" |
| `googleMyMapsId` | The My Maps `mid`. Used for the "Source map" link, and synced as one whole-map layer when `layers` is empty |
| `layers` | Layers to sync and show: `{ "id", "name", "url" }` |
| `liveProxy` | Optional Google Apps Script web app URL that serves the live layers (see above) |
| `basemap` | Default background: `google-roadmap`, `google-hybrid`, `google-satellite`, `google-terrain` or `dark` |
| `center`, `zoom` | Initial view (`[lat, lng]`) |
| `legend` | Optional legend entries, e.g. `{ "color": "#c0392b", "label": "Controlled by X", "type": "polygon" }` (`type`: `polygon`, `line` or `point`) |

## Updates feed: `data/updates.json`

```json
[
  { "date": "2026-09-24T14:00", "text": "Short description of what changed.", "location": [11.6, 37.4], "zoom": 10 }
]
```

`location` and `zoom` are optional. When `location` is set, the entry gets a *Show on map* link.

## Run locally

```sh
node scripts/sync-map.mjs      # optional: fetch the latest map data
python3 -m http.server 8000    # then open http://localhost:8000
```

To preview a map without syncing it, drag a `.kml` or `.kmz` export onto the map.

## Credits

Boundaries (regions, zones, woredas): [geoBoundaries](https://www.geoboundaries.org) (CC BY 4.0).
Roads and towns: [Natural Earth](https://www.naturalearthdata.com) (public domain), plus a few towns added by hand.
Basemaps: © Google, © OpenStreetMap contributors, © CARTO.

The Amharic and Afaan Oromo text in `js/i18n.js` should be checked by a native speaker.
If you change the social preview address, update the `og:` tags in `index.html`.
