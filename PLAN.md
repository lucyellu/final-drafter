# Final Drafter — work plan

Eleven asks, grouped so that shared groundwork gets built once. This is the
ordering argument; see **Progress** below for what's actually landed.

File references are `empty.html:LINE` against the current `main` (dafabe1) —
line numbers have since shifted as work landed; treat them as historical.

---

## Progress (as of 2026-08-17)

Rows 1–5 of the suggested order are done and merged to `main`, with 142
automated tests in `scripts/test-variations.mjs` covering all of it (0
failures, no console errors).

**Shipped:**
- **Localhost launcher.** `scripts/serve.js` (static file server, port-retry,
  20-min idle auto-shutdown) + `scripts/launch.ps1` (finds Chrome, reuses an
  already-running server, falls back to `file://` if Node is missing).
  `launch-final-drafter.bat` now delegates to it. The app runs over
  `http://127.0.0.1:PORT` instead of `file://`.
- **F1 — settings store.** `settings` object, localStorage-backed, applied
  once at boot via `applySettings()`. Zoom, scene-number mode, and "reuse
  last insertion" now survive a restart.
- **Item 9 — Dialogue button** moved next to Character.
- **Item 2 — Document Statistics** relabelled: Scenes / Locations (distinct)
  / Characters (distinct) / Dialogue cues / Transitions (new), instead of
  the old mislabelled Locations/Characters pair.
- **Item 1 — Insertion focus box.** Outline-only `.insertion-focus`, clears
  on blur, excluded from print and from saved block types.
- **Item 10 — Remembered insertions.** Scene-heading/character/parenthetical/
  transition remember what was last typed over their example; dialogue/
  action always start fresh. Gated by the "Reuse last insertion" setting.
- **F2 — page furniture layer.** Six addressable slots per page
  (header/footer × left/center/right), replacing the single
  `.page-number-label`. Consolidated the six duplicated `getBlocks()`
  exclusion selectors into one `FURNITURE_CLASS`/`NON_FURNITURE_SELECTOR`
  pair. Layout-neutral by construction (`position:absolute`, zero flow
  height) — verified by an automated test that stuffing every slot doesn't
  move a block or change the page count.
- **Item 3 — Headers & footers.** Six free-text token templates
  (`{page}` `{pages}` `{title}` `{author}` `{date}` `{draft}` `{scene}`),
  editable in Settings. Document-level: stored on `appState.furniture`
  (rides in the project file as `lists`, same mechanism as item 10's
  remembered insertions) rather than in app-level `settings`, since F3
  (a dedicated document-settings block in the file format) doesn't exist
  yet.
- **Item 4 — Page numbers.** Full preset: show/off, position (any of the
  6 slots — claims that slot, overriding a manual template there), format
  (4 presets), bold, start-at, skip-title-page. Decoupled from the old
  "Show Visual Page Breaks" checkbox (which did nothing else) and removed
  from the print-hide list, so page numbers now actually appear in the
  exported PDF.
- **Settings modal fixed.** It had no `max-height`/scroll, so content ran
  off both the top and bottom of the window with no way to reach the close
  button. Now `max-height: 85vh; overflow-y: auto` with a sticky header.
  Reordered so actual controls (Layout, Headers/Footers/Page Numbers) come
  first; the long prose "Instructions" block is now collapsed by default
  (same collapsible pattern as the sidebar sections) instead of pushing
  every control below the fold.

**Known gap carried forward:** `skip title page` (item 4) is a blanket
"blank every furniture slot on frame index 0" — there's no real title-page
detection yet, because that's item 8a (`data-role="title"`, Phase 5). A
script with no title page will have a blank, unnumbered page 1 by default
until 8a lands. Flagged in the item 3/8a sections below; not a bug, just
the interim tradeoff the original plan called for.

**Not started:** F3 (format v3), Phase 3 (autosave/version history, split
Open Project/Import Script), Phase 4 (OCR), Phase 5 (Fountain, doc types,
structured title page, show bibles), item 11 (Navigator third level).

---

## 0. Three questions answered first

### "Should we differentiate Load Script from Load Project?"

