# Handoff — 2026-09-12: linked Invoicing to Analytics and QuickBooks sync

## Where this picks up

Read `HANDOFF_2026-09-12-time-logging-and-report-builder-bugs.md` first — this is the same
day's follow-on session. The owner reported a third issue: two invoices created and marked
Paid showed up in neither the Analytics tab's revenue nor the QuickBooks Sync tab's "settled"
state — the underlying job kept showing as open/pending in QB sync.

## This was not a bug — it was two intentionally separate systems

Confirmed by reading the schema and code, not assumed:

- **Analytics** (`src/app/api/analytics/route.ts`) computed revenue purely from
  `Job.lineItems` on `Completed` jobs. It never touched `Invoice`/`Payment` at all — the
  code comment said so explicitly ("Revenue = sum of JobLineItem... not profitability").
- **QuickBooks Sync** (Accounting tab) is driven entirely by `Job.qbInvoiceSyncStatus`, a
  field on `Job` totally unrelated to the `Invoice`/`Payment` model. The schema has an
  explicit comment: the internal invoicing ledger is "*independent of the QuickBooks CSV
  export flow — additive, not a replacement*." Recording a payment on an Invoice never
  wrote to `Job.qbInvoiceSyncStatus` — verified by grepping every invoice route.

So both symptoms were the two systems behaving exactly as originally designed — they just
share the word "invoice" in the UI, which is what made it look broken. Asked the owner
directly (via `AskUserQuestion`) whether they wanted these linked. They said yes to both:

1. Paid invoices should count toward Analytics revenue.
2. Paying off an invoice tied to a job should flip that job's QB sync status.

## Changes made

**`src/app/api/analytics/route.ts`** — revenue logic rewritten:
- A completed job that has **never** been invoiced still counts its line-item value
  (quantity × rate), bucketed by `completionDate` — unchanged, original behavior, still the
  only figure available for jobs run outside the invoicing feature.
- A job that **has** at least one `Invoice` (`invoicedJobIds` set, built from
  `invoice.jobId`) is excluded from that line-item estimate — no double counting.
- Every `Payment` across every invoice (job-linked or standalone) instead contributes its
  `amount` to revenue, bucketed by `payment.receivedDate` — this is real cash collected,
  not billed value.
- `jobsByMonthMap` (the "jobs completed" series/count) is now computed in its own pass over
  *all* completed jobs regardless of invoice status, so that count doesn't drop just because
  a job got invoiced.
- `topClients` now aggregates both non-invoiced job revenue and payment revenue by client.

**`src/app/api/invoices/[id]/payments/route.ts`** — when recording a payment causes
`deriveInvoiceStatus()` to return `"Paid"` and the invoice has a `jobId`, the same
transaction now also sets that job's `qbInvoiceSyncStatus` to `"Exported"`. A
`PartiallyPaid` result leaves the job untouched. Added an `audit()` call for the job update.
There's no payment-deletion route in this codebase, so there's no reversal path to handle
(a fully-paid invoice can't currently un-pay itself).

**`MANUAL_Administrator.md`** — updated Module 8 (Business Analytics) and Module 10
(Invoicing & Payments) plus the FAQ to describe the new linkage; removed the now-inaccurate
"completely independent" / "do not affect each other" language.

## Verified live, not just by reading code

Same throwaway-PostgreSQL approach as the previous session (migrated + seeded), but this
time went further: actually **started the Next.js dev server** and drove the real HTTP API
end to end as an authenticated superuser —

1. Logged in via `POST /api/auth/login`.
2. Baseline `GET /api/analytics`: `totalRevenue: 238.49`, `jobsCompleted: 1`.
3. Created a new `Completed` job with **zero line items** directly via Prisma (so any
   revenue for it could only come from an invoice, never a line-item fallback).
4. Re-checked analytics: `jobsCompleted` went to 2, `totalRevenue` stayed at 238.49 (job
   correctly contributes $0 on its own since it has no line items yet).
5. Created a real `Invoice` for that job via `POST /api/invoices` (a $500 line item), then
   `PUT` it to `Sent`.
6. Recorded a full $500 payment via `POST /api/invoices/{id}/payments` — response showed
   `status: "Paid"`.
7. Re-checked analytics: `totalRevenue` jumped to exactly `738.49` (+$500), `topClients`
   showed the $500 attributed to the right client, `jobsCompleted` unchanged at 2 (no double
   count).
8. Queried the job directly: `qbInvoiceSyncStatus` had flipped from `"Pending"` to
   `"Exported"`.
9. Confirmed `GET /api/dashboard` (what the Accounting tab actually reads) reflects the same
   `"Exported"` status, so the job is confirmed to drop off the "Pending Invoice Lines" list
   in the real UI, not just in the DB.

Cleaned up afterward: killed the dev server, stopped and deleted the throwaway Postgres
instance, removed `.env`/`.env.local`, uninstalled the temporarily-added `tsx` dependency.

## Testing

`npx tsc --noEmit` clean, `npm test` 563/563 passing (no existing analytics or payments
route tests to update — matches the repo's no-route-tests convention).

## Not done / still open

- No automated test coverage was added for the new analytics revenue logic or the
  invoice→job sync link, since this repo's convention is pure-logic tests only and both
  changes live in route handlers (which have zero existing test coverage repo-wide). If the
  owner wants regression protection here, the revenue-attribution logic in
  `analytics/route.ts` could be extracted into a pure, testable function the way
  `src/lib/invoice.ts` already does for invoice math — flagging as a possible follow-up, not
  done speculatively this session.
- Didn't address `avgJobValue` (`totalRevenue / completedJobs.length`) potentially being
  skewed when a chunk of `totalRevenue` now comes from standalone (job-less) invoices not
  reflected in the job count — this was a pre-existing metric definition, not something the
  owner raised, and changing its meaning wasn't part of what was asked.
- Did not re-verify in the owner's actual installed app / real browser UI — verified at the
  live-HTTP-API level against a real (throwaway) database, which exercises the exact same
  route code the packaged app runs, but the owner should still glance at the Analytics and
  Accounting tabs after their next invoice payment to confirm the numbers look right end to
  end.

## Next session should

1. If the owner reports the numbers still look wrong, check first whether they're looking
   at a job that predates this fix (session data won't retroactively recalculate anything
   beyond what's already correct going forward — there's no stored "revenue" value, it's
   computed live, so this should just work for existing paid invoices too, but worth
   confirming with real data).
2. Consider the still-open item from the 2026-09-12 report-builder handoff and earlier
   09-09 report-builder handoff: neither has changed here.
3. Consider whether `avgJobValue`'s definition needs revisiting now that revenue includes
   invoices with no job at all.
