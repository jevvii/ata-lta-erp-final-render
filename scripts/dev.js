/** Starts the React UI and, for local/staging profiles, its local API. */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const profile = (process.argv[2] || "local").toLowerCase();
if (!["local", "staging", "main", "prod"].includes(profile)) {
  console.error("Use local, staging, main, or prod.");
  process.exit(1);
}
const remote = profile === "main" || profile === "prod";
const children = [];
let stopping = false;

function stop(code) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (process.platform === "win32") child.kill("SIGTERM");
    else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (err) {
        if (err.code !== "ESRCH") throw err;
      }
    }
  }
}

function run(directory, script, extraEnv = {}) {
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", script],
    {
      cwd: path.join(ROOT, directory),
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
      detached: process.platform !== "win32",
    },
  );
  children.push(child);
  child.on("error", (err) => {
    console.error(err.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code ?? 1);
  });
}

process.on("SIGINT", () => stop(130));
process.on("SIGTERM", () => stop(143));

let apiBase = process.env.ERP_API_BASE_URL;
if (!remote) {
  const envFile = path.join(
    ROOT,
    "backend",
    profile === "staging" ? ".env.staging" : ".env.development",
  );
  const content = fs.existsSync(envFile)
    ? fs.readFileSync(envFile, "utf8")
    : "";
  const filePort = content.match(/^PORT\s*=\s*["']?(\d+)/m)?.[1];
  const port = process.env.PORT || filePort || "3000";
  apiBase ||= `http://127.0.0.1:${port}/v1`;
  run("backend", profile === "staging" ? "start:staging" : "dev:local", {
    PORT: port,
  });
} else {
  apiBase ||= "https://ata-lta-erp-api-main.onrender.com/v1";
}
console.log(`React UI: http://localhost:8081; API: ${apiBase}`);
run("frontend", "dev", { ERP_API_BASE_URL: apiBase });
