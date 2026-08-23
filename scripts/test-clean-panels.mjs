import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PORT = '8763';
const srv = spawn('node', ['scripts/serve.js', PORT], { cwd: 'L:/Projects/fiction/final-drafter', stdio: 'ignore' });
await new Promise(r => setTimeout(r, 1500));

const vendored = 'L:/Projects/fiction/final-drafter/chrome/win64-152.0.7977.42/chrome-win64/chrome.exe';
const browser = await puppeteer.launch({
  executablePath: vendored,
  headless: 'new',
  args: ['--window-size=1600,1000', '--disable-web-security']
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
page.on('dialog', async d => { await d.dismiss(); });
page.on('console', msg => {
  if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text());
});

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra !== undefined ? ' -> ' + JSON.stringify(extra) : '')); }
}

try {
  await page.goto('http://127.0.0.1:' + PORT + '/empty.html', { waitUntil: 'networkidle2' });
  await new Promise(r => setTimeout(r, 1000));

  // 1. Setup 4-Pane Quad mode with populated storyboard
  await page.evaluate(() => {
    FDPanels.setLayoutMode('quad-4');
    const editor = document.getElementById('editor-page');
    if (editor) {
      editor.innerHTML = `
        <div class="scene-heading">INT. MEDICAL BAY - NIGHT</div>
        <div class="action">Grace awakens in the medical capsule.</div>
        <div class="scene-heading">EXT. HAIL MARY - SPACE</div>
        <div class="action">The vessel drifts past the star.</div>
      `;
    }
    FDStoryboard.autoPopulateFromScript();
  });
  await new Promise(r => setTimeout(r, 500));

  // 2. Initial state: Headers visible
  const initInfo = await page.evaluate(() => {
    const btn = document.getElementById('view-btn-clean-panels');
    const headers = Array.from(document.querySelectorAll('.doc-pane:not(.hidden) .pane-header'));
    const isWrapperClean = document.getElementById('editor-wrapper').classList.contains('clean-panel-view');
    return {
      btnFound: !!btn,
      btnActive: btn ? btn.classList.contains('active') : false,
      isWrapperClean,
      headersCount: headers.length,
      headersVisible: headers.every(h => getComputedStyle(h).display !== 'none')
    };
  });

  ok('Clean Panels button exists in topbar', initInfo.btnFound, initInfo);
  ok('Initial state: panel headers visible, wrapper not clean', !initInfo.isWrapperClean && initInfo.headersVisible, initInfo);

  // Take screenshot with standard panel headers
  await page.screenshot({ path: 'L:/Projects/fiction/final-drafter/scripts/panels-with-headers.png' });

  // 3. Click the Clean Panels button
  await page.click('#view-btn-clean-panels');
  await new Promise(r => setTimeout(r, 400));

  const cleanInfo = await page.evaluate(() => {
    const btn = document.getElementById('view-btn-clean-panels');
    const headers = Array.from(document.querySelectorAll('.doc-pane:not(.hidden) .pane-header'));
    const isWrapperClean = document.getElementById('editor-wrapper').classList.contains('clean-panel-view');
    return {
      btnActive: btn ? btn.classList.contains('active') : false,
      isWrapperClean,
      headersHidden: headers.every(h => getComputedStyle(h).display === 'none'),
      cleanPanelsState: layoutState.cleanPanels
    };
  });

  ok('Clean Panels: button became active', cleanInfo.btnActive, cleanInfo);
  ok('Clean Panels: #editor-wrapper has .clean-panel-view class', cleanInfo.isWrapperClean, cleanInfo);
  ok('Clean Panels: all panel headers have display: none', cleanInfo.headersHidden, cleanInfo);
  ok('Clean Panels: layoutState.cleanPanels is true', cleanInfo.cleanPanelsState === true, cleanInfo);

  // Take screenshot of unimpeded clean view
  await page.screenshot({ path: 'L:/Projects/fiction/final-drafter/scripts/panels-clean-unimpeded.png' });
  console.log('Saved clean view screenshot to scripts/panels-clean-unimpeded.png');

  // 4. Test Alt+Z keyboard shortcut toggle
  await page.keyboard.down('Alt');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Alt');
  await new Promise(r => setTimeout(r, 400));

  const restoredInfo = await page.evaluate(() => {
    const btn = document.getElementById('view-btn-clean-panels');
    const headers = Array.from(document.querySelectorAll('.doc-pane:not(.hidden) .pane-header'));
    const isWrapperClean = document.getElementById('editor-wrapper').classList.contains('clean-panel-view');
    return {
      btnActive: btn ? btn.classList.contains('active') : false,
      isWrapperClean,
      headersVisible: headers.every(h => getComputedStyle(h).display !== 'none'),
      cleanPanelsState: layoutState.cleanPanels
    };
  });

  ok('Alt+Z keyboard shortcut restored panel headers', !restoredInfo.isWrapperClean && restoredInfo.headersVisible && !restoredInfo.btnActive, restoredInfo);

} catch (e) {
  console.error('Test execution error:', e);
  fail++;
} finally {
  await browser.close();
  srv.kill();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
