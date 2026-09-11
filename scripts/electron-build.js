// Production build: Next.js standalone → electron-builder installer (full or
// trial variant), NSIS .exe by default or a .dmg with --mac. The Mac build must
// run on a Mac.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const standalone = path.join(root, '.next', 'standalone');

const args = process.argv.slice(2);
const isTrial = args.includes('--trial');
// The Mac build must actually run on a Mac (electron-builder can't produce a
// signed-shape .app on Windows, and the pgsql-mac payload is macOS binaries).
// This flag only selects which config/checks apply here.
const isMac = args.includes('--mac');
const targetPlatform = isMac ? 'mac' : 'win';

if (args.includes('--upgrade')) {
  console.error('\n❌ --upgrade was removed on 2026-07-24, and Base/Plus no longer exist at all (v2.0).\n');
  process.exit(1);
}
if (args.includes('--base') || args.includes('--plus')) {
  console.error('\n❌ --base/--plus were removed in v2.0 — there is one product now. Use --trial for a demo build, or no flag for the full installer.\n');
  process.exit(1);
}

const variant = isTrial ? 'trial' : 'full';

const ARTIFACT_NAMES = {
  win: {
    full: 'WhiteVanOps-Setup.exe',
    trial: 'WhiteVanOps-Trial-Setup.exe',
  },
  // Mac builds both arm64 and x64 from one electron-builder invocation
  // (package.json's mac.target lists both arches against the dmg target).
  // The "${arch}" token is electron-builder's own templating syntax — it
  // substitutes 'arm64'/'x64' when it writes each file. Without a per-arch
  // token here, both builds resolve to the same filename and the second one
  // (x64) silently overwrites the first (arm64) on disk.
  mac: {
    full: 'WhiteVanOps-Setup-${arch}.dmg',
    trial: 'WhiteVanOps-Trial-Setup-${arch}.dmg',
  },
};
const artifactName = ARTIFACT_NAMES[targetPlatform][variant];

// Resolve our own copy of electron-builder's "${arch}" substitution, so the
// verification/manifest code below (which electron-builder never sees) can
// name the same two files electron-builder actually wrote.
function resolvedArtifactName(arch) {
  return arch ? artifactName.replace('${arch}', arch) : artifactName;
}

