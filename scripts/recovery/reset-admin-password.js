// ---------------------------------------------------------------------------
// Admin password recovery — runs ON A CUSTOMER'S MACHINE.
//
// Why this exists: if every admin/superuser account is locked out, the only way
// back in is to rewrite a password hash directly in the bundled PostgreSQL.
// A customer machine has no Node install, no repo, and no tsx, so
// prisma/bootstrap.ts is unavailable there. This script is therefore written to
// need nothing that isn't already on the machine:
//
//   - Node runtime  → the installed Electron binary, via ELECTRON_RUN_AS_NODE=1
//                     (Electron's main process IS Node). reset-admin-password.ps1
//                     sets that up for you.
//   - pg, bcryptjs  → resolved from the app's own bundled node_modules.
//   - credentials   → read from the install's resources/nextjs/.env.local.
//
// Run it via the .ps1 wrapper in this folder. Full walkthrough:
// docs/MANUAL_Troubleshooting.md §3.4.
//
// The new password is never accepted as a command-line argument: on Windows it
// would land in PSReadLine history and be visible in the process list to any
// other user on the machine. A random temporary password is generated instead
// and the account is flagged mustChangePassword, so the owner must set their
// own at next login and the temporary one stops working immediately.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const args = process.argv.slice(2);

function argValue(flag, fallback = null) {
  const i = args.indexOf(flag);
  if (i === -1 || i + 1 >= args.length) return fallback;
  return args[i + 1];
}

