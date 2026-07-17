# White Van Ops — White Glove Installation Manual

**Objective**: Execute a flawless on-site or remote installation of White Van Ops, configuring network port forwarding, backups, and user training.

## 1. Preparation (Before Arrival)

**What to Bring (Physical or Digital):**
- USB Flash Drive (for local backup setup if the client doesn't have one).
- Latest `WhiteVanOps Setup x.x.x.exe`.
- Router login credentials (if available).
- Administrator credentials (admin / admin).

**Client Prerequisites (Confirm beforehand):**
- A dedicated Windows PC (Windows 10/11) that stays powered on 24/7.
- Administrator access on that PC.

---

## 2. On-Site Installation Procedure

### Phase A: Core Software Installation
1. Log into the dedicated office PC. Ensure Windows Sleep settings are set to "Never Sleep" (Monitor off is fine, PC sleep is not).
2. Run `WhiteVanOps Setup x.x.x.exe`.
3. Allow the installer to complete and launch the application.
4. **First Launch**: Wait for the application to initialize the database automatically.
5. Log in with `admin` / `admin`. Immediately change the password to a secure one provided by the owner.

### Phase B: Network Port Forwarding & Dynamic DNS

**Heads up before you start:** this path is plain `http://`, not `https://` — credentials travel unencrypted once they leave the office LAN. This is the accepted tradeoff for zero-subscription-cost remote access (see full explanation and CGNAT/firewall/DDNS detail in `MANUAL_Setup_Installation.md` §7). If a client specifically needs encrypted transport, that's a separate reverse-proxy setup, not covered here.

1. **Check for CGNAT first** — on an office computer, compare the IP shown by `whatismyip.com` to the router's "WAN IP"/"Internet Status" page. If they don't match, this ISP doesn't hand out a real public IP and port forwarding is impossible until they upgrade to a static-IP plan. Don't proceed past this step until confirmed.
2. Reserve a fixed local IP for the office PC via the router's **DHCP Reservation** (by the PC's MAC address, from `ipconfig /all`) — not just a manually-set static IP on the PC, which the router doesn't know about and could still hand to another device.
3. Log into the client's office internet router (usually `http://192.168.1.1` or `http://192.168.0.1`).
4. Set up **Port Forwarding** (may be labeled "Virtual Server" or "NAT Forwarding"): forward external port `3000` → the office PC's reserved IP → internal port `3000`, protocol TCP.
5. Add a Windows Firewall inbound rule allowing TCP port 3000 (Windows Defender Firewall with Advanced Security → Inbound Rules → New Rule → Port). Don't rely solely on the one-time "Allow app" popup.
6. Set up **DuckDNS**: create a subdomain at duckdns.org, then install their Windows updater as a Scheduled Task (follow duckdns.org's own Windows install instructions) so the hostname keeps tracking the office's public IP automatically.
7. **Test correctly**: on a phone, turn **WiFi off** (use cellular data) and visit `http://your-client.duckdns.org:3000/field`. Testing while still connected to the office WiFi does not prove anything — that traffic never leaves the LAN.

### Phase C: Target Directory Mirror (Backup)
1. Plug in the dedicated USB Drive or set up a shared network NAS folder.
2. Inside White Van Ops, navigate to the **Settings** tab.
3. Enter the absolute path to the backup folder (e.g., `E:\WVO_Backups\`).
4. Click **Run Manual Backup Now** to verify the `.sql.gz` file is created successfully.

### Phase D: Field Tech Provisioning
1. Click **Field Access QR** in the dashboard and paste the Dynamic DNS URL (e.g., `http://your-client.duckdns.org:3000/field`).
2. Have each field technician scan the QR code with their mobile device.
3. Instruct them to tap **Share -> Add to Home Screen** (iOS) or **Add to Home screen** (Android).
4. Verify the app opens full-screen without URL bars.
5. Have them sign in with their tech credentials.

---

## 3. Data Migration & Training

### Migration
- If they have a spreadsheet of clients and inventory, utilize the standard CSV formats (if available) or spend 30 minutes manually entering their top 20 active clients and core inventory to get them started.

### Admin Training Checklist
- [ ] How to schedule a job and avoid conflicts.
- [ ] How to add a new employee or vehicle.
- [ ] How to review time entries and complete a job.
- [ ] How to export to QuickBooks and mark as synced.

### Tech Training Checklist
- [ ] How to open the PWA from the home screen.
- [ ] How to start a job, add materials, and log time.
- [ ] Demonstrate Offline Mode (turn off WiFi/Cellular, log time, turn back on).

---

## 4. Troubleshooting Roadblocks

> The four install-day roadblocks below are the ones you hit with your hands on the machine. For ongoing support after handoff — dead PCs and license reactivation, CGNAT, backups, activation failures, port conflicts — see **`docs/MANUAL_Troubleshooting.md`**, which is organized by customer-reported symptom.

**Roadblock: The QR code won't load on phones off the office Wi-Fi.**
- *Fix*: Check in this order — (1) CGNAT: compare `whatismyip.com` to the router's WAN IP, if they differ nothing else here will work until the ISP fixes it; (2) the port-forward rule is pointing at the PC's *current* local IP (did the DHCP reservation actually take?); (3) Windows Firewall allows inbound TCP 3000; (4) the DDNS hostname resolves to the correct current IP (`nslookup`, check the Task Scheduler updater's last run). Full detail and exact steps: `MANUAL_Setup_Installation.md` §7 and §11.

**Roadblock: The PC went to sleep and techs can't sync.**
- *Fix*: Windows 11 hides the deep sleep settings. Go to Control Panel -> Power Options -> Change plan settings -> Put the computer to sleep: **Never**.

**Roadblock: "I forgot my admin password."**
- *Fix*: Since the DB is bundled, you can run a script against the local PostgreSQL instance on port 5433 to forcibly reset the password hash. (Keep a recovery SQL script handy).

**Roadblock: The PWA won't install on an older iPhone.**
- *Fix*: Ensure they are using Safari (Chrome on iOS sometimes restricts PWA installation). Ensure iOS is updated. The app functions in the browser regardless, but the Home Screen experience requires Safari.
