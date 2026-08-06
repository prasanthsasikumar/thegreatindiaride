/*
 * tag-media.cjs: joins an Instagram data export against media/ and writes tags.json.
 *
 *   node scripts/tag-media.cjs <path-to-instagram-export>
 *
 * The export is transient (Instagram expires the download after 4 days) and holds a
 * lot of unrelated personal data, so it stays outside the repo. This script reads the
 * two files that matter, keeps only what the media library needs, and writes a
 * committed sidecar that generate-manifest.cjs merges in.
 *
 * WHAT THE EXPORT ACTUALLY GIVES YOU, and why the output needs hand-correcting:
 *
 *   - 204/222 files are source_type "library", i.e. uploaded from the camera roll.
 *     For those, `creation_timestamp` is the UPLOAD time, not the capture time.
 *     Measured against the 59 files that also carry EXIF date_time_original, the
 *     median capture->upload gap is 5.2h, p90 is 33h, and the max is 125h. On a road
 *     trip that is easily one or more states of drift, so creation_timestamp must
 *     never be treated as "where I was".
 *   - EXIF lat/long is better but still not authoritative: phones cache a last-known
 *     fix, so some files geocode 150-200km from where they were actually shot.
 *
 * So this script produces a best guess plus a ranked shortlist of alternatives, and
 * overrides.json (written by the browser UI) always wins. Precedence:
 *
 *     overrides.json  >  EXIF GPS  >  nearest-in-time neighbour
 *
 * Deliberately NOT written to tags.json: raw lat/long. netlify.toml publishes ".", so
 * anything here is world-readable, and 8-decimal coordinates are a precise movement
 * log. State names and the candidate shortlist are coarse enough to publish; the
 * coordinates stay in .geocache.json, which is gitignored.
 */

const fs = require('fs');
const path = require('path');

const EXPORT_DIR = process.argv[2];
const CACHE_FILE = '.geocache.json';
const OVERRIDES_FILE = 'data/overrides.json';
const OUT_FILE = 'data/tags.json';

// Nominatim asks for a descriptive UA and max 1 req/sec. We respect both.
const USER_AGENT = 'thegreatindiaride-tagger/1.0 (+https://thegreatindiaride.prasanthsasikumar.com)';
const RATE_LIMIT_MS = 1100;
const GEO_PRECISION = 2; // ~1.1 km, finer than any state boundary question we care about
const CANDIDATES = 6;    // length of the shortlist offered in the UI dropdown

// EXIF date_time_original carries no timezone; the whole ride was in IST (+5:30).
const LOCAL_UTC_OFFSET_MIN = 330;

if (!EXPORT_DIR) {
  console.error('Usage: node scripts/tag-media.cjs <path-to-instagram-export>');
  process.exit(1);
}

/* ---------- helpers ---------- */

// Instagram writes UTF-8 bytes re-encoded as latin-1, so "🙏" arrives as "ð".
function demojibake(s) {
  if (typeof s !== 'string' || s === '') return '';
  try {
    return Buffer.from(s, 'latin1').toString('utf8');
  } catch (e) {
    return s;
  }
}

const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const keyOf = (lat, lon) => `${lat.toFixed(GEO_PRECISION)},${lon.toFixed(GEO_PRECISION)}`;

function exifRows(item) {
  const md = item.media_metadata || {};
  const vm = md.video_metadata || md.photo_metadata || {};
  return vm.exif_data || [];
}

function coordsOf(item) {
  for (const e of exifRows(item)) {
    if (typeof e.latitude === 'number' && typeof e.longitude === 'number') {
      // Instagram emits (0,0) when it has no fix; that's the Gulf of Guinea, not a stop.
      if (Math.abs(e.latitude) < 0.001 && Math.abs(e.longitude) < 0.001) return null;
      return { lat: e.latitude, lon: e.longitude };
    }
  }
  return null;
}

// The real capture time, when the original file's EXIF survived the upload.
function capturedAtOf(item) {
  for (const e of exifRows(item)) {
    const raw = e.date_time_original || e.date_time_digitized;
    if (!raw) continue;
    const m = String(raw).match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
    if (!m) continue;
    const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    return { at: Math.floor((local - LOCAL_UTC_OFFSET_MIN * 60000) / 1000), source: 'exif' };
  }
  if (item.creation_timestamp) return { at: item.creation_timestamp, source: 'upload' };
  return null;
}

function subtitlesOf(item) {
  const vm = (item.media_metadata || {}).video_metadata || {};
  return (vm.subtitles || {}).uri || null;
}

// Outside India the sub-national names Nominatim returns ("Lumbini Province",
// "Trongsa District") are finer than this library needs and read as noise next to
// Indian states, and the country is the useful label there.
function regionName(hit) {
  if (!hit) return null;
  if (hit.country && hit.country !== 'India') return hit.country;
  return hit.state || null;
}

