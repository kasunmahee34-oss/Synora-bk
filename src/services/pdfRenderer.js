const puppeteer = require('puppeteer');
let browser = null;

async function getBrowser() {
  if (browser) return browser;
  browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  return browser;
}

async function renderPdfFromHtml(html, options = {}) {
  const b = await getBrowser();
  const page = await b.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdf = await page.pdf({ format: 'A4', printBackground: true, ...(options || {}) });
  await page.close();
  return pdf;
}

async function closeBrowser() {
  if (browser) {
    try {
      await browser.close();
    } catch (e) {
      // ignore
    }
    browser = null;
  }
}

// Clean up on process exit
process.on('exit', () => {
  if (browser) {
    browser.close().catch(() => {});
    browser = null;
  }
});

module.exports = { renderPdfFromHtml, closeBrowser };