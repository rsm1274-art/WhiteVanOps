# White Van Ops — From "I'll Take It" to "It's Running"

**Who this is for:** you, the owner/operator, when a customer says yes and you need to know exactly what happens next.

This document assumes zero prior knowledge of licensing, payments, or installers. It explains the whole path in plain English, then answers the specific question about PayPal, Venmo, and credit cards at the end.

---

## Part 1: The Big Picture in One Paragraph

**WhiteVanOps is one product — there is no Base/Plus split anymore.** A customer agrees to buy. You take their money. You then run a small command on your own computer that mints a **license key** — a short code like `WVO-4A2F-91BC-D7E3-0518`. You email them that code along with the installer file, or (more likely, for white glove) you show up at their office with both. You install the software on their dedicated office PC, type the key into the activation window that appears on first launch, and the key permanently locks itself to that one machine. Then you spend a couple of hours setting up their office WiFi for field access, backups, technicians' phones, and training. They're live. The whole thing is manual on your end, on purpose — there's no automated storefront, and at your current volume there doesn't need to be.

**Field access is office-WiFi-only, always — there is no remote/tunnel product to sell.** This removed an entire category of installation risk: no port forwarding, no CGNAT, no Dynamic DNS. If you remember an earlier version of this playbook describing CGNAT as "the single biggest risk in the whole job," that risk no longer exists — the app never needs an inbound connection from outside the office.

---

## Part 2: The Keys (This Is the Part That Used to Confuse People)

Your system has **two** key types now (a third, the Plus Upgrade License, was retired along with
the Base/Plus tier — there is nothing left to upgrade a customer into).

| | **Activation Key** | **Trial Unlock Key** |
|---|---|---|
| **Looks like** | `WVO-4A2F-91BC-D7E3-0518` | A block of JSON text |
| **Its job** | Proves this install is a legitimate paid copy. Every non-trial install needs one. | Converts a 30-day sales demo into a permanent install. |
| **Made by** | `node scripts/license-manager.js` | `node scripts/license-manager.js --unlock-trial --machine <their machine ID>` |
| **Needs internet?** | **Yes** — writes the key to your Firebase/Firestore database in the cloud, and the customer's PC checks it there when they activate. | No. It's math, done offline. |
| **Where it gets typed** | The activation window that pops up on first launch, before the app opens. | Settings → License & Plan, or the trial-expired screen. |
| **Locked to** | One physical machine, forever (see below). | One physical machine. |

### What "locked to a machine" actually means

When a customer types their activation key into the activation window, the app reads a **hardware fingerprint** from that PC — a unique ID derived from the machine itself. It sends that fingerprint up to your Firestore database and stamps it onto the key's record. The key now belongs to that PC and nothing else.

The practical consequences you need to understand before you sell anything:

- **A key can only ever be used once, on one PC.** If a customer tries it on a second machine, activation is refused.
- **After that first activation, the internet is no longer needed.** The app writes a signed local file and checks that on every subsequent launch. Their office can lose internet for a month and the software still opens.
- **If the customer replaces or reformats that PC, their key is dead** — the new machine has a different fingerprint, and the key is already stamped to the old one. You fix this by going into your Firestore console and clearing the `machineId` field on that key's record (setting it back to empty), which frees the key to be claimed by the new machine. **This is a manual step only you can do.** Expect this call. It will happen — hardware dies, offices upgrade.
- Because the key lives in a cloud database you control, you can also flip `active` to false to kill an install (e.g. a chargeback). Note the caveat: the app only checks Firestore at *activation* time, so switching it off won't disable a PC that already activated.

---

## Part 3: The Purchase Flow, Step by Step

### Step 1 — Agree on the price

Before money moves, you need one answer from the customer: **is white glove included, or billed separately?** This matters more than it sounds — see the pricing note in Part 6. There is no plan decision anymore — every customer gets the full feature set.

### Step 2 — Take the money

Full detail is in Part 5. The short version: send a **PayPal invoice**, and let them pay it however they want. Don't ship or install anything until the money has actually landed in your account and cleared — not "sent," not "pending."

### Step 3 — Mint the activation key

On your own machine, in the project folder:

```bash
node scripts/license-manager.js
```

(`--notes "Order #1234"` is optional and gets stored on the record.)

It prints something like:

```
✅ Success! New License Key Generated:

   WVO-4A2F-91BC-D7E3-0518

This key is now active in Firestore and ready to be given to a customer.
```

That key now exists in your cloud database with `machineId: null` — meaning "sold, but not yet claimed by a machine."

**Requirements for this to work:** you need internet, and you need your Firebase service-account key file present and pointed at by the `WVO_FIREBASE_SERVICE_ACCOUNT` environment variable. That file is your master credential for the licensing database. It lives outside the repo (e.g. `%APPDATA%\whitevanops-secrets\`) precisely so a careless `git add .` can't publish it to GitHub. **If you lose that file, you cannot mint keys.** Back it up somewhere safe and private today, if you haven't.

**Write the key down against the customer's name.** There is no CRM here. If you don't keep your own record of which key went to whom, you will not be able to answer "which of these forty keys is Dave's?" when Dave's PC dies. A spreadsheet is fine. Not keeping one is not fine.

### Step 4 — Get them the installer

`dist-electron/WhiteVanOps-Setup.exe` (Windows) or `WhiteVanOps-Setup-{arm64,x64}.dmg` (macOS), roughly 156 MB. There is only one installer per platform — no plan to match against the key. (`WhiteVanOps-Trial-Setup.exe` / `-Trial-Setup-{arm64,x64}.dmg` are the separate 30-day demos.) Options, in order of preference:

- **Bring it on a USB drive** to the white glove appointment. Simplest, fastest, no upload, no "it says the file is corrupted."
- **A download link** (Dropbox / Google Drive / your own site) if you're doing this remotely.
- **Email is not an option.** 156 MB will bounce off every mail server on earth.

⚠️ **The one thing you must get right here:** each installer bundles a `.env.local` file containing that build's `SESSION_SECRET`. **Never hand the same build to two different customers.** Build a fresh installer per customer with a freshly generated secret, or have a generic build and place a per-customer `.env.local` on-site after installation. `MANUAL_Setup_Installation.md` §3 has the exact steps. Shipping one shared secret to multiple companies means that, in principle, one customer holds the key that signs another customer's login sessions.

### Step 5 — Do the white glove install

This is fully documented in `docs/MANUAL_White_Glove_Installation.md` and I won't duplicate it here. The shape of it:

- **Phase A** — install the software, first launch, **type in the activation key at the activation window**, log in as `admin`/`admin`, immediately change the password.
- **Phase B** — set a DHCP reservation or static IP for the office PC, and open the office firewall for the field module's port. That's the entire networking phase — there is no port forwarding, no DDNS, and no public-internet exposure to configure, because field access never leaves the building.
- **Phase C** — set up the backup folder, run a manual backup, confirm the file appears.
- **Phase D** — field techs scan the QR code (while on the office WiFi), add the app to their phone home screens, sign in.
- Then data migration and training.

There is no CGNAT risk to check before the sale — the app never needs an inbound connection from outside the office, so the customer's ISP and router configuration are irrelevant to whether field access works.

### Step 6 — Hand off

Give them: their admin password, the manuals, the license key on paper (for their records), and your phone number. Confirm one tech has successfully logged a job from their phone **while on the office WiFi** — that's the environment field access is designed for, and the only one it needs to work in.

---

## Part 4: The Demo Path (Worth Knowing, Because It Changes the Sale)

You have a trial installer too — `WhiteVanOps-Trial-Setup.exe` (Windows) / `WhiteVanOps-Trial-Setup-{arm64,x64}.dmg` (macOS) — for a 30-day, fully-loaded demo. Its important property for sales purposes is that **it needs no key at all** — a prospect can install it themselves and it boots straight to the login screen. No activation window, no phone call to you.

That makes it your ideal "let me leave this with you" artifact. When they're ready to buy, the conversion is:

1. They give you their machine ID (shown on the trial-expired screen).
2. You run `node scripts/license-manager.js --unlock-trial --machine <that ID>`.
3. They paste the resulting JSON in. The 30-day lock is permanently defeated.

The elegance here: **they keep all the data they entered during the trial.** No reinstall, no migration, no lost work. That is a genuinely strong closing argument and you should use it deliberately — a prospect who has spent 30 days entering their real jobs and real clients has already done the switching cost that would otherwise stop them from buying.

---

## Part 5: Payments — Do You Need Credit Cards?

### The short answer

**PayPal alone already gives you credit card acceptance. You do not need Stripe, Square, or a merchant account.**

The thing most people don't know: when you send a **PayPal invoice**, the recipient gets a "Pay with Debit or Credit Card" option and can pay with a Visa or Mastercard **without ever creating a PayPal account**. Your customer experiences it as a normal card checkout. You experience it as money in your PayPal balance. So the real question isn't "do I need cards" — you'd already have them. The question is which rails you want to *offer*, and there the answer is less obvious.

### Venmo: decided against

Venmo was considered and **ruled out** (decision: 2026-07-15). The reasons, recorded here so the question doesn't get reopened from scratch later:

- **Personal Venmo accounts aren't permitted for business use** under Venmo's own terms. The enforcement is account freezes with your funds held during review — a bad surprise mid-install.
- **Venmo produces no invoice.** Your customers are businesses whose bookkeepers need a real invoice with your business name on it to book the purchase as a deductible expense. "Venmo from Rob 🚐" isn't one, and that friction lands at the worst possible moment.
- **Transfer limits** vary by account and verification status and can bite on larger sales.

If a customer asks specifically to pay by Venmo, treat it as an exception to think about, not a standing option — and never from a personal account.

### The payment setup

**PayPal invoicing is the front door.** One link. From inside it they can pay by PayPal balance, bank account, or credit/debit card — their choice, no extra work from you, and everyone gets a proper invoice with a paper trail.

**Put "check or bank transfer accepted" as an explicit line on the invoice.** This is the piece most people miss, and for your specific market it may matter most. Card fees run roughly 3%. On a $3,000 sale that's ~$90 of pure margin gone, and on a $6,000 sale it's $180. Trade businesses are entirely comfortable writing checks — it's how they pay most of their vendors. A meaningful share of your customers will happily mail a check if you simply say it's an option, and that's the cheapest money you'll ever collect. PayPal invoices don't collect checks for you, but nothing stops you from writing "Check payable to [your business] — mail to [address]" on the invoice as an alternative.

### The risk nobody thinks about until it happens: chargebacks

If a customer pays by credit card and later disputes the charge, the card network can claw that money back out of your account — and the window for that is long (PayPal's dispute window runs to 180 days; card-network chargeback rights can run longer still). You will have already delivered the software, driven to their office, spent a day installing, and trained their staff. None of that is recoverable.

Digital goods plus services is a category that's structurally hard to defend in a dispute, because you can't produce a shipping tracking number. Your protection is paperwork:

- **A signed agreement or accepted quote** before you install, stating what they're buying and that the license is non-refundable once activated.
- **A signed sign-off sheet at the end of the white glove install** confirming the software is running and training was delivered. One page. Take a photo of it.
- Keep the email trail.

This is not paranoia. It's the standard reason software installers take deposits and get signatures. It costs you five minutes per customer and it's the only thing standing between you and eating a $3,000 loss on a customer who decides four months later that they don't like the software.

### One more consideration

Payment processors report your business income to the IRS on a **Form 1099-K**, and PayPal does this. This isn't a reason to avoid them — it's a reason to make sure your business bookkeeping is set up before the money starts arriving, so that filing season isn't an archaeology project. Talk to whoever does your taxes about it before your first sale, not after.

**A caveat on all of the above:** fee percentages, dispute windows, and 1099-K thresholds all change, and my information has a cutoff date. Treat the shape of this advice as sound and **verify the current specific numbers on PayPal's own fee pages before you set your pricing.** I'm not a licensed financial or tax advisor, and for the tax-treatment question specifically you want a real accountant, not me.

---

## Part 6: Things That Will Bite You (Ranked by How Much They'll Hurt)

1. **You didn't record which key went to which customer.** Start the spreadsheet now, before key #2 exists.
2. **You lost the Firebase service-account file.** You can't mint keys. Back it up today.
3. **You shipped the same installer to two customers**, sharing a `SESSION_SECRET`. Build per customer, or place `.env.local` on-site.
4. **The customer's PC dies and you forgot you have to free their key in Firestore.** Write yourself a note on how to do this while you still remember. Better: do it once now on a throwaway key so you've practiced.
5. **You quoted a flat price and the white glove took longer than expected** because nobody had the admin password to the office WiFi router, or the office network needed more setup than planned. Price the software and the installation as separate lines, or quote installation as a range and be honest about what expands it.
6. **A chargeback four months after a successful install.** Get the signature.

---

## Part 7: Protecting the Activation Key (Historical: This Used to Be About Protecting the Plus Tier)

Before v2.0, this section documented two ways someone could turn on the paid **Plus tier** without
paying — a text-file edit (fixed 2026-07-15) and extracting the signing secret (an accepted, open
limit). **Both are moot now: there is no tier to steal.** Every activated install already gets the
full feature set, so there's nothing left for a hand-edited config file to unlock.

What's still worth protecting is **activation itself** — an unactivated copy shouldn't be usable at
all, trial or not. The one open item that survives from the old writeup:

### Extracting the signing secret — still an open, accepted limit

**Difficulty: high. Needs a motivated, technical person.**

Licenses are signed with a **symmetric secret** — `LICENSE_SIGNING_SECRET` in `src/lib/licenseCrypto.ts`. With symmetric crypto (HMAC), the key that *checks* a signature is the same key that *makes* one. The app must hold it to verify licenses, so it ships inside every installer. Someone who unpacked the app and found that string could mint themselves a valid activation key, skipping payment entirely.

**This is accepted for now, deliberately.** Your customers are trade businesses, not reverse engineers, and the effort exceeds the price of the software.

**The fix, if it's ever worth doing: Ed25519**, built into Node's `crypto`, no new dependencies:

- Generate a keypair **once** (`crypto.generateKeyPairSync('ed25519')`).
- The **private key never leaves your machine**; `license-manager.js` signs with it.
- The app embeds only the **public key** — it verifies signatures but cannot create them.
- A customer who extracts the public key gets nothing. It's public by design.

Contained change: the sign calls in `license-manager.js`, the verify calls in `licenseCrypto.ts`/`license.ts`, and a migration story for licenses already in the field (accept both formats for a release, then drop HMAC).

### The honest ceiling

**None of this is bulletproof, and that's fine.** Any offline-verifiable license can eventually be defeated by someone determined enough, because the software runs on hardware they control. The realistic goal was never "impossible" — it's "harder than paying you." The activation key was never vulnerable to a local text-edit the way the old tier flag was, because it's checked against your Firestore database rather than by local math.

---

## Appendix: The Commands, In One Place

```bash
# Mint an activation key for a new customer (needs internet + Firebase key file).
node scripts/license-manager.js
node scripts/license-manager.js --notes "Order #1234"

# Convert a 30-day trial install into a permanent one
node scripts/license-manager.js --unlock-trial --machine <machineId>

# Build installers — one per platform, no plan axis
npm run electron:build            # Windows installer   → WhiteVanOps-Setup.exe
npm run electron:build:trial      # Windows 30-day trial → WhiteVanOps-Trial-Setup.exe
npm run electron:build:mac        # macOS installer      → WhiteVanOps-Setup-{arm64,x64}.dmg
npm run electron:build:mac:trial  # macOS 30-day trial   → WhiteVanOps-Trial-Setup-{arm64,x64}.dmg

# Emergency: reset a locked-out admin password on a customer's PC
# (copy both files from scripts/recovery/; the app must be running)
.\reset-admin-password.ps1 -List
.\reset-admin-password.ps1
```

**Related reading:**
- `docs/MANUAL_White_Glove_Installation.md` — the on-site procedure
- `MANUAL_Setup_Installation.md` §3 — per-customer secrets and builds
- `MANUAL_Setup_Installation.md` §6.4 — trial build and conversion
- `MANUAL_Setup_Installation.md` §7 — office WiFi setup for field access
