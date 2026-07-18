/**
 * Remote Supabase migration runner.
 *
 * Applies the full schema + seed set to a remote Supabase PostgreSQL database.
 *
 * The project mixes node-pg-migrate style .js migrations with raw .sql files.
 * node-pg-migrate itself cannot run prefix-named .js migrations, so this runner
 * applies both .js and .sql files in numeric order using a minimal pgm shim.
 *
 * Usage:
 *   node scripts/migrate-remote.js [env]
 *
 * env = local | uat | prod (default: local)
 *
 * The script reads DATABASE_URL from the matching .env.* file (or process env).
 *
 * Safety notes:
 *   - Uses CREATE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS where possible.
 *   - Always back up your remote database before running on UAT/production.
 *   - Never commit .env.* files with real credentials.
 */

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const envArg = process.argv[2] || 'local';
const envName = envArg.toLowerCase();

const envFiles = {
  local: '.env.development',
  dev: '.env.development',
  development: '.env.development',
  uat: '.env.uat',
  prod: '.env.production',
  production: '.env.production',
};

const envFile = envFiles[envName];
if (!envFile) {
  console.error(`Unknown environment "${envArg}". Use one of: local, uat, prod`);
  process.exit(1);
}

const envPath = path.join(__dirname, '..', envFile);
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  console.log(`Loaded environment config: ${envFile}`);
} else {
  console.warn(`Environment file not found: ${envFile}. Relying on process environment.`);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const rootDir = path.join(__dirname, '..');
const migrationsDir = path.join(rootDir, 'migrations');
const seedsDir = path.join(rootDir, 'seeds');

function migrationKey(filename) {
  const match = path.basename(filename).match(/^(\d+)/);
  return match ? Number(match[1]) : Infinity;
}

function quoteIdent(name) {
  return `"${name.replace(/"/g, '""')}"`;
}

function renderDefault(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object' && value !== null && value.__name__) {
    return ` DEFAULT ${value.__name__}`;
  }
  if (typeof value === 'boolean') return ` DEFAULT ${value}`;
  if (typeof value === 'number') return ` DEFAULT ${value}`;
  if (typeof value === 'string') {
    // Wrap strings as PostgreSQL string literals.
    return ` DEFAULT '${value.replace(/'/g, "''")}'`;
  }
  return ` DEFAULT ${JSON.stringify(value)}`;
}

function buildPgm(queries) {
  return {
    func: (name) => ({ __name__: name }),

    sql: (sql) => {
      queries.push(sql);
    },

    createTable: (name, columns, options) => {
      const defs = [];
      const constraints = [];

      for (const [colName, colDef] of Object.entries(columns)) {
        if (typeof colDef === 'string') {
          defs.push(`${quoteIdent(colName)} ${colDef}`);
          continue;
        }

        const parts = [quoteIdent(colName)];
        parts.push(colDef.type);
        if (colDef.primaryKey) parts.push('PRIMARY KEY');
        if (colDef.unique) parts.push('UNIQUE');
        if (colDef.notNull) parts.push('NOT NULL');
        if (colDef.default !== undefined) parts.push(renderDefault(colDef.default).trimStart());
        if (colDef.references) {
          parts.push(`REFERENCES ${quoteIdent(colDef.references)}(id)`);
          if (colDef.onDelete) parts.push(`ON DELETE ${colDef.onDelete}`);
        }
        defs.push(parts.join(' '));
      }

      if (options?.constraints) {
        if (options.constraints.primaryKey) {
          const cols = Array.isArray(options.constraints.primaryKey)
            ? options.constraints.primaryKey.map(quoteIdent).join(', ')
            : quoteIdent(options.constraints.primaryKey);
          constraints.push(`PRIMARY KEY (${cols})`);
        }
        if (options.constraints.unique) {
          const cols = Array.isArray(options.constraints.unique)
            ? options.constraints.unique.map(quoteIdent).join(', ')
            : quoteIdent(options.constraints.unique);
          constraints.push(`UNIQUE (${cols})`);
        }
        if (options.constraints.foreignKeys) {
          // Not used in current migrations; placeholder.
        }
      }

      const ifNotExists = options?.ifNotExists ? 'IF NOT EXISTS ' : '';
      const allDefs = [...defs, ...constraints];
      queries.push(`CREATE TABLE ${ifNotExists}${quoteIdent(name)} (${allDefs.join(', ')})`);
    },

    dropTable: (name) => {
      queries.push(`DROP TABLE IF EXISTS ${quoteIdent(name)} CASCADE`);
    },

    addColumns: (table, columns) => {
      for (const [colName, colDef] of Object.entries(columns)) {
        if (typeof colDef === 'string') {
          queries.push(`ALTER TABLE ${quoteIdent(table)} ADD COLUMN IF NOT EXISTS ${quoteIdent(colName)} ${colDef}`);
          continue;
        }
        const parts = [`ALTER TABLE ${quoteIdent(table)} ADD COLUMN IF NOT EXISTS ${quoteIdent(colName)} ${colDef.type}`];
        if (colDef.notNull) parts.push('NOT NULL');
        if (colDef.default !== undefined) parts.push(renderDefault(colDef.default).trimStart());
        queries.push(parts.join(' '));
      }
    },

    dropColumns: (table, columns) => {
      for (const colName of columns) {
        queries.push(`ALTER TABLE ${quoteIdent(table)} DROP COLUMN IF EXISTS ${quoteIdent(colName)}`);
      }
    },

    renameColumn: (table, oldName, newName) => {
      queries.push(`ALTER TABLE ${quoteIdent(table)} RENAME COLUMN ${quoteIdent(oldName)} TO ${quoteIdent(newName)}`);
    },

    createIndex: (table, columns, options) => {
      const cols = Array.isArray(columns)
        ? columns.map(quoteIdent).join(', ')
        : quoteIdent(columns);
      const unique = options?.unique ? 'UNIQUE ' : '';
      const where = options?.where ? ` WHERE ${options.where}` : '';
      const name = options?.name
        ? options.name
        : `idx_${table}_${Array.isArray(columns) ? columns.join('_') : columns}`;
      queries.push(`CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdent(name)} ON ${quoteIdent(table)} (${cols})${where}`);
    },

    dropIndex: (table, columns) => {
      const name = `idx_${table}_${Array.isArray(columns) ? columns.join('_') : columns}`;
      queries.push(`DROP INDEX IF EXISTS ${quoteIdent(name)}`);
    },
  };
}

