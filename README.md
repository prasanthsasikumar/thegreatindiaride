# Ride Assets - Media Hosting

This repository hosts media assets (images and videos) for prasanthsasikumar.com ride pages.

## Structure

```
media/
  ├── stories/     # Instagram stories organized by date
  ├── reels/       # Instagram reels
  ├── profile/     # Profile pictures
  └── garage/      # Vehicle + garage media (cars, motorcycles, tours)
```

## Usage

Assets are accessible via:
```
https://[your-netlify-url]/media/stories/202501/filename.mp4
```

## Deployment

This is deployed as a static site on Netlify with CORS enabled for cross-origin requests from the main website.

## Garage media

Put vehicle/garage images & videos under `media/garage/` (any subfolder structure is fine).
Then run the manifest generator so the browser UI and `manifest.json` include the new category.

## Region tags

`tags.json` maps each file to the state/region it was shot in, plus its real capture
time, caption, and (for reels) its subtitle file. It's generated from an Instagram
data export:

```
node tag-media.cjs /path/to/instagram-<account>-<date>-<id>
node generate-manifest.cjs
```

`tag-media.cjs` reads GPS coordinates out of the export's EXIF data and reverse-geocodes
the unique points via OpenStreetMap's Nominatim API (rate-limited to 1 req/sec, so a
first run takes a couple of minutes). Results are cached in `.geocache.json`, so re-runs
are instant.

Each file records how its region was decided, in `stateSource`:

| value | meaning | trust |
|---|---|---|
| `gps` | the file's own EXIF coordinates | good, but phones cache stale fixes |
| `time` | nearest-in-time neighbour, no GPS of its own | **low** — shown with a `~` prefix |
| `manual` | corrected by hand via `overrides.json` | authoritative |

### Why the automatic guesses drift

204 of 222 files are `source_type: "library"` — uploaded from the camera roll rather
than shot in-app. For those, Instagram's `creation_timestamp` is the **upload** time.
Against the 59 files that also kept EXIF `date_time_original`, the median capture→upload
gap is 5.2 hours, p90 is 33 hours, and the max is 125 hours. On a road trip that is
easily one or more states of drift, so anything tagged `time` should be treated as a
placeholder.

`captured` uses EXIF `date_time_original` where it survived and falls back to upload
time otherwise; `timeSource` records which. (`modified` is just the checkout date and
is meaningless — the browser UI sorts by `captured` to get ride order.)

### Correcting regions by hand

Open any tile in the browser UI. The **Region** field is a dropdown whose first group,
*Nearest*, is ranked by distance from that file's own coordinates — the right answer is
usually in the top few. Pick it.

Corrections accumulate in `localStorage`, and a bar appears at the bottom of the page.
Click **Save overrides.json**, drop the file in the repo root, then:

```
node tag-media.cjs /path/to/instagram-export   # overrides win over GPS and timing
node generate-manifest.cjs
```

`overrides.json` is a flat `{ "media/...": "State" }` map — hand-editable if you'd
rather bulk-fix in a text editor.

**Privacy:** `tags.json` deliberately carries only state and country, never raw
coordinates. `netlify.toml` publishes `.`, so anything committed is world-readable;
`.geocache.json` holds the ~1km coordinates and is gitignored.

To get an export: Instagram → Settings → Accounts Center → Your information and
permissions → Export your information. Choose **JSON** format. The download link
expires after 4 days.

## The site

`index.html` is the whole site — it tells the ride as a story. It implements two designs from the
"Great India Ride redesign" project (Claude Design `1e0800a2`), on one DOM:

- **≥900px — Desktop A, Atlas Split.** A 460px sticky pane holds the brand, title,
  stats and the route map; the right column runs the legs, every region expanded.
- **<900px — Journey.** Single column, a sticky strip of region chips, and regions
  as accordions that expand into a 3-up grid.

Both use the `modernist` design system: Archivo throughout, #f3f2f2 paper, #201e1d
ink, #ec3013 accent, square corners, grayscale video thumbnails.

Clips are grouped into five narrative legs (Out of Trivandrum, Up the west coast,
Into the Himalaya, Across the Northeast, Down the east coast home), then by region
inside each leg.

### Why reels are attached by region, not by date

The design's data layer groups everything by timestamp. That works for stories, which
are posted the same day — but **all 41 reels carry an upload time**, and they lag
capture by hours to weeks. Grouping them by their own date scattered Punjab and
Chandigarh into "Across the Northeast".

So legs and region blocks are built from stories, and each reel is attached to the
block for its own region. Only four regions appear in two legs; those pick the nearest
block by date. Three regions have reels but no stories (Goa, Daman, Puducherry) and get
their own block. All 222 clips appear, none of them in the wrong leg.

For the same reason, leg and region **date labels** are computed from stories only —
letting reel dates set the range made "Into the Himalaya" read 1 Feb – 15 Mar when the
leg ends on 1 Mar.

### The map

The design fetched d3, topojson-client and a world-atlas TopoJSON from CDNs at runtime.
This reuses `basemap.json` instead — the same Natural Earth outlines, baked in at 20KB
by `build-basemap.cjs`, with a hand-rolled Mercator fit to India. Same drawing, no
external requests, works offline.

Region centroids come from the design's `india-map.js`.

Route data (region order, legs, nights, stop names) comes from the trip spreadsheet:

```
node build-route.cjs "/path/to/Pan India Trip  - Trip expenses.csv"
node generate-manifest.cjs
```

`build-route.cjs` treats each row as one night in travel order — the only exact record
of the route, since GPS drifts and upload times lag. Two adjustments live at the top of
that script:

- `SKIP_NIGHTS` drops rows that aren't on the motorcycle route. Row 71 (TVM) is the
  flight home mid-trip — out of Guwahati, on to Singapore, back to Guwahati.
- `ORIGIN` prepends home (Trivandrum) to the drawn path, since the ride started and
  finished at the same front door but the sheet only records paid nights.

**Privacy:** `route.json` carries only region-level spend aggregates and the trip
total. It never includes per-night lines, the `Misc_label` column (medical, fines,
theft) or the `Accomodation Link` column. Keep the CSV outside the repo.

## Correcting region tags

There is no longer a browser UI for this — the media-library page that carried the
region dropdown was replaced by the journey layouts. Edit `overrides.json` by hand
(a flat `{ "media/...": "State" }` map), then re-run:

```
node tag-media.cjs /path/to/instagram-export
node generate-manifest.cjs
```

`tag-media.cjs` still applies overrides ahead of GPS and timing, exactly as before.
The previous library UI is in git history at `index.html`, commit `1a1b71f`.

## Local Development

`index.html` fetches `manifest.json`, which browsers block over `file://`. Serve the
folder instead:

```
python3 -m http.server 8899   # then open http://127.0.0.1:8899/
```
