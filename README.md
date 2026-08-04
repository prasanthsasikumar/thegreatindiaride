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

## The journey page

`journey.html` tells the ride as a story: one chapter per region **in travel order**,
with the stops, nights, dates, clips and a route map drawn from the stop coordinates.
`index.html` stays the utility view for grabbing assets. Both read the same
`manifest.json`.

Route data comes from the trip spreadsheet:

```
node build-route.cjs "/path/to/Pan India Trip  - Trip expenses.csv"
node generate-manifest.cjs
```

`build-route.cjs` treats each row as one night in travel order — the only exact record
of the route, since GPS drifts and upload times lag. It writes `route.json` with the
region order, legs, stop names and town-centre coordinates.

Two adjustments live at the top of that script:

- `SKIP_NIGHTS` drops rows that aren't on the motorcycle route. Row 71 (TVM) is the
  flight home mid-trip — out of Guwahati, on to Singapore, back to Guwahati. Leaving it
  in dropped a phantom Kerala chapter into the middle of the northeast.
- `ORIGIN` prepends home (Trivandrum) to the drawn path. The ride started and finished
  at the same front door, but the sheet only records nights that were paid for, so the
  first row is Kanyakumari. The origin is added to the map line only — not to legs,
  nights or region order, since Kerala already closes the story as the homecoming.

The map is drawn from `basemap.json` — Natural Earth coastlines, simplified and baked
in by `build-basemap.cjs` (20KB). No tile provider, so no external request on page view
for a map that never pans or zooms.

**Privacy:** `route.json` carries only region-level spend aggregates and the trip
total. It never includes per-night lines, the `Misc_label` column (medical, fines,
theft) or the `Accomodation Link` column. Keep the CSV outside the repo.

Regions ridden through more than once (Assam five times, Kerala twice via the flight
home) collapse into a single chapter, which is labelled with a visit count so the date
range doesn't look like a mistake.

## Local Development

`index.html` fetches `manifest.json`, which browsers block over `file://`. Serve the
folder instead:

```
python3 -m http.server 8899   # then open http://127.0.0.1:8899/
```
