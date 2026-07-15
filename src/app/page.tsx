"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import {
  Briefcase,
  Users,
  Truck,
  Package,
  FileSpreadsheet,
  AlertTriangle,
  Clock,
  TrendingUp,
  RotateCw,
  LogOut,
  ShieldCheck,
  QrCode,
  Settings,
  BarChart3,
  Receipt,
} from "lucide-react";

import { useDashboardData } from "@/hooks/useDashboardData";
import { AdjustStockContext, AppUser, Client, ClientFollowUp, Invoice, Job, ModalType, Personnel, RecurringJobTemplate, RepairContext, Vehicle } from "@/types";
import { dateToLocalStr } from "@/lib/dateUtils";

// Tabs
import OverviewTab from "@/components/tabs/OverviewTab";
import CRMTab from "@/components/tabs/CRMTab";
import SchedulingTab from "@/components/tabs/SchedulingTab";
import PersonnelTab from "@/components/tabs/PersonnelTab";
import FleetTab from "@/components/tabs/FleetTab";
import InventoryTab from "@/components/tabs/InventoryTab";
import AccountingTab from "@/components/tabs/AccountingTab";
import SettingsTab from "@/components/tabs/SettingsTab";
import AnalyticsTab from "@/components/tabs/AnalyticsTab";
import InvoicingTab from "@/components/tabs/InvoicingTab";

// Modals
import AddClientModal from "@/components/modals/AddClientModal";
import AddPersonnelModal from "@/components/modals/AddPersonnelModal";
import AddVehicleModal from "@/components/modals/AddVehicleModal";
import AddMaintenanceModal from "@/components/modals/AddMaintenanceModal";
import AddItemModal from "@/components/modals/AddItemModal";
import EditPersonnelModal from "@/components/modals/EditPersonnelModal";
import ReportRepairModal from "@/components/modals/ReportRepairModal";
import AdjustStockModal from "@/components/modals/AdjustStockModal";
import AddEquipmentModal from "@/components/modals/AddEquipmentModal";
import AddJobModal from "@/components/modals/AddJobModal";
import EditJobModal from "@/components/modals/EditJobModal";
import AddRecurringJobModal from "@/components/modals/AddRecurringJobModal";
import LogTimeModal from "@/components/modals/LogTimeModal";
import AllocateResourcesModal from "@/components/modals/AllocateResourcesModal";
import JobCostsModal from "@/components/modals/JobCostsModal";
import ManageUsersModal from "@/components/modals/ManageUsersModal";
import FieldAccessModal from "@/components/modals/FieldAccessModal";
import AddClientNoteModal from "@/components/modals/AddClientNoteModal";
import FollowUpModal from "@/components/modals/FollowUpModal";
import AddInvoiceModal from "@/components/modals/AddInvoiceModal";
import RecordPaymentModal from "@/components/modals/RecordPaymentModal";
import SyncReviewModal from "@/components/modals/SyncReviewModal";
import ConfirmDialog from "@/components/shared/ConfirmDialog";
import NotificationBell from "@/components/shared/NotificationBell";

// ---------------------------------------------------------------------------
// Types for modal context payloads
// ---------------------------------------------------------------------------
type TabId = "overview" | "crm" | "scheduling" | "personnel" | "fleet" | "inventory" | "analytics" | "invoicing" | "accounting" | "settings";

const TAB_LABELS: Record<TabId, string> = {
  overview: "Operations Overview",
  crm: "Clients & Jobs Ledger",
  scheduling: "Scheduling Engine",
  personnel: "Personnel & Labor Hours",
  fleet: "Fleet Logistics",
  inventory: "Inventory & Van Levels",
  analytics: "Business Analytics",
  invoicing: "Invoicing & Payments",
  accounting: "QuickBooks Export Sync",
  settings: "System Settings",
};

