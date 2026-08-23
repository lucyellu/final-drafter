import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PORT = '8762';
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

  // 1. Set 4-Pane Quad & insert scenes
  await page.evaluate(() => {
    FDPanels.setLayoutMode('quad-4');
    const editor = document.getElementById('editor-page');
    if (editor) {
      editor.innerHTML = `
        <div class="scene-heading">INT. MEDICAL BAY - NIGHT</div>
        <div class="action">Grace awakens in the medical capsule.</div>
        <div class="scene-heading">EXT. HAIL MARY - SPACE</div>
        <div class="action">The vessel drifts past the star.</div>
        <div class="scene-heading">INT. LAB - DAY</div>
        <div class="action">Rocky inspects the Astrophage container.</div>
        <div class="scene-heading">EXT. ERID - ORBIT</div>
        <div class="action">The alien world looms in the window.</div>
        <div class="scene-heading">INT. BRIDGE - NIGHT</div>
        <div class="action">Navigation monitors flash red alerts.</div>
        <div class="scene-heading">INT. AIRLOCK - DAY</div>
        <div class="action">Grace suits up for the EVA.</div>
      `;
    }
    FDStoryboard.autoPopulateFromScript();
  });
  await new Promise(r => setTimeout(r, 500));

  // --- Test 1: Size down to 60px ---
  await page.evaluate(() => {
    FDStoryboard.setCardSize(60);
  });
  await new Promise(r => setTimeout(r, 300));

  const size60Info = await page.evaluate(() => {
    const slider = document.getElementById('sb-card-size-slider');
    const label = document.getElementById('sb-card-size-label');
    const container = document.getElementById('storyboard-card-container');
    return {
      min: slider ? slider.min : null,
      val: slider ? slider.value : null,
      labelText: label ? label.innerText : null,
      cssVar: container ? container.style.getPropertyValue('--storyboard-card-size') : null
    };
  });

  ok('Size slider minimum attribute is 60', size60Info.min === '60', size60Info);
  ok('Size slider set to 60px updates value, label and CSS var', size60Info.val === '60' && size60Info.labelText === '60px' && size60Info.cssVar === '60px', size60Info);

  // --- Test 2: Image Only View Mode ---
  await page.evaluate(() => {
    FDStoryboard.setDisplayMode('image');
    FDStoryboard.setCardSize(100);
  });
  await new Promise(r => setTimeout(r, 400));

  const imageModeInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#slot-3 .storyboard-card'));
    const btnImg = document.getElementById('sb-view-image-btn');
    const btnFull = document.getElementById('sb-view-full-btn');
    return {
      cardCount: cards.length,
      allHaveImageClass: cards.every(c => c.classList.contains('card-mode-image')),
      hasFrames: cards.every(c => c.querySelector('.shot-frame-wrapper')),
      hasNoTextareas: cards.every(c => !c.querySelector('textarea')),
      hasHeaders: cards.every(c => c.querySelector('.shot-image-only-header')),
      imgBtnActive: btnImg ? btnImg.classList.contains('active') : false,
      fullBtnInactive: btnFull ? !btnFull.classList.contains('active') : false
    };
  });

  ok('Image Mode: all cards have .card-mode-image class', imageModeInfo.allHaveImageClass, imageModeInfo);
  ok('Image Mode: renders image frames with header badge/name', imageModeInfo.hasFrames && imageModeInfo.hasHeaders, imageModeInfo);
  ok('Image Mode: completely omits textareas and prompt boxes', imageModeInfo.hasNoTextareas, imageModeInfo);
  ok('Image Mode: button pill active state synced', imageModeInfo.imgBtnActive && imageModeInfo.fullBtnInactive, imageModeInfo);

  // Capture screenshot of Image mode contact sheet
  await page.screenshot({ path: 'L:/Projects/fiction/final-drafter/scripts/storyboard-image-mode-verified.png' });
  console.log('Saved image mode screenshot to scripts/storyboard-image-mode-verified.png');

  // --- Test 3: Text Only View Mode ---
  await page.evaluate(() => {
    FDStoryboard.setDisplayMode('text');
    FDStoryboard.setCardSize(240);
  });
  await new Promise(r => setTimeout(r, 400));

  const textModeInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#slot-3 .storyboard-card'));
    const btnTxt = document.getElementById('sb-view-text-btn');
    return {
      cardCount: cards.length,
      allHaveTextClass: cards.every(c => c.classList.contains('card-mode-text')),
      hasNoFrames: cards.every(c => !c.querySelector('.shot-frame-wrapper')),
      hasTextareas: cards.every(c => !!c.querySelector('.shot-action-input')),
      hasPromptInputs: cards.every(c => !!c.querySelector('.shot-prompt-input')),
      txtBtnActive: btnTxt ? btnTxt.classList.contains('active') : false
    };
  });

  ok('Text Mode: all cards have .card-mode-text class', textModeInfo.allHaveTextClass, textModeInfo);
  ok('Text Mode: completely omits heavy image frames', textModeInfo.hasNoFrames, textModeInfo);
  ok('Text Mode: renders action textareas and prompt inputs', textModeInfo.hasTextareas && textModeInfo.hasPromptInputs, textModeInfo);
  ok('Text Mode: button pill active state synced', textModeInfo.txtBtnActive, textModeInfo);

  // Capture screenshot of Text mode beat outline
  await page.screenshot({ path: 'L:/Projects/fiction/final-drafter/scripts/storyboard-text-mode-verified.png' });
  console.log('Saved text mode screenshot to scripts/storyboard-text-mode-verified.png');

  // --- Test 4: Switch Back to Full View Mode ---
  await page.evaluate(() => {
    FDStoryboard.setDisplayMode('full');
    FDStoryboard.setCardSize(280);
  });
  await new Promise(r => setTimeout(r, 400));

  const fullModeInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#slot-3 .storyboard-card'));
    const btnFull = document.getElementById('sb-view-full-btn');
    return {
      cardCount: cards.length,
      hasFrames: cards.every(c => !!c.querySelector('.shot-frame-wrapper')),
      hasTextareas: cards.every(c => !!c.querySelector('.shot-action-input')),
      hasTakeTabs: cards.every(c => !!c.querySelector('.shot-take-tabs')),
      fullBtnActive: btnFull ? btnFull.classList.contains('active') : false
    };
  });

  ok('Full Mode: renders frames, take tabs, and action inputs', fullModeInfo.hasFrames && fullModeInfo.hasTextareas && fullModeInfo.hasTakeTabs, fullModeInfo);
  ok('Full Mode: full view button pill active', fullModeInfo.fullBtnActive, fullModeInfo);

} catch (e) {
  console.error('Test execution error:', e);
  fail++;
} finally {
  await browser.close();
  srv.kill();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
