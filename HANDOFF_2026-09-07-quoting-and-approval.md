# Handoff — 2026-09-07: Quoting and customer approval

## Why this session happened

The owner asked for a competitive analysis of WhiteVanOps against the FSM field
(Jobber, Housecall Pro, Markate, Tradify, FieldPulse, Joist, ServiceTitan). The finding
that mattered: the back office is genuinely deeper than Jobber's or Housecall Pro's
(real inventory with stock locations and van deduction, fleet, equipment, personnel
qualifications, job costing), but **the front half of the money loop did not exist.**
Every competitor sells quote → approve → job → invoice. We started at invoice.

Two options were put to the owner:

- **A** — build quoting plus a customer-approval link.
- **B** — stop chasing Jobber and reposition on ops depth + no subscription.

The owner chose **A first**, and explicitly deferred B: *"we'll discuss what we need to
do to achieve B later."* **B is the next conversation, not a coding task.**

## Two decisions the owner made, which the code now assumes

1. **Quoting is Plus-only**, sitting beside Invoicing. Quote → invoice conversion
   therefore never crosses the tier line. Base gets nothing.
2. **Both approval paths ship**: a "Mark Accepted / Declined" button in the dashboard
   for decisions given by phone, *and* a tokenised public link the customer opens
   themselves. Base has no route to the outside world, so the link is only genuinely
   useful on Plus (where the tunnel lives) — the code does not special-case this, it
   just borrows the Field Access address.

## What shipped

**Data** — `Quote` + `QuoteLineItem` in `prisma/schema.prisma`, with back-relations on
`Client`, `Job` and `Invoice`. Statuses: Draft → Sent → Approved/Declined → Converted,
plus Expired.

**Pure logic** — `src/lib/quote.ts` (25 unit tests across it and `quoteToken.ts`, all
green). Three invariants worth not breaking, also recorded in `CLAUDE.md`:

- *Expired is derived, never stored.* `deriveQuoteStatus()` only ever promotes a `Sent`
  quote; a decision already taken must not be rewritten by the clock. Don't add a cron
  that writes `status = "Expired"`.
- *`canRespondToQuote()` is the single accept gate*, used by both the customer's public
  POST and the operator's manual button, so the two cannot drift.
- *`Quote.convertedInvoiceId` is `@unique`* and written in the same transaction as the
  invoice, so a double-click can't raise two invoices from one quote.

**Routes** — `POST /api/quotes`, `PUT`/`DELETE /api/quotes/[id]`,
`POST /api/quotes/[id]/send` (mints the token), `POST /api/quotes/[id]/convert`,
`GET /api/quotes/[id]/pdf`. All `requireRole` + `requirePlus`, matching the invoice
routes exactly.

**The public surface** — `GET`/`POST /api/public/quotes/[token]` and the `/quote/[token]`
page. This is the **first and only unauthenticated data route in the app**, so it got
the most care: whitelist response (`publicQuoteView`), uniform 404 on every failure,
rate limits on both read and write falling back to a per-token bucket rather than a
shared constant, no token in logs or `AuditLog`, `Cache-Control: no-store`. Both
middleware entries use a trailing separator (`"/quote/"`) because `PUBLIC_PATHS` is
matched with `startsWith` and a bare `"/quote"` would also open a future `/quotes` page.

**UI** — `QuotesTab.tsx` (pipeline tiles: awaiting response, value out for approval, win
rate) and `AddQuoteModal.tsx`, wired into `src/app/page.tsx` as a Plus-gated tab.

**Shared PDF helper** — `src/lib/pdfDoc.ts`. The quote PDF would otherwise have been a
165-line copy of the invoice PDF, so the page setup, palette and the `text`/`hr`
primitives were extracted and **both** routes now use them. Every layout coordinate in
the invoice PDF was left byte-identical.

## Two things to know before you touch this

- **`src/lib/quote.ts` must stay free of Node built-ins.** `QuotesTab.tsx` is a client
  component that imports it. Token minting was deliberately split into the server-only
  `src/lib/quoteToken.ts` for exactly this reason — a bare `crypto` import in `quote.ts`
  breaks the browser bundle.
- **The customer link comes from the `field_access_url` SystemSetting**, not from the
  request origin. The dashboard is normally opened on `localhost`, which is useless in a
  customer email. If no Field Access address is saved, links point at the office PC and
  work for nobody else.

## A second Claude session was running in this working tree at the same time

