// End-to-end check of the Studio Hub: the catalog API, the /media routes, the
// hub page itself, and the hand-off into the editor with a script and a film.
//
// Needs the server running:  node scripts/serve.js 8744
// Run from the repo root:    node scripts/test-studio-hub.mjs [port]
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').split(path.sep).join('/');
const PORT = process.argv[2] || '8744';
const BASE = 'http://127.0.0.1:' + PORT;

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
    args: ['--window-size=1600,1000', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });

const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

// ---------------------------------------------------------------- catalog API
const cat = await (await fetch(BASE + '/api/catalog')).json();
ok('catalog served', !!cat.items, cat.error);
ok('catalog found pairings', cat.items.length > 0, cat.counts);
const sample = cat.items.find(i => i.videos[0].play.level === 'good') || cat.items[0];
console.log('  using: ' + sample.title + ' (' + sample.year + ')');

// --------------------------------------------------------------- media routes
const pdfHead = await fetch(BASE + '/media?p=' + encodeURIComponent(sample.scripts[0].path));
ok('script PDF served', pdfHead.status === 200 && pdfHead.headers.get('content-type') === 'application/pdf',
    pdfHead.status + ' ' + pdfHead.headers.get('content-type'));

const ranged = await fetch(BASE + '/media?p=' + encodeURIComponent(sample.videos[0].path), {
    headers: { Range: 'bytes=0-1023' },
});
const buf = await ranged.arrayBuffer();
ok('video honours Range', ranged.status === 206 && buf.byteLength === 1024,
    ranged.status + ' ' + buf.byteLength + ' ' + ranged.headers.get('content-range'));

const escape1 = await fetch(BASE + '/media?p=' + encodeURIComponent('L:\\Media\\Video\\..\\..\\Windows\\win.ini'));
ok('path escape refused', escape1.status === 403, escape1.status);
const wrongExt = await fetch(BASE + '/media?p=' + encodeURIComponent('L:\\Media\\Video\\notes.txt'));
ok('non-media extension refused', wrongExt.status === 403, wrongExt.status);

// -------------------------------------------------------------------- the hub
await page.goto(BASE + '/hub.html', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 1500));

const hub = await page.evaluate(() => ({
    title: document.getElementById('bb-title').textContent,
    cards: document.querySelectorAll('.card').length,
    matchedRow: document.querySelectorAll('.row')[0]
        ? document.querySelectorAll('.row')[0].querySelectorAll('.card').length : 0,
    rows: Array.from(document.querySelectorAll('.row-title')).map(e => e.textContent),
    dualBtn: !!Array.from(document.querySelectorAll('#bb-actions .btn')).find(b => /Dual/.test(b.textContent)),
}));
ok('hub rendered cards', hub.cards > 0, hub.cards);
ok('matched row has every pairing', hub.matchedRow === cat.items.length, hub);
ok('billboard filled', hub.title && hub.title !== 'Reading library…', hub.title);
ok('billboard offers the dual workspace', hub.dualBtn, hub);

await new Promise(r => setTimeout(r, 2500));   // let a poster or two render
const posters = await page.evaluate(() => document.querySelectorAll('.card-art.loaded').length);
ok('script-page posters render', posters > 0, posters);

await page.screenshot({ path: ROOT + '/scripts/studio-hub-shot.png' });

// search
await page.type('#search', sample.title.slice(0, 6));
await new Promise(r => setTimeout(r, 400));
const filtered = await page.evaluate(() => document.querySelectorAll('.card').length);
ok('search narrows the library', filtered > 0 && filtered < hub.cards, { filtered, all: hub.cards });

// ------------------------------------------------------- hand-off to the editor
const url = BASE + '/empty.html?script=' + encodeURIComponent(sample.scripts[0].path)
    + '&video=' + encodeURIComponent(sample.videos[0].path)
    + '&title=' + encodeURIComponent(sample.title) + '&mode=dual';
await page.goto(url, { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 9000));

