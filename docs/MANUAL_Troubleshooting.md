# White Van Ops — Troubleshooting Manual

**Who this is for:** you, on the phone with a customer or standing in their office, when something isn't working.

**How to use it:** find the symptom, not the cause. The customer will never tell you "my DHCP reservation lapsed" — they'll say "the app stopped working on my guys' phones." Symptoms are the headings.

Each entry follows the same shape: **Symptom → What's actually happening → Fix → How to stop it happening again.**

> **A note on honesty:** this manual is a starting point built from how the system is designed, not from years of field history. Entries marked ✅ are confirmed by how the code actually works. Entries marked 🔮 are anticipated — reasonable predictions, not observations. When you hit something not in here, **add it** (see Part 5).

---

## Part 0: Triage — The First Four Questions

Before diving in, these four answers eliminate most of the search space. Ask them every time.

1. **Is it broken for everyone, or one person?** Everyone → server/PC/database. One person → that phone, that login, that browser.
2. **Is it broken for a phone on the office WiFi, or for the desktop app itself?** Phone-only → networking/field access (Part 2). Desktop too → the app itself (Part 3). (There is no "outside the office" case to consider — field access never reaches beyond the office WiFi.)
3. **What changed?** Windows update, new router, ISP visit, power cut, someone "cleaned up" the PC. Nothing breaks at random. Something changed.
4. **Is the office PC actually on and awake?** Sounds insulting. Ask anyway. It's the answer more often than any other single item.

---

## Part 1: Licensing & Activation

### 1.1 ✅ "We replaced the office computer and now the app won't activate" (The Dead PC)

**Symptom:** Customer's PC died, was replaced, was reformatted, or had major hardware swapped. They reinstall White Van Ops, type in the license key they've had for two years, and get **"This license key is already in use on another machine."**

**What's actually happening:** This is working as designed, and it's the single most predictable support call you will get. When they first activated, the app read a hardware fingerprint from that PC and stamped it into the `machineId` field of their key's record in your Firestore database. The key now belongs to that fingerprint. The new PC has a different fingerprint. The key refuses it.

**Fix — only you can do this. It takes about a minute:**

