import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  // Brand assets + PWA install files must load without a session
  "/logo.png",
  "/logo.svg",
  "/icons",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
];
const CHANGE_PASSWORD_PATHS = ["/change-password", "/api/auth/change-password"];

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