// plusOnly tabs are hidden without an active Plus license (the API routes
// behind them are also gated server-side — hiding here is convenience only).
const NAV: { id: TabId; label: string; icon: React.ReactNode; plusOnly?: boolean }[] = [
  { id: "overview", label: "Overview", icon: <TrendingUp className="h-4 w-4" /> },
  { id: "crm", label: "Clients & Jobs", icon: <Briefcase className="h-4 w-4" /> },
  { id: "scheduling", label: "Scheduling", icon: <Clock className="h-4 w-4" /> },
  { id: "personnel", label: "Personnel & Time", icon: <Users className="h-4 w-4" /> },
  { id: "fleet", label: "Fleet & Service", icon: <Truck className="h-4 w-4" /> },
  { id: "inventory", label: "Inventory Control", icon: <Package className="h-4 w-4" /> },
  { id: "analytics", label: "Analytics", icon: <BarChart3 className="h-4 w-4" />, plusOnly: true },
  { id: "invoicing", label: "Invoicing", icon: <Receipt className="h-4 w-4" />, plusOnly: true },
  { id: "accounting", label: "QuickBooks Sync", icon: <FileSpreadsheet className="h-4 w-4" /> },
  { id: "settings", label: "Settings", icon: <Settings className="h-4 w-4" /> },
];

