// Bundled PostgreSQL lifecycle for the packaged desktop app.
//
// The installer ships portable PostgreSQL binaries in resources/pgsql and the
// concatenated Prisma migrations in resources/db/schema.sql. On startup we:
//   1. Ensure resources/nextjs/.env.local exists (generate one with unique
//      random credentials on first launch of a generic build).
//   2. Parse DATABASE_URL. If it isn't a localhost URL, or something is
//      already listening on its port (the office PM2 machine's own Postgres,
//      or a user-managed install), we manage nothing.
//   3. Otherwise initdb a data directory under %APPDATA%/whitevanops/pgdata
//      on first run, start the server with pg_ctl, and on first run create
//      the database, apply the schema, and bootstrap the admin/admin
//      superuser (mustChangePassword = true).
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

function log(msg) {
  console.log(`[postgres] ${msg}`);
}

function isPortInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port, timeout: 800 });
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
  });
}

// Minimal .env parser — enough for the KEY="value" lines we write/read.
function parseEnvFile(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

function ensureEnvLocal(nextjsDir) {
  const envPath = path.join(nextjsDir, '.env.local');
  if (fs.existsSync(envPath)) return parseEnvFile(envPath);

  // Generic build with no bundled credentials: generate unique ones so every
  // install gets its own SESSION_SECRET and database password.
  const dbPassword = crypto.randomBytes(18).toString('hex');
  const sessionSecret = crypto.randomBytes(48).toString('hex');
  const databaseUrl = `postgresql://wvo_user:${dbPassword}@localhost:5433/white_van_ops?schema=public`;
  fs.writeFileSync(
    envPath,
    `DATABASE_URL="${databaseUrl}"\nSESSION_SECRET="${sessionSecret}"\n`,
    { mode: 0o600 }
  );
  log('Generated .env.local with fresh credentials.');
  return { DATABASE_URL: databaseUrl, SESSION_SECRET: sessionSecret };
}

function run(exe, args, extraEnv) {
  return execFileSync(exe, args, {
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

// pg_ctl start/stop must not inherit our pipes: the spawned postgres daemon
// keeps stdout open forever, which would make execFileSync hang. Errors are
// still recorded in the server log file.
function runDetachedIo(exe, args, extraEnv) {
  return execFileSync(exe, args, {
    env: { ...process.env, ...extraEnv },
    stdio: 'ignore',
    windowsHide: true,
  });
}

// Bootstrap the initial superuser directly over SQL. Prisma generates cuid
// ids client-side, so we must supply id and updatedAt ourselves.
function bootstrapAdmin(psql, connArgs, env, nextjsDir) {
  // bcryptjs is a production dependency, so electron-builder packs it into
  // app.asar — plain require resolves it there. The standalone-bundle path is
  // a fallback for running outside the packaged app (dev/testing).
  let bcrypt;
  try {
    bcrypt = require('bcryptjs');
  } catch {
    bcrypt = require(path.join(nextjsDir, 'node_modules', 'bcryptjs'));
  }
  const hash = bcrypt.hashSync('admin', 12);
  const id = crypto.randomBytes(12).toString('hex');
  const sql =
    `INSERT INTO "User" ("id","username","passwordHash","displayName","role","mustChangePassword","updatedAt") ` +
    `VALUES ('${id}','admin','${hash}','Administrator','superuser',true,NOW()) ` +
    `ON CONFLICT ("username") DO NOTHING;`;
  run(psql, [...connArgs, '-v', 'ON_ERROR_STOP=1', '-c', sql], env);
  log('Bootstrapped admin superuser (admin/admin, forced password change).');
}

async function ensurePostgres({ resourcesPath }) {
  const nextjsDir = path.join(resourcesPath, 'nextjs');
  const pgDir = path.join(resourcesPath, 'pgsql');
  const schemaFile = path.join(resourcesPath, 'db', 'schema.sql');

  const env = ensureEnvLocal(nextjsDir);
  if (!env.DATABASE_URL) {
    log('No DATABASE_URL — skipping database management.');
    return { managed: false };
  }

  const url = new URL(env.DATABASE_URL);
  const host = url.hostname;
  const port = parseInt(url.port, 10) || 5432;
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const dbName = url.pathname.replace(/^\//, '') || 'white_van_ops';

  if (host !== 'localhost' && host !== '127.0.0.1') {
    log(`DATABASE_URL points at ${host} — external database, not managed.`);
    return { managed: false };
  }
  if (await isPortInUse(port)) {
    log(`Port ${port} already has a listener — reusing the existing database server.`);
    return { managed: false };
  }
  if (!fs.existsSync(path.join(pgDir, 'bin', 'pg_ctl.exe'))) {
    // We are the only thing that could provide a database here (localhost URL,
    // nothing listening) — silently continuing would boot a web server whose
    // every query fails with "Failed to load dashboard data". Fail loudly so
    // main.js surfaces a clear startup dialog instead. The office PM2 machine
    // never reaches this: isServerUp()/the port check above return earlier.
    throw new Error(
      `Database engine missing: this installation has no bundled PostgreSQL (${pgDir}) ` +
      `and nothing is running on port ${port}. The installer was likely built without the ` +
      `pgsql/ binaries — reinstall from a complete installer, or start a PostgreSQL server ` +
      `matching DATABASE_URL yourself.`
    );
  }

  const bin = (exe) => path.join(pgDir, 'bin', `${exe}.exe`);
  const dataDir = path.join(
    process.env.APPDATA || os.homedir(),
    'whitevanops',
    'pgdata'
  );
  const logFile = path.join(path.dirname(dataDir), 'postgres.log');
  // Sentinel written only after initdb + schema + admin bootstrap all
  // succeeded — a failed first run is wiped and retried on next launch.
  const sentinel = path.join(path.dirname(dataDir), 'bootstrap-complete');
  const firstRun = !fs.existsSync(sentinel);

  if (firstRun && fs.existsSync(dataDir)) {
    log('Previous incomplete bootstrap detected — starting over.');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  if (firstRun) {
    log(`Initializing new database cluster at ${dataDir} ...`);
    fs.mkdirSync(dataDir, { recursive: true });
    const pwFile = path.join(os.tmpdir(), `wvo-pg-${process.pid}.tmp`);
    fs.writeFileSync(pwFile, password, { mode: 0o600 });
    try {
      run(bin('initdb'), [
        '-D', dataDir,
        '-U', user,
        '-E', 'UTF8',
        '--locale=C',
        '-A', 'scram-sha-256',
        `--pwfile=${pwFile}`,
      ]);
    } finally {
      fs.unlinkSync(pwFile);
    }
  }

  log(`Starting PostgreSQL on port ${port} ...`);
  runDetachedIo(bin('pg_ctl'), [
    '-D', dataDir,
    '-l', logFile,
    '-w', '-t', '60',
    '-o', `-p ${port} -c listen_addresses=127.0.0.1`,
    'start',
  ]);

  const pgEnv = { PGPASSWORD: password };
  const connArgs = ['-h', '127.0.0.1', '-p', String(port), '-U', user];

  if (firstRun) {
    try {
      log(`Creating database "${dbName}" and applying schema ...`);
      run(bin('createdb'), [...connArgs, dbName], pgEnv);
      run(bin('psql'), [...connArgs, '-d', dbName, '-v', 'ON_ERROR_STOP=1', '-f', schemaFile], pgEnv);
      bootstrapAdmin(bin('psql'), [...connArgs, '-d', dbName], pgEnv, nextjsDir);
      fs.writeFileSync(sentinel, new Date().toISOString());
    } catch (err) {
      // Roll back the half-initialized cluster so the next launch retries.
      try { runDetachedIo(bin('pg_ctl'), ['-D', dataDir, '-m', 'immediate', 'stop']); } catch { /* already down */ }
      fs.rmSync(dataDir, { recursive: true, force: true });
      throw err;
    }
  }

  log('Database ready.');
  return {
    managed: true,
    stop() {
      try {
        runDetachedIo(bin('pg_ctl'), ['-D', dataDir, '-m', 'fast', '-w', '-t', '30', 'stop']);
        log('PostgreSQL stopped.');
      } catch (err) {
        log(`Failed to stop PostgreSQL cleanly: ${err.message}`);
      }
    },
  };
}

module.exports = { ensurePostgres };