async function ensureMigrationTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS remote_migrations (
      name VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function isApplied(client, name) {
  const { rows } = await client.query('SELECT 1 FROM remote_migrations WHERE name = $1', [name]);
  return rows.length > 0;
}

async function markApplied(client, name) {
  await client.query(
    'INSERT INTO remote_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING',
    [name]
  );
}

async function applySqlFile(client, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  await client.query(sql);
}

async function applyJsMigration(client, filePath) {
  // Clear require cache so reruns pick up any file changes during development.
  delete require.cache[require.resolve(filePath)];
  const migration = require(filePath);
  const queries = [];
  const pgm = buildPgm(queries);
  if (typeof migration.up === 'function') {
    migration.up(pgm);
  }
  for (const sql of queries) {
    await client.query(sql);
  }
}

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await ensureMigrationTable(client);

    const files = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.js') || f.endsWith('.sql'))
      .sort((a, b) => migrationKey(a) - migrationKey(b));

    console.log(`\nFound ${files.length} migration files. Applying in order...\n`);

    for (const file of files) {
      const alreadyApplied = await isApplied(client, file);
      if (alreadyApplied) {
        console.log(`⏭️  ${file} (already applied)`);
        continue;
      }

      console.log(`🔄 ${file}`);
      await client.query('BEGIN');
      try {
        const filePath = path.join(migrationsDir, file);
        if (file.endsWith('.sql')) {
          await applySqlFile(client, filePath);
        } else {
          await applyJsMigration(client, filePath);
        }
        await markApplied(client, file);
        await client.query('COMMIT');
        console.log(`✅ ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ ${file} failed:`, err.message);
        throw err;
      }
    }

    const seedFiles = fs.readdirSync(seedsDir).filter((f) => f.endsWith('.sql'));
    if (seedFiles.length) {
      console.log(`\nFound ${seedFiles.length} seed file(s). Applying in order...\n`);
      for (const file of seedFiles) {
        const seedName = `seed:${file}`;
        const alreadyApplied = await isApplied(client, seedName);
        if (alreadyApplied) {
          console.log(`⏭️  ${file} (already applied)`);
          continue;
        }
        console.log(`🌱 ${file}`);
        await client.query('BEGIN');
        try {
          await applySqlFile(client, path.join(seedsDir, file));
          await markApplied(client, seedName);
          await client.query('COMMIT');
          console.log(`✅ ${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`❌ ${file} failed:`, err.message);
          console.log('   Continuing with remaining seeds...');
        }
      }
    }

    const { rows } = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    console.log('\n📋 Tables in public schema:');
    rows.forEach((r) => console.log(`   - ${r.table_name}`));
    console.log('\n🎉 Remote migration complete.');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
