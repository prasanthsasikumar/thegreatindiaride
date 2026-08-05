const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// index.html is one page-sized IIFE behind a fetch, so there is nothing to require.
// Cut the two pieces this task added straight out of the file and run THOSE. A
// transcription would only prove the transcription right.
function cut(from, to) {
  const a = PAGE.indexOf(from);
  assert.ok(a >= 0, 'could not find ' + JSON.stringify(from) + ' in index.html');
  const b = PAGE.indexOf(to, a);
  assert.ok(b >= 0, 'could not find the end of the block starting at ' + JSON.stringify(from));
  return PAGE.slice(a, b + to.length);
}

const SCROLL_SRC = cut("window.addEventListener('scroll', function () {", '}, { passive: true });');
const ROWMATES_SRC = cut('function rowMates(idx) {', '\n  }');
const OVERVIEW_SRC = cut('var Overview = (function () {', '\n  })();');
// Neither function nests a block that closes at this indent, so the first `\n  }` is
// the function's own.
const PLANNED_SRC = cut('function syncPlannedLine() {', '\n  }') +
                    cut('function setPlanned(on) {', '\n  }');

/* ── the scroll handler ─────────────────────────────────────────────────── */
// The page re-derives the active block from element positions on every scroll. The
// overview drives the page by calling jump(), which scrolls, so without a guard the
// handler would overwrite the block the player had just chosen, mid-transition.
// A region block, laid out the way the page lays them out. A two-up row is a pair
// sharing a top; a stacked block sits below the one before it and only ever touches
// its neighbour at an edge.
function block(idx, top, height) {
  const h = height == null ? 400 : height;
  const box = { top: top, bottom: top + h, height: h };
  return {
    dataset: { regionIdx: String(idx) },
    getBoundingClientRect: function () { return box; },
  };
}

