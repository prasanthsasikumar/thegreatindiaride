/*
 * build-basemap.cjs: turns Natural Earth country boundaries into basemap.json.
 *
 *   node scripts/build-basemap.cjs ne_10m_admin_0_countries_ind.geojson
 *
 * Source (public domain):
 *   https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ind.geojson
 *
 * USE THE `_ind` POINT-OF-VIEW FILE. Natural Earth's default country set draws
 * India along the Line of Control, which clips Aksai Chin and Pakistan-administered
 * Kashmir. India stops at lat 35.5 instead of 37.05, and the northern tip of the
 * map is visibly cut away. Natural Earth publishes per-country POV variants for
 * exactly this; `_ind` is India's own depiction, which is the correct outline for
 * a map of an Indian ride. It only exists at 10m, hence the larger input file;
 * simplification below brings the output back down.
 *
 * The journey map needs real coastlines, not a scatter of stops. Rather than pull in a
 * tile provider (an external request on every page view, for a map that never pans or
 * zooms), this bakes the outlines the route actually crosses into a small JSON file
 * the page projects itself. Self-contained, no network, no attribution overlay.
 *
 * Rings are clipped to the route's neighbourhood and simplified with Douglas–Peucker,
 * because at the size this renders, sub-5km coastline detail is invisible.
 */

const fs = require('fs');

const SRC = process.argv[2];
const OUT = 'data/basemap.json';

// India plus everything the ride touched or that frames it.
const COUNTRIES = {
  India: 'primary',
  Nepal: 'primary',
  Bhutan: 'primary',
  Bangladesh: 'context',
  'Sri Lanka': 'context',
  Pakistan: 'context',
  China: 'context',
  Myanmar: 'context',
};

const BBOX = { minLon: 66, maxLon: 98, minLat: 5, maxLat: 37 };
const TOLERANCE = 0.015;  // degrees ~1.6km, fine enough at render size
const PRECISION = 3;      // decimals kept, ~110m
const MIN_RING = 6;       // points, after simplifying
const MIN_SPAN = 0.6;     // degrees; drops specks and small islands

if (!SRC || !fs.existsSync(SRC)) {
  console.error('Usage: node scripts/build-basemap.cjs <ne_50m_admin_0_countries.geojson>');
  process.exit(1);
}

const P10 = Math.pow(10, PRECISION);
const round = n => Math.round(n * P10) / P10;

/* ---------- Douglas–Peucker ---------- */

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  const cx = a[0] + Math.max(0, Math.min(1, t)) * dx;
  const cy = a[1] + Math.max(0, Math.min(1, t)) * dy;
  return Math.hypot(p[0] - cx, p[1] - cy);
}

function simplify(points, tol) {
  if (points.length < 3) return points;
  let maxD = 0, idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], points[0], points[points.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= tol) return [points[0], points[points.length - 1]];
  return simplify(points.slice(0, idx + 1), tol)
    .slice(0, -1)
    .concat(simplify(points.slice(idx), tol));
}

/* ---------- extract ---------- */

const geo = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const out = [];
let rawPts = 0, keptPts = 0;

for (const f of geo.features) {
  const name = f.properties.NAME || f.properties.ADMIN;
  const role = COUNTRIES[name];
  if (!role) continue;

  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];

  for (const poly of polys) {
    // [0] is the outer ring; holes are invisible at this scale.
    const ring = poly[0].map(c => [c[0], c[1]]);
    rawPts += ring.length;

    const lons = ring.map(p => p[0]), lats = ring.map(p => p[1]);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);

    // Skip anything wholly outside the frame, and specks inside it.
    if (maxLon < BBOX.minLon || minLon > BBOX.maxLon) continue;
    if (maxLat < BBOX.minLat || minLat > BBOX.maxLat) continue;
    if (maxLon - minLon < MIN_SPAN && maxLat - minLat < MIN_SPAN) continue;

    const simplified = simplify(ring, TOLERANCE)
      // Round AFTER simplifying, and keep enough precision to be worth it. At 2
      // decimals every point snapped to a ~1.1km grid, which staircased the
      // coastline and undid any tolerance finer than that.
      .map(p => [round(p[0]), round(p[1])]);
    if (simplified.length < MIN_RING) continue;

    keptPts += simplified.length;
    rings.push(simplified);
  }

  if (rings.length) out.push({ name, role, rings });
}

fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString(),
  source: 'Natural Earth 1:10m admin_0 countries, India point-of-view (public domain)',
  bbox: BBOX,
  countries: out,
}));

const bytes = fs.statSync(OUT).size;
console.log(`Wrote ${OUT}`);
console.log(`  ${out.length} countries · ${rawPts} points in → ${keptPts} kept (${Math.round(100 - keptPts / rawPts * 100)}% dropped)`);
console.log(`  ${(bytes / 1024).toFixed(1)} KB`);
out.forEach(c => console.log(`    ${c.name.padEnd(12)} ${c.role.padEnd(8)} ${c.rings.length} ring(s)`));
