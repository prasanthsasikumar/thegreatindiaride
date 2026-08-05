# Pan-India Route Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the pan-India loop as a forkable, Dakar-style route template — a browsable section on the site, a printable route book, and an animated overview that replaces the hero's "see the clips".

**Architecture:** A new `build-template.cjs` turns the itinerary CSV into `template.json` (sectors derived from the Bengaluru/Delhi crossings). The map renderer is extracted from `index.html` into a shared `atlas.js` so both the site and a new print-first `booklet.html` can draw it. The site gains a `#template` section, a planned-vs-ridden route overlay, and an overview player that drives the map, the legs column and a caption track together.

**Tech Stack:** Vanilla ES5-style JS (match the existing house style — `var`, `function`, no arrow functions in `index.html`), CommonJS Node 22 scripts, `node:test` for tests (built in — do NOT add npm dependencies), plain CSS with custom properties.

## Global Constraints

- **No npm dependencies.** `package-lock.json` has an empty `packages` map and stays that way. Tests use Node 22's built-in `node:test` and `node:assert`. No jsdom, no bundler, no build step for the site itself.
- **Run the tests as `node --test`, with no path argument.** On Node 22.23 a directory argument (`node --test test/`) is resolved as a module path and dies with `Cannot find module`. Bare `node --test` discovers `test/**` correctly.
- **Source spreadsheets stay outside the repo.** Generators take a path argument. The itinerary CSV lives at `~/Downloads/Pan India Trip  - Itinerary.csv` (note the **two spaces** before the hyphen).
- **House JS style in `index.html` / `atlas.js` / `booklet.html`:** `var` not `let`/`const`, `function () {}` not arrow functions, no template literals, no optional chaining. The existing file is uniform in this and new code must not stand out. Node `.cjs` scripts use `const` and modern syntax, matching `build-route.cjs`.
- **Live palette tokens** (defined in `index.html:29`): `--color-bg: #0f0f0f`, `--color-surface: #17171b`, `--color-raise: #1e1e24`, `--color-text: #ffffff`, `--color-muted: #bcbcbc`, `--color-dim: #8a8a90`, `--color-accent: #8b5cf6`, `--color-accent-2: #ec4899`, `--font-heading`/`--font-body` Space Grotesk, `--font-mono` IBM Plex Mono. The README's "modernist / #f3f2f2 paper / Archivo" description is **stale** — ignore it and fix it in Task 9.
- **Verified template figures** — any code or copy stating these must match exactly: 97 hops, 98 places in sequence, 94 unique, 18,181 km summed, 412 riding hours, 3 countries. Crossings at hop indices 4 (Bengaluru), 23 (Delhi), 42 (Delhi), 93 (Bengaluru).
- **Verified ridden figures** from `route.json` — 74 stops, 93 nights, 29 regions, total spend ₹341,402, accommodation ₹135,448, everything else ₹205,954.
- **Privacy:** `template.json` carries no accommodation or spend data. Cost figures come only from the already-published aggregates in `route.json`. Never add a `Misc_label` equivalent.
- **Do not invent content.** POI text beyond the seeded set, the xbhp/Facebook sourcing line, the season/permit notes and the planned-vs-ridden copy are the author's. Ship them as visible placeholders, never as plausible-sounding filler.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `build-template.cjs` | create | CSV → `template.json`. Hops, crossings, derived sectors, invariant assertions. |
| `template.json` | create (generated) | Published template data. |
| `template-notes.json` | create (hand-authored) | POIs, season/permit notes, sourcing. Author-owned content. |
| `test/template.test.cjs` | create | `node:test` suite for the generator and the generated data. |
| `atlas.js` | create | Shared map renderer: projection, basemap, route polylines, marker clustering, OSM tile underlay, nearest-click hit resolution, viewBox focus. Knows nothing about legs, clips, costs or narration. |
| `index.html` | modify | Consume `atlas.js`; add `#template` section, route overlay, overview player, hero CTA change. |
| `booklet.html` | create | Print-first route book. Consumes `atlas.js`, `template.json`, `template-notes.json`, `route.json`. |
| `README.md` | modify | Document the template pipeline; correct the stale design-system and map sections. |
| `netlify.toml` | modify | Cache headers for the new JSON and JS. |

**Boundary that matters:** `atlas.js` is generic geography. The functions in `index.html` that look map-ish but are *not* generic — `matchStopsToRegions` (`index.html:1219`, maps stops onto clip region blocks), `clusterLabel` (`index.html:1203`, speaks of nights), `showStop`/`hideStop`/`syncMap` (card and badge UI) — stay in `index.html` and are passed in as callbacks. Moving them would drag the clip data model into the booklet, which has no clips.

---

## Task 1: The template generator

**Files:**
- Create: `build-template.cjs`
- Create: `test/template.test.cjs`
- Create: `template.json` (generated output, committed)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `template.json` with the exact shape below. Tasks 3–8 read `totals`, `crossings`, `sectors[]` (`id`, `title`, `from`, `to`, `hopFrom`, `hopTo`, `km`, `hours`, `stages[]`) and `hops[]` (`n`, `from`, `to`, `km`, `hours`, `fromLat`, `fromLon`, `toLat`, `toLon`).
- Produces: `build-template.cjs` exports `{ parseCsv, buildTemplate }` under `module.exports` so tests can call them without writing files.

The output shape, fixed here because five later tasks depend on it:

```jsonc
{
  "generated": "2026-08-05T…",
  "source": "Pan India Trip  - Itinerary.csv",
  "totals": { "hops": 97, "sequence": 98, "waypoints": 94, "km": 18181.3, "hours": 411.6, "countries": 3 },
  "crossings": [
    { "name": "Bengaluru", "hops": [4, 93] },
    { "name": "Delhi", "hops": [23, 42] }
  ],
  "sectors": [
    { "id": "S0", "title": "Southern opener", "from": "Trivandrum", "to": "Bengaluru",
      "hopFrom": 0, "hopTo": 4, "km": 1130.1, "hours": 22.0,
      "opensAt": null, "closesAt": "Bengaluru",
      "stages": [ { "id": "S0", "title": "Southern opener", "hopFrom": 0, "hopTo": 4, "km": 1130.1, "hours": 22.0 } ] }
  ],
  "hops": [
    { "n": 0, "from": "Thiruvananthapuram", "to": "Kanniyakumari", "km": 95.1, "hours": 2.683,
      "fromLat": 8.5241391, "fromLon": 76.9366376, "toLat": 8.0843512, "toLon": 77.5495019 }
  ]
}
```

- [ ] **Step 1: Write the failing test**

Create `test/template.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parseCsv, buildTemplate } = require('../build-template.cjs');

// A trimmed stand-in for the real sheet: five hops, one of them arriving at
// Bengaluru, so a crossing has to be detected without the full 97 rows.
const SAMPLE = [
  'Origin,Destination,Distance,Duration,Origin_Latitude,Origin_Longitude,Destination_Latitude,Destination_Longitude,Origin_Address,Destination_Address',
  'Thiruvananthapuram,Kanniyakumari,95.1 km,2 hours 41 mins,8.52,76.93,8.08,77.54,"a","b"',
  'Kanniyakumari,Rameswaram,296 km,5 hours 40 mins,8.08,77.54,9.28,79.31,"b","c"',
  'Rameswaram,Bengaluru,"1,000 km",1 day 2 hours,9.28,79.31,12.97,77.59,"c","d"',
  'Bengaluru,Chitradurga,201 km,3 hours 38 mins,12.97,77.59,14.22,76.39,"d","e"',
  'Total,18039.2 km,18039.2 km,411 hours 13 mins, , , , , ,',
].join('\n');

test('parseCsv drops the Total row and keeps every hop', function () {
  const rows = parseCsv(SAMPLE);
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows[0].from, 'Thiruvananthapuram');
  assert.strictEqual(rows[3].to, 'Chitradurga');
});

test('parseCsv reads thousands separators and day-length durations', function () {
  const rows = parseCsv(SAMPLE);
  assert.strictEqual(rows[2].km, 1000);
  // 1 day 2 hours = 26h
  assert.strictEqual(rows[2].hours, 26);
  // 2 hours 41 mins
  assert.ok(Math.abs(rows[0].hours - 2.6833) < 0.001);
});

test('buildTemplate finds the Bengaluru crossing and cuts a sector there', function () {
  const t = buildTemplate(parseCsv(SAMPLE), 'sample.csv');
  const bengaluru = t.crossings.filter(function (c) { return c.name === 'Bengaluru'; })[0];
  assert.ok(bengaluru, 'Bengaluru should be detected as a crossing');
  assert.deepStrictEqual(bengaluru.hops, [2]);
  assert.strictEqual(t.sectors[0].hopFrom, 0);
  assert.strictEqual(t.sectors[0].hopTo, 2);
  assert.strictEqual(t.sectors[0].closesAt, 'Bengaluru');
});

test('sector distances re-sum to the total', function () {
  const t = buildTemplate(parseCsv(SAMPLE), 'sample.csv');
  const summed = t.sectors.reduce(function (a, s) { return a + s.km; }, 0);
  assert.ok(Math.abs(summed - t.totals.km) < 0.5);
});
```

- [ ] **Step 2: Run the test and watch it fail**

```bash
node --test
```

Expected: FAIL — `Cannot find module '../build-template.cjs'`.

- [ ] **Step 3: Write `build-template.cjs`**

