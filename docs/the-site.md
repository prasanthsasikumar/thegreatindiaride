# The site

`index.html`, the map it draws, and the media library behind it. Back to the
[README](../README.md).

## The site

`index.html` is the whole site, and it tells the ride as a story. It implements two designs from the
"Great India Ride redesign" project (Claude Design `1e0800a2`), on one DOM:

- **≥1080px, Desktop A, Atlas Split.** A 460px sticky pane holds the brand, title,
  stats and the route map; the right column runs the legs, every region expanded.
- **<1080px, Journey.** Single column, a sticky strip of region chips, and regions
  as accordions.

The breakpoint is 1080px, not 900: the pane is a fixed 460px, so below that the legs
column drops to three columns, narrower than the mobile layout manages in its 600px
measure. Keep the CSS media queries and the `DESKTOP` matchMedia in `index.html` in
lockstep; the JS decides what collapses and the CSS decides how it looks.

Clip grids are `auto-fill` rather than a fixed column count, so tile size stays
constant and the count follows the width: 4 up on a phone, 8 on a wide desktop.

On pointer devices a tile plays muted on hover, one at a time. Sound preference in the
lightbox persists in localStorage.

Both use one dark palette, declared as custom properties at the top of `index.html`
and copied verbatim into `booklet.html`:

| token | value | |
|---|---|---|
| `--color-bg` | `#0f0f0f` | the page |
| `--color-surface` | `#17171b` | cards, the pane |
| `--color-text` | `#ffffff` | all text |
| `--color-muted` | `#bcbcbc` | secondary text |
| `--color-dim` | `#8a8a90` | labels, fine print |
| `--color-accent` | `#8b5cf6` | violet: figures, the route, active marks |
| `--color-accent-2` | `#ec4899` | pink: the live section, the eyebrow, the CTA sweep |

Type is Space Grotesk throughout, with IBM Plex Mono for figures. The accent is used
for marks and states, never for words, and there are no gradients.

That is why `booklet.html`'s print styles are a deliberate palette **inversion** and
not a pass-through: the screen is #0f0f0f and A4 is not, so its `@media print` block
reassigns those same tokens to paper and ink and every rule downstream follows.
Restyling rule by rule would have to be redone for every rule written afterwards.

