const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const PAGE = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const TEMPLATE = JSON.parse(fs.readFileSync(path.join(ROOT, 'template.json'), 'utf8'));

// index.html is one page-sized IIFE behind a fetch, so there is nothing to require.
// Same cut-and-run approach the K2K tests use: lift a named function out by its
// signature and its closing brace, and run the real source rather than a paraphrase.
function cut(from, to) {
  const a = PAGE.indexOf(from);
  assert.ok(a >= 0, 'could not find ' + JSON.stringify(from) + ' in index.html');
  const b = PAGE.indexOf(to, a);
  assert.ok(b >= 0, 'could not find the end of the block starting at ' + JSON.stringify(from));
  return PAGE.slice(a, b + to.length);
}

/*
 * The template section used to print the whole route book into the front page: a
 * five-figure glance band, five expandable sectors with a waypoint table each, and a
 * projected cost table. It was the longest thing on a page that exists to be
 * scrolled, and every word of it is in booklet.html in fuller form. It is one call
 * to action now.
 *
 * These tests guard the two things that got quieter in the process, and which
 * nothing else on the page would notice the loss of.
 */

test('the front page offers the route book rather than reprinting it', function () {
  // The door, in the section where the reprint used to be.
  assert.match(PAGE, /<a class="tpl__cta" href="booklet\.html">/);

  // And nothing left that draws the book itself. Each of these is a renderer or a
  // class that existed only to print a part of the book onto this page; if one comes
  // back, so has the length that the section was removed for.
  ['renderTemplate', 'renderCosts', 'sectorBlock', 'tpl__glance', 'tpl__sector',
    'tpl__costs', 'tpl__hops'].forEach(function (dead) {
    assert.ok(PAGE.indexOf(dead) < 0, 'index.html still carries ' + dead);
  });

  // Costs.project is booklet.html's now. The module is untouched, but this page has
  // no caller for it and must not pay to load it.
  assert.ok(PAGE.indexOf('src="costs.js"') < 0, 'index.html still loads costs.js');
});

test('the hero offers the route book alongside the overview', function () {
  // A second destination of equal weight, in the same pill as the first rather than
  // a shape invented for it, and ahead of the quiet escape hatch to the clips.
  const acts = cut('<div class="hero__acts">', '</div>');
  const overview = acts.indexOf('id="overview-cta"');
  const book = acts.indexOf('href="booklet.html"');
  const clips = acts.indexOf('href="#region-0"');
  assert.ok(overview >= 0 && book >= 0 && clips >= 0, 'the hero lost one of its three actions');
  assert.ok(overview < book && book < clips,
    'the route book belongs between the primary CTA and the quiet link');
  assert.match(acts, /class="hero__cta hero__cta--ghost"/);
});

test('the route book figures are read from template.json, never typed into the page', function () {
  // A number written into the markup is a number that will disagree with the book it
  // advertises the first time the sheet is rebuilt.
  assert.ok(PAGE.indexOf('18,181') < 0, 'index.html hard-codes the loop distance');

  const src = cut('function renderRouteBook() {', '\n  }');
  const figs = { textContent: '', hidden: true };
  const ctx = {
    template: TEMPLATE, el: { tplFigs: figs }, Math: Math, String: String,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  vm.runInContext('renderRouteBook()', ctx);

  assert.strictEqual(figs.hidden, false, 'the figures were shown');
  assert.strictEqual(figs.textContent,
    '18,181 km · 97 legs · 5 sectors · 2 join points');
});

test('the page still boots when template.json is missing', function () {
  // Graceful degradation that was built earlier and has to survive the cut: with no
  // template.json there is no planned loop and no figures, and the route book link is
  // static markup, so the door still opens. The renderer must return rather than
  // reach into a null.
  const src = cut('function renderRouteBook() {', '\n  }');
  const figs = { textContent: '', hidden: true };
  const ctx = { template: null, el: { tplFigs: figs }, Math: Math, String: String };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  vm.runInContext('renderRouteBook()', ctx);
  assert.strictEqual(figs.hidden, true, 'the figures line stays hidden');
  assert.strictEqual(figs.textContent, '');
});

/* ── the planned overlay, driven rather than grepped ──────────────────────
 *
 * This used to be one line: assert.match(PAGE, /if \(template && template\.hops
 * \.length\) \{/), a search for a line of source. Replace the drawRoute call in
 * renderMap with `plannedLine = null;`, so the planned loop is never drawn on the
 * front page at all, and every one of the 86 tests still passed: the source text
 * being grepped for was still there, and test/overview.test.cjs drives the real
 * setPlanned/syncPlannedLine but against a hand-made { style: { display } }, which
 * covers persistence and visibility and can never notice that no line exists.
 *
 * booklet.html's sector maps assert real route--planned polylines. What follows does
 * the equivalent for index.html: run the page's own renderMap over the real atlas.js
 * and the real basemap, and look at what actually landed in the SVG.
 */
const ATLAS_SRC = fs.readFileSync(path.join(ROOT, 'atlas.js'), 'utf8');
const BASEMAP = JSON.parse(fs.readFileSync(path.join(ROOT, 'basemap.json'), 'utf8'));

function svgNode(tag) {
  return {
    tagName: tag, attrs: {}, dataset: {}, style: {}, children: [], textContent: '',
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return this.attrs[k]; },
    appendChild: function (c) { this.children.push(c); return c; },
    insertBefore: function (c) { this.children.unshift(c); return c; },
    replaceChildren: function () { this.children = []; },
    addEventListener: function () {},
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 0, height: 0 }; },
    viewBox: { baseVal: { x: 0, y: 0, width: 0, height: 0 } },
  };
}