**Yes.** They are different operations that only look alike because both end in
"a script is on screen."

- **Open Project** (`.fdproj`, JSON inside) is *restore*. It is lossless and it
  replaces the session: script, variation stacks, character/location lists,
  layout settings, header/footer template, version history, the source-PDF link.
- **Import Script** (`.pdf` / `.txt` / `.md` / `.fountain`) is *conversion*. It is
  lossy by nature, it can fail (see the OCR item), and it deserves to be able to
  land **into** the open project — importing a scene batch without nuking the
  drafts you have stacked up.

Today both go through one `<input accept=".json,.md,.txt,.pdf">`
(`empty.html:1111`) into one `loadFile()` (`empty.html:4683`), which is why the
distinction is invisible. Splitting them also lets Open Project's picker filter
to one extension, and lets Import show a preview/confirm step.

Recommended File menu after this work:

```
New
Open Project…            .fdproj
Import Script…           .pdf .txt .md .fountain
Recent ▸
Save            Ctrl+S
Save As…
Version History…
Export ▸         PDF / Fountain / Markdown / Text
```

Renaming the save extension `.json` → `.fdproj` (same JSON payload) is a
one-line change that makes Windows file association and the picker filter both
work. Keep reading `.json` forever.

### "Is Exact View vs Editable really only the cover page?"

Not only — but you're seeing the biggest one. Exact View is a raster of the
original PDF; Editable is a **reconstruction** from the text layer. On a clean,
modern, text-based spec script they converge closely, so what's left over is
whatever the reconstruction throws away:

| Lives in Exact, missing from Editable | Why |
| --- | --- |
| Title / cover page layout | `classifyPdfLines` flattens it to `center-title` blocks (`empty.html:4428`, `4457`) — every line becomes one centred string, losing which line was title vs author vs contact |
| Page headers & footers, page numbers | Never parsed; there is no furniture layer to hold them |
| Revision marks, coloured-page marks | Same |
| `CONTINUED:` / `(MORE)` / `(CONT'D)` page furniture | Stripped as noise |
| Dual-column dialogue | Classifier is single-column |
| Scene numbers in the margins | Only synthesised, never read from source |
| Hard line breaks inside a speech | Reflowed away by design |
| Any image, logo, or stamp | Canvas-only |

Items 3 and 4 below close the two biggest rows of that table. Item 8 closes the
first one.

### "Overleaf/markdown-style markup for cover page, title, author — too complicated?"

**Not too complicated, if you don't invent a language.** The screenplay world
already has the markdown you're describing: **Fountain**. It has a key/value
title page (`Title:`, `Credit:`, `Author:`, `Draft date:`, `Contact:`), forced
scene headings (`.`), centred text (`> <`), transitions (`>`), page breaks
(`===`), sections (`#`, `##`) and synopses (`=`). It round-trips, other tools
read it, and it maps almost 1:1 onto the block types already in this app.

So: adopt Fountain as the plain-text source-of-truth format rather than the
current lossy `exportMD()` (`empty.html:4514`), and extend it with a small,
documented superset for show-bible constructs (table of contents, tables) that
Fountain has no opinion on. That's the pragmatic version of the Overleaf idea.

Details in item 8.

---

## Cross-cutting prerequisite: stop running on `file://`

`launch-final-drafter.bat` opens `file:///…/empty.html` in Chrome app mode. On
an opaque `file://` origin Chrome blocks Web Workers, blocks WASM
instantiation from another origin, and gives unreliable IndexedDB. That is a
hard wall in front of **two** items below:

- **OCR (7)** — tesseract.js is worker + WASM. It will not start.
- **Autosave/versioning (5)** — snapshots are far too big for `localStorage`'s
  ~5 MB; they want IndexedDB.

Fix: have the launcher start a tiny static server and open
`http://127.0.0.1:PORT/empty.html`. Twenty lines of Node (already a dependency)
or `python -m http.server`, plus a port-in-use retry, plus shutting down when
the window closes. Everything else in the app is unaffected — same single HTML
file.

**Do this before Phase 3.** It is the cheapest unblock in the whole list.

