# Client-Owned Standalone Connectivity

**Date:** 2026-07-21
**Status:** Design approved, pending implementation plan
**Extends (does not replace):** `2026-07-20-cgnat-tunnel-connectivity-design.md`

## Problem

The approved field-access design (Cloudflare Tunnel) uses **one vendor-owned Cloudflare
account + one vendor domain** (`whitevanops.com`), with each customer on a subdomain. That
spec's own risk table already flags the two problems this work addresses:

- *"Single vendor Cloudflare account = shared blast radius"* — one misconfiguration, ban, or
  account loss takes down **every** customer at once.
- *"Product depends on a third party's free tier"* — and, more pointedly, on **the vendor's
  continued existence**. If the business winds down or the vendor's Cloudflare account
  disappears, every customer loses field access with no recourse.

The goal: make each paid install **truly standalone** — it keeps working regardless of what
happens to the vendor, and the customer keeps full control of their data. The selling hook is
"you keep operating no matter what happens to us."

Hard reality that shapes everything below: **CGNAT means there is no inbound path to the
office PC without *some* rendezvous point.** "Standalone" cannot repeal that; it can only move
*ownership* of the rendezvous from the vendor to the client.

## Decision

Keep Cloudflare Tunnel (already half-proven in the parent spec's Phase 1), but split installs
into **two provisioning tracks** and make the paid track **client-owned end to end**.

| Track | Owns the account + domain | Hostname | When |
|---|---|---|---|
| **Trial** | Vendor (`whitevanops.com`, vendor CF account) | `<slug>.whitevanops.com` | Demos / 30-day trials. **= existing Phase 1 work, unchanged.** |
| **Paid (standalone)** | **The client** | `app.<theirdomain>.com` | Every paid install, client-owned from day one. |

The trial track is disposable and fast; the paid track is the "survives vendor death"
guarantee. Converting a trial to paid includes a one-time **re-home**: re-provision that
customer from the vendor account/domain onto their own.

### Why this option

- **Minimal delta from Phase 1.** Same `cloudflared` named-tunnel mechanics; the provisioning
  script is parameterized rather than rewritten. All Phase 0 app hardening applies unchanged.
- **Zero vendor ops and zero vendor liability.** The account and domain are the customer's;
  the vendor runs nothing on their behalf. Fits the no-subscription model.
- **Low field-tech friction.** Techs still just scan a QR / open a URL — no VPN client to
  install (the reason the mesh-VPN option was rejected).

### Options rejected

Recorded in full in the parent spec's decision log. Summary of what was weighed for the
*standalone* variant specifically:

- **Client-owned VPS + WireGuard/frp** — no Cloudflare, but someone must patch/monitor a
  rented box, and TLS still terminates off-prem. Reintroduces ops and recurring cost.
- **Client-owned mesh VPN (Tailscale/Headscale/Netbird)** — closest to "no cloud in the
  path," but every tech installs and logs into a VPN client (real friction for ~20 techs),
  and the commercial-use / self-hosted-coordinator questions add weight. Possible future
  premium "maximum sovereignty" tier; out of scope here.
- **LAN-only** — truly standalone but defeats the point (techs are in the field).

## Paid track — what "client-owned" concretely means

Three things must genuinely belong to the client, or standalone is only theoretical:

1. **The Cloudflare account** — created under *their* email, password in *their* password
   manager, *their* recovery. The vendor may hold delegated member access during setup (the
   free plan allows members), but the account root is the client's.
2. **A dedicated cheap domain** — registered in *their* Cloudflare account via Cloudflare
   Registrar (`.com` at cost, ~$10/yr, no markup). Deliberately **not** their existing
   business domain (see below).
3. **The tunnel credentials + `cloudflared` config** — already on their office PC by
   construction.

If the vendor evaporates, every link in that chain is already in the client's hands. Nothing
to reclaim, nothing to migrate.

## Why a dedicated cheap domain, not their existing one

A *named* tunnel with a stable public hostname **requires a real domain (a zone) in the
account** — confirmed in Cloudflare's docs. The only domain-free option is a *quick tunnel*
(`trycloudflare.com`), which hands out a random subdomain that changes on every restart and is
explicitly not for production — unusable for field techs who need a stable address. So a
domain is unavoidable; the only real choice is *which*.

Reusing the client's existing business domain would force moving **all** their DNS (website,
email/MX) onto Cloudflare via a nameserver change — a genuinely dangerous step that can knock
their website or email offline, for **zero benefit** here: the field hostname has no relation
to their website. A dedicated ~$10/yr domain is isolated, fully theirs, and dead-simple to
provision:

1. Register the domain in the client's Cloudflare account (auto-added as an active zone).
2. Point a subdomain (`app.` / `field.`) at the named tunnel.

No nameserver migration, no DNS import/verify gate, no risk to anything they already run.
Customer framing: it's a real but tiny cost, it's **yours**, and you can move it onto your
primary domain later if you ever want to.

