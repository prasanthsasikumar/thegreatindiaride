const { test } = require('node:test');
const assert = require('node:assert');
const { parseCsv, buildTemplate } = require('../build-template.cjs');

// A trimmed stand-in for the real sheet: five hops, one of them arriving at
// Bengaluru, so a crossing has to be detected without the full 97 rows.
const SAMPLE = [
  'Origin,Destination,Distance,Duration,Origin_Latitude,Origin_Longitude,Destination_Latitude,Destination_Longitude,Origin_Address,Destination_Address',
  'Thiruvananthapuram,Kanniyakumari,95.1 km,2 hours 41 mins,8.52,76.93,8.08,77.54,"a","b"',
  'Kanniyakumari,Rameswaram,296 km,5 hours 40 mins,8.08,77.54,9.28,79.31,"b","c"',
  'Rameswaram,Bengaluru,"1,000 km",1 day 2 hours,9.28,79.31,12.97,77.59,"c","d"',
  'Bengaluru,Chitradurga,201 km,3 hours 38 mins,12.97,77.59,14.22,76.39,"d","e"',
  'Total,18039.2 km,18039.2 km,411 hours 13 mins, , , , , ,',
].join('\n');

test('parseCsv drops the Total row and keeps every hop', function () {
  const rows = parseCsv(SAMPLE);
  assert.strictEqual(rows.length, 4);
  assert.strictEqual(rows[0].from, 'Thiruvananthapuram');
  assert.strictEqual(rows[3].to, 'Chitradurga');
});

test('parseCsv reads thousands separators and day-length durations', function () {
  const rows = parseCsv(SAMPLE);
  assert.strictEqual(rows[2].km, 1000);
  // 1 day 2 hours = 26h
  assert.strictEqual(rows[2].hours, 26);
  // 2 hours 41 mins
  assert.ok(Math.abs(rows[0].hours - 2.6833) < 0.001);
});

test('buildTemplate finds the Bengaluru crossing and cuts a sector there', function () {
  const t = buildTemplate(parseCsv(SAMPLE), 'sample.csv');
  const bengaluru = t.crossings.filter(function (c) { return c.name === 'Bengaluru'; })[0];
  assert.ok(bengaluru, 'Bengaluru should be detected as a crossing');
  assert.deepStrictEqual(bengaluru.hops, [2]);
  assert.strictEqual(t.sectors[0].hopFrom, 0);
  assert.strictEqual(t.sectors[0].hopTo, 2);
  assert.strictEqual(t.sectors[0].closesAt, 'Bengaluru');
});

test('sector distances re-sum to the total', function () {
  const t = buildTemplate(parseCsv(SAMPLE), 'sample.csv');
  const summed = t.sectors.reduce(function (a, s) { return a + s.km; }, 0);
  assert.ok(Math.abs(summed - t.totals.km) < 0.5);
});
