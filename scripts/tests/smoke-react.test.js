const { test } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { smoke } = require("../smoke-react");

async function fixture(t, overrides = {}) {
  const routes = {
    "/": '<div id="root"></div><script type="module" src="/assets/app.js"></script>',
    "/operations": '<div id="root"></div>',
    "/assets/app.js": 'console.log("app")',
    "/sw.js": "self.addEventListener('activate', () => self.registration.unregister());",
    "/health": { status: "ok" },
    "/readyz": { status: "ready" },
    "/v1/config/public": {
      data: {
        supabaseUrl: "https://test.supabase.co",
        supabaseAnonKey: "sb_publishable_test",
      },
    },
    ...overrides,
  };
  const server = http.createServer((req, res) => {
    const value = routes[req.url];
    if (value === undefined || value === null) {
      res.writeHead(404);
      res.end();
      return;
    }
    const isJavaScript = /\.js(\?|$)/.test(req.url);
    res.setHeader(
      "Content-Type",
      typeof value === "string"
        ? isJavaScript
          ? "application/javascript"
          : "text/html"
        : "application/json",
    );
    res.end(typeof value === "string" ? value : JSON.stringify(value));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(
    () =>
      new Promise((r) => {
        server.closeAllConnections();
        server.close(r);
      }),
  );
  const origin = `http://127.0.0.1:${server.address().port}`;
  routes["/deployment.json"] = {
    frontend: "enterprise-v2",
    apiBaseUrl: `${origin}/v1`,
    commit: "reviewed-commit",
    ...overrides.metadata,
  };
  return {
    spaUrl: origin,
    apiBaseUrl: `${origin}/v1`,
    expectedCommit: "reviewed-commit",
    timeoutMs: 1000,
  };
}

test("checks React shell, deep links, assets, exact API target, commit and live dependencies", async (t) => {
  await smoke(await fixture(t));
});
test("rejects a deployment built against a different API", async (t) => {
  await assert.rejects(
    smoke(
      await fixture(t, {
        metadata: { apiBaseUrl: "https://wrong.example/v1" },
      }),
    ),
    /API target/,
  );
});
test("rejects a deployment without the legacy service-worker kill-switch", async (t) => {
  await assert.rejects(
    smoke(await fixture(t, { "/sw.js": null })),
    /kill-switch/,
  );
});
test("rejects a legacy frontend", async (t) => {
  await assert.rejects(
    smoke(await fixture(t, { "/": '<div id="app-shell"></div>' })),
    /React shell/,
  );
});
test("rejects a broken deep link", async (t) => {
  await assert.rejects(
    smoke(await fixture(t, { "/operations": "404" })),
    /deep link/,
  );
});
test("rejects unhealthy backend dependencies", async (t) => {
  await assert.rejects(
    smoke(await fixture(t, { "/health": { status: "error" } })),
    /health/,
  );
});
test("rejects public configuration that returns a privileged key", async (t) => {
  await assert.rejects(
    smoke(
      await fixture(t, {
        "/v1/config/public": {
          data: {
            supabaseUrl: "https://test.supabase.co",
            supabaseAnonKey: "sb_secret_test",
          },
        },
      }),
    ),
    /public key/,
  );
});
