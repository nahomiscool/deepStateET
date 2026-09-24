# DeepState ET

A [DeepState](https://deepstatemap.live)-style situation map for Ethiopia. It shows the layers of a
Google My Maps map ([source](https://www.google.com/maps/d/viewer?mid=1XPJWGQgVK216o5nXwIpydH-y5ebbj24))
on a dark, full-screen map with layer toggles, search, dated snapshots and an updates feed.

It is a static site with no build step. The libraries (Leaflet, togeojson, JSZip) are copied into `vendor/`.

## How the data gets in

You keep editing the map in **Google My Maps** as usual. The GitHub Action
`.github/workflows/sync-and-deploy.yml` runs every 30 minutes and does the rest:

1. It downloads the map as KML from `https://www.google.com/maps/d/kml?mid=<id>&forcekml=1` into `data/map.kml`.
2. If anything changed, it saves a daily snapshot in `data/history/` and commits both.
3. It publishes the site to GitHub Pages.

Each My Maps layer becomes a toggle in the sidebar. The site keeps the colours, line widths and
fill opacity you set in My Maps. Descriptions show in the popups, and links and images in them still work.

## Setup

1. **Share the map publicly.** In My Maps, click *Share* and turn on *Anyone with this link can view*.
   If you skip this, Google won't serve the KML file and the sync step fails.
2. **Enable Pages.** In the repo, go to *Settings → Pages → Build and deployment* and set the source to **GitHub Actions**.
3. **Merge to `main`** and run the **Sync & deploy** workflow once from the *Actions* tab (*Run workflow*).

To use a different map, change `googleMyMapsId` in `data/config.json`. The id is the `mid=` part of the map URL.

## Configuration: `data/config.json`

| Key | Meaning |
| --- | --- |
| `title` | Name shown in the top bar and browser tab |
| `googleMyMapsId` | The My Maps `mid` to sync from |
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

Regional boundaries: [geoBoundaries](https://www.geoboundaries.org) (CC BY 4.0). Basemaps: © OpenStreetMap contributors, © CARTO, Esri World Imagery.
