import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(),
    stockLocation: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    inventoryItem: {
      findMany: vi.fn(),
    },
    stockLevel: {
      createMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => ({ value: "fake-token" }),
  })),
}));

vi.mock("jose", async (importOriginal) => {
  const actual = await importOriginal<typeof import("jose")>();
  return {
    ...actual,
    jwtVerify: vi.fn(async () => ({
      payload: { userId: "u1", username: "admin", displayName: "Admin", role: "admin" },
    })),
  };
});

import { prisma } from "@/lib/db";
import { POST } from "./route";

// The route runs create_location inside prisma.$transaction(cb). This tx double
// forwards to the same mocked delegates so assertions can inspect the calls.
function wireTransaction() {
  const tx = {
    stockLocation: { create: prisma.stockLocation.create },
    inventoryItem: { findMany: prisma.inventoryItem.findMany },
    stockLevel: { createMany: prisma.stockLevel.createMany },
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    // @ts-expect-error — the test tx is a structural subset of Prisma's TransactionClient
    async (cb: (t: typeof tx) => unknown) => cb(tx)
  );
}

// transfer_stock runs its reads/writes inside prisma.$transaction(cb). Forward
// the tx double to the same mocked stockLevel delegates.
function wireTransferTransaction() {
  const tx = {
    stockLevel: {
      findUnique: prisma.stockLevel.findUnique,
      update: prisma.stockLevel.update,
      upsert: prisma.stockLevel.upsert,
    },
  };
  vi.mocked(prisma.$transaction).mockImplementation(
    // @ts-expect-error — the test tx is a structural subset of Prisma's TransactionClient
    async (cb: (t: typeof tx) => unknown) => cb(tx)
  );
}

function postInventory(body: Record<string, unknown>): Request {
  return new Request("http://localhost/api/inventory", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.SESSION_SECRET = "test-secret-at-least-32-bytes-long";
});

