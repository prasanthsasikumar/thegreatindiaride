const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

const read = function (f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); };
const readJson = function (f) { return JSON.parse(read(f)); };

const TEMPLATE = readJson('template.json');
const RESEARCH = readJson('research.json');

// k2k.json is generated, so its absence is a real failure rather than a skip: the
// page and the book both read it.
test('k2k.json exists and carries both lines', function () {
  const k = readJson('k2k.json');
  assert.ok(k.north, 'the northbound line');
  assert.ok(k.south, 'the southbound line');
  assert.ok(Array.isArray(k.north.points) && k.north.points.length >= 10);
  assert.ok(Array.isArray(k.south.points) && k.south.points.length >= 10);
});

const K2K = fs.existsSync(path.join(ROOT, 'k2k.json')) ? readJson('k2k.json') : { north: {}, south: {} };
const allPoints = [].concat(K2K.north.points || [], K2K.south.points || []);

test('every point on both lines is a finite coordinate inside India', function () {
  assert.ok(allPoints.length, 'there are points to check');
  allPoints.forEach(function (p) {
    assert.ok(Number.isFinite(p.lat), p.name + ' latitude');
    assert.ok(Number.isFinite(p.lon), p.name + ' longitude');
    // A bad geocode is a line through the sea, so the box is the country, not the globe.
    assert.ok(p.lat > 6 && p.lat < 37, p.name + ' latitude ' + p.lat + ' is outside India');
    assert.ok(p.lon > 68 && p.lon < 98, p.name + ' longitude ' + p.lon + ' is outside India');
  });
});

test('no point is left without a provenance', function () {
  allPoints.forEach(function (p) {
    assert.ok(p.source, p.name + ' has no source');
    assert.ok(p.source === 'template' || p.source === 'nominatim',
      p.name + ' claims an unknown source: ' + p.source);
  });
});

test('every template-sourced point is the coordinate template.json actually holds', function () {
  // Provenance that does not match its source is worse than no provenance. Rebuild
  // the name index from the hops rather than trusting the generator's copy.
  const byName = {};
  TEMPLATE.hops.forEach(function (h) {
    if (!byName[h.from]) byName[h.from] = { lat: h.fromLat, lon: h.fromLon };
    if (!byName[h.to]) byName[h.to] = { lat: h.toLat, lon: h.toLon };
  });
  allPoints.filter(function (p) { return p.source === 'template'; }).forEach(function (p) {
    const t = byName[p.name];
    assert.ok(t, p.name + ' claims to come from template.json, which does not name it');
    assert.strictEqual(p.lat, t.lat, p.name + ' latitude');
    assert.strictEqual(p.lon, t.lon, p.name + ' longitude');
  });
});

test('the six geocoded cities landed where those cities are', function () {
  // Written out rather than derived: this is the assertion that catches Nominatim
  // handing back a Salem in Oregon or an Agra in the Sahara, and it has to be
  // independent of whatever the build script asked for.
  const EXPECT = {
    Madurai: [9.9, 78.1],
    Salem: [11.7, 78.2],
    Nagpur: [21.1, 79.1],
    Jhansi: [25.4, 78.6],
    Agra: [27.2, 78.0],
    Ambala: [30.4, 76.8],
  };
  const geocoded = allPoints.filter(function (p) { return p.source === 'nominatim'; });
  assert.deepStrictEqual(
    geocoded.map(function (p) { return p.name; }).sort(),
    Object.keys(EXPECT).sort(),
    'exactly the six corridor cities template.json lacks were geocoded');
  geocoded.forEach(function (p) {
    const e = EXPECT[p.name];
    assert.ok(Math.abs(p.lat - e[0]) < 0.5, p.name + ' latitude ' + p.lat + ', expected near ' + e[0]);
    assert.ok(Math.abs(p.lon - e[1]) < 0.5, p.name + ' longitude ' + p.lon + ', expected near ' + e[1]);
  });
});

