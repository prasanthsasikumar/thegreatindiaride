/*
 * build-k2k.cjs: writes k2k.json, the two lines of a Kanyakumari-to-Kashmir ride.
 *
 *   node build-k2k.cjs
 *
 * K2K is the prestige pan-India route and the one this site's own loop already
 * contains most of. It is drawn here the way riders describe it and the way the
 * field research's fig-01 shows it: two lines, up one side of the country and down
 * the other.
 *
 * THE HONESTY PROBLEM, which is most of what this file is about.
 *
 * There is no K2K itinerary in this repo. Nothing here may invent a road distance
 * or a coordinate, so each line gets exactly one legitimate source and is labelled
 * with it:
 *
 *   SOUTHBOUND is measured. It reuses the template's own west-side hops, whose
 *   per-hop road distances were really measured for the itinerary, and sums their
 *   published km. Nothing is re-measured and nothing is estimated. The line is
 *   drawn through every intermediate stop those hops pass, including the Kutch
 *   spur out to Narayan Sarovar, because a line that skipped stops the sum charges
 *   for would be a shorter drawing wearing a longer number.
 *
 *   NORTHBOUND is cited, not computed. NH-44 is a documented public highway; its
 *   length is a published figure, and this file quotes it with its variance and its
 *   attribution. The ten-odd cities strung together here are a corridor sketch of
 *   where that highway runs. The length of that polyline is a drawing. It is never
 *   summed, never stored and never shown as a distance, which is why the north
 *   object carries `measured: false` and no km field of its own.
 *
 * Coordinates come from template.json wherever template.json already has them. The
 * corridor cities it lacks are geocoded against Nominatim, the same way
 * tag-media.cjs does it: a descriptive User-Agent, one request a second, and every
 * answer cached to .k2kcache.json so a re-run asks for nothing. Each written point
 * carries `source: "template" | "nominatim"` so the provenance survives into the
 * data rather than living only in this comment.
 */

const fs = require('fs');

const TEMPLATE_FILE = 'template.json';
const CACHE_FILE = '.k2kcache.json';
const OUT_FILE = 'k2k.json';

// Nominatim asks for a descriptive UA and max 1 req/sec. We respect both.
const USER_AGENT = 'ride-assets-k2k/1.0 (+https://thegreatindiaride.prasanthsasikumar.com)';
const RATE_LIMIT_MS = 1100;

/* ---------- the two lines, declared ---------- */

// Up the spine. The cities NH-44 runs by, south to north, in road order:
// Kanniyakumari through Tamil Nadu and Karnataka, up the Deccan through Hyderabad
// and Nagpur, across the Gangetic plain by Jhansi, Gwalior and Agra to Delhi, then
// north through Haryana and Punjab to Jammu and over to Srinagar.
const NORTH_LINE = [
  'Kanniyakumari', 'Madurai', 'Salem', 'Bengaluru', 'Kurnool', 'Hyderabad',
  'Nagpur', 'Jhansi', 'Gwalior', 'Agra', 'Delhi', 'Kurukshetra', 'Ambala',
  'Jammu', 'Udhampur', 'Srinagar',
];

// Down the west coast. These are the anchors, not the whole line: consecutive pairs
// are resolved through template.json's own hop chain below, so the drawn line picks
// up every stop between them and the summed distance is exactly the road drawn.
const SOUTH_ANCHORS = [
  'Delhi', 'Jaipur', 'Ajmer', 'Udaipur', 'Rajkot', 'Surat', 'Mumbai', 'Ratnagiri',
  'Goa', 'Hubballi', 'Chitradurga', 'Bengaluru', 'Coimbatore', 'Kochi',
  'Thiruvananthapuram', 'Kanniyakumari',
];

// The Kutch spur, and why it needs its own number.
//
// template.json calls this whole sector "West coast & Kutch": the repo itself treats
// Kutch as something other than the west coast, and it is right to. The run out past
// Bhuj to Narayan Sarovar is a detour to the Pakistan border that no K2K rider makes.
//
// It cannot be dropped from the sum. There is no measured Rajkot-to-Udaipur hop in
// this repo, so leaving the spur out would mean inventing a distance for the direct
// road, which is the one thing this file exists not to do. And the line has to draw
// every kilometre it charges for. So the spur stays in, gets measured separately, and
// is disclosed: without its own figure a reader comparing 4,449 against NH-44's cited
// 3,745 concludes the west coast is 700 km longer than the highway, when most of that
// gap is this detour.
const SOUTH_SPUR = ['Rajkot', 'Bhuj', 'Narayan Sarovar', 'Dhordo', 'Dholavira', 'Palanpur'];

