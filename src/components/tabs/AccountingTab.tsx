"use client";

import { FileSpreadsheet, CheckCircle } from "lucide-react";
import { DashboardData } from "@/types";
import { dateToLocalStr } from "@/lib/dateUtils";

interface Props {
  data: DashboardData;
  onExportInvoices: () => void;
  onExportTime: () => void;
  onMarkSynced: () => void;
}

export default function AccountingTab({ data, onExportInvoices, onExportTime, onMarkSynced }: Props) {
  const pendingJobs = data.jobs.filter(
    (j) => j.status === "Completed" && j.qbInvoiceSyncStatus === "Pending"
  );
  const pendingTime = data.timeEntries.filter((e) => e.qbTimeSyncStatus === "Pending");

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200">
        <div>
          <h3 className="text-base font-bold uppercase text-zinc-800">QuickBooks Online Accounting Sync</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Export completed invoices and technician timesheets matching QuickBooks Online import structures.
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onExportInvoices}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-zinc-300 hover:bg-zinc-50 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Export Invoices CSV
          </button>
          <button
            onClick={onExportTime}
            className="inline-flex items-center gap-1.5 px-4 py-2 border border-zinc-300 hover:bg-zinc-50 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Export Time CSV
          </button>
          <button
            onClick={onMarkSynced}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-blue-700 text-white hover:bg-blue-800 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <CheckCircle className="h-3.5 w-3.5 text-emerald-400" />
            Mark Synced (Lock)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Pending invoices */}
        <div className="bg-white border border-zinc-200 rounded p-6">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
            Pending Invoice Lines ({pendingJobs.length} completed jobs)
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                  <th className="py-2 px-3">Invoice</th>
                  <th className="py-2 px-3">Customer</th>
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Service Item</th>
                  <th className="py-2 px-3 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-xs">
                {pendingJobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 px-3 text-center text-zinc-500">
                      No pending invoice exports.
                    </td>
                  </tr>
                ) : (
                  pendingJobs.map((job) => {
                    const invoiceDate = dateToLocalStr(job.completionDate || job.updatedAt);
                    if (job.lineItems.length > 0) {
                      return job.lineItems.map((item, idx) => (
                        <tr key={`${job.id}-${idx}`} className="hover:bg-zinc-50">
                          <td className="py-2.5 px-3 font-mono text-[10px]">
                            #{job.id.substring(0, 8)}
                          </td>
                          <td className="py-2.5 px-3 font-medium">{job.client.name}</td>
                          <td className="py-2.5 px-3">{invoiceDate}</td>
                          <td className="py-2.5 px-3 text-zinc-500 font-mono text-[10px]">
                            {item.inventoryItem.category}:{item.inventoryItem.subCategory}:
                            {item.inventoryItem.name}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-zinc-700">
                            ${(item.quantity * item.rate).toFixed(2)}
                          </td>
                        </tr>
                      ));
                    }
                    return (
                      <tr key={job.id} className="hover:bg-zinc-50">
                        <td className="py-2.5 px-3 font-mono text-[10px]">
                          #{job.id.substring(0, 8)}
                        </td>
                        <td className="py-2.5 px-3 font-medium">{job.client.name}</td>
                        <td className="py-2.5 px-3">{invoiceDate}</td>
                        <td className="py-2.5 px-3 text-zinc-400 italic">
                          Operations:Service:General Job
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-zinc-700">$0.00</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pending timesheets */}
        <div className="bg-white border border-zinc-200 rounded p-6">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-3">
            Pending Timesheets ({pendingTime.length} entries)
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-zinc-50 border-b border-zinc-200 text-[9px] font-bold uppercase tracking-wider text-zinc-500">
                  <th className="py-2 px-3">Technician</th>
                  <th className="py-2 px-3">Customer</th>
                  <th className="py-2 px-3">Date</th>
                  <th className="py-2 px-3">Payroll Type</th>
                  <th className="py-2 px-3 text-right">Duration</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 text-xs">
                {pendingTime.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 px-3 text-center text-zinc-500">
                      No pending timesheet exports.
                    </td>
                  </tr>
                ) : (
                  pendingTime.map((entry) => (
                    <tr key={entry.id} className="hover:bg-zinc-50">
                      <td className="py-2.5 px-3 font-medium">
                        {entry.personnel.firstName} {entry.personnel.lastName}
                      </td>
                      <td className="py-2.5 px-3">{entry.job.client.name}</td>
                      <td className="py-2.5 px-3">{dateToLocalStr(entry.date)}</td>
                      <td className="py-2.5 px-3 text-zinc-500">{entry.payrollItem}</td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-zinc-700">
                        {entry.duration}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
