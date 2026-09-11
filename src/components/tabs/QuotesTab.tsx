"use client";

import { useState } from "react";
import { Plus, FileText, Send, Check, X, Trash2, ArrowRight } from "lucide-react";
import { DashboardData, Quote, QuoteStatus } from "@/types";
import { formatDate } from "@/lib/dateUtils";
import { canConvertQuote, computeQuoteTotal, deriveQuoteStatus } from "@/lib/quote";

const STATUS_STYLES: Record<QuoteStatus, string> = {
  Draft: "bg-zinc-100 text-zinc-600",
  Sent: "bg-blue-50 text-blue-700",
  Approved: "bg-emerald-50 text-emerald-700",
  Declined: "bg-red-50 text-red-700",
  Expired: "bg-amber-50 text-amber-700",
  Converted: "bg-zinc-900 text-white",
};

const ALL_FILTERS = ["All", "Draft", "Sent", "Approved", "Declined", "Expired", "Converted"] as const;

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Props {
  data: DashboardData;
  onAddQuote: () => void;
  onSendQuote: (quote: Quote) => void;
  onRecordDecision: (quote: Quote, decision: "Approved" | "Declined") => void;
  onConvertQuote: (quote: Quote) => void;
  onDeleteQuote: (quote: Quote) => void;
}

