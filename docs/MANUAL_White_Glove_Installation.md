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
1. Ensure the office PC has a static local IP address (configured in Windows or via the router's DHCP reservation).
2. Log into the client's office internet router.
3. Set up **Port Forwarding**: Forward external port `3000` to the office PC's local IP address on internal port `3000`.
4. Set up a free **Dynamic DNS (DDNS)** service (like DuckDNS) on the router or via a small background updater on the PC. This ensures the public URL stays fixed even if their ISP changes their external IP.
5. Test the connection from a mobile device (not on the office Wi-Fi) by visiting `http://your-client.duckdns.org:3000/field`.

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

**Roadblock: The QR code won't load on phones off the office Wi-Fi.**
- *Fix*: Check the Windows Defender Firewall. Ensure inbound connections to port `3000` are permitted for the Node.js/Electron executable. Verify the Port Forwarding rules in the router are correctly pointing to the PC's current local IP. Verify the DDNS address is actively pointing to the correct external IP. Check if the ISP uses Carrier-Grade NAT (CGNAT), which breaks traditional port forwarding.

**Roadblock: The PC went to sleep and techs can't sync.**
- *Fix*: Windows 11 hides the deep sleep settings. Go to Control Panel -> Power Options -> Change plan settings -> Put the computer to sleep: **Never**.

**Roadblock: "I forgot my admin password."**
- *Fix*: Since the DB is bundled, you can run a script against the local PostgreSQL instance on port 5433 to forcibly reset the password hash. (Keep a recovery SQL script handy).

**Roadblock: The PWA won't install on an older iPhone.**
- *Fix*: Ensure they are using Safari (Chrome on iOS sometimes restricts PWA installation). Ensure iOS is updated. The app functions in the browser regardless, but the Home Screen experience requires Safari.