console.log(
  isMac
    ? `\nBuilding ${resolvedArtifactName('arm64')} and ${resolvedArtifactName('x64')}  (platform=${targetPlatform} variant=${variant})`
    : `\nBuilding ${artifactName}  (platform=${targetPlatform} variant=${variant})`
);

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
// TARGET: Full App Installer (full / trial variants)
// ==========================================
// Clean only the temporary build output to preserve previously generated
// installers. Do NOT blanket-delete dist-electron/: the finished installers
// live here and they are built one variant at a time across both platforms,
// so a wipe would destroy artifacts this run cannot rebuild.
//
// electron-builder names the unpacked dir per-arch on mac (mac-arm64, mac),
// but always win-unpacked on Windows regardless of arch.
const unpackedDirsForTarget = isMac ? ['mac-arm64', 'mac'] : ['win-unpacked'];
for (const dir of unpackedDirsForTarget) {
  const p = path.join(distElectron, dir);
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

// Disposable per-build metadata and staging artifacts. Each build drops a fresh
// .blockmap/latest.yml, so these accumulate indefinitely; none of them ship.
function isBuildRemnant(entry) {
  return (
    entry === 'builder-effective-config.yaml' ||
    entry === 'builder-debug.yml' ||
    entry === 'latest.yml' ||
    entry === '.icon-set' ||
    entry === '.icon-ico' ||
    entry.endsWith('.blockmap')
  );
}
if (fs.existsSync(distElectron)) {
  for (const entry of fs.readdirSync(distElectron).filter(isBuildRemnant)) {
    fs.rmSync(path.join(distElectron, entry), { recursive: true, force: true });
  }
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
// fails on a >2GB archive. src/, docs/ and marketing/ are small by comparison
// but would ship our sources and internal notes to every customer. Remove them
// unconditionally and loudly.
for (const dir of ['dist-electron', 'pgsql', 'pg_data', 'src', 'docs', 'marketing']) {
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
// Trial builds set WVO_IS_TRIAL so src/lib/trial.ts activates the 30-day lock.
// There is no plan stamp any more (v2.0 has no tier) — a trial build simply
// runs the full feature set for 30 days, same as every other install.
if (variant === 'trial') {
  envContent += `\nWVO_IS_TRIAL="true"\n`;
}
fs.writeFileSync(envDest, envContent, 'utf8');
console.log(`\nCopied .env.local into standalone bundle${variant === 'trial' ? ' with WVO_IS_TRIAL' : ''}.`);

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

// Platform-aware payload dirs and binary names. Mac binaries live in
// pgsql-mac/ — a parallel, gitignored directory, kept separate from the
// Windows payload because the binaries themselves differ (no .exe suffix,
// different architectures).
const pgPayloadDir = isMac ? 'pgsql-mac' : 'pgsql';
const pgCtlName = isMac ? 'pg_ctl' : 'pg_ctl.exe';

// 6. Verify the bundled PostgreSQL binaries are present. electron-builder
// silently skips a missing extraResources source, so building without them
// would ship an installer with no database engine at all (every install that
// self-boots would 500 on first query). Hard-fail instead.
if (!fs.existsSync(path.join(root, pgPayloadDir, 'bin', pgCtlName))) {
  console.error(`\n❌ Error: ${pgPayloadDir}/bin/${pgCtlName} not found — the installer would ship WITHOUT PostgreSQL and every self-booting install would fail on first launch.`);
  console.error(
    isMac
      ? `Fetch macOS PostgreSQL binaries (see PLAN_2026-09-08-macos-support.md Phase 2b) and place them at ${pgPayloadDir}/.\n`
      : `Recreate pgsql/ per MANUAL_Setup_Installation.md §1 (portable PostgreSQL 17.6 zip at the project root).\n`
  );
  process.exit(1);
}

// 7. Package with electron-builder using a per-variant config derived from
// package.json's "build" key. package.json stays the single source of truth;
// only the delta (artifact name) is computed here, so the two cannot drift.
const builderConfig = JSON.parse(JSON.stringify(require(path.join(root, 'package.json')).build));
builderConfig[targetPlatform].artifactName = artifactName;
const builderConfigPath = path.join(root, '.next', `electron-builder.${targetPlatform}-${variant}.json`);
fs.writeFileSync(builderConfigPath, JSON.stringify(builderConfig, null, 2), 'utf8');
run(`npx electron-builder --${targetPlatform} --config "${builderConfigPath}"`);

// 7b. Assert the packaged output actually contains the pieces electron-builder
// is known to drop silently (missing extraResources sources, node_modules).
// Mac produces two separate app bundles in one invocation — arm64 unpacks to
// mac-arm64/, x64 to mac/ (Windows only ever builds win-unpacked/) — and
// Resources sits inside the .app bundle, unlike Windows's flat
// win-unpacked/resources. Both mac outputs ship as real, distinctly-named
// artifacts (see the "${arch}" note on ARTIFACT_NAMES.mac above), so both
// must be verified — checking only one leaves the other's installer unproven.
const buildTargets = isMac
  ? [
      { arch: 'arm64', unpackedDir: 'mac-arm64' },
      { arch: 'x64', unpackedDir: 'mac' },
    ]
  : [{ arch: null, unpackedDir: 'win-unpacked' }];
const resourcesRel = isMac ? ['WhiteVanOps.app', 'Contents', 'Resources'] : ['resources'];

// Parse the asar header: 16-byte pickle prefix, header length at offset 12.
function asarTopLevelModules(asarPath) {
  const fd = fs.openSync(asarPath, 'r');
  try {
    const prefix = Buffer.alloc(16);
    fs.readSync(fd, prefix, 0, 16, 0);
    const headerLen = prefix.readUInt32LE(12);
    const headerBuf = Buffer.alloc(headerLen);
    fs.readSync(fd, headerBuf, 0, headerLen, 16);
    const header = JSON.parse(headerBuf.toString('utf8').replace(/\0+$/, ''));
    return Object.keys((header.files && header.files.node_modules && header.files.node_modules.files) || {});
  } finally {
    fs.closeSync(fd);
  }
}

// electron-builder copies production dependencies only into app.asar, so
// demoting one of these to devDependencies in package.json yields an
// installer that dies with "Cannot find module" on first launch — on the
// customer's machine, not here. Everything else the app needs is resolved
// from resources/nextjs by the Next.js server, which is why only these five
// stay in "dependencies".
const ELECTRON_RUNTIME_MODULES = ['bcryptjs', 'firebase', 'node-cron', 'node-machine-id', 'pg'];

for (const { arch, unpackedDir } of buildTargets) {
  const label = arch ? `${unpackedDir}/ (${arch})` : unpackedDir;
  for (const rel of [
    [...resourcesRel, 'pgsql', 'bin', pgCtlName],
    [...resourcesRel, 'nextjs', 'node_modules', 'next'],
    // Turbopack externalizes @prisma/client but the standalone trace does not
    // copy it (or the generated .prisma/client) into the bundle. Without these,
    // the packaged server throws "Cannot find module '@prisma/client-<hash>'" at
    // runtime and every DB-backed route 500s — the login-500 bug that shipped in
    // the first self-booting installer. next.config.ts forces them in via
    // outputFileTracingIncludes; assert they actually landed.
    [...resourcesRel, 'nextjs', 'node_modules', '@prisma', 'client'],
    [...resourcesRel, 'nextjs', 'node_modules', '@prisma', 'client-runtime-utils'],
    [...resourcesRel, 'nextjs', 'node_modules', '.prisma', 'client'],
    [...resourcesRel, 'app.asar'],
  ]) {
    const p = path.join(distElectron, unpackedDir, ...rel);
    if (!fs.existsSync(p)) {
      console.error(`\n❌ Error: packaged output (${label}) is missing ${rel.join('/')} — the installer in dist-electron/ is broken, do not ship it.`);
      process.exit(1);
    }
  }

  // 7c. Assert app.asar still carries every module electron/*.js requires at launch.
  const asarPath = path.join(distElectron, unpackedDir, ...resourcesRel, 'app.asar');
  let bundledModules;
  try {
    bundledModules = asarTopLevelModules(asarPath);
  } catch (err) {
    console.error(`\n❌ Error: could not read the app.asar header for ${label} (${err.message}) — cannot verify the installer, do not ship it.`);
    process.exit(1);
  }
  const missingModules = ELECTRON_RUNTIME_MODULES.filter((m) => !bundledModules.includes(m));
  if (missingModules.length) {
    console.error(`\n❌ Error: app.asar (${label}) is missing Electron runtime dependencies: ${missingModules.join(', ')}`);
    console.error('electron/*.js requires these at launch. Move them from "devDependencies" back to "dependencies" in package.json.\n');
    process.exit(1);
  }
  const asarMb = (fs.statSync(asarPath).size / (1024 * 1024)).toFixed(0);
  console.log(`\nVerified app.asar (${label}, ${asarMb} MB, ${bundledModules.length} modules) carries all ${ELECTRON_RUNTIME_MODULES.length} Electron runtime deps.`);
}

// 8. electron-builder already wrote the final name(s) via
// builderConfig[targetPlatform].artifactName (set above from ARTIFACT_NAMES)
// — no post-hoc rename needed. Mac writes two files (one per arch); resolve
// each one's real name ourselves since electron-builder did its own
// "${arch}" substitution internally and never reports the concrete names back.
for (const { arch } of buildTargets) {
  const name = resolvedArtifactName(arch);
  const finalArtifact = path.join(distElectron, name);
  if (fs.existsSync(finalArtifact)) {
    console.log(`\n✅ Success! Installer built at: ${finalArtifact}`);
  } else {
    console.warn(`\nNote: expected ${name} in dist-electron/ but did not find it — check electron-builder output above.`);
  }
}

// 9. Stamp each build so it can be told apart from an older file with the same
// name sitting in dist-electron/ from a previous run — the artifact names are
// otherwise fixed, so nothing about the filename itself reveals when or from
// what code it was built. Writes a human-readable sidecar next to each
// installer (travels with the file if it's copied elsewhere) and updates a
// shared manifest across all variants (and, on mac, both arches), tracked in
// an internal JSON store so later builds can merge into it without clobbering
// other variants'/arches' entries.
const appVersion = require(path.join(root, 'package.json')).version;
let gitCommit = 'unknown (not a git checkout)';
let gitDirty = false;
try {
  gitCommit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
  gitDirty = execSync('git status --porcelain', { cwd: root }).toString().trim().length > 0;
} catch {
  // Not fatal — a build should still succeed outside a git checkout.
}
const builtAt = new Date().toISOString();

const manifestJsonPath = path.join(distElectron, '.build-manifest.json');
let manifest = {};
if (fs.existsSync(manifestJsonPath)) {
  try {
    manifest = JSON.parse(fs.readFileSync(manifestJsonPath, 'utf8'));
  } catch {
    manifest = {};
  }
}

for (const { arch } of buildTargets) {
  const name = resolvedArtifactName(arch);
  const finalArtifact = path.join(distElectron, name);
  if (!fs.existsSync(finalArtifact)) continue;

  const buildInfo = { artifactName: name, variant, appVersion, gitCommit, gitDirty, builtAt };

  fs.writeFileSync(
    path.join(distElectron, `${name}.buildinfo.txt`),
    [
      `Installer:    ${name}`,
      `App version:  ${appVersion}`,
      `Git commit:   ${gitCommit}${gitDirty ? ' (built with uncommitted changes — do not ship)' : ''}`,
      `Built:        ${builtAt}`,
      '',
    ].join('\n'),
    'utf8'
  );

  manifest[name] = buildInfo;
}
fs.writeFileSync(manifestJsonPath, JSON.stringify(manifest, null, 2), 'utf8');

const allArtifactNames = [
  ...Object.values(ARTIFACT_NAMES.win),
  ...Object.values(ARTIFACT_NAMES.mac).flatMap((n) => ['arm64', 'x64'].map((a) => n.replace('${arch}', a))),
];
const manifestLines = ['All installers currently on record in dist-electron/:', ''];
for (const name of allArtifactNames) {
  const info = manifest[name];
  if (!info) {
    manifestLines.push(`  ${name} — NOT BUILT YET`);
    continue;
  }
  const staleFlag = info.gitCommit !== gitCommit ? '  <-- different commit than the build just run; rebuild before shipping alongside it' : '';
  const dirtyFlag = info.gitDirty ? '  (built with uncommitted changes)' : '';
  manifestLines.push(`  ${name} — v${info.appVersion}, commit ${info.gitCommit}, built ${info.builtAt}${dirtyFlag}${staleFlag}`);
}
fs.writeFileSync(path.join(distElectron, 'BUILD-MANIFEST.txt'), manifestLines.join('\n') + '\n', 'utf8');
console.log(`\n${manifestLines.join('\n')}`);
console.log(`\nSee dist-electron/BUILD-MANIFEST.txt for this table, or <installer name>.buildinfo.txt for just that installer.`);

console.log('\nBuild complete.');
