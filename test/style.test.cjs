const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// U+2014. Written as an escape on purpose: this file is itself in scope, and a
// literal one here would make the guard fail on its own source.
const EM = '\u2014';

/*
 * The house rule is that no em dash appears anywhere in this repo. It has been
 * broken three times by three different hands after the rule was set, each time in
 * a file no scoped test was watching, so the guard is repo-wide rather than a list
 * of the files that happened to be wrong last time. Anything tracked is in scope.
 *
 * Not in scope:
 *   docs/superpowers/**  planning documents, never served to a reader
 *   .superpowers/**      scratch, gitignored
 * Binary files are skipped by extension and by a NUL-byte check.
 */
const SKIP_DIRS = ['docs/superpowers/', '.superpowers/'];
const BINARY_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.mp4', '.mov',
  '.woff', '.woff2', '.ttf', '.otf', '.pdf', '.zip'];

/*
 * The exceptions, and why each one is other people's writing rather than ours.
 *
 * research.json carries five forum thread titles quoted verbatim inside curly
 * quotes and attributed by name. They are citations: a reader who searches xBhp for
 * one of these strings has to find the thread. Restyling somebody else's title to
 * suit our punctuation would misquote the source, so these five survive exactly as
 * posted. Everything around them, which is the site author's own narration, was
 * rewritten. Note this is an exact-string list, not a whole-file pass: a new em dash
 * anywhere else in research.json still fails.
 */
const QUOTED_THREAD_TITLES = [
  '“Tour log ' + EM + ' 2 guys, 2 bikes, 3 countries, 18,612 kms, 64 days”',
  '“Amazingly magnificent & enchantingly awesome North East India ' + EM + ' A 10,000 km Ride!”',
  '“1624.6 kms in 23 hrs 35 mins ' + EM + ' Saddle Sore cracked successfully in first attempt”',
  '“Project: Solo Wheels ' + EM + ' 32,000 Kms | 150 Days | 3 Countries | 1 Rider”',
  '“Trip Of A Lifetime ' + EM + ' My All India Motorcycle Tour”',
];

/*
 * manifest.json and tags.json hold Instagram captions copied verbatim out of a data
 * export by tag-media.cjs and generate-manifest.cjs. They are a record of what was
 * actually posted, and both files are rewritten from the export whenever those
 * scripts run, so an edit here would be both a falsified record and a change that
 * does not survive the next regeneration. The em dashes are therefore allowed, but
 * only inside a "caption" value: any other line in either file is in scope.
 */
const CAPTION_ONLY = ['manifest.json', 'tags.json'];

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

function inScope(file) {
  if (SKIP_DIRS.some(function (d) { return file.indexOf(d) === 0; })) return false;
  return BINARY_EXT.indexOf(path.extname(file).toLowerCase()) < 0;
}

// Line number and a short window around the offence, so a failure names the file
// AND points at the sentence, rather than saying only that a count was not zero.
function offences(file, text) {
  const found = [];
  text.split('\n').forEach(function (line, i) {
    if (line.indexOf(EM) < 0) return;
    if (CAPTION_ONLY.indexOf(file) >= 0 && /^\s*"caption":/.test(line)) return;
    const at = line.indexOf(EM);
    found.push(file + ':' + (i + 1) + '  ' +
      line.slice(Math.max(0, at - 40), at + 40).trim());
  });
  return found;
}

test('no tracked file carries an em dash', function () {
  const bad = [];
  trackedFiles().filter(inScope).forEach(function (file) {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, file), 'utf8');
    } catch (e) {
      return;                                   // unreadable is not a style problem
    }
    if (text.indexOf('\u0000') >= 0) return;    // binary that slipped the extension list
    if (file === 'research.json') {
      QUOTED_THREAD_TITLES.forEach(function (t) {
        assert.ok(text.indexOf(t) >= 0,
          'the exception list names a thread title research.json no longer contains: ' + t);
        text = text.split(t).join('');
      });
    }
    Array.prototype.push.apply(bad, offences(file, text));
  });
  assert.deepStrictEqual(bad, [],
    'em dashes found in ' + bad.length + ' place(s):\n  ' + bad.join('\n  '));
});

/*
 * The en dash is a different character doing a different job: a numeric range
 * (6,000–11,000 km, ₹100–200), a date range (23 Jan – 27 Mar) or a route join
 * (Kolhapur–Belgaum). Sweeping em dashes must never take these with them, and a
 * regex written against the wrong code point silently would.
 *
 * This used to assert three hardcoded literals, which meant 36 of research.json's
 * 38 en dashes could be flattened to hyphens with the suite still green. It is
 * pinned against the real content now: every distinct en-dash-joined token in the
 * two files that carry any. Converting ANY one of them fails here.
 *
 * The list moves when the content legitimately does, and that is the point: these
 * are transcriptions of somebody else's writing, so a range changing shape should
 * cost somebody a deliberate look rather than passing unnoticed.
 */
function enDashTokens(text) {
  // Collapse the spaced form ("23 Jan – 27 Mar") onto the tight one so both kinds of
  // range extract as a single token, then trim the JSON and sentence punctuation
  // that happens to sit at either end.
  const tight = text.replace(/\s*–\s*/g, '–');
  const found = tight.match(/[^\s"]*–[^\s"]*/g) || [];
  const seen = {};
  found.forEach(function (t) {
    seen[t.replace(/^[^\w₹]+/, '').replace(/[^\w]+$/, '')] = true;
  });
  return Object.keys(seen).sort();
}

test('every en dash in the transcribed files survives, character for character', function () {
  const research = fs.readFileSync(path.join(ROOT, 'research.json'), 'utf8');
  const notes = fs.readFileSync(path.join(ROOT, 'template-notes.json'), 'utf8');

  assert.deepStrictEqual(enDashTokens(research), [
    '0–2',
    '13–15',
    '2014–15',
    '28–29',
    '3–4',
    '5–28',
    '6,000–10,000',
    '6,000–11,000',
    '6–8',
    '7,000–8,500',
    'April–May',
    'Bangalore–Kanyakumari–Khardung',
    'Belgaum–Dharwad',
    'Chennai–Mumbai',
    'Delhi–Kolkata',
    'Delhi–Mumbai',
    'Hubli–Davangere',
    'II–IV',
    'Jan–27',
    'Kanyakumari–Kashmir',
    'Kolhapur–Belgaum',
    'Kolkata–Chennai',
    'La–Pangong–Bangalore',
    'Mumbai–Chennai–Kolkata–Delhi–Mumbai',
    'November–16',
    'Sept–14',
    'xBhp–Sundeep',
    '₹100–200',
    '₹2,000–2,200',
  ]);

  assert.deepStrictEqual(enDashTokens(notes), ['₹100–200']);
});