The Hallmark banner at the top of `index.html`'s stylesheet still records the design
this was derived from (`modernist`, Archivo, #f3f2f2 paper, #ec3013 accent). It is
provenance and it is stale in exactly the way this paragraph used to be. Read the
tokens, not the banner.

Clips are grouped into five narrative legs (Out of Trivandrum, Up the west coast,
Into the Himalaya, Across the Northeast, Down the east coast home), then by region
inside each leg.

### Why reels are attached by region, not by date

The design's data layer groups everything by timestamp. That works for stories, which
are posted the same day. But **all 41 reels carry an upload time**, and they lag
capture by hours to weeks. Grouping them by their own date scattered Punjab and
Chandigarh into "Across the Northeast".

So legs and region blocks are built from stories, and each reel is attached to the
block for its own region. Only four regions appear in two legs; those pick the nearest
block by date. Three regions have reels but no stories (Goa, Daman, Puducherry) and get
their own block. All 222 clips appear, none of them in the wrong leg.

For the same reason, leg and region **date labels** are computed from stories only.
Letting reel dates set the range made "Into the Himalaya" read 1 Feb – 15 Mar when the
leg ends on 1 Mar.

### The map

The design fetched d3, topojson-client and a world-atlas TopoJSON from CDNs at runtime.
This reuses `basemap.json` instead: Natural Earth outlines baked in at ~32KB by
`build-basemap.cjs`, with a hand-rolled Mercator fit to India. Same drawing, and the
**map data** costs no external request: outlines, projection and route are all local,
so the map still draws with every third-party host blocked. That is the whole of the
claim. The page itself does reach out twice: Google Fonts, for Space Grotesk and IBM
Plex Mono, on every load; and OpenStreetMap tiles, but only while the real-map toggle
below is on.

The map has an **outline / real map toggle**. Outline is the default and fetches
nothing; the toggle lays OpenStreetMap tiles underneath, with attribution, and the
choice persists. Alignment is free, because the map already draws in Mercator, and Web
Mercator is the same projection up to a linear transform, so tiles land on the drawn
coastline with no reprojection.

**Build it from the `_ind` point-of-view file.** Natural Earth's default country set
draws India along the Line of Control, which clips Aksai Chin and Pakistan-administered
Kashmir. India stops at lat 35.5 instead of 37.05 and the northern tip is visibly cut
away. Natural Earth publishes per-country POV variants; `_ind` is India's own
depiction. It exists only at 10m:

```
curl -sSLO https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson
node scripts/build-basemap.cjs ne_10m_admin_0_countries_ind.geojson
```

Regenerating from the default file would silently reintroduce the clipped boundary.

Round coordinates *after* simplifying and keep 3 decimals. At 2 decimals every point
snapped to a ~1.1km grid, which staircased the coastline and made any tolerance finer
than that pointless.

**The line follows the places actually slept in, not region centroids.** It used to be a
polyline through one hardcoded centroid per state, which put "Nepal" in the far west of
the country and cut Rajasthan→Delhi straight through the middle of Haryana. It now walks
`route.stops` in travel order.

Markers cluster at 3.5px. India is 420px wide here, so a pixel is roughly 8km, and the
four Varanasi hotels, both Guwahati ones, and Mussoorie/Dehradun all land on the same dot.
Stacking them would leave every stop but the topmost unreachable, so co-located stops
merge into one marker and the card lists what's underneath.

Clicks resolve to the **nearest** marker rather than to whichever `<circle>` caught the
event, for the same reason: through Himachal and the Northeast the stops sit closer
together than a finger-sized target, so the hit circles overlap. A click on open sea
closes the card. The card flips above the map when its stop is in the lower third, so it
never covers the dot it describes.

Route data (region order, legs, nights, stop names, hotels and spend) comes from the trip
spreadsheet:

```
node scripts/build-route.cjs "/path/to/Pan India Trip  - Trip expenses.csv"
node scripts/generate-manifest.cjs
```

`build-route.cjs` treats each row as one night in travel order: the only exact record
of the route, since GPS drifts and upload times lag. Two adjustments live at the top of
that script:

- `SKIP_NIGHTS` drops rows that aren't on the motorcycle route. Row 71 (TVM) is the
  flight home mid-trip, out of Guwahati, on to Singapore, back to Guwahati.
- `ORIGIN` prepends home (Trivandrum) to the drawn path, since the ride started and
  finished at the same front door but the sheet only records paid nights.

Stop coordinates live in `.staycache.json`, keyed by the bare accommodation URL (the
sheet's links carry `?g_st=`/`?entry=` junk that differs between rows for the same
hotel). Every link resolves to the hotel's own coordinates.

Nights with no link in the sheet fall back to a `name:<Stop>` key in the same file:

| entry | treatment |
|---|---|
| `name:Coimbatore` | Decostel Backpackers Hostel: a real stay that never got a link; sited exactly |
| `name:Banglore`, `name:Allapuzha`, `name:Trivandrum` | `"private": true`, a friend's place and two family homes |

A `private` stay keeps its **name** but takes the town centre from `.stopcache.json`
rather than a real address, and is never given a Maps link. Those are other people's
houses; nothing on the site needs them pinned. The card says "approximate" for these and
"town centre" for a stop we genuinely know nothing about, so the two aren't confused.

Hyderabad and Kurnool are still unaccounted for and `build-route.cjs` warns about them
by name on every run.

Regions still come from the **stop name**, never from the hotel. A few stays sit just
over a border (Zirakpur for Chandigarh, Noida for Delhi, Phuentsholing for Jaigaon), and
re-deriving the region from their coordinates would silently delete chapters from the
narrative.

**Privacy: read before regenerating.** `route.json` is published, and it now carries a
`stops` list: every place slept, the hotel's name, its Google Maps link, and what was
paid there. That is a public, night-by-night record of where the rider was for three
months. It is published deliberately, because the map is meant to be browsable.

The `Misc_label` column is still excluded and should stay that way: it holds medical,
fines, scam and theft, and nothing in the UI needs it. Keep the CSV outside the repo.

### The overview

The hero's primary action plays the ride rather than scrolling it. The player walks
the region blocks in travel order, easing the map's viewBox to each one and driving
`jump()`, which is the same single mover the scroll handler uses. Dwell is 2600ms a
region; `prefers-reduced-motion` turns the viewBox easing off but not the player.

While it runs, the page's own scroll handler is held off. Without that, the scroll
`jump()` causes would bounce back and overwrite the block the player just chose. The
planned-route overlay is suppressed for the same reason (one line at a time on a map
that is already moving), and the suppression is view state only: the reader's stored
toggle choice is not read, not written and not restored, so leaving mid-playback
costs them nothing.

**Narration is plumbing, not a feature.** A leg in `LEGS` may carry
`narration: "media/narration/leg-01.m4a"`; the player will load and play it, pause it
with the transport and stop it on exit. No leg declares one today and no audio file
exists in the repo, so the speaker button in the control bar is hidden unless some leg
actually names a track. Nothing has to be removed if it stays that way.


## The media library

### Region tags

`tags.json` maps each file to the state/region it was shot in, plus its real capture
time, caption, and (for reels) its subtitle file. It's generated from an Instagram
data export:

```
node scripts/tag-media.cjs /path/to/instagram-<account>-<date>-<id>
node scripts/generate-manifest.cjs
```

`tag-media.cjs` reads GPS coordinates out of the export's EXIF data and reverse-geocodes
the unique points via OpenStreetMap's Nominatim API (rate-limited to 1 req/sec, so a
first run takes a couple of minutes). Results are cached in `.geocache.json`, so re-runs
are instant.