// What to ask Nominatim, for the corridor cities template.json does not name. The
// state is part of the query on purpose: "Salem" alone is a town in Oregon and
// several other places, and a wrong hit here puts the line through the sea.
const QUERIES = {
  'Madurai': 'Madurai, Tamil Nadu, India',
  'Salem': 'Salem, Tamil Nadu, India',
  'Nagpur': 'Nagpur, Maharashtra, India',
  'Jhansi': 'Jhansi, Uttar Pradesh, India',
  'Agra': 'Agra, Uttar Pradesh, India',
  'Ambala': 'Ambala, Haryana, India',
};

// And where each of them has to land for the answer to be believable. Half a degree
// is about 55 km, which is loose enough for a city centroid to move around in and
// tight enough that a different continent fails loudly.
const EXPECT = {
  'Madurai': [9.9, 78.1],
  'Salem': [11.7, 78.2],
  'Nagpur': [21.1, 79.1],
  'Jhansi': [25.4, 78.6],
  'Agra': [27.2, 78.0],
  'Ambala': [30.4, 76.8],
};
const EXPECT_TOL = 0.5;

// The published length of NH-44, with its variance and where both figures come
// from. Quoted, never derived. If the research is ever re-crawled and these move,
// they move here and nowhere else: neither page holds a copy.
const NH44 = {
  citedKm: 3745,
  citedKmAlt: 4112,
  states: 11,
  cite: 'Length as published for National Highway 44: commonly 3,745 km across 11 ' +
    'states, with some sources quoting 4,112 km. Roadory, NH-44 route guide; see ' +
    'also Vajiram & Ravi, "Longest Highway in India". Both are in the field ' +
    'research reference list.',
};

// Almost nobody lives at either end of the country, so a real K2K is not the
// highway's length. Riders ride to the start line and ride home afterwards.
const REAL_WORLD = {
  low: 6000,
  high: 11000,
  why: 'riders add the run to the start line and the run home',
};

/* ---------- helpers ---------- */

const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));

function die(msg) {
  console.error('\nRefusing to write ' + OUT_FILE + ': ' + msg);
  process.exit(1);
}

const template = readJson(TEMPLATE_FILE);

// Every place template.json names, with the coordinate the itinerary gave it.
const templateCoords = {};
for (const h of template.hops) {
  if (!(h.from in templateCoords)) templateCoords[h.from] = { lat: h.fromLat, lon: h.fromLon };
  if (!(h.to in templateCoords)) templateCoords[h.to] = { lat: h.toLat, lon: h.toLon };
}

// The hop chain as an undirected graph. A K2K runs the loop's west side backwards,
// so direction is not meaningful here; the measured km is.
const graph = {};
template.hops.forEach((h, n) => {
  (graph[h.from] || (graph[h.from] = [])).push({ to: h.to, km: h.km, n });
  (graph[h.to] || (graph[h.to] = [])).push({ to: h.from, km: h.km, n });
});

// Shortest measured road between two template places, as the list of hops it uses.
// Dijkstra over real distances rather than hop counts: the answer has to be the
// route a rider would take through the loop, not merely the fewest legs.
function roadBetween(from, to) {
  if (!graph[from]) die(from + ' is not a place template.json names');
  if (!graph[to]) die(to + ' is not a place template.json names');
  const dist = { [from]: 0 };
  const prev = {};
  const seen = {};
  for (;;) {
    let at = null;
    for (const name of Object.keys(dist)) {
      if (seen[name]) continue;
      if (at === null || dist[name] < dist[at]) at = name;
    }
    if (at === null) die('no measured road in template.json from ' + from + ' to ' + to);
    if (at === to) break;
    seen[at] = true;
    for (const edge of graph[at]) {
      const d = dist[at] + edge.km;
      if (dist[edge.to] === undefined || d < dist[edge.to]) {
        dist[edge.to] = d;
        prev[edge.to] = { from: at, edge };
      }
    }
  }
  const hops = [];
  for (let at = to; at !== from; at = prev[at].from) hops.unshift(prev[at]);
  return hops;
}

