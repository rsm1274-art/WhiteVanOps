# WhiteVanOps — Administrator Reference Manual

**Audience:** Business owner / office administrator
**Last updated:** June 2026

---

## Overview

WhiteVanOps is an internal field operations management dashboard. It tracks jobs, clients, crew, fleet, inventory, and produces QuickBooks-ready export files. It does **not** process payroll — that happens inside QuickBooks after you import the CSV exports this system generates.

### Plans: Base & Plus

WhiteVanOps ships in two plans running on the same installation:

- **Base** — everything described in Modules 1–7 below: jobs, scheduling, personnel, fleet, inventory, and QuickBooks CSV export.
- **Plus** — adds three feature areas on top of Base:
  - **Client notes & follow-up reminders** in the Clients & Jobs module (Module 2)
  - **Business Analytics** tab — revenue, technician hours, and fleet cost charts (Module 8)
  - **Invoicing & Payments** tab — internal invoices with PDF generation and payment tracking (Module 9)

The plan is controlled by a license setting in **Settings → License & Plan** (superuser only — see that section below). Upgrading requires no reinstall: flip the plan and the new tabs appear on the next dashboard refresh. Downgrading hides the Plus tabs and blocks the Plus features, but **never deletes** notes, follow-ups, invoices, or payment records — everything reappears if the plan is re-activated.

Open the **WhiteVanOps** application from your desktop shortcut or Start Menu. The app starts its internal server automatically — a loading screen appears for a few seconds, then the login page opens.

---

## First Login

The initial superuser account is **admin / admin**. On first login you will be immediately redirected to a password change screen — you cannot access any part of the application until a new password is set (minimum 8 characters). After setting your password you land on the dashboard. Create accounts for all other staff from the Manage Users modal before distributing the app.

**Account lockout:** after 5 consecutive failed login attempts on an account, that account is locked for 15 minutes (even with the correct password) as protection against password-guessing. The lockout clears automatically once the 15 minutes pass, or resets immediately on the next successful login. There is no admin override to unlock an account early — if a staff member is locked out and it's urgent, wait out the window rather than repeatedly retrying.

---

## Dashboard Layout

After logging in, you see a two-panel layout:

- **Left sidebar** — navigation between the modules (seven on Base; **Analytics** and **Invoicing** also appear on Plus)
- **Main area** — the active module's content

The sidebar also shows:
- A pulsing green dot confirming the database connection is live
- A **Manage Users** button (superuser only)
- A **Field Access QR** button — opens a modal with a QR code techs scan to reach the field module on their phones (see below)
- A **Field Module** link that opens the technician-facing interface
- A **Sign Out** button

### Field Access QR (onboarding techs' phones)

Click **Field Access QR** in the sidebar to open a modal showing a QR code for the field module URL. The URL field is editable and remembered per browser:

- On the office server, replace the default with the Dynamic DNS address (e.g., `http://your-client.duckdns.org:3000/field`) — the modal warns if the URL is a localhost address that phones can't use.
- A tech scans the code with their phone camera, signs in with their tech account, then uses **Add to Home Screen** (iPhone: Share → Add to Home Screen; Android: menu → Install app) to install the field module as a full-screen app with its own icon.

The top header shows the current module name, a yellow **Unsynced** badge when completed jobs or time entries are waiting to be exported to QuickBooks, and a **bell icon** for alerts.

### Alerts (Notification Bell)

The bell icon in the top header shows a red count badge when there are active alerts. Click it to open a panel listing:

- **Overdue Jobs** — jobs still `Scheduled` or `In Progress` whose scheduled date has already passed
- **Client Follow-Ups Due** *(Plus only)* — open client follow-ups whose due date is today or earlier
- **Low Stock** — any stock level (warehouse or van) at or below its configured minimum threshold

Clicking an individual alert jumps you to the relevant tab (Clients & Jobs for overdue jobs and follow-ups, Inventory Control for low stock) so you can act on it. This is in-app only — there is no push/email/SMS delivery.

---

## Module 1: Operations Overview

The home screen. Displays at-a-glance KPIs across all active operations:

- Fleet deployment rate for today
- Active jobs today
- **Overdue jobs** — same count shown in the alert bell
- **Van reorder alerts** — same low-stock count shown in the alert bell
- QuickBooks export backlog
- Today's dispatch matrix and fleet status ledger

Use this tab to assess the state of the business at a glance each morning.

### Field Sync Review

