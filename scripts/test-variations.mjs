// Run from the repo root:  node scripts/test-variations.mjs
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').split(path.sep).join('/');
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-test-'));
// Prefer the Chrome vendored alongside this repo; fall back to whatever
// puppeteer resolves on its own.
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

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto('file:///' + ROOT + '/empty.html', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 600));

// Open Project (.fdproj/.json, restore) and Import Script (.pdf/.md/.txt,
// conversion) are two different <input>s/handlers since item 6 split them.
async function loadFileInto(filePath) {
  const input = await page.$('#file-input-project');
  await input.uploadFile(filePath);
  await new Promise(r => setTimeout(r, 1500));
}

// mode: 'new' (replaces the open project) or 'current' (appends). Drives the
// import-destination modal the same way a real click on "Import Script..."
// would, rather than reaching into importIntoMode directly.
async function importFileInto(filePath, mode) {
  await page.evaluate(() => openImportModal());
  const modalShown = await page.evaluate(() =>
    document.getElementById('import-modal').style.display === 'flex');
  // If the modal didn't show, openImportModal() already decided 'new' for
  // us (nothing open was worth protecting) and set importIntoMode itself.
  if (modalShown) {
    await page.evaluate(m => chooseImportMode(m), mode);
  }
  const input = await page.$('#file-input-import');
  await input.uploadFile(filePath);
  await new Promise(r => setTimeout(r, 1500));
}

console.log('\n== 1. Load The Social Network ==');
await loadFileInto(path.resolve(ROOT, 'text/social_network.json'));
let n = await page.evaluate(() => getBlocks().length);
ok('script loaded', n > 100, n);
ok('no stacks yet', await page.evaluate(() => Object.keys(stacks).length) === 0);

console.log('\n== 2. Create a variation over the opening V.O. exchange ==');
// Select blocks 0..10 (the FROM THE BLACK V.O. exchange) exactly, then vary.
await page.evaluate(() => {
  const b = getBlocks();
  const r = document.createRange();
  r.setStart(b[0], 0);
  r.setEnd(b[10], b[10].childNodes.length);
  const s = window.getSelection();
  s.removeAllRanges(); s.addRange(r);
  addVariation();
});
await new Promise(r => setTimeout(r, 500));

let st = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const s = stacks[id];
  return { id, order: s.order, viewing: s.viewing, names: s.order.map(c => s.cards[c].name),
           lens: s.order.map(c => s.cards[c].blocks.length),
           domCount: blocksOfStack(id).length };
});
ok('one stack created', st.id !== undefined, st);
ok('two cards', st.order.length === 2, st.order);
ok('new card is on top', st.viewing === st.order[0], st);
ok('both cards have the 11 selected blocks', st.lens[0] === 11 && st.lens[1] === 11, st.lens);
ok('11 blocks tagged in the DOM', st.domCount === 11, st.domCount);

console.log('\n== 3. Decorations are drawn and are layout-neutral ==');
let deco = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const nodes = blocksOfStack(id);
  const cs = getComputedStyle(nodes[0]);
  return {
    first: nodes[0].hasAttribute('data-stack-first'),
    count: nodes[0].dataset.gutter,
    last: nodes[nodes.length - 1].hasAttribute('data-stack-last'),
    midHasNeither: !nodes[5].hasAttribute('data-stack-first') && !nodes[5].hasAttribute('data-stack-last'),
    borderWidth: cs.borderTopWidth + '/' + cs.borderLeftWidth,
    padding: cs.paddingTop + '/' + cs.paddingLeft,
    bg: cs.backgroundColor,
    bandBg: getComputedStyle(nodes[0], '::before').backgroundColor,
    bandWidth: getComputedStyle(nodes[0], '::before').width,
    bandWidthDlg: getComputedStyle(nodes[4], '::before').width,
    bandRail: getComputedStyle(nodes[0], '::before').borderLeftWidth,
  };
});
ok('first block flagged', deco.first);
ok('gutter mark reads 2 (the stack depth)', deco.count === '2', deco.count);
ok('last block flagged', deco.last);
ok('interior blocks unflagged', deco.midHasNeither);
ok('no border added (pagination safe)', deco.borderWidth === '0px/0px', deco.borderWidth);
ok('no padding added (pagination safe)', deco.padding === '0px/0px', deco.padding);
ok('block itself has no background (band does the work)', deco.bg === 'rgba(0, 0, 0, 0)', deco.bg);
ok('tint band painted', deco.bandBg !== 'rgba(0, 0, 0, 0)', deco.bandBg);
ok('band is opaque (no seams where bands overlap)', !/rgba\(.*0\.\d/.test(deco.bandBg), deco.bandBg);
ok('rail drawn', parseFloat(deco.bandRail) >= 2, deco.bandRail);
ok('band is the same width for every block type', deco.bandWidth === deco.bandWidthDlg,
   { action: deco.bandWidth, dialogue: deco.bandWidthDlg });

console.log('\n== 3b. Pagination is genuinely unchanged by the decoration ==');
// Neutralise the stack styling via CSS (not by touching the data model) and
// confirm the page breaks and every block position are byte-identical.
let pag = await page.evaluate(() => {
  const measure = () => {
    reflowPages();
    return {
      frames: document.querySelectorAll('#editor-page > .page-frame').length,
      tops: getBlocks().map(x => Math.round(x.getBoundingClientRect().top * 100) / 100),
    };
  };
  const withDeco = measure();
  const kill = document.createElement('style');
  kill.textContent =
    '.page > [data-stack]{background:none!important;box-shadow:none!important}' +
    '.page > [data-stack]::before,.page > [data-stack-first]::after{display:none!important}';
  document.head.appendChild(kill);
  const without = measure();
  kill.remove();
  reflowPages();
  const drift = withDeco.tops.length === without.tops.length
    ? withDeco.tops.reduce((m, t, i) => Math.max(m, Math.abs(t - without.tops[i])), 0)
    : 9999;
  return { before: withDeco.frames, after: without.frames, drift };
});
ok('page count identical with/without decoration', pag.before === pag.after, pag);
ok('no vertical drift from decoration', pag.drift < 0.5, pag.drift);

console.log('\n== 4. Write the alternate, then flip between versions ==');
await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const nodes = blocksOfStack(id);
  const alt = [
    'FROM THE BLACK WE HEAR--', 'MARK (V.O.)',
    'Did you know there are at least twice as many people working for the CCP in China as there are people in all of Canada?',
    'EDUARDO (V.O.)', "That can't possibly be true.", 'MARK (V.O.)', 'It is.',
    'EDUARDO (V.O.)', 'What would account for that?', 'MARK (V.O.)',
    "So imagine every single person in Canada worked for the government. It would still be less than half of theirs. That's not a country, that's an operating system.",
  ];
  nodes.forEach((nd, i) => { if (alt[i] !== undefined) nd.innerText = alt[i]; });
  reflowPages(); refreshStacks();
});
await new Promise(r => setTimeout(r, 200));

let flip = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const s = stacks[id];
  const top = s.order[0], other = s.order[1];
  flipTo(id, other);
  const readingOld = blocksOfStack(id).map(x => x.innerText).join(' | ');
  const off = blocksOfStack(id)[0].hasAttribute('data-stack-off');
  flipTo(id, top);
  const readingNew = blocksOfStack(id).map(x => x.innerText).join(' | ');
  const offAfter = blocksOfStack(id)[0].hasAttribute('data-stack-off');
  return { readingOld, readingNew, off, offAfter, order: s.order, top };
});
ok('flipping shows the original text', flip.readingOld.includes('genius IQ') && flip.readingOld.includes('ERICA'), flip.readingOld.slice(0, 90));
ok('flipping back shows the alternate', flip.readingNew.includes('CCP') && flip.readingNew.includes('EDUARDO'), flip.readingNew.slice(0, 90));
ok('off-top card is visually flagged', flip.off === true);
ok('top card is not flagged', flip.offAfter === false);
ok('flipping did NOT reorder the stack', flip.order[0] === flip.top, flip.order);

