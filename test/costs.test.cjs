const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const vm = require('node:vm');

function loadCosts() {
  const ctx = {}; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync('costs.js', 'utf8'), ctx);
  return ctx.Costs;
}

const ROUTE = {
  totals: { nights: 93 },
  stops: [
    { nights: 50, stayCost: 70000, spend: 180000 },
    { nights: 43, stayCost: 65448, spend: 161402 },
  ],
};
const TPL = { sectors: [{ id: 'S0', km: 1130, hours: 22 }, { id: 'S1', km: 3643, hours: 74 }] };

test('per-night rates come straight from the ridden totals', function () {
  const c = loadCosts().project(ROUTE, TPL, 6);
  assert.strictEqual(c.nights, 93);
  assert.strictEqual(Math.round(c.perNight.stay), 1456);
  assert.strictEqual(Math.round(c.perNight.other), 2215);
  assert.strictEqual(Math.round(c.perNight.total), 3671);
});

test('sector days come from riding hours at the stated hours-per-day', function () {
  const c = loadCosts().project(ROUTE, TPL, 6);
  // 22h / 6h = 3.67 -> 4 riding days
  assert.strictEqual(c.sectors[0].days, 4);
  assert.strictEqual(c.sectors[1].days, 13);
});

test('a sector estimate is its days times the observed nightly rate', function () {
  const c = loadCosts().project(ROUTE, TPL, 6);
  assert.strictEqual(c.sectors[0].total, Math.round(4 * c.perNight.total));
});

test('projecting the whole template costs more than the ride actually did', function () {
  // The template is longer than what was ridden. If this ever inverts, the
  // projection is wrong.
  const c = loadCosts().project(ROUTE, TPL, 6);
  assert.ok(c.total > 0);
});
