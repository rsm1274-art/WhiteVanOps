import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser, requireRole } from "@/lib/auth";
import { audit } from "@/lib/audit";

// Thrown inside the transfer_stock transaction when the source location does
// not hold enough units. Carries the available count so the caller can report
// it. Caught specifically so the transaction rolls back and returns a 400
// rather than falling through to the generic 500 handler.
class InsufficientStockError extends Error {
  constructor(public available: number) {
    super("Insufficient stock at source location");
  }
}

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

    if (action === "create_location") {
      const { name } = payload;

      if (!name || !name.trim()) {
        return NextResponse.json({ error: "Warehouse name is required" }, { status: 400 });
      }

      const newLocation = await prisma.$transaction(async (tx) => {
        const location = await tx.stockLocation.create({
          data: { name: name.trim(), type: "Warehouse" },
        });

        const items = await tx.inventoryItem.findMany({ select: { id: true } });
        if (items.length > 0) {
          await tx.stockLevel.createMany({
            data: items.map((item) => ({
              inventoryItemId: item.id,
              stockLocationId: location.id,
              quantity: 0,
              minThreshold: 0,
            })),
          });
        }

        return location;
      });

      await audit(user!.userId, "CREATE", "StockLocation", newLocation.id, { name: newLocation.name, type: "Warehouse" });

      return NextResponse.json(newLocation);
    }

    if (action === "delete_location") {
      const { stockLocationId } = payload;
      if (!stockLocationId) {
        return NextResponse.json({ error: "Missing stockLocationId" }, { status: 400 });
      }

      const location = await prisma.stockLocation.findUnique({ where: { id: stockLocationId } });
      if (!location) {
        return NextResponse.json({ error: "Location not found" }, { status: 404 });
      }
      if (location.type !== "Warehouse") {
        return NextResponse.json(
          { error: "Only warehouse locations can be deleted here. Vehicle locations are managed from the Fleet tab." },
          { status: 400 }
        );
      }

      await prisma.stockLocation.delete({ where: { id: stockLocationId } });
      await audit(user!.userId, "DELETE", "StockLocation", stockLocationId, { name: location.name });

      return NextResponse.json({ ok: true });
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

    if (action === "transfer_stock") {
      const { inventoryItemId, fromLocationId, toLocationId, quantity } = payload;

      if (!inventoryItemId || !fromLocationId || !toLocationId || quantity === undefined) {
        return NextResponse.json({ error: "Missing required transfer fields" }, { status: 400 });
      }
      if (fromLocationId === toLocationId) {
        return NextResponse.json({ error: "Source and destination must be different locations" }, { status: 400 });
      }
      const qty = parseInt(quantity, 10);
      if (!Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ error: "Transfer quantity must be a positive whole number" }, { status: 400 });
      }

      try {
        const dest = await prisma.$transaction(async (tx) => {
          const source = await tx.stockLevel.findUnique({
            where: { inventoryItemId_stockLocationId: { inventoryItemId, stockLocationId: fromLocationId } },
          });
          if (!source || source.quantity < qty) {
            throw new InsufficientStockError(source?.quantity ?? 0);
          }

          await tx.stockLevel.update({
            where: { inventoryItemId_stockLocationId: { inventoryItemId, stockLocationId: fromLocationId } },
            data: { quantity: source.quantity - qty },
          });

          return tx.stockLevel.upsert({
            where: { inventoryItemId_stockLocationId: { inventoryItemId, stockLocationId: toLocationId } },
            update: { quantity: { increment: qty } },
            create: { inventoryItemId, stockLocationId: toLocationId, quantity: qty, minThreshold: 0 },
          });
        });

        await audit(user!.userId, "UPDATE", "StockLevel", dest.id, {
          transfer: { inventoryItemId, fromLocationId, toLocationId, quantity: qty },
        });

        return NextResponse.json(dest);
      } catch (e) {
        if (e instanceof InsufficientStockError) {
          return NextResponse.json(
            { error: `Not enough stock at the source location — only ${e.available} on hand.` },
            { status: 400 }
          );
        }
        throw e;
      }
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