/* ---------- the southbound line: measured, from the template's own hops ---------- */

function buildSouth() {
  const names = [SOUTH_ANCHORS[0]];
  const used = new Set();
  let km = 0;

  for (let i = 0; i < SOUTH_ANCHORS.length - 1; i++) {
    const leg = roadBetween(SOUTH_ANCHORS[i], SOUTH_ANCHORS[i + 1]);
    for (const step of leg) {
      // A hop counted twice would be a distance charged twice. It also means the
      // walk doubled back, which on a line that is supposed to run one way down the
      // country is a bug and not a route.
      if (used.has(step.edge.n)) {
        die('hop ' + step.edge.n + ' is used twice by the southbound walk');
      }
      used.add(step.edge.n);
      km += step.edge.km;
      names.push(step.edge.to);
    }
  }

  if (names[names.length - 1] !== SOUTH_ANCHORS[SOUTH_ANCHORS.length - 1]) {
    die('the southbound walk did not arrive at ' + SOUTH_ANCHORS[SOUTH_ANCHORS.length - 1]);
  }
  if (names.length !== used.size + 1) {
    die('the southbound line has ' + names.length + ' points for ' + used.size + ' hops');
  }

  // The spur, measured out of the same hops so the two figures cannot disagree. Every
  // step of it must be a direct template hop AND already inside the walk above: a spur
  // the line does not actually ride would be a subtraction offered against nothing.
  let spurKm = 0;
  for (let i = 0; i < SOUTH_SPUR.length - 1; i++) {
    const edges = (graph[SOUTH_SPUR[i]] || []).filter(e => e.to === SOUTH_SPUR[i + 1]);
    if (!edges.length) die(SOUTH_SPUR[i] + ' to ' + SOUTH_SPUR[i + 1] + ' is not a template hop');
    if (!used.has(edges[0].n)) {
      die('the Kutch spur leg ' + SOUTH_SPUR[i] + ' to ' + SOUTH_SPUR[i + 1] +
        ' is not on the southbound line, so it cannot be disclosed as part of it');
    }
    spurKm += edges[0].km;
  }

  return {
    names,
    hops: used.size,
    // The hops carry one decimal place; the sum of twenty-three of them carries
    // float noise, which would print as 4449.099999999999.
    km: Math.round(km * 10) / 10,
    spurKm: Math.round(spurKm * 10) / 10,
  };
}

/* ---------- the northbound line: geocode only what the template lacks ---------- */

const cache = fs.existsSync(CACHE_FILE) ? readJson(CACHE_FILE) : {};

async function geocode(name) {
  if (cache[name]) return cache[name];
  const query = QUERIES[name];
  if (!query) die(name + ' is on the NH-44 corridor, is not in template.json, and has no query');

  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1' +
    '&countrycodes=in&q=' + encodeURIComponent(query);
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
  if (!res.ok) throw new Error(name + ': HTTP ' + res.status);
  const hits = await res.json();
  if (!hits.length) throw new Error(name + ': Nominatim returned nothing for ' + JSON.stringify(query));

  const hit = { lat: Number(hits[0].lat), lon: Number(hits[0].lon), query, name: hits[0].display_name };
  if (!Number.isFinite(hit.lat) || !Number.isFinite(hit.lon)) {
    throw new Error(name + ': Nominatim returned a coordinate that is not a number');
  }
  cache[name] = hit;
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  return hit;
}

async function buildNorth() {
  const points = [];
  const missing = NORTH_LINE.filter(n => !(n in templateCoords) && !(n in cache));
  if (missing.length) console.log('Geocoding ' + missing.length + ' corridor cities');

  let fetched = 0;
  for (const name of NORTH_LINE) {
    if (templateCoords[name]) {
      points.push({ name, lat: templateCoords[name].lat, lon: templateCoords[name].lon, source: 'template' });
      continue;
    }
    const wasCached = !!cache[name];
    const hit = await geocode(name);
    points.push({ name, lat: hit.lat, lon: hit.lon, source: 'nominatim' });
    if (!wasCached) {
      console.log('  ' + name + ' -> ' + hit.lat.toFixed(4) + ', ' + hit.lon.toFixed(4) +
        '  (' + hit.name + ')');
      fetched++;
      if (fetched < missing.length) await sleep(RATE_LIMIT_MS);
    }
  }
  return points;
}

