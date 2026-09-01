import puppeteer from 'puppeteer';
import fs from 'node:fs';
const ROOT = 'L:/Projects/fiction/final-drafter';
const vendored = (fs.existsSync(ROOT + '/chrome') ? fs.readdirSync(ROOT + '/chrome').map(d => ROOT + '/chrome/' + d + '/chrome-win64/chrome.exe') : []).find(p => fs.existsSync(p));
const b = await puppeteer.launch({ ...(vendored ? { executablePath: vendored } : {}), headless: 'new', args: ['--allow-file-access-from-files', '--window-size=1900,1100'] });
const page = await b.newPage();
await page.setViewport({ width: 1900, height: 1100 });
page.on('pageerror', e => console.log('ERR', String(e)));
page.on('dialog', d => d.accept());
await page.goto('file:///' + ROOT + '/empty.html', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 1200));

await page.evaluate(() => {
  setLayoutMode('single');
  const editor = document.getElementById('editor-page');
  editor.querySelectorAll(':scope > .page-frame').forEach(f => f.remove());
  const frame = createPageFrame();
  editor.appendChild(frame);
  [
    ['scene-heading', 'INT. GREEN HILL ZONE - CONTINUOUS'],
    ['action', 'SONIC coils, releases, and is gone. The rings scatter behind him like small change from a torn pocket.'],
    ['character', 'SONIC'],
    ['dialogue', "I suppose one could say that speed is, perchance, its own kind of prison."],
    ['action', 'He does not slow down. He has never once slowed down.'],
    ['character', 'TAILS'],
    ['parenthetical', '(quietly)'],
    ['dialogue', 'You collect them. You never spend them.'],
    ['action', 'A loop. Then another loop. The physics engine dictates the terms and Sonic accepts them without comment.'],
    ['transition', 'CUT TO:'],
    ['scene-heading', 'EXT. CHEMICAL PLANT - LATER'],
    ['action', 'Water rises. It always rises. The chili dog goes uneaten on the ledge above.'],
  ].forEach(([c, t]) => { const d = document.createElement('div'); d.className = c; d.innerText = t; frame.appendChild(d); });
  reflowPages(); buildToc(); extractEntities(); updateStatistics();
});
await new Promise(r => setTimeout(r, 500));

const selectIn = (i, s) => page.evaluate((i, s) => {
  const b = getBlocks()[i];
  const w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const at = n.nodeValue.indexOf(s);
    if (at === -1) continue;
    const r = document.createRange();
    r.setStart(n, at); r.setEnd(n, at + s.length);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    return true;
  }
  return false;
}, i, s);

await selectIn(3, 'perchance,'); await page.evaluate(() => FDMarkup.mark('strike'));
await selectIn(3, 'its own kind of prison'); await page.evaluate(() => FDMarkup.mark('squiggle'));
await selectIn(1, 'like small change from a torn pocket'); await page.evaluate(() => FDMarkup.mark('circle'));
await selectIn(8, 'The physics engine dictates the terms'); await page.evaluate(() => setHighlighterColor('#fff176'));
await new Promise(r => setTimeout(r, 200));

await selectIn(3, 'I suppose one could say that speed is');
await page.evaluate(() => FDMarkup.addNote('Nobody talks like this. Contract it — "Speed\'s its own prison." Six words, same idea.'));
await selectIn(7, 'You collect them. You never spend them.');
await page.evaluate(() => { const id = FDMarkup.addNote('This is the whole film in one line. Move it later — it lands too early here.'); FDMarkup.setColor(id, '#2f7d52'); });
await selectIn(11, 'The chili dog goes uneaten');
await page.evaluate(() => { const id = FDMarkup.addNote('Do we need the chili dog? Feels like fan service. Ask before the next pass.'); FDMarkup.setColor(id, '#c77d0a'); });
await new Promise(r => setTimeout(r, 700));

await page.screenshot({ path: ROOT + '/scripts/markup-marked-up.png' });
await page.evaluate(() => FDMarkup.setVisible(false));
await new Promise(r => setTimeout(r, 500));
await page.screenshot({ path: ROOT + '/scripts/markup-clean-read.png' });
await page.evaluate(() => FDMarkup.setVisible(true));
await new Promise(r => setTimeout(r, 400));

console.log('\n========= BRIEF =========\n');
console.log(await page.evaluate(() => FDMarkup.buildBrief()));
await b.close();
