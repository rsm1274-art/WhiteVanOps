// Hand-written Kysely table types for the report builder's query layer.
//
// Deliberately minimal: only the tables and columns the Phase 0 registry
// (registry.ts) and relation graph (graph.ts) actually reference, not a
// full schema mirror. Table names match Prisma's default mapping exactly
// (PascalCase, unquoted model name — verified against prisma/migrations/
// **/migration.sql, no @@map directives exist in schema.prisma). Adding a
// registry field for a new table requires adding that table here too.
//
// Read-only: the report builder only ever SELECTs through this interface,
// so columns are typed as their plain values rather than wrapped in
// Kysely's `Generated<T>` (which only matters for INSERT/UPDATE defaults).

export interface JobTable {
  id: string;
  clientId: string;
  assignedVehicleId: string | null;
  status: string;
  scheduledDate: Date;
  completionDate: Date | null;
  notes: string | null;
  qbInvoiceSyncStatus: string;
  createdAt: Date;
}

export interface ClientTable {
  id: string;
  name: string;
  contactName: string;
  locationAddress: string;
  paymentTerms: string;
}

export interface VehicleTable {
  id: string;
  vin: string;
  make: string;
  model: string;
  status: string;
}

export interface JobAssignmentTable {
  id: string;
  jobId: string;
  personnelId: string;
}

export interface PersonnelTable {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface JobLineItemTable {
  id: string;
  jobId: string;
  inventoryItemId: string;
  quantity: number;
  rate: number;
  description: string;
}

export interface InventoryItemTable {
  id: string;
  name: string;
  category: string;
  defaultRate: number;
}

export interface TimeEntryTable {
  id: string;
  jobId: string;
  date: Date;
  duration: string;
  serviceItem: string;
  payrollItem: string;
  qbTimeSyncStatus: string;
}

export interface JobEquipmentTable {
  id: string;
  jobId: string;
  equipmentId: string;
}

export interface EquipmentTable {
  id: string;
  name: string;
  serialNumber: string;
  status: string;
}

export interface InvoiceTable {
  id: string;
  jobId: string | null;
  invoiceNumber: string;
  status: string;
  issueDate: Date;
  dueDate: Date;
}

export interface QuoteTable {
  id: string;
  jobId: string | null;
  quoteNumber: string;
  status: string;
  issueDate: Date;
  expiryDate: Date;
}

/** Keyed by the real, quoted Postgres table name. */
export interface Database {
  Job: JobTable;
  Client: ClientTable;
  Vehicle: VehicleTable;
  JobAssignment: JobAssignmentTable;
  Personnel: PersonnelTable;
  JobLineItem: JobLineItemTable;
  InventoryItem: InventoryItemTable;
  TimeEntry: TimeEntryTable;
  JobEquipment: JobEquipmentTable;
  Equipment: EquipmentTable;
  Invoice: InvoiceTable;
  Quote: QuoteTable;
}

/** Maps a registry `source.entity` name (camelCase) to its real table name. */
export const ENTITY_TABLE: Readonly<Record<string, keyof Database>> = {
  job: "Job",
  client: "Client",
  vehicle: "Vehicle",
  jobAssignment: "JobAssignment",
  personnel: "Personnel",
  jobLineItem: "JobLineItem",
  inventoryItem: "InventoryItem",
  timeEntry: "TimeEntry",
  jobEquipment: "JobEquipment",
  equipment: "Equipment",
  invoice: "Invoice",
  quote: "Quote",
};
