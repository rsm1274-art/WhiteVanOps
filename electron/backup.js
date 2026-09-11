const cron = require('node-cron');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

let currentPort = 3000;

function getBackupConfig() {
  return new Promise((resolve) => {
    http.get(`http://localhost:${currentPort}/api/settings?key=backup_target_dir`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json.value || '');
        } catch {
          resolve('');
        }
      });
    }).on('error', () => {
      resolve('');
    });
  });
}

async function runBackupNow(isDev, resourcesPath) {
  const targetDir = await getBackupConfig();
  if (!targetDir) {
    console.log('[backup] Backup skipped: No target directory configured.');
    return;
  }
  
  if (!fs.existsSync(targetDir)) {
    console.error(`[backup] Target directory does not exist: ${targetDir}`);
    return;
  }

  // Find pg_dump
  const isWin = process.platform === 'win32';
  const pgBinDir = isDev
    ? path.join(__dirname, '..', 'pgsql', 'bin')
    : path.join(resourcesPath, 'pgsql', 'bin');

  const pgDumpExe = path.join(pgBinDir, isWin ? 'pg_dump.exe' : 'pg_dump');

  if (!fs.existsSync(pgDumpExe)) {
    console.error(`[backup] pg_dump not found at ${pgDumpExe}`);
    return;
  }

  // pg_dump -F c (custom format) is compressed and easily restorable, so we
  // output that directly via spawn args rather than piping through a shell.
  const now = new Date();
  const dateStr = now.toISOString().replace(/T/, '_').replace(/:/g, '').substring(0, 15);
  const fileName = `WhiteVanOps_Backup_${dateStr}.sql`;
  const filePath = path.join(targetDir, fileName);

  console.log(`[backup] Starting backup to ${filePath}...`);

  // We need the DATABASE_URL. In Electron, process.env.DATABASE_URL is set
  // directly by main.js before the server boots, so this file fallback only
  // matters when runBackupNow runs outside that flow (dev/testing).
  let dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    const envPath = isDev 
      ? path.join(__dirname, '..', '.env.local') 
      : path.join(resourcesPath, 'nextjs', '.env.local');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      const match = content.match(/DATABASE_URL="([^"]+)"/);
      if (match) dbUrl = match[1];
    }
  }
  
  if (!dbUrl) {
    console.error('[backup] DATABASE_URL not found, cannot backup.');
    return;
  }

  // Prisma's DATABASE_URL includes a `?schema=` query param that libpq/pg_dump
  // doesn't understand ("invalid URI query parameter"). Strip it before use.
  const pgDumpUrl = new URL(dbUrl);
  pgDumpUrl.searchParams.delete('schema');

  const proc = spawn(pgDumpExe, ['--dbname', pgDumpUrl.toString(), '--file', filePath, '--format=c', '--compress=9']);
  
  proc.stdout.on('data', (data) => console.log(`[backup] ${data}`));
  proc.stderr.on('data', (data) => console.error(`[backup err] ${data}`));
  
  proc.on('close', (code) => {
    if (code === 0) {
      console.log(`[backup] Successfully completed backup to ${filePath}`);
    } else {
      console.error(`[backup] Process exited with code ${code}`);
    }
  });
}

function startBackupScheduler(port, isDev, resourcesPath) {
  currentPort = port;
  console.log('[backup] Initializing nightly backup scheduler at 2:00 AM');
  
  // Run every day at 02:00
  cron.schedule('0 2 * * *', () => {
    console.log('[backup] Triggering scheduled backup...');
    runBackupNow(isDev, resourcesPath);
  });
}

module.exports = { startBackupScheduler, runBackupNow };
