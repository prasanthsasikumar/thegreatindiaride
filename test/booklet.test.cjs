const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');

// booklet.html is a static page with no build step, so there is nothing to import.
// What follows is a DOM stub — enough of one for atlas.js, costs.js and the page's
// own inline script to run headless against the real data files, so the figures a
// reader would print can be asserted on rather than eyeballed.
//
// It deliberately does NOT try to be a browser: no layout, no CSS, no events. Print
// appearance is not testable here and is not claimed to be.

function Node(tag) {
  this.tagName = tag;
  this.children = [];
  this.attrs = {};
  this.dataset = {};
  this.style = {};
  this.className = '';
  this.parentNode = null;
  this._text = '';
}
Object.defineProperty(Node.prototype, 'textContent', {
  get: function () {
    if (!this.children.length) return this._text;
    return this.children.map(function (c) { return c.textContent; }).join('');
  },
  set: function (v) { this._text = String(v); this.children = []; },
});
Object.defineProperty(Node.prototype, 'firstChild', {
  get: function () { return this.children[0] || null; },
});
Object.defineProperty(Node.prototype, 'nextSibling', {
  get: function () {
    if (!this.parentNode) return null;
    return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
  },
});
Node.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
Node.prototype.insertBefore = function (c, ref) {
  c.parentNode = this;
  const i = ref ? this.children.indexOf(ref) : -1;
  if (i < 0) this.children.push(c); else this.children.splice(i, 0, c);
  return c;
};
Node.prototype.replaceChildren = function () {
  this.children = [];
  for (let i = 0; i < arguments.length; i++) this.appendChild(arguments[i]);
};
Node.prototype.remove = function () {
  if (!this.parentNode) return;
  const i = this.parentNode.children.indexOf(this);
  if (i >= 0) this.parentNode.children.splice(i, 1);
  this.parentNode = null;
};
Node.prototype.setAttribute = function (k, v) {
  this.attrs[k] = String(v);
  if (k === 'class') this.className = String(v);
};
Node.prototype.getAttribute = function (k) { return this.attrs[k]; };
Node.prototype.addEventListener = function () {};
// Depth-first collect, standing in for querySelectorAll.
Node.prototype.collect = function (pred, out) {
  out = out || [];
  this.children.forEach(function (c) {
    if (pred(c)) out.push(c);
    c.collect(pred, out);
  });
  return out;
};

function textNode(s) { const n = new Node('#text'); n._text = String(s); return n; }

function hasClass(node, cls) {
  return String(node.className).split(/\s+/).indexOf(cls) >= 0;
}

function rowsOf(node) {
  return node.collect(function (n) { return n.tagName === 'tr'; })
    .map(function (tr) { return tr.children.map(function (td) { return td.textContent; }); });
}

let rendered = null;