When a field tech's offline change can no longer be applied (for example, the job it
targeted was deleted) and the tech chooses **Send to office**, the record appears on
the dashboard: the Overview tab shows a **Field Sync Review** card whenever there are
open items. Clicking it opens the review modal, which shows for each record: which
tech sent it, what it was (time entry, notes, materials, or status change), the full
original payload, and why the server rejected it.

For each record you can:

- **Re-target** — apply the entry to any job in the system (not limited to the tech's
  assignments), then the item is marked Resolved. Not available for status changes.
- **Mark resolved** — use after re-entering the data manually through the normal tabs.
- **Dismiss** — close the item without applying it. Dismissals are recorded in the
  audit log.

Discarded (rather than handed-off) entries never appear here, but their full payloads
are preserved in the audit log (entity "StuckSyncOp") and can be re-entered manually.

---

## Module 2: Clients & Jobs Ledger

This is the core operational tab where you manage both clients and their associated jobs.

### Client Records

Click **Add Client** to create a new client record. Fields:

| Field | Notes |
|---|---|
| Company Name | Required. This appears on QuickBooks invoice exports. |
| Contact Name | Primary contact person at the client. |
| Location Address | Site address where work is performed. |
| Payment Terms | Select from: **Due on Receipt**, **Net 15**, or **Net 30**. This controls the invoice due date on QB exports. |

### Client Notes & Follow-Ups (Plus only)

With a Plus license, each client card gains a collapsible **notes & follow-ups** panel (click the "X notes · X follow-ups" row at the bottom of the card to expand it):

- **Add Note** — appends a timestamped entry to the client's communication log (calls, emails, site visits, anything worth remembering). Notes record who wrote them and cannot be edited or deleted — treat them as a permanent log.
- **Follow-Up** — schedules a dated reminder for this client (e.g., "Call to confirm contract renewal"), optionally assigned to a crew member. Open follow-ups are listed on the card with:
  - a **checkmark** button to mark them completed,
  - a **pencil** to edit the date, text, or assignee,
  - a **trash** icon to delete them.

A follow-up whose due date arrives shows in red on the card and appears in the notification bell under **Client Follow-Ups Due** until completed or deleted.

### Job Management

Click **Add Job** to schedule a new job. Fields:

| Field | Notes |
|---|---|
| Client | Select from existing clients. |
| Scheduled Date | The date work is planned. |
| Assigned Vehicle | The van dispatched to this job. |
| Crew | Select one or more technicians (checkboxes). |
| Equipment | Select any special equipment assigned (checkboxes). |
| Notes | Internal notes about the job. |

While picking a vehicle, date, crew, or equipment, an amber **Availability Conflict** notice appears live in the form if that combination overlaps with another job, an unresolved repair, or a technician's time off — before you submit. This is advisory; the save itself is always re-checked and rejected server-side if a real conflict exists.

### Recurring Jobs

For clients you service on a regular cadence, click **New Recurring Job** in the Recurring Jobs panel (above the jobs table) instead of scheduling every visit by hand. Fields:

| Field | Notes |
|---|---|
| Client | Select from existing clients. |
| Assigned Vehicle | Optional — carried onto every generated job. |
| Frequency | **Weekly**, **Biweekly**, or **Monthly**. |
| First Occurrence | The date of the first job in the series. |
| End Date | Optional — leave blank for an open-ended series. |
| Notes | Optional — carried onto every generated job. |
| Crew / Equipment | Same as a regular job; carried onto every generated job. |

Creating a template does **not** schedule anything by itself — there is no background scheduler in this app. Click **Generate** on the template's row to create the next batch of up to 4 real jobs from it. Each generated job goes through the same double-booking, repair, and time-off checks as a manually created job; any occurrence that conflicts is skipped and reported (e.g. "Generated 3 jobs; skipped 1 occurrence due to conflicts") rather than silently dropped or blocking the rest of the batch. Click Generate again later to produce the next batch.

Other actions on a recurring job row:

- **Edit** (pencil) — change any field on the template. Does not affect jobs already generated.
- **Pause / Resume** — a paused template can't generate new jobs until resumed. Existing generated jobs are unaffected.
- **Delete** (trash) — removes the template only. Already-generated jobs are kept on the calendar; they're just no longer linked to a template.

Jobs generated from a template show a small **Recurring** tag next to the client name in the jobs table below.

**Job statuses:**

| Status | Meaning |
|---|---|
| Scheduled | Job is planned but not yet started. |
| In Progress | Work has begun on site. |
| Completed | Work is done; inventory has been deducted from the van. |
| Cancelled | Job was cancelled; resources are freed. |

