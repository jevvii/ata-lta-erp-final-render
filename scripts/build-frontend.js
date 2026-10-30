const { spawnSync } = require("node:child_process");
const path = require("node:path");

const targets = {
  staging: "https://ata-lta-erp-api-staging.onrender.com/v1",
  prod: "https://ata-lta-erp-api-main.onrender.com/v1",
  main: "https://ata-lta-erp-api-main.onrender.com/v1",
};
const target = targets[process.argv[2]];
if (!target) throw new Error("Select staging, prod, or main.");
const result = spawnSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build"],
  {
    cwd: path.join(__dirname, "..", "frontend"),
    env: { ...process.env, ERP_API_BASE_URL: target },
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
