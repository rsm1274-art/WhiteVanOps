import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { name, contactName, contactPhone, locationAddress, paymentTerms } = await request.json();

    if (!name || !contactName || !locationAddress || !paymentTerms) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const newClient = await prisma.client.create({
      data: {
        name,
        contactName,
        contactPhone: typeof contactPhone === "string" && contactPhone.trim() ? contactPhone.trim() : null,
        locationAddress,
        paymentTerms,
      },
    });

    await audit(user!.userId, "CREATE", "Client", newClient.id, { name });

    return NextResponse.json(newClient);
  } catch (error) {
    console.error("Create Client API Error:", error);
    return NextResponse.json({ error: "Failed to create client" }, { status: 500 });
  }
}

// PUT: Edit a client's contact details / address / terms.
export async function PUT(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { id, name, contactName, contactPhone, locationAddress, paymentTerms } = await request.json();

    if (!id || !name || !contactName || !locationAddress || !paymentTerms) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const updated = await prisma.client.update({
      where: { id },
      data: {
        name,
        contactName,
        contactPhone: typeof contactPhone === "string" && contactPhone.trim() ? contactPhone.trim() : null,
        locationAddress,
        paymentTerms,
      },
    });

    await audit(user!.userId, "UPDATE", "Client", id, { name });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Update Client API Error:", error);
    return NextResponse.json({ error: "Failed to update client" }, { status: 500 });
  }
}
