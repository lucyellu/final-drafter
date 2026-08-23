import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PORT = '8749';
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
page.on('dialog', async d => { console.log('DIALOG:', d.message()); await d.dismiss(); });
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

  // 1. Set 4-Pane Quad & add sample screenplay scenes
  await page.evaluate(() => {
    FDPanels.setLayoutMode('quad-4');
    const editor = document.getElementById('editor-page');
    if (editor) {
      editor.innerHTML = `
        <div class="scene-heading">INT. MEDICAL BAY - NIGHT</div>
        <div class="action">The man groans. He has been out for quite some time. Various life-support tubes connect his body.</div>
        <div class="character">GRACE</div>
        <div class="dialogue">Wh... where am I?</div>
        <div class="scene-heading">EXT. HAIL MARY - SPACE</div>
        <div class="action">The massive exploratory vessel glides across the dark nebula.</div>
        <div class="scene-heading">INT. LAB - DAY</div>
        <div class="action">Rocky inspects the Astrophage container with intricate gestures.</div>
      `;
    }
  });
  await new Promise(r => setTimeout(r, 500));

  // 2. Storyboard: Auto-populate shots from the screenplay scenes
  const sbInfo = await page.evaluate(() => {
    FDStoryboard.autoPopulateFromScript();
    const cards = Array.from(document.querySelectorAll('.storyboard-card'));
    return {
      shotCount: storyboardState.shots.length,
      viewMode: storyboardState.viewMode,
      cardCount: cards.length,
      firstCardHeight: cards[0] ? cards[0].getBoundingClientRect().height : 0,
      firstCardFrameHeight: cards[0] ? cards[0].querySelector('.shot-frame-wrapper').getBoundingClientRect().height : 0,
      hasImage: cards[0] ? !!cards[0].querySelector('.shot-frame-img') : false
    };
  });

  ok('Storyboard auto-populated from script', sbInfo.shotCount === 3, sbInfo);
  ok('Storyboard Grid cards have full height (>200px, not thin bars)', sbInfo.firstCardHeight > 200, sbInfo);
  ok('Storyboard shot frame has proper aspect ratio height (>100px)', sbInfo.firstCardFrameHeight > 100, sbInfo);
  ok('Storyboard has concept art image generated', sbInfo.hasImage, sbInfo);

  // 3. Storyboard: Toggle filmstrip
  await page.evaluate(() => {
    FDStoryboard.toggleViewMode();
  });
  await new Promise(r => setTimeout(r, 400));
  const fsMode = await page.evaluate(() => storyboardState.viewMode);
  ok('Storyboard toggled to filmstrip mode', fsMode === 'filmstrip', fsMode);

  // Switch back to grid
  await page.evaluate(() => {
    FDStoryboard.toggleViewMode();
  });
  await new Promise(r => setTimeout(r, 400));

  // 4. References & Moodboard: Add Pinterest Link
  console.log('Testing Pinterest link metadata fetch...');
  await page.evaluate(async () => {
    await FDReferences.addWebOrPinterestLink('https://pin.it/6n7TcQhKt', 'pinterest');
  });

  // Wait for fetch-meta response
  await new Promise(r => setTimeout(r, 5000));

  const refInfo = await page.evaluate(() => {
    const items = referenceState.items;
    const pinItem = items.find(i => i.isPinterest || (i.linkUrl && i.linkUrl.includes('pin.it')));
    const cards = Array.from(document.querySelectorAll('#ref-card-grid .ref-card'));
    return {
      totalItems: items.length,
      cardCount: cards.length,
      pinItem: pinItem ? {
        title: pinItem.title,
        hasImage: !!pinItem.imageUrl,
        imageUrl: pinItem.imageUrl ? pinItem.imageUrl.slice(0, 60) : null,
        notes: pinItem.notes ? pinItem.notes.slice(0, 60) : null,
        isPinterest: pinItem.isPinterest,
        linkUrl: pinItem.linkUrl
      } : null
    };
  });

  ok('References added Pinterest item', !!refInfo.pinItem, refInfo);
  ok('Pinterest item resolved title', refInfo.pinItem && !refInfo.pinItem.title.includes('Error') && refInfo.pinItem.title.length > 3, refInfo.pinItem);
  ok('Pinterest item fetched image preview', refInfo.pinItem && refInfo.pinItem.hasImage, refInfo.pinItem);
  ok('Pinterest card rendered in DOM', refInfo.cardCount > 0, refInfo.cardCount);

  // 5. References: Add Palette & Note
  await page.evaluate(() => {
    referenceState.items.push({
      id: 'test_pal',
      type: 'palette',
      category: 'lighting',
      title: 'Warm Cinema Palette',
      colors: ['#0f172a', '#38bdf8', '#f59e0b', '#ef4444', '#10b981'],
      notes: 'Key lighting mood'
    });
    referenceState.items.push({
      id: 'test_note',
      type: 'note',
      category: 'directing',
      title: 'Camera Pacing Note',
      notes: 'Keep wide shots lingering on empty corridors.'
    });
    FDReferences.renderReferences();
  });
  await new Promise(r => setTimeout(r, 400));

  // Test category filtering
  await page.evaluate(() => {
    FDReferences.setCategory('lighting');
  });
  await new Promise(r => setTimeout(r, 300));
  const lightingCount = await page.evaluate(() => document.querySelectorAll('#ref-card-grid .ref-card').length);
  ok('Category filtering (lighting) works', lightingCount >= 1, lightingCount);

  await page.evaluate(() => {
    FDReferences.setCategory('all');
  });
  await new Promise(r => setTimeout(r, 300));

  await page.screenshot({ path: 'L:/Projects/fiction/final-drafter/scripts/storyboard-ref-verified.png' });
  console.log('Saved screenshot to scripts/storyboard-ref-verified.png');
} catch (e) {
  console.error('Test execution error:', e);
  fail++;
} finally {
  await browser.close();
  srv.kill();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
