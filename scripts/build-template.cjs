/*
 * build-template.cjs: turns the itinerary sheet into template.json.
 *
 *   node scripts/build-template.cjs "/path/to/Pan India Trip  - Itinerary.csv"
 *
 * This sheet is the PLANNED loop, not the ridden one. route.json is what actually
 * happened; this is the template it was drawn from, and the two differ on purpose,
 * because the Northeast sections closed and the weather windows don't overlap.
 *
 * Sector boundaries are DERIVED, not hardcoded: the loop passes through Bengaluru and
 * Delhi more than once, and those recurrences are exactly where a rider can join or
 * leave. The script cuts at each arrival. The one resulting sector too long to be a
 * single unit (Delhi -> Bengaluru, 51 hops) is subdivided at SUBDIVIDE below.
 *
 * PRIVACY: unlike build-route.cjs this sheet carries no accommodation and no spend.
 * Keep it that way. Cost figures on the site come from route.json's already-published
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

// What the published colophon calls this loop's origin. It used to be the CSV's own
// basename, which is a Google Sheets export name ("Pan India Trip  - Itinerary.csv",
// two spaces and all) and told a reader nothing except that a file existed on someone
// else's disk. The sheet is not published; naming the planning document and the year
// it was drawn is the part a reader can actually use.
const SOURCE_LABEL = 'Pan India Trip prasanth 2025';

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
    const from = String(f[col.Origin]).trim();
    // The sheet ends with a Total row that reuses the Origin column for the sum.
    if (!from || from === 'Total') return;
    rows.push({
      from: from,
      to: String(f[col.Destination]).trim(),
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
    // hops[] keeps the sheet's own spelling (Thiruvananthapuram); sector labels use
    // the name the rest of the site calls it (Trivandrum).
    const from = name(seg[0].from);
    const to = name(seg[seg.length - 1].to);
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
    console.error('usage: node scripts/build-template.cjs "/path/to/Pan India Trip  - Itinerary.csv"');
    process.exit(1);
  }
  if (!fs.existsSync('data/template-notes.json')) {
    console.error('template-notes.json is missing. The route book must not publish');
    console.error('without its season and permit notes. Create it first (see README).');
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(csv, 'utf8'));
  const t = buildTemplate(rows, SOURCE_LABEL);

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

  fs.writeFileSync('data/template.json', JSON.stringify(t, null, 1) + '\n');
  console.log('template.json: ' + t.totals.hops + ' hops, ' + t.totals.km + ' km, ' +
              t.sectors.length + ' sectors, ' + t.totals.waypoints + ' unique waypoints');
}

if (require.main === module) main();

module.exports = { parseCsv, buildTemplate };
