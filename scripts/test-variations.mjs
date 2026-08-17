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

async function loadFileInto(filePath) {
  const input = await page.$('#file-input');
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
ok('formatVersion 2', parsed.formatVersion === 2);
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
ok('folded project serializes', foldedRt.fv === 2 && foldedRt.stacks >= 1, foldedRt);
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

console.log('\n== Console errors ==');
if (errors.length) { errors.slice(0, 12).forEach(e => console.log('  ! ' + e)); fail += errors.length; }
else console.log('  none');

console.log('\n=====================================');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
console.log('=====================================');
await browser.close();
process.exit(fail ? 1 : 0);
