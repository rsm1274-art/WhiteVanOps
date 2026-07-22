# Phase 1 Runbook — Tunnel Proof of Concept

**Date:** 2026-07-20
**Spec:** `docs/superpowers/specs/2026-07-20-cgnat-tunnel-connectivity-design.md`
**Prerequisite:** Phase 0 shipped (`276515f`). Domain `whitevanops.com` owned; Cloudflare account created.

**Goal:** one working tunnel, verified from a phone on cellular. Prove the approach before
automating it in Phase 2. Do this on the dev machine first, not a customer's PC.

---

## Decision 0 — hostname scheme (settle before creating any DNS record)

The spec proposed `<customer>.field.whitevanops.com`. **Recommend flat
`<customer>.whitevanops.com` instead.**

Reason: Cloudflare's free Universal SSL covers the root domain plus **first-level
subdomains** only. `acme.field.whitevanops.com` is a second-level subdomain and gets no
certificate, and the paid fix (Advanced Certificate Manager, ~$10/mo) reintroduces the
recurring per-vendor cost this design exists to avoid.

> ✅ **CONFIRMED 2026-07-20 by Cloudflare's own dashboard**, on this zone's Overview page:
> *"We will issue you a free universal SSL certificate to cover your root domain
> (example.com) and **first-level subdomains** (www.example.com, blog.example.com, etc.)."*
> `<customer>.field.whitevanops.com` is a second-level subdomain and is therefore **not**
> covered. **Decision closed: use the flat scheme.** Do not create a `field.` hostname.

Naming: `acme.whitevanops.com` per customer. Keep `www`/apex free for marketing.

---

## Step 1 — Add the zone (you, in the browser)

1. Cloudflare dashboard → **Add a site** → `whitevanops.com` → **Free** plan.
2. Cloudflare shows two nameservers. Set them at your **registrar**, replacing what's there.
3. Wait for the zone to read **Active** (minutes to a few hours). Nothing below works until it does.

Vendor account, not the customer's. Customers never get Cloudflare logins.

## Step 2 — Install cloudflared (you)

```powershell
winget install --id Cloudflare.cloudflared
cloudflared --version    # confirm it resolves in a NEW shell
```

## Step 3 — Authorize cloudflared (you — browser sign-in)

```powershell
cloudflared tunnel login
```

Opens a browser to authorize and pick the zone. Choose `whitevanops.com`. Writes
`%USERPROFILE%\.cloudflared\cert.pem`.

This step is yours by definition — it grants OAuth access to your Cloudflare account, and
it is not something to hand to an agent or a customer.

## Step 4 — Create the tunnel and route DNS

```powershell
cloudflared tunnel create wvo-demo
# prints a tunnel UUID and writes %USERPROFILE%\.cloudflared\<UUID>.json  <- credentials, treat as a secret

cloudflared tunnel route dns wvo-demo demo.whitevanops.com
```

Config at `%USERPROFILE%\.cloudflared\config.yml` — substitute the real UUID:

```yaml
tunnel: <UUID>
credentials-file: C:\Users\<you>\.cloudflared\<UUID>.json

ingress:
  - hostname: demo.whitevanops.com
    service: http://localhost:3000
  - service: http_status:404
```

No `:3000` ever appears in the public URL. The origin hop is loopback, so the unencrypted
segment never leaves the machine.

## Step 5 — Run in the foreground and prove it

Start the app first (`npm run dev`, or the installed app), then:

```powershell
cloudflared tunnel run wvo-demo
```

> ⚠ **If testing against `npm run dev`:** Next 16's dev server blocks cross-origin
> requests to `/_next/*` (JS chunks + HMR) by default. Reached through the tunnel the
> browser's origin is `demo.whitevanops.com`, not `localhost`, so the chunks are blocked,
> the page never hydrates, and login silently does nothing on a phone (no request, no
> error — see the 2026-07-22 resolution in `HANDOFF_2026-07-21-phase1-cellular-login.md`).
> `next.config.ts` now sets `allowedDevOrigins: ["demo.whitevanops.com"]` to fix this.
> Production (`next start` / Electron standalone / PM2) imposes no such restriction — this
> is a dev-only concern, but the dev server is the usual thing behind the tunnel while iterating.

Leave it running and watch its output — foreground first, service later, so failures are visible.

