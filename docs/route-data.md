# The route data

How `template.json`, `k2k.json`, `research.json` and the route book are built, what
each of them refuses to guess, and why. Back to the [README](../README.md).

## The template

`route.json` is what happened. `template.json` is the loop as it was **drawn**, and
the two differ on purpose: sections of the Northeast closed, and the weather windows
do not overlap. The site draws the planned loop under the ridden one, dashed, and the
route book is built entirely from the planned file.

It is generated from a second sheet, kept outside the repo like the expenses one:

```
node scripts/build-template.cjs "/path/to/Pan India Trip  - Itinerary.csv"
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
node scripts/build-k2k.cjs
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
threads, of which 14 pan-India ride reports were read end to end, crawled in
2025. It supplies the appendix at the back of the route book, the archive cost
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


## Machine-readable front door

This material is meant to be found and quoted, by people and by the crawlers that
answer people's questions. `build-seo.cjs` writes the four things that needs:

| | |
|---|---|
| `robots.txt` | Everything allowed. The AI crawler tokens are named one by one rather than left to the wildcard: a bare `User-agent: *` already permits them, but several of those operators publish a token precisely so a site can state a position, and "allowed, deliberately" is a different statement from "never considered". |
| `sitemap.xml` | The two pages **and the seven data files**. A sitemap is usually pages only; here the JSON is the deliverable, and a crawler that never sees `template.json` cannot tell anyone it exists. |
| `llms.txt` | The [llmstxt.org](https://llmstxt.org) convention: one markdown page giving the whole picture, the sector table, what each file holds, and the caveats. Served as `text/markdown`. |
| schema.org JSON-LD | A `TouristTrip` whose itinerary is the five sectors, a `Dataset` with one `DataDownload` per file, and a `Person`, injected into both pages between markers. |

**The JSON-LD is injected rather than fetched, and that is the whole point.** Both
pages build their figures from `template.json` at load time, which is right for a
reader with a browser and useless to a crawler that does not run scripts. So the
numbers are baked into the markup, and `build-seo.cjs` is what bakes them.

That would normally be exactly the drift this repo argues against, and
`test/routebook.test.cjs` still bans a hand-typed distance anywhere else in the page.
What makes the exception safe is `test/seo.test.cjs`: it rebuilds every artefact from
the data files and requires the committed copy to match byte for byte. A sheet that was
rebuilt without re-running the generator fails the build rather than shipping a stale
number to a machine that will repeat it. If one of those tests fails, the fix is
`node scripts/build-seo.cjs`, never an edit to the file it complains about.

The caveats travel into the machine-readable copy too, for the same reason they are on
the page: the `TechArticle` for the route book carries a `disambiguatingDescription`
saying how many guidance notes are unwritten, and `llms.txt` has a "what this material
does not claim" section. Something summarising this route without its holes would be
more dangerous than no summary at all.
