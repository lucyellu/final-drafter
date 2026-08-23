import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

const PORT = '8754';
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

  // --- Test 1: Split-H (2-Pane Horizontal) Resizing ---
  await page.evaluate(() => FDPanels.setLayoutMode('split-h'));
  await new Promise(r => setTimeout(r, 300));

  let split1El = await page.$('#pane-splitter-1');
  let split1Box = await split1El.boundingBox();
  
  // Drag splitter to the right (move from box.x to box.x + 200)
  await page.mouse.move(split1Box.x + split1Box.width / 2, split1Box.y + split1Box.height / 2);
  await page.mouse.down();
  await page.mouse.move(split1Box.x + 200, split1Box.y + split1Box.height / 2, { steps: 5 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 300));

  const splitHRatios = await page.evaluate(() => {
    const s1 = document.getElementById('slot-1').getBoundingClientRect();
    const s2 = document.getElementById('slot-2').getBoundingClientRect();
    return { s1Width: s1.width, s2Width: s2.width, ratio: layoutState.splitRatio };
  });

  ok('Split-H: Slot 1 grew larger than Slot 2 after dragging splitter right', splitHRatios.s1Width > splitHRatios.s2Width + 200, splitHRatios);
  ok('Split-H: layoutState.splitRatio updated (> 0.55)', splitHRatios.ratio > 0.55, splitHRatios);

  // Split-H double-click reset
  await page.evaluate(() => {
    document.getElementById('pane-splitter-1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 300));
  const splitHReset = await page.evaluate(() => layoutState.splitRatio);
  ok('Split-H: double-click reset ratio to 0.5', Math.abs(splitHReset - 0.5) < 0.01, splitHReset);

  // --- Test 2: Split-V (2-Pane Vertical) Resizing ---
  await page.evaluate(() => FDPanels.setLayoutMode('split-v'));
  await new Promise(r => setTimeout(r, 300));

  split1El = await page.$('#pane-splitter-1');
  let splitVBox = await split1El.boundingBox();
  await page.mouse.move(splitVBox.x + splitVBox.width / 2, splitVBox.y + splitVBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(splitVBox.x + splitVBox.width / 2, splitVBox.y + 150, { steps: 5 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 300));

  const splitVRatios = await page.evaluate(() => {
    const s1 = document.getElementById('slot-1').getBoundingClientRect();
    const s2 = document.getElementById('slot-2').getBoundingClientRect();
    return { s1Height: s1.height, s2Height: s2.height, ratio: layoutState.splitVRatio };
  });

  ok('Split-V: Slot 1 height grew after dragging splitter down', splitVRatios.s1Height > splitVRatios.s2Height + 100, splitVRatios);
  ok('Split-V: layoutState.splitVRatio updated (> 0.55)', splitVRatios.ratio > 0.55, splitVRatios);

  // --- Test 3: Studio-3 (3-Pane Studio) Resizing ---
  await page.evaluate(() => FDPanels.setLayoutMode('studio-3'));
  await new Promise(r => setTimeout(r, 300));

  split1El = await page.$('#pane-splitter-1');
  const studioSplit1Box = await split1El.boundingBox();
  await page.mouse.move(studioSplit1Box.x + studioSplit1Box.width / 2, studioSplit1Box.y + 100);
  await page.mouse.down();
  await page.mouse.move(studioSplit1Box.x - 150, studioSplit1Box.y + 100, { steps: 5 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 300));

  const splitHEl = await page.$('#pane-splitter-h');
  const splitHBox = await splitHEl.boundingBox();
  await page.mouse.move(splitHBox.x + splitHBox.width / 2, splitHBox.y + splitHBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(splitHBox.x + splitHBox.width / 2, splitHBox.y + 100, { steps: 5 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 300));

  const studioRatios = await page.evaluate(() => {
    const s1 = document.getElementById('slot-1').getBoundingClientRect();
    const s2 = document.getElementById('slot-2').getBoundingClientRect();
    const s3 = document.getElementById('slot-3').getBoundingClientRect();
    return {
      s1Width: s1.width,
      s2Width: s2.width,
      s2Height: s2.height,
      s3Height: s3.height,
      hRatio: layoutState.studioHRatio,
      vRatio: layoutState.studioVRatio
    };
  });

  ok('Studio-3: Vertical column splitter adjusted width', studioRatios.hRatio < 0.48, studioRatios);
  ok('Studio-3: Horizontal row splitter adjusted height', studioRatios.vRatio > 0.52, studioRatios);

  // --- Test 4: Quad-4 (4-Pane Quad) Resizing ---
  await page.evaluate(() => FDPanels.setLayoutMode('quad-4'));
  await new Promise(r => setTimeout(r, 300));

  // Drag center handle in Quad mode
  const centerEl = await page.$('#pane-splitter-center');
  const centerBox = await centerEl.boundingBox();

  await page.mouse.move(centerBox.x + centerBox.width / 2, centerBox.y + centerBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(centerBox.x + 120, centerBox.y - 100, { steps: 5 });
  await page.mouse.up();
  await new Promise(r => setTimeout(r, 300));

  const quadRatios = await page.evaluate(() => {
    const s1 = document.getElementById('slot-1').getBoundingClientRect();
    const s2 = document.getElementById('slot-2').getBoundingClientRect();
    const s3 = document.getElementById('slot-3').getBoundingClientRect();
    const s4 = document.getElementById('slot-4').getBoundingClientRect();
    return {
      s1: { w: s1.width, h: s1.height },
      s2: { w: s2.width, h: s2.height },
      s3: { w: s3.width, h: s3.height },
      s4: { w: s4.width, h: s4.height },
      colRatio: layoutState.quadColRatio,
      rowRatio: layoutState.quadRowRatio
    };
  });

  ok('Quad-4: Center drag resized columns (Col 1 > Col 2)', quadRatios.s1.w > quadRatios.s2.w + 100, quadRatios);
  ok('Quad-4: Center drag resized rows (Row 2 > Row 1)', quadRatios.s3.h > quadRatios.s1.h + 100, quadRatios);
  ok('Quad-4: State updated quadColRatio and quadRowRatio', quadRatios.colRatio > 0.53 && quadRatios.rowRatio < 0.47, quadRatios);

  // Capture screenshot of adjusted Quad layout
  await page.screenshot({ path: 'L:/Projects/fiction/final-drafter/scripts/adjustable-panels-verified.png' });
  console.log('Saved screenshot to scripts/adjustable-panels-verified.png');

} catch (e) {
  console.error('Test execution error:', e);
  fail++;
} finally {
  await browser.close();
  srv.kill();
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
