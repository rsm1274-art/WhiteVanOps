// Production build: Next.js standalone → electron-builder NSIS installer / C# Upgrade patches
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const standalone = path.join(root, '.next', 'standalone');

const args = process.argv.slice(2);
const isBase = args.includes('--base');
const isPlus = args.includes('--plus');
const isUpgrade = args.includes('--upgrade');

let tier = 'base';
if (isPlus) tier = 'plus';
if (isUpgrade) tier = 'upgrade';

function run(cmd, env = {}) {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { 
    cwd: root, 
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  fs.cpSync(src, dst, { recursive: true, force: true });
}

const distElectron = path.join(root, 'dist-electron');

// ==========================================
// TARGET: Plus Upgrade Installer
// ==========================================
if (tier === 'upgrade') {
  const keyIdx = args.indexOf('--key');
  const key = keyIdx !== -1 ? args[keyIdx + 1] : null;
  if (!key) {
    console.error('\n❌ Error: --key is required to build the Plus Upgrade Installer.');
    console.error('Usage: node scripts/electron-build.js --upgrade --key <licenseKey> [--expires YYYY-MM-DD] [--notes "Notes"]\n');
    process.exit(1);
  }

  const expiresIdx = args.indexOf('--expires');
  const expires = expiresIdx !== -1 ? args[expiresIdx + 1] : null;

  const notesIdx = args.indexOf('--notes');
  const notes = notesIdx !== -1 ? args[notesIdx + 1] : '';

  // Generate signed payload using the licensing HMAC secret
  const LICENSE_SIGNING_SECRET = process.env.LICENSE_SIGNING_SECRET || 'wvo.lic.v1.6b2f9d4c8a1e7035f2c9b0d4e6a8135790acdef1234567890fedcba098765';
  const crypto = require('crypto');
  const signatureData = `${key}:plus:${expires || ''}`;
  const sig = crypto
    .createHmac('sha256', LICENSE_SIGNING_SECRET)
    .update(signatureData)
    .digest('hex');

  const payload = {
    licenseKey: key,
    tier: 'plus',
    expiresAt: expires,
    notes: notes,
    sig: sig
  };

  // Compile upgrade.exe using the built-in Windows C# compiler (pre-installed on all Windows systems)
  const cscPath64 = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
  const cscPath32 = 'C:\\Windows\\Microsoft.NET\\v4.0.30319\\csc.exe';
  const csc = fs.existsSync(cscPath64) ? cscPath64 : (fs.existsSync(cscPath32) ? cscPath32 : null);

  if (!csc) {
    console.error('\n❌ Error: Windows C# Compiler (csc.exe) not found. Cannot build upgrade installer.');
    process.exit(1);
  }

  const srcFile = path.join(root, 'upgrade_installer.cs');
  const outFile = path.join(root, 'dist-electron', 'WhiteVanOps-Plus-Upgrade.exe');

  const csharpCode = `
using System;
using System.IO;

class Upgrade {
    static void Main() {
        try {
            string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            string targetDir = Path.Combine(appData, "whitevanops");
            Directory.CreateDirectory(targetDir);
            string targetFile = Path.Combine(targetDir, "plus_license.json");
            
            string json = @"${JSON.stringify(payload).replace(/"/g, '""')}";
            
            File.WriteAllText(targetFile, json);
            Console.WriteLine("========================================");
            Console.WriteLine(" WhiteVanOps Plus Upgrade Successful! ");
            Console.WriteLine("========================================");
            Console.WriteLine("Active Key: ${payload.licenseKey}");
            Console.WriteLine("Notes: ${payload.notes}");
            Console.WriteLine("\\nPress any key to exit...");
            Console.ReadKey();
        } catch (Exception e) {
            Console.WriteLine("Error: " + e.Message);
            Console.ReadKey();
        }
    }
}
  `;

  fs.writeFileSync(srcFile, csharpCode, 'utf8');
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  try {
    console.log(`\nCompiling Plus Upgrade Installer for key: ${key}...`);
    execSync(`"${csc}" /out:"${outFile}" "${srcFile}"`, { stdio: 'inherit' });
    console.log(`\n✅ Success! Plus Upgrade Installer built at: ${outFile}`);
  } catch (err) {
    console.error('\n❌ Error compiling upgrade installer:', err.message);
    process.exit(1);
  } finally {
    if (fs.existsSync(srcFile)) {
      fs.unlinkSync(srcFile);
    }
  }

  process.exit(0);
}

// ==========================================
// TARGET: Full App Installer (Base or Plus)
// ==========================================
// Clean only the temporary build output directories/configs to preserve previously generated installers
const winUnpacked = path.join(distElectron, 'win-unpacked');
if (fs.existsSync(winUnpacked)) {
  fs.rmSync(winUnpacked, { recursive: true, force: true });
}
const builderConfig = path.join(distElectron, 'builder-effective-config.yaml');
if (fs.existsSync(builderConfig)) {
  fs.unlinkSync(builderConfig);
}

// 1. Build Next.js with fallback build-time env vars if missing, so compiler doesn't fail during static page generation
const buildEnv = {};
if (!process.env.DATABASE_URL && !fs.existsSync(path.join(root, '.env')) && !fs.existsSync(path.join(root, '.env.local'))) {
  buildEnv.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5433/postgres';
  buildEnv.SESSION_SECRET = 'temp_build_key';
}
run('npm run build', buildEnv);

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

// 3b. Prune anything the file tracer wrongly dragged into the standalone
// output. next.config.ts excludes these via outputFileTracingExcludes, but a
// regression here is catastrophic — dist-electron/ holds previous multi-GB
// installers, so one bad trace makes every later build bigger until NSIS
// fails on a >2GB archive. Remove them unconditionally and loudly.
for (const dir of ['dist-electron', 'pgsql', 'pg_data']) {
  const p = path.join(standalone, dir);
  if (fs.existsSync(p)) {
    console.warn(`\nWARNING: file tracing pulled ${dir}/ into .next/standalone — pruning it. Check outputFileTracingExcludes in next.config.ts.`);
    fs.rmSync(p, { recursive: true, force: true });
  }
}

// 4. Copy .env.local into standalone so Next.js loads it at runtime
const envSrc = path.join(root, '.env.local');
const envDest = path.join(standalone, '.env.local');
let envContent = '';
if (fs.existsSync(envSrc)) {
  envContent = fs.readFileSync(envSrc, 'utf8');
}
// Append WVO_DEFAULT_TIER to build
envContent += `\nWVO_DEFAULT_TIER="${tier}"\n`;
fs.writeFileSync(envDest, envContent, 'utf8');
console.log(`\nCopied .env.local into standalone bundle with WVO_DEFAULT_TIER="${tier}".`);

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

// 6. Verify the bundled PostgreSQL binaries are present. electron-builder
// silently skips a missing extraResources source, so building without pgsql/
// would ship an installer with no database engine at all (every install that
// self-boots would 500 on first query). Hard-fail instead.
if (!fs.existsSync(path.join(root, 'pgsql', 'bin', 'pg_ctl.exe'))) {
  console.error('\n❌ Error: pgsql/bin/pg_ctl.exe not found — the installer would ship WITHOUT PostgreSQL and every self-booting install would fail on first launch.');
  console.error('Recreate pgsql/ per MANUAL_Setup_Installation.md §1 (portable PostgreSQL 17.6 zip at the project root).\n');
  process.exit(1);
}

// 7. Package with electron-builder
run('npx electron-builder --win');

// 7b. Assert the packaged output actually contains the pieces electron-builder
// is known to drop silently (missing extraResources sources, node_modules).
for (const rel of [
  ['resources', 'pgsql', 'bin', 'pg_ctl.exe'],
  ['resources', 'nextjs', 'node_modules', 'next'],
]) {
  const p = path.join(distElectron, 'win-unpacked', ...rel);
  if (!fs.existsSync(p)) {
    console.error(`\n❌ Error: packaged output is missing ${rel.join('/')} — the installer in dist-electron/ is broken, do not ship it.`);
    process.exit(1);
  }
}

// 8. Rename resulting installer file for clarity
try {
  const files = fs.readdirSync(distElectron);
  const setupFile = files.find(f => f.startsWith('WhiteVanOps Setup') && f.endsWith('.exe'));
  if (setupFile) {
    const newName = tier === 'plus' ? 'WhiteVanOps-Plus-Setup.exe' : 'WhiteVanOps-Base-Setup.exe';
    fs.renameSync(
      path.join(distElectron, setupFile),
      path.join(distElectron, newName)
    );
    console.log(`\n✅ Success! Renamed installer: ${setupFile} → ${newName}`);
  }
} catch (err) {
  console.warn('\nNote: Could not automatically rename the installer file:', err.message);
}

console.log('\nBuild complete. Installer is in dist-electron/.');
