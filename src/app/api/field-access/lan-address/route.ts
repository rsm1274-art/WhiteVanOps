import { NextResponse } from "next/server";
import os from "os";
import { getSessionUser, requireRole } from "@/lib/auth";
import { classifyFieldUrl } from "@/lib/fieldAccessUrl";

/**
 * Reports the addresses a phone on the office network could use to reach this
 * server, so the Field Access QR flow can offer them instead of asking an
 * admin to type an IP. Read-only and admin-gated: it discloses internal
 * network layout, which a tech has no reason to enumerate.
 *
 * Private (RFC1918) addresses sort first — on a machine with both a LAN NIC
 * and something public, the LAN one is what field techs can actually reach.
 */
export async function GET() {
  const user = await getSessionUser();
  const denied = requireRole(user, "admin", "superuser");
  if (denied) return denied;

  const addresses: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const entry of iface ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      addresses.push(entry.address);
    }
  }

  const isPrivate = (addr: string) => classifyFieldUrl(`http://${addr}`).isPrivateLan;
  addresses.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));

  return NextResponse.json({ addresses });
}
