import { NextResponse } from "next/server";

// Unauthenticated identity probe. electron/main.js calls this before reusing a
// server already listening on port 3000: if another product (e.g. a Docker
// container publishing 3000) holds the port, the shell must boot its own
// server on a different port instead of loading the foreign app in the window.
// Must stay in PUBLIC_PATHS in src/middleware.ts — a redirect-to-login response
// is indistinguishable from a foreign server to the probe. Returns no data
// beyond the app identity, so it is safe to expose without a session.
export async function GET() {
  return NextResponse.json({ app: "whitevanops", ok: true });
}