---

## Foundations (build once, four items depend on them)

### F1 — A real settings store  ·  S

There is none. Zoom, page breaks and scene-number mode live only in DOM state
and reset on every launch. Items 4, 5, 8 and 10 all need persisted, typed,
defaulted settings.

- One `FD.settings` object with a defaults table and a schema version.
- Persist to `localStorage` (settings are tiny; only *snapshots* need IndexedDB).
- Split **app settings** (autosave interval, remember-last-insertion toggle)
  from **document settings** (header/footer template, page-number format, doc
  type) — document settings ride in the project file so a script carries its own
  layout, app settings don't.
- `applySettings()` called once at boot and after every modal change; the modal
  stops calling `togglePageBreaks()` etc. directly.
- Free win: zoom and page-breaks finally survive a restart.

### F2 — A page-furniture layer  ·  M

Generalise the one existing `.page-number-label` (`empty.html:552`, created in
`createPageFrame()` at `2119`, filled by `relabelFrames()` at `2129`) into six
addressable slots per page — header L/C/R and footer L/C/R.

Three constraints, all already established in the codebase:

1. **Layout-neutral or `reflowPages()` breaks.** The CSS file already carries
   this warning for variation stacks (`empty.html:565-571`). Furniture must be
   `position:absolute` inside the frame's existing 1in top/bottom padding,
   `contentEditable=false`, contributing zero flow height — exactly what
   `.page-number-label` already does. No borders, no margins, no padding on
   anything in the flow.
2. **`getBlocks()` must not see it.** It currently filters
   `*:not(.page-number-label)` (`empty.html:2083`, and again at `2088`, `2092`,
   `2098`, `2101`, `4938`). Change every one of those to a general
   `:not(.page-furniture)` class before adding slots, or six new divs per page
   will be treated as script blocks and get reflowed, counted, exported and
   saved.
3. **Print CSS currently hides page numbers.** `.page-number-label` is in the
   `display:none` list at `empty.html:987`. Furniture that exists to be printed
   must come off that list.

Render furniture from a token template — `{page}`, `{pages}`, `{title}`,
`{author}`, `{date}`, `{draft}`, `{scene}` — resolved at the end of
`reflowPages()`, because `{pages}` isn't known until pagination settles.

### F3 — Project file format v3  ·  S

`scriptJSON()` (`empty.html:4551`) writes `formatVersion: 2` with
`{script, stacks, lists}`. v3 adds:

```jsonc
{
  "formatVersion": 3,
  "meta":     { "title": "", "author": "", "docType": "screenplay", "created": "", "modified": "" },
  "settings": { "pageNumber": {…}, "header": {…}, "footer": {…} },
  "script":   [ … ],
  "stacks":   { … },
  "lists":    { … },
  "history":  [ … ]      // see item 5
}
```

Write v3, read v2 and v3. The loader needs a migration branch, not a rewrite —
v2 files become v3 with default meta/settings and an empty history.

---

## Phase 1 — Fast, independent, ship together  ·  ~half a day

### 9. Move Dialogue next to Character  ·  XS

`empty.html:1122-1127` — reorder the two `<button>` lines to
`Scene Heading · Action · Character · Dialogue · Parenthetical · Transition`.
`setupFormatButtons()` (`empty.html:2049`) binds by `data-type`, so order is
free — just confirm nothing indexes the toolbar positionally.

### 2. Scenes and transitions in Document Statistics  ·  S

Worth knowing before you touch it: **the two existing counters are mislabelled.**
`updateStatistics()` (`empty.html:1697`) does

```js
if (child.classList.contains('scene-heading')) locations++;   // ← this is the SCENE count
if (child.classList.contains('character'))     characters++;  // ← this is the DIALOGUE CUE count
```

so "Locations: 47" means 47 scene headings, not 47 distinct locations, and
"Characters: 312" means 312 speech cues, not 312 people. The genuine distinct
counts already exist — `extractEntities()` fills `appState.characters` and
`appState.locations` for the right-hand sidebar. Proposed panel:

```
Pages          120
Scenes          47      ← was mislabelled "Locations"
Locations       19      ← appState.locations.length (distinct)
Characters      12      ← appState.characters.length (distinct)
Dialogue cues  312      ← was mislabelled "Characters"
Transitions     23      ← new
Words       21,904
Letters    108,332
Est. Runtime  2 hr 0 min
```

One extra counter in the existing loop, plus new `<div class="stat-row">`s at
`empty.html:1165-1170`.

### 1. Insertion focus box  ·  S

`insertExampleBlock()` already ends with `selectBlockText(block)`
(`empty.html:1953`). Add `markInsertion(block)` beside it.

- Style with `outline: 2px solid <accent>; outline-offset: 2px;` — **never**
  `border` or `padding`; both would re-paginate the script (see F2 constraint 1).
- Clear it in the existing `selectionchange` listener (`empty.html:1846`) when
  the caret leaves the marked block, and unconditionally at the top of the next
  insert. Both exit conditions you asked for, one handler.
- Add the class to the `@media print` hide list.
- Suggested extension: mark the result of a *conversion* too
  (`convertRangeTo()`, `empty.html:1918`) — same "what did I just do?" problem,
  and the box is more useful there since converting a multi-line selection has
  no cursor to follow.

**Build this together with item 10** — the blur transition that clears the box
is exactly the event that should record what the user typed over the example.

---

## Phase 2 — Page furniture  ·  ~1–2 days  ·  needs F1, F2

### 3. Headers and footers  ·  M

Six slots per page from F2, each holding a token template edited in Settings.
Defaults: everything empty except footer-right.

Design calls worth making explicitly:

- Furniture is **document-level, not per-page** — one template, rendered onto
  every page. Per-page overrides are a rabbit hole; skip them.
- The title page must be exempt. That needs `data-role="title"` on the first
  frame, which is really item 8a — so either do 8a first, or ship with a
  "skip first page" boolean and upgrade later.
- Furniture is not in `getBlocks()`, so it is invisible to word counts, export,
  variation stacks and save. That is correct: it's layout, not script.

### 4. Page numbers  ·  S once 3 exists

A preset over item 3's token system, plus Settings UI:

| Setting | Options | Default |
| --- | --- | --- |
| Show page numbers | on / off | **on** |
| Position | header/footer × left/centre/right | **footer right** |
| Format | `1` · `1.` · `1 / 27` · `Page 1 of 27` | `1 / 27` |
| Bold | on / off | **on** |
| Start at | page N | 1 |
| Skip title page | on / off | on |

Also decouple page numbers from the **Show Visual Page Breaks** checkbox — they
share a class today (`empty.html:562`), which is why numbers vanish when breaks
are off. And remove the print-hide (F2 constraint 3), or they still won't appear
in the exported PDF, which is the one place a page number matters most.

---

## Phase 3 — Persistence  ·  ~2–3 days  ·  needs F1, F3, localhost server

### 5. Autosave and version history  ·  L

These are two features and should stay visibly separate:

**(a) Autosave — crash protection.**
Timer every N minutes (Settings, default 10, options 1/2/5/10/30/off) plus a
flush on `visibilitychange` and `beforeunload`. Writes one *current* snapshot to
IndexedDB keyed by project id. On boot, if a snapshot is newer than the file on
disk, offer **Recover unsaved changes**.

> **Decision for you:** should autosave also write through to the real `.fdproj`
> when `currentFileHandle` is set (`empty.html:4580`)? It's convenient but it
> silently overwrites your file, and it makes "undo by not saving" impossible.
> My recommendation: **no** — autosave stays local, explicit Save stays the only
> thing that touches your disk, and the status bar shows "autosaved 2 min ago ·
> unsaved changes since last Save".

**(b) Version history — iteration.**
Every autosave tick that has actual changes appends `{ts, label, json}` to a
history list. UI: **File ▸ Version History…** with a timestamped list, a preview
pane, **Restore**, and **Name this version…** for milestones. Full snapshots
rather than deltas — a 120-page script is ~300 KB of JSON; cap at ~50 automatic
entries (ring buffer) and keep all named ones forever.

