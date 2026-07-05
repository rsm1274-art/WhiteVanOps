// Production build: Next.js standalone → electron-builder NSIS installer
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const standalone = path.join(root, '.next', 'standalone');

function run(cmd) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dst, { recursive: true, force: true });
}

// 1. Build Next.js
const distElectron = path.join(root, 'dist-electron');
if (fs.existsSync(distElectron)) {
  fs.rmSync(distElectron, { recursive: true, force: true });
}
run('npm run build');

// 2. Copy .next/static into standalone so the server can serve assets
copyDir(
  path.join(root, '.next', 'static'),
  path.join(standalone, '.next', 'static')
);

// 3. Copy public/ into standalone
copyDir(
  path.join(root, 'public'),
  path.join(standalone, 'public')
);

// 4. Copy .env.local into standalone so Next.js loads it at runtime
const envSrc = path.join(root, '.env.local');
if (fs.existsSync(envSrc)) {
  fs.copyFileSync(envSrc, path.join(standalone, '.env.local'));
  console.log('\nCopied .env.local into standalone bundle.');
} else {
  console.warn('\nNote: .env.local not found — the packaged app will generate one with unique random credentials on first launch (bundled-PostgreSQL installs), or IT can place one at resources/nextjs/.env.local for an external database.');
}

// 5. Concatenate Prisma migrations into a single schema.sql — applied by
// electron/postgres.js when the bundled PostgreSQL initializes on first run.
const migrationsDir = path.join(root, 'prisma', 'migrations');
const migrations = fs
  .readdirSync(migrationsDir)
  .filter((d) => fs.existsSync(path.join(migrationsDir, d, 'migration.sql')))
  .sort();
const schemaSql = migrations
  .map((d) => `-- Migration: ${d}\n` + fs.readFileSync(path.join(migrationsDir, d, 'migration.sql'), 'utf8'))
  .join('\n\n');
fs.mkdirSync(path.join(root, '.next', 'db'), { recursive: true });
fs.writeFileSync(path.join(root, '.next', 'db', 'schema.sql'), schemaSql);
console.log(`\nGenerated .next/db/schema.sql from ${migrations.length} migrations.`);

// 6. Verify the bundled PostgreSQL binaries are present
if (!fs.existsSync(path.join(root, 'pgsql', 'bin', 'pg_ctl.exe'))) {
  console.warn('\nWARNING: pgsql/bin not found — the installer will NOT bundle PostgreSQL. See MANUAL_Setup_Installation.md.');
}

// 7. Package with electron-builder
run('npx electron-builder --win');

console.log('\nBuild complete. Installer is in dist-electron/.');
