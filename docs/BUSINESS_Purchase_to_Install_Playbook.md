# White Van Ops — From "I'll Take It" to "It's Running"

**Who this is for:** you, the owner/operator, when a customer says yes and you need to know exactly what happens next.

This document assumes zero prior knowledge of licensing, payments, or installers. It explains the whole path in plain English, then answers the specific question about PayPal, Venmo, and credit cards at the end.

---

## Part 1: The Big Picture in One Paragraph

A customer agrees to buy. You take their money. You then run a small command on your own computer that mints a **license key** — a short code like `WVO-4A2F-91BC-D7E3-0518`. You email them that code along with the installer file, or (more likely, for white glove) you show up at their office with both. You install the software on their dedicated office PC, type the key into the activation window that appears on first launch, and the key permanently locks itself to that one machine. Then you spend a couple of hours setting up their network, backups, technicians' phones, and training. They're live. The whole thing is manual on your end, on purpose — there's no automated storefront, and at your current volume there doesn't need to be.

---

## Part 2: The Three Kinds of Keys (This Is the Part That Confuses People)

Your system has **three different key types**. They look different, they're made differently, and they do different jobs. Mixing them up is the most likely way for a sale to go sideways, so here they are side by side.

| | **Base Activation Key** | **Plus Upgrade License** | **Trial Unlock Key** |
|---|---|---|---|
| **Looks like** | `WVO-4A2F-91BC-D7E3-0518` | A block of JSON text | A block of JSON text |
| **Its job** | Proves this install is a legitimate paid copy **and carries the tier they bought**. Every non-trial install needs one. | Upgrades an install *already sold as Base* to Plus. Not needed for new Plus sales. | Converts a 30-day sales demo into a permanent install. |
| **Made by** | `node scripts/license-manager.js --tier base\|plus` | `node scripts/license-manager.js --plus --key <their Base key>` | `node scripts/license-manager.js --unlock-trial --machine <their machine ID> --tier base\|plus` |
| **Needs internet?** | **Yes** — writes the key to your Firebase/Firestore database in the cloud, and the customer's PC checks it there when they activate. | No. It's math, done offline. | No. It's math, done offline. |
| **Where it gets typed** | The activation window that pops up on first launch, before the app opens. | Inside the app: **Settings → License & Plan**. | Same place, or the trial-expired screen. |
| **Locked to** | One physical machine, forever (see below). | The Base key it was generated against. | One physical machine. |

### What "locked to a machine" actually means

When a customer types their Base key into the activation window, the app reads a **hardware fingerprint** from that PC — a unique ID derived from the machine itself. It sends that fingerprint up to your Firestore database and stamps it onto the key's record. The key now belongs to that PC and nothing else.

The practical consequences you need to understand before you sell anything:

- **A key can only ever be used once, on one PC.** If a customer tries it on a second machine, activation is refused.
- **After that first activation, the internet is no longer needed.** The app writes a signed local file and checks that on every subsequent launch. Their office can lose internet for a month and the software still opens.
- **If the customer replaces or reformats that PC, their key is dead** — the new machine has a different fingerprint, and the key is already stamped to the old one. You fix this by going into your Firestore console and clearing the `machineId` field on that key's record (setting it back to empty), which frees the key to be claimed by the new machine. **This is a manual step only you can do.** Expect this call. It will happen — hardware dies, offices upgrade.
- Because the key lives in a cloud database you control, you can also flip `active` to false to kill an install (e.g. a chargeback). Note the caveat: the app only checks Firestore at *activation* time, so switching it off won't disable a PC that already activated.

---

## Part 3: The Purchase Flow, Step by Step

### Step 1 — Agree on the price and the plan

Before money moves, you need two answers from the customer:

1. **Base or Plus?** Base is scheduling, jobs, inventory, techs, QuickBooks export. Plus adds CRM notes/follow-ups, the Analytics tab, and Invoicing. This decision determines which installer you build and which keys you mint.
2. **Is white glove included, or billed separately?** This matters more than it sounds — see the pricing note in Part 6.

### Step 2 — Take the money

