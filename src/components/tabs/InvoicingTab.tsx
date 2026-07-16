"use client";

import { useState } from "react";
import { Plus, FileText, Send, Ban, Trash2, DollarSign } from "lucide-react";
import { DashboardData, Invoice, InvoiceStatus } from "@/types";
import { formatDate, todayLocalStr, dateToLocalStr } from "@/lib/dateUtils";
import { computeInvoiceTotal, computePaidTotal } from "@/lib/invoice";

const STATUS_STYLES: Record<InvoiceStatus, string> = {
  Draft: "bg-zinc-100 text-zinc-600",
  Sent: "bg-blue-50 text-blue-700",
  PartiallyPaid: "bg-amber-50 text-amber-700",
  Paid: "bg-emerald-50 text-emerald-700",
  Void: "bg-zinc-100 text-zinc-400 line-through",
};

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  Draft: "Draft",
  Sent: "Sent",
  PartiallyPaid: "Partially Paid",
  Paid: "Paid",
  Void: "Void",
};

const ALL_FILTERS = ["All", "Draft", "Sent", "PartiallyPaid", "Paid", "Void"] as const;

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  data: DashboardData;
  onAddInvoice: (mode: "scratch" | "job") => void;
  onMarkSent: (invoice: Invoice) => void;
  onRecordPayment: (invoice: Invoice) => void;
  onVoidInvoice: (invoice: Invoice) => void;
  onDeleteInvoice: (invoice: Invoice) => void;
}

