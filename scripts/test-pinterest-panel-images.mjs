// Automated test for Pinterest panel individual images extraction and rendering
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = 'L:/Projects/fiction/final-drafter';

const PORT = 8796;
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
  return new Promise((resolve) => {
    serverProcess = spawn('node', ['scripts/serve.js', String(PORT)], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    serverProcess.stdout.on('data', (d) => {
      const msg = d.toString();
      if (msg.includes('LISTENING:' + PORT)) resolve();
    });

    serverProcess.stderr.on('data', (d) => {
      console.error('[Server Error]', d.toString());
    });

    setTimeout(() => resolve(), 2500);
  });
}

async function run() {
  console.log('Starting server and browser for Pinterest panel verification...');
  await startServer();

  browser = await puppeteer.launch({
    headless: 'new',
    executablePath: CHROME_PATH,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text());
  });

  try {
    // 1. Open empty.html
    await page.goto(`http://127.0.0.1:${PORT}/empty.html`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1000));

    // 2. Switch to single slot with References panel
    await page.evaluate(() => {
      FDPanels.setLayoutMode('single');
      FDPanels.setSlotType('slot-1', 'reference-board');
    });

    await new Promise(r => setTimeout(r, 500));

    // 3. Add Pinterest Board URL
    console.log('Adding Pinterest Board link to references...');
    await page.evaluate(async () => {
      await FDReferences.addWebOrPinterestLink('https://www.pinterest.com/pinterest/art-illustration/', 'pinterest');
    });

    // Wait for async scraping to complete
    console.log('Waiting for metadata and image extraction...');
    await new Promise(r => setTimeout(r, 6000));

    const refData = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#ref-card-grid .ref-card'));
      const activeCat = referenceState.activeCategory;
      const totalItems = referenceState.items.length;
      const pinItems = referenceState.items.filter(i => i.isPinterest || i.category === 'pinterest');
      
      const cardDetails = cards.map(c => {
        const img = c.querySelector('img.ref-card-img');
        const title = c.querySelector('.ref-card-title')?.innerText || '';
        return {
          title,
          hasImgTag: !!img,
          imgSrc: img ? img.src.substring(0, 60) : null,
          hasCover: !!c.querySelector('.ref-link-cover')
        };
      });

      return { activeCat, totalItems, pinCount: pinItems.length, cardCount: cards.length, cardDetails: cardDetails.slice(0, 10) };
    });

    ok('Active category automatically switched to pinterest', refData.activeCat === 'pinterest', refData.activeCat);
    ok('Multiple individual images extracted from Pinterest board', refData.pinCount > 1, { pinCount: refData.pinCount, totalItems: refData.totalItems });
    ok('Individual image cards rendered in References grid', refData.cardCount > 1, { cardCount: refData.cardCount });
    ok('Cards render real img elements rather than plain link covers', refData.cardDetails.length > 0 && refData.cardDetails.every(c => c.hasImgTag), refData.cardDetails);

    // 4. Test Lightbox Zoom on individual image
    console.log('Testing Lightbox Modal zoom on Pinterest image card...');
    await page.evaluate(() => {
      const firstImg = document.querySelector('#ref-card-grid .ref-card img.ref-card-img');
      if (firstImg) firstImg.click();
    });

    await new Promise(r => setTimeout(r, 400));

    const lightboxData = await page.evaluate(() => {
      const modal = document.getElementById('fd-lightbox-modal');
      const img = document.querySelector('#lightbox-img-container img');
      return {
        isActive: modal.classList.contains('active'),
        imgSrc: img ? img.src.substring(0, 60) : null
      };
    });

    ok('Lightbox modal opens on clicking individual Pinterest image', lightboxData.isActive && !!lightboxData.imgSrc, lightboxData);

    // Close lightbox
    await page.evaluate(() => FDLightbox.close());

    // 5. Screenshot
    const screenshotPath = path.join(ROOT, 'scripts', 'pinterest-individual-images-verified.png');
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
  console.log(`\nPinterest Individual Images Test: ${passed ? 'ALL PASSED' : 'FAILED'}`);
  process.exit(process.exitCode || 0);
}

run();
