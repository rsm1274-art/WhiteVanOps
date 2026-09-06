# Handoff — 2026-09-06: Logo rebrand

## What shipped

The owner supplied a new logo (`WVO_Logo.png`, dropped at the project root) and asked
for it to replace the old hand-drawn placeholder everywhere, excluding the wordmark
text anywhere it would render too small to read.

1. **Cropped the source art into two masters**, both now at `scripts/assets/`:
   - `logo-icon.png` — van artwork only, square, transparent background. This is the
     new brand master used everywhere the app or site shows a logo.
   - `logo-full.png` — the original artwork (van + "WHITEVANOPS" + "FIELD OPERATIONS
     MANAGEMENT" tagline), kept for any future large-format use. Every current
     placement (sidebar, login, PWA icons, splash screen, marketing nav/footer) is
     icon-sized, so the wordmark is unused today.
   - `logo-icon-dark.png` — an inverted (white-on-dark) variant of the icon, for the
     marketing site's near-black footer.
2. **Retired `public/logo.svg`** (the old hand-drawn badge). `scripts/generate-icons.js`
   now renders `public/logo.png`, the PWA icons, `apple-touch-icon.png`, and
   `src/app/favicon.ico` directly from `scripts/assets/logo-icon.png` instead of
   parsing an SVG. Removed `/logo.svg` from `src/middleware.ts`'s `PUBLIC_PATHS` since
   the route no longer exists.
3. **Regenerated every raster icon** the app ships (`public/logo.png`,
   `public/icons/icon-192.png`, `icon-512.png`, `public/apple-touch-icon.png`,
   `src/app/favicon.ico`) via `node scripts/generate-icons.js`.
4. **`electron/loading.html`** (the Electron splash screen) had the old logo drawn
   inline as hand-coded SVG — replaced with an embedded base64 `<img>` of
   `logo-icon.png`, since this file has no build step to reference a path.
5. **Marketing site** (`marketing/index.html` — a separate git checkout, pushed to the
   `marketing` branch, not `main`; see below):
   - Swapped the same inline hand-coded SVG badge for a base64 `<img>` of the new logo.
   - Enlarged the header logo from 36px to 60px per owner feedback ("too small in real
     viewing situations").
   - Added the logo to the footer too (it previously had text only), using the
     white-on-dark `logo-icon-dark.png` variant since the footer background is
     `--zinc-900` (near-black) — sized to match the header, also 60px, per a follow-up
     owner request.
   - Bumped `.nav-inner` height from 64px to 88px to fit the larger header logo (the
     hero section already has 150px of top padding, so there's no overlap risk).
6. Updated `CLAUDE.md`'s brand-asset section to describe the new master file location
   and the base64-embedding approach for the two static HTML files.

## Repo structure note (if this surprises you)

`marketing/` is **its own independent git checkout** of the same GitHub repo
(`rsm1274-art/WhiteVanOps`), gitignored from the app's `main` branch. Its local `main`
branch tracks the remote `marketing` branch (GitHub Pages serves from there), not the
app's `main`. Editing something under `marketing/` needs its own `git add` / `commit`
/ `push origin main:marketing` from inside that directory — it will not show up in
`git status` from the app repo root, and pushing the app repo's `main` does not touch
it.

## Current state

- App-repo changes committed and pushed to `origin/main`.
- Marketing-repo changes committed and pushed to `origin/marketing` (two commits: the
  initial swap + enlarge, then a follow-up to match the footer logo size to the header).
- Verified in the browser preview: login page, dashboard sidebar (via redirect), and
  the marketing site's header render the new logo correctly at the new size. The
  footer logo was verified programmatically (DOM query confirmed the correct image,
  60x60px, visible) rather than by a clean screenshot — the preview pane's scroll
  behavior on that page was unreliable during this session (smooth-scroll / reveal
  animations didn't settle cleanly when jumping straight to the bottom). Worth an
  actual look in a real browser next time the marketing site is open.
- The original `WVO_Logo.png` the owner dropped at the project root has been moved
  into `scripts/assets/logo-full.png` (its full-resolution, uncropped form) — it is
  no longer sitting loose at the repo root.

## Not yet done / open items

- Nobody has looked at the new icons in a real, unsandboxed browser tab yet (only the
  in-app preview pane) — worth a quick glance at the favicon, PWA install icon, and
  the marketing footer on an actual phone/desktop browser next time either is touched.
- The Electron desktop app's taskbar/window icon uses the same regenerated
  `src/app/favicon.ico` — worth confirming it looks right the next time an installer
  is built (`npm run electron:build`), since that wasn't rebuilt this session.

## Next session should

No specific follow-up requested — this was a self-contained visual change. Pick up
wherever the owner redirects.
