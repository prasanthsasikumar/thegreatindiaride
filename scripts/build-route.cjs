/*
 * build-route.cjs: turns the trip spreadsheet into route.json.
 *
 *   node scripts/build-route.cjs "/path/to/Pan India Trip  - Trip expenses.csv"
 *
 * The sheet is one row per night, in travel order, which is the only authoritative
 * record of the route. GPS fixes drift and upload timestamps lag by hours, but the
 * order you slept in places is exact.
 *
 * PRIVACY: route.json is published (netlify.toml publishes "."). It carries
 * region-level spend aggregates, the trip total, and, by explicit choice, a `stops`
 * list naming each place stayed, its Google Maps link, nights, and what was paid.
 * That is a public record of where the rider slept on 93 nights; it is published
 * because the map is meant to be browsable, not because it is incidental.
 *
 * The Misc_label column stays out. It holds things like medical, fines, scam and
 * theft, and nothing in the UI needs it. Keep it that way. The CSV itself stays
 * outside the repo.
 */

const fs = require('fs');
const path = require('path');

const CSV = process.argv[2];
const STOP_CACHE = '.stopcache.json';
const STAY_CACHE = '.staycache.json';
// night number -> real check-in date, taken from the rider's Booking.com and Agoda
// confirmations. The sheet has no dates at all, and interpolating them evenly across
// the trip was out by a median of 2 days and up to 4 through Nepal and Assam.
const STAY_DATES = 'data/stay-dates.json';
const OUT = 'data/route.json';

// Rows that are in the sheet but not on the motorcycle route. Keeping them would
// insert a phantom leg. TVM is the flight home mid-trip (out of Guwahati, on to
// Singapore, then back to Guwahati), which would otherwise drop a Kerala chapter
// into the middle of the northeast and inflate Kerala's visit count.
// Keyed by 1-based data row (i.e. spreadsheet line minus the header).
const SKIP_NIGHTS = new Set([71]);

// The ride started and finished at home in Trivandrum. That first departure isn't in
// the sheet, which only records nights that were paid for, and the first of those
// was Kanyakumari. Prepended to the drawn path so the line starts where the ride did;
// deliberately NOT added to legs, nights or regionOrder, since Kerala already closes
// the story as the homecoming chapter.
const ORIGIN = 'Trivandrum';

// Regions ridden through without sleeping, so they have no row in the sheet. But
// clips from them exist and need a place in the running order. Inserted straight
// after the night given, which is the only thing that fixes their position: guessing
// from clip dates put Bhutan before West Bengal and Bihar before Nepal.
const TRANSIT = [
  { region: 'Bihar',  country: 'India',  afterNight: 57 },  // Nepal → Siliguri crosses Bihar
  { region: 'Bhutan', country: 'Bhutan', afterNight: 60 },  // day trip over the border from Jaigaon
];

