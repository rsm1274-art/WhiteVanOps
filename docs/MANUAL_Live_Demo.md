# White Van Ops — Live Demo Playbook

**Objective**: Convert a prospect into a buyer by demonstrating that White Van Ops is simple, fast, and completely owned by them.

## 1. Pre-Demo Preparation

### 1.1 The Environment
- Ensure you have a clean installation of the latest `WhiteVanOps Setup x.x.x.exe`.
- **Demo Data is Crucial**: Have a few fake clients, vehicles, and jobs pre-populated. (Use names like "Lakeside Mall" or "Reyes Dental").
- Have your phone ready with the screen mirrored to your PC or held up to the camera so they can see the mobile experience.

### 1.2 The Pitch
- Reiterate the core philosophy: *"You pay once. The software runs on your hardware. No cloud subscriptions. No one else has your data."*

---

## 2. The Demo Flow (20 Minutes)

### Step 1: The Office Dashboard (5 mins)
- **Start at the Overview Tab**: Show them the high-level KPIs (Fleet Deployment, Active Jobs, Overdue). 
- **Scheduling**: Show how easy it is to schedule a job and allocate a vehicle and crew. Highlight the *conflict warnings* — demonstrate trying to double-book a technician or a van and show how the system immediately catches it.
- **Inventory**: Briefly show the warehouse and van stock levels. Mention that completing a job automatically deducts the inventory.

### Step 2: The Field Tech Experience (5 mins)
- **The "Aha" Moment**: Click "Field Access QR" on the dashboard. Hold up your phone to the camera and scan the QR code.
- Walk them through adding it to the Home Screen (PWA). Emphasize that it acts exactly like a native app, but doesn't require going through the Apple/Google App Store.
- Show the field view: The tech only sees what they need.
- **Log Time & Complete**: Tap into a job, log 2 hours of time, and hit Complete. 
- *Switch back to the Office Dashboard and refresh to show the real-time update.*

### Step 3: The Offline Magic & Backups (5 mins)
- **Offline Demo**: Put your phone in Airplane mode. Open the field app, log some time or change a status. Point out the red "OFFLINE" badge. Explain that the app *did not crash or show an error*. 
- Turn off Airplane mode. Show the amber "SYNCING..." badge appear and disappear. Explain that the data just safely pushed to the office.
- **Backups**: Open the Settings Tab. Show the "Target Directory Mirror". Explain that every night at 2:00 AM, the system zips up their entire database and drops it onto their chosen USB drive or NAS. 

### Step 4: Closing & Questions (5 mins)
- Remind them of the price: $250 one-time, or $500 for the white-glove installation where you set everything up for them.
- Ask for the sale: *"Does this look like something that would simplify your dispatching tomorrow?"*
- **Not ready to buy today?** Leave the Trial/Demo installer (`WhiteVanOps-Trial-Setup.exe`) so they can keep evaluating on their own — it runs the full Plus feature set for 30 days, then locks until they call you with a purchase decision. See `MANUAL_Setup_Installation.md` §6.4 for building it and converting a trial to a paid install.

---

## 3. Anticipated Roadblocks & Rebuttals

**"What happens if my office PC dies?"**
> "That's exactly why we built the Target Directory Mirror. As long as you have that USB drive or NAS, we can install the software on a new PC, import your backup, and you are back up and running in 10 minutes without losing a single job."

**"Is it hard for my older techs to use the mobile app?"**
> "It's intentionally minimalist. They scan a QR code once. They press a big button to 'Start Job' and another to 'Complete Job'. There is zero clutter."

**"How does the phone talk to the office if it's not in the cloud?"**
> "We configure a direct route through your office internet router straight to the server PC. It's like a direct, encrypted walkie-talkie channel between the phone and the office PC. There are no middleman servers, no subscriptions, and nobody else ever holds your data."

**"Do you integrate with QuickBooks?"**
> "Yes, via CSV export. You export invoices and time entries with one click, and they are marked 'Synced' so you never double-bill. We intentionally avoid a direct live sync because QuickBooks API updates frequently break live connections."
