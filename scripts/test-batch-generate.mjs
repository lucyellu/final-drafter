// Test suite for the Storyboard Batch Generate popup: options, live progress,
// cancel, honest failure reporting, and the single-slot provider clamp.
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';

const ROOT = 'L:/Projects/fiction/final-drafter';
const PORT = 8795;
const CHROME_PATH = 'C:/Users/lucyl/.cache/puppeteer/chrome/win64-152.0.7977.42/chrome-win64/chrome.exe';

let serverProcess = null;
let browser = null;

function ok(name, cond, details = '') {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.error(`  FAIL  ${name} -> ${JSON.stringify(details)}`); process.exitCode = 1; }
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['scripts/serve.js', String(PORT)], { cwd: ROOT, stdio: ['pipe', 'pipe', 'pipe'] });
    serverProcess.stdout.on('data', d => { if (d.toString().includes('LISTENING:' + PORT)) resolve(); });
    serverProcess.stderr.on('data', d => process.stderr.write('[server] ' + d));
    setTimeout(() => reject(new Error('server start timeout')), 15000);
  });
}

async function run() {
  await startServer();
  browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  const genLogs = [];
  page.on('console', m => { const t = m.text(); if (t.includes('[FDGen]')) genLogs.push(t); });

  await page.goto(`http://127.0.0.1:${PORT}/empty.html`, { waitUntil: 'networkidle2' });

  // --- 1. Wiring ---------------------------------------------------------
  const wiring = await page.evaluate(() => ({
    genLog: typeof window.FDGenLog,
    batch: typeof window.FDStoryboardBatch,
    detailed: typeof FDVisualGen.generateImageDetailed,
    preload: typeof FDVisualGen.preloadImage,
    modal: !!document.getElementById('sb-batch-modal'),
    btnOnclick: document.getElementById('sb-batch-gen-btn').getAttribute('onclick')
  }));
  ok('FDGenLog is exposed', wiring.genLog === 'object', wiring);
  ok('FDStoryboardBatch is exposed', wiring.batch === 'object', wiring);
  ok('generateImageDetailed exists', wiring.detailed === 'function', wiring);
  ok('preloadImage exists', wiring.preload === 'function', wiring);
  ok('Batch modal markup is present', wiring.modal, wiring);
  ok('Toolbar button opens the popup', wiring.btnOnclick === 'FDStoryboardBatch.open()', wiring);

  // --- 2. Clicking Batch Generate opens the popup ------------------------
  await page.evaluate(() => {
    togglePanelType('storyboard');
    for (let i = 0; i < 3; i++) FDStoryboard.addNewShot();
  });
  await new Promise(r => setTimeout(r, 400));
  await page.click('#sb-batch-gen-btn');
  await new Promise(r => setTimeout(r, 300));

  const opened = await page.evaluate(() => ({
    display: getComputedStyle(document.getElementById('sb-batch-modal')).display,
    summary: document.getElementById('sb-batch-scope-summary').innerText,
    scope: document.getElementById('sb-batch-scope').value
  }));
  ok('Popup opens on click', opened.display === 'flex', opened);
  ok('Scope summary is populated', /Will generate/.test(opened.summary), opened);

  // --- 3. Offline provider is called out, not silently accepted ----------
  const offlineWarn = await page.evaluate(() => {
    document.getElementById('sb-batch-provider').value = 'offline';
    FDStoryboardBatch.onProviderChange();
    const w = document.getElementById('sb-batch-warning');
    return { shown: w.style.display, text: w.innerText };
  });
  ok('Offline provider raises a warning', offlineWarn.shown === 'flex' && /no AI image/i.test(offlineWarn.text), offlineWarn);

  // --- 4. An offline run reports placeholders, not successes -------------
  await page.evaluate(() => {
    document.getElementById('sb-batch-scope').value = 'all';
    FDStoryboardBatch.onScopeChange();
    document.getElementById('sb-batch-start-btn').click();
  });
  await page.waitForFunction(() => !FDStoryboardBatch.running, { timeout: 30000 });

  const offlineRun = await page.evaluate(() => ({
    stats: FDStoryboardBatch.stats,
    title: document.getElementById('sb-batch-title').innerText,
    lines: [...document.querySelectorAll('#sb-batch-log div')].map(d => d.innerText)
  }));
  ok('Offline run counts 0 real frames', offlineRun.stats.ok === 0, offlineRun.stats);
  ok('Offline run counts every shot as a placeholder', offlineRun.stats.placeholder === 3, offlineRun.stats);
  ok('Run reports completion', /Complete/i.test(offlineRun.title), offlineRun.title);
  ok('Progress log recorded each shot', offlineRun.lines.length >= 5, offlineRun.lines);
  ok('[FDGen] console trace was emitted', genLogs.length > 0, genLogs.slice(0, 3));

  // --- 5. Concurrency is clamped for single-slot providers ---------------
  const clamp = await page.evaluate(() => {
    FDStoryboardBatch.showOptions();
    document.getElementById('sb-batch-provider').value = 'pollinations';
    document.getElementById('sb-batch-concurrency').value = '4';
    FDStoryboardBatch.onProviderChange();
    return {
      warned: document.getElementById('sb-batch-warning').style.display,
      effective: FDStoryboardBatch.effectiveConcurrency('pollinations'),
      offEffective: FDStoryboardBatch.effectiveConcurrency('openai')
    };
  });
  ok('High concurrency on Pollinations is warned about', clamp.warned === 'flex', clamp);
  ok('Pollinations concurrency clamps to 1', clamp.effective === 1, clamp);
  ok('Other providers keep the chosen concurrency', clamp.offEffective === 4, clamp);

  // --- 6. Cancel stops a run and keeps finished work ---------------------
  const cancelled = await page.evaluate(async () => {
    FDStoryboardBatch.showOptions();
    document.getElementById('sb-batch-provider').value = 'offline';
    document.getElementById('sb-batch-scope').value = 'all';
    FDStoryboardBatch.onScopeChange();
    FDStoryboardBatch.onProviderChange();
    for (let i = 0; i < 12; i++) FDStoryboard.addNewShot();
    FDStoryboardBatch.showOptions();
    document.getElementById('sb-batch-start-btn').click();
    await new Promise(r => setTimeout(r, 400));
    FDStoryboardBatch.cancel();
    await new Promise(r => setTimeout(r, 2500));
    return {
      running: FDStoryboardBatch.running,
      done: FDStoryboardBatch.stats.done,
      total: FDStoryboardBatch.stats.total,
      title: document.getElementById('sb-batch-title').innerText,
      barCancelled: document.getElementById('sb-batch-bar-fill').className
    };
  });
  ok('Cancel stops the run', cancelled.running === false, cancelled);
  ok('Cancel stops short of the full queue', cancelled.done < cancelled.total, cancelled);
  ok('Cancelled runs say so', /Cancelled/i.test(cancelled.title), cancelled);
  ok('Progress bar shows the cancelled state', /cancelled/.test(cancelled.barCancelled), cancelled);

  // --- 7. Backend failure is reported, not swallowed ---------------------
  const failure = await page.evaluate(async () => {
    const realFetch = window.fetch;
    window.fetch = async (u, o) => {
      if (String(u).includes('/api/generate-image')) {
        return new Response(JSON.stringify({ ok: false, error: 'simulated upstream outage', rateLimited: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return realFetch(u, o);
    };
    const r = await FDVisualGen.generateImageDetailed('a test frame', {
      providerOverrides: { provider: 'openai', openaiModel: 'dall-e-3' }, label: 'TEST'
    });
    window.fetch = realFetch;
    return { source: r.source, isAi: r.isAi, error: r.error };
  });
  ok('A failed generate is marked as not-AI', failure.isAi === false, failure);
  ok('A failed generate falls back to a labelled placeholder', failure.source === 'offline-fallback', failure);
  ok('A failed generate carries the reason', /simulated upstream outage/.test(failure.error || ''), failure);

  console.log('\n[FDGen] console lines captured:', genLogs.length);
}

run()
  .catch(err => { console.error('SUITE ERROR:', err); process.exitCode = 1; })
  .finally(async () => {
    if (browser) await browser.close();
    if (serverProcess) serverProcess.kill();
  });