export default function QuotesTab({
  data,
  onAddQuote,
  onSendQuote,
  onRecordDecision,
  onConvertQuote,
  onDeleteQuote,
}: Props) {
  const [statusFilter, setStatusFilter] = useState<(typeof ALL_FILTERS)[number]>("All");

  // Expiry is a function of the clock, not a stored value, so the effective
  // status is derived here rather than trusted from the row.
  const quotes = data.quotes.map((q) => ({
    ...q,
    effectiveStatus: deriveQuoteStatus(q.status, new Date(q.expiryDate)),
    total: computeQuoteTotal(q.lineItems),
  }));

  const filtered = statusFilter === "All" ? quotes : quotes.filter((q) => q.effectiveStatus === statusFilter);

  const outstanding = quotes.filter((q) => q.effectiveStatus === "Sent");
  const outstandingValue = outstanding.reduce((sum, q) => sum + q.total, 0);
  // Win rate counts only quotes the customer actually answered — quotes still
  // open or left to expire would otherwise drag the number down unfairly.
  const answered = quotes.filter((q) => ["Approved", "Converted", "Declined"].includes(q.effectiveStatus));
  const won = answered.filter((q) => q.effectiveStatus !== "Declined");
  const winRate = answered.length === 0 ? null : Math.round((won.length / answered.length) * 100);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center pb-4 border-b border-zinc-200">
        <div>
          <h3 className="text-base font-bold uppercase text-zinc-800">Quotes & Estimates</h3>
          <p className="text-xs text-zinc-500 mt-1">
            Price the work, send it for approval, then convert the accepted quote straight into an invoice.
          </p>
        </div>
        <button
          onClick={onAddQuote}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-700 text-white hover:bg-blue-800 text-xs font-bold uppercase tracking-wider rounded transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Create Quote
        </button>
      </div>

      {/* Pipeline summary */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-zinc-200 rounded p-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Awaiting Response</p>
          <p className="text-2xl font-bold text-zinc-900 mt-1">{outstanding.length}</p>
        </div>
        <div className="bg-white border border-zinc-200 rounded p-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Value Out For Approval</p>
          <p className="text-2xl font-bold text-zinc-900 mt-1">{money(outstandingValue)}</p>
        </div>
        <div className="bg-white border border-zinc-200 rounded p-5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Win Rate</p>
          <p className="text-2xl font-bold text-zinc-900 mt-1">{winRate === null ? "—" : `${winRate}%`}</p>
        </div>
      </div>

      <div className="bg-white border border-zinc-200 rounded overflow-hidden">
        <div className="flex items-center gap-2 px-6 py-3 border-b border-zinc-200 bg-zinc-50 flex-wrap">
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
              {s}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-zinc-400">{filtered.length} quotes</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-200 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                <th className="py-3.5 px-6">Quote #</th>
                <th className="py-3.5 px-6">Client</th>
                <th className="py-3.5 px-6">Issued</th>
                <th className="py-3.5 px-6">Valid Until</th>
                <th className="py-3.5 px-6 text-right">Total</th>
                <th className="py-3.5 px-6">Status</th>
                <th className="py-3.5 px-6 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 text-sm">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 px-6 text-center text-zinc-500">
                    {quotes.length === 0
                      ? "No quotes yet. Create one above, then send it for the customer to accept."
                      : "No quotes match the selected filter."}
                  </td>
                </tr>
              ) : (
                filtered.map((q) => {
                  const status = q.effectiveStatus;
                  return (
                    <tr key={q.id} className="hover:bg-zinc-50">
                      <td className="py-4 px-6 font-mono text-xs font-bold text-zinc-700 align-top">
                        {q.quoteNumber}
                      </td>
                      <td className="py-4 px-6 font-semibold align-top">{q.client.name}</td>
                      <td className="py-4 px-6 text-zinc-600 align-top">{formatDate(q.issueDate)}</td>
                      <td
                        className={`py-4 px-6 align-top ${status === "Expired" ? "text-amber-700 font-semibold" : "text-zinc-600"}`}
                      >
                        {formatDate(q.expiryDate)}
                      </td>
                      <td className="py-4 px-6 text-right align-top font-semibold">{money(q.total)}</td>
                      <td className="py-4 px-6 align-top">
                        <span
                          className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide rounded ${STATUS_STYLES[status]}`}
                        >
                          {status}
                        </span>
                        {q.respondedName && (
                          <span className="block text-[10px] text-zinc-400 mt-1">by {q.respondedName}</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-right align-top">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          <a
                            href={`/api/quotes/${q.id}/pdf`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2.5 py-1 text-xs border border-zinc-300 hover:bg-zinc-50 font-bold uppercase tracking-wide rounded inline-flex items-center gap-1"
                            title="Open PDF"
                          >
                            <FileText className="h-3 w-3" />
                            PDF
                          </a>

                          {status === "Draft" && (
                            <>
                              <button
                                onClick={() => onSendQuote(q)}
                                className="px-2.5 py-1 text-xs bg-blue-700 hover:bg-blue-800 text-white font-bold uppercase tracking-wide rounded inline-flex items-center gap-1"
                              >
                                <Send className="h-3 w-3" />
                                Send
                              </button>
                              <button
                                onClick={() => onDeleteQuote(q)}
                                className="p-1.5 border border-red-200 text-red-600 hover:bg-red-50 rounded"
                                title="Delete draft"
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </>
                          )}

                          {status === "Sent" && (
                            <>
                              <button
                                onClick={() => onRecordDecision(q, "Approved")}
                                className="px-2.5 py-1 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase tracking-wide rounded inline-flex items-center gap-1"
                                title="Record an acceptance given by phone or email"
                              >
                                <Check className="h-3 w-3" />
                                Accepted
                              </button>
                              <button
                                onClick={() => onRecordDecision(q, "Declined")}
                                className="px-2.5 py-1 text-xs border border-red-200 hover:bg-red-50 text-red-700 font-bold uppercase tracking-wide rounded inline-flex items-center gap-1"
                              >
                                <X className="h-3 w-3" />
                                Declined
                              </button>
                            </>
                          )}

                          {canConvertQuote(status) && (
                            <button
                              onClick={() => onConvertQuote(q)}
                              className="px-2.5 py-1 text-xs bg-zinc-900 hover:bg-zinc-800 text-white font-bold uppercase tracking-wide rounded inline-flex items-center gap-1"
                            >
                              <ArrowRight className="h-3 w-3" />
                              To Invoice
                            </button>
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
    </div>
  );
}
