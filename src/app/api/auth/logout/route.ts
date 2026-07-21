import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  const res = NextResponse.json({ ok: true });
  // The request is needed so the cookie is cleared with the same attributes it
  // was set with — otherwise the browser ignores the delete.
  clearSessionCookie(res, req);
  return res;
}
