const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SEO = require(path.join(ROOT, 'build-seo.cjs'));

function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }
function json(f) { return JSON.parse(read(f)); }

const TEMPLATE = json('template.json');
const ROUTE = json('route.json');
const NOTES = json('template-notes.json');
const RESEARCH = json('research.json');

/*
 * build-seo.cjs writes four things that a reader never sees and a crawler reads first:
 * robots.txt, sitemap.xml, llms.txt, and the schema.org block inside each page. Every
 * figure in them is derived from the data files, which is the only thing that makes it
 * safe to bake distances into markup at all.
 *
 * Derived is worth nothing if nobody re-derives it. These tests are what turns "run the
 * generator" from a habit into a build failure: they rebuild each artefact from the
 * data on disk and require the committed copy to match, so a rebuilt sheet that never
 * reached the crawler-facing files cannot ship.
 *
 * If one of these fails, the fix is `node build-seo.cjs`, not an edit to the artefact.
 */

test('robots.txt on disk is what the generator writes', function () {
  assert.strictEqual(read('robots.txt'), SEO.robots(),
    'stale robots.txt: run node build-seo.cjs');
});

test('robots.txt allows everything, names the AI crawlers, and declares the sitemap', function () {
  // The whole point of publishing this material is that it gets quoted. A Disallow
  // creeping in here would be the one change that silently undoes it.
  const txt = read('robots.txt');
  assert.doesNotMatch(txt, /^Disallow:\s*\/\s*$/m, 'something is being blocked');
  assert.match(txt, /^User-agent: \*$/m);
  assert.match(txt, /^Sitemap: https:\/\/[^\s]+\/sitemap\.xml$/m);

  // A handful of the tokens, spot-checked by name. The full list is in build-seo.cjs;
  // these four are the ones whose absence would matter most and are easiest to lose in
  // a hand edit.
  ['GPTBot', 'ClaudeBot', 'PerplexityBot', 'Google-Extended'].forEach(function (a) {
    assert.match(txt, new RegExp('^User-agent: ' + a + '$', 'm'), a + ' is not named');
  });
});

test('every file the sitemap and llms.txt point at actually exists', function () {
  // The failure this catches is a data file being renamed: the pages would keep
  // working, because they name their own fetch targets, and only the crawler-facing
  // files would be left pointing at a 404.
  const sitemap = read('sitemap.xml');
  SEO.DATA_FILES.forEach(function (f) {
    assert.ok(fs.existsSync(path.join(ROOT, f[0])), f[0] + ' is advertised but missing');
    assert.ok(sitemap.indexOf(SEO.BASE + '/' + f[0]) >= 0, f[0] + ' is not in the sitemap');
    assert.ok(read('llms.txt').indexOf('/' + f[0] + ')') >= 0, f[0] + ' is not in llms.txt');
  });
  assert.ok(sitemap.indexOf('<loc>' + SEO.BASE + '/</loc>') >= 0);
  assert.ok(sitemap.indexOf('<loc>' + SEO.BASE + '/booklet.html</loc>') >= 0);
});

test('llms.txt carries the current figures', function () {
  // Compared whole rather than sampled. Every number in it comes from the data files,
  // so any drift at all is a rebuild that did not happen.
  assert.strictEqual(read('llms.txt'), SEO.llms(TEMPLATE, ROUTE, NOTES, RESEARCH),
    'stale llms.txt: run node build-seo.cjs');
});

test('llms.txt states the gaps rather than only the figures', function () {
  // A summary of this material that carried the distances and dropped the caveats
  // would be worse than no summary: it is guidance a rider acts on. The unwritten-note
  // count is derived, so writing one of them moves this number.
  const txt = read('llms.txt');
  assert.match(txt, new RegExp('\\b' + SEO.countGaps(NOTES) + ' guidance'));
  assert.match(txt, /floor, not a forecast/);
  assert.match(txt, /Check the current rules before you ride/);
  assert.match(txt, /keyword-derived/);
});

function embedded(file) {
  const html = read(file);
  const a = html.indexOf(SEO.BEGIN);
  assert.ok(a >= 0, file + ' has no ld+json block: run node build-seo.cjs');
  const b = html.indexOf(SEO.END, a);
  assert.ok(b >= 0, file + ': the ld+json block was opened and never closed');
  const block = html.slice(a, b);
  const open = block.indexOf('>', block.indexOf('<script')) + 1;
  const close = block.indexOf('</script>');
  return block.slice(open, close).trim();
}

test('the ld+json in index.html matches what the data files say today', function () {
  assert.strictEqual(embedded('index.html'),
    JSON.stringify(SEO.indexGraph(TEMPLATE, ROUTE), null, 1),
    'stale ld+json in index.html: run node build-seo.cjs');
});

test('the ld+json in booklet.html matches what the data files say today', function () {
  assert.strictEqual(embedded('booklet.html'),
    JSON.stringify(SEO.bookletGraph(TEMPLATE, ROUTE, NOTES), null, 1),
    'stale ld+json in booklet.html: run node build-seo.cjs');
});

test('both graphs describe one trip and one dataset, not two of each', function () {
  // Two pages, one subject. If each page minted its own @id for the loop, a consumer
  // merging the graphs would come away believing there are two rides.
  const idx = JSON.parse(embedded('index.html'));
  const bk = JSON.parse(embedded('booklet.html'));

  const byType = function (g, t) {
    return g['@graph'].filter(function (n) { return n['@type'] === t; })[0];
  };
  assert.strictEqual(byType(idx, 'TouristTrip')['@id'], byType(bk, 'TouristTrip')['@id']);
  assert.strictEqual(byType(idx, 'Dataset')['@id'], byType(bk, 'Dataset')['@id']);
  assert.strictEqual(byType(idx, 'Person')['@id'], byType(bk, 'Person')['@id']);

  // And the book points at the loop rather than restating it.
  assert.strictEqual(byType(bk, 'TechArticle').about['@id'], byType(idx, 'TouristTrip')['@id']);
});

test('the graph distance is the template total, and every sector is in the itinerary', function () {
  const idx = JSON.parse(embedded('index.html'));
  const trip = idx['@graph'].filter(function (n) { return n['@type'] === 'TouristTrip'; })[0];
  const km = TEMPLATE.totals.km.toLocaleString('en-IN');

  assert.strictEqual(trip.distance.name, km + ' km');
  assert.strictEqual(trip.itinerary.numberOfItems, TEMPLATE.sectors.length);
  TEMPLATE.sectors.forEach(function (s, i) {
    const item = trip.itinerary.itemListElement[i].item;
    assert.strictEqual(item.name, s.id + ': ' + s.title);
    assert.strictEqual(item.distance.name, s.km.toLocaleString('en-IN') + ' km');
    assert.strictEqual(item.itinerary[0].name, s.from);
    assert.strictEqual(item.itinerary[1].name, s.to);
  });
});

test('the book graph admits the unwritten notes', function () {
  // The page shows a reader a dashed box. A crawler summarising the page gets the same
  // fact in a field it can read, for the same reason: this material is acted on.
  const bk = JSON.parse(embedded('booklet.html'));
  const art = bk['@graph'].filter(function (n) { return n['@type'] === 'TechArticle'; })[0];
  assert.match(art.disambiguatingDescription,
    new RegExp('^' + SEO.countGaps(NOTES) + ' guidance entries'));
});
