import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { name, contactName, locationAddress, paymentTerms } = await request.json();

    if (!name || !contactName || !locationAddress || !paymentTerms) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newClient = await prisma.client.create({
      data: { name, contactName, locationAddress, paymentTerms },
    });

    await audit(user!.userId, "CREATE", "Client", newClient.id, { name });

    return NextResponse.json(newClient);
  } catch (error) {
    console.error("Create Client API Error:", error);
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}