Each file records how its region was decided, in `stateSource`:

| value | meaning | trust |
|---|---|---|
| `gps` | the file's own EXIF coordinates | good, but phones cache stale fixes |
| `time` | nearest-in-time neighbour, no GPS of its own | **low**, shown with a `~` prefix |
| `manual` | corrected by hand via `overrides.json` | authoritative |

### Why the automatic guesses drift

204 of 222 files are `source_type: "library"`, uploaded from the camera roll rather
than shot in-app. For those, Instagram's `creation_timestamp` is the **upload** time.
Against the 59 files that also kept EXIF `date_time_original`, the median capture→upload
gap is 5.2 hours, p90 is 33 hours, and the max is 125 hours. On a road trip that is
easily one or more states of drift, so anything tagged `time` should be treated as a
placeholder.

`captured` uses EXIF `date_time_original` where it survived and falls back to upload
time otherwise; `timeSource` records which. (`modified` is just the checkout date and
is meaningless, and the browser UI sorts by `captured` to get ride order.)

### Correcting regions by hand

There is no browser UI for this any more: the media-library page that carried the
region dropdown was replaced by the journey layouts, and it is in git history at
`index.html`, commit `1a1b71f`. Edit `overrides.json` instead, a flat
`{ "media/...": "State" }` map, then re-run both generators:

```
node scripts/tag-media.cjs /path/to/instagram-export   # overrides win over GPS and timing
node scripts/generate-manifest.cjs
```

**Privacy:** `tags.json` deliberately carries only state and country, never raw
coordinates. `netlify.toml` publishes `.`, so anything committed is world-readable;
`.geocache.json` holds the ~1km coordinates and is gitignored.

To get an export: Instagram → Settings → Accounts Center → Your information and
permissions → Export your information. Choose **JSON** format. The download link
expires after 4 days.

### Garage media

Put vehicle/garage images & videos under `media/garage/` (any subfolder structure is fine).
Then run the manifest generator so the browser UI and `manifest.json` include the new category.

### Caching the research plates

`netlify.toml` serves `/media/*` as `immutable, max-age=31536000`. That is right for
the Instagram filenames, which are content-addressed IDs and never change, and it is
the rule that keeps ~800MB of video inside a 100GB/month allowance. It is wrong for
`media/research/fig-0N.jpg`, which are replaceable: those names are ours, and a
re-extracted plate under the same name would otherwise be served stale for a year to
anyone who had already loaded the page. Since these are other riders' photographs used
with credit, a correction or a takedown has to be able to reach people who have already
visited.

So `/media/research/*` carries its own `max-age=3600`. Where that rule sits in the file
is load-bearing, and the trap is in `netlify.toml`'s own comment: when several
`[[headers]]` blocks match one request, Netlify applies them in file order and the last
matching block wins. The narrower `/media/research/*` rule therefore sits **after**
`/media/*`, not before it. Move it above, as ordering intuition suggests, and the
catch-all silently overrides it and nothing appears to change.
