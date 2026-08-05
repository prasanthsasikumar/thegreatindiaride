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
  // permit. Count the gaps: one season block per sector, both calendar columns per
  // sector, planned-vs-ridden, and sourcing.
  const { main } = await render();
  const gaps = main.collect(function (n) { return hasClass(n, 'bk__todo'); });
  const sectors = TEMPLATE.sectors.length;
  assert.strictEqual(gaps.length, sectors * 3 + 2);
  gaps.forEach(function (g) { assert.match(g.textContent, /^Not written yet/); });
  // And nothing anywhere on the page leaked the raw placeholder text.
  assert.doesNotMatch(main.textContent, /TO WRITE/);
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
  });
});

test('every leg of the template appears exactly once across the waypoint tables', async function () {
  const { main } = await render();
  const tables = main.collect(function (n) { return hasClass(n, 'bk__hops'); });
  const legs = tables.reduce(function (a, t) { return a + rowsOf(t).length - 1; }, 0);
  assert.strictEqual(legs, TEMPLATE.totals.hops);
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
