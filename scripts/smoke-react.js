/** Read-only probes for the built React deployment. Never signs in or writes data. */
const assert = require("node:assert/strict");

function isPublicKey(key) {
  if (typeof key !== "string") return false;
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  try {
    const parts = key.split(".");
    return (
      parts.length === 3 &&
      JSON.parse(Buffer.from(parts[1], "base64url")).role === "anon"
    );
  } catch {
    return false;
  }
}

async function smoke({
  spaUrl,
  apiBaseUrl,
  expectedCommit,
  expectedSupabaseUrl,
  timeoutMs = 60000,
}) {
  const spa = new URL(spaUrl).origin;
  const api = apiBaseUrl.replace(/\/+$/, "");
  assert.equal(
    new URL(api).pathname,
    "/v1",
    "Expected API URL must end in /v1",
  );
  async function get(url, json = false) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    assert.equal(response.status, 200, `GET ${url} failed: ${response.status}`);
    return json ? response.json() : response.text();
  }
  const html = await get(`${spa}/`);
  assert.match(html, /id=["']root["']/, "React shell is missing");
  const metadata = await get(`${spa}/deployment.json`, true);
  assert.equal(
    metadata.frontend,
    "enterprise-v2",
    "Expected enterprise-v2 deployment metadata",
  );
  assert.equal(
    metadata.apiBaseUrl,
    api,
    "Built API target does not match the expected API target",
  );
  if (expectedCommit)
    assert.equal(
      metadata.commit,
      expectedCommit,
      "Deployed commit does not match reviewed commit",
    );
  const scripts = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(
    (m) => m[1],
  );
  assert.ok(scripts.length > 0, "React entry script is missing");
  for (const script of scripts) {
    const url = new URL(script, spa);
    assert.equal(url.origin, spa, "Unexpected external application script");
    const body = await get(url.href);
    assert.doesNotMatch(
      body,
      /<!doctype html/i,
      "Script URL returned the SPA fallback instead of JavaScript",
    );
  }
  assert.match(
    await get(`${spa}/operations`),
    /id=["']root["']/,
    "React deep link fallback is missing",
  );
  const apiRoot = api.slice(0, -3);
  assert.equal(
    (await get(`${apiRoot}/health`, true)).status,
    "ok",
    "Backend health is not ok",
  );
  assert.equal(
    (await get(`${apiRoot}/readyz`, true)).status,
    "ready",
    "Backend readiness is not ready",
  );
  const config = (await get(`${api}/config/public`, true)).data;
  assert.ok(
    isPublicKey(config?.supabaseAnonKey),
    "Backend did not return a browser-safe public key",
  );
  if (expectedSupabaseUrl)
    assert.equal(
      config.supabaseUrl,
      expectedSupabaseUrl,
      "Backend Supabase project does not match production",
    );
  return {
    frontend: metadata.frontend,
    apiBaseUrl: api,
    commit: metadata.commit,
  };
}

if (require.main === module) {
  const profile = process.argv[2] || "local";
  const targets = {
    local: ["http://127.0.0.1:8081", "http://127.0.0.1:3000/v1"],
    staging: [
      "https://ata-lta-erp-spa-staging.onrender.com",
      "https://ata-lta-erp-api-staging.onrender.com/v1",
    ],
    main: [
      "https://ata-lta-erp-spa-main.onrender.com",
      "https://ata-lta-erp-api-main.onrender.com/v1",
    ],
    prod: [
      "https://ata-lta-erp-spa-main.onrender.com",
      "https://ata-lta-erp-api-main.onrender.com/v1",
    ],
  };
  if (!targets[profile]) {
    console.error("Use local, staging, main, or prod.");
    process.exit(1);
  }
  smoke({
    spaUrl: process.env.BASE_URL || targets[profile][0],
    apiBaseUrl: process.env.ERP_API_BASE_URL || targets[profile][1],
    expectedCommit: process.env.EXPECTED_COMMIT,
    expectedSupabaseUrl: process.env.EXPECTED_SUPABASE_URL,
  })
    .then((result) => console.log("React deployment smoke passed:", result))
    .catch((err) => {
      console.error(err.message);
      process.exitCode = 1;
    });
}
module.exports = { smoke };
