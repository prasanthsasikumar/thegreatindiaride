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

  // And the map's planned line is already guarded the same way, at its own call site.
  assert.match(PAGE, /if \(template && template\.hops\.length\) \{/);
});

test('the planned-route toggle is still explained somewhere a reader will look', function () {
  // The sentence that explained it lived in the section that was removed. It sits
  // under the map now, beside the button it describes.
  const note = cut('<p class="map__note">', '</p>');
  assert.match(note, /<strong>Planned route<\/strong>/);
  assert.match(note, /dashed/);
  assert.match(note, /actually ridden/);
});

test('K2K survives the cut it used to be nested inside', function () {
  // #tpl-k2k was a child of the template section, so removing that section by hand
  // would have taken K2K with it. It is a sibling now, and the boot calls its
  // renderer directly because renderTemplate, which used to, is gone. Nothing else on
  // the page would notice that call going missing: the section would simply never be
  // shown and every other assertion in the suite would still pass.
  assert.match(PAGE, /<section class="tpl" id="tpl-k2k" hidden>/);
  assert.match(PAGE, /renderRouteBook\(\);\s*\n\s*renderK2k\(\);/);
});