function fail(msg, ...extra) {
  console.error(`\nERROR: ${msg}`);
  for (const line of extra) console.error(`       ${line}`);
  console.error("");
  process.exit(1);
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
Admin password recovery for WhiteVanOps.

Usage (via the wrapper):
  .\\reset-admin-password.ps1 [-InstallDir <path>] [-Username <name>] [-List] [-Create]

Options:
  --install-dir <path>  Install root (the folder containing resources\\nextjs).
                        Auto-detected when run from inside an install tree.
  --username <name>     Account to reset. Default: admin
  --list                Show existing admin/superuser accounts and exit without
                        changing anything.
  --create              Recreate the account as a superuser if it is missing
                        (use when the account itself was deleted).

Generates a random temporary password, prints it once, and forces a password
change at next login.
`);
  process.exit(0);
}

// --- Locate the install -----------------------------------------------------
// Packaged layout: <install>\resources\nextjs\.env.local
// Dev layout:      <repo>\.env.local
function resolveNextjsDir() {
  const explicit = argValue("--install-dir");
  const candidates = [];

  if (explicit) {
    candidates.push(path.join(explicit, "resources", "nextjs"));
    candidates.push(path.join(explicit, "nextjs"));
    candidates.push(explicit);
  }

  // Walk up from this script — covers being run from inside an install tree.
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, "resources", "nextjs"));
    candidates.push(path.join(dir, "nextjs"));
    dir = path.dirname(dir);
  }

  // Dev repo: .env.local sits at the root, two levels up from scripts/recovery.
  candidates.push(path.join(__dirname, "..", ".."));

  for (const c of candidates) {
    if (fs.existsSync(path.join(c, ".env.local"))) return path.resolve(c);
  }
  return null;
}

const nextjsDir = resolveNextjsDir();
if (!nextjsDir) {
  fail(
    "Could not find .env.local — I don't know where WhiteVanOps is installed.",
    "Pass the install folder explicitly, e.g.:",
    '  -InstallDir "C:\\Program Files\\WhiteVanOps"'
  );
}
console.log(`Using configuration from: ${path.join(nextjsDir, ".env.local")}`);

// --- Read DATABASE_URL ------------------------------------------------------
function parseEnvFile(file) {
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const env = parseEnvFile(path.join(nextjsDir, ".env.local"));
if (!env.DATABASE_URL) {
  fail("No DATABASE_URL in .env.local — this install has no database configured.");
}

let dbUrl;
try {
  dbUrl = new URL(env.DATABASE_URL);
} catch {
  fail("DATABASE_URL in .env.local is not a valid URL.");
}

// --- Resolve the app's bundled modules --------------------------------------
function requireBundled(name) {
  const attempts = [
    () => require(name),
    () => require(path.join(nextjsDir, "node_modules", name)),
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch {
      /* try the next location */
    }
  }
  fail(
    `Could not load '${name}' from the installed app.`,
    `Looked in: ${path.join(nextjsDir, "node_modules", name)}`,
    "Is this a complete WhiteVanOps installation?"
  );
}

const { Client } = requireBundled("pg");
const bcrypt = requireBundled("bcryptjs");

// --- Do the work ------------------------------------------------------------
function generatePassword() {
  // Ambiguous characters omitted: this gets read aloud over the phone.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += alphabet[crypto.randomInt(0, alphabet.length)];
  }
  return out;
}

async function main() {
  const username = argValue("--username", "admin");
  const listOnly = args.includes("--list");
  const allowCreate = args.includes("--create");

  const client = new Client({
    host: dbUrl.hostname,
    port: Number(dbUrl.port || 5432),
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    database: dbUrl.pathname.replace(/^\//, "") || "postgres",
  });

  try {
    await client.connect();
  } catch (e) {
    fail(
      `Could not connect to the database at ${dbUrl.hostname}:${dbUrl.port}.`,
      `(${e.message})`,
      "The bundled PostgreSQL only runs while WhiteVanOps is open.",
      "Start WhiteVanOps, leave it sitting at the login screen, and run this again."
    );
  }

  try {
    if (listOnly) {
      const { rows } = await client.query(
        `SELECT "username","role","mustChangePassword" FROM "User" WHERE "role" IN ('admin','superuser') ORDER BY "username";`
      );
      if (rows.length === 0) {
        console.log("\nNo admin or superuser accounts exist. Use -Create to make one.\n");
      } else {
        console.log("\nAdmin/superuser accounts on this install:\n");
        for (const r of rows) {
          const flag = r.mustChangePassword ? "(must change password)" : "";
          console.log(`  ${r.username.padEnd(20)} ${r.role.padEnd(12)}${flag}`);
        }
        console.log("");
      }
      return;
    }

    const password = generatePassword();
    const hash = bcrypt.hashSync(password, 12);

    const { rows } = await client.query(`SELECT "id","role" FROM "User" WHERE "username" = $1;`, [username]);

    if (rows.length === 0) {
      if (!allowCreate) {
        fail(
          `No account named '${username}' exists on this install.`,
          "Run with -List to see which accounts do exist,",
          "or add -Create to recreate this one as a superuser."
        );
      }
      // Prisma generates cuids client-side; supply id and updatedAt ourselves.
      const id = crypto.randomBytes(12).toString("hex");
      await client.query(
        `INSERT INTO "User" ("id","username","passwordHash","displayName","role","mustChangePassword","updatedAt")
         VALUES ($1,$2,$3,$4,'superuser',true,NOW());`,
        [id, username, hash, "Administrator"]
      );
      console.log(`\nCreated a new superuser account '${username}'.`);
    } else {
      // Clearing the lockout is not optional. Five failed attempts set
      // failedLoginAttempts/lockedUntil for 15 minutes, and someone reaching
      // for this script has almost always just tripped that. Resetting only
      // the hash would report success and still bounce them at the login
      // screen until the lock aged out.
      await client.query(
        `UPDATE "User"
            SET "passwordHash" = $1,
                "mustChangePassword" = true,
                "failedLoginAttempts" = 0,
                "lockedUntil" = NULL,
                "active" = true,
                "updatedAt" = NOW()
          WHERE "username" = $2;`,
        [hash, username]
      );
      console.log(`\nReset the password for '${username}' (role: ${rows[0].role}).`);
      console.log("Cleared any failed-attempt lockout on the account.");
    }

    console.log("\n  ────────────────────────────────────────────");
    console.log(`   Username:           ${username}`);
    console.log(`   Temporary password: ${password}`);
    console.log("  ────────────────────────────────────────────");
    console.log("\nLog in with this now. The app will immediately require a new");
    console.log("password to be set, after which the temporary one stops working.");
    console.log("\nThis password is shown once and is not stored anywhere.\n");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  fail(e.message);
});
