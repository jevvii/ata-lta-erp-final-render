/**
 * PDF generation service.
 * Uses Puppeteer/Playwright to render HTML templates to PDF.
 *
 * Phase 1 implementation: skeleton.
 */

/**
 * Generate a PDF from an HTML string.
 * @param {Object} params
 * @param {string} params.html
 * @param {Object} [params.options]
 * @returns {Promise<Buffer>}
 */
const generatePdf = async ({ html, options: _options = {} }) => {
  // TODO: initialize Puppeteer/Playwright, render HTML, return Buffer.
  return Buffer.from(html);
};

module.exports = { generatePdf };