console.log('\n== 5. Reading then closing springs back to the printing version ==');
let spring = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const s = stacks[id];
  openDeck(id);
  flipTo(id, s.order[1]);
  const whileOpen = blocksOfStack(id)[1].innerText;
  closeDeck();
  return { whileOpen, afterClose: blocksOfStack(id)[1].innerText, viewing: s.viewing, top: s.order[0] };
});
ok('reads the alternate while fanned', spring.whileOpen === 'MARK (V.O.)');
ok('springs back to the top card on close', spring.viewing === spring.top, spring);

console.log('\n== 6. Move to top actually restaples ==');
let restaple = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const s = stacks[id];
  const wasTop = s.order[0];
  openDeck(id);
  flipTo(id, s.order[1]);
  moveViewedToTop();
  const nowTop = s.order[0];
  closeDeck();
  return { wasTop, nowTop, prints: blocksOfStack(id).map(x => x.innerText).join(' ') };
});
ok('order changed', restaple.wasTop !== restaple.nowTop, restaple);
ok('the promoted card is what prints', restaple.prints.includes('genius IQ'), restaple.prints.slice(0, 60));

console.log('\n== 7. Compare pane renders a real diff ==');
let diff = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  openDeck(id);
  toggleCompare();
  const body = document.getElementById('compare-body');
  return {
    active: document.getElementById('compare-viewer').classList.contains('active'),
    paneOpen: paneState.exact && paneState.editable,
    sideMode: paneState.sideMode,
    title: document.getElementById('pane-title-exact').innerText,
    rows: body.querySelectorAll('.diff-row').length,
    ins: body.querySelectorAll('ins').length,
    del: body.querySelectorAll('del').length,
    takes: body.querySelectorAll('.diff-take').length,
    sampleIns: (body.querySelector('ins') || {}).innerText,
  };
});
ok('compare viewer active', diff.active);
ok('side pane opened for it', diff.paneOpen && diff.sideMode === 'compare', diff);
ok('pane retitled', /COMPARE VERSIONS/i.test(diff.title), diff.title);
ok('diff rows rendered', diff.rows > 3, diff.rows);
ok('word-level insertions marked', diff.ins > 0, diff.ins);
ok('word-level deletions marked', diff.del > 0, diff.del);
ok('cherry-pick buttons offered', diff.takes > 0, diff.takes);

console.log('\n== 8. Cherry-pick pulls one block across ==');
let take = await page.evaluate(() => {
  const body = document.getElementById('compare-body');
  const btns = body.querySelectorAll('.diff-take');
  const before = blocksOfStack(Object.keys(stacks)[0]).map(x => x.innerText);
  btns[btns.length - 1].click();
  const after = blocksOfStack(Object.keys(stacks)[0]).map(x => x.innerText);
  return { changed: JSON.stringify(before) !== JSON.stringify(after), before, after };
});
ok('cherry-pick changed the open version', take.changed, { b: take.before.at(-1), a: take.after.at(-1) });

console.log('\n== 9. Save round-trip ==');
const saved = await page.evaluate(() => { closeDeck(); return scriptJSON(); });
const savedPath = SCRATCH + '/roundtrip.json';
fs.writeFileSync(savedPath, saved, 'utf8');
const parsed = JSON.parse(saved);
ok('formatVersion 3', parsed.formatVersion === 3);
ok('stacks serialized', Object.keys(parsed.stacks).length === 1, Object.keys(parsed.stacks));
ok('cards serialized', Object.values(parsed.stacks)[0].order.length === 2);
ok('blocks carry stack ids', parsed.script.filter(b => b.stack).length === 11, parsed.script.filter(b => b.stack).length);
ok('saved script is the printing version', JSON.stringify(parsed.script.slice(0, 11)).includes('genius IQ'));

await loadFileInto(savedPath);
let reloaded = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const s = stacks[id];
  return { count: Object.keys(stacks).length, order: s.order.length,
           dom: blocksOfStack(id).length,
           chip: blocksOfStack(id)[0].dataset.gutter,
           prints: blocksOfStack(id).map(x => x.innerText).join(' '),
           other: s.cards[s.order[1]].blocks.map(b => b.text).join(' ') };
});
ok('stack survived the round trip', reloaded.count === 1 && reloaded.order === 2, reloaded);
ok('run re-tagged in the DOM', reloaded.dom === 11, reloaded.dom);
ok('chip redrawn', reloaded.chip === '2', reloaded.chip);
ok('printing version preserved', reloaded.prints.includes('genius IQ'));
ok('alternate version preserved', reloaded.other.includes('CCP'), reloaded.other.slice(0, 60));

console.log('\n== 10. Undo restores the store, not just the markup ==');
let undoRes = await page.evaluate(() => {
  const before = Object.keys(stacks).length;
  const id = Object.keys(stacks)[0];
  addCardTo(id);           // now 3 cards
  const mid = stacks[id].order.length;
  closeDeck();
  undo();
  const after = stacks[Object.keys(stacks)[0]] ? stacks[Object.keys(stacks)[0]].order.length : 0;
  redo();
  const redone = stacks[Object.keys(stacks)[0]].order.length;
  return { before, mid, after, redone };
});
ok('adding a card gives 3', undoRes.mid === 3, undoRes);
ok('undo takes the store back to 2', undoRes.after === 2, undoRes);
ok('redo restores 3', undoRes.redone === 3, undoRes);

console.log('\n== 11. Backward compatibility: a v1 file with no stacks ==');
await loadFileInto(path.resolve(ROOT, 'text/social_network.json'));
let compat = await page.evaluate(() => ({ stacks: Object.keys(stacks).length, blocks: getBlocks().length,
                                          deckOpen: document.getElementById('deck-bar').classList.contains('open') }));
ok('old file loads with no stacks', compat.stacks === 0 && compat.blocks > 100, compat);
ok('deck closed after load', compat.deckOpen === false);

console.log('\n== 12. Navigator nests cards under scenes ==');
let nav = await page.evaluate(() => {
  const b = getBlocks();
  const r = document.createRange();
  r.setStart(b[0], 0); r.setEnd(b[10], b[10].childNodes.length);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  addVariation();
  closeDeck();
  buildToc();
  const list = document.getElementById('toc-list');
  const withChip = list.querySelectorAll('.toc-chip').length;
  const collapsedCards = list.querySelectorAll('ul.toc-cards li').length;
  // Stacks start shut; opening one is what reveals the drafts.
  list.querySelector('.toc-chip').click();
  const cardLis = document.getElementById('toc-list').querySelectorAll('ul.toc-cards li').length;
  const allScenes = document.getElementById('toc-list').querySelectorAll(':scope > li').length;
  setTocFilter('stacked');
  const filtered = document.getElementById('toc-list').querySelectorAll(':scope > li').length;
  setTocFilter('all');
  return { withChip, cardLis, collapsedCards, allScenes, filtered,
           hasFilterBar: !!document.getElementById('toc-filter') };
});
ok('filter bar present', nav.hasFilterBar);
ok('a scene carries a chip', nav.withChip >= 1, nav);
ok('stacks start collapsed (not overwhelming)', nav.collapsedCards === 0, nav);
ok('clicking the chip reveals the drafts', nav.cardLis >= 2, nav);
ok('filter narrows the tree', nav.filtered < nav.allScenes && nav.filtered >= 1, nav);

