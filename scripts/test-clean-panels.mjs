import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PORT = '8764';
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

  // 1. Setup 4-Pane Quad mode with Script, Video, Storyboard, and the Map
  await page.evaluate(() => {
    layoutState.slots[0].type = 'script-edit';
    layoutState.slots[1].type = 'media-player';
    layoutState.slots[2].type = 'storyboard';
    layoutState.slots[3].type = 'location-map';
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

  // 2. Initial state: Headers and toolbars are visible
  const initInfo = await page.evaluate(() => {
    const btn = document.getElementById('view-btn-clean-panels');
    const headers = Array.from(document.querySelectorAll('.doc-pane:not(.hidden) .pane-header'));
    const sbToolbar = document.querySelector('.storyboard-toolbar');
    const mediaCtrl = document.querySelector('.media-controls-bar');
    return {
      btnFound: !!btn,
      headersVisible: headers.every(h => getComputedStyle(h).display !== 'none'),
      sbToolbarVisible: sbToolbar && getComputedStyle(sbToolbar).display !== 'none',
      mediaCtrlVisible: mediaCtrl && getComputedStyle(mediaCtrl).display !== 'none'
    };
  });

  ok('Initial: Clean Panels button exists', initInfo.btnFound, initInfo);
  ok('Initial: Panel headers and internal toolbars visible', initInfo.headersVisible && initInfo.sbToolbarVisible && initInfo.mediaCtrlVisible, initInfo);

  // Take screenshot with menus visible
  await page.screenshot({ path: 'L:/Projects/fiction/final-drafter/scripts/quad-all-menus-visible.png' });

  // 3. Click the Clean Panels button to hide ALL menus
  await page.click('#view-btn-clean-panels');
  await new Promise(r => setTimeout(r, 400));

  const cleanInfo = await page.evaluate(() => {
    const btn = document.getElementById('view-btn-clean-panels');
    const headers = Array.from(document.querySelectorAll('.doc-pane:not(.hidden) .pane-header'));
    const isWrapperClean = document.getElementById('editor-wrapper').classList.contains('clean-panel-view');
    const sbToolbar = document.querySelector('.storyboard-toolbar');
    const mediaSource = document.querySelector('.media-source-bar');
    const mediaCtrl = document.querySelector('.media-controls-bar');
    const mediaBookmarks = document.querySelector('.media-bookmarks-bar');
    const sbCards = document.getElementById('storyboard-card-container');
    const mediaVideo = document.getElementById('media-video-wrapper');
    const mapStage = document.getElementById('map-stage');

    return {
      btnActive: btn ? btn.classList.contains('active') : false,
      btnText: btn ? btn.innerText : null,
      isWrapperClean,
      headersHidden: headers.every(h => getComputedStyle(h).display === 'none'),
      sbToolbarHidden: sbToolbar && getComputedStyle(sbToolbar).display === 'none',
      mediaSourceHidden: mediaSource && getComputedStyle(mediaSource).display === 'none',
      mediaCtrlHidden: mediaCtrl && getComputedStyle(mediaCtrl).display === 'none',
      mediaBookmarksHidden: mediaBookmarks && getComputedStyle(mediaBookmarks).display === 'none',
      sbCardsVisible: sbCards && getComputedStyle(sbCards).display !== 'none',
      mediaVideoVisible: mediaVideo && getComputedStyle(mediaVideo).display !== 'none',
      mapStageVisible: mapStage && getComputedStyle(mapStage).display !== 'none'
    };
  });

  ok('Clean Panels: button active and labeled Menus Hidden', cleanInfo.btnActive && cleanInfo.btnText.includes('Menus Hidden'), cleanInfo);
  ok('Clean Panels: pane headers hidden', cleanInfo.headersHidden, cleanInfo);
  ok('Clean Panels: storyboard toolbar hidden (autopopulate/add shot/etc)', cleanInfo.sbToolbarHidden, cleanInfo);
  ok('Clean Panels: video player controls & source bars hidden', cleanInfo.mediaSourceHidden && cleanInfo.mediaCtrlHidden && cleanInfo.mediaBookmarksHidden, cleanInfo);
  ok('Clean Panels: main viewer objects remain completely visible', cleanInfo.sbCardsVisible && cleanInfo.mediaVideoVisible && cleanInfo.mapStageVisible, cleanInfo);

  // Take screenshot of pure content view
  await page.screenshot({ path: 'L:/Projects/fiction/final-drafter/scripts/quad-pure-content-clean.png' });
  console.log('Saved pure content screenshot to scripts/quad-pure-content-clean.png');

  // 4. Test Alt+Z keyboard shortcut toggle
  await page.keyboard.down('Alt');
  await page.keyboard.press('KeyZ');
  await page.keyboard.up('Alt');
  await new Promise(r => setTimeout(r, 400));

  const restoredInfo = await page.evaluate(() => {
    const headers = Array.from(document.querySelectorAll('.doc-pane:not(.hidden) .pane-header'));
    const sbToolbar = document.querySelector('.storyboard-toolbar');
    const mediaCtrl = document.querySelector('.media-controls-bar');
    return {
      headersVisible: headers.every(h => getComputedStyle(h).display !== 'none'),
      sbToolbarVisible: sbToolbar && getComputedStyle(sbToolbar).display !== 'none',
      mediaCtrlVisible: mediaCtrl && getComputedStyle(mediaCtrl).display !== 'none'
    };
  });

  ok('Alt+Z keyboard shortcut restored all panel headers & controls', restoredInfo.headersVisible && restoredInfo.sbToolbarVisible && restoredInfo.mediaCtrlVisible, restoredInfo);

} catch (e) {
  console.error('Test execution error:', e);
  fail++;
} finally {
  await browser.close();
  srv.kill();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