**Naming matters here.** The app already has a "drafts/variations" concept —
per-scene content alternates, stacked, ranked, `S004.D002`. Whole-document
time-snapshots are a different axis and must not be called drafts. Suggest
**Drafts** (existing, per scene) vs **History / Snapshots** (new, whole
document). Say so in the Settings copy too.

### 6. Split Open Project / Import Script  ·  M

Per section 0 above. Concretely:

- Two file inputs replacing `empty.html:1111`; `loadFile()` (`4683`) splits into
  `openProject()` and `importScript()`, sharing the PDF/text parsing tail.
- Import gets an "into: new project / current project" choice.
- `.fdproj` extension for save; `.json` still opens.
- A **Recent** list (paths via the File System Access handles already being
  kept at `empty.html:4578`, so reopening is one click).

---

## Phase 4 — OCR  ·  ~2 days  ·  needs localhost server

### 7. Built-in OCR for image-only PDFs  ·  L

Replaces the dead-end notice at `empty.html:4730` with a **Run OCR on this PDF**
button.

The design that makes this cheap: **OCR should emit the same line objects the
text layer emits.** `extractPdfPageLines(page, i)` produces positioned lines
that `classifyPdfLines()` turns into blocks (`empty.html:4269+`). If the OCR path
returns that same `{x, y, text, page}` shape, then classification, entity
extraction, the Navigator, stats, stacks and export all work with zero changes.

Pipeline per page: render to canvas at ~300 DPI (the Exact View render already
produces canvases — reuse them rather than rendering twice) → `tesseract.js`
`recognize()` → group returned words into lines by baseline → hand to the
existing classifier.

Practical notes:

- tesseract.js from CDN, **lazy-loaded on first use only** — ~2 MB core plus
  ~15 MB English traineddata. Don't put that in the boot path.
- 5–15 s per page. Needs a progress bar, a page counter, and a **Cancel**.
- Store the OCR output in the project so it never re-runs on the same file.
- Accuracy on Courier scans is good, but expect a cleanup pass: ALL-CAPS scene
  headings, `(parentheticals)`, and `0`/`O`, `1`/`l`, `I` confusions. Budget for
  a post-OCR normaliser keyed on screenplay conventions — it can be simple and
  still fix most of it.

---

## Phase 5 — Semantic document model  ·  ~1 week  ·  the big one

### 8. Doc types, structured title page, Fountain, show bibles

Split it — 8a is small and unblocks Phase 2 properly; 8b is the real project.

**8a — Structured title page  ·  M**

Make the title page a real thing rather than a run of `center-title` blocks:
first `.page-frame` gets `data-role="title"`, and new block types `title`,
`credit`, `author`, `source`, `draft-date`, `contact`. Payoffs:

- `scriptName()` (`empty.html:4531`) reads a real title field instead of
  sniffing the first centred line.
- Item 4's "skip title page / start numbering at 1" becomes structural, not a
  fudge.
- The PDF importer can populate it properly, closing the largest row of the
  Exact-vs-Editable table.
- Fountain's title page maps onto it exactly.

**8b — Document types and show bibles  ·  XL**

`meta.docType` of `screenplay` | `show-bible` | `treatment` selects which block
types the toolbar offers and which furniture defaults apply. Bible mode adds
`h1`/`h2`/`h3`, `body`, `bullet`, `quote`, `page-break`, `toc`.

`toc` is a furniture-adjacent block: it renders from the heading blocks with
page numbers, and can only be resolved after `reflowPages()` settles — and
inserting the TOC changes pagination, so it needs a two-pass reflow (lay out
with a placeholder of known length, resolve, re-lay out, converge). Plan for
that; it's the one genuinely fiddly piece.

Adopt **Fountain** for text I/O (import and export), superset it for TOC and
tables, and document the superset in Settings ▸ Instructions. That gives you the
Overleaf-ish plain-text authoring path without maintaining a parser for a
language only this app speaks.

---

## Phase 6 — Learned insertions  ·  needs F1  ·  can ship with Phase 1

### 10. Remember the last insertion per button  ·  M