Load `https://demo.whitevanops.com/field` in a desktop browser. Confirm a **valid padlock**,
not a certificate warning. (Decision 0 is already closed — flat scheme, confirmed by
Cloudflare's own SSL wording. This step just verifies the cert actually issued.)

## Step 6 — Verify from cellular (the only test that counts)

**Phone, WiFi OFF.** Office WiFi proves nothing — it never leaves the LAN.

- [x] `https://demo.whitevanops.com/field` loads on cellular
- [x] Field tech login succeeds; session persists across navigation
      *(first real exercise of the Phase 0 `Secure`-cookie branch — unit-tested only until now)*
      **Verified 2026-07-22 from iPhone over cellular:** login → `POST /api/auth/login 200`
      → session cookie retained and resent → change-password → dashboard, all clean. Required
      the dev-mode `allowedDevOrigins` fix above.
- [ ] Logout clears the session over HTTPS *(re-check of the one criterion validated only on plain http)*
- [ ] **Electron desktop login still works** on `http://localhost:3000` — the specific
      regression the per-request cookie change exists to prevent. Test on the same machine
      while the tunnel is up.
- [ ] Two devices on different networks land in separate rate-limit buckets; a shared NAT
      does not cross-lock users
- [ ] No inbound port forward on the router — confirm none was ever added

## Step 7 — Install as a service, then break it on purpose

**Requires an elevated shell.** Installing a Windows service needs Administrator rights;
a normal PowerShell (and any non-interactive automation) fails here because it can't answer
the UAC prompt. Open PowerShell via **Run as Administrator** for every command below.

**First stop any foreground `cloudflared tunnel run`** so the service is unambiguously what's
serving the tunnel. (Cloudflare tolerates two connectors on one tunnel — it load-balances —
but a clean test needs the service to be the only one up.)

Install the service, **pinning the config explicitly** with the global `--config` flag (this
sidesteps the LocalSystem config-location gotcha in the warning below):

```powershell
cloudflared --config C:\Users\rober\.cloudflared\config.yml service install
```

Confirm it registered and connected:

```powershell
Get-Service cloudflared | Format-List Name,Status,StartType   # Status=Running, StartType=Automatic
```

Then load `https://demo.whitevanops.com/field` — it should still serve, now via the service.

- [ ] Reboot the PC → tunnel comes back with no human action *(proves `Automatic` start)*
- [ ] `Stop-Process -Name cloudflared -Force` → the service manager restarts it on its own

> ⚠ **Config-location gotcha (verified 2026-07-22 environment).** The service runs as
> `LocalSystem`, whose home is `C:\Windows\System32\config\systemprofile\.cloudflared\`, not
> your `%USERPROFILE%\.cloudflared\`. Two things de-risk this here: (1) `config.yml` references
> the credentials by **absolute path** (`C:\Users\rober\.cloudflared\<UUID>.json`), so the
> creds resolve regardless of account; (2) the `--config` flag above pins `config.yml`'s
> location. If the site still stops resolving after install, copy the config into LocalSystem's
> home and restart the service:
>
> ```powershell
> $sys = "C:\Windows\System32\config\systemprofile\.cloudflared"
> New-Item -ItemType Directory -Force $sys
> Copy-Item C:\Users\rober\.cloudflared\config.yml,C:\Users\rober\.cloudflared\cert.pem,C:\Users\rober\.cloudflared\3eedf1be-d538-4693-8022-58f281eb18b5.json $sys
> Restart-Service cloudflared
> ```
>
> Uninstall with `cloudflared service uninstall`. cloudflared version confirmed here: 2026.7.2.
> Whatever proves true during this PoC becomes the Phase 2 script.

---

## Handling secrets

`cert.pem` and `<UUID>.json` are credentials for your Cloudflare account. Keep them out of
the repo (as with `WVO_FIREBASE_SERVICE_ACCOUNT`, see `MANUAL_Setup_Installation.md` §10).
Phase 2 must generate per-customer credentials — never ship one tunnel's credentials to
more than one customer, for the same reason `SESSION_SECRET` is per-customer.

## Exit criteria

Phase 1 is done when every box above is ticked **by observation, not assumption**, and the
hostname scheme is settled. Record what actually worked — Phase 2 automates exactly that,
so undocumented manual fixes here become silent failures at customer installs.

## Then

- **Phase 2** — script steps 4/7 per customer + a one-command "is the tunnel up?" diagnostic.
- **Phase 3** — Field Access QR / field-URL handling for tunnel hostnames (no `:3000`).
- **Phase 4** — doc rewrite, including re-rendering the stale
  `MANUAL_White_Glove_Installation.html` (currently banner-flagged) once Phase B's CGNAT
  dead-end is gone.