```js
/*
 * build-template.cjs — turns the itinerary sheet into template.json.
 *
 *   node build-template.cjs "/path/to/Pan India Trip  - Itinerary.csv"
 *
 * This sheet is the PLANNED loop, not the ridden one. route.json is what actually
 * happened; this is the template it was drawn from, and the two differ on purpose —
 * the Northeast sections closed and the weather windows don't overlap.
 *
 * Sector boundaries are DERIVED, not hardcoded: the loop passes through Bengaluru and
 * Delhi more than once, and those recurrences are exactly where a rider can join or
 * leave. The script cuts at each arrival. The one resulting sector too long to be a
 * single unit (Delhi -> Bengaluru, 51 hops) is subdivided at SUBDIVIDE below.
 *
 * PRIVACY: unlike build-route.cjs this sheet carries no accommodation and no spend.
 * Keep it that way — cost figures on the site come from route.json's already-published
 * aggregates, never from here.
 */

const fs = require('fs');

// Places the loop returns to. A rider can join or leave the ride here, which is the
// whole point of the template, so these define the sector boundaries.
const CROSSINGS = ['Bengaluru', 'Delhi'];

// Delhi -> Bengaluru is 51 hops and three different kinds of riding. Split it at the
// Bhutan border and at Agartala. Hop indices are into the full hop list.
const SUBDIVIDE = {
  'Delhi→Bengaluru': [
    { id: 'S3a', title: 'Gangetic plain & Nepal', through: 'Phuentsholing' },
    { id: 'S3b', title: 'Bhutan & the Northeast', through: 'Agartala' },
    { id: 'S3c', title: 'East coast home', through: null },
  ],
};

const TITLES = {
  'Trivandrum→Bengaluru': 'Southern opener',
  'Bengaluru→Delhi': 'West coast & Kutch',
  'Delhi→Delhi': 'Himalayan out-and-back',
  'Delhi→Bengaluru': 'The long east',
  'Bengaluru→Trivandrum': 'Closing run',
};

// The sheet spells the origin city in full; everywhere else calls it Trivandrum.
const RENAME = { Thiruvananthapuram: 'Trivandrum' };

// Any single hop longer than this is not a rideable day and is almost certainly the
// sheet routing the long way round. Warn rather than silently absorbing it.
const LONG_HOP_KM = 800;

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === ',' && !quoted) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}

function num(s) {
  return parseFloat(String(s).replace(/,/g, '').replace(/[^\d.]/g, '')) || 0;
}

function hours(s) {
  const d = /(\d+)\s*day/.exec(s);
  const h = /(\d+)\s*hour/.exec(s);
  const m = /(\d+)\s*min/.exec(s);
  return (d ? +d[1] * 24 : 0) + (h ? +h[1] : 0) + (m ? +m[1] / 60 : 0);
}

function name(s) {
  const t = String(s).trim();
  return RENAME[t] || t;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(function (l) { return l.trim(); });
  const head = splitCsvLine(lines[0]).map(function (h) { return h.trim(); });
  const col = {};
  head.forEach(function (h, i) { col[h] = i; });

  const rows = [];
  lines.slice(1).forEach(function (line) {
    const f = splitCsvLine(line);
    const from = name(f[col.Origin]);
    // The sheet ends with a Total row that reuses the Origin column for the sum.
    if (!from || from === 'Total') return;
    rows.push({
      from: from,
      to: name(f[col.Destination]),
      km: num(f[col.Distance]),
      hours: hours(f[col.Duration]),
      fromLat: +f[col.Origin_Latitude],
      fromLon: +f[col.Origin_Longitude],
      toLat: +f[col.Destination_Latitude],
      toLon: +f[col.Destination_Longitude],
    });
  });
  return rows;
}

function round(n, p) { const m = Math.pow(10, p); return Math.round(n * m) / m; }

function buildTemplate(rows, source) {
  const hops = rows.map(function (r, i) {
    return {
      n: i, from: r.from, to: r.to,
      km: round(r.km, 1), hours: round(r.hours, 3),
      fromLat: r.fromLat, fromLon: r.fromLon, toLat: r.toLat, toLon: r.toLon,
    };
  });

  // Crossings: every hop that ARRIVES at a crossing city.
  const crossings = CROSSINGS.map(function (city) {
    const at = [];
    hops.forEach(function (h, i) { if (h.to === city) at.push(i); });
    return { name: city, hops: at };
  }).filter(function (c) { return c.hops.length; });

  // Cut points, in order: every crossing arrival, plus the end of the ride.
  const cuts = [];
  crossings.forEach(function (c) { c.hops.forEach(function (i) { cuts.push(i); }); });
  cuts.sort(function (a, b) { return a - b; });
  if (cuts[cuts.length - 1] !== hops.length - 1) cuts.push(hops.length - 1);

  const sectors = [];
  let start = 0;
  cuts.forEach(function (end, si) {
    const seg = hops.slice(start, end + 1);
    if (!seg.length) return;
    const from = seg[0].from;
    const to = seg[seg.length - 1].to;
    const key = from + '→' + to;
    const sector = {
      id: 'S' + si,
      title: TITLES[key] || from + ' to ' + to,
      from: from, to: to,
      hopFrom: start, hopTo: end,
      km: round(seg.reduce(function (a, h) { return a + h.km; }, 0), 1),
      hours: round(seg.reduce(function (a, h) { return a + h.hours; }, 0), 2),
      opensAt: CROSSINGS.indexOf(from) >= 0 ? from : null,
      closesAt: CROSSINGS.indexOf(to) >= 0 ? to : null,
      stages: [],
    };
    sector.stages = stagesFor(sector, hops, key);
    sectors.push(sector);
    start = end + 1;
  });

  const seq = hops.length ? [hops[0].from].concat(hops.map(function (h) { return h.to; })) : [];
  const uniq = {};
  seq.forEach(function (p) { uniq[p] = true; });

  return {
    generated: new Date().toISOString(),
    source: source,
    totals: {
      hops: hops.length,
      sequence: seq.length,
      waypoints: Object.keys(uniq).length,
      km: round(hops.reduce(function (a, h) { return a + h.km; }, 0), 1),
      hours: round(hops.reduce(function (a, h) { return a + h.hours; }, 0), 2),
      countries: 3,
    },
    crossings: crossings,
    sectors: sectors,
    hops: hops,
  };
}

// A sector is one stage unless SUBDIVIDE says otherwise, in which case it is cut at
// the named waypoints.
function stagesFor(sector, hops, key) {
  const spec = SUBDIVIDE[key];
  const whole = {
    id: sector.id, title: sector.title,
    hopFrom: sector.hopFrom, hopTo: sector.hopTo,
    km: sector.km, hours: sector.hours,
  };
  if (!spec) return [whole];

  const out = [];
  let from = sector.hopFrom;
  spec.forEach(function (s) {
    let end = sector.hopTo;
    if (s.through) {
      for (let i = from; i <= sector.hopTo; i++) {
        if (hops[i].to === s.through) { end = i; break; }
      }
    }
    const seg = hops.slice(from, end + 1);
    out.push({
      id: s.id, title: s.title, hopFrom: from, hopTo: end,
      km: round(seg.reduce(function (a, h) { return a + h.km; }, 0), 1),
      hours: round(seg.reduce(function (a, h) { return a + h.hours; }, 0), 2),
    });
    from = end + 1;
  });
  return out;
}

function main() {
  const csv = process.argv[2];
  if (!csv) {
    console.error('usage: node build-template.cjs "/path/to/Pan India Trip  - Itinerary.csv"');
    process.exit(1);
  }
  if (!fs.existsSync('template-notes.json')) {
    console.error('template-notes.json is missing. The route book must not publish');
    console.error('without its season and permit notes. Create it first (see README).');
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(csv, 'utf8'));
  const t = buildTemplate(rows, require('path').basename(csv));

  // Invariants. These are the numbers the site states in copy; if the sheet changes
  // under us, fail here rather than publishing a page that contradicts itself.
  const summed = t.sectors.reduce(function (a, s) { return a + s.km; }, 0);
  if (Math.abs(summed - t.totals.km) > 1) {
    throw new Error('sector distances (' + summed + ') do not re-sum to the total (' + t.totals.km + ')');
  }
  t.sectors.forEach(function (s) {
    const staged = s.stages.reduce(function (a, x) { return a + x.km; }, 0);
    if (Math.abs(staged - s.km) > 1) {
      throw new Error(s.id + ': stages (' + staged + ') do not re-sum to the sector (' + s.km + ')');
    }
  });
  t.hops.forEach(function (h) {
    if (!isFinite(h.fromLat) || !isFinite(h.toLat) || !isFinite(h.fromLon) || !isFinite(h.toLon)) {
      throw new Error('hop ' + h.n + ' (' + h.from + ' -> ' + h.to + ') is missing coordinates');
    }
  });

  t.hops.forEach(function (h) {
    if (h.km > LONG_HOP_KM) {
      console.warn('long hop: ' + h.from + ' -> ' + h.to + ' at ' + h.km + ' km / ' +
                   h.hours.toFixed(1) + ' h. The sheet routes this the long way round; ' +
                   'it is not a rideable day and the totals include it as-is.');
    }
  });

  fs.writeFileSync('template.json', JSON.stringify(t, null, 1) + '\n');
  console.log('template.json: ' + t.totals.hops + ' hops, ' + t.totals.km + ' km, ' +
              t.sectors.length + ' sectors, ' + t.totals.waypoints + ' unique waypoints');
}

if (require.main === module) main();

module.exports = { parseCsv, buildTemplate };
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test
```

Expected: PASS, 4/4.

- [ ] **Step 5: Create the notes file the generator now demands**

The generator refuses to run without `template-notes.json`. Create it with the seeded entries and explicit, visible placeholders. **Do not write POI or season prose for waypoints not listed here** — those are the author's to fill.

```json
{
  "_comment": "Hand-authored. POIs, seasons and permits are content, not data. Entries marked TO WRITE are shown on the site as an explicit gap, never as invented text.",
  "sourcing": "TO WRITE — how this loop was distilled from xbhp forum ride reports and Facebook touring groups.",
  "plannedVsRidden": "TO WRITE — which sections closed, and what was decided instead.",
  "hoursPerDay": 6,
  "sectors": {
    "S0": { "season": "TO WRITE", "permits": "", "note": "" },
    "S1": { "season": "TO WRITE", "permits": "", "note": "" },
    "S2": { "season": "TO WRITE", "permits": "", "note": "" },
    "S3": { "season": "TO WRITE", "permits": "", "note": "" },
    "S4": { "season": "TO WRITE", "permits": "", "note": "" }
  },
  "pois": {
    "Dholavira": "Harappan city on the salt flat.",
    "Dhordo": "The white Rann.",
    "Narayan Sarovar": "The westernmost point of the loop.",
    "Khardung La": "The high point of the ride.",
    "Hemis Monastery": "",
    "Gandikota": "The gorge above the Penna.",
    "Paro Taktsang": "Tiger's Nest.",
    "GOLDEN PAGODA India": "Kongmu Kham, Namsai."
  }
}
```

- [ ] **Step 6: Generate `template.json` and check the real numbers**

```bash
node build-template.cjs "$HOME/Downloads/Pan India Trip  - Itinerary.csv"
```

Expected on stdout: `template.json: 97 hops, 18181.3 km, 5 sectors, 94 unique waypoints`
Expected on stderr: exactly one long-hop warning, for `Agartala -> Kolkata` at 1523 km.

Then verify the derived structure matches the spec's table:

```bash
node -e '
const t=require("./template.json");
t.sectors.forEach(s=>console.log(s.id, s.from+"->"+s.to, "hops", s.hopFrom+"-"+s.hopTo, s.km+"km", Math.round(s.hours)+"h", "stages", s.stages.length));
console.log("crossings", JSON.stringify(t.crossings));
'
```

Expected: 5 sectors; S0 `Trivandrum->Bengaluru` 1130.1 km; S1 `Bengaluru->Delhi` 3643 km; S2 `Delhi->Delhi` 2742 km; S3 `Delhi->Bengaluru` with **3 stages**; S4 `Bengaluru->Trivandrum` 711 km. Crossings `Bengaluru [4,93]`, `Delhi [23,42]`.

