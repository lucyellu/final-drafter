// Test suite for AI Storyboard Image Generation and Model Provider Hookup
import puppeteer from 'puppeteer';
import http from 'http';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = 'L:/Projects/fiction/final-drafter';

const PORT = 8794;
const CHROME_PATH = 'C:/Users/lucyl/.cache/puppeteer/chrome/win64-152.0.7977.42/chrome-win64/chrome.exe';

let serverProcess = null;
let browser = null;

function ok(name, cond, details = '') {
  if (cond) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name} -> ${JSON.stringify(details)}`);
    process.exitCode = 1;
  }
}

async function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['scripts/serve.js', String(PORT)], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('LISTENING:' + PORT)) {
        resolve();
      }
    });

    serverProcess.stderr.on('data', (d) => {
      console.error('[Server Error]', d.toString());
    });

    setTimeout(() => resolve(), 2500);
  });
}

async function run() {
  console.log('Starting server and browser for AI Generator tests...');
  await startServer();

  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text());
  });

  try {
    // 1. Direct Backend Endpoint Test: POST /api/generate-image
    console.log('Testing /api/generate-image backend endpoint...');
    const testGen = await fetch(`http://127.0.0.1:${PORT}/api/generate-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: 'Cinematic 35mm film frame, dramatic neon cyberpunk lighting, Wide Shot of Doctor examining crystalline artifacts in laboratory',
        aspectRatio: '16:9',
        provider: 'pollinations',
        model: 'flux',
        seed: 12345
      })
    });
    const testGenJson = await testGen.json();
    ok('Backend /api/generate-image returns 200 OK', testGen.status === 200, testGen.status);
    ok('Backend returns valid AI image URL or base64 data', testGenJson.ok && typeof testGenJson.imageUrl === 'string' && (testGenJson.imageUrl.startsWith('http') || testGenJson.imageUrl.startsWith('data:image/')), { ok: testGenJson.ok, imgLen: testGenJson.imageUrl ? testGenJson.imageUrl.length : 0 });

    // 2. Open empty.html in browser
    await page.goto(`http://127.0.0.1:${PORT}/empty.html`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1000));

    // 3. Mount Storyboard in 2-Pane split
    await page.evaluate(() => {
      FDPanels.setLayoutMode('split-h');
      FDPanels.setSlotType('slot-1', 'script-edit');
      FDPanels.setSlotType('slot-2', 'storyboard');

      const editor = document.getElementById('editor-page');
      if (editor) {
        editor.innerHTML = `
          <div class="scene-heading">INT. CYBERPUNK LAB - NIGHT</div>
          <div class="action">Dr. Stone examines the glowing blue crystalline structure under ultraviolet lasers.</div>
          <div class="scene-heading">EXT. MOUNTAIN OBSERVATORY - DUSK</div>
          <div class="action">The massive telescope dome rotates slowly against a golden orange sunset.</div>
        `;
      }
      FDStoryboard.autoPopulateFromScript();
    });

    await new Promise(r => setTimeout(r, 500));

    const initialShots = await page.evaluate(() => {
      return {
        count: storyboardState.shots.length,
        defaultProvider: settings.aiGen.provider,
        shots: storyboardState.shots.map(s => ({
          id: s.id,
          prompt: s.prompt,
          hasImg: !!s.takes.take1.image
        }))
      };
    });

    ok('Storyboard auto-populated 2 shots', initialShots.count === 2, initialShots);
    ok('AI settings default provider is pollinations (Free AI Generator)', initialShots.defaultProvider === 'pollinations', initialShots.defaultProvider);

    // 4. Test Single Shot AI Generation (generateShotFrame)
    console.log('Generating AI frame for Shot 1...');
    await page.evaluate(async () => {
      await FDStoryboard.generateShotFrame(storyboardState.shots[0].id);
    });

    const shot1Data = await page.evaluate(() => {
      const s1 = storyboardState.shots[0];
      const take = s1.takes[s1.viewing];
      const cardImg = document.querySelector('#sb-card-' + s1.id + ' .shot-frame-img');
      return {
        isAi: take.isAi,
        imageLen: take.image ? take.image.length : 0,
        imageIsBase64OrUrl: take.image ? (take.image.startsWith('data:image/') || take.image.startsWith('http')) : false,
        cardImgSrc: cardImg ? cardImg.src.substring(0, 50) : null
      };
    });

    ok('Shot 1 take marked as AI generated', shot1Data.isAi === true, shot1Data);
    ok('Shot 1 image populated with valid AI image data', shot1Data.imageIsBase64OrUrl && shot1Data.imageLen > 50, shot1Data);

    // 5. Test Batch AI Generation (generateAllMissing / #sb-batch-gen-btn)
    console.log('Running Batch Generation for all shots...');
    await page.evaluate(async () => {
      await FDStoryboard.generateAllMissing();
    });

    const allShotsData = await page.evaluate(() => {
      return storyboardState.shots.map(s => {
        const take = s.takes[s.viewing];
        return {
          id: s.id,
          isAi: take.isAi,
          hasValidImage: take.image && (take.image.startsWith('data:image/') || take.image.startsWith('http'))
        };
      });
    });

    ok('All shots in storyboard have AI generated images after Batch Generate', allShotsData.every(s => s.isAi && s.hasValidImage), allShotsData);

    // 6. Test Settings UI Sync
    console.log('Verifying Settings Modal provider controls...');
    await page.evaluate(() => {
      openSettings();
      FDVisualGen.setProvider('gemini');
      FDVisualGen.setGeminiKey('test-api-key-12345');
      FDVisualGen.updateSettingsUI();
    });

    const geminiSettings = await page.evaluate(() => {
      const prov = document.getElementById('ai-provider-select').value;
      const gField = document.getElementById('ai-gemini-fields').style.display;
      const gKey = document.getElementById('ai-gemini-key').value;
      return { prov, gField, gKey };
    });

    ok('Settings UI switches to Gemini provider', geminiSettings.prov === 'gemini', geminiSettings);
    ok('Gemini fields displayed when Gemini selected', geminiSettings.gField === 'flex', geminiSettings);
    ok('Gemini API key saved in settings', geminiSettings.gKey === 'test-api-key-12345', geminiSettings);

    // Reset back to pollinations for standard workflow
    await page.evaluate(() => {
      FDVisualGen.setProvider('pollinations');
      closeSettings();
    });

    // 7. Save Screenshot
    const screenshotPath = path.join(ROOT, 'scripts', 'ai-generator-verified.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`Saved screenshot to ${path.relative(ROOT, screenshotPath)}`);

  } catch (err) {
    console.error('Test execution error:', err);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    if (serverProcess) serverProcess.kill();
  }

  const passed = process.exitCode === 0 || process.exitCode === undefined;
  console.log(`\nAI Generator Test Summary: ${passed ? 'ALL PASSED' : 'SOME TESTS FAILED'}`);
  process.exit(process.exitCode || 0);
}

run();