console.log('\n== 13. Fold hand-marked alternates (keepingup_pilot_001) ==');
const KEEPINGUP = path.resolve(ROOT, '../keeping-up/keepingup_pilot_001.json');
if (!fs.existsSync(KEEPINGUP)) {
  console.log('  SKIP  keepingup_pilot_001.json not found at ' + KEEPINGUP);
} else {
await loadFileInto(KEEPINGUP);
let detect = await page.evaluate(() => {
  const f = detectAltDrafts();
  return { total: f.length, matched: f.filter(x => x.targetStart >= 0).length,
           labels: f.map(x => x.kind + ' | ' + x.label + ' -> ' + (x.targetStart >= 0 ? 'matched onto: ' + getBlocks()[x.targetStart].innerText.trim() : 'standalone')) };
});
console.log('   detected: ' + JSON.stringify(detect.labels, null, 2));
ok('markers detected', detect.total === 6, detect.total);
ok('all three ALT DRAFTs matched a scene', detect.matched === 3, detect);
ok('ADDITIONAL SCENEs left alone', detect.labels.filter(l => /standalone/.test(l)).length === 3, detect.labels);

let folded = await page.evaluate(() => {
  window.confirm = () => true;
  const before = getBlocks().length;
  foldAltDrafts();
  const ids = Object.keys(stacks);
  return {
    before, after: getBlocks().length,
    stacks: ids.length,
    cards: ids.map(i => stacks[i].order.map(c => stacks[i].cards[c].name)),
    tops: ids.map(i => stacks[i].order[0]),
    chips: Array.from(document.querySelectorAll('[data-stack-count]')).map(x => x.dataset.stackCount),
  };
});
console.log('   ' + JSON.stringify(folded.cards));
ok('script got shorter (appendix absorbed)', folded.after < folded.before, { b: folded.before, a: folded.after });
ok('all three folded onto the one service-corridor scene', folded.stacks === 1 && folded.cards[0].length === 4, folded.cards);
ok('original stayed on top', folded.cards.every(c => c[0] === 'Original'), folded.cards);
ok('alternates named from their markers', folded.cards.some(c => c.some(n => /SCULLERY|OFF-MENU|ALCHEMIST/i.test(n))), folded.cards);

let foldedRt = await page.evaluate(() => {
  const j = scriptJSON();
  return { fv: JSON.parse(j).formatVersion, stacks: Object.keys(JSON.parse(j).stacks).length };
});
ok('folded project serializes', foldedRt.fv === 3 && foldedRt.stacks >= 1, foldedRt);
}

console.log('\n== 14. Robustness ==');
let robust = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const nodes = blocksOfStack(id);
  // Simulate the writer pressing Enter mid-run: a fresh block with no attributes.
  const fresh = document.createElement('div');
  fresh.className = 'action';
  fresh.innerText = 'A newly typed line inside the stack.';
  nodes[2].parentNode.insertBefore(fresh, nodes[2].nextSibling);
  reflowPages();
  const healed = fresh.dataset.stack === id;
  // Now delete the entire run and confirm the stack is garbage-collected.
  blocksOfStack(id).forEach(x => x.remove());
  reflowPages();
  return { healed, gone: !stacks[id], remaining: Object.keys(stacks).length };
});
ok('a block typed inside a run joins the stack', robust.healed, robust);
ok('deleting the run drops the stack', robust.gone, robust);


console.log('\n== 15. Export and print always emit the version that prints ==');
await loadFileInto(path.resolve(ROOT, 'text/social_network.json'));
let exp = await page.evaluate(() => {
  const b = getBlocks();
  const r = document.createRange();
  r.setStart(b[0], 0); r.setEnd(b[10], b[10].childNodes.length);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  addVariation();
  const id = Object.keys(stacks)[0];
  blocksOfStack(id).forEach(n => { n.innerText = 'ALTERNATE TAKE ' + n.innerText; });
  reflowPages(); refreshStacks();
  openDeck(id);
  flipTo(id, stacks[id].order[1]);
  const readingOriginal = blocksOfStack(id)[0].innerText;
  let captured = '';
  const realDownload = window.downloadFile;
  window.downloadFile = (fn, content) => { captured = content; };
  exportTXT();
  window.downloadFile = realDownload;
  return { readingOriginal, head: captured.slice(0, 400),
           viewingAfter: stacks[id].viewing, top: stacks[id].order[0] };
});
ok('was reading the non-printing version', !/ALTERNATE TAKE/.test(exp.readingOriginal), exp.readingOriginal);
ok('export emitted the printing version anyway', /ALTERNATE TAKE/.test(exp.head), exp.head.slice(0, 120));
ok('export settled the stack back on top', exp.viewingAfter === exp.top, exp);

console.log('\n== 16. Deleting a stacked scene, then undo ==');
let del = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const cards = stacks[id].order.length;
  blocksOfStack(id).forEach(n => n.remove());
  reflowPages();
  saveState();
  const goneStacks = Object.keys(stacks).length;
  undo();
  const back = Object.keys(stacks)[0];
  return { cards, goneStacks, restored: back ? stacks[back].order.length : 0,
           domBack: back ? blocksOfStack(back).length : 0 };
});
ok('stack dropped with its blocks', del.goneStacks === 0, del);
ok('undo brings the stack back with every card', del.restored === del.cards, del);
ok('undo re-tags the blocks in the document', del.domBack === 11, del);


console.log('\n== 17. A freshly duplicated version compares as an identical copy ==');
await loadFileInto(path.resolve(ROOT, 'text/social_network.json'));
let dup = await page.evaluate(() => {
  const b = getBlocks();
  const r = document.createRange();
  r.setStart(b[0], 0); r.setEnd(b[10], b[10].childNodes.length);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  addVariation();                       // duplicate, nothing edited yet
  const id = Object.keys(stacks)[0];
  toggleCompare();
  const body = document.getElementById('compare-body');
  const head = document.getElementById('compare-head');
  return {
    rows: body.querySelectorAll('.diff-row').length,
    gaps: body.querySelectorAll('.diff-gap').length,
    marks: body.querySelectorAll('ins, del').length,
    status: (head.querySelector('.compare-status') || {}).innerText,
    hint: !!body.querySelector('.compare-hint'),
    clean: body.classList.contains('diff-clean'),
    text: body.innerText,
    caretInScript: document.getElementById('editor-page').contains(window.getSelection().anchorNode),
    caretBlockIsStacked: (() => {
      const n = findBlockNode(window.getSelection().anchorNode);
      return !!(n && n.dataset.stack === id);
    })(),
  };
});
ok('every line of the copy is shown, not collapsed', dup.rows === 11, { rows: dup.rows, gaps: dup.gaps });
ok('nothing collapsed away', dup.gaps === 0, dup.gaps);
ok('no changes marked', dup.marks === 0, dup.marks);
ok('header says identical', /identical/i.test(dup.status || ''), dup.status);
ok('marked as a clean diff (text stays readable)', dup.clean === true);
ok('says where to type', dup.hint === true);
ok('the copy actually shows the text', /genius IQ/.test(dup.text), dup.text.slice(0, 120));
ok('caret landed in the script', dup.caretInScript === true);
ok('caret landed inside the new version', dup.caretBlockIsStacked === true);

console.log('\n== 18. Compare follows edits as you type ==');
let live = await page.evaluate(async () => {
  const id = Object.keys(stacks)[0];
  const first = blocksOfStack(id)[0];
  first.innerText = 'FROM THE BLACK, A DIFFERENT VOICE--';
  handleInput();
  await new Promise(r => setTimeout(r, 1400));   // past the input debounce
  const body = document.getElementById('compare-body');
  const head = document.getElementById('compare-head');
  return {
    marks: body.querySelectorAll('ins, del').length,
    status: (head.querySelector('.compare-status') || {}).innerText,
    clean: body.classList.contains('diff-clean'),
  };
});
ok('the edit shows up without reopening Compare', live.marks > 0, live);
ok('header switches to a change count', /differ/.test(live.status || ''), live.status);
ok('no longer a clean diff', live.clean === false, live);


console.log('\n== 19. Numbering: stable draft identity vs. rank ==');
await loadFileInto(path.resolve(ROOT, 'text/social_network.json'));
let num = await page.evaluate(() => {
  const b = getBlocks();
  const sel = window.getSelection();
  // A stack on the 2nd scene, so the scene number is not trivially S001.
  const heads = b.map((x, i) => x.classList.contains('scene-heading') ? i : -1).filter(i => i >= 0);
  const s0 = heads[1], e0 = heads[2] - 1;
  const r = document.createRange();
  r.setStart(b[s0], 0); r.setEnd(b[e0], b[e0].childNodes.length);
  sel.removeAllRanges(); sel.addRange(r);
  addVariation(); addVariation();      // D001 original, D002, D003
  closeDeck(); buildToc();

  const id = Object.keys(stacks)[0];
  const st = stacks[id];
  const byNum = () => st.order.map(c => st.cards[c].num);
  const before = byNum();
  const first = blocksOfStack(id)[0];
  return {
    sceneNum: first.dataset.sceneNum,
    nums: before,
    names: st.order.map(c => st.cards[c].name),
    top: st.cards[st.order[0]].num,
    id: id,
  };
});
ok('drafts numbered in creation order', JSON.stringify(num.nums.slice().sort()) === '[1,2,3]', num.nums);
ok('newest draft is on top', num.top === 3, num);
ok('names agree with numbers at creation', num.names.includes('Draft 3'), num.names);
ok('the stacked scene knows its number', /^S\d{3}$/.test(num.sceneNum || ''), num.sceneNum);