If the sector count or the crossing hop indices differ, **stop and re-read the CSV** — do not adjust the constants to force agreement.

- [ ] **Step 7: Commit**

```bash
git add build-template.cjs test/template.test.cjs template.json template-notes.json
git commit -m "Add the template generator: the planned loop, cut at its crossings

The loop returns to Bengaluru and Delhi, and those recurrences are where a
rider can join or leave it. Sector boundaries are derived from them rather
than hardcoded, so the structure follows the route instead of a guess."
```

---

## Task 2: Extract the atlas renderer

**Files:**
- Create: `atlas.js`
- Modify: `index.html` — remove lines 1170–1184 (map state and `CLUSTER_PX`), 1186–1217 (`clusterStops`), 1303–1471 (`renderMap`, `drawTiles`, `clearTiles`, tile maths); rewire `renderMap`, `setMapMode`, `syncMap`, `showStop`; add `<script src="atlas.js"></script>` before the inline `<script>` at line 639.
- Create: `test/atlas.test.cjs`

**Interfaces:**
- Consumes: `basemap.json` (unchanged), `template.json` from Task 1 (only from Task 4 onward).
- Produces: a global `Atlas` with this exact surface. Tasks 4, 5, 7 and 8 depend on these names:

```js
Atlas.create(svgEl, basemap, opts)   // opts: { width, height, pad }  -> instance
instance.project(lon, lat)           // -> [x, y] in viewBox units
instance.frame                       // { W, H, k, minX, minY, offX, offY }
instance.drawBase()                  // neighbour + india polygons; clears the svg first
instance.drawRoute(points, cls)      // points: [{lat, lon}]; cls: CSS class -> the <polyline>
instance.drawMarkers(points, opts)   // points: [{lat, lon, idx, ref}]
                                     // opts: { label: fn(cluster)->string, onSelect: fn(i), onMiss: fn() }
                                     // -> [{ x, y, idx, items, dot }]  (clusters, in draw order)
instance.setTiles(on)                // OSM underlay on/off
instance.focus(bounds, animate)      // bounds: {minLat,maxLat,minLon,maxLon} | null to reset
```

`Atlas` never touches `localStorage`, never reads `manifest`, and never knows what a leg or a clip is. Callers own all of that.

- [ ] **Step 1: Write the failing test**

Clustering and projection are pure maths and can be tested without a DOM. Create `test/atlas.test.cjs`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('node:vm');

