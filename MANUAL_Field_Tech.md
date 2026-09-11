# WhiteVanOps — Field Technician User Manual

**Audience:** Field service technicians
**Last updated:** September 2026

---

## What Is the Field Module?

The Field Module is a mobile-friendly web page designed for use on your phone or tablet while you're on site. It shows you the jobs assigned to you, lets you start and complete jobs, log your hours, record materials used, and add site notes — all from the field.

You do not need the full admin dashboard. Access the Field Module directly at:

```
http://<your-office-address>:3000/field
```

Your supervisor or dispatcher will give you the exact address — usually as a **QR code** shown from the office dashboard (sidebar → Field Access QR). Just point your phone camera at it and tap the link.

**This address only works while your phone is connected to the office WiFi.** That's how the app is designed to work everywhere — there is no remote/cellular access to the field module at all, at any company. If the address doesn't load, the first thing to check is always which WiFi network your phone is on.

### Install it as an app on your phone (recommended)

After signing in the first time, install the Field Module on your home screen so it opens full-screen with its own icon, like a regular app:

- **iPhone (Safari):** tap the **Share** button → **Add to Home Screen** → **Add**.
- **Android (Chrome):** tap the **⋮ menu** → **Install app** (or "Add to Home screen") → **Install**.

From then on, tap the **WVO Field** icon on your home screen to go straight to your jobs.

**Important:** You do not need to install any VPN or special app on your phone to connect. Just open the link on your phone's browser while on the office WiFi. Closing the app or losing signal never loses work you've already entered; see **Working Offline** below.

---

## Signing In

1. Open the Field Module address in your browser.
2. You will be taken to a login screen. Enter the username and password your administrator set up for you.
3. You land directly on your assigned jobs. If your account is linked to your personnel record, your name is selected automatically — no extra step needed.

Your login session is saved by the browser. On future visits to the same device you will go straight to your jobs without signing in again, until the session expires (7 days).

---

## Switching Technicians

If someone else needs to use the same device, tap the **Switch** button in the top-right corner of the header. This returns to the name selection screen.

---

## Your Jobs Screen

Once you've selected your name, you see a list of all jobs assigned to you.

**Status filter buttons** in the top-right let you toggle between:

| Filter | What it shows |
|---|---|
| Active | Jobs that are Scheduled or In Progress (default view) |
| Done | Jobs that are Completed |
| All | Every job regardless of status |

Each job card shows:
- The client's name and job address
- The current status (Scheduled, In Progress, Completed)
- The scheduled date
- Your assigned vehicle
- Your crew (other techs on the same job)
- A count of logged time entries and materials, if any

---

## Job Status Badges

| Badge Color | Status | Meaning |
|---|---|---|
| Blue | Scheduled | Job is planned but not started |
| Amber / Yellow | In Progress | You are currently working this job |
| Green | Completed | Job is done |

---

## Expanding a Job Card

Tap the **down arrow (v)** on the right side of any job card to expand it. The expanded view shows:

- Any equipment assigned to the job
- Action buttons (Start Job / Mark Complete)
- Buttons to open the Log Time, Notes, and Materials panels

Tap the **up arrow (^)** to collapse the card again.

---

## Starting a Job

When you arrive on site and are ready to begin work:

1. Expand the job card.
2. Tap **Start Job** (amber button).
3. The job status changes from Scheduled to **In Progress**.

You only see this button when the job is in Scheduled status.

---

## Completing a Job

When all work on site is finished:

1. Expand the job card.
2. Make sure you have logged your time and materials before completing (see below).
3. Tap **Mark Complete** (green button).
4. The job status changes to **Completed**.

Once a job is marked Complete, it moves to the Done filter and the action buttons disappear. **Completion cannot be undone from the field.**

---

## Logging Time

Time entries record how many hours you worked on a job. Log time before marking the job complete.

1. Expand the job card.
2. Tap **Log Time**.
3. Fill in the form:

| Field | What to enter |
|---|---|
| Hours | The number of whole hours worked |
| Minutes | Additional minutes (0–59) |
| Date | Defaults to today. Tap to change if logging for a different day. |
| Service Type | Select what type of work you did (see options below) |

**Service Type options:**

- **Field Labor** — general on-site work (default)
- **Installation** — installing equipment or systems
- **Repair** — fixing or troubleshooting an issue
- **Inspection** — site inspection or assessment
- **Travel** — drive time to or from the job site

