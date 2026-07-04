# WhiteVanOps Marketing Site

A single self-contained static page (`index.html`) — no build step, no dependencies beyond Google Fonts. Host it anywhere: Netlify/Vercel drag-and-drop, GitHub Pages, an S3 bucket, or any web server.

**Preview locally:** `npx serve marketing -l 4173` (also wired into `.claude/launch.json` as the `marketing` config).

**Live deployment:** GitHub Pages at <https://rsm1274-art.github.io/WhiteVanOps/>, served from the `main` branch of [rsm1274-art/WhiteVanOps](https://github.com/rsm1274-art/WhiteVanOps). This `marketing/` folder is itself the git checkout of that repo — to publish changes, commit here and `git push` (credentials are handled by Git Credential Manager).

## Placeholders to fill in before going live

Search `index.html` for `[` — every bracketed value is a placeholder:

| Placeholder | Where |
|---|---|
| `[sales@yourcompany.com]`, `[+1 (555) 000-0000]`, `[Mon–Fri, 8am–6pm CT]`, `[Street Address · City, ST]` | Contact section |
| `[Your Company Name]`, `[Privacy Policy]`, `[Terms]` | Footer |
| Demo form backend | `#contact-form` submit handler shows a notice instead of sending — wire it to your CRM/email service |

## What's on the page

- **Hero** with animated stat counters and a live-look dashboard mockup
- **Data ownership section** (the core pitch): bundled PostgreSQL, no cloud dependency, no lock-in, per-install secrets — with a "server status card" visual showing `Outbound data to vendor cloud: 0 bytes`
- **Interactive demo**: a clickable Clients & Jobs ledger (click rows to cycle status), Inventory and Accounting tabs, and a phone-frame Field Module demo whose job cards stay in sync with the dashboard table (Start / Log Time / Complete with toasts)
- **How it works** (installer → QR → dispatch), **pricing** (one-time purchase framing), **contact** with demo-request form

Branding matches the app: light-first "spec sheet" aesthetic — warm stone/paper palette with near-black ink, engineering-blue `#1d4ed8` accent, 2px squared corners with hairline borders, Barlow Condensed headings / IBM Plex Sans body / IBM Plex Mono data, mono `SEC. 0x` section labels with crosshair ticks, inline stroke SVG icons, and the inline SVG logo from `public/logo.svg`. Dark is reserved for the data-ownership band, the phone-frame field demo, and the footer.