describe("POST /api/inventory — create_location", () => {
  it("creates a warehouse and maps it to every existing catalog item at zero stock", async () => {
    wireTransaction();
    vi.mocked(prisma.stockLocation.create).mockResolvedValue({
      id: "loc1",
      name: "Main Warehouse",
      type: "Warehouse",
      vehicleId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([
      { id: "item1" },
      { id: "item2" },
    ] as never);

    const res = await POST(postInventory({ action: "create_location", name: "Main Warehouse" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.type).toBe("Warehouse");
    expect(prisma.stockLocation.create).toHaveBeenCalledWith({
      data: { name: "Main Warehouse", type: "Warehouse" },
    });
    expect(prisma.stockLevel.createMany).toHaveBeenCalledWith({
      data: [
        { inventoryItemId: "item1", stockLocationId: "loc1", quantity: 0, minThreshold: 0 },
        { inventoryItemId: "item2", stockLocationId: "loc1", quantity: 0, minThreshold: 0 },
      ],
    });
  });

  it("trims the warehouse name before persisting", async () => {
    wireTransaction();
    vi.mocked(prisma.stockLocation.create).mockResolvedValue({ id: "loc1" } as never);
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never);

    await POST(postInventory({ action: "create_location", name: "  North Depot  " }));

    expect(prisma.stockLocation.create).toHaveBeenCalledWith({
      data: { name: "North Depot", type: "Warehouse" },
    });
  });

  it("does not insert any stock levels when there are no catalog items yet", async () => {
    wireTransaction();
    vi.mocked(prisma.stockLocation.create).mockResolvedValue({ id: "loc1" } as never);
    vi.mocked(prisma.inventoryItem.findMany).mockResolvedValue([] as never);

    const res = await POST(postInventory({ action: "create_location", name: "Empty Depot" }));

    expect(res.status).toBe(200);
    expect(prisma.stockLevel.createMany).not.toHaveBeenCalled();
  });

  it("rejects a missing or blank name with 400 and never touches the database", async () => {
    const blank = await POST(postInventory({ action: "create_location", name: "   " }));
    expect(blank.status).toBe(400);

    const missing = await POST(postInventory({ action: "create_location" }));
    expect(missing.status).toBe(400);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.stockLocation.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/inventory — delete_location", () => {
  it("deletes a warehouse location", async () => {
    vi.mocked(prisma.stockLocation.findUnique).mockResolvedValue({
      id: "loc1",
      name: "Main Warehouse",
      type: "Warehouse",
      vehicleId: null,
    } as never);
    vi.mocked(prisma.stockLocation.delete).mockResolvedValue({ id: "loc1" } as never);

    const res = await POST(postInventory({ action: "delete_location", stockLocationId: "loc1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(prisma.stockLocation.delete).toHaveBeenCalledWith({ where: { id: "loc1" } });
  });

  it("refuses to delete a vehicle location and leaves it untouched", async () => {
    vi.mocked(prisma.stockLocation.findUnique).mockResolvedValue({
      id: "van1",
      name: "Van Transit (1FTB) Stock",
      type: "Vehicle",
      vehicleId: "veh1",
    } as never);

    const res = await POST(postInventory({ action: "delete_location", stockLocationId: "van1" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/warehouse/i);
    expect(prisma.stockLocation.delete).not.toHaveBeenCalled();
  });

  it("returns 404 when the location does not exist", async () => {
    vi.mocked(prisma.stockLocation.findUnique).mockResolvedValue(null);

    const res = await POST(postInventory({ action: "delete_location", stockLocationId: "ghost" }));

    expect(res.status).toBe(404);
    expect(prisma.stockLocation.delete).not.toHaveBeenCalled();
  });

  it("returns 400 when stockLocationId is missing", async () => {
    const res = await POST(postInventory({ action: "delete_location" }));

    expect(res.status).toBe(400);
    expect(prisma.stockLocation.findUnique).not.toHaveBeenCalled();
  });
});

describe("POST /api/inventory — transfer_stock", () => {
  const transferBody = {
    action: "transfer_stock",
    inventoryItemId: "item1",
    fromLocationId: "warehouse1",
    toLocationId: "van1",
    quantity: "10",
  };

  it("decrements the source and increments the destination for a valid transfer", async () => {
    wireTransferTransaction();
    vi.mocked(prisma.stockLevel.findUnique).mockResolvedValue({
      id: "sl-src",
      inventoryItemId: "item1",
      stockLocationId: "warehouse1",
      quantity: 40,
      minThreshold: 0,
    } as never);
    vi.mocked(prisma.stockLevel.update).mockResolvedValue({} as never);
    vi.mocked(prisma.stockLevel.upsert).mockResolvedValue({ id: "sl-dest", quantity: 10 } as never);

    const res = await POST(postInventory(transferBody));

    expect(res.status).toBe(200);
    expect(prisma.stockLevel.update).toHaveBeenCalledWith({
      where: { inventoryItemId_stockLocationId: { inventoryItemId: "item1", stockLocationId: "warehouse1" } },
      data: { quantity: 30 },
    });
    expect(prisma.stockLevel.upsert).toHaveBeenCalledWith({
      where: { inventoryItemId_stockLocationId: { inventoryItemId: "item1", stockLocationId: "van1" } },
      update: { quantity: { increment: 10 } },
      create: { inventoryItemId: "item1", stockLocationId: "van1", quantity: 10, minThreshold: 0 },
    });
  });

  it("blocks a transfer that exceeds on-hand stock and writes nothing", async () => {
    wireTransferTransaction();
    vi.mocked(prisma.stockLevel.findUnique).mockResolvedValue({
      id: "sl-src",
      inventoryItemId: "item1",
      stockLocationId: "warehouse1",
      quantity: 5,
      minThreshold: 0,
    } as never);

    const res = await POST(postInventory(transferBody));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/only 5 on hand/i);
    expect(prisma.stockLevel.update).not.toHaveBeenCalled();
    expect(prisma.stockLevel.upsert).not.toHaveBeenCalled();
  });

  it("blocks a transfer when the source has no stock level at all", async () => {
    wireTransferTransaction();
    vi.mocked(prisma.stockLevel.findUnique).mockResolvedValue(null);

    const res = await POST(postInventory(transferBody));

    expect(res.status).toBe(400);
    expect(prisma.stockLevel.update).not.toHaveBeenCalled();
  });

  it("rejects a transfer where source and destination are the same location", async () => {
    const res = await POST(
      postInventory({ ...transferBody, toLocationId: "warehouse1" })
    );

    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a non-positive quantity", async () => {
    const zero = await POST(postInventory({ ...transferBody, quantity: "0" }));
    expect(zero.status).toBe(400);

    const negative = await POST(postInventory({ ...transferBody, quantity: "-4" }));
    expect(negative.status).toBe(400);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects missing transfer fields", async () => {
    const res = await POST(
      postInventory({ action: "transfer_stock", inventoryItemId: "item1", quantity: "10" })
    );

    expect(res.status).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