4. Tap **Submit Time Entry**.
5. A green confirmation appears and the panel closes.

You can submit multiple time entries for the same job (e.g., one for field labor and one for travel time). All your previous entries for that job are listed at the top of the panel so you can see what's already been logged.

---

## Adding Job Notes

Use the Notes panel to record anything important about the site, access instructions, issues you found, or anything the office or next tech should know.

1. Expand the job card.
2. Tap **Notes**.
3. Type your notes in the text box.
4. Tap **Save Notes**.

Notes are visible to the office and to other technicians who open the same job. They overwrite the previous notes, so include all relevant information each time you save.

---

## Recording Materials Used

Use the Materials panel to list what was taken from the van and used on the job. These entries become the line items on the client's invoice and are deducted from your van's inventory when the job is marked Complete.

1. Expand the job card.
2. Tap **Materials**.
3. Any materials already added to the job will appear here.

**To add a material:**

4. Tap **Add Material** (the dashed button at the bottom).
5. A new item row appears. Fill it in:

| Field | What to enter |
|---|---|
| Item | Select from the dropdown list of catalog items |
| Qty | How many units were used |
| Rate ($) | Price per unit — auto-fills from the catalog, but can be changed |
| Description | Optional note about this specific material use |

6. Repeat for each material used.
7. Tap **Save Materials** when done.

**To remove a material:**
Tap the red trash icon on the right side of any item row before saving.

**Note:** When you select an item from the dropdown, the Rate field fills in automatically from the catalog default. You can override this rate if needed.

---

## Refreshing Your Jobs

Tap the **circular arrow (refresh)** icon in the top-right header to reload your job list from the server. Do this if the dispatcher just assigned you a new job and it's not showing up yet.

---

## Exporting Your Work

Next to the refresh icon is an **export** button. Tap it to download a file to your phone containing everything currently queued to send, anything set aside as needing attention, and your last 30 days of successfully synced work. This is a **backup, not a sync action** — it doesn't send anything to the office or clear your queue, it just saves a copy.

**When to use it:**

- **Before a phone gets replaced, reset, or its storage cleared.** Export first, hand the file to your dispatcher, and nothing is lost even if the phone's local data is wiped.
- **If your phone's storage seems to be having trouble** — the app warns you about this automatically (see the storage banner below), but exporting is always safe to do as a precaution.
- **If you're heading somewhere with no reliable WiFi for a while** and want a backup of what you've entered so far, just in case.

The exported file can be sent to the office (email, text, AirDrop, a USB cable, however is convenient) and imported back in from **Settings → Recover Field Work** on the dashboard — an administrator does that part, not you. Re-sending the same file twice is always safe; the office system recognizes work it already has and won't duplicate it.

---

## Things You Cannot Do from the Field Module

The following actions are only available in the admin dashboard:

- Adding or editing clients
- Scheduling new jobs
- Adding personnel or vehicles to the system
- Viewing inventory levels
- Exporting to QuickBooks
- Cancelling a job
- Viewing other technicians' assignments

If you need any of these done, contact your dispatcher or supervisor.

---

## Working Offline

The Field Module saves your changes to your phone's local storage, so you can continue logging time, notes, and materials even if the server is unreachable. When the server comes back online, all saved changes are sent automatically. **Closing the app never loses queued work** — it's saved on your phone until it can reach the office.

"The server is unreachable" normally just means you're away from the office — the app only reaches the office server over the office WiFi, everywhere, always. That's expected, not an error: keep working, and your entries will save the next time you're back on-site.

**Important limitation — read this once:** the Field Module **cannot reload itself from scratch while you're off the office WiFi.** Once the page is open it keeps working fully offline (logging time, notes, materials all still work), but if you force-close the browser tab/app or your phone reloads it for you (low memory, a long time in the background) while you're away from WiFi, you may not be able to get back into it until you're back in range. **Avoid force-closing or reloading the Field Module while you're away from the office.** If you do get stuck, nothing already saved is lost — use the **export button** (above) once you're back on WiFi, or hand your phone to the office so they can pull the file off it.

### Two different timestamps in the header — don't confuse them

The header shows two separate times, and they answer two different questions:

