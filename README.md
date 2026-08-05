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

Open any tile in the browser UI. The **Region** field is a dropdown whose first group,
*Nearest*, is ranked by distance from that file's own coordinates, so the right answer
is usually in the top few. Pick it.

Corrections accumulate in `localStorage`, and a bar appears at the bottom of the page.
Click **Save overrides.json**, drop the file in the repo root, then:

```
node tag-media.cjs /path/to/instagram-export   # overrides win over GPS and timing
node generate-manifest.cjs
```

`overrides.json` is a flat `{ "media/...": "State" }` map, hand-editable if you'd
rather bulk-fix in a text editor.

**Privacy:** `tags.json` deliberately carries only state and country, never raw
coordinates. `netlify.toml` publishes `.`, so anything committed is world-readable;
`.geocache.json` holds the ~1km coordinates and is gitignored.

To get an export: Instagram → Settings → Accounts Center → Your information and
permissions → Export your information. Choose **JSON** format. The download link
expires after 4 days.

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
node build-basemap.cjs ne_10m_admin_0_countries_ind.geojson
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
node build-route.cjs "/path/to/Pan India Trip  - Trip expenses.csv"
node generate-manifest.cjs
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

## The template

`route.json` is what happened. `template.json` is the loop as it was **drawn**, and
the two differ on purpose: sections of the Northeast closed, and the weather windows
do not overlap. The site draws the planned loop under the ridden one, dashed, and the
route book is built entirely from the planned file.

It is generated from a second sheet, kept outside the repo like the expenses one:

```
node build-template.cjs "/path/to/Pan India Trip  - Itinerary.csv"
```

