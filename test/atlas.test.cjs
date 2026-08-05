const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ATLAS = path.join(__dirname, '..', 'atlas.js');

// atlas.js is a browser script, not a module. Load it into a sandbox with just enough
// of a DOM stub to reach the pure helpers it exposes for testing.
function loadAtlas(doc) {
  const ctx = { window: {}, document: doc || { createElementNS: function () { return {}; } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ATLAS, 'utf8'), ctx);
  return ctx.Atlas;
}

// Enough of an SVG element for create()/drawBase()/focus(): attributes go in a bag,
// and viewBox.baseVal is kept in step with the attribute the way a browser does.
function stubSvg() {
  return {
    attrs: {},
    viewBox: { baseVal: { x: 0, y: 0, width: 0, height: 0 } },
    setAttribute: function (n, v) {
      this.attrs[n] = String(v);
      if (n !== 'viewBox') return;
      const p = String(v).trim().split(/[\s,]+/).map(Number);
      this.viewBox.baseVal = { x: p[0], y: p[1], width: p[2], height: p[3] };
    },
    getAttribute: function (n) { return this.attrs[n]; },
    replaceChildren: function () {},
    appendChild: function () {},
    insertBefore: function () {},
    addEventListener: function () {},
  };
}

function stubNode() {
  return {
    dataset: {}, style: {},
    setAttribute: function () {}, appendChild: function () {},
  };
}

function makeAtlas() {
  const A = loadAtlas({ createElementNS: function () { return stubNode(); } });
  const basemap = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'basemap.json'), 'utf8'));
  const svg = stubSvg();
  const api = A.create(svg, basemap, { width: 420, height: 470, pad: 10 });
  api.drawBase();
  return { api: api, svg: svg };
}

function vb(svg) { return svg.getAttribute('viewBox').split(' ').map(Number); }

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

// focus() is what the overview drives the map with. These run it against the real
// basemap and real stops, unanimated — the eased path is the same numbers over time.
test('focus(null) shows the whole map', function () {
  const m = makeAtlas();
  m.api.focus({ minLat: 8, maxLat: 10, minLon: 76, maxLon: 77 }, false);
  assert.notStrictEqual(m.svg.getAttribute('viewBox'), '0 0 420 470');
  m.api.focus(null, false);
  assert.strictEqual(m.svg.getAttribute('viewBox'), '0 0 420 470');
});

// Kerala is small enough that both minimums bite; Andhra Pradesh is wide enough that
// only the height does, which is where the frame's shape has to be put back by hand.
['Kerala', 'Andhra Pradesh'].forEach(function (region) {
  test('focus frames ' + region + ', and keeps the map\'s own shape', function () {
    const m = makeAtlas();
    const stops = require('../manifest.json').route.stops.filter(function (s) {
      return s.region === region;
    });
    const lats = stops.map(function (s) { return s.lat; });
    const lons = stops.map(function (s) { return s.lon; });
    const bounds = {
      minLat: Math.min.apply(null, lats), maxLat: Math.max.apply(null, lats),
      minLon: Math.min.apply(null, lons), maxLon: Math.max.apply(null, lons),
    };
    m.api.focus(bounds, false);
    const box = vb(m.svg);

    // Every stop in the region has to be inside the frame, or the overview would name
    // a region and show somewhere else.
    stops.forEach(function (s) {
      const p = m.api.project(s.lon, s.lat);
      assert.ok(p[0] >= box[0] && p[0] <= box[0] + box[2], s.name + ' is off the x edge');
      assert.ok(p[1] >= box[1] && p[1] <= box[1] + box[3], s.name + ' is off the y edge');
    });

    // The <svg> carries no width/height attributes, so the viewBox IS its intrinsic
    // ratio: a differently-shaped frame resizes the element and the pane jumps.
    assert.ok(Math.abs(box[2] / box[3] - 420 / 470) < 1e-6,
      'viewBox ' + box.join(' ') + ' is not the map\'s aspect ratio');

    // ...and it stays centred on the region it was asked for.
    const a = m.api.project(bounds.minLon, bounds.maxLat);
    const b = m.api.project(bounds.maxLon, bounds.minLat);
    assert.ok(Math.abs(box[0] + box[2] / 2 - (a[0] + b[0]) / 2) < 0.05, 'off centre in x');
    assert.ok(Math.abs(box[1] + box[3] / 2 - (a[1] + b[1]) / 2) < 0.05, 'off centre in y');
  });
});

test('a frame far from the map\'s shape is grown, never cropped', function () {
  const m = makeAtlas();
  // Deliberately extreme: a band right across the north, then a strip down the middle.
  [{ minLat: 25, maxLat: 28, minLon: 70, maxLon: 95 },
   { minLat: 10, maxLat: 32, minLon: 77, maxLon: 78 }].forEach(function (bounds) {
    m.api.focus(bounds, false);
    const box = vb(m.svg);
    const a = m.api.project(bounds.minLon, bounds.maxLat);
    const b = m.api.project(bounds.maxLon, bounds.minLat);
    assert.ok(Math.abs(box[2] / box[3] - 420 / 470) < 1e-6,
      'viewBox ' + box.join(' ') + ' is not the map\'s aspect ratio');
    assert.ok(box[0] <= Math.min(a[0], b[0]) && box[0] + box[2] >= Math.max(a[0], b[0]),
      'the box was cropped in x');
    assert.ok(box[1] <= Math.min(a[1], b[1]) && box[1] + box[3] >= Math.max(a[1], b[1]),
      'the box was cropped in y');
  });
});

test('focus never zooms past 3x, however small the region', function () {
  const m = makeAtlas();
  // A single stop: Trivandrum, the origin, where minLat === maxLat.
  m.api.focus({ minLat: 8.48823, maxLat: 8.48823, minLon: 76.94755, maxLon: 76.94755 }, false);
  const box = vb(m.svg);
  assert.ok(Math.abs(box[2] - 420 / 3) < 1e-6, 'width should bottom out at W/3');
  assert.ok(Math.abs(box[3] - 470 / 3) < 1e-6, 'height should bottom out at H/3');
});

test('a cluster opened by an unmatched stop inherits the first real index', function () {
  const A = loadAtlas();
  // idx -1 is a stop the caller could not match to a block. The marker still has to
  // point somewhere, so the next member of the cluster supplies the index.
  const clusters = A._cluster([{ x: 10, y: 10, idx: -1 }, { x: 11, y: 10, idx: 40 }], 3.5);
  assert.strictEqual(clusters.length, 1);
  assert.strictEqual(clusters[0].idx, 40);
});
