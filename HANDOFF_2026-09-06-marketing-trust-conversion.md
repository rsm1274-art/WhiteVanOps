# Handoff — 2026-09-06 — Marketing site trust & conversion pass

Repo: `marketing/` — its own clone of `rsm1274-art/WhiteVanOps`, publishing to the **`marketing`**
branch (see the branch warning in "Repo notes" — read it before any push).
Single deliverable: `index.html` — one self-contained file, no build step, served by GitHub Pages
from the `marketing` branch at https://rsm1274-art.github.io/WhiteVanOps/.

## Goal of this session

Audit the marketing site for **trust and sales conversion**, then fix the trust holes.
The audit found 11 issues; this session shipped the "stop the bleeding" subset.

## What shipped

### 1. Company identity — was placeholder text

- Footer read `© 2026 [Your Company Name]` with dead `[Privacy Policy]` / `[Terms]` links.
  Now: **Quality Pipeline Inspectors LLC · Millington, Tennessee**, clickable
  `info@qpi-inspect.com`, and a true statement that the site sets no cookies and runs no analytics.
- Contact section (Sec. 08) gained a details box: Email / Company / Based in / Reply time
  ("Within 1 business day").

### 2. Demo form — was a dead end

- The form previously showed the visitor: *"This demo form isn't wired to a backend yet —
  [connect to your CRM or email service here]"*. Every lead was lost.
- Now the submit handler composes a `mailto:info@qpi-inspect.com` with name, work email,
  fleet size and "what are you running on today" pre-filled, and opens the visitor's own mail app.
- **Deliberate choice:** no backend keeps the site consistent with the product's own promise
  (nothing stored on a server). Trade-off logged under "Still open" below.

### 3. 30-day trial — existed in the build system, was absent from the site

`npm run electron:build:trial` has always produced `WhiteVanOps-Base-Trial-Setup.exe`, but the
website never mentioned it. It is the single strongest risk-remover for a $1,000 one-time purchase.
Surfaced in four places — the first pass was too subtle and the owner asked for it to be louder:

- **Nav button** — was "Book a Demo", now green **"Free 30-Day Trial"**. Pinned to the top of the
  viewport, so the offer follows the reader down the whole page.
- **Badge above the H1** — green, pulsing dot, "Free 30-day trial — the complete app, on your own PC".
- **Hero primary CTA** — was "Try the Demo" (blue), now **"Start the Free 30-Day Trial"** (green).
  "Try the Demo" demoted to the ghost button. The old "Why Self-Hosted?" button was removed from
  the hero (two buttons beat three); that link still exists in the nav as "Data Ownership".
- **Supporting line** — "No card. No account. No sales call required."

Green (`--emerald`) is used nowhere else on the page, so it reads as the one call to action.

### 4. Pricing wording

- Base bullet `1 year of updates` read as "the software expires". Now:
  **"Yours to keep forever — updates included for the first year."** Same fact, no false alarm.
- Tier note gained a trial paragraph plus a 14-day refund line **scoped to buyers who skip the
  trial**. The owner correctly pushed back on a general money-back guarantee: the trial is free, so
  there is nothing to refund for trial users. The trial *is* the guarantee.

### 5. New Sec. 06 — "Who built this"

Placed between Pricing and FAQ on purpose: the reader has just seen the price, and this answers
"who am I giving $1,000 to?". Content is the owner's own framing:

- A working service team — HVAC, plumbing, **CCTV pipeline inspection**.
- Built to fix three failures of the tools they were sold: renewal price climbs, job history on
  someone else's server, products that change or vanish without asking.
- Three rules as numbered cards: **Stable / Secure / Affordable over time**.
- Closing line: *"We still use it. That is the only reason to trust any of the above."*

This section also silently resolves a credibility problem: it explains why a company named
*Quality Pipeline Inspectors LLC* sells fleet software.

### 6. New Sec. 07 — FAQ (9 questions)

Objection handling, written from the product docs. Notable entries:

- **"What if you go out of business?"** — nothing stops working; the licence is checked once at
  activation and offline after; data is standard PostgreSQL 17 with CSV export.
- **"Isn't the Plus tunnel the cloud you said you avoid?"** — answered honestly rather than
  dodged. Base uses no outside service at all; Plus's tunnel is an encrypted pipe, not a database.
  A sharp buyer would otherwise spot the contradiction and distrust the rest of the page.
