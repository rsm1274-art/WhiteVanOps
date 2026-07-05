import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

export async function POST(request: Request) {
  const user = await getSessionUser();
  const err = requireRole(user, "admin", "superuser");
  if (err) return err;

  try {
    const { action, ...payload } = await request.json();

    if (action === "create_item") {
      const { name, category, subCategory, defaultRate } = payload;

      if (!name || !category || !subCategory || defaultRate === undefined) {
        return NextResponse.json({ error: "Missing required item fields" }, { status: 400 });
      }

      const newItem = await prisma.$transaction(async (tx) => {
        const item = await tx.inventoryItem.create({
          data: { name, category, subCategory, defaultRate: parseFloat(defaultRate) || 0 },
        });

        const locations = await tx.stockLocation.findMany();
        if (locations.length > 0) {
          await tx.stockLevel.createMany({
            data: locations.map((loc) => ({
              inventoryItemId: item.id,
              stockLocationId: loc.id,
              quantity: 0,
              minThreshold: 0,
            })),
          });
        }

        return item;
      });

      await audit(user!.userId, "CREATE", "InventoryItem", newItem.id, { name, category });

      return NextResponse.json(newItem);
    }

    if (action === "adjust_stock") {
      const { inventoryItemId, stockLocationId, quantity, minThreshold } = payload;

      if (!inventoryItemId || !stockLocationId || quantity === undefined) {
        return NextResponse.json({ error: "Missing required adjustment fields" }, { status: 400 });
      }

      const qty = parseInt(quantity, 10);
      const min = minThreshold !== undefined ? parseInt(minThreshold, 10) : undefined;

      const level = await prisma.stockLevel.upsert({
        where: { inventoryItemId_stockLocationId: { inventoryItemId, stockLocationId } },
        update: { quantity: qty, ...(min !== undefined && { minThreshold: min }) },
        create: {
          inventoryItemId,
          stockLocationId,
          quantity: qty,
          minThreshold: min !== undefined ? min : 0,
        },
      });

      await audit(user!.userId, "UPDATE", "StockLevel", level.id, { inventoryItemId, stockLocationId, quantity: qty });

      return NextResponse.json(level);
    }

    if (action === "delete_item") {
      const { inventoryItemId } = payload;
      if (!inventoryItemId) {
        return NextResponse.json({ error: "Missing inventoryItemId" }, { status: 400 });
      }

      const usageCount = await prisma.jobLineItem.count({ where: { inventoryItemId } });
      if (usageCount > 0) {
        return NextResponse.json(
          { error: `This item is referenced on ${usageCount} job invoice(s) and cannot be deleted. It is protected to preserve billing history.` },
          { status: 409 }
        );
      }

      await prisma.inventoryItem.delete({ where: { id: inventoryItemId } });
      await audit(user!.userId, "DELETE", "InventoryItem", inventoryItemId);

      return NextResponse.json({ ok: true });
    }

    if (action === "remove_stock_level") {
      const { inventoryItemId, stockLocationId } = payload;
      if (!inventoryItemId || !stockLocationId) {
        return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
      }
      await prisma.stockLevel.deleteMany({ where: { inventoryItemId, stockLocationId } });
      await audit(user!.userId, "DELETE", "StockLevel", `${inventoryItemId}:${stockLocationId}`);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Inventory API Error:", error);
    return NextResponse.json({ error: "Failed to execute inventory action" }, { status: 500 });
  }
}