test('the southbound line runs Delhi to Kanniyakumari and the northbound the other way', function () {
  const n = K2K.north.points, s = K2K.south.points;
  assert.strictEqual(n[0].name, 'Kanniyakumari');
  assert.strictEqual(n[n.length - 1].name, 'Srinagar');
  assert.strictEqual(s[0].name, 'Delhi');
  assert.strictEqual(s[s.length - 1].name, 'Kanniyakumari');
});

test('the northbound line never claims a measured distance', function () {
  // The whole honesty problem in one assertion. Ten cities strung together is a
  // corridor sketch; the length of that polyline is a drawing, not a road distance,
  // and the moment a number derived from it appears on this object it will be read
  // as one.
  const n = K2K.north;
  assert.strictEqual(n.measured, false);
  ['measuredKm', 'km', 'distanceKm', 'lengthKm', 'totalKm'].forEach(function (k) {
    assert.strictEqual(n[k], undefined, 'north.' + k + ' must not exist');
  });
  assert.strictEqual(n.citedKm, 3745);
  assert.strictEqual(n.citedKmAlt, 4112);
  assert.strictEqual(n.states, 11);
  assert.ok(n.cite && n.cite.length > 20, 'the cited figure carries its attribution');
  assert.match(n.note, /not a sum of these points/);
});

test('the cited figures are the ones the field research actually gives', function () {
  // If the research is ever re-crawled and the highway length changes, this fails
  // here rather than leaving the map quoting a number nothing on the site supports.
  const text = JSON.stringify(RESEARCH);
  assert.ok(text.indexOf('3,745 km') >= 0, 'research.json gives 3,745 km');
  assert.ok(text.indexOf('4,112 km') >= 0, 'research.json notes the 4,112 km variant');
  assert.ok(text.indexOf('eleven states') >= 0 || text.indexOf('11 states') >= 0);
});

test('the southbound distance is the sum of the template hops it reuses, to the metre', function () {
  // Recomputed here from template.json by hop number, not by re-walking whatever the
  // build script walked: the west side of the loop is hops 5 to 23 (Bengaluru up to
  // Delhi), plus the closing run 94 to 96 and hop 0, which carry Bengaluru down
  // through Coimbatore, Kochi and Trivandrum to Kanniyakumari.
  const wanted = function (n) { return (n >= 5 && n <= 23) || n === 0 || n === 94 || n === 95 || n === 96; };
  const hops = TEMPLATE.hops.filter(function (h) { return wanted(h.n); });
  assert.strictEqual(hops.length, 23);
  const sum = hops.reduce(function (a, h) { return a + h.km; }, 0);

  assert.strictEqual(K2K.south.measured, true);
  assert.ok(Math.abs(K2K.south.measuredKm - sum) < 0.05,
    'measuredKm ' + K2K.south.measuredKm + ' should be ' + sum);
  assert.strictEqual(K2K.south.hops, hops.length);
});

test('the southbound line draws every stop it charges for', function () {
  // 24 points for 23 hops. Fewer would mean the drawn line skips road the distance
  // includes, which is the same lie as the corridor sketch wearing a number.
  assert.strictEqual(K2K.south.points.length, K2K.south.hops + 1);
  const names = K2K.south.points.map(function (p) { return p.name; });
  ['Bhuj', 'Narayan Sarovar', 'Dholavira', 'Palanpur', 'Alibag', 'Daman', 'Bhavnagar']
    .forEach(function (name) {
      assert.ok(names.indexOf(name) >= 0,
        name + ' is inside the summed hops, so it has to be on the drawn line');
    });
  // And consecutive points are real measured hops of the template, in either direction.
  const pairs = {};
  TEMPLATE.hops.forEach(function (h) { pairs[h.from + ' ' + h.to] = h.km; pairs[h.to + ' ' + h.from] = h.km; });
  let walked = 0;
  for (let i = 0; i < names.length - 1; i++) {
    const km = pairs[names[i] + ' ' + names[i + 1]];
    assert.ok(km !== undefined, names[i] + ' to ' + names[i + 1] + ' is not a template hop');
    walked += km;
  }
  assert.ok(Math.abs(walked - K2K.south.measuredKm) < 0.05);
});

