# Working on this

Tests, house style, and how to run the thing locally. Back to the
[README](../README.md).

## Tests

```
node --test
```

Bare. **No path argument and no glob.** `node --test test/` fails on Node 22.23 with
`Cannot find module .../test`, because a directory argument is resolved as a module
path rather than as a place to look for tests.

108 tests, zero dependencies, Node's built-in runner. They cover the generator's CSV
parsing and sector derivation, the atlas's projection and clustering, the cost
projection, the K2K build, the overview, the route book (rendered headless under
`node:vm` against the real page source, stub DOM and stub `fetch`), the crawler-facing
files, and the house style. The UI itself has no automated coverage; the per-task
checklists in the plan are the record of what to walk through by hand.

Most of them are ordinary assertions about behaviour. A handful are **staleness
guards**, and they are the ones worth knowing about before you edit a file by hand,
because their failure message is not the fix:

| If this fails | The fix |
|---|---|
| `test/seo.test.cjs` | Run `node scripts/build-seo.cjs`. Every artefact it checks is generated; editing the artefact makes the next rebuild fight you. |
| the unwritten-notes count in `test/booklet.test.cjs` | Nothing, if you just wrote one of the notes. Update the pinned number in the same commit, so filling a gap is a deliberate act with a visible diff. |
| `test/style.test.cjs` | Replace the em dash. Repo-wide, and it prints the file, the line and the sentence. |


## House style

Browser files (`index.html`, `booklet.html`, `atlas.js`, `costs.js`) are ES5-flavoured:
`var` and `function () {}`, no arrow functions, no template literals, no optional
chaining. `.cjs` build scripts are under no such constraint and use modern syntax
freely.

**No em dashes anywhere.** `test/style.test.cjs` walks `git ls-files`, skips binaries,
and fails the build on any U+2014 with the file, the line and the surrounding sentence.
It is repo-wide rather than a list of the files that were wrong last time, because the
rule had already been broken three times by three different hands in files no scoped
test was watching.

Three exemptions, matching `SKIP_DIRS`, `QUOTED_THREAD_TITLES` and `CAPTION_ONLY` in
that file. The first is ours; the other two are somebody else's text:

- **Two directories**, skipped whole: `docs/superpowers/**`, the planning documents,
  which are never served to a reader; and `.superpowers/**`, gitignored scratch. Both
  are in `SKIP_DIRS`. Nothing else is skipped by path.
- **Five xBhp thread titles** in `research.json`'s reference list, quoted verbatim
  inside curly quotes and attributed by name. They are citations: a reader searching
  xBhp for one of these strings has to find the thread, and restyling somebody's title
  to suit our punctuation misquotes the source. This is an exact-string list, not a
  whole-file pass, so a new em dash anywhere else in `research.json` still fails.
- **Instagram captions** in `manifest.json` and `tags.json`, copied verbatim out of
  the data export. Both files are rewritten from the export every time `tag-media.cjs`
  and `generate-manifest.cjs` run, so an edit would be both a falsified record and a
  change that does not survive the next regeneration. The exemption is scoped to
  `"caption"` lines only; any other line in either file is in scope. If these ever do
  need sweeping, the fix belongs in the generators, not in the JSON.

The en dash is a different character doing a different job: a numeric range
(6,000–11,000 km, ₹100–200), a date range (23 Jan – 27 Mar), a route join
(Kolhapur–Belgaum). A sweep written against the wrong code point would silently take
those too, so a separate test pins every distinct en-dash-joined token in
`research.json` and `template-notes.json` and fails if any one of them is flattened.
The list moves when the transcription legitimately does, which is deliberate: these
are somebody else's words, so a range changing shape should cost a look.

Three ranges have since left `research.json` (6,000–11,000 km, ₹100–200 and
₹2,000–2,200), each of them a second printing of a figure whose canonical home is
elsewhere. Losing that home would take the range off the page entirely and the pinned
list can no longer catch it, so a second test asserts each one at the file it now
lives in: `k2k.json`, `template-notes.json` and `research.json`'s benchmark block.


## Local development

`index.html` fetches `manifest.json`, which browsers block over `file://`. Serve the
folder instead:

```
python3 -m http.server 8899   # then open http://127.0.0.1:8899/
```
