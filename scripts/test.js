const puppeteer = require('puppeteer');
(async () => {
  try {
    const browser = await puppeteer.launch({ executablePath: 'L:/Projects/fiction/final-drafter/chrome/win64-152.0.7977.42/chrome-win64/chrome.exe' });
    const page = await browser.newPage();
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
    await page.goto('file:///L:/Projects/fiction/final-drafter/empty.html');
    const fileInput = await page.$('#file-input');
    await fileInput.uploadFile('L:/Projects/fiction/final-drafter/thesocialnetwork_screenplay.pdf');
    await new Promise(r => setTimeout(r, 2000));
    
    const html = await page.evaluate(() => document.getElementById("editor-page").innerHTML.substring(0, 1000));
    console.log("HTML:", html);
    const scrollHeight = await page.evaluate(() => document.getElementById("editor-page").scrollHeight);
    console.log("ScrollHeight:", scrollHeight);
    
    await browser.close();
  } catch(e) {
    console.error('Puppeteer Error:', e);
  }
})();