- Also: PC dies (nightly mirror backups), Windows-only, offline field work, IT requirements
  (fixed IP + firewall port, or the $500 White Glove add-on), what you pay, user/vehicle limits,
  data export.

Sections renumbered: Who built this = 06, FAQ = 07, Contact = 08.

## Still open — pick up here

### Closed at the end of this session — do not reopen

- **Sec. 06 founder story and Sec. 07 FAQ wording: reviewed and approved by the owner** on the
  live site. The narrative details ("chasing the parts", "prices climbed every renewal") and the
  business promises in *"What if you go out of business?"* and *"Do I need an IT person?"* are
  confirmed accurate. No further fact-check needed.
- **The page renders correctly.** The owner viewed the deployed site and approved. Note for the
  next session: the Claude-in-Chrome extension would not connect at any point during this session
  (`Browser extension is not connected`, repeated attempts), so Claude never saw the page itself.
  Claude-side verification was structural only — tag balance (334 `<div>`, 8 `<section>`,
  1 `<form>`, 9 `<details>`, all matched) plus a `curl` string check. If visual checking is needed
  again, either fix the extension or ask the owner to look.
  To serve locally: `npx --yes http-server -p 8899 -c-1`, then `http://localhost:8899/index.html`.
  The Python at `~/AppData/Local/hermes/hermes-agent/venv` is broken (`PYTHONHOME` polluted →
  `No module named 'encodings'`), so `python -m http.server` fails. Use the node server.

### Known trade-offs to revisit

1. **The form loses roughly 1 in 5 leads.** The `mailto:` approach opens the visitor's mail app and
   some people never press send. If lead volume matters more than the no-backend purity: sign up at
   formspree.io (free tier), point the form at `https://formspree.io/f/<ID>`, and drop the JS
   submit handler. The owner has not decided.
2. **No `og:image`.** Link previews in texts, LinkedIn and Slack show a blank grey box. Needs a
   1200×630 image (dashboard screenshot + logo) in this folder plus one `<meta>` tag. Explained to
   the owner and deprioritised — not rejected.

### From the original audit, not yet done

1. **No purchase path.** Buttons say "Contact Sales" / "Go Plus" but there is no way to actually
   buy. Either add one, or state plainly "email us and we invoice you".
2. **No customer proof.** No testimonial, no case study, no logo, no real product screenshot.
   Sec. 06 partially covers this ("we use it ourselves"), but a real customer quote is stronger.
   Blocked on having a reference customer.
3. **Hero stat counters all animate to 0** — "0 monthly cloud fees" and so on. Cute, but weak as
   the first number a visitor sees. Consider replacing with something concrete.
4. **A nav link to Sec. 06 was deliberately declined by the owner. Do not add one.**

## Repo notes

### ⚠ Branch trap — read before pushing

This clone's local branch is **named `main`, but it is not the app's `main`.** The repo holds two
branches with **no common ancestor**:

| Branch | Contents | Root files |
|---|---|---|
| `main` | the Electron/Next.js **application** | `src/`, `package.json`, `electron/` |
| `marketing` | this **website** | `index.html` |

GitHub Pages serves `marketing` (`source.branch = "marketing"`, path `/`), confirmed via
`gh api repos/rsm1274-art/WhiteVanOps/pages`.

This session's first `git push` was rejected as "behind 126 commits". **That rejection was
protective.** The local branch was tracking `origin/main`, so a forced push would have replaced the
entire application repo with this one HTML file. `git merge-base HEAD origin/main` returns empty —
the histories are unrelated, so **never merge or rebase these two branches.**

Fixed this session: the local branch now tracks `origin/marketing`, so a plain `git push` goes to
the right place. If that tracking is ever lost, push explicitly with
`git push origin HEAD:marketing` — and never resolve a rejected push here with `--force`.

### Other

- `.Rhistory` (empty, stray) is untracked and was intentionally left uncommitted. Consider
  `.gitignore` if it keeps reappearing.
- `AlternateWebsites/option-a-ledger.html` is an unused design variant, untouched this session.
- No build, no tests, no CI on this repo. `index.html` is the whole product.
