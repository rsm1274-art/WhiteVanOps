import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

const pool = new pg.Pool({ connectionString });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("Cleaning up database...");

  // Delete in order of dependencies
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.timeEntry.deleteMany({});
  await prisma.jobLineItem.deleteMany({});
  await prisma.jobEquipment.deleteMany({});
  await prisma.jobAssignment.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.stockLevel.deleteMany({});
  await prisma.stockLocation.deleteMany({});
  await prisma.inventoryItem.deleteMany({});
  await prisma.maintenanceLog.deleteMany({});
  await prisma.vehicle.deleteMany({});
  await prisma.equipment.deleteMany({});
  await prisma.personnel.deleteMany({});
  await prisma.client.deleteMany({});

  console.log("Seeding CRM & Personnel...");

  // 1. Seed Clients
  const clientApex = await prisma.client.create({
    data: {
      name: "Apex Logistics",
      contactName: "John Miller",
      locationAddress: "100 Main St, Chicago IL 60601",
      paymentTerms: "Net 30",
    },
  });

  const clientSummit = await prisma.client.create({
    data: {
      name: "Summit Properties",
      contactName: "Sarah Connor",
      locationAddress: "456 Oak Ave, Seattle WA 98101",
      paymentTerms: "Net 15",
    },
  });

  const clientBeacon = await prisma.client.create({
    data: {
      name: "Beacon Hospital",
      contactName: "Dr. James Smith",
      locationAddress: "789 Pine Rd, New York NY 10001",
      paymentTerms: "Due on Receipt",
    },
  });

  // 2. Seed Personnel
  const techDave = await prisma.personnel.create({
    data: {
      firstName: "Dave",
      lastName: "Grohl",
      role: "Technician",
      certifications: "HVAC Level II, EPA 608, OSHA 10",
    },
  });

  const techTrent = await prisma.personnel.create({
    data: {
      firstName: "Trent",
      lastName: "Reznor",
      role: "Technician",
      certifications: "Master Electrician, OSHA 30",
    },
  });

  await prisma.personnel.create({
    data: {
      firstName: "Alanis",
      lastName: "Morissette",
      role: "Dispatcher",
      certifications: "FEMA Dispatch Ops, Communications I",
    },
  });

  console.log("Seeding Equipment Registry...");

  // 2b. Seed Equipment
  const eqMultimeter = await prisma.equipment.create({
    data: {
      name: "Fluke 87V Digital Multimeter",
      serialNumber: "SN-FL87V-98231",
      status: "Active",
    },
  });

  const eqVacuumPump = await prisma.equipment.create({
    data: {
      name: "Yellow Jacket SuperEvac Vacuum Pump",
      serialNumber: "SN-YJ9356-29831",
      status: "Active",
    },
  });

  await prisma.equipment.create({
    data: {
      name: "Honda EU2200i Portable Generator",
      serialNumber: "SN-HD2200-55421",
      status: "Active",
    },
  });

  console.log("Seeding Fleet & Stock Locations...");

  // 3. Seed Vehicles
  const van1 = await prisma.vehicle.create({
    data: {
      vin: "1FTFW1EF5GXXXXXXX",
      make: "Ford",
      model: "Transit 250",
      status: "Active",
    },
  });

  const van2 = await prisma.vehicle.create({
    data: {
      vin: "1FTFW1EF5HYYYYYYY",
      make: "Mercedes",
      model: "Sprinter 3500",
      status: "Active",
    },
  });

  const truck3 = await prisma.vehicle.create({
    data: {
      vin: "1FTFW1EF5JZZZZZZZ",
      make: "Chevrolet",
      model: "Express 3500",
      status: "In Maintenance",
    },
  });

  // 4. Seed Stock Locations
  const warehouseLoc = await prisma.stockLocation.create({
    data: {
      name: "Main Warehouse",
      type: "Warehouse",
    },
  });

  const van1Loc = await prisma.stockLocation.create({
    data: {
      name: "Van 101 Stock",
      type: "Vehicle",
      vehicleId: van1.id,
    },
  });

  const van2Loc = await prisma.stockLocation.create({
    data: {
      name: "Van 102 Stock",
      type: "Vehicle",
      vehicleId: van2.id,
    },
  });

  console.log("Seeding Inventory Catalog & Stock Levels...");

  // 5. Seed Inventory Items (Catalog)
  const itemCopperPipe = await prisma.inventoryItem.create({
    data: {
      name: "Copper Pipe 1/2in 10ft",
      category: "Plumbing",
      subCategory: "Pipes",
      defaultRate: 15.5,
    },
  });

  const itemBrassValve = await prisma.inventoryItem.create({
    data: {
      name: "Brass Ball Valve 3/4in",
      category: "Plumbing",
      subCategory: "Valves",
      defaultRate: 24.25,
    },
  });

  const itemThermostat = await prisma.inventoryItem.create({
    data: {
      name: "Smart Thermostat Pro",
      category: "HVAC",
      subCategory: "Controls",
      defaultRate: 189.99,
    },
  });

  const itemBreaker = await prisma.inventoryItem.create({
    data: {
      name: "Circuit Breaker 20A Single Pole",
      category: "Electrical",
      subCategory: "Breakers",
      defaultRate: 12.75,
    },
  });

  // 6. Seed Stock Levels
  // Warehouse Stock (High quantities)
  await prisma.stockLevel.createMany({
    data: [
      { inventoryItemId: itemCopperPipe.id, stockLocationId: warehouseLoc.id, quantity: 150, minThreshold: 30 },
      { inventoryItemId: itemBrassValve.id, stockLocationId: warehouseLoc.id, quantity: 80, minThreshold: 20 },
      { inventoryItemId: itemThermostat.id, stockLocationId: warehouseLoc.id, quantity: 45, minThreshold: 10 },
      { inventoryItemId: itemBreaker.id, stockLocationId: warehouseLoc.id, quantity: 200, minThreshold: 40 },
    ],
  });

  // Van 1 Stock (Fully Stocked)
  await prisma.stockLevel.createMany({
    data: [
      { inventoryItemId: itemCopperPipe.id, stockLocationId: van1Loc.id, quantity: 10, minThreshold: 5 },
      { inventoryItemId: itemBrassValve.id, stockLocationId: van1Loc.id, quantity: 6, minThreshold: 3 },
      { inventoryItemId: itemThermostat.id, stockLocationId: van1Loc.id, quantity: 3, minThreshold: 2 },
    ],
  });

  // Van 2 Stock (Low Stock - triggers alerts!)
  await prisma.stockLevel.createMany({
    data: [
      { inventoryItemId: itemCopperPipe.id, stockLocationId: van2Loc.id, quantity: 2, minThreshold: 5 }, // Below threshold!
      { inventoryItemId: itemBrassValve.id, stockLocationId: van2Loc.id, quantity: 1, minThreshold: 3 }, // Below threshold!
      { inventoryItemId: itemBreaker.id, stockLocationId: van2Loc.id, quantity: 12, minThreshold: 10 },
    ],
  });

  console.log("Seeding Job Operations & Assignments...");

  // 7. Seed Jobs
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);

  const today = new Date();

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Job 1: Completed (Apex Logistics)
  const jobCompleted = await prisma.job.create({
    data: {
      clientId: clientApex.id,
      assignedVehicleId: van1.id,
      status: "Completed",
      scheduledDate: yesterday,
      completionDate: yesterday,
      qbInvoiceSyncStatus: "Pending",
    },
  });

  // Job 2: In Progress (Summit Properties)
  const jobInProgress = await prisma.job.create({
    data: {
      clientId: clientSummit.id,
      assignedVehicleId: van2.id,
      status: "In Progress",
      scheduledDate: today,
    },
  });

  // Job 3: Scheduled (Beacon Hospital)
  const jobScheduled = await prisma.job.create({
    data: {
      clientId: clientBeacon.id,
      assignedVehicleId: van1.id,
      status: "Scheduled",
      scheduledDate: tomorrow,
    },
  });

  // 8. Seed Job Assignments
  await prisma.jobAssignment.create({
    data: { jobId: jobCompleted.id, personnelId: techDave.id },
  });

  await prisma.jobAssignment.create({
    data: { jobId: jobInProgress.id, personnelId: techTrent.id },
  });

  await prisma.jobAssignment.create({
    data: { jobId: jobScheduled.id, personnelId: techDave.id },
  });

  // 8b. Seed Job Equipment allocations (crediting equipment to job Completed)
  await prisma.jobEquipment.createMany({
    data: [
      { jobId: jobCompleted.id, equipmentId: eqMultimeter.id },
      { jobId: jobCompleted.id, equipmentId: eqVacuumPump.id },
    ],
  });

  // 9. Seed Job Line Items (Materials used on Completed Job)
  await prisma.jobLineItem.createMany({
    data: [
      {
        jobId: jobCompleted.id,
        inventoryItemId: itemThermostat.id,
        quantity: 1,
        rate: 189.99,
        description: "Installed smart thermostat pro for office heating control.",
      },
      {
        jobId: jobCompleted.id,
        inventoryItemId: itemBrassValve.id,
        quantity: 2,
        rate: 24.25,
        description: "Replaced leaking master water supply shut-off valves.",
      },
    ],
  });

  // 10. Seed Time Entries (Labor logged on Completed Job)
  await prisma.timeEntry.create({
    data: {
      jobId: jobCompleted.id,
      personnelId: techDave.id,
      date: yesterday,
      duration: "08:30", // [HH:MM] format
      serviceItem: "Field Labor",
      payrollItem: "Regular Pay",
      qbTimeSyncStatus: "Pending",
    },
  });

  // 11. Seed Maintenance Logs
  await prisma.maintenanceLog.create({
    data: {
      vehicleId: truck3.id,
      date: yesterday,
      cost: 450.0,
      description: "Scheduled 100k mile transmission fluid service & brake pad replacement.",
      odometer: 102430,
    },
  });

  console.log("Seeding Users...");

  // Seed users: superuser, admin, and field tech accounts linked to personnel
  await prisma.user.create({
    data: {
      username: "admin",
      passwordHash: await bcrypt.hash("admin123", 12),
      displayName: "Site Administrator",
      role: "superuser",
    },
  });

  await prisma.user.create({
    data: {
      username: "dispatcher",
      passwordHash: await bcrypt.hash("dispatch123", 12),
      displayName: "Alanis Morissette",
      role: "admin",
    },
  });

  await prisma.user.create({
    data: {
      username: "tech.dave",
      passwordHash: await bcrypt.hash("tech123", 12),
      displayName: "Dave Grohl",
      role: "tech",
      personnelId: techDave.id,
    },
  });

  await prisma.user.create({
    data: {
      username: "tech.trent",
      passwordHash: await bcrypt.hash("tech123", 12),
      displayName: "Trent Reznor",
      role: "tech",
      personnelId: techTrent.id,
    },
  });

  console.log("Seeding complete! Database is populated with mock operational data.");
  console.log("\nDefault login credentials:");
  console.log("  Superuser: admin / admin123");
  console.log("  Admin:     dispatcher / dispatch123");
  console.log("  Tech:      tech.dave / tech123");
  console.log("  Tech:      tech.trent / tech123");
}

main()
  .catch((e) => {
    console.error("Error seeding database: ", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
