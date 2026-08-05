const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ATLAS = path.join(__dirname, '..', 'atlas.js');

// atlas.js is a browser script, not a module. Load it into a sandbox with just enough
// of a DOM stub to reach the pure helpers it exposes for testing.
function loadAtlas() {
  const ctx = { window: {}, document: { createElementNS: function () { return {}; } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(ATLAS, 'utf8'), ctx);
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