**Job actions available in this tab:**

- **Start** — moves job from Scheduled to In Progress
- **Complete** — moves job to Completed and deducts materials from the assigned van's stock. *This action requires confirmation.* If a job was completed by mistake, use **Re-open**.
- **Re-open** — available on Completed jobs only. Sets the job back to In Progress and **reverses the van inventory deductions** that Complete made, so completing it again later deducts stock exactly once. *Requires confirmation.*
- **Cancel** — cancels the job. *Requires confirmation.*
- **Edit** — opens the Edit Job Details panel to change the client, assigned vehicle, scheduled date, or notes on a job. Available on Scheduled and In Progress jobs only; blocked once a job is Completed or Cancelled. Changing the vehicle or date re-runs the same double-booking and repair checks used when a job is first created — the save is rejected if it would conflict with another job, an active repair, or a technician's time off.
- **Clone** — creates a new draft job pre-filled with the same client, vehicle, crew, and equipment. Useful for recurring service calls.
- **Resources** — opens the Allocate Resources panel to add/edit the crew (assigned technicians), materials, and equipment on a job. At least one technician must remain assigned. Crew and equipment changes are checked for double-booking, time off, and open repairs against the job's date, with the same live warning and server-side rejection as Add/Edit Job. Once a job is Completed its crew is locked — reopen the job if you need to change assignments (materials and equipment can still be edited).
- **Costs** — opens a read-only cost summary showing labor time and material totals for the job.

The jobs list has a **status filter toolbar** so you can view only Scheduled, In Progress, Completed, or Cancelled jobs.

---

## Module 3: Scheduling Engine

A date-filtered calendar view of all scheduled jobs. Use the **date picker** at the top to jump to any date. Each job card shows the client name, assigned crew, vehicle, and current status. This tab is read-only — use the Clients & Jobs tab to make changes.

---

## Module 4: Personnel & Labor Hours

Manages your crew roster and tracks labor time entries.

### Personnel Records

Click **Add Personnel** to create an employee record. Fields:

| Field | Notes |
|---|---|
| First Name / Last Name | Required. |
| Role | Either **Technician** or **Dispatcher**. |
| Certifications | Free-text field for any credentials or licenses. |

Click the edit icon next to any person to update their record. The edit form also manages:
- **Qualifications** — structured credential tracking with issuing body, category, and expiry date
- **Time Off** — log vacation, sick days, or other absences with date ranges

### Logging Labor Time

Click **Log Time** to record time against a job. Fields:

| Field | Notes |
|---|---|
| Job | Select from active jobs. |
| Technician | Select from the personnel roster. |
| Date | Defaults to today. |
| Hours / Minutes | Enter as separate number fields. |
| Service Type | Options: Field Labor, Installation, Repair, Inspection, Travel |
| Payroll Item | Options: Regular Pay, Overtime Pay |

All time entries start with a QuickBooks sync status of **Pending** and will appear in the next QB labor export.

---

## Module 5: Fleet & Service

Manages your vehicles and equipment assets.

### Vehicle Records

Click **Add Vehicle**. Fields:

| Field | Notes |
|---|---|
| VIN | Must be unique. |
| Make / Model | e.g., Ford / Transit |
| Status | Active, In Maintenance, or Retired |

**Maintenance Logs:** Click the wrench icon next to a vehicle to log a maintenance event. Fields include date, odometer reading, cost, and a description. Logs are cumulative and viewable in the vehicle's history.

**Reporting Repairs:** Click **Report Repair** on any vehicle or equipment asset to open a repair ticket. Fields include repair type, location, service provider, phone, ticket number, and notes. The asset status is automatically changed to **In Maintenance**. When the repair is resolved, click **Mark Resolved** (requires confirmation) to return the asset to Active status.

### Equipment Records

Click **Add Equipment** to register a tool or piece of equipment. Fields: name, serial number, and status (Active, In Use, Maintenance). Equipment can be assigned to jobs and tracked through the same repair reporting system as vehicles.

---

## Module 6: Inventory Control

Tracks your product catalog and physical stock levels by location (warehouse and individual vans).

### Inventory Items (Product Catalog)

Click **Add Item** to create a catalog entry. Fields:

| Field | Notes |
|---|---|
| Name | The item name as it will appear in QuickBooks. |
| Category | Top-level QB category (e.g., "Parts", "Materials") |
| Sub-Category | Second-level QB category (e.g., "Electrical", "Plumbing") |
| Default Rate | The billing rate per unit. Auto-fills when this item is added to a job. |

