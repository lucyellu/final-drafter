// Run from the repo root:  node scripts/test-save.mjs
//
// Covers the File menu's Save / Save As contract:
//   - Save asks where exactly once (the first time), then writes silently.
//   - Save As always asks, and re-attaches the script to the file it gets.
//   - Opening a project through the picker attaches too, so the first Save
//     after an open doesn't ask either.
//
// The File System Access API doesn't exist on file://, so showSaveFilePicker /
// showOpenFilePicker are stubbed with counting fakes -- which is also the only
// way to assert "no dialog appeared" at all.
import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..').split(path.sep).join('/');
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
// A stray prompt()/confirm() would hang the page; auto-dismissing them also
// lets the test notice when the download fallback fires by mistake.
let dialogs = 0;
page.on('dialog', async d => { dialogs++; await d.dismiss(); });

await page.goto('file:///' + ROOT + '/empty.html', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 600));

// --- Install the fakes -------------------------------------------------
await page.evaluate(() => {
  window.__fd = { savePicker: 0, openPicker: 0, writes: [] };
  const makeHandle = name => ({
    name,
    async createWritable() {
      return {
        async write(contents) { window.__fd.writes.push({ name, contents }); },
        async close() {}
      };
    },
    async getFile() {
      return new File([window.__fd.openContents || '{}'], name, { type: 'application/json' });
    }
  });
  window.__fd.makeHandle = makeHandle;
  window.showSaveFilePicker = async opts => {
    window.__fd.savePicker++;
    window.__fd.lastSuggested = opts && opts.suggestedName;
    return makeHandle(window.__fd.nextSaveName || 'picked.fdproj');
  };
  window.showOpenFilePicker = async () => {
    window.__fd.openPicker++;
    return [makeHandle(window.__fd.nextOpenName || 'opened.fdproj')];
  };
});