console.log('\n== 20. Dragging a draft to the top ranks AND displays it ==');
let rank = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const st = stacks[id];
  const bottom = st.order[st.order.length - 1];
  const bottomNum = st.cards[bottom].num;
  // Mark the bottom draft so we can see it reach the page.
  st.cards[bottom].blocks[1].text = 'MARKER-FOR-THE-BOTTOM-DRAFT';
  reorderCards(id, bottom, st.order[0]);   // drop it on the first entry
  return {
    bottomNum,
    newTopNum: st.cards[st.order[0]].num,
    onThePage: blocksOfStack(id).map(x => x.innerText).join(' | '),
    viewingIsTop: viewedCard(st) === st.order[0],
    numsStillPresent: st.order.map(c => st.cards[c].num).slice().sort(),
  };
});
ok('the dragged draft is now ranked first', rank.newTopNum === rank.bottomNum, rank);
ok('and it is what the script displays', /MARKER-FOR-THE-BOTTOM-DRAFT/.test(rank.onThePage), rank.onThePage.slice(0, 90));
ok('the script is settled on the new top', rank.viewingIsTop === true, rank);
ok('re-ranking did NOT renumber the drafts', JSON.stringify(rank.numsStillPresent) === '[1,2,3]', rank.numsStillPresent);

console.log('\n== 21. Scene/draft labels in the margin, and in print ==');
let lbl = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const first = blocksOfStack(id)[0];
  const scenes = getBlocks().filter(x => x.classList.contains('scene-heading'));
  const plain = scenes.find(x => !x.dataset.stack);

  const read = () => ({
    stackMark: first.dataset.gutter,
    stackPrints: first.hasAttribute('data-gutter-print'),
    plainMark: plain.dataset.gutter,
    plainPrints: plain.hasAttribute('data-gutter-print'),
  });

  setSceneNumberMode('off');
  const off = read();
  setSceneNumberMode('scene');
  const scene = read();
  setSceneNumberMode('draft');
  const draft = read();

  // The label must not disturb the page: it is an absolutely-positioned mark.
  const framesBefore = document.querySelectorAll('#editor-page > .page-frame').length;
  const topsBefore = getBlocks().map(x => Math.round(x.getBoundingClientRect().top * 100) / 100);
  setSceneNumberMode('off');
  reflowPages();
  const framesAfter = document.querySelectorAll('#editor-page > .page-frame').length;
  const topsAfter = getBlocks().map(x => Math.round(x.getBoundingClientRect().top * 100) / 100);
  setSceneNumberMode('draft');

  return { off, scene, draft, framesBefore, framesAfter,
           drift: topsBefore.reduce((m, t, i) => Math.max(m, Math.abs(t - topsAfter[i])), 0) };
});
ok('off: the mark falls back to the stack depth', lbl.off.stackMark === '3', lbl.off);
ok('off: nothing is printed', !lbl.off.stackPrints && lbl.off.plainMark === undefined, lbl.off);
ok('scene: plain headings get S###', /^S\d{3}$/.test(lbl.scene.plainMark || ''), lbl.scene);
ok('draft: the stack gets S###.D###', /^S\d{3}[a-z]?\.D\d{3}$/.test(lbl.draft.stackMark || ''), lbl.draft);
ok('draft: the label is marked for print', lbl.draft.stackPrints && lbl.draft.plainPrints, lbl.draft);
ok('labelling does not repaginate', lbl.framesBefore === lbl.framesAfter && lbl.drift < 0.5, lbl);

let lblTop = await page.evaluate(() => {
  const id = Object.keys(stacks)[0];
  const st = stacks[id];
  const mark = () => blocksOfStack(id)[0].dataset.gutter;
  const asTop = mark();
  openDeck(id);
  flipTo(id, st.order[1]);
  const asRead = mark();
  closeDeck();
  return { asTop, asRead, topNum: st.cards[st.order[0]].num, readNum: st.cards[st.order[1]].num };
});
ok('the margin names the draft actually on the page', lblTop.asTop !== lblTop.asRead, lblTop);
ok('...and it tracks the one being read', lblTop.asRead.endsWith('D' + String(lblTop.readNum).padStart(3, '0')), lblTop);

console.log('\n== 22. Two stacks in one scene disambiguate ==');
let two = await page.evaluate(() => {
  const b = getBlocks();
  const heads = b.map((x, i) => x.classList.contains('scene-heading') ? i : -1).filter(i => i >= 0);
  // Needs a scene long enough to hold two separate stacked passages that
  // neither overlap each other nor run into the next scene heading.
  let s = -1;
  for (let k = 0; k < heads.length - 1; k++) {
    if (heads[k + 1] - heads[k] >= 10 && !b[heads[k]].dataset.stack) { s = heads[k]; break; }
  }
  if (s < 0) return { skipped: true };

  const mk = (from, to) => {
    const r = document.createRange();
    r.setStart(b[from], 0); r.setEnd(b[to], b[to].childNodes.length);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    addVariation(); closeDeck();
  };
  mk(s + 1, s + 2);
  mk(s + 5, s + 6);
  buildToc();

  const n = numberScript();
  const base = b[s].dataset.sceneNum;
  const ids = [...new Set(getBlocks().filter(x => x.dataset.stack).map(x => x.dataset.stack))];
  const inScene = ids.filter(id => (n.prefixOf.get(id) || '').startsWith(base));
  return {
    base: base,
    prefixes: inScene.map(id => n.prefixOf.get(id)),
    labels: inScene.map(id => stackLabel(id, n)),
  };
});
if (two.skipped) {
  console.log('  SKIP  no scene long enough in this script');
} else {
  ok('a scene with two stacks labels them S###a / S###b',
     two.prefixes.length === 2 && two.prefixes[0] === two.base + 'a' && two.prefixes[1] === two.base + 'b', two);
  ok('each gets a full, distinct label',
     two.labels.length === 2 && two.labels[0] !== two.labels[1] &&
     two.labels.every(l => /^S\d{3}[ab]\.D\d{3}$/.test(l)), two.labels);
}


console.log('\n== 23. Clicking a draft keeps the Navigator row open ==');
await loadFileInto(path.resolve(ROOT, 'text/social_network.json'));
let stay = await page.evaluate(() => {
  const b = getBlocks();
  const heads = b.map((x, i) => x.classList.contains('scene-heading') ? i : -1).filter(i => i >= 0);
  // A SCENE-LEVEL stack: the run starts on the scene heading, so flipping
  // rebuilds that heading element. This is the case that used to collapse.
  const s = heads[1], e = heads[2] - 1;
  const r = document.createRange();
  r.setStart(b[s], 0); r.setEnd(b[e], b[e].childNodes.length);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  addVariation(); addVariation();
  closeDeck(); buildToc();

  const list = document.getElementById('toc-list');
  const startCollapsed = list.querySelectorAll('ul.toc-cards li').length;
  list.querySelector('.toc-chip').click();          // open the drafts
  const openedCount = document.getElementById('toc-list').querySelectorAll('ul.toc-cards li').length;

  const headingIdBefore = blocksOfStack(Object.keys(stacks)[0])[0].id;

  // Click the second draft, exactly as a writer would.
  const cards = document.getElementById('toc-list').querySelectorAll('ul.toc-cards li');
  cards[1].click();

  const after = document.getElementById('toc-list');
  const stillOpen = after.querySelectorAll('ul.toc-cards li').length;
  const id = Object.keys(stacks)[0];
  return {
    startCollapsed, openedCount, stillOpen,
    headingIdBefore,
    headingIdAfter: blocksOfStack(id)[0].id,
    viewing: stacks[id].cards[viewedCard(stacks[id])].num,
    top: stacks[id].cards[stacks[id].order[0]].num,
    twisty: after.querySelector('.toc-twisty') ? after.querySelectorAll('.toc-twisty')[0].innerText : '',
  };
});
ok('a freshly loaded script starts collapsed', stay.startCollapsed === 0, stay);
ok('the drafts opened', stay.openedCount === 3, stay);
ok('clicking a draft leaves the row open', stay.stillOpen === 3, stay);
ok('scene heading keeps its id across the flip', stay.headingIdBefore === stay.headingIdAfter, stay);
ok('the click did flip the script to that draft', stay.viewing !== stay.top, stay);

