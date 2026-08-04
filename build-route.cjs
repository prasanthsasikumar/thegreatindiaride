/*
 * build-route.cjs — turns the trip spreadsheet into route.json.
 *
 *   node build-route.cjs "/path/to/Pan India Trip  - Trip expenses.csv"
 *
 * The sheet is one row per night, in travel order, which is the only authoritative
 * record of the route — GPS fixes drift and upload timestamps lag by hours, but the
 * order you slept in places is exact.
 *
 * PRIVACY: route.json is published (netlify.toml publishes "."). It carries only
 * region-level spend aggregates and the trip total — never per-night lines, never the
 * Misc_label column (which holds things like medical, fines and theft), and never the
 * Accomodation Link column (specific hotels). Point it at the CSV, which stays outside
 * the repo.
 */

const fs = require('fs');
const path = require('path');

const CSV = process.argv[2];
const STOP_CACHE = '.stopcache.json';
const OUT = 'route.json';

// Rows that are in the sheet but not on the motorcycle route. Keeping them would
// insert a phantom leg — TVM is the flight home mid-trip (out of Guwahati, on to
// Singapore, then back to Guwahati), which would otherwise drop a Kerala chapter
// into the middle of the northeast and inflate Kerala's visit count.
// Keyed by 1-based data row (i.e. spreadsheet line minus the header).
const SKIP_NIGHTS = new Set([71]);

// The ride started and finished at home in Trivandrum. That first departure isn't in
// the sheet — the sheet only records nights that were paid for, and the first of those
// was Kanyakumari. Prepended to the drawn path so the line starts where the ride did;
// deliberately NOT added to legs, nights or regionOrder, since Kerala already closes
// the story as the homecoming chapter.
const ORIGIN = 'Trivandrum';

if (!CSV || !fs.existsSync(CSV)) {
  console.error('Usage: node build-route.cjs <trip-expenses.csv>');
  process.exit(1);
}
if (!fs.existsSync(STOP_CACHE)) {
  console.error(`Missing ${STOP_CACHE} — geocode the stop names first.`);
  process.exit(1);
}

/* ---------- tiny CSV reader (fields may be quoted and contain commas) ---------- */

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const money = s => {
  const n = parseFloat(String(s || '').replace(/[₹,\s]/g, ''));
  return isFinite(n) ? n : 0;
};

/* ---------- read the sheet ---------- */

const stopGeo = JSON.parse(fs.readFileSync(STOP_CACHE, 'utf8'));
const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));

const nights = [];
const skipped = [];
let dataRow = 0;
for (const r of rows.slice(1)) {
  const name = (r[0] || '').trim();
  if (!name || name === 'Actual' || name === 'Average') continue;
  dataRow++;
  if (SKIP_NIGHTS.has(dataRow)) { skipped.push(`${dataRow}. ${name}`); continue; }
  const geo = stopGeo[name] || {};
  nights.push({
    name: name.replace(/\*\d+$/, ''), // "Banglore*2" is a note about nights, not a place
    region: geo.state || null,
    country: geo.country || null,
    lat: geo.lat, lon: geo.lon,
    // Summed here and immediately aggregated away — never emitted per night.
    spend: money(r[1]) + money(r[2]) + money(r[3]) + money(r[4]),
  });
}

const unresolved = nights.filter(n => !n.region).map(n => n.name);
if (unresolved.length) console.warn('Unresolved stops:', [...new Set(unresolved)].join(', '));

/* ---------- collapse consecutive nights in the same region into legs ---------- */

const legs = [];
nights.forEach((n, i) => {
  const last = legs[legs.length - 1];
  if (last && last.region === n.region) {
    last.nights++;
    last.spend += n.spend;
    if (last.stops[last.stops.length - 1] !== n.name) last.stops.push(n.name);
    last.lastNight = i + 1;
  } else {
    legs.push({
      order: legs.length + 1,
      region: n.region,
      country: n.country,
      stops: [n.name],
      nights: 1,
      spend: n.spend,
      firstNight: i + 1,
      lastNight: i + 1,
      lat: n.lat, lon: n.lon,
    });
  }
});

/* ---------- region-level rollup ---------- */

const byRegion = {};
nights.forEach(n => {
  if (!n.region) return;
  if (!byRegion[n.region]) byRegion[n.region] = { region: n.region, country: n.country, nights: 0, spend: 0, stops: [] };
  byRegion[n.region].nights++;
  byRegion[n.region].spend += n.spend;
  if (!byRegion[n.region].stops.includes(n.name)) byRegion[n.region].stops.push(n.name);
});

// First appearance along the route — the only ordering that means anything here.
const regionOrder = [];
nights.forEach(n => { if (n.region && !regionOrder.includes(n.region)) regionOrder.push(n.region); });

const total = nights.reduce((s, n) => s + n.spend, 0);

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  source: path.basename(CSV),
  nights: nights.length,
  regionOrder,
  legs: legs.map(l => ({
    order: l.order, region: l.region, country: l.country, stops: l.stops,
    nights: l.nights, firstNight: l.firstNight, lastNight: l.lastNight,
    spend: Math.round(l.spend), lat: l.lat, lon: l.lon,
  })),
  regions: regionOrder.map(r => ({
    region: r, country: byRegion[r].country, nights: byRegion[r].nights,
    stops: byRegion[r].stops, spend: Math.round(byRegion[r].spend),
  })),
  // Town-centre coordinates in travel order, for drawing the route line. These are
  // public place centroids from geocoding the stop names — not GPS traces, and not
  // the hotels themselves.
  path: (() => {
    const g = stopGeo[ORIGIN] || {};
    const home = g.lat != null
      ? [{ n: 0, name: ORIGIN, region: g.state || null, lat: g.lat, lon: g.lon, origin: true }]
      : [];
    return home.concat(nights.map((n, i) => ({ n: i + 1, name: n.name, region: n.region, lat: n.lat, lon: n.lon })));
  })(),
  home: ORIGIN,
  totals: { nights: nights.length, spend: Math.round(total), regions: regionOrder.length },
}, null, 2));

console.log(`Wrote ${OUT}`);
if (skipped.length) console.log(`  skipped (not on the route): ${skipped.join(', ')}`);
console.log(`  ${nights.length} nights · ${legs.length} legs · ${regionOrder.length} regions`);
console.log(`  route: ${regionOrder.slice(0, 6).join(' → ')} … ${regionOrder.slice(-3).join(' → ')}`);
console.log(`  aggregate spend only — no per-night lines, no misc labels, no hotel links`);
