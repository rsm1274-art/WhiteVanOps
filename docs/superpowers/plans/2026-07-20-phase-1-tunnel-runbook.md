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

Reason: Cloudflare's free Universal SSL covers the apex plus a **single** wildcard level
(`*.whitevanops.com`). A third-level host like `acme.field.whitevanops.com` is not covered
by that certificate, and the paid fix (Advanced Certificate Manager, ~$10/mo) reintroduces
the recurring per-vendor cost this design exists to avoid.

> ⚠ **Unverified as of writing** — believed correct but not checked against current
> Cloudflare documentation. Settle it in Step 5 below: if the flat name serves valid HTTPS
> and a `field.` name does not, that is the answer. Costs nothing to prefer the flat name.

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

Leave it running and watch its output — foreground first, service later, so failures are visible.

1. Load `https://demo.whitevanops.com/field` in a desktop browser. Confirm a **valid
   padlock**, not a certificate warning.
2. **Settles Decision 0:** if this serves valid HTTPS, the flat scheme works. Only if you
   want the `field.` tier, test `demo.field.whitevanops.com` too and see whether the
   certificate holds.

## Step 6 — Verify from cellular (the only test that counts)

**Phone, WiFi OFF.** Office WiFi proves nothing — it never leaves the LAN.

- [ ] `https://demo.whitevanops.com/field` loads on cellular
- [ ] Field tech login succeeds; session persists across navigation
      *(first real exercise of the Phase 0 `Secure`-cookie branch — unit-tested only until now)*
- [ ] Logout clears the session over HTTPS *(re-check of the one criterion validated only on plain http)*
- [ ] **Electron desktop login still works** on `http://localhost:3000` — the specific
      regression the per-request cookie change exists to prevent. Test on the same machine
      while the tunnel is up.
- [ ] Two devices on different networks land in separate rate-limit buckets; a shared NAT
      does not cross-lock users
- [ ] No inbound port forward on the router — confirm none was ever added

## Step 7 — Install as a service, then break it on purpose

```powershell
cloudflared service install
```

- [ ] Reboot the PC → tunnel comes back with no human action
- [ ] Kill the `cloudflared` process → it restarts on its own

> ⚠ **Verify against `cloudflared service install --help` before relying on this.** The
> Windows service runs as a different account than your user, so the config and credentials
> file must be readable from where the service looks for them — a common failure is a
> service that installs cleanly and then cannot find `config.yml`. Confirm behavior during
> the PoC rather than assuming; whatever proves true here becomes the Phase 2 script.

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
