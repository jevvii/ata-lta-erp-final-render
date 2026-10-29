/**
 * E2E Test Suite Helpers
 * Provides shared fixtures, mock setup, API callers, and cross-worktree evaluation utilities.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const request = require('supertest');
const { app } = require('../helpers/testServer');
const { registerUser, seedDefaults, resetMock, mockTables } = require('../fixtures/supabaseMock');

const PROTOTYPE_AUTH_PATH = path.resolve(__dirname, '../../../erp_prototype/js/auth.js');
const PROTOTYPE_WORKFLOW_PATH = path.resolve(__dirname, '../../../erp_prototype/js/workflow.js');
const PROTOTYPE_STYLES_PATH = path.resolve(__dirname, '../../../erp_prototype/css/styles.css');
const DEFAULT_FRONTEND_PATH = path.resolve(
  __dirname,
  '../../../../ata-lta-erp-final-enterprise-v2/frontend'
);

function getEnterpriseFrontendPath() {
  if (process.env.ENTERPRISE_FRONTEND_PATH) {
    return path.resolve(process.env.ENTERPRISE_FRONTEND_PATH);
  }
  if (fs.existsSync(DEFAULT_FRONTEND_PATH)) {
    return DEFAULT_FRONTEND_PATH;
  }
  return null;
}

function resolveFrontendFile(subpath) {
  const root = getEnterpriseFrontendPath();
  if (!root) {
    throw new Error(
      `Enterprise frontend path not configured or not found. ` +
      `For cross-worktree integration tests, set the ENTERPRISE_FRONTEND_PATH environment variable ` +
      `to the root of the enterprise-v2 frontend checkout (e.g. /path/to/ata-lta-erp-final-enterprise-v2/frontend).`
    );
  }
  const fullPath = path.resolve(root, subpath);
  if (!fs.existsSync(fullPath)) {
    throw new Error(`Frontend file not found at: ${fullPath}`);
  }
  return fullPath;
}

/**
 * Loads prototype Auth object in an isolated VM sandbox.
 */
function loadPrototypeAuth(initialUser = null, apiClient = null) {
  const code = fs.readFileSync(PROTOTYPE_AUTH_PATH, 'utf8');
  const sandbox = {
    window: { apiClient: apiClient || {} },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(code + '\n;globalThis.Auth = Auth;', sandbox);
  const Auth = sandbox.Auth;
  if (initialUser) {
    Auth.user = initialUser;
  }
  return Auth;
}

/**
 * Reads prototype CSS file contents.
 */
function getPrototypeStyles() {
  return fs.readFileSync(PROTOTYPE_STYLES_PATH, 'utf8');
}

/**
 * Reads prototype workflow file contents.
 */
function getPrototypeWorkflow() {
  return fs.readFileSync(PROTOTYPE_WORKFLOW_PATH, 'utf8');
}

/**
 * Evaluates functions in enterprise-v2 frontend/src/features/operations/lib/taskScope.ts.
 */
function runFrontendTaskScope(fnName, args) {
  const targetPath = resolveFrontendFile('src/features/operations/lib/taskScope.ts');
  const script = `const { ${fnName} } = require('${targetPath}');
const result = ${fnName}(...${JSON.stringify(args)});
console.log(JSON.stringify({ result }));`;
  const output = execFileSync('node', ['--experimental-strip-types', '-e', script], {
    encoding: 'utf8',
  });
  return JSON.parse(output.trim()).result;
}

/**
 * Reads enterprise-v2 operations route code.
 */
function getFrontendOperationsCode() {
  const targetPath = resolveFrontendFile('src/routes/operations.tsx');
  return fs.readFileSync(targetPath, 'utf8');
}

/**
 * Reads enterprise-v2 WorkRequestModal code.
 */
function getFrontendWrModalCode() {
  const targetPath = resolveFrontendFile('src/features/operations/components/WorkRequestModal.tsx');
  return fs.readFileSync(targetPath, 'utf8');
}

module.exports = {
  request,
  app,
  registerUser,
  seedDefaults,
  resetMock,
  mockTables,
  loadPrototypeAuth,
  getPrototypeStyles,
  getPrototypeWorkflow,
  runFrontendTaskScope,
  getFrontendOperationsCode,
  getFrontendWrModalCode,
  resolveFrontendFile,
  getEnterpriseFrontendPath,
};
