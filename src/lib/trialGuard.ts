import { NextResponse } from "next/server";
import { getTrialStatus } from "./trial";
import { TRIAL_EXPIRED_CODE } from "./trialExpired";

/**
 * The login-time `trialLocked` claim covers new sessions only, and sessions
 * last 7 days — a phone logged in on day 29 would keep working. The two
 * endpoints every screen loads from (/api/dashboard, /api/field) call this so
 * an ended trial stops showing data straight away. Writes are deliberately
 * NOT blocked: a tech's queued field work must never be rejected (it would be
 * quarantined as "needs attention"); it lands, and is there once activated.
 */
export function trialExpiredResponse(): NextResponse | null {
  if (!getTrialStatus().isLocked) return null;
  return NextResponse.json(
    { error: "The 30-day trial has ended. Enter an activation key on the office computer to continue.", code: TRIAL_EXPIRED_CODE },
    { status: 403 }
  );
}
