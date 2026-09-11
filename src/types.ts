// ---------------------------------------------------------------------------
// Domain models — match Prisma schema exactly
// ---------------------------------------------------------------------------

export interface Client {
  id: string;
  name: string;
  contactName: string;
  locationAddress: string;
  paymentTerms: string;
  // Plus tier only — present in the dashboard payload only when licensed
  notes?: ClientNote[];
  followUps?: ClientFollowUp[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Plus tier — license, CRM notes & follow-ups, invoicing
// ---------------------------------------------------------------------------

export type LicenseTier = "base" | "plus";

export interface LicenseInfo {
  tier: LicenseTier;
  expiresAt: string | null;
  /** True only when tier is "plus" and unexpired. */
  plus: boolean;
}

export interface ClientNote {
  id: string;
  clientId: string;
  authorId: string | null;
  author: { displayName: string } | null;
  body: string;
  createdAt: string;
}

export interface ClientFollowUp {
  id: string;
  clientId: string;
  assignedToId: string | null;
  assignedTo: Personnel | null;
  dueDate: string;
  note: string;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
}

export type InvoiceStatus = "Draft" | "Sent" | "PartiallyPaid" | "Paid" | "Void";

export interface InvoiceLineItem {
  id: string;
  invoiceId: string;
  description: string;
  quantity: number;
  rate: number;
}

export interface Payment {
  id: string;
  invoiceId: string;
  amount: number;
  method: string;
  reference: string | null;
  receivedDate: string;
  recordedById: string | null;
}

export interface Invoice {
  id: string;
  invoiceNumber: string;
  clientId: string;
  client: Client;
  jobId: string | null;
  status: InvoiceStatus;
  issueDate: string;
  dueDate: string;
  notes: string | null;
  lineItems: InvoiceLineItem[];
  payments: Payment[];
  createdAt: string;
  updatedAt: string;
}

export type QuoteStatus = "Draft" | "Sent" | "Approved" | "Declined" | "Expired" | "Converted";

export interface QuoteLineItem {
  id: string;
  quoteId: string;
  description: string;
  quantity: number;
  rate: number;
}

export interface Quote {
  id: string;
  quoteNumber: string;
  clientId: string;
  client: Client;
  jobId: string | null;
  status: QuoteStatus;
  issueDate: string;
  expiryDate: string;
  notes: string | null;
  /**
   * The secret in the customer's approval link, null until the quote is issued.
   * Reaches the dashboard so the operator can re-copy the link after a reload —
   * never render it as text.
   */
  publicToken: string | null;
  sentAt: string | null;
  respondedAt: string | null;
  respondedName: string | null;
  declineReason: string | null;
  convertedInvoiceId: string | null;
  lineItems: QuoteLineItem[];
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Plus tier — custom report builder
// ---------------------------------------------------------------------------

export interface ReportFolder {
  id: string;
  name: string;
  isPublic: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedReport {
  id: string;
  name: string;
  description: string | null;
  rootEntity: "job";
  /**
   * Untrusted whether freshly saved or read back from the database — always
   * re-validated with validateDefinition() before compiling or executing.
   * See src/lib/reports/definition.ts.
   */
  definition: import("@/lib/reports/types").ReportDefinition;
  folderId: string | null;
  folder?: ReportFolder | null;
  isShared: boolean;
  createdById: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonnelQualification {
  id: string;
  personnelId: string;
  tag: string;
  category: string;
  issuedBy: string | null;
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface PersonnelTimeOff {
  id: string;
  personnelId: string;
  type: string;
  startDate: string;
  endDate: string;
  notes: string | null;
  createdAt: string;
}

export interface Personnel {
  id: string;
  firstName: string;
  lastName: string;
  role: "Technician" | "Dispatcher";
  certifications: string | null;
  qualifications: PersonnelQualification[];
  timeOff: PersonnelTimeOff[];
  createdAt: string;
  updatedAt: string;
}

export interface RepairRecord {
  id: string;
  vehicleId: string | null;
  equipmentId: string | null;
  description: string;
  repairType: string;
  location: string | null;
  serviceProvider: string | null;
  servicePhone: string | null;
  ticketNumber: string | null;
  startDate: string;
  resolvedDate: string | null;
  notes: string | null;
  createdAt: string;
}

export interface Vehicle {
  id: string;
  vin: string;
  make: string;
  model: string;
  status: "Active" | "In Maintenance" | "Retired";
  repairRecords: RepairRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceLog {
  id: string;
  vehicleId: string;
  vehicle: Vehicle;
  date: string;
  cost: number;
  description: string;
  odometer: number;
  createdAt: string;
}

export interface Equipment {
  id: string;
  name: string;
  serialNumber: string;
  status: "Active" | "In Use" | "Maintenance";
  repairRecords: RepairRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  subCategory: string;
  defaultRate: number;
  createdAt: string;
  updatedAt: string;
}

export interface StockLevel {
  id: string;
  inventoryItemId: string;
  inventoryItem: InventoryItem;
  stockLocationId: string;
  quantity: number;
  minThreshold: number;
}

export interface StockLocation {
  id: string;
  name: string;
  type: "Warehouse" | "Vehicle";
  vehicleId: string | null;
  vehicle: Vehicle | null;
  stockLevels: StockLevel[];
}

export interface JobAssignment {
  id: string;
  jobId: string;
  personnelId: string;
  personnel: Personnel;
}

export interface JobEquipment {
  id: string;
  jobId: string;
  equipmentId: string;
  equipment: Equipment;
}

export interface JobLineItem {
  id: string;
  jobId: string;
  inventoryItemId: string;
  inventoryItem: InventoryItem;
  quantity: number;
  rate: number;
  description: string;
}

export type JobStatus = "Scheduled" | "In Progress" | "Completed" | "Cancelled";
export type SyncStatus = "Pending" | "Exported";

export interface Job {
  id: string;
  clientId: string;
  client: Client;
  assignedVehicleId: string | null;
  vehicle: Vehicle | null;
  status: JobStatus;
  notes: string | null;
  scheduledDate: string;
  completionDate: string | null;
  qbInvoiceSyncStatus: SyncStatus;
  recurringTemplateId: string | null;
  assignments: JobAssignment[];
  equipment: JobEquipment[];
  lineItems: JobLineItem[];
  createdAt: string;
  updatedAt: string;
}

export type RecurrenceFrequency = "Weekly" | "Biweekly" | "Monthly";

export interface RecurringJobPersonnel {
  id: string;
  templateId: string;
  personnelId: string;
  personnel: Personnel;
}

export interface RecurringJobEquipment {
  id: string;
  templateId: string;
  equipmentId: string;
  equipment: Equipment;
}

export interface RecurringJobTemplate {
  id: string;
  clientId: string;
  client: Client;
  assignedVehicleId: string | null;
  vehicle: Vehicle | null;
  notes: string | null;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate: string | null;
  active: boolean;
  lastGeneratedDate: string | null;
  personnel: RecurringJobPersonnel[];
  equipment: RecurringJobEquipment[];
  createdAt: string;
  updatedAt: string;
}

export interface TimeEntry {
  id: string;
  jobId: string;
  job: { id: string; client: Client };
  personnelId: string;
  personnel: Personnel;
  date: string;
  duration: string;
  serviceItem: string;
  payrollItem: string;
  qbTimeSyncStatus: SyncStatus;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Dashboard aggregate
// ---------------------------------------------------------------------------

export interface DashboardData {
  license: LicenseInfo;
  /** Empty for Base-tier installs. */
  invoices: Invoice[];
  /** Empty for Base-tier installs. */
  quotes: Quote[];
  clients: Client[];
  personnel: Personnel[];
  vehicles: Vehicle[];
  equipment: Equipment[];
  stockLocations: StockLocation[];
  inventoryItems: InventoryItem[];
  jobs: Job[];
  timeEntries: TimeEntry[];
  maintenanceLogs: MaintenanceLog[];
  recurringJobTemplates: RecurringJobTemplate[];
  /** Field-sync records handed to the office by techs. Open items only. */
  syncReviewItems: SyncReviewItemData[];
}

export interface SyncReviewItemData {
  id: string;
  personnelId: string | null;
  personnel: { firstName: string; lastName: string } | null;
  url: string;
  method: string;
  body: Record<string, unknown>;
  queuedAt: string;
  rejectedAt: string;
  rejectionStatus: number;
  rejectionMessage: string;
  status: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Form state types
// ---------------------------------------------------------------------------

export interface NewJobForm {
  clientId: string;
  assignedVehicleId: string;
  scheduledDate: string;
  notes: string;
  personnelIds: string[];
  equipmentIds: string[];
}

export interface NewRecurringJobForm {
  clientId: string;
  assignedVehicleId: string;
  notes: string;
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate: string;
  personnelIds: string[];
  equipmentIds: string[];
}

export interface NewTimeForm {
  jobId: string;
  personnelId: string;
  date: string;
  hours: string;
  minutes: string;
  serviceItem: string;
  payrollItem: string;
}

export interface NewClientForm {
  name: string;
  contactName: string;
  locationAddress: string;
  paymentTerms: string;
}

export interface NewPersonnelForm {
  firstName: string;
  lastName: string;
  role: string;
  certifications: string;
}

export interface NewVehicleForm {
  vin: string;
  make: string;
  model: string;
  status: string;
}

export interface NewMaintenanceForm {
  date: string;
  cost: string;
  description: string;
  odometer: string;
}

export interface NewItemForm {
  name: string;
  category: string;
  subCategory: string;
  defaultRate: string;
}

export interface AdjustedStockForm {
  quantity: string;
  minThreshold: string;
}

export interface NewEquipmentForm {
  name: string;
  serialNumber: string;
  status: string;
}

export interface JobPartLine {
  inventoryItemId: string;
  quantity: number | string;
  rate: number | string;
  description: string;
}

// ---------------------------------------------------------------------------
// Modal state
// ---------------------------------------------------------------------------

export type ModalType =
  | "addJob"
  | "editJob"
  | "addRecurringJob"
  | "editRecurringJob"
  | "logTime"
  | "addParts"
  | "addClient"
  | "addPersonnel"
  | "addVehicle"
  | "addMaintenance"
  | "addItem"
  | "addWarehouse"
  | "adjustStock"
  | "bulkAdjustStock"
  | "transferStock"
  | "addEquipment"
  | "jobCosts"
  | "editPersonnel"
  | "reportRepair"
  | "manageUsers"
  | "fieldAccess"
  | "addClientNote"
  | "addFollowUp"
  | "editFollowUp"
  | "addQuote"
  | "addInvoice"
  | "recordPayment"
  | "syncReview"
  | "saveReport"
  | "reportFolder"
  | null;

// ---------------------------------------------------------------------------
// Auth / user management
// ---------------------------------------------------------------------------

export type UserRole = "superuser" | "admin" | "tech";

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  personnelId: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RepairContext {
  assetId: string;
  assetType: "vehicle" | "equipment";
  assetName: string;
}

export interface AdjustStockContext {
  itemId: string;
  locationId: string;
  itemName: string;
  locationName: string;
  currentQty: number;
  currentMin: number;
}

export interface AddPartsContext {
  jobId: string;
  existingParts: JobPartLine[];
  existingEquipmentIds: string[];
}