test('the Kutch spur inside the measured total is measured and disclosed separately', function () {
  // 884 km of the 4,449.1 is a detour to the Pakistan border that no K2K rider makes,
  // and template.json's own sector name for the stretch is "West coast & Kutch", so
  // the repo already treats it as something other than the west coast. It cannot be
  // dropped from the sum: there is no measured Rajkot-to-Palanpur road here to put in
  // its place, and inventing one is the thing this whole task exists not to do. So it
  // is quantified instead, or a reader sets 4,449 beside NH-44's 3,745 and concludes
  // the west coast is 700 km longer than the highway, when most of that gap is this.
  const SPUR = ['Rajkot', 'Bhuj', 'Narayan Sarovar', 'Dhordo', 'Dholavira', 'Palanpur'];
  const pairs = {};
  TEMPLATE.hops.forEach(function (h) { pairs[h.from + ' ' + h.to] = h.km; pairs[h.to + ' ' + h.from] = h.km; });
  let sum = 0;
  for (let i = 0; i < SPUR.length - 1; i++) {
    const km = pairs[SPUR[i] + ' ' + SPUR[i + 1]];
    assert.ok(km !== undefined, SPUR[i] + ' to ' + SPUR[i + 1] + ' is not a template hop');
    sum += km;
  }
  assert.strictEqual(sum, 884);
  assert.strictEqual(K2K.south.spurKm, sum);
  assert.strictEqual(K2K.south.spurFrom, 'Rajkot');
  assert.strictEqual(K2K.south.spurTo, 'Palanpur');
  assert.ok(K2K.south.spurKm < K2K.south.measuredKm, 'the spur is part of the total, not the total');

  // And the stored note discloses it without offering a shorter total, which would be
  // an estimate of the direct road by another name.
  assert.match(K2K.south.note, /884 km of that total is the Kutch spur/);
  assert.match(K2K.south.note, /none is guessed/);
  assert.doesNotMatch(K2K.south.note, /shorter by/);
});

test('the real-world total is carried with the reason it is bigger than the highway', function () {
  assert.strictEqual(K2K.realWorld.low, 6000);
  assert.strictEqual(K2K.realWorld.high, 11000);
  assert.match(K2K.realWorld.why, /run home/);
});

/* ── the map toggle ─────────────────────────────────────────────────────── */

const PAGE = read('index.html');

function cut(from, to) {
  const a = PAGE.indexOf(from);
  assert.ok(a >= 0, 'could not find ' + JSON.stringify(from) + ' in index.html');
  const b = PAGE.indexOf(to, a);
  assert.ok(b >= 0, 'could not find the end of the block starting at ' + JSON.stringify(from));
  return PAGE.slice(a, b + to.length);
}

const K2K_SRC = cut('function syncK2k() {', '\n  }') + cut('function setK2k(on) {', '\n  }');

function fakeNode() {
  return {
    dataset: {}, attrs: {}, textContent: '', hidden: true, disabled: false, title: '',
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    addEventListener: function () {},
  };
}