let stay2 = await page.evaluate(() => {
  // Re-ranking rebuilds the run too; the row must survive that as well.
  const id = Object.keys(stacks)[0];
  const st = stacks[id];
  reorderCards(id, st.order[st.order.length - 1], st.order[0]);
  const list = document.getElementById('toc-list');
  return { open: list.querySelectorAll('ul.toc-cards li').length };
});
ok('re-ranking leaves the row open too', stay2.open === 3, stay2);

console.log('\n== 24. Toolbar order: Dialogue sits next to Character ==');
let toolbarOrder = await page.evaluate(() =>
  Array.from(document.querySelectorAll('#format-toolbar button[data-type]')).map(b => b.dataset.type));
ok('scene-heading, action, character, dialogue, parenthetical, transition',
  JSON.stringify(toolbarOrder) === JSON.stringify(
    ['scene-heading', 'action', 'character', 'dialogue', 'parenthetical', 'transition']),
  toolbarOrder);

console.log('\n== 25. Document Statistics: corrected labels ==');
let stats = await page.evaluate(() => {
  updateStatistics();
  return {
    scenes: Number(document.getElementById('stat-scenes').innerText),
    locations: Number(document.getElementById('stat-locations').innerText),
    characters: Number(document.getElementById('stat-chars').innerText),
    dialogue: Number(document.getElementById('stat-dialogue').innerText),
    transitions: Number(document.getElementById('stat-transitions').innerText),
    sceneHeadingCount: document.querySelectorAll('#editor-page .scene-heading').length,
    characterCueCount: document.querySelectorAll('#editor-page .character').length,
    transitionCount: document.querySelectorAll('#editor-page .transition').length,
    distinctLocations: appState.locations.length,
    distinctCharacters: appState.characters.length,
  };
});
ok('Scenes counts scene-heading blocks', stats.scenes === stats.sceneHeadingCount, stats);
ok('Dialogue cues counts character-cue blocks (the old mislabelled "Characters")',
  stats.dialogue === stats.characterCueCount, stats);
ok('Transitions counted (new row)', stats.transitions === stats.transitionCount, stats);
ok('Locations is the distinct-location count (the old mislabelled row), not the scene count',
  stats.locations === stats.distinctLocations && stats.locations !== stats.scenes, stats);
ok('Characters is the distinct-character count, not the dialogue-cue count',
  stats.characters === stats.distinctCharacters && stats.characters !== stats.dialogue, stats);

console.log('\n== 26. Insertion focus box (item 1) ==');
let focusTest = await page.evaluate(() => {
  window.confirm = () => true;
  newScript();
  settings.reuseLastInsertion = true;
  appState.lastInsertion = {};

  formatBlock('character');
  const block = document.querySelector('#editor-page .character');
  const focusedOnInsert = block.classList.contains('insertion-focus');
  const typeWhileFocused = blockType(block);

  document.execCommand('insertText', false, 'MARGO');
  const textAfterTyping = block.innerText;

  // Clicking another format button is the "caret left the block" moment.
  formatBlock('action');
  const focusClearedAfterBlur = !block.classList.contains('insertion-focus');

  return { focusedOnInsert, typeWhileFocused, textAfterTyping, focusClearedAfterBlur };
});
ok('a freshly inserted block wears the outline', focusTest.focusedOnInsert, focusTest);
ok('the outline never leaks into the saved block type', focusTest.typeWhileFocused === 'character', focusTest);
ok('typing over the example replaces it', focusTest.textAfterTyping === 'MARGO', focusTest);
ok('moving to another block clears the outline', focusTest.focusClearedAfterBlur, focusTest);

console.log('\n== 27. Remembered insertions (item 10) ==');
let rememberTest = await page.evaluate(() => {
  // block from test 26 already holds 'MARGO' as a character line; blurring it
  // (the formatBlock('action') call above) should have remembered it.
  formatBlock('character');
  const secondCharacterBlock = document.querySelectorAll('#editor-page .character')[1];
  const reused = secondCharacterBlock.innerText;

  // Dialogue/action are excluded on purpose -- nobody wants the last line back.
  formatBlock('dialogue');
  const dlgBlock = document.querySelector('#editor-page .dialogue');
  document.execCommand('insertText', false, 'A very specific line.');
  formatBlock('character'); // blurs the dialogue block
  formatBlock('dialogue');
  const dlgBlocks = document.querySelectorAll('#editor-page .dialogue');
  const secondDialogueText = dlgBlocks[dlgBlocks.length - 1].innerText;

  return { reused, secondDialogueText, example: BLOCK_EXAMPLES.dialogue };
});
ok('a second Character insert reuses what was typed over the first', rememberTest.reused === 'MARGO', rememberTest);
ok('Dialogue never reuses -- it keeps inserting the generic example',
  rememberTest.secondDialogueText === rememberTest.example, rememberTest);

let reuseToggleTest = await page.evaluate(() => {
  settings.reuseLastInsertion = false;
  formatBlock('character');
  const blocks = document.querySelectorAll('#editor-page .character');
  const text = blocks[blocks.length - 1].innerText;
  settings.reuseLastInsertion = true;
  return { text, example: BLOCK_EXAMPLES.character };
});
ok('turning the setting off falls back to the example again',
  reuseToggleTest.text === reuseToggleTest.example, reuseToggleTest);

console.log('\n== 28. F1 settings persist across a reload ==');
await page.evaluate(() => {
  settings.zoom = 63;
  settings.sceneNumberMode = 'draft';
  settings.reuseLastInsertion = false;
  settings.deckBarPos = { left: 200, top: 55 };
  saveSettings();
});
await page.reload({ waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 400));
let restored = await page.evaluate(() => ({
  zoom: settings.zoom,
  sceneNumberMode: settings.sceneNumberMode,
  reuseLastInsertion: settings.reuseLastInsertion,
  deckBarPos: settings.deckBarPos,
  zoomSliderValue: document.getElementById('zoom-slider').value,
  sceneNumberSelectValue: document.getElementById('scene-number-mode').value,
}));
ok('zoom survives a restart', restored.zoom === 63, restored);
ok('scene-number mode survives a restart', restored.sceneNumberMode === 'draft', restored);
ok('reuse-last-insertion survives a restart', restored.reuseLastInsertion === false, restored);
ok('a dragged deck-bar position survives a restart too',
  restored.deckBarPos && restored.deckBarPos.left === 200 && restored.deckBarPos.top === 55, restored.deckBarPos);
ok('applySettings() pushed zoom onto the slider at boot', restored.zoomSliderValue === '63', restored);
ok('applySettings() pushed scene-number mode onto the select at boot', restored.sceneNumberSelectValue === 'draft', restored);

// Clear it back out so later sections (which check the default top-of-pane
// position) aren't reading a stale drag from this reload test.
await page.evaluate(() => { settings.deckBarPos = null; saveSettings(); });