To permanently delete an item from the catalog, click **Delete Item**. Items that have been used on completed jobs (and thus appear on invoice exports) cannot be deleted.

### Stock Levels

Stock locations are created automatically when vehicles are added. The warehouse appears as a separate location.

For each item at each location:
- **Qty** — current quantity on hand
- **Min** — minimum threshold; items below this are flagged as low stock

Click **Adjust Stock** on any item-location row to update the quantity or minimum threshold. Use this to record restocking, manual counts, or corrections.

Click **Remove** (trash icon) to remove an item from a specific location without deleting it from the catalog.

**Important:** When a job is marked Completed, the system automatically deducts the job's material quantities from the assigned van's stock location. You do not need to manually adjust stock after completing a job.

---

## Module 7: QuickBooks Export Sync

This tab is used at the end of your billing cycle to export data into QuickBooks.

### Workflow

Follow these steps in order:

**Step 1 — Export Invoice CSV**
Click **Export Invoices**. This downloads a CSV file containing all completed jobs with a sync status of **Pending**. The file is formatted for direct import into QuickBooks as invoices. Invoice dates use the job's completion date; due dates are calculated from the client's payment terms.

**Step 2 — Export Labor Time CSV**
Click **Export Labor Time**. This downloads a CSV file of all time entries with a sync status of **Pending**, formatted for QuickBooks Time Tracking import.

**Step 3 — Import into QuickBooks**
Import both CSV files into your QuickBooks company file using QuickBooks' standard CSV import tools.

**Step 4 — Lock the Records**
After you have confirmed the import into QuickBooks was successful, click **Lock Sync Records**. This permanently marks all exported invoices and time entries as **Exported**, preventing them from appearing in future exports.

*This lock action requires confirmation and cannot be undone. Only perform it after a successful QuickBooks import.*

### Sync Status Indicators

| Status | Meaning |
|---|---|
| Pending | Data is ready for export but has not been locked yet. |
| Exported | Data has been locked after a completed QB import. Will not appear in future exports. |

The yellow **Unsynced** badge in the top header shows the total count of pending invoices plus pending time entries.

---

## Module 8: Business Analytics (Plus only)

A read-only reporting tab covering the **trailing 12 months**. Numbers are computed live from your operational data — there is nothing to configure.

- **KPI tiles** — total revenue, jobs completed, average job value, and labor hours logged.
- **Revenue by Month** — billed line-item totals on completed jobs, by completion month. Hover a bar to see the month's revenue and job count.
- **Technician Hours** — total logged time per technician.
- **Top Clients by Revenue** — your highest-billing clients.
- **Fleet Maintenance Cost** — logged maintenance spend per month across all vehicles.

**Note on "revenue":** revenue is the sum of quantity × rate on completed jobs' line items. Labor cost is not tracked in WhiteVanOps, so these figures are revenue, not profit.

---

## Module 9: Invoicing & Payments (Plus only)

An internal accounts-receivable ledger with printable PDF invoices and payment tracking. It is **completely independent of the QuickBooks Export Sync tab** (Module 7) — creating an invoice here does not affect a job's QB sync status, and vice versa. Use whichever billing flow (or both) fits your business.

### Creating an invoice

There are two ways to create an invoice:

- **Bill Completed Job** (the primary flow) — pick a **completed job that has not been invoiced yet**; jobs that already have an invoice don't appear in the list. The client is filled in automatically and the line items are prefilled from the job's materials.
- **Create Manual Invoice** — start from a blank invoice for any client, with no job attached.

In both flows you can add or edit line items freely (description, quantity, rate); the issue and due dates default from today and the client's payment terms. Invoice numbers (`INV-0001`, `INV-0002`, ...) are assigned automatically.

### Invoice lifecycle

| Status | Meaning |
|---|---|
| Draft | Just created. Can still be edited or **deleted**. No payments can be recorded yet. |
| Sent | You clicked **Mark Sent** after delivering the invoice to the client. Payments can now be recorded. |
| Partially Paid | One or more payments recorded, but a balance remains. |
| Paid | Payments cover the full total. |
| Void | Cancelled invoice, kept for the record. Only invoices with no payments can be voided; issued invoices can never be deleted — void them instead. |

`Partially Paid` and `Paid` are set automatically from recorded payments — you never set them by hand.

### Recording payments

Click **Payment** on a Sent or Partially Paid invoice. Enter the amount (defaults to the outstanding balance), method (Check, Cash, Card, ACH, Other), an optional reference (check number / transaction ID), and the received date. A payment larger than the outstanding balance is rejected.

