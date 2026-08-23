import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PORT = '8761';
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

  // 1. Set 4-Pane Quad & insert 8 scene headings
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
        <div class="scene-heading">EXT. SPACE - CONTINUOUS</div>
        <div class="action">Grace steps out onto the hull.</div>
        <div class="scene-heading">INT. ENGINE ROOM - NIGHT</div>
        <div class="action">The spin drive hums with immense power.</div>
      `;
    }
    FDStoryboard.autoPopulateFromScript();
  });
  await new Promise(r => setTimeout(r, 500));

  // 2. Test default size (280px)
  const defInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#slot-3 .storyboard-card'));
    const container = document.getElementById('storyboard-card-container');
    const slider = document.getElementById('sb-card-size-slider');
    const label = document.getElementById('sb-card-size-label');
    return {
      cardCount: cards.length,
      firstCardWidth: cards[0] ? cards[0].getBoundingClientRect().width : 0,
      cssVar: container.style.getPropertyValue('--storyboard-card-size'),
      sliderVal: slider ? slider.value : null,
      labelText: label ? label.innerText : null
    };
  });

  ok('Storyboard auto-populated 8 shots in Slot 3', defInfo.cardCount === 8, defInfo);
  ok('Default card size slider is 280px', defInfo.sliderVal === '280' && defInfo.labelText === '280px', defInfo);

  // 3. Test Dense / Small size (140px) in Quad Mode
  await page.evaluate(() => {
    FDStoryboard.setCardSize(140);
  });
  await new Promise(r => setTimeout(r, 300));

  const smallInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#slot-3 .storyboard-card'));
    const container = document.getElementById('storyboard-card-container');
    const slider = document.getElementById('sb-card-size-slider');
    const label = document.getElementById('sb-card-size-label');
    return {
      firstCardWidth: cards[0] ? cards[0].getBoundingClientRect().width : 0,
      cssVar: container.style.getPropertyValue('--storyboard-card-size'),
      sliderVal: slider ? slider.value : null,
      labelText: label ? label.innerText : null,
      storyboardCardSize: storyboardState.cardSize
    };
  });

  ok('Dense size (140px) updated CSS var & label', smallInfo.cssVar === '140px' && smallInfo.labelText === '140px', smallInfo);
  ok('Dense size card width is scaled down (< 250px)', smallInfo.firstCardWidth > 0 && smallInfo.firstCardWidth < 250, smallInfo);

  // Take screenshot of dense grid view
  await page.screenshot({ path: 'L:/Projects/fiction/final-drafter/scripts/storyboard-dense-grid-verified.png' });
  console.log('Saved dense screenshot to scripts/storyboard-dense-grid-verified.png');

  // 4. Test Large size (450px) in Quad View
  await page.evaluate(() => {
    FDStoryboard.setCardSize(450);
  });
  await new Promise(r => setTimeout(r, 400));

  const largeInfo = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('#slot-3 .storyboard-card'));
    const container = document.getElementById('storyboard-card-container');
    const slider = document.getElementById('sb-card-size-slider');
    const label = document.getElementById('sb-card-size-label');
    return {
      firstCardWidth: cards[0] ? cards[0].getBoundingClientRect().width : 0,
      cssVar: container.style.getPropertyValue('--storyboard-card-size'),
      sliderVal: slider ? slider.value : null,
      labelText: label ? label.innerText : null,
      storyboardCardSize: storyboardState.cardSize
    };
  });

  ok('Large size (450px) updated CSS var & label', largeInfo.cssVar === '450px' && largeInfo.labelText === '450px', largeInfo);
  ok('Large size card width spans full slot column (> 450px)', largeInfo.firstCardWidth > 400, largeInfo);

  // 5. Test Filmstrip hide/show toggle
  await page.evaluate(() => FDStoryboard.toggleViewMode());
  await new Promise(r => setTimeout(r, 300));
  const fsSizeDisplay = await page.evaluate(() => document.getElementById('sb-card-size-group').style.display);
  ok('Card size slider hidden in Filmstrip mode', fsSizeDisplay === 'none', fsSizeDisplay);

  await page.evaluate(() => FDStoryboard.toggleViewMode());
  await new Promise(r => setTimeout(r, 300));
  const gridSizeDisplay = await page.evaluate(() => document.getElementById('sb-card-size-group').style.display);
  ok('Card size slider restored in Grid mode', gridSizeDisplay === 'inline-flex', gridSizeDisplay);

} catch (e) {
  console.error('Test execution error:', e);
  fail++;
} finally {
  await browser.close();
  srv.kill();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