function toggleHarness(on) {
  const writes = [];
  const el = { atlas: fakeNode(), k2kToggle: fakeNode(), planToggle: fakeNode() };
  const ctx = {
    el: el,
    k2kOn: !!on,
    K2K_KEY: 'ride:k2k',
    String: String,
    localStorage: { setItem: function (k, v) { writes.push({ key: k, value: v }); } },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(K2K_SRC, ctx);
  return {
    el: el, writes: writes,
    setK2k: function (v) { return vm.runInContext('setK2k', ctx)(v); },
    syncK2k: function () { return vm.runInContext('syncK2k', ctx)(); },
  };
}

test('the K2K overlay remembers itself under its own key', function () {
  // Its own key, so turning K2K on can never rewrite the reader's outline/real-map
  // choice or their planned-route choice.
  const h = toggleHarness(false);
  h.setK2k(true);
  assert.deepStrictEqual(h.writes, [{ key: 'ride:k2k', value: '1' }]);
  h.setK2k(false);
  assert.deepStrictEqual(h.writes[1], { key: 'ride:k2k', value: '0' });
});

test('turning K2K on marks the map, which is what dims the other two lines', function () {
  const h = toggleHarness(false);
  h.setK2k(true);
  assert.strictEqual(h.el.atlas.dataset.k2k, 'on');
  assert.strictEqual(h.el.k2kToggle.attrs['aria-pressed'], 'true');
  assert.strictEqual(h.el.k2kToggle.textContent, 'Hide K2K');
  h.setK2k(false);
  assert.strictEqual(h.el.atlas.dataset.k2k, 'off');
  assert.strictEqual(h.el.k2kToggle.attrs['aria-pressed'], 'false');
});

test('the planned-route toggle is turned off rather than left lying about its line', function () {
  // K2K removes the planned loop outright, so a toggle still reading "Hide planned"
  // and still answering clicks would be offering to hide a line that is not on the
  // map. It goes dead for as long as K2K is up, and says why.
  const h = toggleHarness(false);
  assert.strictEqual(h.el.planToggle.disabled, false);
  h.setK2k(true);
  assert.strictEqual(h.el.planToggle.disabled, true);
  assert.match(h.el.planToggle.title, /K2K already draws this side of the loop/);
  h.setK2k(false);
  assert.strictEqual(h.el.planToggle.disabled, false);
  assert.strictEqual(h.el.planToggle.title, '');
});

test('the stylesheet is what steps the other lines back, and puts them back afterwards', function () {
  // The dimming is CSS keyed off the same attribute the toggle writes, so there is
  // no second copy of the rule in JS that could drift out of step with it.
  assert.match(PAGE, /\.atlas\[data-k2k="on"\] \.route \{[^}]*opacity/);
  assert.match(PAGE, /\.atlas\[data-k2k="on"\] \.route--planned \{[^}]*display: none/);
  // And while the overview is driving the map, K2K stands down the way the planned
  // loop does: data-busy is set by syncPlannedLine, which the player already calls.
  assert.match(PAGE, /\.atlas\[data-busy="yes"\] \.route--k2k \{[^}]*display: none/);
  assert.match(PAGE, /el\.atlas\.dataset\.busy/);
});

test('both pages read k2k.json rather than repeating its figures', function () {
  assert.ok(PAGE.indexOf("'k2k.json'") >= 0, 'index.html fetches k2k.json');
  const book = read('booklet.html');
  assert.ok(book.indexOf("'k2k.json'") >= 0, 'booklet.html fetches k2k.json');
  // Neither page may hard-code the highway length: it is cited, and a citation that
  // exists in two places is a citation that will disagree with itself.
  assert.ok(PAGE.indexOf('3,745') < 0, 'index.html hard-codes the cited distance');
  assert.ok(book.indexOf('3,745') < 0, 'booklet.html hard-codes the cited distance');
});

test('the page says which number is cited and which was measured', function () {
  // The copy is where the distinction is actually made to a reader, so it is run
  // rather than read: the real renderK2k, over the real k2k.json.
  const src = cut('function hasK2k() {', '\n  }') + cut('function renderK2k() {', '\n  }');
  const node = function (tag) {
    return {
      tagName: tag, className: '', textContent: '', hidden: true, children: [],
      appendChild: function (c) { this.children.push(c); },
      replaceChildren: function () { this.children = []; },
    };
  };
  const body = node('div'), section = node('section');
  const ctx = {
    k2k: K2K, Math: Math, String: String, Number: Number,
    document: {
      createElement: node,
      getElementById: function (id) {
        if (id === 'tpl-k2k-body') return body;
        if (id === 'tpl-k2k') return section;
        return null;
      },
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  vm.runInContext('renderK2k()', ctx);

  assert.strictEqual(section.hidden, false, 'the section was shown');
  const text = body.children.map(function (p) { return p.textContent; }).join(' ');
  assert.match(text, /3,745 km across 11 states/);
  assert.match(text, /some quote 4,112 km/);
  assert.match(text, /published length of the highway/);
  assert.match(text, /Nothing on this site measured it/);
  assert.match(text, /corridor sketch/);
  assert.match(text, /a drawing, not a distance/);
  assert.match(text, /6,000–11,000 km/);
  assert.match(text, /4,449 km/);
  assert.match(text, /Roadory/);
  // The spur has to be next to the total it inflates, not merely in the JSON.
  assert.match(text, /884 km of it is the Kutch spur out to Narayan Sarovar/);
  assert.match(text, /no measured Rajkot to Palanpur road/);
  assert.match(text, /not going to guess one/);
  // And the two lines must not be left reading as a circuit.
  assert.match(text, /The two do not meet/);
  assert.match(text, /ends at Srinagar/);
  assert.match(text, /picks up at Delhi/);
  // Neither figure may be given without saying which kind it is.
  assert.ok(text.indexOf('Vajiram') > 0, 'the second source is named too');
});

test('the cache this build writes is ignored, like the other geocode caches', function () {
  assert.match(read('.gitignore'), /^\.k2kcache\.json$/m);
});

// Escaped rather than written out, so this file passes its own rule.
const EM_DASH = '\u2014';

test('nothing this task added uses an em dash: the files it owns outright', function () {
  ['build-k2k.cjs', 'k2k.json', 'test/k2k.test.cjs'].forEach(function (f) {
    assert.ok(read(f).indexOf(EM_DASH) < 0, f + ' contains an em dash');
  });
});

test('nothing this task added uses an em dash: the K2K blocks inside the two pages', function () {
  // The first version of this guard scanned only the three files above, which are
  // exactly the three the violation did not land in: a legend swatch in booklet.html
  // was three em dashes and the test reported safety. So it now reaches into both
  // pages.
  //
  // WHAT IT COVERS: every line of either page that mentions k2k in any case, and the
  // whole body of every function this task added, which is where all of its prose
  // lives.
  //
  // WHAT IT DELIBERATELY DOES NOT COVER: the rest of index.html and booklet.html.
  // Both are full of pre-existing em dashes that a later task sweeps, so a whole-file
  // assertion here would fail today for reasons that are not this task's, and would
  // have to be deleted rather than fixed.
  const pages = { 'index.html': PAGE, 'booklet.html': read('booklet.html') };

  Object.keys(pages).forEach(function (name) {
    pages[name].split('\n').forEach(function (line, i) {
      if (!/k2k/i.test(line)) return;
      assert.ok(line.indexOf(EM_DASH) < 0,
        name + ':' + (i + 1) + ' has an em dash: ' + line.trim());
    });
  });

  const blocks = [
    ['index.html', 'function hasK2k() {'],
    ['index.html', 'function syncK2k() {'],
    ['index.html', 'function setK2k(on) {'],
    ['index.html', 'function renderK2k() {'],
    ['booklet.html', 'function k2kMap(svg) {'],
    ['booklet.html', 'function southLegs() {'],
    ['booklet.html', 'function k2kPage() {'],
    ['booklet.html', 'function hasK2k() {'],
    ['booklet.html', 'function renderK2k() {'],
  ];
  blocks.forEach(function (b) {
    const src = pages[b[0]];
    const a = src.indexOf(b[1]);
    assert.ok(a >= 0, 'could not find ' + b[1] + ' in ' + b[0]);
    const end = src.indexOf('\n  }', a);
    assert.ok(end > a, 'could not find the end of ' + b[1] + ' in ' + b[0]);
    const body = src.slice(a, end);
    assert.ok(body.indexOf(EM_DASH) < 0, b[0] + ' ' + b[1] + ' contains an em dash');
    assert.ok(body.length > 60, b[0] + ' ' + b[1] + ' matched an empty block');
  });
});