1. Go to the [Firebase Console](https://console.firebase.google.com/) and open the **white-van-ops-licensing** project.
2. Open **Firestore Database** → the **`licenses`** collection.
3. Find the document whose ID is their key (e.g. `WVO-4A2F-91BC-D7E3-0518`). *This is why you keep the customer→key spreadsheet — otherwise you're scrolling a list of anonymous keys.*
4. Edit the **`machineId`** field. Clear it — set it back to `null` / empty.
5. Confirm **`active`** is still `true`.
6. Tell the customer to type the key in again. The app sees `machineId` is empty, claims it for the new PC, and activates.

**Verify before you do it:** that the old PC is genuinely gone. Clearing the field is exactly how a customer would run two installs off one key — one at the office and one at home. It's not a big fraud risk with trade businesses, but the point of the machine lock is defeated if you clear it on request without asking. Ask what happened to the old machine.

**How to stop it happening again:** you can't, and you shouldn't try — the lock is doing its job. What you *can* do is make it a 60-second call instead of a panic:

- Keep the **customer → key → date sold** spreadsheet current. Without it this fix is impossible.
- **Practice it once, right now, on a throwaway key**, before a real customer is on the phone. Mint a key, activate it on a VM or your own machine, then go clear it in the console. You want the muscle memory before it matters.
- Warn them at handoff: *"If you ever replace this PC, call me first — there's a 60-second thing I have to do on my end, and the software won't activate until I do it."* Customers forgive a known process. They don't forgive a surprise.

**⚠️ The version of this that will really hurt:** a customer replaces their PC and *also* has no working backup. The license is recoverable in a minute. **Their data isn't recoverable at all.** See §3.7 — this is the scenario that makes backup verification worth your time.

---

### 1.2 🔮 "The app suddenly wants a license key again and it's been working for a year"

**Symptom:** A long-working install throws up the activation window out of nowhere. Nobody replaced the PC.

**What's actually happening:** The activation is stored as a signed file in `%APPDATA%\whitevanops\license.json` and re-checked against the machine fingerprint on every launch. It stops matching if:

- **The file was deleted** — a "PC cleanup" tool, a new Windows user profile, or someone clearing AppData.
- **The fingerprint changed.** On Windows the ID comes from `MachineGuid` in the registry (`HKLM\SOFTWARE\Microsoft\Cryptography`). A **Windows reinstall regenerates it**, even on identical hardware. Some imaging/cloning tools reset it too.
- **They're logged into a different Windows user account** than the one that activated — AppData is per-user.

**Fix:** check the Windows account first — if they're in a different profile, log back into the original and it'll just work. Otherwise this is functionally the Dead PC case: clear `machineId` in Firestore (§1.1) and re-activate.

**Prevention:** at handoff, tell them the app runs from *one* Windows account on that PC. If the office starts sharing the machine across profiles, the licensing gets confused and so does everything else.

---

### 1.3 ✅ "Activation says it can't reach the server"

**Symptom:** Activation window rejects the key with a network/connection error. The key is definitely correct.

**What's actually happening:** **Activation is the one step in the whole system that requires working internet.** It has to reach Firestore to look the key up. If the office internet is down, or a firewall blocks it, activation cannot complete.

**Fix:** get internet working, then activate. If you're installing at a site with no internet yet (new construction, ISP not hooked up), **you cannot complete activation that day.** Plan around it — activate before you leave your own shop if the machine is one you're delivering.

**Worth knowing:** this is a one-time requirement. Once activated, the app writes its signed local file and never needs the internet to launch again. An office can lose internet for a month and the software still opens.

---

### 1.6 ✅ "The trial expired but they already paid"

**Symptom:** Prospect converted to a paying customer, but the install is showing the trial-expired lock screen.

**What's actually happening:** the trial lock is stamped into the login session and enforced independently of activation. Paying you doesn't unlock it — the conversion key does.

**Fix:**

1. Get the **machine ID** from the trial-expired screen (they can read it to you or send a photo).
2. Mint the unlock key:
   ```bash
   node scripts/license-manager.js --unlock-trial --machine <machineId>
   ```
3. They paste it into Settings → License & Plan or the trial-expired screen.

**The good news to lead with:** all the data they entered during the trial stays. No reinstall, no migration, no re-entry. Say this out loud on the conversion call — it's the reason they're not hesitating.

---

## Part 2: Network & Field Access

> Field access is office-WiFi-only, permanently — there is no remote/tunnel access to
> troubleshoot, no CGNAT to check, no port forwarding or DDNS to configure. (An earlier version
> of this app built a Cloudflare-tunnel remote-access path and then removed it entirely in v2.0 —
> if you're reading old notes that mention CGNAT, DuckDNS, or a Plus-only tunnel, they describe a
> design that no longer exists. Do not act on them.) Everything in this Part is now about the
> office LAN itself.

### 2.0 ✅ "A tech's work isn't reaching the office"

**Symptom:** a tech's phone shows entries "waiting" in the sync status strip and they aren't clearing, or the field URL won't load at all.

Check in this order — most likely first:

1. **The phone isn't on the office WiFi.** The field module only reaches the office server over the office network — there is no other way, by design. This is normal, not a bug — the app queues the work locally and the status strip says so ("N waiting · office network not found"). Have the tech confirm which WiFi network they're on; nothing else in this list matters until that's ruled out.
2. **The office PC's LAN address changed after a router reboot.** The giveaway: *it worked yesterday and now fails for every tech at once* — one address change breaks every phone's saved home-screen URL simultaneously, since they all point at the same bare IP. Fix: confirm (or set, if it was never done) a **DHCP reservation or static IP** for the office PC (see `MANUAL_Setup_Installation.md` §7), then open **Field Access QR → Use detected address** on the dashboard to pick up the current address, and have every tech re-scan and re-save the home-screen icon.
3. **The office PC is off.** No server, no sync, for anyone. Check it's powered on and the app is running (§3.1).
4. **The tech's session expired.** They'll see a prompt to sign in again before their work can save — this is expected after 7 days and isn't a sync failure. Have them sign back in; queued work sends once they're authenticated again.
5. **An entry needs attention.** If the office deleted or reassigned the job an offline entry was for, that entry surfaces in the tech's stuck-record panel ("N entries need attention") rather than blocking everything else — see `MANUAL_Field_Tech.md`, "Entries that need attention."
6. **A Windows update reset the firewall**, or a new antivirus/security suite got installed with its own firewall — re-check inbound TCP 3000. On a Mac, re-run `scripts/recovery/allow-field-access.sh` — a macOS update can reset the Application Firewall's allowed-apps list the same way.

**Nothing is lost while any of the above is true.** Queued work sits on the tech's phone (IndexedDB) until it can reach the office; it survives closing the app and does not need to be re-entered once the underlying cause is fixed. If a phone genuinely can't reach the office for an extended stretch (lost, reset, replaced), the tech can **export their work** as a backup file before that happens — see `MANUAL_Field_Tech.md`, "Exporting Your Work," and `MANUAL_Administrator.md`, "Settings: Recover Field Work" for the office-side import.

---

### 2.1 ✅ "The PWA won't install on the iPhone"

**Symptom:** no "Add to Home Screen" option, or the app opens with browser bars.

**What's actually happening:** on iOS, home-screen install **only works from Safari.** Chrome on iOS often can't do it. The tech is probably in Chrome.

**Fix:** open the URL in Safari → Share → Add to Home Screen. The app works fine in a plain browser regardless; the home-screen version just looks and feels like a real app.

**Also check:** if the login page shows no logo, the PWA/brand assets aren't loading — those paths (`/logo.png`, `/icons`, `/manifest.webmanifest`, `/apple-touch-icon.png`) must be reachable without a session. If the logo is missing, the manifest probably is too, and installation will misbehave.

---

## Part 3: The Application & The PC

### 3.1 ✅ "Everything stopped working this afternoon"

**Symptom:** office dashboard was fine earlier, techs suddenly can't sync, or nothing loads at all.

**What's actually happening:** **the PC went to sleep.** This is the single most common operational failure for an always-on office server that is, physically, a regular desktop someone walks away from. Windows 11 buries the real sleep settings, and "the screen turned off" gets confused with "the computer slept."

**Fix:** Control Panel → Power Options → Change plan settings → **Put the computer to sleep: Never**. Monitor off is fine and good. Also check **Fast Startup** and any "energy saver" utility the PC vendor pre-installed — Dell, HP and Lenovo all ship these and they override Windows settings.

**Also check:** Windows Update rebooted overnight and it's sitting on a login screen or an "installing update" screen. And check whether the app auto-starts on boot — if the PC restarts and nobody launches White Van Ops, the field techs are down until someone walks over and clicks the icon. **Confirm auto-start behavior at install.**

**Prevention:** make this part of handoff explicitly: *"This machine is now a server. It doesn't sleep, it doesn't get shut down at night, and if it reboots someone needs to make sure the app came back up."* Small-business owners turn PCs off to save power. Tell them not to, and tell them why.

---

### 3.2 ✅ "Failed to load dashboard data"

**Symptom:** app opens, window loads, but data won't come — this specific error.

**What's actually happening:** the web layer is up but **the database isn't answering.** Usually PostgreSQL didn't start, or the bundled Postgres binaries are missing from the install (a real past packaging failure — the app would boot and 500 every query).

**Fix:**

1. Restart the app first. The startup sequence tries to start PostgreSQL via `pg_ctl`; a clean restart often just fixes it.
2. If it recurs, check that `%APPDATA%\whitevanops\pgdata` exists and isn't empty.
3. Check whether antivirus quarantined something under the install directory — see §3.5.
4. Full reinstall from the installer if the bundled binaries are actually gone.

**Prevention:** a startup-error dialog now catches the missing-binaries case at launch instead of silently 500ing, so a fresh install failing this way should announce itself. If you see this on a *fresh* install, suspect antivirus first.

---

### 3.3 ✅ "The app opened something that isn't White Van Ops"

**Symptom:** the app window shows some other application entirely, or a blank/broken page.

**What's actually happening:** something else on that PC is using port 3000. The app probes 3000 and reuses a server *only* if it identifies as White Van Ops (`/api/health` returning `{app: "whitevanops"}`); otherwise it moves to the next free port. This is handled now — but an older build without that identity check would happily load whatever was on 3000. (This genuinely happened: an Open WebUI Docker container on port 3000 got loaded into the app window.)

**Fix:** make sure they're on a current build. Find what's holding 3000 with `netstat -ano | findstr :3000`, then match the PID in Task Manager.

**Important consequence for field access:** if the app self-boots on **3001** because 3000 was occupied, **the Field Access QR needs to be re-generated for the new port** and field techs' saved home-screen URLs are now wrong. Check the actual port before assuming a firewall or WiFi issue.

---

### 3.3b ✅ "Login says 'Invalid credentials' or just spins — and nothing has ever worked on this PC"

**Symptom:** a **fresh install** reaches the login page fine, admin/admin is correct, but signing in fails. In the browser devtools it's a **500** on `POST /api/auth/login`, not a 401. Every other data screen would fail the same way.

**What's actually happening:** the packaged app can't load its database driver at all — a **build/packaging** fault, not a database, password, or network fault. The database is usually perfectly healthy. Two causes, both fixed in builds after 2026-07-19:

- The app was built with Turbopack (Next.js 16's default), which emitted a broken internal reference to the Prisma client that resolves to nothing.
- The packaging step didn't copy Prisma's runtime files into the installer.

**Fix:** there is no on-site fix — **the customer needs a newer installer.** Rebuild from a current source tree and reinstall. Nothing in `.env.local`, the database, or the router is involved.

**How to tell it apart from §3.2:** §3.2 ("Failed to load dashboard data") means the web layer is up and the *database* isn't answering — a restart usually helps. This one fails at *login itself* on a brand-new install, and restarting never helps. If reinstalling the same installer changes nothing, it's this.

**For the builder, not the customer:** verify a packaged build by running the installed `server.js` through the app's own Electron binary in isolation — running `.next/standalone/server.js` from inside the project does **not** reproduce it (Node finds the project's own `node_modules` and the fault disappears). A correct build fails with a Prisma **P1001 / DatabaseNotReachable** when the database is off; **any `Cannot find module` means it's still broken.** See `CLAUDE.md` for the build invariants (`next build --webpack`, Prisma runtime closure in `outputFileTracingIncludes`).

---

### 3.4 ✅ "I forgot the admin password"

**Symptom:** nobody can get into the dashboard.

**What's actually happening:** you changed it from `admin`/`admin` at install (correctly), and the owner wrote it nowhere.

**Fix — try this first:** if any other admin or superuser account can still log in, use **Manage Users** to reset the account. Two clicks, no tooling. This is why you create a second admin account at install.

**Fix — total lockout (nobody can log in):** use the recovery script. It's built for exactly this: a customer PC with no Node.js, no repo, and no tooling.

1. Copy **both** files from `scripts/recovery/` — `reset-admin-password.ps1` and `reset-admin-password.js` — onto the machine. A USB stick is fine; they can sit anywhere, they don't need to be in the install folder.
2. **Start WhiteVanOps and leave it at the login screen.** The bundled PostgreSQL only runs while the app is open — if the app is closed, the database is stopped and the script can't connect. (It tells you this if you forget.)
3. Open PowerShell in the folder with those two files:

```powershell
# See which admin/superuser accounts exist — changes nothing. Start here.
.\reset-admin-password.ps1 -List

# Reset 'admin' to a random temporary password
.\reset-admin-password.ps1

# A different account name, or a non-standard install location
.\reset-admin-password.ps1 -Username owner -InstallDir "D:\Apps\WhiteVanOps"

# The account itself was deleted — recreate it as a superuser
.\reset-admin-password.ps1 -Create
```

4. It prints a temporary password **once**. Log in with it immediately; the app forces a new password to be set, after which the temporary one stops working.

**It also clears the failed-attempt lockout.** Five wrong passwords lock an account for 15 minutes, and by the time someone reaches for this script they have usually just tripped that. The reset zeroes the attempt counter and removes the lock, so the temporary password works straight away — **you do not need to wait out the 15 minutes.** It also re-enables the account if it had been deactivated.

If PowerShell blocks the script ("running scripts is disabled"), use:
`powershell -ExecutionPolicy Bypass -File .\reset-admin-password.ps1`

**How it works** (useful when it misbehaves): the wrapper finds `WhiteVanOps.exe`, then runs the `.js` through it with `ELECTRON_RUN_AS_NODE=1` — Electron's main process *is* Node, so the installed app doubles as a Node interpreter. It reads `DATABASE_URL` from `<install>\resources\nextjs\.env.local` and borrows `pg` and `bcryptjs` from the app's own bundled `node_modules`. Nothing gets installed on the customer's machine.

The new password is deliberately **not** accepted as a command-line argument — on Windows that would land in PSReadLine history and be visible in the process list to anyone else on the machine.

**On a Mac,** the same recovery uses `reset-admin-password.sh` + `reset-admin-password.js` instead of the `.ps1`. Copy both files onto the machine (same USB-stick approach), start WhiteVanOps and leave it at the login screen, then from Terminal in the folder with those two files:

```bash
# See which admin/superuser accounts exist — changes nothing. Start here.
./reset-admin-password.sh --list

# Reset 'admin' to a random temporary password
./reset-admin-password.sh

# A different account name, or a non-standard install location
./reset-admin-password.sh --username owner --install-dir "/Applications/WhiteVanOps.app"

# The account itself was deleted — recreate it as a superuser
./reset-admin-password.sh --create
```

Everything else — the printed temporary password, the forced password change, the lockout clear — works identically to the Windows version above. If the script won't run ("permission denied"), make it executable first: `chmod +x reset-admin-password.sh`. Unlike the Windows wrapper, there's no `Start-Process` indirection to worry about — `--install-dir` here points at the `WhiteVanOps.app` bundle itself, and the script execs `Contents/MacOS/WhiteVanOps` directly with `ELECTRON_RUN_AS_NODE=1`.

**Prevention:** at handoff, **create a second superuser account** and make the owner write both passwords somewhere real. Record them in your own customer file too. That turns this whole entry into a two-click problem.

---

### 3.5 🔮 "Windows/antivirus says the installer is dangerous"

**Symptom:** SmartScreen blue "Windows protected your PC" warning, or antivirus quarantines the installer or the app after install.

**What's actually happening:** your installer is **unsigned**. Windows SmartScreen warns on unsigned executables from unknown publishers, and its reputation system needs volume before it trusts you. An installer that bundles a database server and opens a network port also looks, to a heuristic scanner, quite a lot like malware. It isn't — but it ticks the boxes.

**Fix on the day:** SmartScreen → **More info** → **Run anyway**. For antivirus, add an exclusion for the install directory and `%APPDATA%\whitevanops`.

**The real fix:** buy a **code signing certificate** (a few hundred dollars a year; an EV certificate costs more but bypasses SmartScreen reputation immediately) and sign your installers. electron-builder supports this directly.

**Why this matters more than it looks:** you're asking a business owner to trust software that Windows just told them might be dangerous. Doing that *in person* during white glove is survivable — you're standing right there and your credibility carries it. But it's a serious obstacle to **remote installs** and to the self-serve trial-demo path, where nobody's there to reassure them. If you ever want the trial installer to work as a leave-behind that prospects install themselves, signing stops being optional.

---

### 3.6 🔮 "It's gotten really slow"

**Symptom:** dashboard sluggish after months of use.

**What's actually happening — most likely, in order:**

1. **The disk is full.** Backups accumulating in a folder nobody empties is the usual culprit — every backup is a compressed copy of the whole database, and they add up forever. Check free space first, always.
2. **The dashboard loads everything at once.** `/api/dashboard` fetches all entities in one go, with no per-entity caching, and every action triggers a full reload. Fine at small data volumes; progressively heavier as years of jobs pile up. A customer with three years of history will feel this.
3. The PC was underspecced to begin with and is now running a database, a web server, and Chromium.

**Fix:** clear disk space and prune old backups — a rolling window (last 30 days plus monthly archives) is plenty. If it's genuinely the data volume, that's an architectural item on your side, not something you can configure away at the customer's office.

**Prevention:** set a retention policy at install rather than letting backups grow unbounded, and check free disk space at every service visit.

---

### 3.7 ✅ "We lost everything" — Backups

**Symptom:** database corrupted, drive failed, PC stolen, ransomware.

**What's actually happening:** the thing to internalize is that **backups fail silently.** The USB drive gets unplugged so someone can move a file. The backup path points at a drive letter that changed. The NAS folder's credentials expire. Nobody notices, because nothing complains — until the day it matters, when the customer discovers their last backup is from eleven months ago.

**This is the failure with no recovery.** A dead license is a one-minute fix. Lost data is gone.

**Fix:** restore from the most recent `.sql.gz` in their backup folder.

**Prevention — this is worth real effort:**

- At install, **run a manual backup and confirm the `.sql.gz` file actually appears** on the target. Don't trust the settings screen; look at the file.
- **The backup drive must be dedicated.** If it's a USB stick anyone might borrow, it will get borrowed.
- A USB drive in the same machine does not protect against theft, fire, flood, or ransomware — all of which take the backup along with the PC. **An off-site or cloud copy is the only real protection.** Even pointing the backup at a synced folder (OneDrive/Dropbox/Google Drive) is a massive improvement over a stick in the front port, and costs nothing.
- **Make backup verification part of every service call.** Look at the folder. Check the newest file's date. Ten seconds.
- **Tell the owner, in words, at handoff:** *"If this computer is stolen tonight, this drive here is your entire business. Where's your copy of it?"* Let them answer. That conversation sells the off-site copy better than any recommendation you can write down.

---

### 3.8 🔮 "A tech's hours are wrong / a job shows twice"

**Symptom:** duplicate time entries or jobs appearing after techs worked in a low-signal area.

**What's actually happening:** the field app queues work offline and drains that queue when connectivity returns. A concurrency bug there caused duplicate submissions and was fixed — `drainSyncQueue` now guards against concurrent runs. If you see duplicates on a current build, that's a **new** bug worth investigating properly, not writing off.

**Fix:** admin corrects the entries in the dashboard.

**What to do:** get specifics — which tech, what time, what were they doing, what was signal like. Then fix it in the code. Don't let this become "yeah, that happens sometimes," because that's how customers stop trusting the numbers, and the numbers are the entire product.

---

### 3.9 🔮 "The office PC shows different data than my guys see"

**Symptom:** the desktop app and the field URL disagree.

**What's actually happening:** **two servers are running, each with its own database.** On the office machine the desktop app is supposed to be a thin window onto the always-on PM2 server that holds port 3000. It reuses that server only if the health probe identifies it as White Van Ops. If the PM2 deployment is out of date and lacks the `/api/health` route, the desktop app decides it's a *foreign* app and **boots its own server on 3001 with its own database.** Now the office dashboard and the techs' phones are looking at two different datasets.

**Fix:** redeploy the PM2 app so it has the health route, then restart the desktop app so it reuses port 3000 properly.

**How to spot it fast:** the desktop app is on a port other than 3000, and data entered on the desktop never reaches techs. If a customer says "it's like there are two systems," this is exactly what's happening.

---

## Part 4: Your Own Kit — Failures On Your Side

### 4.1 ✅ "I can't generate a license key"

**Symptom:** `node scripts/license-manager.js` errors out.

**Causes:**

- **No internet.** Activation key minting writes to Firestore. Offline, it can't.
- **The Firebase service-account file is missing**, or `WVO_FIREBASE_SERVICE_ACCOUNT` isn't set. The error message tells you the path it looked at.

**⚠️ The one that ends the business:** **if you lose the Firebase service-account key file, you cannot mint license keys at all.** Not for new customers, not for anyone. It lives outside the repo on purpose — so a stray `git add .` can't publish it — which also means it is **not in version control and not in whatever backs up your repo.** See §4.3 for how to protect it.

Trial-unlock minting is offline math and doesn't need Firebase — but it *does* need the repo and the signing secret, which need their own backup.

---

### 4.3 ✅ Protecting the Firebase service-account key

This file is the master credential for your licensing database. Two distinct risks, and they pull in opposite directions — which is the whole reason this needs a deliberate answer rather than "put it somewhere safe."

- **Lose it** → you cannot mint keys, cannot onboard customers, cannot free a dead PC's machine lock. Business stops.
- **Leak it** → anyone can mint themselves unlimited licenses, or delete every license record you have, locking out every customer at once.

So it needs to be **backed up in more than one place** *and* **not lying around in any of them.**

**The setup to use:**

1. **Primary: a password manager with file attachments** (1Password, Bitwarden, Keeper — all support this). Store `firebase-service-account.json` as an attachment on an item called something obvious like "WhiteVanOps — Firebase licensing key." This is the sweet spot: encrypted at rest, synced across devices, survives your laptop dying, and you're already unlocking it every day. **If you do only one thing from this list, do this one.**
2. **Secondary: an encrypted archive off your main machine.** A 7-Zip AES-256 archive (`7z a -p -mhe=on key.7z firebase-service-account.json`) on an external drive or in cloud storage. `-mhe=on` encrypts filenames too, so the archive doesn't advertise its contents. The passphrase goes in the password manager — *not* in the same place as the archive.
3. **Keep the working copy outside the repo tree**, where it already is (`%APPDATA%\whitevanops-secrets\`), pointed at by `WVO_FIREBASE_SERVICE_ACCOUNT`. This is what stops a careless `git add .` publishing it to GitHub forever.
4. **Verify the gitignore actually holds.** From the repo root, `git check-ignore -v firebase-service-account.json` should print the matching rule. If it prints nothing, the file is *not* ignored, and one `git add .` away from public.

**Two things worth understanding about this credential:**

- **It's rotatable, and that's your safety net.** If you ever suspect it leaked — laptop stolen, accidental commit, shared a screen with it open — go to the Firebase Console → Project Settings → Service Accounts, **generate a new private key, and delete the old one.** The old file becomes worthless immediately. Nothing on any customer's machine cares: they only ever talk to Firestore during activation, and that's a different code path. **This is a five-minute fix, not a disaster — as long as you actually notice.**
- **Restrict what it can do.** The default service account is typically Project Owner, which is far more power than minting license records needs. In the Google Cloud IAM console you can drop it to a role with only Firestore access. Then a leaked key can wreck your licensing collection but can't touch anything else in the project. Worth doing once, before the number of customers makes the licensing collection irreplaceable.

**What to do if it's gone:** don't panic — the key is *not* the licensing data. Your Firestore records still exist and every activated customer keeps working (they never re-check after activation). Sign in to the Firebase Console with your Google account, generate a fresh service-account key, and you're minting again. **The truly unrecoverable thing is losing the Google account itself** — so put 2FA on it, save the recovery codes in the password manager, and make sure it isn't an account you'd lose along with a job or a domain.

---

### 4.2 🔮 "The customer says the installer is corrupted"

**Symptom:** download won't run, or errors partway through installing.

**Cause:** a 156 MB+ file transferred badly, or a security tool stripped part of it.

**Fix:** prefer a **USB drive at the appointment** — no transfer, no corruption, no cloud-provider scanner mangling it. If sending remotely, use real file hosting (Dropbox/Drive), never email.

---

## Part 5: What to Log

When you hit something not in this manual, write it down here. The entry costs two minutes and saves an hour the second time. The format that works:

```
### [Symptom in the customer's own words]
**Date / Customer:**
**What I thought it was:**
**What it actually was:**
**Fix:**
**Could I have prevented it?**
```

"What I thought it was" is the valuable line — it's where the next hour goes when the problem recurs and you've forgotten. Most of Parts 1–4 above is prediction. This section is where the manual becomes real.

---

## Appendix: Fast Reference

| Symptom | Start here |
|---|---|
| "Already in use on another machine" | §1.1 — clear `machineId` in Firestore |
| Activation can't reach server | §1.3 — needs internet, one time only |
| Trial locked but they paid | §1.6 — mint the unlock key |
| Tech's work isn't reaching the office | §2.0 — check office WiFi, LAN address, firewall, session |
| No Add to Home Screen | §2.1 — must be Safari on iOS |
| Everything stopped this afternoon | §3.1 — **PC went to sleep** |
| "Failed to load dashboard data" | §3.2 — database not answering |
| Wrong app in the window / wrong port | §3.3 — port 3000 conflict |
| Forgot admin password | §3.4 — `scripts/recovery/reset-admin-password.ps1` |
| SmartScreen / antivirus warning | §3.5 — unsigned installer |
| Gone slow | §3.6 — check disk space first |
| Lost data | §3.7 — ⚠️ verify backups at every visit |
| Duplicate time entries | §3.8 — should be fixed; investigate if seen |
| Desktop and phones disagree | §3.9 — two servers, two databases |
| Can't mint a key | §4.1 — ⚠️ back up the Firebase key file |

**Related reading:**
- `docs/MANUAL_White_Glove_Installation.md` — the install procedure
- `docs/BUSINESS_Purchase_to_Install_Playbook.md` — purchase, keys, payments
- `MANUAL_Setup_Installation.md` §7 — office WiFi setup for field access