console.log('\n== 29. Page furniture (F2) + headers/footers/page numbers (items 3, 4) ==');
await loadFileInto(path.resolve(ROOT, 'text/social_network.json'));
let furniture = await page.evaluate(() => {
  const frame = document.querySelector('#editor-page > .page-frame');
  const slots = Array.from(frame.querySelectorAll(':scope > .page-furniture')).map(el => el.dataset.slot);
  const frames = Array.from(document.querySelectorAll('#editor-page > .page-frame'));
  return {
    slotCount: slots.length,
    slots,
    excludedFromGetBlocks: getBlocks().some(b => b.classList.contains('page-furniture')),
    defaultPosition: appState.pageNumber.position,
    defaultShow: appState.pageNumber.show,
    defaultSkipTitle: appState.pageNumber.skipTitlePage,
    defaultBold: appState.pageNumber.bold,
    // skipTitlePage defaults on, and frame 0 is the only "page 1" this app
    // knows about until item 8a gives it a real title-page role -- so by
    // default page 1 is blank and page 2 carries the first visible number.
    page1HeaderRight: frames[0].querySelector(':scope > [data-slot="header-right"]').textContent,
    page2HeaderRight: frames[1] ? frames[1].querySelector(':scope > [data-slot="header-right"]').textContent : null,
    page2HeaderRightBold: frames[1] ? frames[1].querySelector(':scope > [data-slot="header-right"]').classList.contains('furniture-bold') : false,
  };
});
ok('every frame gets all six furniture slots', furniture.slotCount === 6, furniture);
ok('slots are the six header/footer x left/center/right combinations',
  JSON.stringify(furniture.slots.slice().sort()) === JSON.stringify(
    ['footer-center', 'footer-left', 'footer-right', 'header-center', 'header-left', 'header-right'].sort()),
  furniture);
ok('furniture never leaks into getBlocks()', !furniture.excludedFromGetBlocks, furniture);
ok('page numbers default on, header-right, bold, skip title page on',
  furniture.defaultShow && furniture.defaultPosition === 'header-right' && furniture.defaultBold && furniture.defaultSkipTitle, furniture);
ok('page 1 is blank by default (stands in for the title page)', furniture.page1HeaderRight === '', furniture);
ok('page 2 renders "2 / N" in bold by default', /^2 \/ \d+$/.test(furniture.page2HeaderRight) && furniture.page2HeaderRightBold, furniture);

let furnitureEdit = await page.evaluate(() => {
  // Turn off the title-page stand-in so page 1 becomes an ordinary page --
  // this fixture has no real title page, so that's the fairer state to
  // exercise manual templates and the page-number preset against.
  setPageNumberSetting('skipTitlePage', false);
  updateFurnitureTemplate('header-left', 'DRAFT — {date}');
  setPageNumberFormat('Page {page} of {pages}');
  setPageNumberPosition('footer-center');
  const frames = Array.from(document.querySelectorAll('#editor-page > .page-frame'));
  return {
    headerLeftPage1: frames[0].querySelector(':scope > [data-slot="header-left"]').textContent,
    headerRightNowEmpty: frames[0].querySelector(':scope > [data-slot="header-right"]').textContent,
    footerCenterPage1: frames[0].querySelector(':scope > [data-slot="footer-center"]').textContent,
    totalFrames: frames.length,
  };
});
ok('a manual template resolves its token', furnitureEdit.headerLeftPage1.startsWith('DRAFT — '), furnitureEdit);
ok('moving the page-number position vacates the old slot', furnitureEdit.headerRightNowEmpty === '', furnitureEdit);
ok('the new slot shows the new format',
  furnitureEdit.footerCenterPage1 === 'Page 1 of ' + furnitureEdit.totalFrames, furnitureEdit);

// Furniture is layout-neutral by construction (position:absolute, zero flow
// height) -- stuffing every slot with long text must not move a single
// script block to another page. This is the one cross-cutting risk the plan
// calls out by name for F2.
let paginationStability = await page.evaluate(() => {
  const before = getBlocks().length;
  const beforePageCount = document.querySelectorAll('#editor-page > .page-frame').length;
  const beforeFirstBlockText = getBlocks()[0].innerText;
  FURNITURE_SLOTS.forEach(slot => {
    if (slot === 'header-left') return; // already holds a template from the step above
    updateFurnitureTemplate(slot, 'A conspicuously long furniture line meant to stress the layout {page} {pages} {title}');
  });
  reflowPages();
  return {
    before, after: getBlocks().length,
    beforePageCount, afterPageCount: document.querySelectorAll('#editor-page > .page-frame').length,
    firstBlockUnchanged: getBlocks()[0].innerText === beforeFirstBlockText,
  };
});
ok('filling every furniture slot does not change the block count', paginationStability.before === paginationStability.after, paginationStability);
ok('filling every furniture slot does not change the page count', paginationStability.beforePageCount === paginationStability.afterPageCount, paginationStability);
ok('the first block stays put', paginationStability.firstBlockUnchanged, paginationStability);

let skipTitle = await page.evaluate(() => {
  setPageNumberSetting('skipTitlePage', true);
  const frame1 = document.querySelector('#editor-page > .page-frame');
  return {
    headerLeftBlank: frame1.querySelector(':scope > [data-slot="header-left"]').textContent,
    footerCenterBlank: frame1.querySelector(':scope > [data-slot="footer-center"]').textContent,
  };
});
ok('re-enabling skip-title-page blanks every slot on page 1 again, including manual templates',
  skipTitle.headerLeftBlank === '' && skipTitle.footerCenterBlank === '', skipTitle);

// Furniture/page-number settings are document state (appState), so the
// project file has to actually carry them -- scriptJSON() is what Save
// writes to disk, and loadFile()'s .json branch is what reads it back in.
// F3 moved them out of `lists` into their own `settings` key.
let furniturePersists = await page.evaluate(() => {
  const saved = JSON.parse(scriptJSON());
  return {
    formatVersion: saved.formatVersion,
    furniture: saved.settings.furniture,
    pageNumber: saved.settings.pageNumber,
    hasHistory: Array.isArray(saved.history),
    metaDocType: saved.meta.docType,
  };
});
ok('scriptJSON() writes formatVersion 3', furniturePersists.formatVersion === 3, furniturePersists);
ok('scriptJSON() carries the furniture templates under settings, not lists',
  furniturePersists.furniture['header-left'] === 'DRAFT — {date}', furniturePersists);
ok('scriptJSON() carries the page-number preset under settings',
  furniturePersists.pageNumber.position === 'footer-center' &&
  furniturePersists.pageNumber.format === 'Page {page} of {pages}' &&
  furniturePersists.pageNumber.skipTitlePage === true,
  furniturePersists);
ok('scriptJSON() carries a meta block', furniturePersists.metaDocType === 'screenplay', furniturePersists);
ok('scriptJSON() carries a history scaffold', furniturePersists.hasHistory, furniturePersists);

console.log('\n== 30. F3 format v3: round-trip and v2 migration ==');
// Save what's currently open (furniture['header-left'] === 'DRAFT — {date}',
// pageNumber.position === 'footer-center' from the tests above), then load
// that exact v3 JSON back in through the real <input> + loadFile() path --
// not a re-implementation of the migration logic, the actual app code.
const v3FixturePath = path.join(SCRATCH, 'f3-roundtrip.json');
let savedJSON = await page.evaluate(() => scriptJSON());
fs.writeFileSync(v3FixturePath, savedJSON);
await loadFileInto(v3FixturePath);
let v3RoundTrip = await page.evaluate(() => ({
  furniture: appState.furniture['header-left'],
  pageNumberPos: appState.pageNumber.position,
  pageNumberFormat: appState.pageNumber.format,
  metaDocType: docMeta.docType,
}));
ok('v3 round-trips furniture templates through the real load path',
  v3RoundTrip.furniture === 'DRAFT — {date}', v3RoundTrip);
ok('v3 round-trips the page-number preset through the real load path',
  v3RoundTrip.pageNumberPos === 'footer-center' && v3RoundTrip.pageNumberFormat === 'Page {page} of {pages}', v3RoundTrip);
ok('v3 round-trips meta', v3RoundTrip.metaDocType === 'screenplay', v3RoundTrip);

