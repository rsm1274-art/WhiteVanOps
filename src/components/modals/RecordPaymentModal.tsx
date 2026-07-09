"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { Invoice } from "@/types";
import { todayLocalStr } from "@/lib/dateUtils";
import { computeInvoiceTotal, computePaidTotal } from "@/lib/invoice";

interface Props {
  invoice: Invoice;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function RecordPaymentModal({ invoice, onClose, onSuccess, onError }: Props) {
  const total = computeInvoiceTotal(invoice.lineItems);
  const paid = computePaidTotal(invoice.payments);
  const balance = total - paid;

  const [amount, setAmount] = useState(balance.toFixed(2));
  const [method, setMethod] = useState("Check");
  const [reference, setReference] = useState("");
  const [receivedDate, setReceivedDate] = useState(todayLocalStr());

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: parseFloat(amount), method, reference, receivedDate }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to record payment");
      onSuccess(result.status === "Paid" ? "Payment recorded — invoice fully paid." : "Partial payment recorded.");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to record payment");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader
        title="Record Payment"
        subtitle={`${invoice.invoiceNumber} — ${invoice.client.name}`}
        onClose={onClose}
      />
      <div className="p-3 bg-zinc-50 border border-zinc-200 rounded text-sm flex justify-between">
        <span className="text-zinc-500">Outstanding balance</span>
        <span className="font-bold">${balance.toFixed(2)}</span>
      </div>
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Amount Received">
          <input
            required
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputCls}
          />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Method">
            <select value={method} onChange={(e) => setMethod(e.target.value)} className={selectCls}>
              <option>Check</option>
              <option>Cash</option>
              <option>Card</option>
              <option>ACH</option>
              <option>Other</option>
            </select>
          </Field>
          <Field label="Received Date">
            <input required type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} className={inputCls} />
          </Field>
        </div>
        <Field label="Reference (Optional)">
          <input type="text" placeholder="Check # / transaction ID" value={reference} onChange={(e) => setReference(e.target.value)} className={inputCls} />
        </Field>
        <SubmitButton label="Record Payment" />
      </form>
    </Modal>
  );
}