function haversineKm(a, b) {
  const R = 6371;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/* ---------- 1. collect items from the export ---------- */

const mediaDir = path.join(EXPORT_DIR, 'your_instagram_activity', 'media');
const storiesFile = path.join(mediaDir, 'stories.json');
const reelsFile = path.join(mediaDir, 'reels.json');

for (const f of [storiesFile, reelsFile]) {
  if (!fs.existsSync(f)) {
    console.error(`Missing ${f}\nIs that really an Instagram export directory?`);
    process.exit(1);
  }
}

const stories = (readJson(storiesFile).ig_stories || []).map(i => ({ ...i, category: 'stories' }));
const reels = (readJson(reelsFile).ig_reels_media || [])
  .flatMap(g => g.media || [])
  .map(i => ({ ...i, category: 'reels' }));

// Date corrections, read early so they steer ordering and interpolation rather than
// being pasted on afterwards. An entry may be a bare region string (the common case)
// or an object carrying `state`, `date`, or both.
const overridesEarly = fs.existsSync(OVERRIDES_FILE) ? readJson(OVERRIDES_FILE) : {};
const dateFix = uri => {
  const f = overridesEarly[uri];
  if (!f || typeof f === 'string') return null;
  const d = f.date || f.captured;
  if (!d) return null;
  const ms = Date.parse(d.length <= 10 ? d + 'T12:00:00Z' : d);
  return isFinite(ms) ? Math.floor(ms / 1000) : null;
};

const items = [...stories, ...reels]
  .filter(i => i.uri)
  .map(i => {
    const fixed = dateFix(i.uri);
    const t = fixed ? { at: fixed, source: 'manual' } : capturedAtOf(i);
    return {
      uri: i.uri,
      category: i.category,
      captured: t ? t.at : null,
      timeSource: t ? t.source : null,
      coords: coordsOf(i),
      caption: demojibake(i.title || '').trim(),
      subtitles: subtitlesOf(i),
    };
  })
  .sort((a, b) => (a.captured || 0) - (b.captured || 0));

const present = items.filter(i => fs.existsSync(i.uri));
const exifTimes = present.filter(i => i.timeSource === 'exif').length;

console.log(`Export: ${stories.length} stories + ${reels.length} reels = ${items.length} items`);
console.log(`Matched against media/: ${present.length}`);
const manualTimes = present.filter(i => i.timeSource === 'manual').length;
console.log(`Capture times: ${exifTimes} from EXIF, ${manualTimes} corrected by hand, ${present.length - exifTimes - manualTimes} fall back to upload time`);

/* ---------- 2. reverse-geocode the unique points ---------- */

const cache = fs.existsSync(CACHE_FILE) ? readJson(CACHE_FILE) : {};
const needed = [...new Set(present.filter(i => i.coords).map(i => keyOf(i.coords.lat, i.coords.lon)))];
const uncached = needed.filter(k => !(k in cache));

console.log(`Geotagged: ${present.filter(i => i.coords).length} files · ${needed.length} unique points · ${uncached.length} to fetch`);

async function geocodeAll() {
  for (let n = 0; n < uncached.length; n++) {
    const key = uncached[n];
    const [lat, lon] = key.split(',');
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=8&addressdetails=1`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const a = (await res.json()).address || {};
      cache[key] = {
        state: a.state || a.region || a.state_district || a.county || null,
        country: a.country || null,
      };
      process.stdout.write(`\r  geocoded ${n + 1}/${uncached.length}          `);
    } catch (err) {
      console.warn(`\n  ! ${key} failed (${err.message}). Left untagged, re-run to retry`);
      // Do not cache failures: a cached null would never be retried.
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
    if (n < uncached.length - 1) await sleep(RATE_LIMIT_MS);
  }
  if (uncached.length) process.stdout.write('\n');
}

/* ---------- 3. resolve, rank candidates, apply overrides ---------- */

function build() {
  const overrides = fs.existsSync(OVERRIDES_FILE) ? readJson(OVERRIDES_FILE) : {};

  // (a) GPS-measured.
  for (const item of present) {
    if (!item.coords) continue;
    const hit = cache[keyOf(item.coords.lat, item.coords.lon)];
    const name = regionName(hit);
    if (name) {
      item.state = name;
      item.country = hit.country;
      item.source = 'gps';
    }
  }

  // (b) Region centroids, derived from the measured points themselves. This is what
  //     lets the UI offer a geographically sensible shortlist without shipping coords.
  const acc = {};
  for (const item of present) {
    if (item.source !== 'gps' || !item.coords) continue;
    const a = acc[item.state] || (acc[item.state] = { lat: 0, lon: 0, n: 0, country: item.country });
    a.lat += item.coords.lat; a.lon += item.coords.lon; a.n++;
  }
  const centroids = Object.entries(acc).map(([state, a]) => ({
    state, country: a.country, lat: a.lat / a.n, lon: a.lon / a.n,
  }));

  // (c) Fill the gaps from the surrounding anchors.
  //
  // A file sandwiched between two GPS fixes in the SAME region is safe regardless of
  // how badly its own timestamp drifted: you cannot leave and re-enter a state
  // between two fixes without a fix in between. That's "route" confidence. Only when
  // the brackets disagree is it a real guess, and those stay flagged as "time".
  const anchors = present
    .filter(i => i.state && i.captured)
    .sort((a, b) => a.captured - b.captured);

  for (const item of present) {
    if (item.state || !item.captured) continue;

    let prev = null, next = null;
    for (const cand of anchors) {
      if (cand.captured <= item.captured) prev = cand;
      else { next = cand; break; }
    }

    const bracketed = prev && next && prev.state === next.state;
    const best = bracketed ? prev
      : !prev ? next
      : !next ? prev
      : (item.captured - prev.captured <= next.captured - item.captured ? prev : next);
    if (!best) continue;

    item.state = best.state;
    item.country = best.country;
    item.source = bracketed ? 'route' : 'time';
    item.gapHours = Math.round((Math.abs(best.captured - item.captured) / 3600) * 10) / 10;

    // When the brackets disagree the file sits on a leg between two regions, so offer
    // both ends first in the dropdown rather than a distance ranking from nowhere.
    if (!bracketed && prev && next) item.between = [prev.state, next.state];
  }

  // (d) Candidate shortlist for the UI dropdown.
  for (const item of present) {
    let ranked;
    if (item.coords && centroids.length) {
      ranked = centroids
        .map(c => ({ state: c.state, d: haversineKm(item.coords, c) }))
        .sort((a, b) => a.d - b.d)
        .map(c => c.state);
    } else {
      // No fix of its own, so offer whatever the temporally closest files resolved to.
      ranked = present
        .filter(o => o.state && o.captured && o !== item)
        .sort((a, b) => Math.abs(a.captured - item.captured) - Math.abs(b.captured - item.captured))
        .map(o => o.state);
    }
    const seen = new Set();
    item.nearby = [item.state, ...(item.between || []), ...ranked]
      .filter(s => s && !seen.has(s) && seen.add(s))
      .slice(0, CANDIDATES);
  }

  // (e) Manual corrections win over everything above.
  let overridden = 0;
  for (const item of present) {
    const fix = overrides[item.uri];
    if (!fix) continue;
    const state = typeof fix === 'string' ? fix : fix.state;
    if (!state) continue;
    item.state = state;
    item.country = (typeof fix === 'object' && fix.country) ||
      (centroids.find(c => c.state === state) || {}).country || item.country || null;
    item.source = 'manual';
    delete item.gapHours;
    if (!item.nearby.includes(state)) item.nearby = [state, ...item.nearby].slice(0, CANDIDATES);
    overridden++;
  }

  /* ---------- 4. write ---------- */

  const files = {};
  for (const item of present) {
    const entry = {};
    if (item.captured) {
      entry.captured = new Date(item.captured * 1000).toISOString();
      entry.timeSource = item.timeSource; // "exif" = real capture, "upload" = posted-at
    }
    if (item.state) {
      entry.state = item.state;
      entry.country = item.country || null;
      entry.stateSource = item.source; // gps | time | manual
      if (item.source === 'time') entry.stateGapHours = item.gapHours;
    }
    if (item.nearby && item.nearby.length > 1) entry.nearby = item.nearby;
    if (item.caption) entry.caption = item.caption;
    if (item.subtitles && fs.existsSync(item.subtitles)) entry.subtitles = item.subtitles;
    files[item.uri] = entry;
  }

  const count = s => present.filter(i => i.source === s).length;
  const stats = {
    total: present.length,
    gps: count('gps'),
    route: count('route'),
    time: count('time'),
    manual: count('manual'),
    untagged: present.filter(i => !i.state).length,
    capturedFromExif: exifTimes,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify({
    generated: new Date().toISOString(),
    source: path.basename(EXPORT_DIR),
    stats,
    files,
  }, null, 2));

  console.log(`\nWrote ${OUT_FILE}`);
  console.log(`  from GPS      ${stats.gps}`);
  console.log(`  bracketed     ${stats.route}   (between two fixes in the same region)`);
  console.log(`  from timing   ${stats.time}   (low confidence, brackets disagree)`);
  console.log(`  hand-corrected ${stats.manual}`);
  console.log(`  untagged      ${stats.untagged}`);
  if (!overridden) {
    console.log(`\nNo ${OVERRIDES_FILE} yet. Fix regions in the browser UI, click`);
    console.log(`"Save corrections", drop the file here and re-run to bake them in.`);
  }
}

geocodeAll().then(build).catch(err => {
  console.error('\nFailed:', err.message);
  process.exit(1);
});