if (!CSV || !fs.existsSync(CSV)) {
  console.error('Usage: node scripts/build-route.cjs <trip-expenses.csv>');
  process.exit(1);
}
if (!fs.existsSync(STOP_CACHE)) {
  console.error(`Missing ${STOP_CACHE}. Geocode the stop names first.`);
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
const stayGeo = fs.existsSync(STAY_CACHE) ? JSON.parse(fs.readFileSync(STAY_CACHE, 'utf8')) : {};
const stayDates = fs.existsSync(STAY_DATES) ? JSON.parse(fs.readFileSync(STAY_DATES, 'utf8')) : {};

// Piecewise-linear between anchors; beyond the ends, carry the nearest segment's
// slope. With 19 anchors spread over the trip every night lands within a day.
const anchors = Object.keys(stayDates)
  .map(n => ({ night: +n, t: Date.parse(stayDates[n] + 'T00:00:00Z') }))
  .sort((a, b) => a.night - b.night);

const DAY = 86400000;
function nightDate(night) {
  if (!anchors.length) return null;
  if (anchors.length === 1) return new Date(anchors[0].t + (night - anchors[0].night) * DAY);

  let lo = anchors[0], hi = anchors[anchors.length - 1];
  for (let i = 0; i < anchors.length - 1; i++) {
    if (night >= anchors[i].night && night <= anchors[i + 1].night) { lo = anchors[i]; hi = anchors[i + 1]; break; }
  }
  if (night < anchors[0].night) { lo = anchors[0]; hi = anchors[1]; }
  if (night > anchors[anchors.length - 1].night) { lo = anchors[anchors.length - 2]; hi = anchors[anchors.length - 1]; }

  const slope = (hi.t - lo.t) / Math.max(1, hi.night - lo.night);
  return new Date(lo.t + (night - lo.night) * slope);
}
const iso = d => (d ? d.toISOString().slice(0, 10) : null);
const rows = parseCsv(fs.readFileSync(CSV, 'utf8'));

// The sheet's links carry tracking/query junk that varies between rows for the same
// hotel (?g_st=..., ?entry=...). Key the cache on the bare URL so repeat stays match.
const bareLink = s => (s || '').trim().split('?')[0];

const nights = [];
const skipped = [];
let dataRow = 0;
for (const r of rows.slice(1)) {
  const name = (r[0] || '').trim();
  if (!name || name === 'Actual' || name === 'Average') continue;
  dataRow++;
  if (SKIP_NIGHTS.has(dataRow)) { skipped.push(`${dataRow}. ${name}`); continue; }
  const geo = stopGeo[name] || {};
  const clean = name.replace(/\*\d+$/, ''); // "Banglore*2" is a note about nights, not a place
  const link = bareLink(r[6]);
  // "Home" marks a night that cost nothing and has no hotel to point at. Nights with no
  // link at all fall back to a name-keyed entry: a hostel that never made it into the
  // sheet, or somebody's house.
  const stay = (link && link !== 'Home') ? stayGeo[link] : stayGeo['name:' + clean];
  // Friends' and family's homes get a name but keep the town centre: they are other
  // people's addresses, and nothing on the site needs them pinned.
  const sited = stay && !stay.private;
  nights.push({
    name: clean,
    region: geo.state || null,
    country: geo.country || null,
    // The stay's own coordinates where we have them; the town centre otherwise. The
    // region always comes from the stop name, never from the stay. A few hotels sit
    // just over a border (Zirakpur for Chandigarh, Noida for Delhi) and re-deriving
    // the region from them would silently drop chapters out of the narrative.
    lat: sited ? stay.lat : geo.lat,
    lon: sited ? stay.lon : geo.lon,
    precise: !!sited,
    private: !!(stay && stay.private),
    stay: stay ? stay.stay : null,
    // The sheet's own link where there is one. A stay we sited by hand (Decostel) has
    // real coordinates but no link, so point at those instead. There is no reason for it to be
    // the one marker you can't open. Private homes never get a link.
    link: sited
      ? ((link && link !== 'Home') ? link
        : 'https://www.google.com/maps/search/?api=1&query=' + stay.lat + ',' + stay.lon)
      : null,
    stayCost: money(r[1]),
    spend: money(r[1]) + money(r[2]) + money(r[3]) + money(r[4]),
  });
}

// Private homes are meant to sit at the town centre; only warn about nights we simply
// have nothing for.
const missingStay = nights.filter(n => !n.precise && !n.private).map(n => n.name);
if (missingStay.length) console.warn('No stay recorded (using town centre):', [...new Set(missingStay)].join(', '));

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

// Splice the transit regions into the running order. They carry no nights and no
// spend; they exist so the narrative doesn't jump straight from Sikkim to Assam.
TRANSIT.forEach(t => {
  const at = legs.findIndex(l => l.firstNight > t.afterNight);
  const entry = {
    order: 0, region: t.region, country: t.country, stops: [], nights: 0, spend: 0,
    firstNight: t.afterNight, lastNight: t.afterNight, transit: true,
    lat: null, lon: null,
  };
  if (at === -1) legs.push(entry); else legs.splice(at, 0, entry);
});
legs.forEach((l, i) => { l.order = i + 1; });

/* ---------- region-level rollup ---------- */

const byRegion = {};
nights.forEach(n => {
  if (!n.region) return;
  if (!byRegion[n.region]) byRegion[n.region] = { region: n.region, country: n.country, nights: 0, spend: 0, stops: [] };
  byRegion[n.region].nights++;
  byRegion[n.region].spend += n.spend;
  if (!byRegion[n.region].stops.includes(n.name)) byRegion[n.region].stops.push(n.name);
});

// First appearance along the route: the only ordering that means anything here.
const regionOrder = [];
nights.forEach(n => { if (n.region && !regionOrder.includes(n.region)) regionOrder.push(n.region); });

const total = nights.reduce((s, n) => s + n.spend, 0);

/* ---------- collapse consecutive nights at the same stay into map stops ---------- */
//
// 93 nights but 64 hotels: Varanasi alone is four separate stays across seven nights.
// One marker per unbroken run at the same address, so the map shows places slept
// rather than a pile of coincident dots. A return to the same hotel after going
// somewhere else (Guwahati, three times) correctly gets a marker each time.

const stops = [];
nights.forEach((n, i) => {
  const last = stops[stops.length - 1];
  const sameStay = last && (n.link ? last.link === n.link : (!last.link && last.name === n.name));
  if (sameStay) {
    last.nights++;
    last.spend += n.spend;
    last.stayCost += n.stayCost;
    last.lastNight = i + 1;
  } else {
    stops.push({
      name: n.name, stay: n.stay, link: n.link,
      region: n.region, country: n.country,
      lat: n.lat, lon: n.lon, precise: n.precise, private: n.private,
      nights: 1, spend: n.spend, stayCost: n.stayCost,
      firstNight: i + 1, lastNight: i + 1,
    });
  }
});

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  source: path.basename(CSV),
  nights: nights.length,
  regionOrder,
  legs: legs.map(l => ({
    order: l.order, region: l.region, country: l.country, stops: l.stops,
    nights: l.nights, firstNight: l.firstNight, lastNight: l.lastNight,
    firstDate: iso(nightDate(l.firstNight)), lastDate: iso(nightDate(l.lastNight)),
    spend: Math.round(l.spend), lat: l.lat, lon: l.lon,
    ...(l.transit && { transit: true }),
  })),
  regions: regionOrder.map(r => ({
    region: r, country: byRegion[r].country, nights: byRegion[r].nights,
    stops: byRegion[r].stops, spend: Math.round(byRegion[r].spend),
  })),
  // One entry per place slept, in travel order. This is what the map draws and what
  // its markers read from. Rounded to 5dp (~1m); more digits than that is noise.
  stops: (() => {
    const g = stopGeo[ORIGIN] || {};
    const home = g.lat != null
      ? [{ name: ORIGIN, stay: null, link: null, region: g.state || null, country: g.country || null,
           lat: g.lat, lon: g.lon, precise: false, nights: 0, spend: 0, stayCost: 0, origin: true }]
      : [];
    return home.concat(stops).map((s, i) => ({
      n: i, ...s,
      ...(s.firstNight ? { date: iso(nightDate(s.firstNight)) } : {}),
      lat: Math.round(s.lat * 1e5) / 1e5,
      lon: Math.round(s.lon * 1e5) / 1e5,
      spend: Math.round(s.spend), stayCost: Math.round(s.stayCost),
    }));
  })(),
  home: ORIGIN,
  totals: { nights: nights.length, spend: Math.round(total), regions: regionOrder.length },
}, null, 2));

console.log(`Wrote ${OUT}`);
if (skipped.length) console.log(`  skipped (not on the route): ${skipped.join(', ')}`);
console.log(`  ${nights.length} nights · ${legs.length} legs · ${regionOrder.length} regions · ${stops.length} stops`);
console.log(`  route: ${regionOrder.slice(0, 6).join(' → ')} … ${regionOrder.slice(-3).join(' → ')}`);
console.log(`  ${stops.filter(s => s.precise).length}/${stops.length} stops at their real address; the rest fall back to the town centre`);
console.log(`  publishes stop names, hotel links and per-stop spend; misc labels stay out`);