(Two spaces in that filename. It is Google Sheets' own export name.)

97 hops, 94 unique waypoints, 18,181.3 km, 411.93 riding hours, three countries, five
sectors. The sheet carries no accommodation and no spend, unlike the expenses sheet,
and it must stay that way: every rupee on the site comes from `route.json`'s
already-published aggregates, never from here.

**Sector boundaries are derived, not hardcoded.** `CROSSINGS` names the two places the
loop returns to, Bengaluru and Delhi, and the script cuts at every hop that *arrives*
at one: hops 4 and 93 for Bengaluru, 23 and 42 for Delhi. That is the whole rule.
Those recurrences are exactly where a rider can join the loop or leave it, which is
the point of publishing it as a template at all, so the sectors a reader is offered
are the ones the route itself actually creates. A hardcoded list would drift the first
time a waypoint moved.

One derived sector is too long to be a single unit: Delhi to Bengaluru is 51 hops and
three different kinds of riding. `SUBDIVIDE` cuts that one, and only that one, at
named waypoints rather than at indices, so the split survives the sheet gaining or
losing a row: S3a to Phuentsholing (Gangetic plain and Nepal), S3b to Agartala (Bhutan
and the Northeast), S3c to the end (east coast home).

The generator then asserts what the site states in copy: sector distances must re-sum
to the total, stages must re-sum to their sector, and every hop must have four finite
coordinates. If the sheet changes underneath, it fails here rather than publishing a
page that contradicts itself.

### Two numbers that do not agree, on purpose

The sheet's own total row says **18,039.2 km / 411 hours 13 mins**. Its hops sum to
**18,181.3 km / 411.93 hours**. The published figure is the sum, because the sum is
the thing every sector, stage and per-leg table is built from and a total row that
disagrees with its own rows cannot be reconciled by this script. The gap is 142.1 km.

Separately, and do not confuse the two: one hop is **Agartala to Kolkata at 1,523 km /
37 hours**. That is not a rideable day. It is the sheet routing around the Bangladesh
border the long way, and it is the only hop over `LONG_HOP_KM` (800). The totals
include it as-is and the generator warns about it by name on every run, so the one
figure most likely to be questioned stays visible rather than being quietly absorbed
or quietly dropped.

### `template-notes.json` is content, not data

Seasons, permits and points of interest are written by hand. Nothing generates them
and nothing should. `build-template.cjs` refuses to run if the file is missing, rather
than emitting a route book with silent holes where its guidance belongs.

Unwritten entries are the string `TO WRITE`, and the book renders them as a visible
dashed box reading "Not written yet", darker and larger in print than the table around
it. A reader **acts** on a route book: they ride in a month it names, or arrive at a
border without a permit. An admitted gap is better than invented advice, and it is
better than fine print. There are 15 such gaps today (five unwritten seasons, counted
twice because each appears on its own sector spread and again in the calendar; four
unwritten permit columns; and the planned-versus-ridden note). `test/booklet.test.cjs`
derives that count from the file rather than hardcoding it and then pins the result at
15, so a gap that quietly stops rendering fails the build, and filling one in is a
deliberate act with a visible diff.

`hoursPerDay` lives here too, at 6, and is the only input to the cost projection that
is not measured. It is shown to the reader beside the figure it produces.

A sector may also carry **`permitsShort`**, and only the S3 note does. Its permit note
is the longest written thing in the file and it printed twice in full, once on the
sector spread and once in the season calendar's Permits column, a screen apart. Where
`permitsShort` exists the calendar cell carries it instead: a cross-reference to the
spread, never a summary that could drift from the note it points at, and never a
substitute for writing the note. A missing `permitsShort` is not a gap and does not
render as one; a missing `permits` still does.

## K2K

Kanyakumari to Kashmir is the prestige pan-India route, and this loop already contains
most of one. `build-k2k.cjs` writes `k2k.json`:

```
node build-k2k.cjs
```

It is drawn the way it is ridden, as two lines up and down opposite sides of the
country, and the two lines have deliberately different kinds of number attached.

**Northbound is cited, never computed.** NH-44 is a documented public highway whose
length is published: commonly 3,745 km across 11 states, with some sources quoting
4,112 km. Both figures and their attribution live in one constant in the script and
nowhere else; neither page keeps a copy. The 16 cities strung together are a corridor
sketch of where that highway runs, and the length of that polyline is a drawing, not a
distance. It is never summed, never stored and never shown, which is why the `north`
object carries `measured: false` and has no `km` field at all.

**Southbound is measured**: 4,449.1 km, summed from 23 of this ride's own recorded
hops, resolved through the template's hop chain by Dijkstra over real distances rather
than hop counts. Nothing is re-measured and nothing is estimated. The line is drawn
through every intermediate stop those hops pass, because a line that skipped stops the
sum charges for would be a shorter drawing wearing a longer number. A hop used twice
is a fatal error, not a rounding problem.

**884 km of that total is the Kutch spur**, Rajkot out past Bhuj to Narayan Sarovar
and back through Dholavira to Palanpur. No K2K rider makes that detour. It cannot be
dropped either, because there is no measured direct Rajkot to Palanpur road in this
repo and inventing one is the single thing this script exists not to do. So it stays
in, is measured separately, and is disclosed on the K2K page of the book: without its
own figure a reader comparing 4,449 against 3,745 reads a difference between two
figures that were never measuring the same road.

The front page draws the two lines behind its **K2K** toggle and says nothing about
them. It used to carry five paragraphs of the same argument, a screen away from the
overlay they described and duplicating the book's page almost sentence for sentence.
The overlay is what a reader on that page uses; the argument needs the tables that
only the book has room for, so it lives there alone now.

Every written point carries `source: "template"` or `source: "nominatim"`, so
provenance survives into the data instead of living only in a comment. Six corridor
cities are not in `template.json` and are geocoded through the same rate-limited
Nominatim path `tag-media.cjs` uses (descriptive User-Agent, one request a second),
cached to the gitignored `.k2kcache.json`, so a re-run asks for nothing. Each query
names its state, because "Salem" alone is a town in Oregon, and each answer is checked
against an expected coordinate within half a degree. A geocode that lands outside
India refuses to write the file rather than drawing a line through the sea.

## The route book

`booklet.html` is a printable route book for the planned loop, offered from the hero
and from its own section rather than reprinted on the front page. It carries a cover
with the whole loop, the figures at a glance, a master map, one spread per sector
(map, stages, every waypoint with distance and hours), the K2K page, the cost
projection, the season and permit calendar, blank pages to plan on, the field-research
appendix, and a closing page listing the four files it is built from.

It shares `atlas.js` and `costs.js` with `index.html` rather than reimplementing
either. `netlify.toml` gives both a short cache life for that reason: a fix to one now
has to reach two pages.

**The screen is not the sheet.** Everything above the `@media screen` block in the
stylesheet is sized for A4, where 9.6pt held at arm's length is a normal reading size
and the constraint is fitting a sector spread on one sheet. Read on a monitor those
same sizes were a narrow strip of small grey type down the middle of a dark field, so
one screen-only block raises the scale by about a sixth, widens the shell to 1240px,
and spends the width it buys deliberately: a running head in the left margin, maps
beside the tables they belong to, the sector planner and the bike table side by side.
Prose stays capped in `ch` throughout, because a 1,200px line is not more readable
than a 700px one. `@media screen` never matches the printer, so none of it can move a
millimetre of the printed book: page count before and after is 39 sheets to 37, and
the two that went were prose, not layout.

**Nothing is printed twice.** The book is assembled from four data files by one
script, so the same string can reach the page from more than one direction without
anybody typing it twice: that is how the Northeast permit note ended up printing four
times and two whole field notes twice. Repetition was cut back to one canonical home
per fact, with cross-references where a reader still needs pointing (the season
calendar to Sector S3, the planning pages to Appendix Part V, Part II of the appendix
to the K2K page). Three tests in `test/booklet.test.cjs` **count printings** rather
than reading prose, so the duplication cannot quietly grow back. A cross-reference
into the appendix carries `.bk__xref`, which the print rules drop alongside
`.bk__research`: a pointer to Part V that survives into a print the reader chose to
leave the appendix out of is worse than no pointer.

**Print is a token inversion**, described under "The site" above. The one thing worth
repeating here is what it does to the map: `.atlas .india` drops its fill for a
hairline outline. A filled landmass is roughly 40% of an A4 page in toner. Tiles are
hidden outright, since they never print usefully, and the two K2K lines both go to
full black and are told apart by their dash pattern, because in a mono printer the
accent renders as a mid grey indistinguishable from the loop underneath.

The book has a sticky section nav, screen-only. Its coverage is **tied to the DOM by a
test**, not to a count: `test/booklet.test.cjs` scrapes every top-level
`<section class="bk__page">` out of the markup and requires each one to be either a
nav target or on a named (currently empty) allow-list, and requires every page built
at runtime to belong to one of the two grouped entries or to K2K's own. This is not
academic. The nav's first draft predated the K2K page, and `#bk-fork` did arrive
unreachable. A new page must fail the build, not go quietly missing.

### `atlas.js`

Lifted out of `index.html` so the booklet could draw the same map. It knows about
geography and nothing else: the Mercator fit, the tile transform, marker clustering at
3.5px, nearest-point click resolution, and the viewBox easing the overview uses.

What stayed behind is anything that knows about clips or regions: which stop belongs
to which region block, what a card says, what a badge reads, the leg and region
grouping, the hover-play behaviour. Those reach the renderer through callbacks
(`label`, `onSelect`, `onMiss`). Had they come along, the booklet would have had to
carry the clip model to draw a coastline.

### `costs.js`

The projection **invents no rate**. Every figure is derived from `route.json`'s
already-published aggregates: 93 nights, what was paid for beds, and what was paid for
everything else, giving ₹1,456 a night for a bed and ₹2,215 a night for fuel, food and
the rest. Those observed rates are then applied to the template's shape.

The counterintuitive result is the point. The template projects to **71 riding days
and ₹2,60,641**, which is *below* the **₹3,41,402** actually spent over 93 nights,
even though the loop is the longer route. The reason is that riding days are estimated
from riding hours at 6 hours a day and budget no rest days, while the real 93 nights
included rest, weather and sightseeing. Both the site and the book print that reason
in the same weight of type as the numbers, immediately against the table: as a
footnote it would be read last or not at all, and the book would leave a reader
believing the longer loop is the cheaper one. It is a floor, not a forecast, and it
carries no bike, no shipping, no flights and no repairs.

Both files are DOM-free and ES5-flavoured, which is also what lets the tests run them
headless under `node:vm` against the real source rather than a paraphrase.

## The research appendix

`research.json` is a transcription of the author's own field report on the xBhp
"Tourer" board, India's oldest motorcycling forum: 337 index pages, 3,317 travelogue
threads, of which 14 pan-India ride reports were read end to end, crawled 5 August
2026. It supplies the appendix at the back of the route book, the archive cost
benchmark, and the permit note for the Northeast. The book prints the report's own
caveats on its own numbers (the corpus counts are keyword-derived from URL slugs, and
the record table spans a change in the state count), because a reader who sees either
table without its caveat reads those figures as harder than they are.

The eight photographs in `media/research/` are **other riders' work**. They are
reproduced with their watermarks intact and a per-image credit line naming the
photographer, the board and the year. `figureBlock()` returns `null` when a record has
no credit, so an uncredited plate cannot reach the page at all, and the credit is
emitted inside the `<figure>` rather than somewhere nearby: it is the adjacency that
matters, and it is what survives a print that breaks pages. In print the figure is one
indivisible block and the image is capped in millimetres, so a photograph cannot be
cut in half by a sheet boundary or leave its credit stranded on the next one.

**Alt text is written from the image, never from the caption.** All eight were first
written from `figures.json`'s captions without anyone opening a file, and two of them
described a motorcycle in photographs that contain no motorcycle: fig-06 is a camel
and its rider on a dune at sunset, and fig-07 is the Golden Temple at night. Alt text
is the whole of an image for a screen-reader user, so inferring one from adjacent
prose is not a method. Caption knowledge that is not visible in the frame (distances,
place names, a pass the camera is not pointed at) does not belong in it either.

## Tests

```
node --test
```

Bare. **No path argument and no glob.** `node --test test/` fails on Node 22.23 with
`Cannot find module .../test`, because a directory argument is resolved as a module
path rather than as a place to look for tests.

86 tests, zero dependencies, Node's built-in runner. They cover the generator's CSV
parsing and sector derivation, the atlas's projection and clustering, the cost
projection, the K2K build, the overview, the route book (rendered headless under
`node:vm` against the real page source, stub DOM and stub `fetch`), and the house
style. The UI itself has no automated coverage; the per-task checklists in the plan are
the record of what to walk through by hand.

## House style

Browser files (`index.html`, `booklet.html`, `atlas.js`, `costs.js`) are ES5-flavoured:
`var` and `function () {}`, no arrow functions, no template literals, no optional
chaining. `.cjs` build scripts are under no such constraint and use modern syntax
freely.

**No em dashes anywhere.** `test/style.test.cjs` walks `git ls-files`, skips binaries,
and fails the build on any U+2014 with the file, the line and the surrounding sentence.
It is repo-wide rather than a list of the files that were wrong last time, because the
rule had already been broken three times by three different hands in files no scoped
test was watching.

Three exemptions, matching `SKIP_DIRS`, `QUOTED_THREAD_TITLES` and `CAPTION_ONLY` in
that file. The first is ours; the other two are somebody else's text:

- **Two directories**, skipped whole: `docs/superpowers/**`, the planning documents,
  which are never served to a reader; and `.superpowers/**`, gitignored scratch. Both
  are in `SKIP_DIRS`. Nothing else is skipped by path.
- **Five xBhp thread titles** in `research.json`'s reference list, quoted verbatim
  inside curly quotes and attributed by name. They are citations: a reader searching
  xBhp for one of these strings has to find the thread, and restyling somebody's title
  to suit our punctuation misquotes the source. This is an exact-string list, not a
  whole-file pass, so a new em dash anywhere else in `research.json` still fails.
- **Instagram captions** in `manifest.json` and `tags.json`, copied verbatim out of
  the data export. Both files are rewritten from the export every time `tag-media.cjs`
  and `generate-manifest.cjs` run, so an edit would be both a falsified record and a
  change that does not survive the next regeneration. The exemption is scoped to
  `"caption"` lines only; any other line in either file is in scope. If these ever do
  need sweeping, the fix belongs in the generators, not in the JSON.

The en dash is a different character doing a different job: a numeric range
(6,000–11,000 km, ₹100–200), a date range (23 Jan – 27 Mar), a route join
(Kolhapur–Belgaum). A sweep written against the wrong code point would silently take
those too, so a separate test pins every distinct en-dash-joined token in
`research.json` and `template-notes.json` and fails if any one of them is flattened.
The list moves when the transcription legitimately does, which is deliberate: these
are somebody else's words, so a range changing shape should cost a look.

Three ranges have since left `research.json` (6,000–11,000 km, ₹100–200 and
₹2,000–2,200), each of them a second printing of a figure whose canonical home is
elsewhere. Losing that home would take the range off the page entirely and the pinned
list can no longer catch it, so a second test asserts each one at the file it now
lives in: `k2k.json`, `template-notes.json` and `research.json`'s benchmark block.

## Caching the research plates

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

## Correcting region tags

There is no longer a browser UI for this. The media-library page that carried the
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