// An old file saved before F3: formatVersion 2, furniture/pageNumber nested
// inside `lists` (as scriptJSON() used to write them, and as real files on
// disk from before this session's F3 work actually are).
const v2FixturePath = path.join(SCRATCH, 'f3-legacy-v2.json');
fs.writeFileSync(v2FixturePath, JSON.stringify({
  formatVersion: 2,
  script: [{ type: 'action', text: 'Legacy content.' }],
  stacks: {},
  lists: {
    characters: ['ALICE'],
    locations: ['KITCHEN'],
    lastInsertion: {},
    furniture: { 'header-left': '', 'header-center': '', 'header-right': '', 'footer-left': '', 'footer-center': '', 'footer-right': 'LEGACY' },
    pageNumber: { show: false, position: 'header-left', format: '1', bold: false, startAt: 1, skipTitlePage: false }
  }
}));
await loadFileInto(v2FixturePath);
let v2Migration = await page.evaluate(() => ({
  charactersCarried: appState.characters[0] === 'ALICE',
  furnitureCarried: appState.furniture['footer-right'] === 'LEGACY',
  pageNumberCarried: appState.pageNumber.show === false,
  metaIsDefault: docMeta.docType === 'screenplay' && docMeta.created === null,
}));
ok('a v2 file (furniture nested in lists) still migrates correctly',
  v2Migration.charactersCarried && v2Migration.furnitureCarried && v2Migration.pageNumberCarried, v2Migration);
ok('a v2 file gets fresh default meta (v2 files never carried one)', v2Migration.metaIsDefault, v2Migration);

console.log('\n== 31. Open Project vs Import Script (item 6) ==');
await loadFileInto(path.resolve(ROOT, 'text/social_network.json'));
let baseline = await page.evaluate(() => ({
  blockCount: getBlocks().length,
  firstText: getBlocks()[0].innerText,
  charCount: appState.characters.length,
  lastSavedName,
}));

const importTxtPath = path.join(SCRATCH, 'import-fixture.txt');
fs.writeFileSync(importTxtPath, 'FADE IN:\n\nEXT. ROOFTOP - NIGHT\n\nAn imported scene.\n');

await importFileInto(importTxtPath, 'current');
let appended = await page.evaluate(() => ({
  blockCount: getBlocks().length,
  firstText: getBlocks()[0].innerText,
  lastText: getBlocks()[getBlocks().length - 1].innerText,
  charCount: appState.characters.length,
  lastSavedName,
}));
ok('append mode grows the block count instead of replacing it',
  appended.blockCount > baseline.blockCount, { baseline, appended });
ok('append mode leaves the original opening block untouched',
  appended.firstText === baseline.firstText, { baseline, appended });
ok('append mode leaves the original entity list untouched',
  appended.charCount === baseline.charCount, { baseline, appended });
ok('append mode lands the imported content at the end',
  appended.lastText === 'An imported scene.', appended);
ok('append mode does not rename the project after the imported file',
  appended.lastSavedName === baseline.lastSavedName, { baseline, appended });

await importFileInto(importTxtPath, 'new');
let replaced = await page.evaluate(() => ({
  blockCount: getBlocks().length,
  firstText: getBlocks()[0].innerText,
  charCount: appState.characters.length,
  furnitureCleared: appState.furniture['footer-right'] === '',
}));
ok('new-project mode replaces the script instead of appending',
  replaced.blockCount < appended.blockCount && replaced.firstText !== appended.firstText, { appended, replaced });
ok('new-project mode resets the entity list', replaced.charCount === 0, replaced);
ok('new-project mode resets document furniture back to defaults', replaced.furnitureCleared, replaced);

let modalGating = await page.evaluate(async () => {
  window.confirm = () => true; // the page.reload() in test 28 dropped the earlier override
  newScript(); // empty project -- nothing worth protecting
  openImportModal();
  const skippedModal = document.getElementById('import-modal').style.display !== 'flex';
  const modeAfterSkip = importIntoMode;
  return { skippedModal, modeAfterSkip };
});
ok('importing into an empty project skips the destination question',
  modalGating.skippedModal, modalGating);
ok('...and defaults straight to new-project mode', modalGating.modeAfterSkip === 'new', modalGating);

await loadFileInto(path.resolve(ROOT, 'text/social_network.json'));
let modalShows = await page.evaluate(() => {
  openImportModal();
  const shown = document.getElementById('import-modal').style.display === 'flex';
  closeImportModal();
  return shown;
});
ok('importing into a project with content asks where it should land', modalShows);

await importFileInto(path.resolve(ROOT, 'text/Lost_1x01_-_Pilot.pdf'), 'new');
let pdfImport = await page.evaluate(() => ({ pdfLoaded, blockCount: getBlocks().length }));
ok('PDF import (new-project mode) still populates Exact View', pdfImport.pdfLoaded === true, pdfImport);
ok('PDF import (new-project mode) still classifies script blocks', pdfImport.blockCount > 50, pdfImport);

if (fs.existsSync(path.resolve(ROOT, 'text/following-1998.pdf'))) {
  await importFileInto(path.resolve(ROOT, 'text/following-1998.pdf'), 'new');
  let followingCheck = await page.evaluate(() => {
    setPaneVisible('editable', true);
    reflowPages();
    const blocks = Array.from(document.querySelectorAll('#editor-page [class]'));
    const p4 = blocks.filter(b => b.dataset && b.dataset.pdfPage === '4');
    const hasCharContd = blocks.some(b => b.className === 'character' && /CONT/i.test(b.innerText));
    const hasFadeToBlack = blocks.some(b => b.className === 'transition' && /FADE TO BLACK/i.test(b.innerText));
    const actionCount = blocks.filter(b => b.className === 'action').length;
    const charCount = blocks.filter(b => b.className === 'character').length;
    const dlgCount = blocks.filter(b => b.className === 'dialogue').length;
    return {
      total: blocks.length,
      p4Count: p4.length,
      hasCharContd,
      hasFadeToBlack,
      actionCount,
      charCount,
      dlgCount,
    };
  });
  ok('following-1998 PDF imports with smart-apostrophe CONT’D character cues', followingCheck.hasCharContd, followingCheck);
  ok('following-1998 classifies FADE TO BLACK as transition', followingCheck.hasFadeToBlack, followingCheck);
  ok('following-1998 page 4 retains rich multi-block structure instead of a single merged wall of text', followingCheck.p4Count > 10, followingCheck);
  ok('following-1998 extracts dialogue and character cues comprehensively', followingCheck.charCount > 500 && followingCheck.dlgCount > 500, followingCheck);
}

console.log('\n== 32. Insert as scene: split a version out of the stack ==');
await loadFileInto(path.resolve(ROOT, 'text/social_network.json'));
let insertSetup = await page.evaluate(() => {
  const b = getBlocks();
  const r = document.createRange();
  r.setStart(b[0], 0);
  r.setEnd(b[10], b[10].childNodes.length);
  const s = window.getSelection();
  s.removeAllRanges(); s.addRange(r);
  addVariation();
  const id = Object.keys(stacks)[0];
  const nodes = blocksOfStack(id);
  const alt = ['A WHOLLY DIFFERENT OPENING--'];
  nodes.forEach((nd, i) => { if (alt[i] !== undefined) nd.innerText = alt[i]; });
  reflowPages(); refreshStacks();
  return { id, blockCountBefore: getBlocks().length, order: stacks[id].order.slice() };
});

let inserted = await page.evaluate(id => {
  const s = stacks[id];
  const runLength = blocksOfStack(id).length;
  openDeck(id);
  // Currently viewing the new alt card (it was left on top by addCardTo).
  const viewingBefore = s.viewing;
  const runBefore = blocksOfStack(id);
  const anchorIndex = getBlocks().indexOf(runBefore[runBefore.length - 1]);
  window.confirm = () => true;
  insertViewedCardAsScript();
  const blocks = getBlocks();
  return {
    viewingBefore,
    runLength,
    anchorIndex,
    blockCountAfter: blocks.length,
    stackGone: !stacks[id],
    insertedText: blocks[anchorIndex + 1] ? blocks[anchorIndex + 1].innerText : null,
    insertedHasStackAttr: blocks[anchorIndex + 1] ? !!blocks[anchorIndex + 1].dataset.stack : null,
    // The stack dissolved, so the surviving run no longer carries data-stack
    // -- read its text back by position instead of by attribute. It sits
    // where the stack always sat, ahead of the newly split-out content.
    remainingRunText: blocks.slice(anchorIndex + 1 - runLength, anchorIndex + 1)
      .map(x => x.innerText).join(' | '),
  };
}, insertSetup.id);

ok('the stack had exactly two versions going in', insertSetup.order.length === 2, insertSetup);
ok('the split-out version lands right after the run it came from',
  inserted.insertedText === 'A WHOLLY DIFFERENT OPENING--', inserted);