const editor = await page.evaluate(() => {
    const v = document.getElementById('media-html5-video');
    const slot1 = document.getElementById('slot-1');
    const slot2 = document.getElementById('slot-2');
    return {
        mode: layoutState.mode,
        slot1: slot1 && slot1.dataset.type,
        slot2: slot2 && slot2.dataset.type,
        slot2Visible: slot2 && !slot2.classList.contains('hidden'),
        blocks: document.querySelectorAll('#editor-page .scene-heading').length,
        pdfPages: document.querySelectorAll('#pdf-viewer canvas').length,
        videoSrc: v ? v.currentSrc || v.src : '',
        videoDuration: v ? v.duration : null,
        videoReady: v ? v.readyState : -1,
        badge: (document.getElementById('media-source-badge') || {}).innerText,
        statPages: (document.getElementById('stat-pages') || {}).innerText,
    };
});
ok('split layout', editor.mode === 'split-h' && editor.slot2Visible, editor);
ok('script pane on the left', /script-/.test(editor.slot1 || ''), editor.slot1);
ok('media player on the right', editor.slot2 === 'media-player', editor.slot2);
ok('screenplay parsed into scenes', editor.blocks > 5, editor.blocks);
ok('PDF pages rendered', editor.pdfPages > 0, editor.pdfPages);
ok('video source points at /media', /\/media\?p=/.test(editor.videoSrc), editor.videoSrc);
ok('video metadata loaded', editor.videoReady >= 1 && editor.videoDuration > 0,
    { ready: editor.videoReady, dur: editor.videoDuration });
ok('badge names the title', /\w/.test(editor.badge || ''), editor.badge);

await page.screenshot({ path: ROOT + '/scripts/dual-workspace-shot.png' });

// ------------------------------------------------- an unplayable container
const mkv = cat.items.find(i => i.videos[0].play.level === 'external');
if (mkv) {
    const url2 = BASE + '/empty.html?script=' + encodeURIComponent(mkv.scripts[0].path)
        + '&video=' + encodeURIComponent(mkv.videos[0].path)
        + '&title=' + encodeURIComponent(mkv.title) + '&mode=dual';
    await page.goto(url2, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 8000));
    const ext = await page.evaluate(() => ({
        notice: (document.getElementById('media-empty-placeholder') || {}).innerText || '',
        blocks: document.querySelectorAll('#editor-page .scene-heading').length,
    }));
    ok('mkv explains itself instead of failing silently', /system player/i.test(ext.notice), ext.notice.slice(0, 120));
    ok('script still loads beside an unplayable film', ext.blocks > 5, ext.blocks);
}

// ------------------------------------- the Studio Hub panel inside the editor
await page.goto(BASE + '/empty.html', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 2500));

const inApp = await page.evaluate(title => {
    FDPanels.setLayoutMode('single');
    FDPanels.setSlotType('slot-1', 'studio-hub');
    FDStudioHub.render();
    const item = STUDIO_CATALOG.find(i => i.title.toLowerCase() === title.toLowerCase());
    return { found: !!item, scriptPath: item && item.scriptPath, videoPath: item && item.videoPath, id: item && item.id };
}, sample.title);
ok('scan merged into the in-app catalog', inApp.found && !!inApp.scriptPath && !!inApp.videoPath, inApp);

// Click the card's own Dual button, the way a person would.
const clicked = await page.evaluate(id => {
    const btns = Array.from(document.querySelectorAll('#studio-rows-container .netflix-card-actions .media-btn'));
    const target = btns.find(b => /Dual/.test(b.textContent) && b.getAttribute('onclick').includes("'" + id + "'"));
    if (!target) return false;
    target.click();
    return true;
}, inApp.id);
ok('found the card button', clicked);

await new Promise(r => setTimeout(r, 9000));
const afterClick = await page.evaluate(() => {
    const v = document.getElementById('media-html5-video');
    return {
        mode: layoutState.mode,
        slot1: (document.getElementById('slot-1') || {}).dataset && document.getElementById('slot-1').dataset.type,
        slot2: document.getElementById('slot-2') && document.getElementById('slot-2').dataset.type,
        blocks: document.querySelectorAll('#editor-page .scene-heading').length,
        videoSrc: v ? v.currentSrc || v.src : '',
        videoDuration: v ? v.duration : null,
        badge: (document.getElementById('media-source-badge') || {}).innerText,
    };
});
ok('in-app hub opens the split', afterClick.mode === 'split-h' && afterClick.slot2 === 'media-player', afterClick);
ok('in-app hub loads that screenplay', afterClick.blocks > 5, afterClick.blocks);
ok('in-app hub loads that film', /\/media\?p=/.test(afterClick.videoSrc) && afterClick.videoDuration > 0,
    { src: afterClick.videoSrc.slice(0, 90), dur: afterClick.videoDuration });
ok('in-app hub names the title in the badge',
    (afterClick.badge || '').toLowerCase().includes(sample.title.toLowerCase()), afterClick.badge);

const realErrors = errors.filter(e => !/favicon|ERR_NAME_NOT_RESOLVED|fonts\.g/.test(e));
ok('no page errors', realErrors.length === 0, realErrors.slice(0, 4));

await browser.close();
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
