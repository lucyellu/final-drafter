const puppeteer = require('puppeteer');
(async () => {
  try {
    const browser = await puppeteer.launch({ executablePath: 'L:/Projects/fiction/final-drafter/chrome/win64-152.0.7977.42/chrome-win64/chrome.exe' });
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
    await page.goto('file:///L:/Projects/fiction/final-drafter/empty.html');
    const fileInput = await page.$('#file-input');
    await fileInput.uploadFile('L:/Projects/fiction/final-drafter/text/thesocialnetwork_screenplay.pdf');
    await new Promise(r => setTimeout(r, 4000));
    
    const pages = await page.evaluate(() => document.getElementById('stat-pages').innerText);
    const chars = await page.evaluate(() => document.getElementById('stat-chars').innerText);
    const words = await page.evaluate(() => document.getElementById('stat-words').innerText);
    console.log('Pages:', pages);
    console.log('Chars:', chars);
    console.log('Words:', words);
    
    await browser.close();
  } catch(e) {
    console.error('Puppeteer Error:', e);
  }
})();
