/**
 * One-time environment file bootstrapper.
 *
 * Copies .env.*.example templates to their working counterparts without
 * overwriting existing files. The user is then prompted (via stdout) to fill
 * in the real Supabase and database credentials.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const files = [
  { src: 'backend/.env.example', dest: 'backend/.env' },
  { src: 'backend/.env.development.example', dest: 'backend/.env.development' },
  { src: 'backend/.env.uat.example', dest: 'backend/.env.uat' },
  { src: 'erp_prototype/.env.example', dest: 'erp_prototype/.env' },
];

for (const { src, dest } of files) {
  const srcPath = path.join(ROOT, src);
  const destPath = path.join(ROOT, dest);
  if (!fs.existsSync(destPath) && fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`Created ${dest} from ${src}`);
  } else if (!fs.existsSync(srcPath)) {
    console.warn(`Source template missing: ${src}`);
  } else {
    console.log(`Skipped ${dest} — already exists`);
  }
}

console.log('\nNext steps:');
console.log('  1. Edit backend/.env.development with your local/dev Supabase credentials.');
console.log('  2. Edit backend/.env.uat with UAT credentials (or leave placeholders — Render injects them in UAT).');
console.log('  3. Edit erp_prototype/.env to point ERP_API_BASE_URL at the backend you want to test.');
console.log('  4. Run "npm run dev" from the project root to start the local stack.');