// Runs the real renderMap. Everything geographic (Atlas, basemap.json,
// template.json) is real; only the page furniture around it is stood in for, since
// the question here is what gets drawn, not what the card says.
function renderFrontPageMap(o) {
  o = o || {};
  const svg = svgNode('svg');
  const ctx = {
    console: console, Math: Math, String: String, Number: Number,
    Array: Array, Object: Object, Infinity: Infinity,
    document: { createElementNS: function (ns, t) { return svgNode(t); } },
    window: {},

    basemap: BASEMAP,
    template: 'template' in o ? o.template : TEMPLATE,
    k2k: null,                                   // hasK2k() is false, so no K2K lines
    manifest: { route: { stops: [
      { lat: 8.5, lon: 76.9, origin: true }, { lat: 15.3, lon: 74.0 },
      { lat: 19.1, lon: 72.9 }, { lat: 28.6, lon: 77.2 },
    ] } },
    el: { atlas: svg, k2kToggle: svgNode('button') },
    mapMode: 'outline',                          // so setTiles is not reached

    planned: o.planned !== false,
    plannedSuppressed: !!o.plannedSuppressed,

    // Page furniture the map calls out to. Their own behaviour is covered elsewhere.
    matchStopsToRegions: function (stops) {
      return stops.map(function (s, i) { return { stop: s, idx: i }; });
    },
    clusterLabel: function () { return ''; },
    showStop: function () {}, hideStop: function () {}, syncMap: function () {},
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(ATLAS_SRC, ctx);
  vm.runInContext('var atlas = null, plannedLine = null, mapPlaced = [], ' +
                  'mapClusters = [], mapStops = [];', ctx);
  vm.runInContext(cut('function hasK2k() {', '\n  }'), ctx);
  vm.runInContext(cut('function syncPlannedLine() {', '\n  }'), ctx);
  vm.runInContext(cut('function renderMap() {', '\n  }'), ctx);
  vm.runInContext('renderMap()', ctx);

  const lines = svg.children.filter(function (n) { return n.tagName === 'polyline'; });
  return {
    svg: svg,
    lines: lines,
    planned: lines.filter(function (l) { return l.attrs['class'] === 'route--planned'; })[0],
    plannedLine: vm.runInContext('plannedLine', ctx),
  };
}

test('the map really draws the planned loop, under the ridden line', function () {
  const r = renderFrontPageMap();

  assert.ok(r.planned,
    'no route--planned polyline reached the SVG, so the front page draws no planned loop');

  // Draw order is paint order in SVG, the same reason booklet.html's sector maps
  // assert theirs: the planned loop is the dimmed context and belongs underneath.
  const classes = r.lines.map(function (l) { return l.attrs['class']; });
  assert.ok(classes.indexOf('route--planned') < classes.indexOf('route'),
    'the planned loop is drawn after the ridden one, so it paints over it: ' + classes);

  // It is the whole loop and not a stub of it: the origin of the first hop, then
  // every destination in order.
  const pts = r.planned.attrs.points.split(' ');
  assert.strictEqual(pts.length, TEMPLATE.hops.length + 1);
  pts.forEach(function (p) {
    assert.match(p, /^-?\d+\.\d,-?\d+\.\d$/, 'a projected point, not a NaN: ' + p);
  });

  // And renderMap kept a handle on it, which is the only thing the toggle can reach.
  assert.strictEqual(r.plannedLine, r.planned, 'plannedLine is not the line that was drawn');
});

test('the planned loop is drawn hidden when the reader has it switched off', function () {
  // renderMap calls syncPlannedLine straight after drawing, so a reader who left the
  // toggle off does not get a flash of the second line on every page load.
  assert.strictEqual(renderFrontPageMap({ planned: true }).planned.style.display, '');
  assert.strictEqual(renderFrontPageMap({ planned: false }).planned.style.display, 'none');
  assert.strictEqual(
    renderFrontPageMap({ planned: true, plannedSuppressed: true }).planned.style.display, 'none',
    'a borrowed map wins over the preference');
});

test('with no template.json the map draws the ridden line and nothing else', function () {
  // The other half of the graceful degradation above, at the map's own call site.
  const r = renderFrontPageMap({ template: null });
  assert.strictEqual(r.planned, undefined, 'no planned loop to draw');
  assert.strictEqual(r.plannedLine, null, 'and no handle for the toggle to reach');
  assert.deepStrictEqual(r.lines.map(function (l) { return l.attrs['class']; }), ['route'],
    'the ridden line still drew');
});

test('the planned-route toggle is still explained somewhere a reader will look', function () {
  // The sentence that explained it lived in the section that was removed. It sits
  // under the map now, beside the button it describes.
  const note = cut('<p class="map__note">', '</p>');
  assert.match(note, /<strong>Planned route<\/strong>/);
  assert.match(note, /dashed/);
  assert.match(note, /actually ridden/);
});

test('the K2K overlay outlived the essay that used to explain it', function () {
  // #tpl-k2k was five paragraphs about the two lines on the map, and it is gone: the
  // map draws them, the toggle names them, and the route book carries the argument
  // at length. What must NOT have gone with the prose is the overlay itself, which is
  // the part a reader uses. So: no section, no renderer, and still two lines and a
  // button.
  assert.ok(PAGE.indexOf('tpl-k2k') < 0, 'the K2K prose section is still in the markup');
  assert.ok(PAGE.indexOf('function renderK2k(') < 0, 'its renderer is still here');

  assert.match(PAGE, /id="k2k-toggle"/, 'the map lost its K2K toggle');
  assert.match(PAGE, /drawRoute\(k2k\.north\.points/, 'the map lost the northbound line');
  assert.match(PAGE, /drawRoute\(k2k\.south\.points/, 'the map lost the southbound line');
  assert.ok(PAGE.indexOf("'k2k.json'") > 0, 'the page no longer fetches k2k.json');
});
