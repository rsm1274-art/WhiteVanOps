import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    repairRecord: { findFirst: vi.fn() },
    job: { findFirst: vi.fn() },
    personnelTimeOff: { findFirst: vi.fn() },
    jobAssignment: { findFirst: vi.fn() },
    jobEquipment: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { checkJobConflicts } from "./jobConflicts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockPrisma = prisma as any;

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) is required here: clearAllMocks only
  // wipes call history, not queued mockResolvedValueOnce values or default
  // implementations, so leftover queued values from a prior test can leak
  // into the next one when a mock (e.g. repairRecord.findFirst, shared by
  // both the vehicle-repair and equipment-repair checks) is reused.
  vi.resetAllMocks();
  // Default every lookup to "no conflict" so each test only needs to
  // configure the specific check it's exercising.
  mockPrisma.repairRecord.findFirst.mockResolvedValue(null);
  mockPrisma.job.findFirst.mockResolvedValue(null);
  mockPrisma.personnelTimeOff.findFirst.mockResolvedValue(null);
  mockPrisma.jobAssignment.findFirst.mockResolvedValue(null);
  mockPrisma.jobEquipment.findFirst.mockResolvedValue(null);
});

const baseParams = {
  scheduledDate: new Date(2026, 5, 15),
};

describe("checkJobConflicts", () => {
  it("returns null when nothing conflicts", async () => {
    const result = await checkJobConflicts({
      ...baseParams,
      assignedVehicleId: "van-1",
      personnelIds: ["tech-1"],
      equipmentIds: ["eq-1"],
    });
    expect(result).toBeNull();
  });

  it("blocks scheduling when the vehicle is out for repair", async () => {
    mockPrisma.repairRecord.findFirst.mockResolvedValueOnce({
      description: "Transmission fluid leak",
    });
    const result = await checkJobConflicts({ ...baseParams, assignedVehicleId: "van-1" });
    expect(result).toMatch(/out of service for repair/);
    expect(result).toMatch(/Transmission fluid leak/);
  });

  it("blocks scheduling when the vehicle is already booked that day", async () => {
    mockPrisma.job.findFirst.mockResolvedValueOnce({
      client: { name: "Acme Corp" },
    });
    const result = await checkJobConflicts({ ...baseParams, assignedVehicleId: "van-1" });
    expect(result).toMatch(/already booked/);
    expect(result).toMatch(/Acme Corp/);
  });

  it("blocks scheduling when a technician is on time off that day", async () => {
    mockPrisma.personnelTimeOff.findFirst.mockResolvedValueOnce({
      type: "Vacation",
      personnel: { firstName: "Dave", lastName: "Grohl" },
    });
    const result = await checkJobConflicts({ ...baseParams, personnelIds: ["tech-1"] });
    expect(result).toMatch(/Dave Grohl/);
    expect(result).toMatch(/Vacation leave/);
  });

  it("blocks scheduling when a technician is already assigned that day", async () => {
    mockPrisma.jobAssignment.findFirst.mockResolvedValueOnce({
      personnel: { firstName: "Trent", lastName: "Reznor" },
      job: { client: { name: "Beacon Hospital" } },
    });
    const result = await checkJobConflicts({ ...baseParams, personnelIds: ["tech-2"] });
    expect(result).toMatch(/Trent Reznor/);
    expect(result).toMatch(/Beacon Hospital/);
  });

  it("blocks scheduling when equipment is out for repair", async () => {
    // repairRecord.findFirst is shared by the vehicle-repair (1a) and
    // equipment-repair (3a) checks — key off the where-clause shape instead
    // of call order, since this test has no vehicle and shouldn't depend on
    // whether 1a ran.
    mockPrisma.repairRecord.findFirst.mockImplementation(({ where }: { where: { equipmentId?: string } }) =>
      where.equipmentId
        ? Promise.resolve({ description: "Generator won't start", equipment: { name: "Generac 5000W" } })
        : Promise.resolve(null)
    );
    const result = await checkJobConflicts({ ...baseParams, equipmentIds: ["eq-1"] });
    expect(result).toMatch(/Generac 5000W/);
    expect(result).toMatch(/Generator won't start/);
  });

  it("blocks scheduling when equipment is already assigned that day", async () => {
    mockPrisma.jobEquipment.findFirst.mockResolvedValueOnce({
      equipment: { name: "Trailer A" },
      job: { client: { name: "Summit Properties" } },
    });
    const result = await checkJobConflicts({ ...baseParams, equipmentIds: ["eq-2"] });
    expect(result).toMatch(/Trailer A/);
    expect(result).toMatch(/Summit Properties/);
  });

  it("excludes the current job from vehicle/personnel/equipment double-booking checks when excludeJobId is set", async () => {
    await checkJobConflicts({
      ...baseParams,
      assignedVehicleId: "van-1",
      personnelIds: ["tech-1"],
      equipmentIds: ["eq-1"],
      excludeJobId: "job-being-edited",
    });

    const vehicleCall = mockPrisma.job.findFirst.mock.calls[0][0];
    expect(vehicleCall.where.id).toEqual({ not: "job-being-edited" });

    const personnelCall = mockPrisma.jobAssignment.findFirst.mock.calls[0][0];
    expect(personnelCall.where.job.id).toEqual({ not: "job-being-edited" });

    const equipmentCall = mockPrisma.jobEquipment.findFirst.mock.calls[0][0];
    expect(equipmentCall.where.job.id).toEqual({ not: "job-being-edited" });
  });

  it("does not query personnel/equipment tables when none are provided", async () => {
    await checkJobConflicts({ ...baseParams });
    expect(mockPrisma.personnelTimeOff.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.jobAssignment.findFirst).not.toHaveBeenCalled();
    expect(mockPrisma.jobEquipment.findFirst).not.toHaveBeenCalled();
  });
});
