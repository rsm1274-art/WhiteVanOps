import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  // Identity probe for electron/main.js's reuse-or-boot port check — must
  // answer 200 without a session or the probe can't tell this server from a
  // foreign app squatting on port 3000 (see src/app/api/health/route.ts)
  "/api/health",
  // Brand assets + PWA install files must load without a session
  "/logo.png",
  "/icons",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
];
const CHANGE_PASSWORD_PATHS = ["/change-password", "/api/auth/change-password"];
// A trial-locked session may reach only the lockout page and the unlock API.
// The unlock handler lives on POST /api/license ({ action: "unlock-trial" }),
// so that path must be allowlisted or the unlock POST would itself be redirected
// to /trial-expired and could never succeed. Safe: trialLocked is recomputed at
// login from trial-unlock.json (not the License tier row), so reaching the
// role- and signature-gated license API cannot bypass the lock.
const TRIAL_EXPIRED_PATHS = ["/trial-expired", "/api/license"];

// Routes a tech role may access
const TECH_ALLOWED_PREFIXES = ["/field", "/api/field", "/api/time", "/api/auth", "/api/jobs"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Cookie name must match SESSION_COOKIE_NAME in src/lib/auth.ts. Not imported
  // directly here to avoid pulling next/headers into the Edge middleware bundle.
  const token = req.cookies.get("session")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  try {
    const secret = new TextEncoder().encode(process.env.SESSION_SECRET);
    const { payload } = await jwtVerify(token, secret);
    const role = payload.role as string;
    const mustChangePassword = payload.mustChangePassword as boolean | undefined;

    // Force password change before anything else
    if (mustChangePassword && !CHANGE_PASSWORD_PATHS.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL("/change-password", req.url));
    }

    // Trial-lock takes priority over role-based routing — a locked trial
    // install shows nothing but the unlock screen until a valid key is applied.
    const trialLocked = payload.trialLocked as boolean | undefined;
    if (trialLocked && !TRIAL_EXPIRED_PATHS.some((p) => pathname.startsWith(p))) {
      return NextResponse.redirect(new URL("/trial-expired", req.url));
    }

    // Tech users are restricted to the field module and time/job APIs
    if (role === "tech") {
      const allowed = TECH_ALLOWED_PREFIXES.some((p) => pathname.startsWith(p));
      if (!allowed) {
        return NextResponse.redirect(new URL("/field", req.url));
      }
    }

    // Superuser-only paths
    if (pathname.startsWith("/api/users") && role !== "superuser") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.next();
  } catch {
    const res = NextResponse.redirect(new URL("/login", req.url));
    res.cookies.delete("session");
    return res;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|public).*)"],
};
