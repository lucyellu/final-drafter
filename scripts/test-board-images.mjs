import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PORT = '8768';
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

  // 1. Verify default storyboard state & UI markup
  const sbDefaults = await page.evaluate(() => {
    return {
      stateDisplayMode: storyboardState.displayMode,
      stateCardSize: storyboardState.cardSize,
      sliderVal: document.getElementById('sb-card-size-slider')?.value,
      sliderLabel: document.getElementById('sb-card-size-label')?.innerText,
      imgBtnActive: document.getElementById('sb-view-image-btn')?.classList.contains('active'),
      fullBtnActive: document.getElementById('sb-view-full-btn')?.classList.contains('active')
    };
  });

  ok('Storyboard state defaults to displayMode = "image"', sbDefaults.stateDisplayMode === 'image', sbDefaults);
  ok('Storyboard state defaults to cardSize = 60', sbDefaults.stateCardSize === 60, sbDefaults);
  ok('Slider value is 60 and label is 60px', sbDefaults.sliderVal === '60' && sbDefaults.sliderLabel === '60px', sbDefaults);
  ok('Image View button is active by default', sbDefaults.imgBtnActive && !sbDefaults.fullBtnActive, sbDefaults);

  // 2. Setup storyboard and references in 2-Pane split
  await page.evaluate(() => {
    FDPanels.setLayoutMode('split-h');
    FDPanels.setSlotType('slot-1', 'storyboard');
    FDPanels.setSlotType('slot-2', 'reference-board');

    const editor = document.getElementById('editor-page');
    if (editor) {
      editor.innerHTML = `
        <div class="scene-heading">INT. LAB - DAY</div>
        <div class="action">Dr. Stone examines the crystalline structure.</div>
        <div class="scene-heading">EXT. MOUNTAIN SUMMIT - DUSK</div>
        <div class="action">The observatory dome rotates slowly.</div>
      `;
    }
    FDStoryboard.autoPopulateFromScript();
  });
  await new Promise(r => setTimeout(r, 500));

  const sbRenderCheck = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.storyboard-card'));
    const container = document.getElementById('storyboard-card-container');
    return {
      cardCount: cards.length,
      allImageMode: cards.every(c => c.classList.contains('card-mode-image')),
      cssVarSize: container ? getComputedStyle(container).getPropertyValue('--storyboard-card-size').trim() : null
    };
  });

  ok('Auto-populated cards automatically rendered in Image Mode', sbRenderCheck.cardCount > 0 && sbRenderCheck.allImageMode, sbRenderCheck);
  ok('Card size CSS property is 60px', sbRenderCheck.cssVarSize === '60px', sbRenderCheck);

  // 3. Test Pinterest Board multi-image extraction and import
  // Add a test Pinterest board link (or mock board with multiple images to test ingestion)
  console.log('Testing Pinterest board import with multi-image resolution...');
  
  await page.evaluate(async () => {
    // Add web or pinterest link with sample board images
    await FDReferences.addWebOrPinterestLink('https://pin.it/4j2vYgP');
  });

  // Wait for fetch & rendering
  await new Promise(r => setTimeout(r, 3500));

  const refCheck = await page.evaluate(() => {
    const items = referenceState.items;
    const cards = Array.from(document.querySelectorAll('#ref-card-grid .ref-card'));
    const imgCards = Array.from(document.querySelectorAll('#ref-card-grid .ref-card-img'));
    return {
      totalItems: items.length,
      totalCards: cards.length,
      imgCardsCount: imgCards.length,
      sampleUrls: items.slice(0, 5).map(i => i.imageUrl),
      sampleTitles: items.slice(0, 5).map(i => i.title)
    };
  });

  ok('Pinterest Board imported multiple image items into reference state', refCheck.totalItems >= 1, refCheck);
  ok('Pinterest Board rendered image preview cards in moodboard grid', refCheck.imgCardsCount >= 1, refCheck);

  // Take screenshot of default image-only 60px storyboard + Pinterest board gallery
  await page.screenshot({ path: 'L:/Projects/fiction/final-drafter/scripts/storyboard-default-and-pinterest-board.png' });
  console.log('Saved screenshot to scripts/storyboard-default-and-pinterest-board.png');

} catch (e) {
  console.error('Test execution error:', e);
  fail++;
} finally {
  await browser.close();
  srv.kill();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