Worth knowing, because it explains a build failure that looked like stale breakage and
was not. Timeline from the reflog:

| Time | What |
|---|---|
| 15:41:42 | This session forks `feat/quoting-and-approval` from `202a57d` (= `main`) |
| ~15:41–15:51 | The other session creates `storefront/` on disk — a whole second Next.js app |
| 16:03:25 | The other session commits `630a55a` **onto this branch's HEAD**, then at 16:04:30 resets it away and lands it on `feat/purchase-download-flow` |
| 16:08:10 | This session commits the quoting work |

**Nothing crossed over.** `630a55a` contains only `.gitignore`,
`scripts/license-manager.js`, `shared/license-mint.js` and `storefront/**` — none of the
quoting files, and none of the shared files this branch edits (`tsconfig.json`,
`src/types.ts`, `src/middleware.ts`, `src/app/page.tsx`, `src/app/api/dashboard/route.ts`,
`prisma/schema.prisma`, `CLAUDE.md`). This branch forked from `main` and does **not**
contain `630a55a`, so the two lines of work are independent. Verified after the other
session finished: `tsc` clean, 312 tests pass, working tree shows no changes to any file
this branch owns.

### The one real consequence: the tsconfig fix

`storefront/` appearing on disk mid-session broke `npm run build` here. The root
`tsconfig.json` globs `**/*.ts`, which swallowed that separate app — it has its own
`tsconfig.json` and its own `@/*` → `./src/*` alias — and resolved its `@/lib/stripe`
etc. against **this** project's `src/`, where those modules don't exist. Added
`"storefront"` to the root `exclude`, the same pattern already documented for
`dist-electron`. Build is green.

**`feat/purchase-download-flow` still has this bug.** That branch introduced
`storefront/` but did not touch the root `tsconfig.json`, so `npm run build` fails there
today. The fix lives only here. **Whoever merges these two branches must keep the
`"storefront"` exclude** — if it is dropped in a conflict resolution, the whole app stops
building.

## NOT DONE — read this before assuming the feature works

1. **The migration has never been applied.** PostgreSQL on 5433 was not running this
   session, so `prisma migrate dev` failed with P1001. The migration SQL was generated
   offline (`prisma migrate diff`) and committed at
   `prisma/migrations/20260907204516_add_quoting/migration.sql`, and `prisma generate`
   ran so the types are correct — but **no database has this table yet.** Start the DB
   and run `npx prisma migrate dev` (it should apply cleanly and report no drift; if it
   reports drift, that is the thing to investigate, not to `--force`).
2. **Nothing has been exercised against a real database or in a browser.** Verified:
   `npx tsc --noEmit` clean, `npx eslint` clean, 312 unit tests pass, `npm run build`
   succeeds and registers every new route. Not verified: creating a quote, sending one,
   opening the public page, accepting it, converting to an invoice, or that either PDF
   still renders correctly. **The invoice PDF refactor in particular has had no visual
   check** — it is a customer-facing financial document and deserves one.
3. **No route-level tests.** Only the pure modules are covered. The public route's
   whitelist and rate limiting are the highest-value untested code in this change.
4. **No email.** "Send" mints the link and copies it to the clipboard; a human still
   pastes it into their own email or text. Actually sending mail is a separate feature.
5. **A quote cannot be edited once sent** — only its expiry date can be extended, and
   only Drafts can be deleted. That was deliberate (a sent quote is a record of what was
   offered), but if the owner wants revisions, "supersede with a new quote" is the
   pattern to build, not in-place editing.

## Why `git status` looks dirty on this branch

`git status` here shows `M .gitignore`, `M scripts/license-manager.js`, `?? shared/` and
`?? storefront/`. **That is not uncommitted work.** All four are committed in `630a55a`
on `feat/purchase-download-flow` (and pushed to `origin`). They only read as dirty from
this branch because this branch forked from `main`, before that commit existed, while
the files themselves sit in the shared working tree.

Leave them alone. This session's commit deliberately excludes all of them, and nothing
here needs them.

## Next session should

Have the **option B** conversation the owner deferred: repositioning away from competing
with Jobber on features and toward "mid-market ops depth, bought once." That is a
marketing and pricing discussion first — `marketing/index.html` is a separate checkout on
the `marketing` branch (see the 2026-09-06 handoff for how to push it).

Before that, though, someone needs to run the migration and actually click through the
quote flow once. Items 1 and 2 above are the blocking ones.