console.log('\n== 1. Menu wiring ==');
const wiring = await page.evaluate(() => {
  const items = [...document.querySelectorAll('#menu-file .dropdown > div')];
  const find = t => items.find(d => d.textContent.includes(t));
  const call = el => (el ? (el.getAttribute('onclick') || '').replace(/\(.*$/, '') : null);
  const named = n => typeof window[n] === 'function';
  return {
    save: call(find('Save (')),
    saveAs: call(find('Save As')),
    open: call(find('Open Project')),
    saveDefined: named(call(find('Save ('))),
    saveAsDefined: named(call(find('Save As'))),
    openDefined: named(call(find('Open Project')))
  };
});
ok('Save menu item calls a defined function', wiring.saveDefined, wiring);
ok('Save As menu item calls a defined function', wiring.saveAsDefined, wiring);
ok('Open Project menu item calls a defined function', wiring.openDefined, wiring);
ok('Save As is wired to saveAsJSON', wiring.saveAs === 'saveAsJSON', wiring.saveAs);

console.log('\n== 2. First Save asks once, later Saves are silent ==');
await page.evaluate(() => {
  const b = getBlocks()[0];
  if (b) b.innerText = 'INT. TEST ROOM - DAY';
});
await page.evaluate(async () => { await saveJSON(); });
let st = await page.evaluate(() => window.__fd);
ok('first Save opened the save dialog', st.savePicker === 1, st.savePicker);
ok('first Save wrote the file', st.writes.length === 1, st.writes.length);

await page.evaluate(async () => { await saveJSON(); await saveJSON(); });
st = await page.evaluate(() => ({ savePicker: window.__fd.savePicker, writes: window.__fd.writes.length }));
ok('later Saves ask nothing', st.savePicker === 1, st.savePicker);
ok('later Saves still write', st.writes === 3, st.writes);
ok('no prompt()/confirm() fired', dialogs === 0, dialogs);

console.log('\n== 3. Save confirmation toast ==');
const toast = await page.evaluate(() => {
  const el = document.getElementById('save-toast');
  return el ? { text: el.textContent, visible: el.classList.contains('visible') } : null;
});
ok('a save toast is shown', !!toast && toast.visible, toast);
ok('the toast names the file', !!toast && toast.text.includes('picked.fdproj'), toast);

console.log('\n== 4. Save As always asks and re-attaches ==');
await page.evaluate(async () => { window.__fd.nextSaveName = 'other.fdproj'; await saveAsJSON(); });
st = await page.evaluate(() => ({ savePicker: window.__fd.savePicker, writes: window.__fd.writes }));
ok('Save As opened the dialog again', st.savePicker === 2, st.savePicker);
ok('Save As wrote to the new file', st.writes[st.writes.length - 1].name === 'other.fdproj', st.writes.map(w => w.name));

await page.evaluate(async () => { await saveJSON(); });
st = await page.evaluate(() => ({ savePicker: window.__fd.savePicker, writes: window.__fd.writes }));
ok('Save after Save As does not ask', st.savePicker === 2, st.savePicker);
ok('Save after Save As targets the new file', st.writes[st.writes.length - 1].name === 'other.fdproj', st.writes.map(w => w.name));

console.log('\n== 5. Ctrl+S saves, Ctrl+Shift+S saves-as ==');
await page.evaluate(() => document.getElementById('editor-page').focus());
await page.keyboard.down('Control'); await page.keyboard.press('KeyS'); await page.keyboard.up('Control');
await new Promise(r => setTimeout(r, 300));
st = await page.evaluate(() => ({ savePicker: window.__fd.savePicker, writes: window.__fd.writes.length }));
ok('Ctrl+S writes without asking', st.savePicker === 2 && st.writes === 6, st);

await page.keyboard.down('Control'); await page.keyboard.down('Shift');
await page.keyboard.press('KeyS');
await page.keyboard.up('Shift'); await page.keyboard.up('Control');
await new Promise(r => setTimeout(r, 300));
st = await page.evaluate(() => window.__fd.savePicker);
ok('Ctrl+Shift+S opens the save dialog', st === 3, st);

console.log('\n== 6. Open Project attaches, so its first Save is silent ==');
const projectJson = fs.readFileSync(path.resolve(ROOT, 'text/social_network.json'), 'utf8');
await page.evaluate(async json => {
  window.__fd.openContents = json;
  window.__fd.nextOpenName = 'social_network.fdproj';
  await openProjectPicker();
}, projectJson);
await new Promise(r => setTimeout(r, 1500));
const loaded = await page.evaluate(() => getBlocks().length);
ok('the project loaded through the picker', loaded > 100, loaded);
st = await page.evaluate(() => ({ openPicker: window.__fd.openPicker, savePicker: window.__fd.savePicker }));
ok('Open Project used the open dialog', st.openPicker === 1, st.openPicker);

await page.evaluate(async () => { await saveJSON(); });
st = await page.evaluate(() => ({ savePicker: window.__fd.savePicker, writes: window.__fd.writes }));
ok('Save after Open Project does not ask', st.savePicker === 3, st.savePicker);
ok('Save after Open Project writes back to the opened file',
  st.writes[st.writes.length - 1].name === 'social_network.fdproj', st.writes.map(w => w.name));
ok('the written file is valid project JSON',
  (() => { try { return !!JSON.parse(st.writes[st.writes.length - 1].contents).script; } catch { return false; } })());

console.log('\n== 7. New Script detaches, so Save asks again ==');
await page.evaluate(() => { window.confirm = () => true; newScript(); });
await page.evaluate(async () => { await saveJSON(); });
st = await page.evaluate(() => window.__fd.savePicker);
ok('Save after New Script asks where', st === 4, st);

console.log('\n== Page errors ==');
// The Library panel fetches /api/catalog, which only exists behind
// scripts/serve.js -- on file:// that 404 is expected noise, not a regression.
const real = errors.filter(e => !/ERR_FILE_NOT_FOUND/.test(e));
ok('no uncaught page errors', real.length === 0, real.slice(0, 5));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
await browser.close();
process.exit(fail ? 1 : 0);