/* ---------- checks, then write ---------- */

function check(north, south) {
  const all = north.concat(south);
  for (const p of all) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) die(p.name + ' has no finite coordinate');
    if (!p.source) die(p.name + ' has no source');
    // The country, roughly. A geocode that lands outside it drew a line through the
    // sea, and shipping that is worse than shipping nothing.
    if (p.lat < 6 || p.lat > 37 || p.lon < 68 || p.lon > 98) {
      die(p.name + ' geocoded to ' + p.lat + ', ' + p.lon + ', which is not in India');
    }
    const want = EXPECT[p.name];
    if (want && (Math.abs(p.lat - want[0]) > EXPECT_TOL || Math.abs(p.lon - want[1]) > EXPECT_TOL)) {
      die(p.name + ' geocoded to ' + p.lat + ', ' + p.lon + ', expected near ' + want.join(', '));
    }
  }
  if (north[0].name !== 'Kanniyakumari') die('the northbound line does not start at Kanniyakumari');
  if (north[north.length - 1].name !== 'Srinagar') die('the northbound line does not end at Srinagar');
  if (south[0].name !== 'Delhi') die('the southbound line does not start at Delhi');
  if (south[south.length - 1].name !== 'Kanniyakumari') die('the southbound line does not end at Kanniyakumari');
}

async function main() {
  const south = buildSouth();
  const northPoints = await buildNorth();
  const southPoints = south.names.map(name => ({
    name,
    lat: templateCoords[name].lat,
    lon: templateCoords[name].lon,
    source: 'template',
  }));

  check(northPoints, southPoints);

  const out = {
    generated: new Date().toISOString(),
    source: 'NH-44 corridor + template.json west-coast hops',
    north: {
      name: 'Up the spine: NH-44',
      citedKm: NH44.citedKm,
      citedKmAlt: NH44.citedKmAlt,
      states: NH44.states,
      measured: false,
      cite: NH44.cite,
      note: 'Corridor through the cities NH-44 runs by; the distance is the ' +
        'published highway length, not a sum of these points.',
      points: northPoints,
    },
    south: {
      name: 'Down the west coast',
      measuredKm: south.km,
      spurKm: south.spurKm,
      spurName: 'the Kutch spur out to Narayan Sarovar',
      spurFrom: SOUTH_SPUR[0],
      spurTo: SOUTH_SPUR[SOUTH_SPUR.length - 1],
      measured: true,
      hops: south.hops,
      note: 'Summed from this ride’s own measured hops, ' + south.hops +
        ' of them, and drawn through every stop those hops pass. ' + south.spurKm +
        ' km of that total is the Kutch spur out to Narayan Sarovar, which is not on ' +
        'any K2K. Skipping it makes the west-coast run shorter; by how much is not ' +
        'stated, because there is no measured distance here for the direct ' +
        SOUTH_SPUR[0] + ' to ' + SOUTH_SPUR[SOUTH_SPUR.length - 1] + ' road and none ' +
        'is guessed.',
      points: southPoints,
    },
    realWorld: REAL_WORLD,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 1) + '\n');

  console.log('\nWrote ' + OUT_FILE);
  console.log('  north  ' + northPoints.length + ' points, ' +
    northPoints.filter(p => p.source === 'nominatim').length + ' geocoded, ' +
    'cited at ' + NH44.citedKm.toLocaleString('en-IN') + ' km (not measured)');
  console.log('  south  ' + southPoints.length + ' points, ' + south.hops + ' measured hops, ' +
    south.km.toLocaleString('en-IN') + ' km, of which ' +
    south.spurKm.toLocaleString('en-IN') + ' km is the Kutch spur');
  console.log('  a real K2K, start line and run home included: ' +
    REAL_WORLD.low.toLocaleString('en-IN') + ' to ' + REAL_WORLD.high.toLocaleString('en-IN') + ' km');
}

main().catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