// ---------------------------------------------------------------------------
// Helpers: CSV export
// ---------------------------------------------------------------------------
function calculateDueDate(dateStr: string, terms: string): string {
  const d = new Date(dateStr);
  const days = terms === "Net 15" ? 15 : terms === "Due on Receipt" ? 0 : 30;
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const content =
    "data:text/csv;charset=utf-8," +
    [headers.join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
  const link = document.createElement("a");
  link.setAttribute("href", encodeURI(content));
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function Dashboard() {
  const { data, loading, error, reload } = useDashboardData();

  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.ok ? r.json() : null)
      .then((u) => setCurrentUser(u))
      .catch(() => {});
  }, []);

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [toast, setToast] = useState<{ text: string; isError: boolean } | null>(null);

  // Context passed into modals that need extra data
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null);
  const [selectedPersonnel, setSelectedPersonnel] = useState<Personnel | null>(null);
  const [repairCtx, setRepairCtx] = useState<RepairContext | null>(null);
  const [adjustStockCtx, setAdjustStockCtx] = useState<AdjustStockContext | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [cloneSource, setCloneSource] = useState<Job | null>(null);
  const [selectedRecurringJob, setSelectedRecurringJob] = useState<RecurringJobTemplate | null>(null);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedFollowUp, setSelectedFollowUp] = useState<ClientFollowUp | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [invoiceMode, setInvoiceMode] = useState<"scratch" | "job">("scratch");

  // If the license is downgraded/expires, render Overview instead of a
  // now-hidden Plus tab (derived during render — no effect needed).
  const plus = data?.license.plus ?? false;
  const effectiveTab: TabId =
    !plus && (activeTab === "analytics" || activeTab === "invoicing") ? "overview" : activeTab;

  // Confirmation dialog state
  const [confirm, setConfirm] = useState<{
    title: string;
    message: string;
    destructive?: boolean;
    onConfirm: () => void;
  } | null>(null);

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------
  const showToast = (text: string, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => setToast(null), 5000);
  };

  const handleSuccess = (msg: string) => {
    reload();
    showToast(msg);
  };

  const handleError = (msg: string) => showToast(msg, true);

  const closeModal = () => {
    setActiveModal(null);
    setSelectedVehicle(null);
    setSelectedPersonnel(null);
    setRepairCtx(null);
    setAdjustStockCtx(null);
    setSelectedJob(null);
    setCloneSource(null);
    setSelectedRecurringJob(null);
    setSelectedClient(null);
    setSelectedFollowUp(null);
    setSelectedInvoice(null);
  };

  // ---------------------------------------------------------------------------
  // Plus tier — follow-up and invoice actions
  // ---------------------------------------------------------------------------
  const completeFollowUp = async (followUp: ClientFollowUp) => {
    try {
      const res = await fetch(`/api/follow-ups/${followUp.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: true }),
      });
      if (!res.ok) throw new Error("Failed to complete follow-up");
      handleSuccess("Follow-up marked completed.");
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to complete follow-up");
    }
  };

  const requestDeleteFollowUp = (followUp: ClientFollowUp) => {
    setConfirm({
      title: "Delete Follow-Up",
      message: "Delete this follow-up reminder? This cannot be undone.",
      destructive: true,
      onConfirm: () => {
        setConfirm(null);
        deleteFollowUp(followUp.id);
      },
    });
  };

  const deleteFollowUp = async (id: string) => {
    try {
      const res = await fetch(`/api/follow-ups/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete follow-up");
      handleSuccess("Follow-up deleted.");
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to delete follow-up");
    }
  };

  const markInvoiceSent = async (invoice: Invoice) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Sent" }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to mark invoice sent");
      handleSuccess(`${invoice.invoiceNumber} marked as Sent — payments can now be recorded.`);
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to mark invoice sent");
    }
  };

  const requestVoidInvoice = (invoice: Invoice) => {
    setConfirm({
      title: "Void Invoice",
      message: `Void ${invoice.invoiceNumber}? A voided invoice is kept for the record but can no longer accept payments. This cannot be undone.`,
      destructive: true,
      onConfirm: () => {
        setConfirm(null);
        voidInvoice(invoice);
      },
    });
  };

  const voidInvoice = async (invoice: Invoice) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "Void" }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to void invoice");
      handleSuccess(`${invoice.invoiceNumber} voided.`);
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to void invoice");
    }
  };

  const requestDeleteInvoice = (invoice: Invoice) => {
    setConfirm({
      title: "Delete Draft Invoice",
      message: `Permanently delete draft ${invoice.invoiceNumber}? Only unsent drafts can be deleted.`,
      destructive: true,
      onConfirm: () => {
        setConfirm(null);
        deleteInvoice(invoice);
      },
    });
  };

  const deleteInvoice = async (invoice: Invoice) => {
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to delete invoice");
      handleSuccess(`Draft ${invoice.invoiceNumber} deleted.`);
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to delete invoice");
    }
  };

  // ---------------------------------------------------------------------------
  // Job actions (with confirmation guards)
  // ---------------------------------------------------------------------------
  const startJob = async (jobId: string) => {
    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, status: "In Progress" }),
      });
      if (!res.ok) throw new Error("Failed to start job");
      handleSuccess("Job is now In Progress.");
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to start job");
    }
  };

  const handleCloneJob = (job: Job) => {
    setCloneSource(job);
    setActiveModal("addJob");
  };

  const requestCompleteJob = (jobId: string) => {
    setConfirm({
      title: "Complete Job",
      message:
        "Mark this job as Completed? This will deduct materials from the assigned van's inventory and cannot be undone.",
      onConfirm: () => {
        setConfirm(null);
        completeJob(jobId);
      },
    });
  };

  const requestCancelJob = (jobId: string) => {
    setConfirm({
      title: "Cancel Job",
      message: "Cancel this job? The status will be set to Cancelled. Assigned resources will be freed.",
      destructive: true,
      onConfirm: () => {
        setConfirm(null);
        cancelJob(jobId);
      },
    });
  };

  const completeJob = async (jobId: string) => {
    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, status: "Completed" }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to complete job");
      handleSuccess("Job completed! Van inventory updated.");
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to complete job");
    }
  };

  const requestReopenJob = (jobId: string) => {
    setConfirm({
      title: "Re-open Job",
      message:
        "Are you sure you want to re-open this job? This will set status to In Progress and reverse any material inventory deductions.",
      onConfirm: () => {
        setConfirm(null);
        reopenJob(jobId);
      },
    });
  };

  const reopenJob = async (jobId: string) => {
    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, status: "In Progress" }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to re-open job");
      handleSuccess("Job is now In Progress. Van inventory deductions reversed.");
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to re-open job");
    }
  };

  const cancelJob = async (jobId: string) => {
    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, status: "Cancelled" }),
      });
      if (!res.ok) throw new Error("Failed to cancel job");
      handleSuccess("Job status updated to Cancelled.");
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to cancel job");
    }
  };

  // ---------------------------------------------------------------------------
  // Recurring job actions
  // ---------------------------------------------------------------------------
  const generateRecurringJob = async (template: RecurringJobTemplate) => {
    try {
      const res = await fetch("/api/recurring-jobs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ templateId: template.id }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to generate jobs");
      const createdCount: number = result.created?.length ?? 0;
      const skippedCount: number = result.skipped?.length ?? 0;
      if (createdCount === 0 && skippedCount === 0) {
        handleSuccess("No new occurrences to generate — check the end date or last generated date.");
      } else if (skippedCount === 0) {
        handleSuccess(`Generated ${createdCount} job${createdCount !== 1 ? "s" : ""}.`);
      } else {
        handleSuccess(
          `Generated ${createdCount} job${createdCount !== 1 ? "s" : ""}; skipped ${skippedCount} occurrence${skippedCount !== 1 ? "s" : ""} due to conflicts.`
        );
      }
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to generate jobs");
    }
  };

  const toggleRecurringActive = async (template: RecurringJobTemplate) => {
    try {
      const res = await fetch("/api/recurring-jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: template.id, active: !template.active }),
      });
      if (!res.ok) throw new Error("Failed to update recurring job");
      handleSuccess(template.active ? "Recurring job paused." : "Recurring job resumed.");
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to update recurring job");
    }
  };

  const requestDeleteRecurringJob = (template: RecurringJobTemplate) => {
    setConfirm({
      title: "Delete Recurring Job",
      message: `Delete the recurring job for ${template.client.name}? Already-generated jobs are kept — only the template is removed.`,
      destructive: true,
      onConfirm: () => {
        setConfirm(null);
        deleteRecurringJob(template.id);
      },
    });
  };

  const deleteRecurringJob = async (id: string) => {
    try {
      const res = await fetch("/api/recurring-jobs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error("Failed to delete recurring job");
      handleSuccess("Recurring job deleted.");
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to delete recurring job");
    }
  };

  // ---------------------------------------------------------------------------
  // Repair actions
  // ---------------------------------------------------------------------------
  const requestResolveRepair = (repairId: string, assetId: string, assetType: "vehicle" | "equipment", assetName: string) => {
    setConfirm({
      title: "Mark Repair Resolved",
      message: `Mark ${assetName} as repaired and return it to Active status?`,
      onConfirm: () => {
        setConfirm(null);
        resolveRepair(repairId, assetId, assetType, assetName);
      },
    });
  };

  const resolveRepair = async (repairId: string, assetId: string, assetType: "vehicle" | "equipment", assetName: string) => {
    try {
      const res = await fetch("/api/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resolve_repair", repairId, assetId, assetType }),
      });
      if (!res.ok) throw new Error("Failed to resolve repair");
      handleSuccess(`${assetName} returned to Active status.`);
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to resolve repair");
    }
  };

  // ---------------------------------------------------------------------------
  // Inventory remove
  // ---------------------------------------------------------------------------
  const requestRemoveStock = (ctx: { itemId: string; locationId: string; itemName: string; locationName: string }) => {
    setConfirm({
      title: "Remove Item from Location",
      message: `Remove "${ctx.itemName}" from ${ctx.locationName}? This only removes it from this location — the catalog item is kept.`,
      destructive: true,
      onConfirm: () => {
        setConfirm(null);
        removeStock(ctx.itemId, ctx.locationId);
      },
    });
  };

  const requestDeleteItem = (itemId: string, itemName: string) => {
    setConfirm({
      title: "Delete Catalog Item",
      message: `Permanently delete "${itemName}" from the catalog? This will also remove it from all stock locations. Items used on past invoices cannot be deleted.`,
      destructive: true,
      onConfirm: () => {
        setConfirm(null);
        deleteItem(itemId);
      },
    });
  };

  const deleteItem = async (inventoryItemId: string) => {
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_item", inventoryItemId }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to delete item");
      handleSuccess("Catalog item deleted.");
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to delete item");
    }
  };

  const removeStock = async (inventoryItemId: string, stockLocationId: string) => {
    try {
      const res = await fetch("/api/inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "remove_stock_level", inventoryItemId, stockLocationId }),
      });
      if (!res.ok) throw new Error("Failed to remove item from location");
      handleSuccess("Item removed from location.");
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Failed to remove item");
    }
  };

  // ---------------------------------------------------------------------------
  // QuickBooks CSV exports
  // ---------------------------------------------------------------------------
  const exportInvoiceCSV = () => {
    if (!data) return;
    const jobs = data.jobs.filter(
      (j) => j.status === "Completed" && j.qbInvoiceSyncStatus === "Pending"
    );
    if (jobs.length === 0) { showToast("No completed, unsynced jobs to export.", true); return; }

    const headers = ["Invoice number", "Customer", "Invoice date", "Due date", "Item(Product/Service)", "Item amount", "Item description"];
    const rows: string[][] = [];

    jobs.forEach((job) => {
      const invoiceDate = dateToLocalStr(job.completionDate || job.updatedAt);
      const dueDate = calculateDueDate(invoiceDate, job.client.paymentTerms);
      if (job.lineItems.length > 0) {
        job.lineItems.forEach((item) => {
          rows.push([
            job.id,
            job.client.name,
            invoiceDate,
            dueDate,
            `${item.inventoryItem.category}:${item.inventoryItem.subCategory}:${item.inventoryItem.name}`,
            (item.quantity * item.rate).toFixed(2),
            item.description || "",
          ]);
        });
      } else {
        rows.push([job.id, job.client.name, invoiceDate, dueDate, "Operations:Service:General Job", "0.00", "Completed general field operations service."]);
      }
    });

    downloadCSV(`qb_invoices_export_${new Date().toISOString().split("T")[0]}.csv`, headers, rows);
    showToast("Invoice CSV downloaded successfully.");
  };

  const exportTimeCSV = () => {
    if (!data) return;
    const entries = data.timeEntries.filter((e) => e.qbTimeSyncStatus === "Pending");
    if (entries.length === 0) { showToast("No unsynced time entries to export.", true); return; }

    const headers = ["Name", "Transaction Date", "Customer", "Service Item", "Payroll item", "Duration"];
    const rows = entries.map((e) => [
      `${e.personnel.firstName} ${e.personnel.lastName}`,
      dateToLocalStr(e.date),
      e.job.client.name,
      e.serviceItem || "Field Labor",
      e.payrollItem || "Regular Pay",
      e.duration,
    ]);

    downloadCSV(`qb_time_export_${new Date().toISOString().split("T")[0]}.csv`, headers, rows);
    showToast("Labor Time CSV downloaded successfully.");
  };

  const requestMarkSynced = () => {
    if (!data) return;
    const jobCount = data.jobs.filter((j) => j.status === "Completed" && j.qbInvoiceSyncStatus === "Pending").length;
    const timeCount = data.timeEntries.filter((e) => e.qbTimeSyncStatus === "Pending").length;
    if (jobCount === 0 && timeCount === 0) { showToast("No pending sync data exists.", true); return; }

    setConfirm({
      title: "Lock Sync Records",
      message: `This will permanently mark ${jobCount} invoice(s) and ${timeCount} timesheet(s) as Exported. This action cannot be undone.`,
      onConfirm: () => {
        setConfirm(null);
        markSynced();
      },
    });
  };

  const markSynced = async () => {
    if (!data) return;
    const jobIds = data.jobs
      .filter((j) => j.status === "Completed" && j.qbInvoiceSyncStatus === "Pending")
      .map((j) => j.id);
    const timeEntryIds = data.timeEntries
      .filter((e) => e.qbTimeSyncStatus === "Pending")
      .map((e) => e.id);
    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobIds, timeEntryIds }),
      });
      if (!res.ok) throw new Error("Sync lock request failed");
      handleSuccess("Successfully marked all items as 'Exported'.");
    } catch (err: unknown) {
      handleError(err instanceof Error ? err.message : "Sync failed");
    }
  };

  // ---------------------------------------------------------------------------
  // Loading / error states
  // ---------------------------------------------------------------------------
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-900">
        <div className="flex flex-col items-center gap-4">
          <RotateCw className="h-8 w-8 animate-spin text-zinc-600" />
          <p className="text-sm font-medium uppercase tracking-widest text-zinc-500">
            Loading Operations Dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-50 text-zinc-900">
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-600 mb-4" />
          <h2 className="text-xl font-bold mb-2">Operational System Error</h2>
          <p className="text-zinc-600 mb-4">{error}</p>
          <button
            onClick={reload}
            className="px-4 py-2 bg-blue-700 text-white hover:bg-blue-800 text-sm uppercase tracking-wider font-semibold rounded transition-colors"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // KPI counts for header badge
  // ---------------------------------------------------------------------------
  const unsyncedTotal =
    data.jobs.filter((j) => j.status === "Completed" && j.qbInvoiceSyncStatus === "Pending").length +
    data.timeEntries.filter((t) => t.qbTimeSyncStatus === "Pending").length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex min-h-screen bg-zinc-50 text-zinc-900 font-sans antialiased">
      {/* Sidebar */}
      <aside className="w-64 bg-zinc-900 text-zinc-400 flex flex-col border-r border-zinc-800 shrink-0">
        <div className="p-6 border-b border-zinc-800 flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="WVO Logo"
            width={40}
            height={40}
            unoptimized
            className="h-10 w-10 object-contain rounded"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
          />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">
              Fleet Operations
            </span>
            <span className="text-sm font-bold text-white tracking-tight uppercase">
              WHITE VAN OPS
            </span>
          </div>
        </div>
        <nav className="flex-1 px-4 py-6 space-y-1">
          {NAV.filter(navItem => navItem.id !== "settings" || (currentUser && (currentUser.role === "superuser" || currentUser.role === "admin")))
            .filter(navItem => !navItem.plusOnly || plus)
            .map(({ id, label, icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium tracking-wide uppercase transition-colors rounded border-l-2 ${
                effectiveTab === id
                  ? "bg-zinc-800 text-white border-blue-600"
                  : "border-transparent hover:bg-zinc-800 hover:text-zinc-200"
              }`}
            >
              {icon}
              {label}
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-zinc-800 space-y-3">
          {currentUser && (
            <div className="px-3 py-2 bg-zinc-800 rounded">
              <p className="text-xs font-bold text-white truncate">{currentUser.displayName}</p>
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 mt-0.5">
                {currentUser.role === "superuser" ? "Superuser" : currentUser.role === "admin" ? "Admin" : "Field Tech"}
              </p>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Local DB Linked
            </span>
          </div>
          {currentUser?.role === "superuser" && (
            <button
              onClick={() => setActiveModal("manageUsers")}
              className="flex items-center gap-2 px-3 py-2 rounded hover:bg-zinc-800 text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-300 transition-colors w-full"
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Manage Users
            </button>
          )}
          <button
            onClick={() => setActiveModal("fieldAccess")}
            className="flex items-center gap-2 px-3 py-2 rounded hover:bg-zinc-800 text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-300 transition-colors w-full"
          >
            <QrCode className="h-3.5 w-3.5" />
            Field Access QR
          </button>
          <a
            href="/field"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-xs font-bold uppercase tracking-wide text-zinc-300 hover:text-white transition-colors w-full"
          >
            <Truck className="h-3.5 w-3.5" />
            Field Module →
          </a>
          <button
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              window.location.href = "/login";
            }}
            className="flex items-center gap-2 px-3 py-2 rounded hover:bg-zinc-800 text-xs font-medium uppercase tracking-wide text-zinc-500 hover:text-zinc-300 transition-colors w-full"
          >
            <LogOut className="h-3.5 w-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 border-b border-zinc-200 px-8 bg-white flex items-center justify-between shrink-0">
          <h1 className="text-xl font-bold uppercase tracking-wide text-zinc-800">
            {TAB_LABELS[effectiveTab]}
          </h1>
          <div className="flex items-center gap-4">
            {unsyncedTotal > 0 && (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold bg-zinc-900 text-white rounded-full uppercase tracking-wider">
                <AlertTriangle className="h-3 w-3 text-yellow-400" />
                {unsyncedTotal} Unsynced
              </span>
            )}
            <NotificationBell data={data} onNavigate={(target) => setActiveTab(target)} />
            <button
              onClick={reload}
              title="Refresh data"
              className="p-2 border border-zinc-200 text-zinc-600 hover:bg-zinc-50 rounded transition-colors"
            >
              <RotateCw className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Toast notification */}
        {toast && (
          <div
            className={`mx-8 mt-4 p-4 border flex items-center justify-between rounded ${
              toast.isError
                ? "bg-red-50 border-red-200 text-red-900"
                : "bg-emerald-50 border-emerald-200 text-emerald-900"
            }`}
          >
            <span className="text-sm font-semibold tracking-wide uppercase">{toast.text}</span>
            <button
              onClick={() => setToast(null)}
              className="text-xs uppercase tracking-wider font-bold ml-4 opacity-70 hover:opacity-100"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Tab content */}
        <div className="flex-1 p-8 overflow-y-auto">
          {effectiveTab === "overview" && (
            <OverviewTab data={data} onOpenSyncReview={() => setActiveModal("syncReview")} />
          )}

          {effectiveTab === "crm" && (
            <CRMTab
              data={data}
              onAddClient={() => setActiveModal("addClient")}
              onAddJob={() => setActiveModal("addJob")}
              onStartJob={startJob}
              onCompleteJob={requestCompleteJob}
              onCancelJob={requestCancelJob}
              onCloneJob={handleCloneJob}
              onOpenResources={(job) => { setSelectedJob(job); setActiveModal("addParts"); }}
              onOpenCosts={(job) => { setSelectedJob(job); setActiveModal("jobCosts"); }}
              onEditJob={(job) => { setSelectedJob(job); setActiveModal("editJob"); }}
              onReopenJob={requestReopenJob}
              onAddRecurringJob={() => setActiveModal("addRecurringJob")}
              onEditRecurringJob={(t) => { setSelectedRecurringJob(t); setActiveModal("editRecurringJob"); }}
              onGenerateRecurringJob={generateRecurringJob}
              onToggleRecurringActive={toggleRecurringActive}
              onDeleteRecurringJob={requestDeleteRecurringJob}
              onAddNote={(client) => { setSelectedClient(client); setActiveModal("addClientNote"); }}
              onAddFollowUp={(client) => { setSelectedClient(client); setActiveModal("addFollowUp"); }}
              onEditFollowUp={(client, followUp) => { setSelectedClient(client); setSelectedFollowUp(followUp); setActiveModal("editFollowUp"); }}
              onToggleFollowUp={completeFollowUp}
              onDeleteFollowUp={requestDeleteFollowUp}
            />
          )}

          {effectiveTab === "scheduling" && <SchedulingTab data={data} />}

          {effectiveTab === "personnel" && (
            <PersonnelTab
              data={data}
              onAddPersonnel={() => setActiveModal("addPersonnel")}
              onLogTime={() => setActiveModal("logTime")}
              onEditPersonnel={(p) => { setSelectedPersonnel(p); setActiveModal("editPersonnel"); }}
            />
          )}

          {effectiveTab === "fleet" && (
            <FleetTab
              data={data}
              onAddVehicle={() => setActiveModal("addVehicle")}
              onAddEquipment={() => setActiveModal("addEquipment")}
              onAddMaintenance={(v) => { setSelectedVehicle(v); setActiveModal("addMaintenance"); }}
              onReportRepair={(ctx) => { setRepairCtx(ctx); setActiveModal("reportRepair"); }}
              onResolveRepair={requestResolveRepair}
            />
          )}

          {effectiveTab === "inventory" && (
            <InventoryTab
              data={data}
              onAddItem={() => setActiveModal("addItem")}
              onAdjustStock={(ctx) => { setAdjustStockCtx(ctx); setActiveModal("adjustStock"); }}
              onRemoveStock={requestRemoveStock}
              onDeleteItem={requestDeleteItem}
            />
          )}

          {effectiveTab === "analytics" && plus && <AnalyticsTab />}

          {effectiveTab === "invoicing" && plus && (
            <InvoicingTab
              data={data}
              onAddInvoice={(mode) => { setInvoiceMode(mode); setActiveModal("addInvoice"); }}
              onMarkSent={markInvoiceSent}
              onRecordPayment={(inv) => { setSelectedInvoice(inv); setActiveModal("recordPayment"); }}
              onVoidInvoice={requestVoidInvoice}
              onDeleteInvoice={requestDeleteInvoice}
            />
          )}

          {effectiveTab === "accounting" && (
            <AccountingTab
              data={data}
              onExportInvoices={exportInvoiceCSV}
              onExportTime={exportTimeCSV}
              onMarkSynced={requestMarkSynced}
            />
          )}

          {effectiveTab === "settings" && (
            <SettingsTab
              onShowToast={showToast}
              isSuperuser={currentUser?.role === "superuser"}
              onLicenseChanged={reload}
            />
          )}
        </div>
      </main>

      {/* ------------------------------------------------------------------ */}
      {/* Modals                                                               */}
      {/* ------------------------------------------------------------------ */}
      {activeModal === "addClient" && (
        <AddClientModal onClose={closeModal} onSuccess={handleSuccess} onError={handleError} />
      )}
      {activeModal === "addPersonnel" && (
        <AddPersonnelModal onClose={closeModal} onSuccess={handleSuccess} onError={handleError} />
      )}
      {activeModal === "addVehicle" && (
        <AddVehicleModal onClose={closeModal} onSuccess={handleSuccess} onError={handleError} />
      )}
      {activeModal === "addMaintenance" && selectedVehicle && (
        <AddMaintenanceModal
          vehicle={selectedVehicle}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "addItem" && (
        <AddItemModal onClose={closeModal} onSuccess={handleSuccess} onError={handleError} />
      )}
      {activeModal === "adjustStock" && adjustStockCtx && (
        <AdjustStockModal
          context={adjustStockCtx}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "reportRepair" && repairCtx && (
        <ReportRepairModal
          context={repairCtx}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "editPersonnel" && selectedPersonnel && (
        <EditPersonnelModal
          personnel={selectedPersonnel}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "addEquipment" && (
        <AddEquipmentModal onClose={closeModal} onSuccess={handleSuccess} onError={handleError} />
      )}
      {activeModal === "addJob" && (
        <AddJobModal
          data={data}
          initialValues={cloneSource ? {
            clientId: cloneSource.clientId,
            assignedVehicleId: cloneSource.assignedVehicleId ?? "",
            notes: cloneSource.notes ?? "",
            personnelIds: cloneSource.assignments.map((a) => a.personnelId),
            equipmentIds: cloneSource.equipment.map((e) => e.equipmentId),
            scheduledDate: "",
          } : undefined}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "logTime" && (
        <LogTimeModal data={data} onClose={closeModal} onSuccess={handleSuccess} onError={handleError} />
      )}
      {activeModal === "addParts" && selectedJob && (
        <AllocateResourcesModal
          context={{
            jobId: selectedJob.id,
            existingParts: selectedJob.lineItems.map((li) => ({
              inventoryItemId: li.inventoryItemId,
              quantity: li.quantity,
              rate: li.rate,
              description: li.description,
            })),
            existingEquipmentIds: selectedJob.equipment.map((e) => e.equipmentId),
          }}
          data={data}
          job={selectedJob}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "editJob" && selectedJob && (
        <EditJobModal
          job={selectedJob}
          data={data}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "addRecurringJob" && (
        <AddRecurringJobModal
          data={data}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "editRecurringJob" && selectedRecurringJob && (
        <AddRecurringJobModal
          data={data}
          template={selectedRecurringJob}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "jobCosts" && selectedJob && (
        <JobCostsModal
          job={selectedJob}
          timeEntries={data.timeEntries}
          onClose={closeModal}
        />
      )}

      {activeModal === "manageUsers" && (
        <ManageUsersModal onClose={closeModal} />
      )}

      {activeModal === "fieldAccess" && (
        <FieldAccessModal onClose={closeModal} />
      )}

      {activeModal === "addClientNote" && selectedClient && (
        <AddClientNoteModal
          client={selectedClient}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "addFollowUp" && selectedClient && (
        <FollowUpModal
          client={selectedClient}
          personnel={data.personnel}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "editFollowUp" && selectedClient && selectedFollowUp && (
        <FollowUpModal
          client={selectedClient}
          personnel={data.personnel}
          followUp={selectedFollowUp}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "addInvoice" && (
        <AddInvoiceModal
          data={data}
          mode={invoiceMode}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "recordPayment" && selectedInvoice && (
        <RecordPaymentModal
          invoice={selectedInvoice}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}
      {activeModal === "syncReview" && (
        <SyncReviewModal
          items={data.syncReviewItems}
          jobs={data.jobs}
          onClose={closeModal}
          onSuccess={handleSuccess}
          onError={handleError}
        />
      )}

      {/* Confirmation dialog (rendered above modals) */}
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          destructive={confirm.destructive}
          confirmLabel={confirm.destructive ? "Yes, Proceed" : "Confirm"}
          onConfirm={confirm.onConfirm}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