`insertExampleBlock(className, text)` (`empty.html:1920`) falls back to
`BLOCK_EXAMPLES[className]`. Change that to
`lastInsertion[className] ?? BLOCK_EXAMPLES[className]`.

Where to record from:

- The right-click "entries already in the script" menu — an explicit choice, so
  record it directly.
- **On blur of an inserted block** — this is the "user changed it and picked a
  different one" case, and it's the same event that clears item 1's focus box.
  Build the two together.

Two calls to make:

- **Scope:** per document, saved in the project (F3), falling back to the app
  default. A remembered character name is meaningless in another script.
- **Which types.** Remembering last text is right for the label-like blocks —
  `scene-heading`, `character`, `parenthetical`, `transition` — and wrong for
  `dialogue` and `action`, where nobody wants the previous line again.
  Recommendation: remember only the label-like four, keep the generic example
  for the other two. Settings toggle **Reuse last insertion** (default on)
  governs the whole feature.

---

## 11. From `finaldrafter_notes.txt`, not in the message

> "in the left hand panel we have navigation. can we nest all the current ones
> into scenes or shot"

The Navigator already nests: `buildToc()` (`empty.html:2351`) builds scene rows
with each scene's drafts collapsed underneath, a count chip, and a
`__preamble__` bucket for anything before the first scene heading. So either
this note predates that work, or you mean something more — a **third level**,
`Scene → Shot → Draft`, with shots as a new block type. Say which and it slots
into Phase 5 next to the other structural types.

---

## Cross-cutting risks

1. **`reflowPages()` is height-sensitive.** Items 1, 3, 4 and 8b all add visuals.
   Anything in the flow that adds a border, margin or padding silently
   re-paginates the script. Outlines, box-shadows, backgrounds and
   absolutely-positioned pseudo-elements only. The rule is already written down
   at `empty.html:565-571` — extend it to cover furniture.
2. **`getBlocks()`'s exclusion selector** is duplicated in six places
   (`2083`, `2088`, `2092`, `2098`, `2101`, `4938`). Consolidate to one
   `FURNITURE_SELECTOR` constant before F2 adds anything, or a slot will leak
   into exports and word counts.
3. **Print CSS is a separate world** (`empty.html:983-1000`). Every new visual
   needs an explicit print decision: furniture prints, focus boxes don't.
4. **Format migration.** v3 must read v2 forever. Write the migration and a
   fixture test at the same time as F3, not after.
5. **`file://` limits** — see the prerequisite section.

## Testing

`scripts/test-variations.mjs` is already a working Puppeteer harness with a
`--allow-file-access-from-files` Chrome. Extend it per phase rather than
starting a new one:

- F2/3/4: assert furniture is excluded from `getBlocks()`, that adding it
  doesn't change page count, and that tokens resolve.
- F3/5/6: round-trip a v2 file → v3 → reload → deep-equal the script.
- 2: fixture script with known scene/transition counts.
- 1/10: insert, blur, insert again, assert the second insert reused the text.

If the app moves to a localhost server, point the harness at that URL too.

---

## Suggested order

| # | Work | Size | Blocked by | Status |
| --- | --- | --- | --- | --- |
| 1 | Localhost launcher | S | — | ✅ done |
| 2 | F1 settings store | S | — | ✅ done |
| 3 | **9** Dialogue button · **2** stats · **1** focus box · **10** remember | S+S+S+M | F1 | ✅ done |
| 4 | F2 furniture layer | M | — | ✅ done |
| 5 | **3** headers/footers · **4** page numbers | M+S | F1, F2 | ✅ done |
| 6 | F3 format v3 | S | — | not started |
| 7 | **6** open project vs import script | M | F3 | not started |
| 8 | **5** autosave + history | L | F3, localhost | not started |
| 9 | **7** OCR | L | localhost | not started |
| 10 | **8a** structured title page | M | F3 | not started |
| 11 | **8b** doc types, bibles, TOC, Fountain | XL | 8a | not started |

Rows 3 and 5 are the ones you'd feel immediately. Row 9 is the one that unblocks
files you currently can't open at all.