| What it says | What it means |
|---|---|
| "Assignments as of 2:10pm" | When your **job list** was last refreshed from the office — the *read* side. Tap refresh to update it. |
| "Last saved to office 2:14pm" | When your **queued entries** (time, notes, materials, status changes) last successfully reached the office — the *write* side. |

They're independent and it's normal for them to show different times — refreshing your jobs doesn't send anything, and sending queued work doesn't refresh your job list.

### The status line under the header

A small status line under the job list header tells you what's happening with your saved-but-not-yet-sent work:

| What it says | What it means |
|---|---|
| *(nothing shown)* | Everything is caught up — nothing waiting to send. |
| "Syncing 3…" | 3 entries are being sent to the office right now. |
| "3 waiting · office network not found" | 3 entries are saved on your phone but the office server isn't reachable — normal and expected if you're off the office WiFi. Nothing is lost; it will send automatically once you're back in range. |
| "3 waiting · office server busy" | The office server answered but asked to retry — usually brief. It will keep trying on its own. |

Whenever entries are waiting, a **Try now** button appears next to the status line. Tap it to ask the app to retry immediately instead of waiting for the next automatic attempt — useful the moment you've just walked back into the office or reconnected to WiFi.

### Storage warning banner

If your phone's browser reports it's running low on storage, or you have a large number of entries waiting to send (25 or more), a banner appears suggesting you sync soon. Get back on the office WiFi and let the queue drain, or use **Try now**. You can dismiss the banner, but it's worth acting on — a phone that genuinely runs out of local storage risks losing unsent work in a way exporting can't fix after the fact, so don't let a big backlog build up indefinitely.

### Entries that need attention

Sometimes a change you saved offline can no longer be applied — for example the office
cancelled or deleted the job it was for. When that happens, the app sets the entry
aside instead of blocking your other changes, and an amber banner appears:
**"N entries need attention."**

Tap the banner to see each entry and choose what to do with it:

- **Re-target** — save the entry to a different one of your jobs (for time, notes, and
  materials; not available for status changes). The list only shows jobs assigned to
  you — if the right job isn't there, use *Send to office*.
- **Send to office** — hands the entry to the office. An administrator sees it on the
  dashboard and can apply it to the right job.
- **Discard** — deletes the entry from your device. The office always keeps a record
  of exactly what was discarded, so nothing disappears silently.

All three actions need the office server to be reachable. If it isn't, the entry
simply stays on your device — nothing is lost.

---

## Troubleshooting

**I don't have login credentials.**
Your administrator needs to create a user account for you and link it to your personnel record. Contact them before your first use.

**My name doesn't appear / the wrong name is shown after login.**
Your account may not be linked to your personnel record. Contact the administrator to verify your account setup.

**I can't see a job I was told I'm assigned to.**
Make sure your name is selected. Tap **Switch** and re-select yourself, then wait for the refresh. If the job still doesn't appear, your assignment may not have been saved yet — contact the dispatcher.

**The page won't load or shows "Failed to connect to server."**
Check your Wi-Fi connection. The server is only reachable while connected to the **office WiFi** — switch to it if you're elsewhere. This is normal, not a fault: there is no cellular/remote access to the field module at all.

**I accidentally marked a job as Complete before logging time.**
Contact the administrator. Completed status cannot be undone from the Field Module, but the administrator can log time entries on your behalf from the admin dashboard.

**My time entry or notes didn't save.**
A green confirmation message appears when a save is successful. If you see a red error message instead, check your connection and try again. If the error persists, write down the details and report them to the administrator.

**The app looks zoomed in or cut off on my phone.**
Make sure your phone's browser zoom is set to 100%. On most phones, you can reset this by double-tapping the content area or going to browser settings.

---

## Quick Reference Card

| What you want to do | How to do it |
|---|---|
| Sign in | Open the Field Module URL → enter your username and password |
| See your active jobs | Default view when signed in |
| See completed jobs | Tap **Done** filter button |
| Start a job | Expand card → tap **Start Job** |
| Complete a job | Expand card → tap **Mark Complete** |
| Log time | Expand card → tap **Log Time** → fill form → Submit |
| Add a note | Expand card → tap **Notes** → type → Save |
| Record materials | Expand card → tap **Materials** → Add Material → Save |
| Refresh job list | Tap the circular arrow in the header |
| Export a backup of your work | Tap the export button next to the refresh icon |
| Switch to another tech | Tap **Switch** in the header |

---

*End of Field Technician User Manual*