**Reuse-existing-domain is kept as a documented-but-manual appendix only** — a short "how a
customer could later move the subdomain onto their own domain themselves" note. Not scripted,
not routinely supported.

## The Independence Packet (the actual deliverable)

This is the heart of "survives vendor death," and it is mostly documentation, not code. Each
paid customer receives a **tested** handover packet:

- Cloudflare account owner + recovery **confirmed theirs** — verified by having the client log
  into their own account once during onboarding, not assumed.
- Domain registration **confirmed theirs**.
- A **one-page recovery runbook**: how to check tunnel health, rotate the tunnel token, and
  re-create / re-point the tunnel from *their own* Cloudflare account — written so any
  competent IT person can execute it **without the vendor**.
- The documented-but-manual "move to your primary domain someday" appendix.

Without this packet, client-ownership is a promise; with it, it is demonstrable. **The packet
is the standalone guarantee**, and the "vendor-independence drill" below is what proves it.

## Provisioning automation (re-scope of parent spec Phase 2)

The per-customer provisioning script becomes **parameterized** by
`{ account, zone, hostname, track }` instead of hardcoding the vendor account. One script,
a `--trial` (vendor) vs `--client` (client-owned) mode. The one-command "is the tunnel up?"
diagnostic works regardless of whose account owns the tunnel.

## App-side changes

Almost nothing beyond the parent spec's Phase 3. `src/components/FieldAccessModal.tsx` already
persists an **editable** field URL in localStorage; client-owned just means that URL is
per-customer and freely configurable. Remove the hardcoded
`http://<client>.duckdns.org:3000/field` scheme assumption from its placeholder, warning copy,
and doc comment (already listed as unblocked in the Phase 1 handoff). No scheme assumptions
baked into the app.

## Relationship to existing work

- **Trial track = the current Phase 1 tunnel-on-vendor-domain work.** It stays; finishing
  Phase 1 remains valuable and is now explicitly scoped to trials/demos.
- This design **extends** the parent spec rather than discarding it. All Phase 0 app hardening
  (per-request cookie `secure`, layered rate limiting, client-IP resolution) applies to both
  tracks unchanged.

## Trade-offs

- Onboarding is longer per paid customer: account creation + domain registration + the
  Independence-Packet verification. That time **is** the cost of independence.
- Cost shifts to the client (~$10/yr domain). This *fits* the no-subscription model — zero
  ongoing vendor liability — and it is what makes the account genuinely theirs.
- Cloudflare remains in the TLS path. This design delivers **business continuity / survives
  vendor death**, not pure "no cloud ever touches the traffic" data-sovereignty. That stronger
  property was explicitly considered (client-owned mesh VPN) and rejected for field-tech
  onboarding friction; it can be revisited as a premium tier later.

## Verification criteria

Not complete until all of these are observed, not assumed:

- [ ] A **fresh client-owned account** provisions end to end: register a domain in the client's
      Cloudflare account → named tunnel on the office PC → `https://app.<theirdomain>.com/field`
      loads **from a phone on cellular, WiFi off**.
- [ ] Field-tech login succeeds and the `Secure` session cookie persists across navigation
      (first real exercise of the Phase 0 HTTPS branch on a client-owned host).
- [ ] **Electron desktop login still works** on `http://localhost:3000` — the regression the
      parent spec is built to prevent.
- [ ] Tunnel auto-recovers after the office PC reboots and after killing the service.
- [ ] **Vendor-independence drill:** using **only** the client's own Cloudflare login +
      registrar login + office PC — no vendor-held credential — execute the recovery runbook
      (rotate token / re-point tunnel) end to end. This is the test that proves "standalone."
- [ ] No inbound port forward exists on the customer router.

## Out of scope

- Scripted reuse of a client's existing business domain (documented-manual appendix only).
- Client-owned mesh VPN / "no cloud in the path" tier (possible future premium tier).
- Dashboard caching / optimistic UI (the parent spec's known ~25-user ceiling — separate work).
- Automatic migration of existing trial installs (conversion re-homes them by re-provisioning).

## Risks

| Risk | Mitigation |
|---|---|
| Client loses access to their own Cloudflare account → they, not the vendor, are locked out | Independence Packet verifies recovery is set up and the client has logged in once; runbook documents account recovery. |
| Client lets the domain registration lapse → hostname dies | Disclose the ~$10/yr renewal in the packet; document re-registration. Domain is theirs to keep current. |
| Provisioning script misused across tracks (vendor vs client account) | Explicit `--trial` / `--client` mode + the diagnostic reports which account/zone the live tunnel belongs to. |
| Cloudflare still terminates TLS (not pure data-sovereignty) | Disclosed explicitly in customer-facing docs; data at rest stays on-prem; mesh-VPN tier remains a future option. |