### PDF invoices

Click **PDF** on any invoice row to open a printable PDF (letterhead, line items, totals, payments, and balance due) in a new tab. Print it or save it to send to the client.

### AR summary

The tiles at the top show total **Outstanding AR** (unpaid balances across Sent/Partially Paid invoices), the count of **overdue invoices** (past their due date), and total **collected** payments.

---

## Settings: License & Plan

Open **Settings** in the sidebar. The **License & Plan** section shows the current plan (Base or Plus).

Upgrading to Plus requires superuser access and a cryptographically signed license payload from your vendor:
1. **Locate your License Key:** If your plan is currently Base, copy the active **License Key** shown in the Settings tab.
2. **Obtain Upgrade Payload:** Send this key to your vendor to request a Plus Upgrade. They will provide a signed upgrade JSON payload.
3. **Apply the Upgrade:** Paste the JSON block into the "Paste License Code" box, or upload the JSON file in the upload zone, and click **Apply Plus Upgrade**. Plus features will unlock instantly.
4. **Downgrading:** A superuser can downgrade to the Base plan by clicking the **Downgrade to Base Plan** button and confirming. This removes Plus features but retains your data in the database.

---

## Settings: Onboarding Data Import (superuser only)

The **Onboarding Data Import** section at the bottom of Settings imports a business's existing spreadsheets (clients, jobs, inventory, etc.) directly from the browser — the same engine as the command-line import described in the Setup & Installation manual §14, without needing terminal access.

1. **Choose Files** — select one or more `.csv` or `.xlsx` files, then click **Analyze & Map**. The app inspects the files and proposes, for each file (or Excel sheet), which WhiteVanOps table it maps to and which column feeds which field.
2. **Review the mapping** — expand each file card to correct the target entity, re-map or skip columns, and fill in **defaults** for any required fields your spreadsheet doesn't cover. If the analyzer found text categories it doesn't recognize (e.g. a status column with custom wording), a **Value Mapping** panel lets you translate each source value to an allowed one.
3. **Dry Run (Validate)** — checks everything without writing to the database and shows a per-entity summary of planned, rejected, and skipped rows, with the reason for every rejection. Fix the mapping and re-validate until it passes.
4. **Commit Import** — writes the data (requires confirmation). Two checkboxes control the run:
   - **Wipe Transactional DB First** — clears existing operational data before importing. *Destructive — intended for a fresh install or a re-run of a failed onboarding, never a live database.*
   - **Skip Rejected Rows** — imports the valid rows and leaves the rejected ones out, instead of refusing the whole run.

---

## Routine Operational Checklist

**Daily:**
- [ ] Check the Overview tab for active jobs and crew assignments
- [ ] Verify any jobs expected to complete today are moved to the correct status
- [ ] Review inventory low-stock alerts

**After each billing cycle:**
- [ ] Export Invoice CSV
- [ ] Export Labor Time CSV
- [ ] Import both into QuickBooks
- [ ] Lock Sync Records

**As needed:**
- [ ] Log maintenance events after vehicle service appointments
- [ ] Resolve open repair tickets when assets return to service
- [ ] Restock inventory and adjust stock levels after warehouse restocking

---

## Common Questions

**Can I edit a job after it's Completed?**
You can still view a completed job and its cost summary. The status cannot be changed back to In Progress. If an error was made, contact the system administrator to make a direct database correction.

**What happens to inventory when I complete a job?**
The system deducts the quantities from the job's line items from the assigned van's stock location automatically. Review the Inventory tab if stock levels look incorrect after completion.

**Can two technicians be assigned to the same job?**
Yes. When creating or editing a job, select multiple names from the crew checklist.

**What if a job has no line items?**
The invoice export will include one generic placeholder line ("Operations:Service:General Job") for that job so the invoice is not empty in QuickBooks.

**Can I export only some records, not all pending ones?**
No. The current export includes all pending records at once. Lock records only after a full successful import.

**Do Plus invoices replace the QuickBooks export?**
No. The Invoicing tab (Plus) is an internal AR ledger with its own PDF invoices and payment tracking; the QuickBooks Export Sync tab is unchanged and works exactly as before. They do not affect each other.

**What happens to my notes and invoices if the Plus license lapses?**
Nothing is deleted. The Plus tabs disappear and the Plus features are blocked, but all notes, follow-ups, invoices, and payments remain in the database and reappear when Plus is re-activated.

---

*End of Administrator Reference Manual*
