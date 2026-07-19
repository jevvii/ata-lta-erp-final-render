/**
 * Build script for the ATA & LTA ERP SPA.
 *
 * Phase 1 — Asset Delivery & Bundle Architecture:
 *   - Bundles the vanilla JS SPA into three hashed, minified IIFE bundles.
 *   - Bundles/minifies CSS into one hashed file.
 *   - Generates env.js with the backend API URL.
 *   - Produces a dist/index.html that loads only the bundles and the CSS.
 *   - Generates .gz and .br encodings for compressed delivery.
 *   - Copies remaining static assets (images) into dist/.
 *   - Writes a manifest JSON mapping logical bundle names to hashed filenames.
 *
 * Usage:
 *   ERP_API_BASE_URL=https://api.example.com/v1 node build.js
 *   NODE_ENV=production node build.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');

let esbuild;
try {
  esbuild = require('esbuild');
} catch (e) {
  esbuild = null;
}

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const CSS_DIR = path.join(ROOT, 'css');
const JS_DIR = path.join(ROOT, 'js');
const TMP_DIR = path.join(ROOT, '.build-tmp');

const DEFAULT_API_URL = 'http://localhost:3000/v1';

// Bundle definitions. Order mirrors the source index.html to preserve global
// script ordering. Each file is transformed so its top-level identifiers are
// also exposed on window, keeping the existing global-variable architecture
// intact across bundles.
const BUNDLES = {
  shell: ['utils.js', 'apiClient.js', 'auth.js', 'app.js'],
  vendor: ['dataTable.js', 'kanban.js', 'datepicker.js', 'timepicker.js'],
  'modules-core': ['dashboard.js', 'clients.js', 'workflow.js'],
  'modules-billing': ['billing.js', 'disbursement.js', 'transmittal.js'],
  'modules-admin': ['pendingChanges.js', 'users.js', 'reports.js', 'profile.js', 'dms.js'],
};

function getApiUrl() {
  const apiUrl = process.env.ERP_API_BASE_URL || DEFAULT_API_URL;

  // Render Blueprint fromService may give a bare hostname; ensure a full origin.
  const withProtocol = apiUrl.startsWith('http://') || apiUrl.startsWith('https://')
    ? apiUrl
    : `https://${apiUrl}`;
  const normalizedUrl = withProtocol.endsWith('/v1')
    ? withProtocol
    : `${withProtocol.replace(/\/$/, '')}/v1`;
  return normalizedUrl;
}

function generateEnvJs(apiUrl) {
  let preconnectSnippet = '';
  try {
    const origin = new URL(apiUrl).origin;
    preconnectSnippet = `
  const origin = ${JSON.stringify(origin)};
  const head = document.head || document.getElementsByTagName('head')[0];
  if (head && !head.querySelector('link[rel="preconnect"][href="' + origin + '"]')) {
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = origin;
    head.appendChild(link);
  }`;
  } catch (e) {
    // Ignore malformed URL.
  }

  return `window.__ERP_API_BASE_URL__ = ${JSON.stringify(apiUrl)};
(function() {${preconnectSnippet}
})();
`;
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function gzipFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    const gzipped = zlib.gzipSync(content, { level: 9 });
    fs.writeFileSync(`${filePath}.gz`, gzipped);
  } catch (e) {
    console.warn(`Failed to gzip ${filePath}:`, e.message);
  }
}

function brotliFile(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    const compressed = zlib.brotliCompressSync(content, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    });
    fs.writeFileSync(`${filePath}.br`, compressed);
  } catch (e) {
    console.warn(`Failed to brotli ${filePath}:`, e.message);
  }
}

function compressFile(filePath) {
  gzipFile(filePath);
  brotliFile(filePath);
}

function hashContent(content) {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
}

function parseScriptOrder(html) {
  const matches = [...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi)];
  return matches.map((m) => m[1]);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function extractTopLevelNames(code) {
  const names = new Set();
  const re = /^(function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  let match;
  while ((match = re.exec(code)) !== null) {
    names.add(match[2]);
  }
  return [...names];
}

function makeExposureFooter(globals) {
  return globals
    .map((g) => `try { if (typeof ${g} !== 'undefined') window.${g} = ${g}; } catch (e) {}`)
    .join('\n');
}

function exposeGlobalsPlugin(exposeMap) {
  return {
    name: 'expose-globals',
    setup(build) {
      build.onLoad({ filter: /\.js$/ }, async (args) => {
        const basename = path.basename(args.path);
        const globals = exposeMap[basename];
        if (!globals) return undefined;

        const source = await fs.promises.readFile(args.path, 'utf8');
        const footer = makeExposureFooter(globals);
        return { contents: `${source}\n${footer}\n`, loader: 'js' };
      });
    },
  };
}

function generateIndexHtml(sourceHtml, manifest, apiOrigin) {
  // Replace stylesheet with hashed bundle.
  let html = sourceHtml.replace(
    /<link\s+rel=["']stylesheet["']\s+href=["']css\/styles\.css["']\s*\/?>/i,
    `<link rel="stylesheet" href="${manifest.styles}">`
  );

  // Inject API origin preconnect into <head>.
  const preconnect = `  <link rel="preconnect" href="${apiOrigin}">\n`;
  html = html.replace(/<\/head>/i, `${preconnect}</head>`);

  // Replace every script tag (including inline blocks) in the source with the production bundle tags.
  const coreName = manifest['modules-core'] || '';
  const buildHash = coreName ? coreName.split('.')[1] : Date.now();
  const scriptBlock = `  <script src="env.js"></script>
  <script>
    window.__ERP_BUNDLES__ = {
      billing: ${JSON.stringify(manifest['modules-billing'] || '')},
      admin: ${JSON.stringify(manifest['modules-admin'] || '')}
    };
  </script>
  <script src="${manifest.shell}" defer></script>
  <script src="${manifest.vendor}" defer></script>
  <script src="${manifest['modules-core']}" defer></script>
  <script>
    (function () {
      function loadScript(src) {
        return new Promise(function (resolve, reject) {
          var s = document.createElement('script');
          s.src = src;
          s.async = true;
          s.onload = resolve;
          s.onerror = function () { reject(new Error('Failed to load ' + src)); };
          document.body.appendChild(s);
        });
      }
      function loadLazyBundles() {
        var bundles = window.__ERP_BUNDLES__ || {};
        if (bundles.billing) loadScript(bundles.billing).catch(function () {});
        if (bundles.admin) loadScript(bundles.admin).catch(function () {});
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadLazyBundles);
      } else {
        loadLazyBundles();
      }

      if (!('serviceWorker' in navigator)) return;

      // Dev-only listener for the custom SW update event.
      if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        window.addEventListener('sw-update-available', function (e) {
          console.log('[SW] sw-update-available event dispatched:', e.detail);
        });
      }

      navigator.serviceWorker.register('/sw.js?v=${buildHash}')
        .then(function (registration) {
          registration.addEventListener('updatefound', function () {
            var installing = registration.installing;
            if (!installing) return;
            installing.addEventListener('statechange', function () {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                window.dispatchEvent(new CustomEvent('sw-update-available', { detail: { registration: registration } }));
                console.log('[SW] New version available — hard refresh to update.');
              }
            });
          });
        })
        .catch(function () {});
    })();
  </script>`;
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>\s*/gi, '');
  html = html.replace(/<\/body>/i, `${scriptBlock}\n</body>`);

  return html;
}

