/**
 * PDF generation service.
 * Uses Playwright (chromium) to render HTML templates to PDF.
 *
 * Phase 1 implementation: real headless Chromium rendering.
 */

const { chromium } = require('playwright-core');

let browserPromise = null;

/**
 * Lazily launch a shared headless Chromium browser instance.
 * @returns {Promise<import('playwright-core').Browser>}
 */
const getBrowser = () => {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
};

/**
 * Generate a PDF from an HTML string.
 * @param {Object} params
 * @param {string} params.html
 * @param {Object} [params.options]
 * @param {string} [params.options.format]
 * @returns {Promise<Buffer>}
 */
const generatePdf = async ({ html, options = {} }) => {
  const browser = await getBrowser();
  const page = await browser.newPage();

  try {
    await page.setContent(html, { waitUntil: 'networkidle' });
    const pdfBuffer = await page.pdf({
      format: options.format || 'A4',
      printBackground: true,
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });
    return pdfBuffer;
  } finally {
    await page.close();
  }
};

module.exports = { generatePdf };