// rowMates is cut out of the page and run for real. It used to be stubbed here as
// `function (i) { return [i]; }`, which is exactly the one-block-at-a-time behaviour
// that commit 979e24c replaced: with that stub in place the real overlap threshold
// could be broken outright and this suite stayed green.
function runScrollHandler(opts) {
  const calls = { syncMap: 0, syncStrip: 0 };
  let frame = null;
  let fired = null;

  // Stacked by default: 2 above 1 above 0, no two of them sharing a row.
  const nodes = opts.nodes || [block(0, 500), block(1, 100), block(2, -300)];
  const byId = {};
  nodes.forEach(function (n) { byId['region-' + n.dataset.regionIdx] = n; });

  const ctx = {
    window: { addEventListener: function (name, fn) { if (name === 'scroll') fired = fn; } },
    document: {
      querySelectorAll: function () { return nodes; },
      getElementById: function (id) { return byId[id] || null; },
    },
    requestAnimationFrame: function (fn) { frame = fn; return 1; },
    DESKTOP: { matches: true },          // the sweep line is 200px on desktop
    Math: Math,
    syncMap: function () { calls.syncMap++; },
    syncStrip: function () { calls.syncStrip++; },
    activeIdx: opts.activeIdx,
    activeIdxs: opts.activeIdxs,
    overviewOn: opts.overviewOn,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext('var raf = null;\n' + ROWMATES_SRC + '\n' + SCROLL_SRC, ctx);

  fired();                               // a scroll
  assert.ok(frame, 'the handler should have asked for a frame');
  frame();                               // ...and the frame it queued

  // activeIdxs is now built by the real rowMates, inside the sandbox realm, so it is
  // copied out before it is compared: deepStrictEqual checks prototypes and a
  // cross-realm Array is not the Array this file's literals are.
  return {
    ctx: ctx, calls: calls, raf: vm.runInContext('raf', ctx),
    idxs: Array.from(vm.runInContext('activeIdxs', ctx)),
  };
}

test('the scroll handler names the block you have read down to', function () {
  const r = runScrollHandler({ activeIdx: 0, activeIdxs: [0], overviewOn: false });
  assert.strictEqual(r.ctx.activeIdx, 2, 'the last block above the line wins');
  assert.deepStrictEqual(r.idxs, [2]);
  assert.strictEqual(r.calls.syncMap, 1);
});

test('the overview guard stops the scroll handler overwriting the player', function () {
  // The player has just called jump(7); the scroll that caused fires the handler.
  const r = runScrollHandler({ activeIdx: 7, activeIdxs: [7], overviewOn: true });
  assert.strictEqual(r.ctx.activeIdx, 7, 'the player\'s block survived the scroll');
  assert.deepStrictEqual(r.idxs, [7]);
  assert.strictEqual(r.calls.syncMap, 0, 'the map was not re-lit from the scroll');
  assert.strictEqual(r.calls.syncStrip, 0);
  // The guard sits AFTER raf is cleared, so scrolling is not wedged once it ends.
  assert.strictEqual(r.raf, null, 'the frame token was left set, so scrolling would stall');
});

test('a two-up row lights both of its blocks, named by the left one', function () {
  // What 979e24c is for. The sweep finishes on whichever block comes last in document
  // order, which for a pair laid out side by side is the right-hand one. Both are on
  // screen, so both light, and the block NAMED is the one a reader reaches first.
  const r = runScrollHandler({
    activeIdx: 0, activeIdxs: [0], overviewOn: false,
    nodes: [block(0, 900), block(1, 100), block(2, 100)],   // 1 and 2 share a row
  });
  assert.deepStrictEqual(r.idxs, [1, 2], 'both halves of the row are lit');
  assert.strictEqual(r.ctx.activeIdx, 1, 'and the left one names it');
  assert.strictEqual(r.calls.syncMap, 1);
});

test('blocks that merely graze each other are not on the same row', function () {
  // The threshold is a MAJORITY overlap with the shorter of the pair, not any
  // overlap. Two stacked blocks offset by half their height overlap by exactly half,
  // which must not qualify, or scrolling past a tall block would light its neighbour.
  const r = runScrollHandler({
    activeIdx: 0, activeIdxs: [0], overviewOn: false,
    nodes: [block(1, -100), block(2, 100)],   // 400 tall each, exactly 200 of overlap
  });
  assert.deepStrictEqual(r.idxs, [2], 'exactly half is not a majority, so 1 does not join');
  assert.strictEqual(r.ctx.activeIdx, 2);
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
  ['overview', 'ovCaption', 'ovLeg', 'ovWhere', 'ovText', 'ovDots', 'ovPlay', 'ovSound', 'ovExit',
   'ovCta', 'planToggle'].forEach(function (k) { el[k] = fakeNode(); });

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

  // The real setPlanned/syncPlannedLine are cut out of the page and run here too, over
  // a localStorage that records every write. Stubbing them would hide the one thing
  // these tests exist to watch: what reaches the disk while the overview is playing.
  const log = { jumps: [], focus: [], hideStop: 0, writes: [] };
  const plannedLine = { style: { display: o.planned ? '' : 'none' } };

  const ctx = {
    el: el, legs: legs, regionsFlat: regionsFlat, mapPlaced: mapPlaced,
    MOTION: { matches: o.reducedMotion !== false },
    atlas: { focus: function (b, a) { log.focus.push({ bounds: b, animate: a }); } },
    jump: function (i) { log.jumps.push(i); },
    hideStop: function () { log.hideStop++; },
    planned: !!o.planned, plannedSuppressed: false, plannedLine: plannedLine,
    PLAN_KEY: 'ride:planned',
    localStorage: { setItem: function (k, v) { log.writes.push({ key: k, value: v }); } },
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
  vm.runInContext(PLANNED_SRC, ctx);
  vm.runInContext(OVERVIEW_SRC, ctx);
  return { ctx: ctx, el: el, legs: legs, regionsFlat: regionsFlat, log: log, clk: clk,
           plannedLine: plannedLine, Overview: ctx.Overview,
           setPlanned: function (v) { return vm.runInContext('setPlanned', ctx)(v); } };
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
  assert.strictEqual(h.el.ovText.textContent, '12 clips · 2 Jan · the southern launch');

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

test('the overview hides the planned line without writing to localStorage', function () {
  const h = harness({ planned: true });
  assert.strictEqual(h.plannedLine.style.display, '', 'the reader had it on');

  h.Overview.start();
  assert.strictEqual(h.plannedLine.style.display, 'none', 'one line at a time while it plays');
  // The whole point: a reader who reloads, or closes the tab, mid-playback must still
  // find their planned-route choice where they left it.
  assert.deepStrictEqual(h.log.writes, [], 'nothing reached the stored preference');
  assert.strictEqual(h.ctx.planned, true, 'the preference itself is untouched');

  h.Overview.stop();
  assert.strictEqual(h.plannedLine.style.display, '', 'and it comes back on exit');
  assert.deepStrictEqual(h.log.writes, [], 'still nothing written');
});

test('a planned-route click during playback persists, and lands when the run ends', function () {
  const h = harness({ planned: true });
  h.Overview.start();

  // The toggle stays live over the map. Turning it off mid-run is a real choice.
  h.setPlanned(false);
  assert.deepStrictEqual(h.log.writes, [{ key: 'ride:planned', value: '0' }],
    'the click was persisted like any other');
  assert.strictEqual(h.ctx.planned, false);
  assert.strictEqual(h.el.planToggle.textContent, 'Planned route', 'the toggle reads back true');

  h.Overview.stop();
  assert.strictEqual(h.plannedLine.style.display, 'none', 'the click was not undone on exit');

  // ...and the other direction: switched ON mid-run, it stays hidden until the end.
  const g = harness({ planned: false });
  g.Overview.start();
  g.setPlanned(true);
  assert.deepStrictEqual(g.log.writes, [{ key: 'ride:planned', value: '1' }]);
  assert.strictEqual(g.plannedLine.style.display, 'none', 'still borrowed by the overview');
  g.Overview.stop();
  assert.strictEqual(g.plannedLine.style.display, '', 'and it takes effect when the run ends');
});

test('exiting drops the pending caption swap', function () {
  const h = harness();
  h.Overview.start();
  assert.strictEqual(h.clk.due(0).length, 1, 'a caption swap is pending');
  h.Overview.stop();
  assert.strictEqual(h.clk.due(0).length, 0, 'and it does not fire after the exit');
  assert.strictEqual(h.el.ovWhere.textContent, '', 'no region name landed after the exit');
});

test('stepping inside the fade drops the swap it interrupted', function () {
  const h = harness();
  h.Overview.start();
  h.Overview.next();                       // before the first swap has run
  assert.strictEqual(h.clk.due(0).length, 1, 'one pending swap, not two');
  h.clk.flush(0);
  assert.strictEqual(h.el.ovWhere.textContent, 'Tamil Nadu', 'the region you stepped to');
});

/* ── what the page remembers ────────────────────────────────────────────── */
/*
 * Five preferences survive a reload. ride:planned is covered above and ride:k2k in
 * test/k2k.test.cjs; these are the other three, which had no coverage at all: every
 * one of their setItem calls could be deleted outright with the whole suite green.
 * For a preference that means the reader re-sets it on every visit and nothing ever
 * says so, which is the quietest kind of regression there is.
 *
 * Each test runs the page's own writer, cut out of index.html, over a localStorage
 * that records what reaches it.
 */
function prefCtx(extra) {
  const writes = [];
  const ctx = Object.assign({
    Math: Math, String: String, Boolean: Boolean, console: console,
    localStorage: {
      setItem: function (k, v) { writes.push({ key: k, value: v }); },
      getItem: function () { return null; },
    },
  }, extra);
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  return { ctx: ctx, writes: writes };
}

test('flipping the map between outline and tiles is remembered', function () {
  const p = prefCtx({
    MAP_KEY: 'ride:map-mode',
    el: { atlas: { dataset: {} }, mapToggle: fakeNode(), mapAttr: { hidden: false } },
    atlas: null,
  });
  vm.runInContext('var mapMode = "outline";\n' +
    cut('function setMapMode(mode) {', '\n  }'), p.ctx);

  vm.runInContext('setMapMode("map")', p.ctx);
  assert.deepStrictEqual(p.writes, [{ key: 'ride:map-mode', value: 'map' }]);
  assert.strictEqual(vm.runInContext('mapMode', p.ctx), 'map');
  assert.strictEqual(p.ctx.el.mapToggle.textContent, 'Outline', 'the button offers the way back');

  vm.runInContext('setMapMode("outline")', p.ctx);
  assert.deepStrictEqual(p.writes[1], { key: 'ride:map-mode', value: 'outline' });
});

test('unmuting a clip is remembered, and the automatic mute is not', function () {
  const video = fakeNode();
  video.muted = true;
  const p = prefCtx({ SOUND_KEY: 'ride:sound-on', v: video });
  vm.runInContext('var soundOn = false, syncing = false;\n' +
    cut("v.addEventListener('volumechange', function () {", '\n    });'), p.ctx);

  video.handlers.volumechange();
  assert.deepStrictEqual(p.writes, [{ key: 'ride:sound-on', value: '0' }]);

  video.muted = false;
  video.handlers.volumechange();
  assert.deepStrictEqual(p.writes[1], { key: 'ride:sound-on', value: '1' });
  assert.strictEqual(vm.runInContext('soundOn', p.ctx), true);

  // The autoplay fallback mutes the element itself to get playback started. That is
  // the page talking to itself, not a reader choosing silence, and it must not reach
  // the disk or it would overwrite the preference it is standing in for.
  vm.runInContext('syncing = true', p.ctx);
  video.muted = true;
  video.handlers.volumechange();
  assert.strictEqual(p.writes.length, 2, 'the guarded mute was persisted anyway');
});

test('turning autoplay off in the lightbox is remembered', function () {
  const btn = fakeNode();
  let painted = 0;
  const p = prefCtx({
    AUTO_KEY: 'ride:autoplay',
    el: { lbAuto: btn },
    paintAuto: function () { painted++; },
  });
  vm.runInContext('var autoOn = true;\n' +
    cut("el.lbAuto.addEventListener('click', function () {", '\n  });'), p.ctx);

  btn.handlers.click();
  assert.deepStrictEqual(p.writes, [{ key: 'ride:autoplay', value: '0' }]);
  assert.strictEqual(vm.runInContext('autoOn', p.ctx), false);
  assert.strictEqual(painted, 1, 'the button repaints to match');

  btn.handlers.click();
  assert.deepStrictEqual(p.writes[1], { key: 'ride:autoplay', value: '1' });
});
