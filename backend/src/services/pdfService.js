/**
 * PDF generation service.
 * Uses Playwright (chromium) to render HTML templates to PDF.
 *
 * Production hardening (Spec 1.1):
 * - Low-memory Chromium launch flags so headless Chrome fits inside the
 *   Render starter container alongside the Node.js process.
 * - A FIFO concurrency mutex allowing at most 1 concurrent PDF render —
 *   simultaneous Chromium pages are the primary trigger for the Linux OOM
 *   killer terminating the container (exit 137).
 * - Browser recycling: the shared browser is closed and relaunched after
 *   MAX_RENDERS_PER_BROWSER renders or once process RSS exceeds
 *   MAX_BROWSER_RSS_BYTES, preventing Chromium memory creep.
 * - Pages and contexts are always closed in finally blocks so a failed
 *   render never leaks memory or chromium child processes.
 */

const { chromium } = require('playwright-core');

const MAX_CONCURRENT_RENDERS = 1;
const RENDER_QUEUE_TIMEOUT_MS = 30_000;
const MAX_RENDERS_PER_BROWSER = 25;
const MAX_BROWSER_RSS_BYTES = 400 * 1024 * 1024; // 400 MB

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage', // Use /tmp instead of the tiny /dev/shm in containers
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--no-zygote',
  '--single-process', // One Chromium process instead of one per renderer — much lower RSS
];

let browserPromise = null;
let renderCount = 0;

// ─── FIFO render mutex ───────────────────────────────────────────────────
let activeRenders = 0;
const renderWaiters = [];

const pumpQueue = () => {
  while (activeRenders < MAX_CONCURRENT_RENDERS && renderWaiters.length > 0) {
    const waiter = renderWaiters.shift();
    clearTimeout(waiter.timer);
    activeRenders += 1;
    waiter.resolve();
  }
};

const acquireRenderSlot = () =>
  new Promise((resolve, reject) => {
    const waiter = { resolve, reject, timer: null };
    waiter.timer = setTimeout(() => {
      const idx = renderWaiters.indexOf(waiter);
      if (idx !== -1) {
        renderWaiters.splice(idx, 1);
        reject(new Error('PDF generation timed out waiting in the render queue'));
      }
    }, RENDER_QUEUE_TIMEOUT_MS);
    renderWaiters.push(waiter);
    pumpQueue();
  });

const releaseRenderSlot = () => {
  activeRenders = Math.max(0, activeRenders - 1);
  pumpQueue();
};

// ─── Shared browser lifecycle ────────────────────────────────────────────

/**
 * Lazily launch a shared headless Chromium browser instance.
 * A failed launch resets the promise so the next call retries cleanly.
 * @returns {Promise<import('playwright-core').Browser>}
 */
const getBrowser = () => {
  if (!browserPromise) {
    renderCount = 0;
    browserPromise = chromium
      .launch({ headless: true, args: CHROMIUM_ARGS })
      .then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = null;
          renderCount = 0;
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
};

/**
 * Close and discard the shared browser after a bounded number of renders or
 * when overall process RSS has grown past the recycling threshold.
 */
const maybeRecycleBrowser = async () => {
  renderCount += 1;
  const rssBytes = process.memoryUsage().rss;
  if (!browserPromise) return;
  if (renderCount < MAX_RENDERS_PER_BROWSER && rssBytes <= MAX_BROWSER_RSS_BYTES) return;

  const closing = browserPromise;
  browserPromise = null;
  renderCount = 0;
  try {
    const browser = await closing;
    await browser.close();
  } catch {
    // Browser already dead or already closed — nothing to recycle.
  }
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
  await acquireRenderSlot();
  try {
    const browser = await getBrowser();
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      try {
        await page.setContent(html, { waitUntil: 'networkidle' });
        const pdfBuffer = await page.pdf({
          format: options.format || 'A4',
          printBackground: true,
          displayHeaderFooter: false,
          preferCSSPageSize: options.preferCSSPageSize === true,
          margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });
        return pdfBuffer;
      } finally {
        await page.close().catch(() => {});
      }
    } finally {
      await context.close().catch(() => {});
    }
  } finally {
    releaseRenderSlot();
    await maybeRecycleBrowser();
  }
};

module.exports = { generatePdf };
