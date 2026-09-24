# DeepState ET

A [DeepState](https://deepstatemap.live)-style situation map for Ethiopia. It shows layers from a
Google My Maps map ([source](https://www.google.com/maps/d/viewer?mid=1XPJWGQgVK216o5nXwIpydH-y5ebbj24))
on top of Google Maps, with layer toggles, a colour legend, search, dated snapshots and an updates feed.
You can switch the background between Google Maps, Satellite, Terrain and a dark map.

It is a static site with no build step. The libraries (Leaflet, togeojson, JSZip) are copied into `vendor/`.

## How the data gets in

You keep editing the map in **Google My Maps** as usual. The GitHub Action
`.github/workflows/sync-and-deploy.yml` runs every 30 minutes and does the rest:

1. It downloads each layer listed under `layers` in `data/config.json` into `data/layers/<id>.kml`.
2. If anything changed, it saves a daily snapshot in `data/history/<date>/` and commits it.
3. It publishes the site to GitHub Pages.

Each layer becomes a toggle in the sidebar. The site keeps the colours, line widths and
fill opacity you set in My Maps. Popups show each place's description and its data columns.
If you styled a layer by a data column (for example "Controller"), the sidebar lists each colour with its value.

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
2. **Enable Pages.** In the repo, go to *Settings → Pages → Build and deployment* and set the source to **GitHub Actions**.
3. **Merge to `main`** and run the **Sync & deploy** workflow once from the *Actions* tab (*Run workflow*).

## Configuration: `data/config.json`

| Key | Meaning |
| --- | --- |
| `title` | Name shown in the top bar and browser tab |
| `googleMyMapsId` | The My Maps `mid`. Used for the "Source map" link, and synced as one whole-map layer when `layers` is empty |
| `layers` | Layers to sync and show: `{ "id", "name", "url" }` |
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

Regional boundaries: [geoBoundaries](https://www.geoboundaries.org) (CC BY 4.0). Basemaps: © Google, © OpenStreetMap contributors, © CARTO.
