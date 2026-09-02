import { NextResponse } from "next/server";
import os from "os";
import { getSessionUser, requireRole } from "@/lib/auth";
import { selectPhoneReachableAddresses } from "@/lib/lanAddresses";

/**
 * Reports the addresses a phone on the office network could use to reach this
 * server, so the Field Access QR flow can offer them instead of asking an
 * admin to type an IP. Read-only and admin-gated: it discloses internal
 * network layout, which a tech has no reason to enumerate.
 *
 * Selection and ordering live in `@/lib/lanAddresses` so they stay unit-tested
 * — notably the exclusion of virtual adapters (Hyper-V/WSL, VirtualBox,
 * VMware), whose addresses pass every RFC1918 check yet are reachable only
 * from this PC.
 */
export async function GET() {
  const user = await getSessionUser();
  const denied = requireRole(user, "admin", "superuser");
  if (denied) return denied;

  return NextResponse.json({ addresses: selectPhoneReachableAddresses(os.networkInterfaces()) });
}