export default function InvoicingTab({
  data,
  onAddInvoice,
  onMarkSent,
  onRecordPayment,
  onVoidInvoice,
  onDeleteInvoice,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<(typeof ALL_FILTERS)[number]>("All");

  const invoices = data.invoices;
  const filtered = statusFilter === "All" ? invoices : invoices.filter((i) => i.status === statusFilter);

  const today = todayLocalStr();
  const open = invoices.filter((i) => i.status === "Sent" || i.status === "PartiallyPaid");
  const outstanding = open.reduce(
    (sum, i) => sum + computeInvoiceTotal(i.lineItems) - computePaidTotal(i.payments),
    0
  );
  const overdueCount = open.filter((i) => dateToLocalStr(i.dueDate) < today).length;
  const collected = invoices
    .filter((i) => i.status !== "Void")
    .reduce((sum, i) => sum + computePaidTotal(i.payments), 0);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200">
        <div>
          <h3 className="text-base font-bold uppercase text-zinc-800">Invoicing & Payments</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Internal accounts-receivable ledger with PDF invoices. Independent of the QuickBooks CSV export.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onAddInvoice("scratch")}
            className="inline-flex items-center gap-1.5 px-3 py-2 border border-zinc-300 hover:bg-zinc-100 text-zinc-700 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Manual Invoice
          </button>
          <button
            onClick={() => onAddInvoice("job")}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-700 text-white hover:bg-blue-800 text-xs font-bold uppercase tracking-wider rounded transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            Bill Completed Job
          </button>
        </div>
      </div>

      {/* AR summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-zinc-200 rounded p-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Outstanding AR</p>
          <p className="text-2xl font-bold text-zinc-900 mt-1">{money(outstanding)}</p>
        </div>
        <div className="bg-white border border-zinc-200 rounded p-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Overdue Invoices</p>
          <p className={`text-2xl font-bold mt-1 ${overdueCount > 0 ? "text-red-600" : "text-zinc-900"}`}>
            {overdueCount}
          </p>
        </div>
        <div className="bg-white border border-zinc-200 rounded p-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Collected (All Time)</p>
          <p className="text-2xl font-bold text-zinc-900 mt-1">{money(collected)}</p>
        </div>
      </div>

      {/* Invoice table */}
      <div className="bg-white border border-zinc-200 rounded overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-200 bg-zinc-50">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mr-2">Filter:</span>
          {ALL_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 text-[10px] font-bold uppercase tracking-wider rounded transition-colors ${
                statusFilter === s
                  ? "bg-zinc-900 text-white"
                  : "border border-zinc-300 text-zinc-600 hover:bg-zinc-100"
              }`}
            >
              {s === "PartiallyPaid" ? "Partial" : s}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-zinc-400">{filtered.length} invoices</span>
        </div>

        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
              <th className="py-3.5 px-6">Invoice #</th>
              <th className="py-3.5 px-6">Client</th>
              <th className="py-3.5 px-6">Issued</th>
              <th className="py-3.5 px-6">Due</th>
              <th className="py-3.5 px-6 text-right">Total</th>
              <th className="py-3.5 px-6 text-right">Balance</th>
              <th className="py-3.5 px-6">Status</th>
              <th className="py-3.5 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-200 text-sm">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 px-6 text-center text-zinc-500">
                  {invoices.length === 0
                    ? "No invoices yet. Create one above — you can prefill from any completed job."
                    : "No invoices match the selected filter."}
                </td>
              </tr>
            ) : (
              filtered.map((inv) => {
                const total = computeInvoiceTotal(inv.lineItems);
                const balance = total - computePaidTotal(inv.payments);
                const overdue =
                  (inv.status === "Sent" || inv.status === "PartiallyPaid") &&
                  dateToLocalStr(inv.dueDate) < today;
                return (
                  <tr key={inv.id} className="hover:bg-zinc-50">
                    <td className="py-4 px-6 font-mono text-xs font-bold text-zinc-700 align-top">
                      {inv.invoiceNumber}
                    </td>
                    <td className="py-4 px-6 font-semibold align-top">{inv.client.name}</td>
                    <td className="py-4 px-6 text-zinc-600 align-top">{formatDate(inv.issueDate)}</td>
                    <td className={`py-4 px-6 align-top ${overdue ? "text-red-600 font-semibold" : "text-zinc-600"}`}>
                      {formatDate(inv.dueDate)}
                      {overdue && <span className="block text-[10px] uppercase font-bold">Overdue</span>}
                    </td>
                    <td className="py-4 px-6 text-right align-top">{money(total)}</td>
                    <td className="py-4 px-6 text-right align-top font-semibold">
                      {inv.status === "Void" ? "—" : money(balance)}
                    </td>
                    <td className="py-4 px-6 align-top">
                      <span
                        className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded ${STATUS_STYLES[inv.status]}`}
                      >
                        {STATUS_LABELS[inv.status]}
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right align-top">
                      <div className="flex items-center justify-end gap-2 flex-wrap">
                        <a
                          href={`/api/invoices/${inv.id}/pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1 text-xs border border-zinc-300 hover:bg-zinc-50 font-bold uppercase tracking-wide rounded inline-flex items-center gap-1"
                          title="Open PDF"
                        >
                          <FileText className="h-3 w-3" />
                          PDF
                        </a>
                        {inv.status === "Draft" && (
                          <>
                            <button
                              onClick={() => onMarkSent(inv)}
                              className="px-2.5 py-1 text-xs bg-blue-700 hover:bg-blue-800 text-white font-bold uppercase tracking-wide rounded inline-flex items-center gap-1"
                            >
                              <Send className="h-3 w-3" />
                              Mark Sent
                            </button>
                            <button
                              onClick={() => onDeleteInvoice(inv)}
                              className="p-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded"
                              title="Delete draft"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        )}
                        {(inv.status === "Sent" || inv.status === "PartiallyPaid") && (
                          <>
                            <button
                              onClick={() => onRecordPayment(inv)}
                              className="px-2.5 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase tracking-wide rounded inline-flex items-center gap-1"
                            >
                              <DollarSign className="h-3 w-3" />
                              Payment
                            </button>
                            {inv.payments.length === 0 && (
                              <button
                                onClick={() => onVoidInvoice(inv)}
                                className="px-2.5 py-1 text-xs border border-red-200 hover:bg-red-50 text-red-700 font-bold uppercase tracking-wide rounded inline-flex items-center gap-1"
                                title="Void this invoice"
                              >
                                <Ban className="h-3 w-3" />
                                Void
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
