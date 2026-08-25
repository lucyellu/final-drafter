// Inspect Pinterest board parsing
import puppeteer from 'puppeteer';

const CHROME_PATH = 'C:/Users/lucyl/.cache/puppeteer/chrome/win64-152.0.7977.42/chrome-win64/chrome.exe';

async function test(url) {
  console.log('Testing Pinterest scraping on:', url);
  
  // 1. Static fetch
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });
    const html = await res.text();
    console.log('Static fetch status:', res.status, 'HTML length:', html.length);
    const m = html.match(/https?:[\\\/]+[a-zA-Z0-9_\-\.\/\\]*i\.pinimg\.com[a-zA-Z0-9_\-\.\/\\]*\.(?:jpg|png|webp|jpeg)/gi) || [];
    console.log('Static regex pin images found:', m.length);
  } catch (e) {
    console.error('Static fetch err:', e.message);
  }

  // 2. Puppeteer scrape
  try {
    const browser = await puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: 'new',
      args: ['--disable-web-security', '--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36');
    
    const capturedImages = new Set();
    page.on('response', res => {
      const u = res.url();
      if (u.includes('i.pinimg.com') && /\.(jpg|png|webp|jpeg)/i.test(u)) {
        if (!u.includes('/75x75') && !u.includes('/30x30') && !u.includes('/avatars/')) {
          capturedImages.add(u.replace(/\/(?:236x|474x|564x|200x150|75x75_RS)\//, '/736x/'));
        }
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));

    const domImgs = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('img')).map(i => i.src || i.srcset).filter(Boolean);
    });

    domImgs.forEach(s => {
      if (s.includes('i.pinimg.com') && !s.includes('/75x75') && !s.includes('/30x30') && !s.includes('/avatars/')) {
        capturedImages.add(s.replace(/\/(?:236x|474x|564x|200x150|75x75_RS)\//, '/736x/'));
      }
    });

    console.log('Puppeteer scraped images count:', capturedImages.size);
    console.log('First 5 images:', Array.from(capturedImages).slice(0, 5));
    await browser.close();
  } catch (e) {
    console.error('Puppeteer err:', e.message);
  }
}

test('https://www.pinterest.com/pinterest/art-illustration/');