async function transformCss(source) {
  const result = await esbuild.transform(source, {
    loader: 'css',
    minify: true,
  });
  return result.code;
}

async function buildWithEsbuild(manifestTarget, apiUrl, apiOrigin) {
  cleanDir(TMP_DIR);
  cleanDir(DIST);

  // Build an exposure map for every source file we bundle.
  const exposeMap = {};
  for (const files of Object.values(BUNDLES)) {
    for (const file of files) {
      const source = fs.readFileSync(path.join(JS_DIR, file), 'utf8');
      exposeMap[file] = extractTopLevelNames(source);
    }
  }

  const manifest = {};
  let lastMetafile = null;

  for (const [name, files] of Object.entries(BUNDLES)) {
    const entryPath = path.join(TMP_DIR, `${name}.js`);
    const imports = files.map((f) => `import '../js/${f}';`).join('\n');
    fs.writeFileSync(entryPath, `${imports}\n`);

    const result = await esbuild.build({
      entryPoints: [entryPath],
      bundle: true,
      format: 'iife',
      outdir: DIST,
      entryNames: '[name].[hash]',
      minify: true,
      sourcemap: false,
      metafile: true,
      target: ['es2017'],
      drop: ['console', 'debugger'],
      plugins: [exposeGlobalsPlugin(exposeMap)],
    });

    const outFile = Object.keys(result.metafile.outputs).find((f) => f.endsWith('.js'));
    if (!outFile) throw new Error(`No output for bundle ${name}`);
    manifest[name] = path.relative(DIST, outFile).replace(/\\/g, '/');
    lastMetafile = result.metafile;
  }

  // Write metafile for bundle profiling (dev/build analysis only).
  if (lastMetafile) {
    fs.writeFileSync(path.join(DIST, 'metafile.json'), JSON.stringify(lastMetafile, null, 2));
  }

  const cssSource = fs.readFileSync(path.join(CSS_DIR, 'styles.css'), 'utf8');
  const cssMinified = await transformCss(cssSource);
  const cssHash = hashContent(cssMinified);
  const cssName = `styles.${cssHash}.css`;
  fs.writeFileSync(path.join(DIST, cssName), cssMinified);
  manifest.styles = cssName;

  fs.writeFileSync(manifestTarget, JSON.stringify(manifest, null, 2));
  return manifest;
}