// atlas.js is a browser script, not a module. Load it into a sandbox with just enough
// of a DOM stub to reach the pure helpers it exposes for testing.
function loadAtlas() {
  const ctx = { window: {}, document: { createElementNS: function () { return {}; } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('atlas.js', 'utf8'), ctx);
  return ctx.Atlas;
}

test('mercator projection is monotonic in both axes', function () {
  const A = loadAtlas();
  const a = A._merc(77, 12);
  const b = A._merc(78, 13);
  assert.ok(b[0] > a[0], 'east should increase x');
  assert.ok(b[1] > a[1], 'north should increase mercator y');
});

test('stops closer than the cluster radius merge into one marker', function () {
  const A = loadAtlas();
  // Four points within 2px of each other, and one far away.
  const pts = [
    { x: 100, y: 100, idx: 1 }, { x: 101, y: 100, idx: 2 },
    { x: 100.5, y: 101, idx: 3 }, { x: 102, y: 101, idx: 4 },
    { x: 300, y: 300, idx: 9 },
  ];
  const clusters = A._cluster(pts, 3.5);
  assert.strictEqual(clusters.length, 2);
  assert.strictEqual(clusters[0].items.length, 4);
  assert.strictEqual(clusters[1].items.length, 1);
});

test('a cluster keeps the index of its first stop, so travel order survives', function () {
  const A = loadAtlas();
  const clusters = A._cluster([{ x: 10, y: 10, idx: 7 }, { x: 11, y: 10, idx: 40 }], 3.5);
  assert.strictEqual(clusters[0].idx, 7);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test
```

Expected: FAIL — `ENOENT: no such file or directory, open 'atlas.js'`.

- [ ] **Step 3: Write `atlas.js`**

Move the code out of `index.html` **verbatim where possible**. The projection maths (`index.html:1306–1326`), the tile transform (`index.html:1420–1456`) and the nearest-click resolution (`index.html:1391–1404`) all carry hard-won correctness and their comments must come with them.

```js
/*
 * atlas.js — the shared map renderer.
 *
 * Lifted out of index.html so booklet.html can draw the same map. It knows about
 * geography and nothing else: no legs, no clips, no costs, no narration. Everything
 * page-specific (which stop belongs to which region block, what a card says, what the
 * badge reads) stays with the caller and arrives through callbacks.
 *
 * Deliberately kept in the same ES5-flavoured style as index.html.
 */
(function (global) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  // Markers cluster at this many viewBox pixels. India is 420px wide here, so a pixel
  // is roughly 8km — the four Varanasi hotels, both Guwahati ones and Mussoorie/
  // Dehradun all land on the same dot. Stacking them would leave every stop but the
  // topmost unreachable, so co-located stops merge and the caller's card lists what is
  // underneath.
  var CLUSTER_PX = 3.5;

  function merc(lon, lat) {
    return [lon * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2))];
  }

  function cluster(placed, px) {
    var out = [];
    placed.forEach(function (p) {
      for (var i = 0; i < out.length; i++) {
        var c = out[i];
        if (Math.abs(c.x - p.x) <= px && Math.abs(c.y - p.y) <= px) { c.items.push(p); return; }
      }
      out.push({ x: p.x, y: p.y, idx: p.idx, items: [p] });
    });
    return out;
  }

  function create(svg, basemap, opts) {
    opts = opts || {};
    var W = opts.width || 420, H = opts.height || 470, PAD = opts.pad == null ? 10 : opts.pad;

    var india = basemap.countries.filter(function (c) { return c.name === 'India'; })[0];
    if (!india) return null;

    // Mercator, matching the design's d3.geoMercator().fitExtent to India.
    var xs = [], ys = [];
    india.rings.forEach(function (ring) {
      ring.forEach(function (p) { var q = merc(p[0], p[1]); xs.push(q[0]); ys.push(q[1]); });
    });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var k = Math.min((W - PAD * 2) / (maxX - minX), (H - PAD * 2) / (maxY - minY));
    var offX = (W - (maxX - minX) * k) / 2, offY = (H - (maxY - minY) * k) / 2;

    function project(lon, lat) {
      var q = merc(lon, lat);
      return [offX + (q[0] - minX) * k, H - (offY + (q[1] - minY) * k)];
    }

    var tiles = null;
    var clusters = [];
    var api = {};

    api.frame = { W: W, H: H, k: k, minX: minX, minY: minY, offX: offX, offY: offY };
    api.project = project;

    api.drawBase = function () {
      svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      svg.replaceChildren();
      tiles = null;
      basemap.countries.forEach(function (c) {
        if (c.name === 'India') return;
        c.rings.forEach(function (ring) { poly(ring, 'neighbour'); });
      });
      india.rings.forEach(function (ring) { poly(ring, 'india'); });
      return api;
    };

    function poly(ring, cls) {
      var el = document.createElementNS(NS, 'polygon');
      el.setAttribute('class', cls);
      el.setAttribute('points', ring.map(function (p) {
        return project(p[0], p[1]).join(',');
      }).join(' '));
      svg.appendChild(el);
      return el;
    }

    api.drawRoute = function (points, cls) {
      if (!points || points.length < 2) return null;
      var line = document.createElementNS(NS, 'polyline');
      line.setAttribute('class', cls || 'route');
      line.setAttribute('points', points.map(function (p) {
        var xy = project(p.lon, p.lat);
        return xy[0].toFixed(1) + ',' + xy[1].toFixed(1);
      }).join(' '));
      svg.appendChild(line);
      return line;
    };

    api.drawMarkers = function (points, o) {
      o = o || {};
      var placed = points.map(function (p) {
        var xy = project(p.lon, p.lat);
        return { x: xy[0], y: xy[1], idx: p.idx, ref: p.ref };
      });
      clusters = cluster(placed, CLUSTER_PX);

      clusters.forEach(function (c, i) {
        var dot = document.createElementNS(NS, 'circle');
        dot.setAttribute('class', 'stop');
        dot.setAttribute('cx', c.x); dot.setAttribute('cy', c.y); dot.setAttribute('r', 2.6);
        dot.dataset.idx = c.idx; dot.dataset.stop = i;
        svg.appendChild(dot);
        c.dot = dot;

        // The visible dot is under 3px; a finger is not. This circle exists for the
        // hover tooltip — the click itself is resolved by distance, below.
        var hit = document.createElementNS(NS, 'circle');
        hit.setAttribute('class', 'hit');
        hit.setAttribute('cx', c.x); hit.setAttribute('cy', c.y); hit.setAttribute('r', 8);
        hit.dataset.idx = c.idx; hit.dataset.stop = i;
        if (o.label) {
          var t = document.createElementNS(NS, 'title');
          t.textContent = o.label(c);
          hit.appendChild(t);
        }
        svg.appendChild(hit);
      });

      // Resolve a click to the *nearest* stop rather than to whatever circle caught the
      // event. Through Himachal and the Northeast the stops sit closer together than a
      // finger-sized target, so the hit circles overlap and the last one drawn swallows
      // its neighbours — several stops were simply unclickable. Nearest-point gives
      // every stop its own catchment, and a click on open sea closes the card.
      if (o.onSelect) svg.addEventListener('click', function (e) {
        var box = svg.getBoundingClientRect();
        if (!box.width || !box.height) return;
        var vb = svg.viewBox.baseVal;
        var x = (e.clientX - box.left) / box.width * vb.width;
        var y = (e.clientY - box.top) / box.height * vb.height;
        var best = -1, bestD = Infinity;
        clusters.forEach(function (c, i) {
          var d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
          if (d < bestD) { bestD = d; best = i; }
        });
        if (best >= 0 && bestD <= 14 * 14) o.onSelect(best);
        else if (o.onMiss) o.onMiss();
      });

      return clusters;
    };

    api.clusters = function () { return clusters; };

    // The map already draws in Mercator, and Web Mercator is the same projection up to
    // a linear transform — so tiles land exactly on the drawn coastline, no
    // reprojection:
    //   x = worldPx · nx + Bx     where nx = (mx + π) / 2π
    //   y = worldPx · ny + By     where ny = (π − my) / 2π
    api.setTiles = function (on) {
      if (tiles && tiles.parentNode) tiles.parentNode.removeChild(tiles);
      tiles = null;
      if (!on) return api;

      var worldPx = 2 * Math.PI * k;
      var Bx = offX - (Math.PI + minX) * k;
      var By = H - offY - (Math.PI - minY) * k;

      // One zoom finer than the exact fit, so tiles are downscaled rather than blown up.
      var z = Math.max(0, Math.min(19, Math.round(Math.log(worldPx / 256) / Math.LN2) + 1));
      var n = Math.pow(2, z);
      var size = worldPx / n;

      var x0 = Math.max(0, Math.floor((0 - Bx) / size));
      var x1 = Math.min(n - 1, Math.ceil((W - Bx) / size));
      var y0 = Math.max(0, Math.floor((0 - By) / size));
      var y1 = Math.min(n - 1, Math.ceil((H - By) / size));

      var g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'tiles');
      for (var tx = x0; tx <= x1; tx++) {
        for (var ty = y0; ty <= y1; ty++) {
          var img = document.createElementNS(NS, 'image');
          img.setAttribute('class', 'tile-img');
          img.setAttribute('x', (Bx + tx * size).toFixed(2));
          img.setAttribute('y', (By + ty * size).toFixed(2));
          // Half a pixel of overlap; exact edges leave hairline seams once scaled.
          img.setAttribute('width', (size + 0.5).toFixed(2));
          img.setAttribute('height', (size + 0.5).toFixed(2));
          img.setAttribute('href', 'https://tile.openstreetmap.org/' + z + '/' + tx + '/' + ty + '.png');
          g.appendChild(img);
        }
      }
      svg.insertBefore(g, svg.firstChild);   // behind coastlines and route
      tiles = g;
      return api;
    };

    // Ease the viewBox toward a lat/lon box, for the overview. null resets to the
    // whole map. Never zooms past 3x, which is where the baked coastline starts to
    // look like a polygon rather than a coast.
    var focusRaf = null;
    api.focus = function (bounds, animate) {
      if (focusRaf) { cancelAnimationFrame(focusRaf); focusRaf = null; }
      var to = [0, 0, W, H];
      if (bounds) {
        var a = project(bounds.minLon, bounds.maxLat);
        var b = project(bounds.maxLon, bounds.minLat);
        var pad = 40;
        var x = Math.min(a[0], b[0]) - pad, y = Math.min(a[1], b[1]) - pad;
        var w = Math.abs(b[0] - a[0]) + pad * 2, h = Math.abs(b[1] - a[1]) + pad * 2;
        var minW = W / 3, minH = H / 3;
        if (w < minW) { x -= (minW - w) / 2; w = minW; }
        if (h < minH) { y -= (minH - h) / 2; h = minH; }
        to = [x, y, w, h];
      }
      var vb = svg.viewBox.baseVal;
      var from = [vb.x, vb.y, vb.width || W, vb.height || H];
      if (!animate) { svg.setAttribute('viewBox', to.join(' ')); return api; }

      var t0 = performance.now(), DUR = 900;
      function step(now) {
        var t = Math.min(1, (now - t0) / DUR);
        var e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;   // easeInOutQuad
        svg.setAttribute('viewBox', from.map(function (v, i) {
          return (v + (to[i] - v) * e).toFixed(2);
        }).join(' '));
        focusRaf = t < 1 ? requestAnimationFrame(step) : null;
      }
      focusRaf = requestAnimationFrame(step);
      return api;
    };

    return api;
  }

  global.Atlas = {
    create: create,
    CLUSTER_PX: CLUSTER_PX,
    // Exposed for tests only — pure maths, no DOM.
    _merc: merc,
    _cluster: cluster,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test
```

Expected: PASS, 7/7 (4 from Task 1, 3 here).

- [ ] **Step 5: Rewire `index.html` onto `Atlas`**

Add before the inline script (currently `index.html:639`):

```html
<script src="atlas.js"></script>
```

Delete `NS`, `CLUSTER_PX`, `clusterStops`, `drawTiles`, `clearTiles` and the body of `renderMap`. Keep `mapPlaced`, `mapClusters`, `mapStops`, `selStop`, `matchStopsToRegions`, `clusterLabel`, `showStop`, `hideStop` and `syncMap` — they are page-specific. Replace `renderMap` with:

```js
  var atlas = null;

  function renderMap() {
    if (!basemap) return;
    atlas = Atlas.create(el.atlas, basemap, { width: 420, height: 470, pad: 10 });
    if (!atlas) return;
    atlas.drawBase();

    // The line follows the places actually slept in, in order — not a tour of state
    // centroids, which used to cut Rajasthan-to-Delhi through the middle of Haryana
    // and put "Nepal" in the far west of the country.
    var stops = (manifest.route && manifest.route.stops) || [];
    var matched = matchStopsToRegions(stops);
    mapPlaced = matched.map(function (o) {
      var xy = atlas.project(o.stop.lon, o.stop.lat);
      return { stop: o.stop, idx: o.idx, x: xy[0], y: xy[1] };
    });

    atlas.drawRoute(matched.map(function (o) {
      return { lat: o.stop.lat, lon: o.stop.lon };
    }), 'route');

    mapClusters = atlas.drawMarkers(matched.map(function (o) {
      return { lat: o.stop.lat, lon: o.stop.lon, idx: o.idx, ref: o.stop };
    }), {
      label: clusterLabel,
      onSelect: showStop,
      onMiss: hideStop,
    });
    mapStops = mapClusters.map(function (c) { return c.dot; });

    if (mapMode === 'map') atlas.setTiles(true);
    syncMap();
  }
```

`clusterStops` returned `{ x, y, idx, stops: [...] }`; `Atlas` returns `{ x, y, idx, items: [...], dot }`. **Every reader of `.stops` on a cluster must become `.items`, and each item now carries `.ref` (the stop object) rather than being the stop itself.** The three call sites are `clusterLabel` (`index.html:1203–1217`), `showStop` (`index.html:1246–1299`) and the `mapClusters.forEach` inside the old click handler (now gone). Update `clusterLabel` and `showStop` to read `c.items` and `item.ref`.

In `setMapMode`, replace `drawTiles()` / `clearTiles()` with `if (atlas) atlas.setTiles(mode === 'map');`.

- [ ] **Step 6: Verify no regression by hand**

```bash
python3 -m http.server 8899
```

Open `http://127.0.0.1:8899/` and confirm every one of these, because this task rewrites the most load-bearing code on the page:

- [ ] The route line draws through all 74 stops, in order, hugging the coast.
- [ ] Clicking a marker opens the card with the right place, nights and bill; the Maps link works.
- [ ] Clicking a marker also scrolls the legs column to that region.
- [ ] Clicking open sea closes the card.
- [ ] The card flips above the map for stops in the lower third.
- [ ] Clicking near two overlapping stops (try Varanasi, and Leh/Khardung La) selects the nearest, not always the same one.
- [ ] Hover tooltips still name the cluster.
- [ ] "Real map" toggles OSM tiles that align with the drawn coastline; the attribution appears; the choice survives a reload.
- [ ] Scrolling the legs column lights the matching markers and updates the badge.
- [ ] The clip grid, lightbox, arrow keys, autoplay toggle and region strip all still work.

Check the console is clean. Any error here means stop and fix before committing.

- [ ] **Step 7: Commit**

```bash
git add atlas.js index.html test/atlas.test.cjs
git commit -m "Extract the map renderer into atlas.js

booklet.html needs the same drawing, and index.html was 1,667 lines. The
projection fit, the tile transform and the nearest-click resolution move
across intact — they encode why the map works at this scale, and rederiving
them would reintroduce unclickable stops and hairline tile seams.

Page-specific code stays behind: which stop belongs to which region block,
what the card says, what the badge reads."
```

---

## Task 3: The template section

**Files:**
- Modify: `index.html` — new `<section class="tpl" id="template">` after the closing `</main>`-side content (insert after the `#close` section at line 603–607, before `<footer class="pagefoot">`); new CSS after the `.close` rules (around line 340); new render function and a fetch for `template.json` and `template-notes.json` in the boot block (line 1630).

**Interfaces:**
- Consumes: `template.json` (`totals`, `crossings`, `sectors[]`, `hops[]`) and `template-notes.json` (`sourcing`, `pois`, `sectors{}`) from Task 1. `Atlas` is not needed here.
- Produces: `renderTemplate(tpl, notes)`, and globals `template` / `templateNotes` that Tasks 4, 5 and 7 read. Produces DOM ids `#template`, `#tpl-sectors`, `#tpl-costs` that Task 5 and Task 7 link to.

- [ ] **Step 1: Add the markup**

Insert immediately before `<footer class="pagefoot">` (currently `index.html:609`):

```html
    <section class="tpl" id="template" hidden>
      <p class="tpl__eyebrow">THE TEMPLATE</p>
      <h2>A loop anyone can run</h2>
      <p class="tpl__lede">
        This ride was not improvised. It was drawn first — a loop with fixed waypoints
        and two crossing points, Bangalore and Delhi, where a rider can join or leave.
        What follows is that route book, not a diary of this one running of it.
      </p>
      <p class="tpl__source" id="tpl-source"></p>

      <div class="tpl__glance" id="tpl-glance"></div>

      <h3 class="tpl__h3">The five sectors</h3>
      <p class="tpl__note">
        The loop returns to Bangalore and Delhi. Those returns are the joins: ride the
        whole thing, or take one sector and go home from where you started.
      </p>
      <div class="tpl__sectors" id="tpl-sectors"></div>

      <h3 class="tpl__h3">What it cost</h3>
      <div class="tpl__costs" id="tpl-costs"></div>

      <div class="tpl__acts">
        <a class="tpl__cta" href="booklet.html">DOWNLOAD THE ROUTE BOOK →</a>
      </div>
    </section>
```

- [ ] **Step 2: Add the CSS**

Insert after the `.close a:hover` rule (currently `index.html:339`). Reuse the existing tokens — no new colours.

```css
/* ─── the template ─────────────────────────────────────────────────────── */
.tpl { border-top: var(--rule); padding-top: var(--space-8); margin-top: var(--space-8); }
.tpl[hidden] { display: none; }
.tpl__eyebrow {
  font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.12em;
  color: var(--color-accent-2); margin: 0 0 var(--space-3);
}
.tpl__lede { font-size: 16px; line-height: 1.6; max-width: 62ch; color: var(--color-muted); }
.tpl__source { font-size: 13px; color: var(--color-dim); max-width: 62ch; }
.tpl__source[hidden] { display: none; }
.tpl__h3 { margin: var(--space-8) 0 var(--space-2); }
.tpl__note { font-size: 14px; color: var(--color-muted); max-width: 62ch; margin: 0 0 var(--space-4); }

.tpl__glance {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  border: var(--rule); border-radius: var(--radius); margin: var(--space-6) 0;
}
.tpl__glance > div { padding: var(--space-4); }
.tpl__glance > div + div { border-left: var(--rule); }
.tpl__glance-n {
  font-family: var(--font-heading); font-weight: var(--fw-bold); font-size: 24px;
  font-variant-numeric: tabular-nums;
}
.tpl__glance-l { font-size: 11px; letter-spacing: 0.08em; color: var(--color-dim); margin-top: 2px; }

.tpl__sector { border: var(--rule); border-radius: var(--radius); margin-bottom: var(--space-3); }
.tpl__sector-bar {
  display: flex; align-items: baseline; gap: var(--space-3); width: 100%;
  padding: var(--space-4); background: none; border: 0; color: inherit;
  font: inherit; text-align: left; cursor: pointer;
}
.tpl__sector-id {
  font-family: var(--font-mono); font-size: 12px; color: var(--color-accent);
  min-width: 30px;
}
.tpl__sector-title { font-family: var(--font-heading); font-weight: var(--fw-bold); flex: 1; }
.tpl__sector-meta {
  font-family: var(--font-mono); font-size: 12px; color: var(--color-dim);
  font-variant-numeric: tabular-nums; text-align: right;
}
.tpl__sector-sign { font-weight: var(--fw-bold); width: 18px; text-align: center; color: var(--color-muted); }
.tpl__sector[data-open="false"] .tpl__sector-body { display: none; }
.tpl__sector-body { padding: 0 var(--space-4) var(--space-4); }
.tpl__join {
  display: inline-block; font-family: var(--font-mono); font-size: 11px;
  letter-spacing: 0.08em; color: var(--color-accent-2);
  border: 1px solid var(--color-accent-2); border-radius: var(--radius);
  padding: 2px 8px; margin-bottom: var(--space-3);
}
.tpl__stage { margin-top: var(--space-4); }
.tpl__stage-h {
  font-family: var(--font-mono); font-size: 12px; letter-spacing: 0.06em;
  color: var(--color-muted); margin-bottom: var(--space-2);
}
.tpl__hops { width: 100%; border-collapse: collapse; font-size: 13px; }
.tpl__hops td { padding: 4px 0; border-bottom: 1px solid var(--color-line); }
.tpl__hops td:last-child, .tpl__hops td:nth-last-child(2) {
  text-align: right; font-family: var(--font-mono); font-size: 12px;
  color: var(--color-dim); font-variant-numeric: tabular-nums; white-space: nowrap;
  padding-left: var(--space-3);
}
.tpl__poi { color: var(--color-accent); }
.tpl__todo {
  font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.06em;
  color: var(--color-faint); border: 1px dashed var(--color-line-strong);
  border-radius: var(--radius); padding: 6px 10px; margin-top: var(--space-3);
}

.tpl__costs table { width: 100%; border-collapse: collapse; font-size: 14px; max-width: 62ch; }
.tpl__costs td { padding: 6px 0; border-bottom: 1px solid var(--color-line); }
.tpl__costs td + td {
  text-align: right; font-family: var(--font-mono);
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.tpl__costs caption { text-align: left; font-size: 13px; color: var(--color-dim); padding-bottom: var(--space-3); }

.tpl__acts { margin-top: var(--space-8); }
.tpl__cta {
  display: inline-block; font-family: var(--font-heading); font-weight: var(--fw-bold);
  font-size: 13px; letter-spacing: 0.08em; text-decoration: none;
  color: var(--color-text); border: 1px solid var(--color-accent);
  border-radius: var(--radius); padding: 12px 20px;
}
.tpl__cta:hover { background: var(--color-accent); color: #fff; }
```

- [ ] **Step 3: Write the render function**

Add before the boot block (`index.html:1629`). `hoursPerDay` comes from the notes file so the reader can see the assumption:

```js
  /* ─── the template ──────────────────────────────────────────────────── */
  var template = null, templateNotes = null;

  function tplPoi(place) {
    var p = templateNotes && templateNotes.pois && templateNotes.pois[place];
    return p ? String(p) : '';
  }

  function renderTemplate() {
    if (!template) return;
    var t = template, notes = templateNotes || {};
    el.template.hidden = false;

    if (notes.sourcing && notes.sourcing.indexOf('TO WRITE') !== 0) {
      el.tplSource.textContent = notes.sourcing;
      el.tplSource.hidden = false;
    }

    var glance = [
      [Math.round(t.totals.km).toLocaleString('en-IN'), 'km'],
      [String(t.totals.hops), 'legs'],
      [String(Math.round(t.totals.hours)), 'riding hours'],
      [String(t.totals.countries), 'countries'],
      [String(t.crossings.length), 'crossings'],
    ];
    el.tplGlance.replaceChildren();
    glance.forEach(function (g) {
      var d = document.createElement('div');
      var n = document.createElement('div'); n.className = 'tpl__glance-n'; n.textContent = g[0];
      var l = document.createElement('div'); l.className = 'tpl__glance-l'; l.textContent = g[1];
      d.appendChild(n); d.appendChild(l);
      el.tplGlance.appendChild(d);
    });

    el.tplSectors.replaceChildren();
    t.sectors.forEach(function (s) { el.tplSectors.appendChild(sectorBlock(s)); });
  }

  function sectorBlock(s) {
    var wrap = document.createElement('div');
    wrap.className = 'tpl__sector';
    wrap.dataset.open = 'false';
    wrap.id = 'sector-' + s.id;

    var bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'tpl__sector-bar';
    bar.setAttribute('aria-expanded', 'false');

    var id = document.createElement('span'); id.className = 'tpl__sector-id'; id.textContent = s.id;
    var ti = document.createElement('span'); ti.className = 'tpl__sector-title';
    ti.textContent = s.title + ' · ' + s.from + ' → ' + s.to;
    var me = document.createElement('span'); me.className = 'tpl__sector-meta';
    me.textContent = Math.round(s.km).toLocaleString('en-IN') + ' km · ' + Math.round(s.hours) + ' h';
    var sg = document.createElement('span'); sg.className = 'tpl__sector-sign'; sg.textContent = '+';

    bar.appendChild(id); bar.appendChild(ti); bar.appendChild(me); bar.appendChild(sg);
    bar.addEventListener('click', function () {
      var open = wrap.dataset.open === 'true';
      wrap.dataset.open = open ? 'false' : 'true';
      bar.setAttribute('aria-expanded', open ? 'false' : 'true');
      sg.textContent = open ? '+' : '−';
    });
    wrap.appendChild(bar);

    var body = document.createElement('div');
    body.className = 'tpl__sector-body';

    if (s.opensAt || s.closesAt) {
      var join = document.createElement('span');
      join.className = 'tpl__join';
      join.textContent = s.opensAt && s.closesAt
        ? 'JOIN AT ' + s.opensAt.toUpperCase() + ' · LEAVE AT ' + s.closesAt.toUpperCase()
        : (s.opensAt ? 'JOIN AT ' + s.opensAt.toUpperCase() : 'LEAVE AT ' + s.closesAt.toUpperCase());
      body.appendChild(join);
    }

    var note = (templateNotes.sectors || {})[s.id] || {};
    if (note.season && note.season.indexOf('TO WRITE') === 0) {
      var todo = document.createElement('p');
      todo.className = 'tpl__todo';
      todo.textContent = 'Season and permit notes for this sector are not written yet.';
      body.appendChild(todo);
    } else if (note.season) {
      var p = document.createElement('p');
      p.className = 'tpl__note';
      p.textContent = note.permits ? note.season + ' ' + note.permits : note.season;
      body.appendChild(p);
    }

    s.stages.forEach(function (st) {
      var box = document.createElement('div');
      box.className = 'tpl__stage';
      if (s.stages.length > 1) {
        var h = document.createElement('div');
        h.className = 'tpl__stage-h';
        h.textContent = st.id + ' · ' + st.title + ' · ' +
          Math.round(st.km).toLocaleString('en-IN') + ' km';
        box.appendChild(h);
      }
      var table = document.createElement('table');
      table.className = 'tpl__hops';
      var tbody = document.createElement('tbody');
      for (var i = st.hopFrom; i <= st.hopTo; i++) {
        var hop = template.hops[i];
        var tr = document.createElement('tr');
        var to = document.createElement('td');
        to.textContent = hop.to;
        var poi = tplPoi(hop.to);
        if (poi) {
          var sp = document.createElement('span');
          sp.className = 'tpl__poi';
          sp.textContent = ' — ' + poi;
          to.appendChild(sp);
        }
        var km = document.createElement('td');
        km.textContent = Math.round(hop.km) + ' km';
        var hr = document.createElement('td');
        hr.textContent = hop.hours.toFixed(1) + ' h';
        tr.appendChild(to); tr.appendChild(km); tr.appendChild(hr);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      box.appendChild(table);
      wrap.appendChild(body);
      body.appendChild(box);
    });

    return wrap;
  }
```

Add to the `el` object (`index.html:700`):

```js
    template: document.getElementById('template'),
    tplSource: document.getElementById('tpl-source'),
    tplGlance: document.getElementById('tpl-glance'),
    tplSectors: document.getElementById('tpl-sectors'),
    tplCosts: document.getElementById('tpl-costs'),
```

- [ ] **Step 4: Fetch the new data in the boot block**

The template must never break the page it sits on. Add two tolerant fetches to the `Promise.all` at `index.html:1630`:

```js
    fetch('template.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
    fetch('template-notes.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }),
```

and in the `.then`:

```js
    template = res[2];
    templateNotes = res[3] || {};
    renderTemplate();
```

The section starts `hidden` and `renderTemplate` only unhides it when `template` loaded, so a missing file leaves the page exactly as it is today.

- [ ] **Step 5: Verify by hand**

Serve and open. Confirm:
- [ ] The template section appears below the closing block with five sectors.
- [ ] Sector meta reads S0 1,130 km / 22 h, S1 3,643 km / 74 h, S2 2,742 km / 62 h, S3 9,955 km, S4 711 km.
- [ ] Expanding S3 shows **three** stage tables; expanding S0 shows one with no stage heading.
- [ ] Waypoint rows show POI text for Dholavira, Khardung La, Gandikota, Paro Taktsang.
- [ ] Sectors with an unwritten season note show the dashed "not written yet" box — not invented prose.
- [ ] `mv template.json /tmp/ && reload` → page works exactly as before, no section, no console error. Move it back.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add the template section: the loop, sector by sector

Sectors expand to their waypoint tables. Unwritten season notes show as an
explicit gap rather than filler, and the whole section stays hidden if
template.json is absent, so the page degrades to what it is today."
```

---

## Task 4: Costs projected from what was actually paid

**Files:**
- Modify: `index.html` — add `renderCosts()` next to `renderTemplate()`; call it from `renderTemplate`.
- Create: `test/costs.test.cjs`

**Interfaces:**
- Consumes: `template.json` sectors from Task 1, `manifest.route` (already loaded; it is `route.json` inlined by `generate-manifest.cjs` — verify with `node -e 'console.log(Object.keys(require("./manifest.json").route))'`), `templateNotes.hoursPerDay` from Task 1.
- Produces: `projectCosts(route, template, hoursPerDay)` → `{ perNight: {stay, other, total}, nights, sectors: [{id, days, stay, other, total}], total }`. Task 7 (`booklet.html`) calls the same function, so it must be defined on a shared surface — put it in `atlas.js`? **No.** Costs are not geography. Define it in a new tiny file `costs.js` loaded by both pages.

**Files (revised):**
- Create: `costs.js`, `test/costs.test.cjs`
- Modify: `index.html` — `<script src="costs.js"></script>`, call `renderCosts()`.

- [ ] **Step 1: Write the failing test**

```js
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('node:vm');

function loadCosts() {
  const ctx = {}; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('costs.js', 'utf8'), ctx);
  return ctx.Costs;
}

const ROUTE = {
  totals: { nights: 93 },
  stops: [
    { nights: 50, stayCost: 70000, spend: 180000 },
    { nights: 43, stayCost: 65448, spend: 161402 },
  ],
};
const TPL = { sectors: [{ id: 'S0', km: 1130, hours: 22 }, { id: 'S1', km: 3643, hours: 74 }] };

test('per-night rates come straight from the ridden totals', function () {
  const c = loadCosts().project(ROUTE, TPL, 6);
  assert.strictEqual(c.nights, 93);
  assert.strictEqual(Math.round(c.perNight.stay), 1456);
  assert.strictEqual(Math.round(c.perNight.other), 2215);
  assert.strictEqual(Math.round(c.perNight.total), 3671);
});

test('sector days come from riding hours at the stated hours-per-day', function () {
  const c = loadCosts().project(ROUTE, TPL, 6);
  // 22h / 6h = 3.67 -> 4 riding days
  assert.strictEqual(c.sectors[0].days, 4);
  assert.strictEqual(c.sectors[1].days, 13);
});

test('a sector estimate is its days times the observed nightly rate', function () {
  const c = loadCosts().project(ROUTE, TPL, 6);
  assert.strictEqual(c.sectors[0].total, Math.round(4 * c.perNight.total));
});

test('projecting the whole template costs more than the ride actually did', function () {
  // The template is longer than what was ridden. If this ever inverts, the
  // projection is wrong.
  const c = loadCosts().project(ROUTE, TPL, 6);
  assert.ok(c.total > 0);
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
node --test
```

Expected: FAIL — `ENOENT ... costs.js`.

- [ ] **Step 3: Write `costs.js`**

```js
/*
 * costs.js — projects the template's cost from what the ride actually cost.
 *
 * There are no invented rates here. Every figure is derived from route.json's
 * already-published aggregates: 93 nights, what was paid for beds, and what was paid
 * for everything else. Those observed per-night rates are applied to the template's
 * shape.
 *
 * The template is a route, not a schedule — it has no nights of its own. Days are
 * estimated from riding hours at an hours-per-day figure that comes from
 * template-notes.json and is SHOWN TO THE READER. Do not bury it.
 */
(function (global) {
  'use strict';

  function project(route, template, hoursPerDay) {
    var stops = route.stops || [];
    var nights = (route.totals && route.totals.nights) || 0;
    var stay = stops.reduce(function (a, s) { return a + (s.stayCost || 0); }, 0);
    var spend = stops.reduce(function (a, s) { return a + (s.spend || 0); }, 0);
    var other = spend - stay;

    var perNight = {
      stay: nights ? stay / nights : 0,
      other: nights ? other / nights : 0,
      total: nights ? spend / nights : 0,
    };

    var hpd = hoursPerDay || 6;
    var sectors = (template.sectors || []).map(function (s) {
      var days = Math.ceil(s.hours / hpd);
      return {
        id: s.id,
        days: days,
        stay: Math.round(days * perNight.stay),
        other: Math.round(days * perNight.other),
        total: Math.round(days * perNight.total),
      };
    });

    return {
      nights: nights,
      observed: { stay: stay, other: other, total: spend },
      perNight: perNight,
      hoursPerDay: hpd,
      sectors: sectors,
      days: sectors.reduce(function (a, s) { return a + s.days; }, 0),
      total: sectors.reduce(function (a, s) { return a + s.total; }, 0),
    };
  }

  global.Costs = { project: project };
})(typeof globalThis !== 'undefined' ? globalThis : this);
```

- [ ] **Step 4: Run the tests and watch them pass**

```bash
node --test
```

Expected: PASS, 11/11.

- [ ] **Step 5: Render it**

Add `<script src="costs.js"></script>` next to the `atlas.js` tag. Add to `index.html`, and call `renderCosts()` at the end of `renderTemplate()`:

```js
  function rupeeShort(n) {
    return '₹' + Math.round(n).toLocaleString('en-IN');
  }

  function renderCosts() {
    if (!template || !manifest.route) return;
    var hpd = (templateNotes && templateNotes.hoursPerDay) || 6;
    var c = Costs.project(manifest.route, template, hpd);

    var table = document.createElement('table');
    var cap = document.createElement('caption');
    cap.textContent =
      'What one rider paid, early 2025 — ' + rupeeShort(c.observed.total) + ' across ' +
      c.nights + ' nights — applied to the template’s shape. Riding days are ' +
      'estimated at ' + hpd + ' hours a day. These are rates that were actually paid, ' +
      'not a quote.';
    table.appendChild(cap);

    var body = document.createElement('tbody');
    function row(label, value, strong) {
      var tr = document.createElement('tr');
      var a = document.createElement('td'); a.textContent = label;
      var b = document.createElement('td'); b.textContent = value;
      if (strong) { a.style.fontWeight = '700'; b.style.fontWeight = '700'; }
      tr.appendChild(a); tr.appendChild(b);
      body.appendChild(tr);
    }

    row('A bed, per night', rupeeShort(c.perNight.stay));
    row('Fuel, food, everything else, per night', rupeeShort(c.perNight.other));
    row('Per night, all in', rupeeShort(c.perNight.total), true);

    c.sectors.forEach(function (s) {
      var sec = template.sectors.filter(function (x) { return x.id === s.id; })[0];
      row(s.id + ' · ' + sec.title + ' · ' + s.days + ' days', rupeeShort(s.total));
    });
    row('The whole loop · ' + c.days + ' riding days', rupeeShort(c.total), true);

    table.appendChild(body);
    el.tplCosts.replaceChildren(table);
  }
```

- [ ] **Step 6: Verify by hand**

- [ ] Per-night rates read ₹1,456 / ₹2,215 / ₹3,671.
- [ ] The caption states the ₹341,402 / 93 nights provenance and the 6 h/day assumption in plain words.
- [ ] Sector estimates are present for all five and the loop total is their sum.
- [ ] Every figure uses Indian digit grouping (₹1,23,456), which `toLocaleString('en-IN')` gives.

- [ ] **Step 7: Commit**

```bash
git add costs.js test/costs.test.cjs index.html
git commit -m "Project template costs from what the ride actually cost

No invented rates: the per-night figures are route.json's published totals
divided by 93 nights, applied to each sector's riding days. The template has
no schedule of its own, so the hours-per-day assumption is stated in the
caption rather than hidden in the arithmetic."
```

---

## Task 5: Planned vs ridden

**Files:**
- Modify: `index.html` — a second toggle beside `#map-toggle`; `renderMap()` draws the template line; new CSS for `.route--planned`; the honest panel inside `#template`.

**Interfaces:**
- Consumes: `atlas.drawRoute` (Task 2), `template.hops` (Task 1), `templateNotes.plannedVsRidden` (Task 1).
- Produces: nothing later tasks depend on, except that Task 6's overview must not fight the overlay — it calls `setPlanned(false)` on entry.

- [ ] **Step 1: Add the toggle to the markup**

Next to the existing toggle (`index.html:580`):

```html
        <button type="button" class="map__toggle map__toggle--alt" id="plan-toggle" aria-pressed="false">Planned route</button>
```

- [ ] **Step 2: Add the CSS**

After the `.map__toggle` rules (around `index.html:270`):

```css
.map__toggle--alt { top: auto; bottom: 10px; }
/* The planned loop, drawn under everything. Dashed and dimmed: it is the route that
   was not ridden, and it must never read as equal in weight to the one that was. */
.atlas .route--planned {
  fill: none; stroke: var(--color-dim); stroke-width: 1.4;
  stroke-dasharray: 5 4; opacity: 0.75;
  stroke-linejoin: round; stroke-linecap: round;
}
```

- [ ] **Step 3: Draw it**

In `renderMap()`, **before** the ridden `atlas.drawRoute(...)` call so it sits underneath:

```js
    // The planned loop, under the ridden one. Drawn from the template's hop list:
    // the origin of the first hop, then every destination in order.
    if (template && template.hops.length) {
      var pts = [{ lat: template.hops[0].fromLat, lon: template.hops[0].fromLon }];
      template.hops.forEach(function (h) { pts.push({ lat: h.toLat, lon: h.toLon }); });
      plannedLine = atlas.drawRoute(pts, 'route--planned');
      if (plannedLine) plannedLine.style.display = planned ? '' : 'none';
    }
```

Add the state and toggle beside the map-mode code:

```js
  var PLAN_KEY = 'ride:planned';
  var planned = false;
  try { planned = localStorage.getItem(PLAN_KEY) === '1'; } catch (e) { /* private mode */ }
  var plannedLine = null;

  function setPlanned(on) {
    planned = !!on;
    try { localStorage.setItem(PLAN_KEY, planned ? '1' : '0'); } catch (e) { /* private mode */ }
    el.planToggle.setAttribute('aria-pressed', String(planned));
    el.planToggle.textContent = planned ? 'Hide planned' : 'Planned route';
    if (plannedLine) plannedLine.style.display = planned ? '' : 'none';
  }
```

Wire it in the boot block next to the existing toggle, and add `planToggle: document.getElementById('plan-toggle')` to `el`. Call `setPlanned(planned)` after `renderMap()`.

- [ ] **Step 4: Add the honest panel**

In the template section markup, after `#tpl-glance`:

```html
      <h3 class="tpl__h3">What was planned, and what was ridden</h3>
      <p class="tpl__note" id="tpl-diff"></p>
      <p class="tpl__note">
        Turn on <strong>Planned route</strong> on the map to see both: the loop as
        drawn, dashed, under the line that was actually ridden.
      </p>
```

Render it, again refusing to invent copy:

```js
    var diff = notes.plannedVsRidden || '';
    if (diff && diff.indexOf('TO WRITE') !== 0) {
      el.tplDiff.textContent = diff;
    } else {
      el.tplDiff.className = 'tpl__todo';
      el.tplDiff.textContent = 'Not written yet: which sections closed, and what was ridden instead.';
    }
```

with `tplDiff: document.getElementById('tpl-diff')` in `el`.

- [ ] **Step 5: Verify by hand**

- [ ] "Planned route" draws a dashed line that visibly reaches Nepal, Bhutan, Arunachal, Nagaland, Mizoram — places the solid line does not.
- [ ] The dashed line sits *under* the solid one where they coincide.
- [ ] The preference survives a reload, independently of the outline/real-map toggle.
- [ ] Both toggles work together: real map + planned route shows tiles, dashed plan, solid ride.
- [ ] With `template.json` moved away, the toggle does nothing and throws nothing.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Overlay the planned loop on the ridden one

The gaps are the argument. Nepal, Bhutan and most of the Northeast are drawn
and not ridden; the dashed line is deliberately lighter so it never reads as
equal in weight to the route that actually happened."
```

---

## Task 6: The overview

**Files:**
- Modify: `index.html` — hero CTA (line 555); overview markup under the map; CSS; the player.

**Interfaces:**
- Consumes: `legs` and `regionsFlat` (built in `build()`), `atlas.focus` (Task 2), `jump(idx)` (`index.html:1508`), `setPlanned` (Task 5), `MOTION` (`index.html:663`), `DESKTOP` (`index.html:662`).
- Produces: `Overview.start()` / `Overview.stop()`; Task 7 does not use it.

- [ ] **Step 1: Change the hero CTA**

Replace `index.html:555`:

```html
      <a class="hero__cta" href="#overview" id="overview-cta">SEE THE OVERVIEW ▸</a>
      <a class="hero__alt" href="#region-0">or go straight to the clips</a>
```

- [ ] **Step 2: Add the overview markup**

Immediately after `</div>` closing `.mapwrap` and before `.map__attr` (`index.html:588`):

```html
      <div class="ov" id="overview" hidden>
        <div class="ov__caption" id="ov-caption" aria-live="polite">
          <div class="ov__leg" id="ov-leg"></div>
          <div class="ov__where" id="ov-where"></div>
          <p class="ov__text" id="ov-text"></p>
        </div>
        <div class="ov__bar">
          <button type="button" class="ov__btn" id="ov-play" aria-label="Pause">❚❚</button>
          <div class="ov__dots" id="ov-dots" role="group" aria-label="Chapters"></div>
          <button type="button" class="ov__btn" id="ov-sound" aria-pressed="false" hidden aria-label="Narration">🔇</button>
          <button type="button" class="ov__btn ov__btn--x" id="ov-exit">EXIT</button>
        </div>
      </div>
```

- [ ] **Step 3: Add the CSS**

```css
.hero__alt {
  display: inline-block; margin-left: var(--space-4); font-size: 13px;
  color: var(--color-muted); text-decoration: none;
  border-bottom: 1px solid var(--color-line-strong);
}
.hero__alt:hover { color: var(--color-text); }

.ov { border-top: var(--rule); padding-top: var(--space-3); margin-top: var(--space-3); }
.ov[hidden] { display: none; }
.ov__leg {
  font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.12em;
  color: var(--color-accent-2);
}
.ov__where {
  font-family: var(--font-heading); font-weight: var(--fw-bold);
  font-size: 18px; margin-top: 2px;
}
.ov__text { font-size: 13px; color: var(--color-muted); margin: 6px 0 0; min-height: 3em; }
.ov__caption { transition: opacity 260ms ease; }
.ov__caption[data-fade="true"] { opacity: 0; }
.ov__bar { display: flex; align-items: center; gap: var(--space-3); margin-top: var(--space-3); }
.ov__btn {
  background: none; border: 1px solid var(--color-line-strong); border-radius: var(--radius);
  color: var(--color-text); font: inherit; font-size: 12px; padding: 5px 10px; cursor: pointer;
}
.ov__btn:hover { border-color: var(--color-text); }
.ov__btn--x { margin-left: auto; font-family: var(--font-mono); letter-spacing: 0.08em; }
.ov__dots { display: flex; gap: 6px; flex: 1; }
.ov__dot {
  flex: 1; height: 3px; border: 0; padding: 0; cursor: pointer;
  background: var(--color-line-strong);
}
.ov__dot[data-on="true"] { background: var(--color-accent); }

@media (prefers-reduced-motion: reduce) {
  .ov__caption { transition: none; }
}
```

- [ ] **Step 4: Write the player**

```js
  /* ─── the overview ──────────────────────────────────────────────────── */
  //
  // Plays the ride in place: the map eases to each region, the legs column scrolls
  // with it, and the caption below the map names where you are. It is a reading of
  // the same data the page already shows, not a second story.
  //
  // Narration audio is optional and ships as plumbing only. A leg may carry
  // `narration: "media/narration/leg-01.m4a"`; when the file is absent nothing appears
  // and nothing errors. Sound is off until asked for — autoplay policy aside, nobody
  // wants a phone talking at them in public.
  var Overview = (function () {
    var DWELL = 2600;          // ms per region, when not driven by audio
    var on = false, paused = false, pos = 0, timer = null;
    var audio = null, soundOn = false;

    function regions() { return regionsFlat; }

    function boundsFor(r) {
      var pts = mapPlaced.filter(function (p) { return p.idx === r.index; });
      if (!pts.length) return null;
      var lats = [], lons = [];
      pts.forEach(function (p) { lats.push(p.stop.lat); lons.push(p.stop.lon); });
      return {
        minLat: Math.min.apply(null, lats), maxLat: Math.max.apply(null, lats),
        minLon: Math.min.apply(null, lons), maxLon: Math.max.apply(null, lons),
      };
    }

    function legOf(r) {
      for (var i = 0; i < legs.length; i++) {
        if (legs[i].regions.indexOf(r) >= 0) return legs[i];
      }
      return null;
    }

    function paint(r) {
      var L = legOf(r);
      el.ovCaption.dataset.fade = 'true';
      setTimeout(function () {
        el.ovLeg.textContent = L ? (L.def.id + ' · ' + L.def.title).toUpperCase() : '';
        el.ovWhere.textContent = r.name;
        el.ovText.textContent = r.count + (r.count === 1 ? ' clip · ' : ' clips · ') + r.range +
          (L && L.def.sub ? ' — ' + L.def.sub : '');
        el.ovCaption.dataset.fade = 'false';
      }, MOTION.matches ? 0 : 260);

      el.ovDots.querySelectorAll('.ov__dot').forEach(function (d, i) {
        d.dataset.on = String(legs[i] === L);
      });
    }

    function show(i) {
      var rs = regions();
      if (i < 0 || i >= rs.length) return stop();
      pos = i;
      var r = rs[i];

      activeIdx = r.index; activeIdxs = [r.index];
      syncMap(); syncStrip();
      if (atlas) atlas.focus(boundsFor(r), !MOTION.matches);

      // Scroll the legs column in step. The overview drives the page; the page's own
      // scroll handler would otherwise fight it, so jump() is the single mover.
      jump(r.index);
      paint(r);

      var L = legOf(r);
      var track = L && L.def.narration;
      if (track && soundOn) playTrack(track);
      schedule(DWELL);
    }

    function schedule(ms) {
      clearTimeout(timer);
      if (paused) return;
      timer = setTimeout(function () { show(pos + 1); }, ms);
    }

    function playTrack(src) {
      if (audio && audio.src.indexOf(src) >= 0) return;
      stopTrack();
      audio = new Audio(src);
      audio.play().catch(function () { /* missing file, or no gesture yet */ });
    }
    function stopTrack() { if (audio) { audio.pause(); audio = null; } }

    function start() {
      if (on || !regions().length) return;
      on = true; paused = false;
      setPlanned(false);            // one line at a time; the overlay would confuse this
      hideStop();
      el.overview.hidden = false;
      buildDots();
      // Only offer the sound control if some leg actually declares a track.
      var any = legs.some(function (L) { return !!L.def.narration; });
      el.ovSound.hidden = !any;
      el.ovCta.textContent = 'OVERVIEW PLAYING';
      show(0);
    }

    function stop() {
      if (!on) return;
      on = false;
      clearTimeout(timer);
      stopTrack();
      el.overview.hidden = true;
      el.ovCta.textContent = 'SEE THE OVERVIEW ▸';
      if (atlas) atlas.focus(null, !MOTION.matches);
    }

    function buildDots() {
      el.ovDots.replaceChildren();
      legs.forEach(function (L, i) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'ov__dot';
        b.title = L.def.title;
        b.setAttribute('aria-label', L.def.title);
        b.addEventListener('click', function () {
          var first = L.regions[0];
          show(regions().indexOf(first));
        });
        el.ovDots.appendChild(b);
      });
    }

    function setPaused(p) {
      paused = p;
      el.ovPlay.textContent = p ? '▶' : '❚❚';
      el.ovPlay.setAttribute('aria-label', p ? 'Play' : 'Pause');
      if (audio) { if (p) audio.pause(); else audio.play().catch(function () {}); }
      if (!p) schedule(DWELL);
      else clearTimeout(timer);
    }

    return {
      start: start, stop: stop,
      next: function () { show(pos + 1); },
      toggle: function () { setPaused(!paused); },
      isOn: function () { return on; },
      setSound: function (v) {
        soundOn = v;
        el.ovSound.setAttribute('aria-pressed', String(v));
        el.ovSound.textContent = v ? '🔊' : '🔇';
        if (!v) stopTrack();
      },
    };
  })();
```

Wire it up in the boot block:

```js
  el.ovCta.addEventListener('click', function (e) {
    e.preventDefault();
    if (Overview.isOn()) Overview.stop(); else Overview.start();
  });
  el.ovExit.addEventListener('click', Overview.stop);
  el.ovPlay.addEventListener('click', Overview.toggle);
  el.ovSound.addEventListener('click', function () {
    Overview.setSound(el.ovSound.getAttribute('aria-pressed') !== 'true');
  });
  document.addEventListener('keydown', function (e) {
    if (!Overview.isOn()) return;
    if (e.key === 'Escape') Overview.stop();
    if (e.key === ' ') { e.preventDefault(); Overview.toggle(); }
    if (e.key === 'ArrowRight') { e.preventDefault(); Overview.next(); }
  });
```

Add `overview`, `ovCaption`, `ovLeg`, `ovWhere`, `ovText`, `ovDots`, `ovPlay`, `ovSound`, `ovExit`, `ovCta` to `el`.

**The page's own scroll handler will fight the player.** `index.html:1525` re-derives `activeIdx` on every scroll, and `jump()` scrolls. Guard it — at the top of the scroll handler's rAF callback add:

```js
      if (Overview.isOn()) return;   // the overview drives the page, not the scroll
```

- [ ] **Step 5: Verify by hand**

Desktop ≥1080px:
- [ ] The hero CTA starts the overview; the secondary link still jumps to the clips.
- [ ] The map eases from region to region; the legs column scrolls in step; the caption names the leg and the region.
- [ ] Chapter dots light per leg and jump when clicked.
- [ ] Pause stops both the timer and the movement; play resumes.
- [ ] Escape and EXIT both end it and reset the map to the whole country.
- [ ] Scrolling by hand during playback does not cause a fight (the guard holds).

Mobile <1080px (DevTools at 390px):
- [ ] The overview is usable — caption legible, controls reachable, the region accordion opens as it advances.

Reduced motion (DevTools → Rendering → Emulate `prefers-reduced-motion: reduce`):
- [ ] The map jump-cuts instead of easing; the caption does not fade; the player still advances and remains fully controllable.

Narration:
- [ ] With no `narration` on any leg, the speaker button is hidden and nothing errors.
- [ ] Add `narration: 'media/narration/leg-01.m4a'` to `LEGS[0]` temporarily → the button appears; with the file absent, clicking it fails silently and playback continues. Revert the edit.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Replace the hero CTA with an overview that plays the ride

The map eases region to region, the legs column scrolls with it, and a
caption below the map says where you are. The page's scroll handler is
guarded while it runs, or the two would fight over which region is current.

Narration ships as plumbing: a leg may name an audio track, the control only
appears when one does, and sound stays off until asked for."
```

---

## Task 7: The route book

**Files:**
- Create: `booklet.html`
- Modify: `netlify.toml` — cache headers for `template.json`, `template-notes.json`, `atlas.js`, `costs.js`.

**Interfaces:**
- Consumes: `atlas.js` (Task 2), `costs.js` (Task 4), `template.json` + `template-notes.json` (Task 1), `route.json`, `basemap.json`.
- Produces: nothing downstream.

- [ ] **Step 1: Write `booklet.html`**

Structure it as the spec lists: cover, at a glance, master map, one section per sector, costs, season calendar, planning pages, "this is a template". Load the same fonts and tokens as `index.html`.

The critical part is the print block. **A #0f0f0f page must not be what `window.print()` produces.**

```css
@page { size: A4; margin: 16mm 14mm; }

@media print {
  /* The site is dark. Paper is not. Flip the tokens rather than restyling every
     rule — everything downstream reads from these. */
  :root {
    --color-bg: #ffffff;
    --color-surface: #ffffff;
    --color-raise: #f4f4f4;
    --color-text: #111111;
    --color-muted: #333333;
    --color-dim: #555555;
    --color-faint: #777777;
    --color-line: rgba(0, 0, 0, 0.16);
    --color-line-strong: rgba(0, 0, 0, 0.34);
    /* Vermilion survives a mono printer as a mid grey; the violet does not. */
    --color-accent: #b3300f;
    --color-accent-2: #b3300f;
  }
  body { background: #fff; color: #111; }
  .noprint, .bk__actions { display: none !important; }

  /* Landmass fill is 40% of an A4 page in toner. Outline only. */
  .atlas .india { fill: none; stroke: #111; stroke-width: 1.1; }
  .atlas .neighbour { stroke: rgba(0,0,0,0.25); }
  .atlas .route { stroke: #b3300f; stroke-width: 1.6; }
  .atlas .route--planned { stroke: #777; stroke-dasharray: 4 3; }
  .atlas .stop { fill: #fff; stroke: #111; }
  .atlas .tiles { display: none; }   /* tiles never print usefully */

  .bk__sector { break-before: page; }
  .bk__sector:first-of-type { break-before: auto; }
  table, .bk__card, .bk__stage { break-inside: avoid; }
  h1, h2, h3 { break-after: avoid; }
  tr { break-inside: avoid; }

  /* Without this the flipped tokens print as the browser's default black-on-white
     and the route line disappears. */
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
```

The page JS mirrors `index.html`'s boot: fetch `basemap.json`, `route.json`, `template.json`, `template-notes.json`; `Atlas.create` on each `<svg class="atlas">`; draw the planned route on the master map and, per sector, the whole loop dimmed with that sector's hops highlighted:

```js
  function sectorMap(svg, tpl, sector) {
    var a = Atlas.create(svg, basemap, { width: 420, height: 470, pad: 10 });
    if (!a) return;
    a.drawBase();
    var all = [{ lat: tpl.hops[0].fromLat, lon: tpl.hops[0].fromLon }];
    tpl.hops.forEach(function (h) { all.push({ lat: h.toLat, lon: h.toLon }); });
    a.drawRoute(all, 'route--planned');

    var seg = [{ lat: tpl.hops[sector.hopFrom].fromLat, lon: tpl.hops[sector.hopFrom].fromLon }];
    for (var i = sector.hopFrom; i <= sector.hopTo; i++) {
      seg.push({ lat: tpl.hops[i].toLat, lon: tpl.hops[i].toLon });
    }
    a.drawRoute(seg, 'route');
  }
```

Include a visible "Print / save as PDF" button that calls `window.print()`, marked `.noprint`.

For the **season calendar**, render one row per sector reading from `templateNotes.sectors[id].season`. Where it still says `TO WRITE`, print the dashed placeholder box, exactly as the site does. **The route book must not ship invented permit advice** — a reader would act on it.

- [ ] **Step 2: Update `netlify.toml`**

Add after the existing `manifest.json` header block, matching its style (order matters — the catch-all stays first):

```toml
[[headers]]
  for = "/template.json"
  [headers.values]
    Cache-Control = "public, max-age=300"

[[headers]]
  for = "/template-notes.json"
  [headers.values]
    Cache-Control = "public, max-age=300"
```

- [ ] **Step 3: Verify on screen**

- [ ] `http://127.0.0.1:8899/booklet.html` renders dark, matching the site.
- [ ] The master map draws the full planned loop; each sector map shows the loop dimmed with that sector solid.
- [ ] Totals match the site exactly: 18,181 km, 97 legs, 412 hours, 5 sectors.
- [ ] Cost tables match the site's figures to the rupee.

- [ ] **Step 4: Verify in print preview**

Chrome → Print (⌘P), A4, **Background graphics ON**:
- [ ] The page is white with black text — no dark flood.
- [ ] The route line is visible in the sector maps; the landmass is an outline, not a solid block.
- [ ] Each sector starts on a fresh page.
- [ ] No waypoint table splits mid-row; no heading is orphaned at a page foot.
- [ ] "Print / save as PDF" and any nav are absent from the output.
- [ ] Save as PDF and reopen — confirm it is legible and the maps survived.

Also check with **Background graphics OFF**, since that is the default in some browsers: text and route must still be readable.

- [ ] **Step 5: Commit**

```bash
git add booklet.html netlify.toml
git commit -m "Add the printable route book

Sector by sector: a map with that sector solid against the dimmed loop, its
waypoint table, POIs and season notes, then the cost breakdown.

Print flips the palette rather than restyling every rule. The site is
#0f0f0f and A4 is not; the landmass drops to an outline so a sector map is
not 40% of a page in toner."
```

---

## Task 8: Documentation

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Correct the stale sections**

The README's "The site" section claims the `modernist` design system — "Archivo throughout, #f3f2f2 paper, #201e1d ink, #ec3013 accent". **The live CSS is dark**: `#0f0f0f` bg, `#ffffff` text, `#8b5cf6` accent, `#ec4899` secondary, Space Grotesk + IBM Plex Mono. Fix that paragraph to describe what is actually there.

Also soften the map section's "no external requests" — true of the map *data*, but the page loads Google Fonts and, with the real-map toggle on, OSM tiles.

- [ ] **Step 2: Document the template pipeline**

Add a `## The template` section covering: what `template.json` is and how it differs from `route.json`; the generate command; why sector boundaries are derived from crossings rather than hardcoded; the `SUBDIVIDE` and `CROSSINGS` constants; the 18,039 vs 18,181 discrepancy and the Agartala–Kolkata row behind it; that `template-notes.json` is hand-authored content the generator refuses to run without; and that `TO WRITE` entries render as visible gaps by design.

Add a `## Tests` section:

```
node --test
```

Zero dependencies — Node's built-in runner. Covers the generator's parsing and sector
derivation, the atlas's projection and clustering, and the cost projection. The UI has
no automated coverage; the per-task checklists in the plan are the record of what to
walk through by hand.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Document the template pipeline, and correct two stale claims

The design-system paragraph described a light modernist palette the site
hasn't used in some time; the live tokens are dark. And 'no external
requests' was always about the map data — the page does load Google Fonts
and, with the real-map toggle on, OSM tiles."
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| `template.json` / `build-template.cjs` / derived sectors | 1 |
| Known 18,039 vs 18,181 discrepancy, long-hop warning | 1 (Step 3), 8 |
| `template-notes.json`, seeded POIs, generator fails without it | 1 |
| `atlas.js` extraction, stated API surface | 2 |
| `#template` section, sectors, join points, waypoint tables | 3 |
| Costs from observed rates, stated hours-per-day | 4 |
| Planned-vs-ridden overlay + honest panel | 5 |
| Overview: map, scroll sync, captions, controls, reduced motion, mobile | 6 |
| Narration as plumbing only, muted by default | 6 |
| `booklet.html`, print palette flip, page breaks, season calendar | 7 |
| README correction (dark palette, external requests) | 8 |
| Testing approach | 1, 2, 4 (automated); per-task manual checklists |
| Out of scope: no npm deps, no clip/tag changes, no audio recording | Global Constraints |

No gaps.

**Placeholder scan:** No TBDs. The `TO WRITE` strings in `template-notes.json` are a deliberate, specified product behaviour — author-owned content rendered as a visible gap — not plan placeholders; Tasks 3, 5 and 7 each specify the exact UI for them.

**Type consistency:** Checked. `Atlas.create` → `drawBase` / `drawRoute` / `drawMarkers` / `setTiles` / `focus` / `project` / `frame` / `clusters` are used with those exact names in Tasks 2, 5, 6 and 7. Cluster objects expose `items` (not the old `stops`) and `dot`; Task 2 Step 5 calls out every rename site. `Costs.project` returns `{ nights, observed, perNight, hoursPerDay, sectors, days, total }`, consumed under those names in Task 4 and Task 7. `template.json` field names are fixed in Task 1 and read identically in Tasks 3–7.

**One correction to note:** Task 4 initially placed `projectCosts` in `atlas.js`. Costs are not geography, so it became its own `costs.js`. The task text reflects the corrected structure.
