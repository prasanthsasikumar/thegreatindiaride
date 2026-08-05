const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// index.html is one page-sized IIFE behind a fetch, so there is nothing to require.
// Cut the two pieces this task added straight out of the file and run THOSE — a
// transcription would only prove the transcription right.
function cut(from, to) {
  const a = PAGE.indexOf(from);
  assert.ok(a >= 0, 'could not find ' + JSON.stringify(from) + ' in index.html');
  const b = PAGE.indexOf(to, a);
  assert.ok(b >= 0, 'could not find the end of the block starting at ' + JSON.stringify(from));
  return PAGE.slice(a, b + to.length);
}

const SCROLL_SRC = cut("window.addEventListener('scroll', function () {", '}, { passive: true });');
const OVERVIEW_SRC = cut('var Overview = (function () {', '\n  })();');

/* ── the scroll handler ─────────────────────────────────────────────────── */
// The page re-derives the active block from element positions on every scroll. The
// overview drives the page by calling jump(), which scrolls — so without a guard the
// handler would overwrite the block the player had just chosen, mid-transition.
function runScrollHandler(opts) {
  const calls = { syncMap: 0, syncStrip: 0 };
  let frame = null;
  let fired = null;

  const node = function (idx, top) {
    return { dataset: { regionIdx: String(idx) }, getBoundingClientRect: function () { return { top: top }; } };
  };
  const nodes = [node(0, 500), node(1, 100), node(2, -300)];

  const ctx = {
    window: { addEventListener: function (name, fn) { if (name === 'scroll') fired = fn; } },
    document: { querySelectorAll: function () { return nodes; } },
    requestAnimationFrame: function (fn) { frame = fn; return 1; },
    DESKTOP: { matches: true },          // the sweep line is 200px on desktop
    rowMates: function (i) { return [i]; },
    syncMap: function () { calls.syncMap++; },
    syncStrip: function () { calls.syncStrip++; },
    activeIdx: opts.activeIdx,
    activeIdxs: opts.activeIdxs,
    overviewOn: opts.overviewOn,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext('var raf = null;\n' + SCROLL_SRC, ctx);

  fired();                               // a scroll
  assert.ok(frame, 'the handler should have asked for a frame');
  frame();                               // ...and the frame it queued

  return { ctx: ctx, calls: calls, raf: vm.runInContext('raf', ctx) };
}

test('the scroll handler names the block you have read down to', function () {
  const r = runScrollHandler({ activeIdx: 0, activeIdxs: [0], overviewOn: false });
  assert.strictEqual(r.ctx.activeIdx, 2, 'the last block above the line wins');
  assert.deepStrictEqual(r.ctx.activeIdxs, [2]);
  assert.strictEqual(r.calls.syncMap, 1);
});

test('the overview guard stops the scroll handler overwriting the player', function () {
  // The player has just called jump(7); the scroll that caused fires the handler.
  const r = runScrollHandler({ activeIdx: 7, activeIdxs: [7], overviewOn: true });
  assert.strictEqual(r.ctx.activeIdx, 7, 'the player\'s block survived the scroll');
  assert.deepStrictEqual(r.ctx.activeIdxs, [7]);
  assert.strictEqual(r.calls.syncMap, 0, 'the map was not re-lit from the scroll');
  assert.strictEqual(r.calls.syncStrip, 0);
  // The guard sits AFTER raf is cleared, so scrolling is not wedged once it ends.
  assert.strictEqual(r.raf, null, 'the frame token was left set — scrolling would stall');
});

/* ── the player ─────────────────────────────────────────────────────────── */
function fakeNode() {
  const n = {
    dataset: {}, attrs: {}, textContent: '', hidden: false, type: '', className: '', title: '',
    handlers: {},
    setAttribute: function (k, v) { this.attrs[k] = String(v); },
    getAttribute: function (k) { return this.attrs[k]; },
    addEventListener: function (k, fn) { this.handlers[k] = fn; },
  };
  n.children = [];
  n.replaceChildren = function () { n.children = []; };
  n.appendChild = function (c) { n.children.push(c); };
  n.querySelectorAll = function () { return n.children; };
  return n;
}

// A hand-rolled clock: the player uses setTimeout both to swap the caption at the
// bottom of the fade (0ms under reduced motion) and to dwell on a region (2600ms).
// Keeping them apart lets a test paint without also advancing.
function clock() {
  let id = 0;
  const q = [];
  return {
    setTimeout: function (fn, ms) { id++; q.push({ id: id, fn: fn, ms: ms }); return id; },
    clearTimeout: function (i) {
      for (let k = 0; k < q.length; k++) if (q[k].id === i) { q.splice(k, 1); return; }
    },
    due: function (ms) { return q.filter(function (t) { return t.ms === ms; }); },
    flush: function (ms) {
      const due = this.due(ms);
      due.forEach(function (t) { q.splice(q.indexOf(t), 1); t.fn(); });
      return due.length;
    },
  };
}

function harness(o) {
  o = o || {};
  const clk = clock();
  const el = {};
  ['overview', 'ovCaption', 'ovLeg', 'ovWhere', 'ovText', 'ovDots', 'ovPlay', 'ovSound', 'ovExit', 'ovCta']
    .forEach(function (k) { el[k] = fakeNode(); });

  // Two legs, four blocks, each with a stop or two of its own.
  const mk = function (index, name, count, range) {
    return { index: index, name: name, count: count, range: range };
  };
  const legs = [
    { id: '01', title: 'Out of Trivandrum', sub: 'the southern launch',
      narration: o.narration || null, regions: [mk(0, 'Kerala', 12, '2 Jan'), mk(1, 'Tamil Nadu', 6, '5 – 9 Jan')] },
    { id: '02', title: 'Up the west coast', sub: 'to the western tip',
      narration: null, regions: [mk(2, 'Goa', 3, '18 Jan'), mk(3, 'Gujarat', 9, '24 – 28 Jan')] },
  ];
  const regionsFlat = legs[0].regions.concat(legs[1].regions);
  const mapPlaced = [
    { idx: 0, stop: { lat: 8.5, lon: 76.9 } }, { idx: 0, stop: { lat: 9.5, lon: 76.4 } },
    { idx: 1, stop: { lat: 11.0, lon: 79.1 } },
    { idx: 2, stop: { lat: 15.3, lon: 74.0 } },
    { idx: 3, stop: { lat: 23.2, lon: 69.7 } },
  ];

  const log = { jumps: [], focus: [], planned: [], hideStop: 0 };
  const ctx = {
    el: el, legs: legs, regionsFlat: regionsFlat, mapPlaced: mapPlaced,
    MOTION: { matches: o.reducedMotion !== false },
    atlas: { focus: function (b, a) { log.focus.push({ bounds: b, animate: a }); } },
    jump: function (i) { log.jumps.push(i); },
    hideStop: function () { log.hideStop++; },
    setPlanned: function (v) { log.planned.push(v); ctx.planned = v; },
    planned: !!o.planned,
    overviewOn: false,
    document: { createElement: function () { return fakeNode(); } },
    setTimeout: clk.setTimeout, clearTimeout: clk.clearTimeout,
    Audio: function (src) {
      this.src = src;
      this.play = function () { return Promise.reject(new Error('no such file')); };
      this.pause = function () {};
    },
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(OVERVIEW_SRC, ctx);
  return { ctx: ctx, el: el, legs: legs, regionsFlat: regionsFlat, log: log, clk: clk,
           Overview: ctx.Overview };
}

test('the speaker stays hidden while no leg declares a narration track', function () {
  const h = harness();
  h.Overview.start();
  assert.strictEqual(h.el.ovSound.hidden, true, 'no track, no control');
  assert.strictEqual(h.el.overview.hidden, false, 'the overview itself is shown');
});

test('a leg that names a track brings the speaker back, and a missing file is survivable', function () {
  const h = harness({ narration: 'media/narration/leg-01.m4a' });
  h.Overview.start();
  assert.strictEqual(h.el.ovSound.hidden, false);

  // Turning sound on and playing a file that does not exist must not stop the ride.
  h.Overview.setSound(true);
  assert.strictEqual(h.el.ovSound.attrs['aria-pressed'], 'true');
  h.Overview.next();                       // Tamil Nadu, same leg, same (absent) track
  assert.strictEqual(h.ctx.overviewOn, true, 'playback carried on past the missing file');
  assert.strictEqual(h.log.jumps.length, 2);
});

test('starting the overview frames the first region and says where you are', function () {
  const h = harness();
  h.Overview.start();

  assert.strictEqual(h.ctx.overviewOn, true, 'the flag the scroll handler reads is set');
  assert.deepStrictEqual(h.log.jumps, [0], 'jump() is the single mover');
  assert.strictEqual(h.log.hideStop, 1, 'the map card is put away');

  // The frame is the box around every stop the page matched to that block.
  // Object.assign, because the box is built inside the sandbox realm.
  assert.deepStrictEqual(Object.assign({}, h.log.focus[0].bounds),
    { minLat: 8.5, maxLat: 9.5, minLon: 76.4, maxLon: 76.9 });

  h.clk.flush(0);                          // the caption swap, immediate under reduced motion
  assert.strictEqual(h.el.ovLeg.textContent, 'LEG 01 · OUT OF TRIVANDRUM');
  assert.strictEqual(h.el.ovWhere.textContent, 'Kerala');
  assert.strictEqual(h.el.ovText.textContent, '12 clips · 2 Jan — the southern launch');

  // One chapter dot per leg, the one being played lit.
  assert.strictEqual(h.el.ovDots.children.length, 2);
  assert.deepStrictEqual(h.el.ovDots.children.map(function (d) { return d.dataset.on; }),
    ['true', 'false']);
});

test('reduced motion asks the map for a jump-cut, and normal motion for an ease', function () {
  const cut = harness({ reducedMotion: true });
  cut.Overview.start();
  assert.strictEqual(cut.log.focus[0].animate, false, 'no viewBox tweening');

  const ease = harness({ reducedMotion: false });
  ease.Overview.start();
  assert.strictEqual(ease.log.focus[0].animate, true);
});

test('the dwell advances a region at a time, and pause holds it there', function () {
  const h = harness();
  h.Overview.start();
  assert.strictEqual(h.clk.due(2600).length, 1, 'a dwell is pending');

  h.clk.flush(2600);
  assert.deepStrictEqual(h.log.jumps, [0, 1]);

  h.Overview.toggle();                     // pause
  assert.strictEqual(h.clk.due(2600).length, 0, 'the dwell was cancelled');
  assert.strictEqual(h.el.ovPlay.attrs['aria-label'], 'Play');

  h.Overview.toggle();                     // play
  assert.strictEqual(h.clk.due(2600).length, 1, 'the dwell came back');
  assert.strictEqual(h.el.ovPlay.attrs['aria-label'], 'Pause');
});

test('a chapter dot jumps to the first region of its leg', function () {
  const h = harness();
  h.Overview.start();
  h.el.ovDots.children[1].handlers.click();
  assert.deepStrictEqual(h.log.jumps, [0, 2], 'the second leg starts at Goa');
});

test('running off the end stops the overview and shows the whole country again', function () {
  const h = harness();
  h.Overview.start();
  for (let i = 0; i < 4; i++) h.Overview.next();   // four blocks, so the fourth runs off

  assert.strictEqual(h.ctx.overviewOn, false);
  assert.strictEqual(h.Overview.isOn(), false);
  assert.strictEqual(h.el.overview.hidden, true);
  assert.strictEqual(h.el.ovCta.textContent, 'SEE THE OVERVIEW ▸');
  assert.strictEqual(h.log.focus[h.log.focus.length - 1].bounds, null, 'the map is reset');
  assert.strictEqual(h.clk.due(2600).length, 0, 'no dwell left ticking');
});

test('the planned overlay is put back the way it was found', function () {
  const on = harness({ planned: true });
  on.Overview.start();
  assert.strictEqual(on.ctx.planned, false, 'one line at a time while it plays');
  on.Overview.stop();
  assert.strictEqual(on.ctx.planned, true, 'the reader\'s choice was not quietly rewritten');

  const off = harness({ planned: false });
  off.Overview.start();
  off.Overview.stop();
  assert.strictEqual(off.ctx.planned, false);
});