ok('the inserted blocks are plain script, not tagged into any stack',
  inserted.insertedHasStackAttr === false, inserted);
ok('the whole varied run landed, not just one block',
  inserted.blockCountAfter === insertSetup.blockCountBefore + inserted.runLength, {
    before: insertSetup.blockCountBefore, after: inserted.blockCountAfter, runLength: inserted.runLength,
  });
// Only one version remains once the other is pulled out -- the stack has
// nothing left to disambiguate, so it dissolves and that lone card becomes
// ordinary script too.
ok('a two-card stack dissolves once the other version is split out', inserted.stackGone === true, inserted);
ok('the remaining scene keeps its original text',
  inserted.remainingRunText.includes('genius IQ') && inserted.remainingRunText.includes('ERICA'),
  inserted);

console.log('\n== 33. Deck bar: top-anchored by default, draggable, and remembers where it lands ==');
await loadFileInto(path.resolve(ROOT, 'text/social_network.json'));
let deckPos = await page.evaluate(() => {
  // Vary a passage well down the page so a passage-anchored bar (the old
  // behaviour) would land far from the top -- proves the new default really
  // is decoupled from where the run sits.
  const b = getBlocks();
  const mid = Math.floor(b.length / 2);
  const r = document.createRange();
  r.setStart(b[mid], 0); r.setEnd(b[mid + 5], b[mid + 5].childNodes.length);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
  addVariation();
  const id = Object.keys(stacks)[0];
  addCardTo(id);   // three versions total, so left/right pickers can land on genuinely distinct cards
  openDeck(id);
  positionDeck();
  const bar = document.getElementById('deck-bar');
  const pane = document.getElementById('pane-editable');
  const br = bar.getBoundingClientRect();
  const pr = pane.getBoundingClientRect();
  return { id, savedBefore: settings.deckBarPos, top: br.top, paneTop: pr.top, visible: bar.style.visibility };
});
ok('nothing dragged yet -- still on the default', deckPos.savedBefore === null, deckPos.savedBefore);
ok('default position sits near the top of the pane, not down by the varied passage',
  deckPos.top >= deckPos.paneTop && deckPos.top < deckPos.paneTop + 40, deckPos);
ok('the bar is visible', deckPos.visible === 'visible', deckPos.visible);

let dragResult = await page.evaluate(() => {
  const grip = document.getElementById('deck-grip');
  const bar = document.getElementById('deck-bar');
  const r = bar.getBoundingClientRect();
  const startX = r.left + 10, startY = r.top + 8;
  const endX = startX + 120, endY = startY + 220;
  grip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: startX, clientY: startY }));
  document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: endX, clientY: endY }));
  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: endX, clientY: endY }));
  return { top: parseFloat(bar.style.top), saved: settings.deckBarPos ? Object.assign({}, settings.deckBarPos) : null };
});
ok('dragging moved the bar down the screen', dragResult.top > 150, dragResult);
ok('the dropped position was saved to settings',
  dragResult.saved && Math.round(dragResult.saved.top) === Math.round(dragResult.top), dragResult);

let afterReopen = await page.evaluate(id => {
  closeDeck();
  openDeck(id);
  const bar = document.getElementById('deck-bar');
  return { top: parseFloat(bar.style.top), savedTop: settings.deckBarPos.top };
}, deckPos.id);
ok('reopening the deck reuses the dragged spot instead of snapping back to the default',
  Math.round(afterReopen.top) === Math.round(afterReopen.savedTop), afterReopen);

let resetResult = await page.evaluate(() => {
  document.getElementById('deck-grip').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  const pane = document.getElementById('pane-editable');
  return {
    saved: settings.deckBarPos,
    top: parseFloat(document.getElementById('deck-bar').style.top),
    paneTop: pane.getBoundingClientRect().top,
  };
});
ok('double-clicking the grip resets the saved position', resetResult.saved === null, resetResult);
ok('...and the bar snaps back to the top', resetResult.top < resetResult.paneTop + 40, resetResult);

console.log('\n== 34. Compare: both sides are pickers, and removed text is highlighted, not struck through ==');
let compareUi = await page.evaluate(id => {
  toggleCompare();
  const head = document.getElementById('compare-head');
  const selects = Array.from(head.querySelectorAll('select'));
  const rightBefore = viewedCard(stacks[id]);
  const leftBefore = compareWith;
  return {
    pickerCount: selects.length,
    leftHasBothOptions: selects[0].options.length === stacks[id].order.length,
    rightIsLiveTagged: selects[1].classList.contains('compare-live'),
    hasLiveTag: !!head.querySelector('.compare-live-tag'),
    hasSwap: !!head.querySelector('.compare-swap'),
    rightBefore, leftBefore,
  };
}, deckPos.id);
ok('both sides of the comparison are pickers', compareUi.pickerCount === 2, compareUi);
ok('the left picker offers every version in the stack', compareUi.leftHasBothOptions, compareUi);
ok('the right picker is marked as the live/editable side', compareUi.rightIsLiveTagged, compareUi);
ok('a "live · editable" tag calls out which side is which', compareUi.hasLiveTag, compareUi);
ok('a swap control is offered', compareUi.hasSwap, compareUi);

let pickRight = await page.evaluate(id => {
  const st = stacks[id];
  // Distinct from both the current right (viewing) AND the current left
  // (compareWith) -- with three cards in the stack there is always one.
  const other = st.order.find(c => c !== viewedCard(st) && c !== compareWith);
  const rightSel = document.querySelectorAll('#compare-head select')[1];
  rightSel.value = other;
  rightSel.dispatchEvent(new Event('change'));
  return { nowViewing: viewedCard(st), picked: other };
}, deckPos.id);
ok('picking a different version on the right actually flips the script to it',
  pickRight.nowViewing === pickRight.picked, pickRight);

let swapResult = await page.evaluate(id => {
  const st = stacks[id];
  const rightBefore = viewedCard(st);
  const leftBefore = compareWith;
  document.querySelector('.compare-swap').click();
  return { rightBefore, leftBefore, rightAfter: viewedCard(st), leftAfter: compareWith };
}, deckPos.id);
ok('swap flips the script to what was on the left', swapResult.rightAfter === swapResult.leftBefore, swapResult);
ok('swap moves the old right side over to the left', swapResult.leftAfter === swapResult.rightBefore, swapResult);

let strikeCheck = await page.evaluate(id => {
  // Replace the text outright so word-level diffing has something to mark
  // as removed (a pure append only produces insertions).
  const first = blocksOfStack(id)[0];
  first.innerText = 'A COMPLETELY REWRITTEN LINE';
  handleInput();
  return null;
}, deckPos.id);
await new Promise(r => setTimeout(r, 1400));   // past the input debounce
let strikeStyle = await page.evaluate(id => {
  const del = document.querySelector('.diff-cell del');
  if (!del) return {
    found: false,
    openStackId, compareWith,
    active: document.getElementById('compare-viewer').classList.contains('active'),
    runLen: blocksOfStack(id).length,
    firstText: blocksOfStack(id)[0] ? blocksOfStack(id)[0].innerText : null,
    bodyText: document.getElementById('compare-body').innerText.slice(0, 200),
  };
  const cs = getComputedStyle(del);
  return { found: true, decoration: cs.textDecorationLine, background: cs.backgroundColor };
}, deckPos.id);
ok('a removed-word <del> actually renders in the diff', strikeStyle.found, strikeStyle);
ok('...with no line-through', strikeStyle.decoration === 'none', strikeStyle);
ok('...just a highlight background so the removed text stays readable',
  strikeStyle.background && strikeStyle.background !== 'rgba(0, 0, 0, 0)', strikeStyle);

let extCheck = await page.evaluate(() => withExtension('MyScript', '.fdproj'));
ok('Save now suggests the .fdproj extension', extCheck === 'MyScript.fdproj', extCheck);

console.log('\n== Console errors ==');
if (errors.length) { errors.slice(0, 12).forEach(e => console.log('  ! ' + e)); fail += errors.length; }
else console.log('  none');

console.log('\n=====================================');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('=====================================');
await browser.close();
process.exit(fail ? 1 : 0);