async function fallbackBuild(manifestTarget, apiUrl, apiOrigin) {
  console.warn('esbuild unavailable or failed; using fallback concatenation build.');
  cleanDir(DIST);

  const manifest = {};

  for (const [name, files] of Object.entries(BUNDLES)) {
    const parts = [];
    for (const file of files) {
      const filePath = path.join(JS_DIR, file);
      if (!fs.existsSync(filePath)) continue;
      const source = fs.readFileSync(filePath, 'utf8');
      parts.push(source);
      parts.push(makeExposureFooter(extractTopLevelNames(source)));
    }
    const content = parts.join('\n');
    const hash = hashContent(content);
    const outName = `${name}.${hash}.bundle.js`;
    fs.writeFileSync(path.join(DIST, outName), content);
    manifest[name] = outName;
  }

  const cssContent = fs.readFileSync(path.join(CSS_DIR, 'styles.css'), 'utf8');
  const cssHash = hashContent(cssContent);
  const cssName = `styles.${cssHash}.min.css`;
  fs.writeFileSync(path.join(DIST, cssName), cssContent);
  manifest.styles = cssName;

  fs.writeFileSync(manifestTarget, JSON.stringify(manifest, null, 2));
  return manifest;
}

async function build() {
  const apiUrl = getApiUrl();
  const apiOrigin = (() => {
    try { return new URL(apiUrl).origin; } catch (e) { return ''; }
  })();
  const envJs = generateEnvJs(apiUrl);

  // Keep the root env.js for local/dev parity.
  fs.writeFileSync(path.join(ROOT, 'env.js'), envJs);
  console.log('Generated env.js with API base URL:', apiUrl);

  // Read index.html to determine script order and validate bundle lists.
  const sourceHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const scriptOrder = parseScriptOrder(sourceHtml);
  console.log('Source script order:', scriptOrder);

  const manifestPath = path.join(DIST, 'manifest.json');

  let manifest;
  let buildError = null;
  if (esbuild) {
    try {
      manifest = await buildWithEsbuild(manifestPath, apiUrl, apiOrigin);
    } catch (e) {
      buildError = e;
      console.error('esbuild build failed:', e.message);
    }
  }
  if (!manifest) {
    manifest = await fallbackBuild(manifestPath, apiUrl, apiOrigin);
  }

  // Write env.js into dist so static hosts have the runtime API URL.
  fs.writeFileSync(path.join(DIST, 'env.js'), envJs);

  // Copy remaining static assets (images, logos, etc.).
  const assetsDir = path.join(ROOT, 'ERP_Assets');
  if (fs.existsSync(assetsDir)) {
    copyDir(assetsDir, path.join(DIST, 'ERP_Assets'));
  }

  // Copy service worker into dist so the bundled production build can register it.
  const swPath = path.join(ROOT, 'sw.js');
  if (fs.existsSync(swPath)) {
    fs.copyFileSync(swPath, path.join(DIST, 'sw.js'));
  }

  // Generate dist/index.html.
  const indexHtml = generateIndexHtml(sourceHtml, manifest, apiOrigin);
  fs.writeFileSync(path.join(DIST, 'index.html'), indexHtml);

  // Clean up temporary entry files.
  fs.rmSync(TMP_DIR, { recursive: true, force: true });

  // Compress all generated text assets.
  compressFile(path.join(DIST, 'env.js'));
  for (const file of fs.readdirSync(DIST)) {
    const p = path.join(DIST, file);
    if (fs.statSync(p).isFile() && /\.(js|css)$/.test(file)) {
      compressFile(p);
    }
  }

  console.log('Build complete:', DIST);
  console.log('Manifest:', manifest);
  if (buildError) {
    console.warn('Build succeeded via fallback after esbuild error:', buildError.message);
  }
}

if (require.main === module) {
  build().catch((err) => {
    console.error('Build failed:', err);
    process.exit(1);
  });
}

module.exports = { build, getApiUrl, generateEnvJs };