Full detail is in Part 5. The short version: send a **PayPal invoice**, and let them pay it however they want. Don't ship or install anything until the money has actually landed in your account and cleared — not "sent," not "pending."

### Step 3 — Mint the activation key

On your own machine, in the project folder — **with the tier they paid for:**

```bash
node scripts/license-manager.js --tier base     # Base customer
node scripts/license-manager.js --tier plus     # Plus customer
```

(Omitting `--tier` gives you Base. `--notes "Order #1234"` is optional and gets stored on the record.)

**This flag is the whole plan.** The tier is stamped onto the key's record in your Firestore database, read during activation, and locked into a signed file on their PC. It's not something you set at build time or configure on-site — one installer serves both plans and *this key* is what decides which one the customer gets. Mint `--tier plus` for a Base customer and you've given away the upgrade.

It prints something like:

```
✅ Success! New License Key Generated:

   WVO-4A2F-91BC-D7E3-0518

This key is now active in Firestore and ready to be given to a customer.
```

That key now exists in your cloud database with `machineId: null` — meaning "sold, but not yet claimed by a machine."

**Requirements for this to work:** you need internet, and you need your Firebase service-account key file present and pointed at by the `WVO_FIREBASE_SERVICE_ACCOUNT` environment variable. That file is your master credential for the licensing database. It lives outside the repo (e.g. `%APPDATA%\whitevanops-secrets\`) precisely so a careless `git add .` can't publish it to GitHub. **If you lose that file, you cannot mint keys.** Back it up somewhere safe and private today, if you haven't.

**Write the key down against the customer's name.** There is no CRM here. If you don't keep your own record of which key went to whom, you will not be able to answer "which of these forty keys is Dave's?" when Dave's PC dies. A spreadsheet is fine. Not keeping one is not fine.

### Step 4 — Only if you're upgrading an EXISTING Base install

Skip this for new sales — a `--tier plus` key already delivers Plus on its own.

This step is for a customer who bought Base months ago and is upgrading now. You don't reissue their activation key; you mint a signed upgrade bound to the key they already have:

```bash
node scripts/license-manager.js --plus --key WVO-4A2F-91BC-D7E3-0518
```

It takes **their existing Base key** as input — the Plus license is mathematically tied to it, so it only works on their install. It prints a JSON block they paste into Settings → License & Plan.

Add `--expires 2027-07-15` if you ever sell Plus as an annual subscription. Leave it off and Plus never expires.

### Step 5 — Get them the installer

`dist-electron/WhiteVanOps-Setup.exe`, roughly 156 MB. **There's only one installer** — the same file serves Base and Plus, because the key you minted in Step 3 determines the tier. (`WhiteVanOps-Trial-Setup.exe` is the separate 30-day demo.) Options, in order of preference:

- **Bring it on a USB drive** to the white glove appointment. Simplest, fastest, no upload, no "it says the file is corrupted."
- **A download link** (Dropbox / Google Drive / your own site) if you're doing this remotely.
- **Email is not an option.** 156 MB will bounce off every mail server on earth.

⚠️ **The one thing you must get right here:** each installer bundles a `.env.local` file containing that build's `SESSION_SECRET`. **Never hand the same build to two different customers.** Build a fresh installer per customer with a freshly generated secret, or have a generic build and place a per-customer `.env.local` on-site after installation. `MANUAL_Setup_Installation.md` §3 has the exact steps. Shipping one shared secret to multiple companies means that, in principle, one customer holds the key that signs another customer's login sessions.

### Step 6 — Do the white glove install

This is fully documented in `docs/MANUAL_White_Glove_Installation.md` and I won't duplicate it here. The shape of it:

- **Phase A** — install the software, first launch, **type in the Base key at the activation window**, log in as `admin`/`admin`, immediately change the password.
- **Phase B** — router port forwarding + DuckDNS, so field techs can reach the app from outside the office. This is the phase that eats time and the phase that can fail for reasons outside your control (see the CGNAT warning below).
- **Phase C** — set up the backup folder, run a manual backup, confirm the file appears.
- **Phase D** — field techs scan the QR code, add the app to their phone home screens, sign in.
- Then data migration and training.

**The single biggest risk in the whole job is CGNAT.** Some internet providers don't give a customer a real public address, which makes port forwarding impossible — meaning field techs can never reach the app from outside the office. **Check this before the sale, not on install day**: compare what `whatismyip.com` shows on their office PC against the "WAN IP" on their router's status page. If those two numbers don't match, remote field access cannot work until they change ISP plans. You do not want to discover this after you've been paid and you're standing in their office.

### Step 7 — Hand off

Give them: their admin password, the manuals, the license key on paper (for their records), and your phone number. Confirm one tech has successfully logged a job from their phone **on cellular data with office WiFi off** — that's the only test that proves the remote access actually works.

---

## Part 4: The Demo Path (Worth Knowing, Because It Changes the Sale)

You have a fourth installer: `WhiteVanOps-Trial-Setup.exe`. It's a 30-day, fully-loaded-with-Plus demo. Its important property for sales purposes is that **it needs no key at all** — a prospect can install it themselves and it boots straight to the login screen. No activation window, no phone call to you.

That makes it your ideal "let me leave this with you" artifact. When they're ready to buy, the conversion is:

1. They give you their machine ID (shown on the trial-expired screen).
2. You run `node scripts/license-manager.js --unlock-trial --machine <that ID> --tier base` (or `--tier plus`).
3. They paste the resulting JSON in. The 30-day lock is permanently defeated, and **the tier of the key you minted is what they get** — a `base` unlock correctly switches off the Plus features they'd been trying.

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

1. **CGNAT discovered on install day.** Check before the sale. This is the one that can turn a paid job into a refund.
2. **You didn't record which key went to which customer.** Start the spreadsheet now, before key #2 exists.
3. **You lost the Firebase service-account file.** You can't mint keys. Back it up today.
4. **You shipped the same installer to two customers**, sharing a `SESSION_SECRET`. Build per customer, or place `.env.local` on-site.
5. **The customer's PC dies and you forgot you have to free their key in Firestore.** Write yourself a note on how to do this while you still remember. Better: do it once now on a throwaway key so you've practiced.
6. **You quoted a flat price and the white glove took nine hours** because their router was a locked-down ISP unit and nobody had the admin password. Price the software and the installation as separate lines, or quote installation as a range and be honest about what expands it.
7. **A chargeback four months after a successful install.** Get the signature.

---

## Part 7: Protecting the Plus Tier

There were **two** ways to turn on Plus without paying. The easy one is **fixed** (2026-07-15). The hard one is a known, accepted limit. Both are recorded here so the reasoning survives.

### Hole #1: The one-word text edit — FIXED

**Difficulty was: trivial. No technical skill required.**

Every install used to ship a plain text file at `<install dir>\resources\nextjs\.env.local` containing a line the build script put there:

```
WVO_DEFAULT_TIER="base"
```

Change that word to `"plus"`, restart, and Plus turned on. That was the whole attack. Notepad. One word.

It worked because `getLicense()` treated the env var as proof of tier, which made `verifiedPlus` true — and the anti-tamper self-heal only fires when `verifiedPlus` is *false*. So the env var didn't defeat the protection by overpowering it; it satisfied it. The check saw a legitimately-verified Plus install and helpfully synced the database up to match.

**The fix that shipped: the tier now travels inside the activation key.**

- `scripts/license-manager.js --tier base|plus` stamps the tier onto the key's record in Firestore when you mint it.
- `electron/main.js` reads that tier during activation and bakes it into `license.json`, which was already machine-bound and HMAC-signed.
- `getBaseLicense()` returns the tier from that signed file. Editing `"tier": "base"` to `"plus"` breaks the signature, so the file is rejected outright — no Plus, and the app asks for activation rather than honouring the edit.
- `WVO_DEFAULT_TIER` is **gone.** Nothing on the customer's disk declares the tier anymore.

The rule this establishes, and the one to hold onto: **configuration never grants Plus — only a signature does.** Every branch in `getLicense()` that can set `verifiedPlus` is now gated on a machine-bound HMAC over the payload it's claiming.

**Consequence worth knowing: Base and Plus are now the same installer.** `WhiteVanOps-Setup.exe` serves both, and the key decides. `npm run electron:build:plus` and `WhiteVanOps-Plus-Setup.exe` no longer exist — which also restores what the architecture always claimed to be ("gated at runtime by a DB flag, not separate builds"). One less artifact to build, name, and accidentally hand to the wrong customer.

A regression test (`"ignores WVO_DEFAULT_TIER=plus and self-heals a plus DB row back to base"`) exists specifically to stop this returning.

### Hole #2: Extracting the signing secret — open, accepted

**Difficulty: high. Needs a motivated, technical person.**

The licenses are signed with a **symmetric secret** — `LICENSE_SIGNING_SECRET` in `src/lib/licenseCrypto.ts`. With symmetric crypto (HMAC), the key that *checks* a signature is the same key that *makes* one. The app must hold it to verify licenses, so it ships inside every installer. Someone who unpacked the app and found that string could mint themselves a valid Plus license.

**This is accepted for now, deliberately.** Your customers are trade businesses, not reverse engineers, and the effort exceeds the price of the upgrade. It was always a distant second to Hole #1 — unpacking an Electron archive and reverse-engineering a license format, versus typing one word in Notepad.

**The fix, when Plus revenue justifies it: Ed25519**, built into Node's `crypto`, no new dependencies:

- Generate a keypair **once** (`crypto.generateKeyPairSync('ed25519')`).
- The **private key never leaves your machine**; `license-manager.js` signs with it.
- The app embeds only the **public key** — it verifies signatures but cannot create them.
- A customer who extracts the public key gets nothing. It's public by design.

Contained change: the sign calls in `license-manager.js`, the verify calls in `licenseCrypto.ts`/`license.ts`, and a migration story for licenses already in the field (accept both formats for a release, then drop HMAC).

**Do it before Plus becomes the bulk of your income.** The cost of the change is fixed; the cost of not having done it scales with revenue.

### The honest ceiling

**None of this is bulletproof, and that's fine.** Any offline-verifiable license can eventually be defeated by someone determined enough, because the software runs on hardware they control. The realistic goal was never "impossible" — it's "harder than paying you." Closing Hole #1 got you there; Ed25519 keeps you there as the stakes rise.

**Worth noting:** the Base activation key never had either weakness, because it's checked against your Firestore database rather than by local math. The fix above was essentially extending that existing strength to cover the tier too.

---

## Appendix: The Commands, In One Place

```bash
# Mint an activation key for a new customer (needs internet + Firebase key file).
# The --tier flag is what sells them Base vs Plus — one installer serves both.
node scripts/license-manager.js --tier base
node scripts/license-manager.js --tier plus
node scripts/license-manager.js --tier plus --notes "Order #1234"

# Upgrade a customer who ALREADY has a Base install (not needed for new Plus sales)
node scripts/license-manager.js --plus --key WVO-XXXX-XXXX-XXXX-XXXX

# ...as an annual subscription rather than perpetual
node scripts/license-manager.js --plus --key WVO-XXXX-XXXX-XXXX-XXXX --expires 2027-07-15

# Convert a 30-day trial install into a permanent one (tier = what they paid for)
node scripts/license-manager.js --unlock-trial --machine <machineId> --tier base
node scripts/license-manager.js --unlock-trial --machine <machineId> --tier plus

# Build installers
npm run electron:build          # WhiteVanOps-Setup.exe — serves Base AND Plus
npm run electron:build:trial    # WhiteVanOps-Trial-Setup.exe — 30-day demo

# Emergency: reset a locked-out admin password on a customer's PC
# (copy both files from scripts/recovery/; the app must be running)
.\reset-admin-password.ps1 -List
.\reset-admin-password.ps1
```

**Related reading:**
- `docs/MANUAL_White_Glove_Installation.md` — the on-site procedure
- `MANUAL_Setup_Installation.md` §3 — per-customer secrets and builds
- `MANUAL_Setup_Installation.md` §6.4 — trial build and conversion
- `MANUAL_Setup_Installation.md` §7 — port forwarding and DDNS in depth