// One render, shared by every test: booting the page is the expensive part and it
// has no state to reset between assertions.
function render() {
  if (rendered) return rendered;

  const html = fs.readFileSync(path.join(ROOT, 'booklet.html'), 'utf8');
  const main = new Node('main');
  const byId = {};
  // Every id the markup declares gets a node, in document order, all parented to
  // one root — that is all the structure the page's inserts need (sector spreads go
  // in before #bk-sectors-anchor, the sourcing gap after #bk-provenance).
  const ids = html.match(/\sid="([a-z0-9-]+)"/g) || [];
  ids.forEach(function (m) {
    const id = m.match(/id="([a-z0-9-]+)"/)[1];
    if (byId[id]) return;
    const n = new Node('div');
    n.id = id;
    main.appendChild(n);
    byId[id] = n;
  });

  const doc = {
    createElement: function (t) { return new Node(t); },
    createElementNS: function (ns, t) { return new Node(t); },
    createTextNode: textNode,
    getElementById: function (id) { return byId[id] || null; },
  };

  const ctx = {
    console: console,
    document: doc,
    Promise: Promise,
    Math: Math,
    String: String,
    Number: Number,
    Array: Array,
    Object: Object,
    Error: Error,
    setTimeout: setTimeout,
    fetch: function (url) {
      const file = path.join(ROOT, String(url).replace(/^\//, ''));
      return Promise.resolve({
        ok: true,
        json: function () { return Promise.resolve(JSON.parse(fs.readFileSync(file, 'utf8'))); },
      });
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'atlas.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'costs.js'), 'utf8'), ctx);
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], ctx);

  // The page boots off Promise.all; the fetch stub resolves synchronously, so one
  // turn of the macrotask queue is enough to drain every .then behind it.
  rendered = new Promise(function (resolve) { setTimeout(resolve, 0); }).then(function () {
    return { main: main, byId: byId };
  });
  return rendered;
}

const TEMPLATE = JSON.parse(fs.readFileSync(path.join(ROOT, 'template.json'), 'utf8'));
const NOTES = JSON.parse(fs.readFileSync(path.join(ROOT, 'template-notes.json'), 'utf8'));
const RESEARCH = JSON.parse(fs.readFileSync(path.join(ROOT, 'research.json'), 'utf8'));

test('the book boots without falling into its error state', async function () {
  const { byId } = await render();
  // The markup ships the error paragraph hidden and the boot's catch is the only
  // thing that un-hides it, so anything other than an explicit false means no throw.
  assert.notStrictEqual(byId['bk-error'].hidden, false,
    'the error message stayed hidden, so no fetch or render threw');
  assert.match(byId['bk-cover-sub'].textContent, /KM · \d+ LEGS/,
    'and the cover was filled in from the data rather than left at its placeholder');
});

test('the cost table prints the per-night rates derived from the ride', async function () {
  const { byId } = await render();
  const rows = rowsOf(byId['bk-costs-table']);
  const find = function (needle) {
    return rows.filter(function (r) { return r[0].indexOf(needle) === 0; })[0];
  };
  assert.deepStrictEqual(find('A bed, per night'), ['A bed, per night', '₹1,456']);
  assert.strictEqual(find('Fuel, food, everything else, per night')[1], '₹2,215');
  assert.strictEqual(find('Per night, all in')[1], '₹3,671');
});

test('the loop projection and the ride\'s actual spend are both on the page', async function () {
  const { byId } = await render();
  const rows = rowsOf(byId['bk-costs-table']);
  const loop = rows.filter(function (r) { return r[0].indexOf('The whole loop') === 0; })[0];
  const real = rows.filter(function (r) { return r[0].indexOf('What this ride actually cost') === 0; })[0];
  assert.deepStrictEqual(loop, ['The whole loop · 71 riding days', '₹2,60,641']);
  assert.deepStrictEqual(real, ['What this ride actually cost · 93 nights', '₹3,41,402']);
});

test('the projection is never shown without the reason it undercuts the real spend', async function () {
  // The longer loop costing less than the shorter ride is the one number on this page
  // that misleads on its own. If the table is ever rendered without this sentence, or
  // the sentence loses the hours-a-day assumption, the book is making a false promise.
  const { byId } = await render();
  const caveat = byId['bk-costs-caveat'].textContent;
  assert.match(caveat, /not comparable/);
  assert.match(caveat, /6 hours a day/);
  assert.match(caveat, /no rest days/);
  assert.match(caveat, /₹2,60,641/);
  assert.match(caveat, /₹3,41,402/);
  assert.match(caveat, /floor, not a forecast/);
});

test('the glance figures are template.json\'s totals, not copies of them', async function () {
  const { byId } = await render();
  const cells = byId['bk-glance'].children.map(function (d) { return d.textContent; });
  assert.deepStrictEqual(cells, [
    Math.round(TEMPLATE.totals.km).toLocaleString('en-IN') + 'km',
    TEMPLATE.totals.hops + 'legs',
    Math.round(TEMPLATE.totals.hours) + 'riding hours',
    TEMPLATE.totals.countries + 'countries',
    TEMPLATE.crossings.length + 'crossings',
  ]);
});

test('every sector map draws the whole loop first and the sector on top of it', async function () {
  // Draw order is paint order in SVG. Reversed, the dimmed loop would be laid over
  // the sector it is supposed to sit behind, and the point of the spread — this bit
  // solid, the rest dimmed — is lost on paper where there is no colour to fall back on.
  const { main } = await render();
  const sectors = main.collect(function (n) { return hasClass(n, 'bk__sector'); });
  assert.strictEqual(sectors.length, TEMPLATE.sectors.length);
  sectors.forEach(function (sec, i) {
    const lines = sec.collect(function (n) { return n.tagName === 'polyline'; });
    assert.deepStrictEqual(
      lines.map(function (l) { return l.className; }),
      ['route--planned', 'route'],
      'sector ' + TEMPLATE.sectors[i].id + ' draws the loop, then the sector');
  });
});

test('each sector map carries its own key, since aria-labels do not print', async function () {
  const { main } = await render();
  main.collect(function (n) { return hasClass(n, 'bk__sector'); }).forEach(function (sec) {
    const key = sec.collect(function (n) { return hasClass(n, 'bk__legend'); });
    assert.strictEqual(key.length, 1);
    assert.match(key[0].textContent, /the rest of the loop/);
  });
});

test('every unwritten note renders as a visible gap, never as prose', async function () {
  // The single most damaging thing this page could do is invent a riding season or a
  // permit, so the gaps are counted rather than sampled: a gap that quietly stops
  // being rendered is the failure this asserts against.
  //
  // The count is derived from what is actually written in template-notes.json, not
  // hard-coded, so that filling a note is a deliberate act with a visible diff here
  // rather than something that silently satisfies a smaller number. As of the xBhp
  // field research this is 15: sourcing has been written, and S3's permits have been
  // written, which is why it is no longer 17.
  const { main } = await render();
  const gaps = main.collect(function (n) { return hasClass(n, 'bk__todo'); });
  const sectors = TEMPLATE.sectors.length;

  const isWritten = function (s) { return !!s && String(s).indexOf('TO WRITE') !== 0; };
  const unwrittenSeasons = TEMPLATE.sectors.filter(function (s) {
    return !isWritten((NOTES.sectors[s.id] || {}).season);
  }).length;
  const unwrittenPermits = TEMPLATE.sectors.filter(function (s) {
    return !isWritten((NOTES.sectors[s.id] || {}).permits);
  }).length;

  const expected =
    unwrittenSeasons                        // the season block on each sector spread
    + unwrittenSeasons                      // the season column of the calendar
    + unwrittenPermits                      // the permits column of the calendar
    + (isWritten(NOTES.plannedVsRidden) ? 0 : 1)
    + (isWritten(NOTES.sourcing) ? 0 : 1);

  assert.strictEqual(expected, 15,
    'five unwritten seasons twice over, four unwritten permits, planned-vs-ridden');
  assert.strictEqual(gaps.length, expected);
  gaps.forEach(function (g) { assert.match(g.textContent, /^Not written yet/); });
  // And nothing anywhere on the page leaked the raw placeholder text.
  assert.doesNotMatch(main.textContent, /TO WRITE/);
});

test('the season windows are still unwritten, and nothing was invented for them', async function () {
  // The field research gives no riding calendar — its finding is that timing is set
  // by leave rather than weather — so every season row must still be a gap. This is
  // the assertion that would catch a calendar being back-filled out of the ride
  // dates in the archive's case studies.
  const { byId } = await render();
  const rows = rowsOf(byId['bk-season-table']).slice(1);
  rows.forEach(function (r, i) {
    assert.strictEqual(r[2], 'Not written yet', TEMPLATE.sectors[i].id + ' season');
  });
  TEMPLATE.sectors.forEach(function (s) {
    assert.strictEqual((NOTES.sectors[s.id] || {}).season, 'TO WRITE', s.id);
  });
});

test('the researched permit note reaches the sector page, not only the calendar', async function () {
  // A permit that has been researched is the one genuinely non-improvisable thing on
  // this loop. It has to be printed on the spread a rider is actually looking at when
  // they plan that leg, and it must not wait on a season note that nobody has written.
  const { main } = await render();
  const s3 = main.collect(function (n) { return n.id === 'sector-S3'; })[0];
  assert.ok(s3, 'the S3 spread was rendered');
  assert.match(s3.textContent, /Inner Line Permit/);
  assert.match(s3.textContent, /Protected Area Permit/);
  assert.match(s3.textContent, /Not written yet — season window/,
    'and the unwritten season for that same sector is still shown as a gap');
});

test('the season calendar leaves both columns blank for every sector', async function () {
  const { byId } = await render();
  const rows = rowsOf(byId['bk-season-table']).slice(1);   // drop the column heads
  assert.strictEqual(rows.length, TEMPLATE.sectors.length);
  rows.forEach(function (r, i) {
    const id = TEMPLATE.sectors[i].id;
    const note = NOTES.sectors[id] || {};
    // While the note is unwritten this is the assertion that matters; once the author
    // writes one, the row must show what was written rather than the placeholder.
    if (!note.season || note.season.indexOf('TO WRITE') === 0) {
      assert.strictEqual(r[2], 'Not written yet', id + ' season');
    } else {
      assert.strictEqual(r[2], note.season, id + ' season');
    }
    if (!note.permits) assert.strictEqual(r[3], 'Not written yet', id + ' permits');
    else assert.strictEqual(r[3], note.permits, id + ' permits');
  });
});

test('every leg of the template appears exactly once across the waypoint tables', async function () {
  const { main } = await render();
  const tables = main.collect(function (n) { return hasClass(n, 'bk__hops'); });
  const legs = tables.reduce(function (a, t) { return a + rowsOf(t).length - 1; }, 0);
  assert.strictEqual(legs, TEMPLATE.totals.hops);
});

test('every research photograph carries its credit line, in the same figure', async function () {
  // These are other riders' photographs, reproduced with their watermarks intact.
  // A plate without its credit beside it is a defect, so this asserts the credit is
  // inside the figure element rather than merely somewhere on the page: it is the
  // adjacency that matters, and it is what survives a print that breaks pages.
  const { main } = await render();
  const figs = main.collect(function (n) { return n.tagName === 'figure'; });
  assert.strictEqual(figs.length, RESEARCH.figures.length);

  const seen = [];
  figs.forEach(function (fig) {
    const imgs = fig.collect(function (n) { return n.tagName === 'img'; });
    assert.strictEqual(imgs.length, 1, 'one image per figure');
    const src = imgs[0].getAttribute('src');
    assert.match(src, /^media\/research\/fig-0\d\.jpg$/, src);
    assert.ok(imgs[0].getAttribute('alt').length > 0, 'alt text on ' + src);
    seen.push(src);

    const credit = fig.collect(function (n) { return hasClass(n, 'bk__credit'); });
    assert.strictEqual(credit.length, 1, 'a credit line inside the figure for ' + src);
    assert.match(credit[0].textContent, /^© /, src);
    assert.match(credit[0].textContent, /xBhp travelogue, 20(18|21)/, src);

    // The caption survives having the credit appended after it.
    const cap = fig.collect(function (n) { return n.tagName === 'figcaption'; })[0];
    const expected = RESEARCH.figures.filter(function (f) { return f.file === src; })[0];
    assert.ok(cap.textContent.indexOf(expected.caption) === 0, 'caption on ' + src);
  });

  assert.deepStrictEqual(seen.sort(), RESEARCH.figures.map(function (f) { return f.file; }).sort());
});

test('no optional field renders as the string "undefined"', async function () {
  // Every one of these records is optional somewhere — a caption, a note, a source.
  // A missing one has to render as nothing, not as the word "undefined" printed
  // under a photograph or in the middle of a cost sentence.
  const { main } = await render();
  assert.doesNotMatch(main.textContent, /undefined/);
});

test('the research files it names all exist on disk', async function () {
  RESEARCH.figures.forEach(function (f) {
    assert.ok(fs.existsSync(path.join(ROOT, f.file)), f.file + ' is missing');
    assert.ok(fs.statSync(path.join(ROOT, f.file)).size > 1024, f.file + ' is empty');
  });
});

test('both of the report\'s caveats on its own numbers are printed, not just stored', async function () {
  // The corpus counts are keyword-derived and the record table spans a state-count
  // change. A reader who sees either table without its caveat reads those figures as
  // harder than they are, so the caveats belong on the page beside them.
  const { main } = await render();
  const text = main.textContent;
  assert.match(text, /keyword matching on URL slugs/);
  assert.match(text, /picture of proportion, not an exact census/);
  assert.match(text, /private record registries rather than Guinness/);
  assert.match(text, /29 states; India has had 28 states and 8 union territories/);
});

test('the archive money is printed with its year and kept apart from this ride\'s rates', async function () {
  // 2018 rupees and somebody else's ride. Every figure has to carry the year, and the
  // page has to say the two sets of numbers are not comparable — otherwise the
  // benchmark reads as a quote for the loop in this book.
  const { byId } = await render();
  const text = byId['bk-costs-archive'].textContent;
  assert.match(text, /2018 RUPEES/);
  assert.match(text, /₹1,04,695/);
  assert.match(text, /₹2,000–2,200 per person per day/);
  assert.match(text, /not comparable with the rates above/);

  const rows = rowsOf(byId['bk-costs-archive']);
  const find = function (needle) {
    return rows.filter(function (r) { return r[0].indexOf(needle) === 0; })[0];
  };
  // The itemised lines, unrounded and in the report's own order.
  assert.strictEqual(find('Fuel')[1], '₹34,172');
  assert.strictEqual(find('Hotels (16 hotels)')[1], '₹31,775');
  assert.strictEqual(find('Permits')[1], '₹200');
  assert.strictEqual(find('Tyres (Pirelli MT60)')[1], '₹20,000');

  // And the lines add up to the totals the report gives, which is the cheapest
  // possible check that nothing was mistyped in transcription.
  const sum = function (lines) {
    return lines.reduce(function (a, l) { return a + l.amount; }, 0);
  };
  assert.strictEqual(sum(RESEARCH.benchmarks.itemised.lines), RESEARCH.benchmarks.itemised.total);
  assert.strictEqual(sum(RESEARCH.benchmarks.preparation.lines), RESEARCH.benchmarks.preparation.total);
});

test('the K2K page keeps the cited highway apart from the measured half', async function () {
  // The one page in this book that prints two distances from two different kinds of
  // source. If the corridor sketch ever loses its caveat, or the west-coast total
  // ever stops naming itself as measured, the page reads as though somebody
  // measured NH-44 here. Nobody did.
  const { main } = await render();
  const K2K = JSON.parse(fs.readFileSync(path.join(ROOT, 'k2k.json'), 'utf8'));
  const page = main.collect(function (n) { return n.id === 'bk-k2k'; })[0];
  assert.ok(page, 'the K2K page was rendered');
  assert.ok(hasClass(page, 'bk__page'), 'and it is a book page');
  assert.ok(!hasClass(page, 'bk__research'),
    'it is route content, so leaving the appendix out must not take it away');

  const text = page.textContent;
  assert.match(text, /3,745 km/);
  assert.match(text, /4,112 km/);
  assert.match(text, /6,000–11,000 km/);
  assert.match(text, /corridor sketch/);
  assert.match(text, /a drawing and not a distance/);
  assert.match(text, /Nagpur/);

  // The measured total sits two paragraphs from the cited one, so the 884 km of it
  // that is a detour to the Pakistan border has to be printed between them. Without
  // that a reader concludes the west coast is 700 km longer than NH-44; most of the
  // gap is the spur. And no shorter total may be offered, because the road that would
  // replace the spur was never measured for this book.
  assert.match(text, /884 km of it is the Kutch spur out to Narayan Sarovar/);
  assert.match(text, /no measured Rajkot to Palanpur road in this book/);
  assert.match(text, /no figure for it is offered here/);
  assert.match(text, /Cut the Kutch spur first/);
  assert.match(text, /21-day clock/);

  // Two lines that stop at Srinagar and start at Delhi are not a circuit.
  assert.match(text, /do not join up/);

  // The print key has to describe the lines that are actually drawn, and none of its
  // swatches may be an em dash.
  const key = page.collect(function (n) { return hasClass(n, 'bk__legend'); })[0];
  assert.ok(key, 'the page carries a key, since aria-labels do not print');
  assert.ok(key.textContent.indexOf('—') < 0, 'the key uses rules, not em dashes');
  assert.match(key.textContent, /up the spine, the NH-44 corridor/);
  assert.match(key.textContent, /down the west coast, measured/);

  // The measured half is printed leg by leg and the legs add up to the stored total.
  const rows = rowsOf(page.collect(function (n) { return hasClass(n, 'bk__k2k-legs'); })[0]);
  assert.strictEqual(rows.length, K2K.south.hops + 2);   // head, 23 legs, total
  assert.deepStrictEqual(rows[rows.length - 1],
    ['Measured total', Math.round(K2K.south.measuredKm).toLocaleString('en-IN'), '']);

  // Three lines on its map, drawn context-first the way the sector spreads are.
  const lines = page.collect(function (n) { return n.tagName === 'polyline'; });
  assert.deepStrictEqual(lines.map(function (l) { return l.className; }), [
    'route--planned', 'route--k2k route--k2k-s', 'route--k2k route--k2k-n',
  ]);
});

test('the appendix is appended as its own pages and can be left out of the print', async function () {
  const { main } = await render();
  const pages = main.collect(function (n) { return hasClass(n, 'bk__research'); });
  // An opener, one page per part, and the references.
  assert.strictEqual(pages.length, RESEARCH.appendix.length + 2);
  pages.forEach(function (p) {
    assert.ok(hasClass(p, 'bk__page'), 'every appendix page is a book page');
  });
  // It sits after the planning pages and before the closing one, which is what makes
  // it skippable without the route pages moving.
  const order = main.children.map(function (n) { return n.id; });
  assert.ok(order.indexOf('bk-research') > order.indexOf('bk-planning'));
  assert.ok(order.indexOf('bk-research') < order.indexOf('bk-fork'));
});

test('the closing observation about the decaying archive survives onto the page', async function () {
  // It is the argument for this booklet existing: the threads that still read today
  // are the ones whose authors self-hosted their images.
  const { main } = await render();
  assert.match(main.textContent, /Photobucket and Picasa links in the older threads are dead/);
  assert.match(main.textContent, /self-hosted their images/);
});

test('the sourcing line names the board, the crawl and the date it was crawled', async function () {
  const { byId } = await render();
  const text = byId['bk-provenance'].textContent;
  assert.match(text, /The Tourer/);
  assert.match(text, /337 index pages/);
  assert.match(text, /3,317 travelogue threads/);
  assert.match(text, /14 pan-India ride reports/);
  assert.match(text, /5 August 2026/);
});

test('the planning pages are blank to write on, not pre-filled with advice', async function () {
  const { byId } = await render();
  const log = rowsOf(byId['bk-log']);
  assert.strictEqual(log.length, 25);                    // one head row, 24 blanks
  log.slice(1).forEach(function (r) {
    assert.deepStrictEqual(r, ['', '', '', '', '', '', '']);
  });
  const boxes = byId['bk-check'].children;
  assert.ok(boxes.length >= 8);
  boxes.forEach(function (b) {
    // A heading and ruled space under it — a heading with items listed under it would
    // be this book telling a rider what to carry, which it is in no position to do.
    assert.strictEqual(b.children[0].tagName, 'h4');
    assert.ok(b.children[0].textContent.length > 0);
    assert.strictEqual(b.children[1].textContent, '');
  });
});
