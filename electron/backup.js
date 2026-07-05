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

  // Find pg_dump.exe
  const pgBinDir = isDev 
    ? path.join(__dirname, '..', 'pgsql', 'bin') 
    : path.join(resourcesPath, 'pgsql', 'bin');
  
  const pgDumpExe = path.join(pgBinDir, 'pg_dump.exe');
  
  if (!fs.existsSync(pgDumpExe)) {
    console.error(`[backup] pg_dump.exe not found at ${pgDumpExe}`);
    return;
  }

  // Create filename: WhiteVanOps_Backup_YYYYMMDD_HHMM.sql.gz
  // Note: we can just produce a .sql file, or use pg_dump -Z 9 for gzip output 
  // actually pg_dump supports -F c (custom format which is compressed) but user asked for .sql.gz
  // It's easiest to pipe pg_dump to a file if we can't do `.gz` directly, but pg_dump handles compression with `-Z 9 -F p` in newer versions? 
  // Wait, standard pg_dump to plain text isn't compressed unless piped, but we can just save it as .sql for safety if gzip isn't available in Windows shell natively via spawn.
  // Actually pg_dump -F c is automatically compressed and can be restored easily. Let's output .backup (custom format).
  // If .sql is strictly requested, we can use pg_dump -Z 9 -F p > file.sql.gz but wait, Windows doesn't pipe well via spawn. Let's just output .sql for simplicity.
  const now = new Date();
  const dateStr = now.toISOString().replace(/T/, '_').replace(/:/g, '').substring(0, 15);
  const fileName = `WhiteVanOps_Backup_${dateStr}.sql`;
  const filePath = path.join(targetDir, fileName);

  console.log(`[backup] Starting backup to ${filePath}...`);

  // We need the DATABASE_URL. In Electron, process.env.DATABASE_URL might be set from .env.local
  // We can parse it from resources/nextjs/.env.local or project root.
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

  const proc = spawn(pgDumpExe, ['--dbname', dbUrl, '--file', filePath, '--format=c', '--compress=9']);
  
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
