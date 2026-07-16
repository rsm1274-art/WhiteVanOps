"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { DashboardData } from "@/types";
import { dateToLocalStr, todayLocalStr } from "@/lib/dateUtils";

interface LineDraft {
  description: string;
  quantity: string;
  rate: string;
}

const BLANK_LINE: LineDraft = { description: "", quantity: "1", rate: "" };

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return dateToLocalStr(d.toISOString());
}

function termsToDays(terms: string): number {
  return terms === "Net 15" ? 15 : terms === "Due on Receipt" ? 0 : 30;
}

interface Props {
  data: DashboardData;
  mode: "scratch" | "job";
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function AddInvoiceModal({ data, mode, onClose, onSuccess, onError }: Props) {
  const today = todayLocalStr();
  const [clientId, setClientId] = useState("");
  const [jobId, setJobId] = useState("");
  const [issueDate, setIssueDate] = useState(today);
  const [dueDate, setDueDate] = useState(addDays(today, 30));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ ...BLANK_LINE }]);

  // Filter completed jobs that do not currently have an invoice associated with them
  const invoicedJobIds = new Set(data.invoices.map((inv) => inv.jobId).filter(Boolean));
  const completedUninvoicedJobs = data.jobs.filter(
    (j) => j.status === "Completed" && !invoicedJobIds.has(j.id)
  );

  const selectClient = (id: string) => {
    setClientId(id);
    setJobId("");
    const client = data.clients.find((c) => c.id === id);
    if (client) setDueDate(addDays(issueDate, termsToDays(client.paymentTerms)));
  };

  // Prefill line items and client info from the selected completed job
  const selectJob = (id: string) => {
    setJobId(id);
    const job = data.jobs.find((j) => j.id === id);
    if (job) {
      setClientId(job.clientId);
      const client = data.clients.find((c) => c.id === job.clientId);
      if (client) setDueDate(addDays(issueDate, termsToDays(client.paymentTerms)));
      
      if (job.lineItems.length > 0) {
        setLines(
          job.lineItems.map((li) => ({
            description: li.description || li.inventoryItem.name,
            quantity: String(li.quantity),
            rate: String(li.rate),
          }))
        );
      } else {
        setLines([{ ...BLANK_LINE }]);
      }
    } else {
      setClientId("");
      setLines([{ ...BLANK_LINE }]);
    }
  };

  const setLine = (i: number, k: keyof LineDraft, v: string) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)));

  const total = lines.reduce((sum, l) => {
    const q = parseFloat(l.quantity);
    const r = parseFloat(l.rate);
    return sum + (isNaN(q) || isNaN(r) ? 0 : q * r);
  }, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          jobId: jobId || null,
          issueDate,
          dueDate,
          notes,
          lineItems: lines.map((l) => ({
            description: l.description,
            quantity: parseFloat(l.quantity),
            rate: parseFloat(l.rate),
          })),
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to create invoice");
      onSuccess(`Invoice ${result.invoiceNumber} created as Draft.`);
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to create invoice");
    }
  };

  return (
    <Modal onClose={onClose} maxWidth="xl">
      <ModalHeader
        title={mode === "scratch" ? "Create Manual Invoice" : "Bill Completed Job"}
        subtitle="Internal AR ledger — independent of QuickBooks sync"
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === "scratch" ? (
          <div className="grid grid-cols-1 gap-4">
            <Field label="Client">
              <select required value={clientId} onChange={(e) => selectClient(e.target.value)} className={selectCls}>
                <option value="">— Select Client —</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Select Completed Job">
              <select required value={jobId} onChange={(e) => selectJob(e.target.value)} className={selectCls}>
                <option value="">— Select Completed Job —</option>
                {completedUninvoicedJobs.map((j) => (
                  <option key={j.id} value={j.id}>
                    #{j.id.substring(0, 8)} — {j.client.name} — {dateToLocalStr(j.completionDate || j.scheduledDate)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Client">
              <select disabled required value={clientId} className={`${selectCls} opacity-60`}>
                <option value="">— Select Client —</option>
                {data.clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <Field label="Issue Date">
            <input required type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputCls} />
          </Field>
          <Field label="Due Date">
            <input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
          </Field>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Line Items</label>
            <button
              type="button"
              onClick={() => setLines((ls) => [...ls, { ...BLANK_LINE }])}
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-blue-700 hover:text-blue-900"
            >
              <Plus className="h-3 w-3" /> Add Line
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  required
                  type="text"
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => setLine(i, "description", e.target.value)}
                  className={`${inputCls} flex-1`}
                />
                <input
                  required
                  type="number"
                  min="0.01"
                  step="any"
                  placeholder="Qty"
                  value={l.quantity}
                  onChange={(e) => setLine(i, "quantity", e.target.value)}
                  className={`${inputCls} w-20`}
                />
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Rate"
                  value={l.rate}
                  onChange={(e) => setLine(i, "rate", e.target.value)}
                  className={`${inputCls} w-28`}
                />
                <button
                  type="button"
                  onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                  disabled={lines.length === 1}
                  className="p-2 border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-30 rounded"
                  title="Remove line"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <p className="text-right text-sm font-bold mt-2">Total: ${total.toFixed(2)}</p>
        </div>

        <Field label="Notes (Optional)">
          <input type="text" placeholder="Shown on the invoice PDF" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} />
        </Field>

        <SubmitButton label="Create Draft Invoice" />
      </form>
    </Modal>
  );
}
