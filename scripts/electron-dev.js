// Starts next dev, detects the actual port, then launches Electron on that port.
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
let launched = false;

const nextProc = spawn('npx next dev', [], {
  cwd: root,
  shell: true,
  stdio: ['inherit', 'pipe', 'pipe'],
  env: { ...process.env },
});

nextProc.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);

  if (launched) return;

  // Next.js prints "Local:   http://localhost:XXXX" when ready
  const match = text.match(/Local:\s+http:\/\/localhost:(\d+)/);
  if (match) {
    launched = true;
    const port = match[1];
    console.log(`\nNext.js ready on port ${port} — launching Electron...\n`);

    const electronProc = spawn('npx electron .', [], {
      cwd: root,
      shell: true,
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_DEV_PORT: port },
    });

    electronProc.on('close', () => {
      nextProc.kill();
      process.exit(0);
    });
  }
});

nextProc.stderr.on('data', (d) => process.stderr.write(d));

nextProc.on('error', (err) => {
  console.error('Failed to start Next.js:', err.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  nextProc.kill();
  process.exit(0);
});
