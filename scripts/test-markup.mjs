// Red-pen markup layer: ink, notes, show/hide, save/load round-trip, handoff.
// Run from the repo root:  node scripts/test-markup.mjs
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').split(path.sep).join('/');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-markup-'));
const vendored = (fs.existsSync(ROOT + '/chrome')
  ? fs.readdirSync(ROOT + '/chrome').map(d => ROOT + '/chrome/' + d + '/chrome-win64/chrome.exe')
  : []).find(p => fs.existsSync(p));

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')); }
};

const browser = await puppeteer.launch({
  ...(vendored ? { executablePath: vendored } : {}),
  headless: 'new',
  args: ['--allow-file-access-from-files', '--window-size=1600,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });

// newScript() asks before wiping; the test always means yes.
page.on('dialog', d => d.accept());

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('file:///' + ROOT + '/empty.html', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 700));

const settle = (ms = 350) => new Promise(r => setTimeout(r, ms));

// A short script to mark up, laid in the same way the app's own loader does.
await page.evaluate(() => {
  const editor = document.getElementById('editor-page');
  editor.querySelectorAll(':scope > .page-frame').forEach(f => f.remove());
  const frame = createPageFrame();
  editor.appendChild(frame);
  [
    ['scene-heading', 'INT. KITCHEN - NIGHT'],
    ['action', 'He crosses to the window and stares out at nothing in particular.'],
    ['character', 'MARIA'],
    ['dialogue', 'I suppose one could say that, perchance.'],
    ['action', 'She waits. The kettle screams.'],
    ['scene-heading', 'EXT. STREET - LATER'],
    ['action', 'Rain. A dog crosses the road.'],
  ].forEach(([cls, text]) => {
    const d = document.createElement('div');
    d.className = cls;
    d.innerText = text;
    frame.appendChild(d);
  });
  reflowPages();
  buildToc();
});
await settle();

// --- helpers ------------------------------------------------------------

// Selects a substring inside the Nth block, the way a drag-select would.
const selectIn = (blockIdx, needle) => page.evaluate((i, s) => {
  const b = getBlocks()[i];
  const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const at = node.nodeValue.indexOf(s);
    if (at === -1) continue;
    const r = document.createRange();
    r.setStart(node, at);
    r.setEnd(node, at + s.length);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    return true;
  }
  return false;
}, blockIdx, needle);

// Puts a collapsed caret in the Nth block, the way a click would.
const caretIn = blockIdx => page.evaluate(i => {
  const b = getBlocks()[i];
  const r = document.createRange();
  r.selectNodeContents(b);
  r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}, blockIdx);

// The Print pane mirrors the editable pages, so every bare selector would
// count each mark twice. Everything here is scoped to the editor.
const count = sel => page.$$eval('#editor-page ' + sel, els => els.length).catch(() => 0);
const q = sel => '#editor-page ' + sel;

// --- 1. ink on a selection ----------------------------------------------

console.log('\n[ ink ]');
ok('selected the phrase to strike', await selectIn(1, 'at nothing in particular'));
await page.evaluate(() => FDMarkup.mark('strike'));
await settle();
ok('strike wrapped exactly the selection',
  await page.$eval(q('span.fd-mk[data-mk="strike"]'), el => el.textContent) === 'at nothing in particular');
ok('one strike, not two', await count('span.fd-mk[data-mk="strike"]') === 1);

ok('selected a word to circle', await selectIn(1, 'window'));
await page.evaluate(() => FDMarkup.mark('circle'));
await settle();
ok('circle applied', await page.$eval(q('span.fd-mk[data-mk="circle"]'), el => el.textContent) === 'window');

ok('selected the clumsy line', await selectIn(3, 'perchance'));
await page.evaluate(() => FDMarkup.mark('squiggle'));
await settle();
ok('squiggle applied', await page.$eval(q('span.fd-mk[data-mk="squiggle"]'), el => el.textContent) === 'perchance');

// The words themselves must survive every mark untouched -- ink annotates,
// it never edits.
ok('the action line still reads the same',
  (await page.evaluate(() => getBlocks()[1].innerText))
    === 'He crosses to the window and stares out at nothing in particular.');

// --- 2. toggling ink off -------------------------------------------------

console.log('\n[ toggle ]');
await selectIn(1, 'window');
await page.evaluate(() => FDMarkup.mark('circle'));
await settle();
ok('marking the same passage again takes the circle off',
  await count('span.fd-mk[data-mk="circle"]') === 0);
ok('and leaves the text alone',
  (await page.evaluate(() => getBlocks()[1].innerText))
    === 'He crosses to the window and stares out at nothing in particular.');

// --- 3. ink with no selection marks the whole line ------------------------

await caretIn(6);
await page.evaluate(() => FDMarkup.mark('underline'));
await settle();
ok('a caret with no selection underlines the whole line',
  await page.$eval(q('span.fd-mk[data-mk="underline"]'), el => el.textContent.trim()) === 'Rain. A dog crosses the road.');
await caretIn(6);
await page.evaluate(() => FDMarkup.mark('underline'));
await settle();
ok('and a second press takes it off again', await count('span.fd-mk[data-mk="underline"]') === 0);

// --- 4. notes ------------------------------------------------------------

console.log('\n[ notes ]');
await selectIn(3, 'I suppose one could say that');
const noteA = await page.evaluate(() => FDMarkup.addNote('Nobody talks like this. Contract it.'));
await settle();
ok('note anchored to the selected passage',
  await page.$eval(q('.fd-note-anchor'), el => el.textContent) === 'I suppose one could say that');
ok('a margin card was drawn', await count('.fd-note-card') === 1);
ok('the card quotes the passage it is pinned to',
  (await page.$eval(q('.fd-note-card .fd-note-quote'), el => el.textContent)) === 'I suppose one could say that');
ok('the card carries the note text',
  (await page.$eval(q('.fd-note-card .fd-note-body'), el => el.textContent)) === 'Nobody talks like this. Contract it.');

await caretIn(4);
await page.evaluate(() => FDMarkup.addNote('The kettle is doing all the work here.'));
await settle();
ok('a second note, on a whole line', await count('.fd-note-card') === 2);
ok('notes are numbered in script order',
  (await page.$$eval(q('.fd-note-anchor'), els => els.map(e => e.dataset.n))).join(',') === '1,2');
ok('the ribbon count agrees',
  (await page.$eval('#fd-note-count', el => el.textContent)) === '2');
ok('the sidebar lists both', await page.$$eval('#notes-list .fd-note-row', e => e.length) === 2);

// The gutter is what stops the cards landing on top of the page.
const geom = await page.evaluate(() => {
  const frame = document.querySelector('#editor-page > .page-frame');
  const cards = Array.from(document.querySelectorAll('#editor-page .fd-note-card'));
  return {
    gutter: document.getElementById('editor-page').classList.contains('fd-note-gutter'),
    pageRight: frame.offsetLeft + frame.offsetWidth,
    lefts: cards.map(c => parseFloat(c.style.left)),
    tops: cards.map(c => parseFloat(c.style.top)),
    heights: cards.map(c => c.offsetHeight),
  };
});
ok('the gutter is open', geom.gutter);
ok('every card sits clear of the page', geom.lefts.every(l => l >= geom.pageRight), geom);
ok('cards do not overlap each other',
  geom.tops[1] >= geom.tops[0] + geom.heights[0], geom);

// --- 5. show / hide ------------------------------------------------------

console.log('\n[ show / hide ]');
// A highlight, so the master switch has one to take down with it.
await selectIn(4, 'The kettle screams');
await page.evaluate(() => setHighlighterColor('#fff176'));
await settle();
await page.evaluate(() => FDMarkup.setVisible(false));
await settle();
const hidden = await page.evaluate(() => ({
  body: document.body.classList.contains('fd-markup-hidden'),
  layer: getComputedStyle(document.getElementById('notes-layer')).display,
  strikeDeco: getComputedStyle(document.querySelector('#editor-page span.fd-mk[data-mk="strike"]')).textDecorationLine,
  hlBg: (() => {
    const m = document.querySelector('#editor-page mark.fd-hl');
    return m ? getComputedStyle(m).backgroundColor : null;
  })(),
  anchorsStillThere: document.querySelectorAll('#editor-page .fd-note-anchor').length,
  marksStillThere: document.querySelectorAll('#editor-page span.fd-mk').length,
}));
ok('hiding takes the notes layer off screen', hidden.layer === 'none', hidden);
ok('hiding drops the strike line', hidden.strikeDeco === 'none', hidden);
ok('hiding deletes nothing', hidden.anchorsStillThere === 2 && hidden.marksStillThere === 2, hidden);
ok('hiding takes the highlighter down too, so the read is really clean',
  hidden.hlBg === 'rgba(0, 0, 0, 0)', hidden);

await page.evaluate(() => FDMarkup.setVisible(true));
await settle();
ok('showing brings the cards back', await count('.fd-note-card') === 2);

// --- 6. editing the script around the markup ------------------------------

console.log('\n[ edit ]');
const beforeTop = await page.$eval(q('.fd-note-card'), c => parseFloat(c.style.top));
await page.evaluate(() => {
  // Push a fat paragraph in above everything, the way typing would.
  const frame = document.querySelector('#editor-page > .page-frame');
  const d = document.createElement('div');
  d.className = 'action';
  d.innerText = new Array(12).fill('Padding line to shove the marked passages down the page.').join(' ');
  frame.insertBefore(d, frame.querySelector('.scene-heading'));
  handleInput();
});
await settle(900);
const afterTop = await page.$eval(q('.fd-note-card'), c => parseFloat(c.style.top));
ok('cards follow their passage down the page', afterTop > beforeTop, { beforeTop, afterTop });
ok('the marks are still attached to their words',
  await page.$eval(q('span.fd-mk[data-mk="strike"]'), el => el.textContent) === 'at nothing in particular');

// Enough padding to force a second page, so the anchor/card maths has to
// survive a real page break.
await page.evaluate(() => {
  const frame = document.querySelector('#editor-page > .page-frame');
  for (let i = 0; i < 40; i++) {
    const d = document.createElement('div');
    d.className = 'action';
    d.innerText = 'Filler paragraph number ' + i + ', here only to spill the script onto a second page.';
    frame.insertBefore(d, frame.firstElementChild.nextSibling);
  }
  handleInput();
});
await settle(1200);
const paged = await page.evaluate(() => {
  const frames = Array.from(document.querySelectorAll('#editor-page > .page-frame'));
  const anchor = document.querySelector('#editor-page .fd-note-anchor');
  const frame = anchor.closest('.page-frame');
  const card = document.querySelector('#editor-page .fd-note-card');
  return {
    pages: frames.length,
    pageIdx: frames.indexOf(frame),
    cardTop: parseFloat(card.style.top),
    frameTop: frame.offsetTop,
    frameBottom: frame.offsetTop + frame.offsetHeight,
    cardLeft: parseFloat(card.style.left),
    frameRight: frame.offsetLeft + frame.offsetWidth,
    where: card.querySelector('.fd-note-head span:nth-child(2)').textContent,
  };
});
ok('the script now runs to more than one page', paged.pages > 1, paged);
ok('the card sits beside its own page, not the first one',
  paged.cardTop >= paged.frameTop && paged.cardTop <= paged.frameBottom, paged);
ok('and beside that page, horizontally', paged.cardLeft >= paged.frameRight, paged);
ok('the card reports the right page number', paged.where === 'p.' + (paged.pageIdx + 1), paged);

// --- 7. undo / redo -------------------------------------------------------

console.log('\n[ undo ]');
await page.evaluate(() => { saveState(); undo(); });
await settle(600);
const afterUndo = await page.evaluate(() => ({
  layers: document.querySelectorAll('#notes-layer').length,
  cards: document.querySelectorAll('#editor-page .fd-note-card').length,
  anchors: document.querySelectorAll('#editor-page .fd-note-anchor').length,
}));
ok('undo leaves exactly one notes layer', afterUndo.layers === 1, afterUndo);
ok('and the notes are still drawn', afterUndo.cards === afterUndo.anchors && afterUndo.cards > 0, afterUndo);
await page.evaluate(() => redo());
await settle(600);

// --- 8. save / load round trip -------------------------------------------

console.log('\n[ round trip ]');
const json = await page.evaluate(() => scriptJSON());
const proj = path.join(SCRATCH, 'markup.fdproj');
fs.writeFileSync(proj, json);

const parsed = JSON.parse(json);
ok('the file carries the note store', parsed.markup && Object.keys(parsed.markup.notes).length === 2, Object.keys(parsed.markup || {}));
ok('marked blocks save their html', parsed.script.some(b => b.html && b.html.includes('fd-mk')));
ok('anchored blocks save their html', parsed.script.some(b => b.html && b.html.includes('fd-note-anchor')));

await page.evaluate(() => newScript());
await settle(500);
ok('New Script clears the notes', await count('.fd-note-card') === 0);
ok('...and the count', (await page.$eval('#fd-note-count', el => el.textContent)) === '0');

const input = await page.$('#file-input-project');
await input.uploadFile(proj);
await settle(1600);

const reloaded = await page.evaluate(() => ({
  cards: document.querySelectorAll('#editor-page .fd-note-card').length,
  anchors: document.querySelectorAll('#editor-page .fd-note-anchor').length,
  strike: document.querySelectorAll('#editor-page span.fd-mk[data-mk="strike"]').length,
  squiggle: document.querySelectorAll('#editor-page span.fd-mk[data-mk="squiggle"]').length,
  firstNote: (document.querySelector('#editor-page .fd-note-card .fd-note-body') || {}).textContent,
  quote: (document.querySelector('#editor-page .fd-note-card .fd-note-quote') || {}).textContent,
  rows: document.querySelectorAll('#notes-list .fd-note-row').length,
}));
ok('both notes came back', reloaded.cards === 2 && reloaded.anchors === 2, reloaded);
ok('the ink came back', reloaded.strike === 1 && reloaded.squiggle === 1, reloaded);
ok('the note text came back', reloaded.firstNote === 'Nobody talks like this. Contract it.', reloaded);
ok('the anchor still holds its passage', reloaded.quote === 'I suppose one could say that', reloaded);
ok('the sidebar came back', reloaded.rows === 2, reloaded);

// A note whose id is in the file but whose anchor is not must not vanish
// silently -- it is somebody's writing.
const orphaned = await page.evaluate(() => {
  const anchor = document.querySelectorAll('#editor-page .fd-note-anchor')[1];
  const parent = anchor.parentNode;
  while (anchor.firstChild) parent.insertBefore(anchor.firstChild, anchor);
  parent.removeChild(anchor);
  FDMarkup.render();
  return {
    cards: document.querySelectorAll('#editor-page .fd-note-card').length,
    rows: document.querySelectorAll('#notes-list .fd-note-row').length,
    warned: !!document.querySelector('#notes-list .fd-note-row-where'),
    warnText: Array.from(document.querySelectorAll('#notes-list .fd-note-row-where')).map(e => e.textContent),
  };
});
ok('a note that lost its passage keeps its place in the list',
  orphaned.rows === 2 && orphaned.cards === 1, orphaned);
ok('and the list says so', orphaned.warnText.some(t => t.includes('passage deleted')), orphaned);

// --- 9. the handoff brief -------------------------------------------------

console.log('\n[ handoff ]');
const brief = await page.evaluate(() => FDMarkup.buildBrief());
ok('the brief names the marks it uses', brief.includes('How to read the marks'));
ok('struck text is spelled out', brief.includes('~~at nothing in particular~~'), brief.slice(0, 400));
ok('squiggled text is spelled out', brief.includes('<<perchance>>'));
ok('the note is quoted under its passage', brief.includes('Nobody talks like this. Contract it.'));
ok('the scene the passage sits in is named', brief.includes('## INT. KITCHEN - NIGHT'));
ok('a marked line of dialogue says who is speaking', brief.includes('**DIALOGUE ' + '—' + ' MARIA**'), brief.slice(0, 900));
ok('the note number ties the two ends together', /\[1\]/.test(brief));
ok('the orphaned note is reported, not dropped', brief.includes('Notes whose passage is gone'));
ok('unmarked lines are left out', !brief.includes('Filler paragraph number 3'));

// --- 10. clean ------------------------------------------------------------

console.log('\n[ clean ]');
await page.evaluate(() => {
  const b = Array.from(getBlocks()).find(x => x.querySelector('span.fd-mk[data-mk="strike"]'));
  const r = document.createRange();
  r.selectNodeContents(b);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
  FDMarkup.clearMarks();
});
await settle(400);
const cleaned = await page.evaluate(() => ({
  strike: document.querySelectorAll('#editor-page span.fd-mk[data-mk="strike"]').length,
  anchors: document.querySelectorAll('#editor-page .fd-note-anchor').length,
  text: (Array.from(getBlocks()).find(b => b.innerText.includes('He crosses')) || {}).innerText,
}));
ok('Clean wipes the ink', cleaned.strike === 0, cleaned);
ok('Clean leaves the notes alone', cleaned.anchors === 1, cleaned);
ok('Clean leaves the words alone',
  cleaned.text === 'He crosses to the window and stares out at nothing in particular.', cleaned);

// --- 11. the real click path -------------------------------------------
// Every test above drives FDMarkup directly. The one thing that can only
// break through the UI is the selection: clicking a ribbon button takes
// focus off the contenteditable, and if the last selection were not kept,
// "+ Note" would silently note the wrong passage.
console.log('\n[ ribbon ]');
await page.evaluate(() => { newScript(); });
await settle(600);
await page.evaluate(() => {
  const frame = document.querySelector('#editor-page > .page-frame');
  frame.querySelectorAll(':scope > *:not(.page-furniture)').forEach(b => b.remove());
  [['scene-heading', 'INT. DINER - DAY'], ['action', 'She reads the menu for a very long time indeed.']]
    .forEach(([c, t]) => { const d = document.createElement('div'); d.className = c; d.innerText = t; frame.appendChild(d); });
  reflowPages();
});
await settle(400);
await selectIn(1, 'for a very long time indeed');
await page.click('#btn-mk-strike');
await settle(500);
ok('the ribbon Strike button marks the passage that was selected, not the caret',
  await page.$eval(q('span.fd-mk[data-mk="strike"]'), el => el.textContent) === 'for a very long time indeed');

await selectIn(1, 'She reads the menu');
await page.click('#btn-add-note');
await settle(600);
ok('the ribbon + Note button anchors to the selected passage',
  await page.$eval(q('.fd-note-anchor'), el => el.textContent) === 'She reads the menu');

// Writing in a card must not reach the screenplay: the editor's oninput
// would repaginate on every keystroke and push note text into undo history.
const pagesBefore = await page.evaluate(() => document.querySelectorAll('#editor-page > .page-frame').length);
const histBefore = await page.evaluate(() => historyStack.length);
await page.click('#editor-page .fd-note-card .fd-note-body');
await page.keyboard.type('Trim this. She is not that interesting.');
await settle(500);
const typed = await page.evaluate(() => ({
  cardText: document.querySelector('#editor-page .fd-note-card .fd-note-body').innerText,
  stored: Object.values(markupState.notes)[0].text,
  scriptText: getBlocks().map(b => b.innerText).join(' | '),
  pages: document.querySelectorAll('#editor-page > .page-frame').length,
  hist: historyStack.length,
}));
ok('the note took the typing', typed.cardText === 'Trim this. She is not that interesting.', typed);
ok('and it went straight into the store', typed.stored === typed.cardText, typed);
ok('the screenplay itself is untouched',
  typed.scriptText === 'INT. DINER - DAY | She reads the menu for a very long time indeed.', typed);
ok('typing a note did not repaginate the script', typed.pages === pagesBefore, typed);
ok('and did not push note text into undo history', typed.hist === histBefore, typed);

// --- 12. markup on a passage that has variations -------------------------
// Flipping a stack rebuilds its blocks from the store, so the store has to
// carry the ink and the anchors -- otherwise reading an alternate and coming
// back would quietly rub the review pass out.
console.log('\n[ variations ]');
await page.evaluate(() => { newScript(); });
await settle(600);
await page.evaluate(() => {
  const frame = document.querySelector('#editor-page > .page-frame');
  frame.querySelectorAll(':scope > *:not(.page-furniture)').forEach(b => b.remove());
  [['scene-heading', 'INT. BAR - NIGHT'], ['action', 'The bartender says nothing at all for a while.']]
    .forEach(([c, t]) => { const d = document.createElement('div'); d.className = c; d.innerText = t; frame.appendChild(d); });
  reflowPages();
});
await settle(400);
await selectIn(1, 'nothing at all');
await page.evaluate(() => FDMarkup.mark('strike'));
await settle(400);
await selectIn(1, 'The bartender');
await page.evaluate(() => FDMarkup.addNote('Give him a piece of business here.'));
await settle(500);

await page.evaluate(() => { const b = getBlocks()[1]; const r = document.createRange(); r.selectNodeContents(b); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); addVariation(); });
await settle(900);
const stacked = await page.evaluate(() => Object.keys(stacks).length);
ok('the marked passage now carries a variation stack', stacked === 1, { stacked });

// Flip to the alternate and back.
await page.evaluate(() => { const id = Object.keys(stacks)[0]; const st = stacks[id]; flipTo(id, st.order[1] || st.order[0]); });
await settle(700);
await page.evaluate(() => { const id = Object.keys(stacks)[0]; const st = stacks[id]; flipTo(id, st.order[0]); });
await settle(700);
const flipped = await page.evaluate(() => ({
  strike: document.querySelectorAll('#editor-page span.fd-mk[data-mk="strike"]').length,
  anchors: document.querySelectorAll('#editor-page .fd-note-anchor').length,
  cards: document.querySelectorAll('#editor-page .fd-note-card').length,
}));
ok('the ink survived a round trip through the stack', flipped.strike === 1, flipped);
ok('and so did the note', flipped.anchors === 1 && flipped.cards === 1, flipped);

await page.screenshot({ path: ROOT + '/scripts/markup-verified.png' });

console.log('\n' + (errors.length ? 'PAGE ERRORS:\n  ' + errors.join('\n  ') : 'no page errors'));
console.log('\n' + pass + ' passed, ' + fail + ' failed');
await browser.close();
process.exit(fail || errors.length ? 1 : 0);
