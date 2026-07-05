"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, SubmitButton } from "@/components/shared/Modal";
import { RepairContext } from "@/types";

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Props {
  context: RepairContext;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function ReportRepairModal({ context, onClose, onSuccess, onError }: Props) {
  const [description, setDescription] = useState("");
  const [repairType, setRepairType] = useState<"On-Site" | "Off-Site">("On-Site");
  const [location, setLocation] = useState("");
  const [serviceProvider, setServiceProvider] = useState("");
  const [servicePhone, setServicePhone] = useState("");
  const [ticketNumber, setTicketNumber] = useState("");
  const [startDate, setStartDate] = useState(todayStr());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_repair",
          assetId: context.assetId,
          assetType: context.assetType,
          description,
          repairType,
          location,
          serviceProvider,
          servicePhone,
          ticketNumber,
          startDate,
          notes,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to report repair");
      onSuccess(`${context.assetName} marked out of service.`);
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to report repair");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Report Out-of-Service" onClose={onClose} />

      <div className="mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs">
        <p className="font-bold text-amber-800">{context.assetName}</p>
        <p className="text-amber-600 mt-0.5 uppercase tracking-wide text-[10px] font-semibold">
          {context.assetType === "vehicle" ? "Fleet Vehicle" : "Equipment"}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Description of Issue">
          <textarea
            required
            rows={3}
            placeholder="What is wrong? Describe the damage or fault."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls + " resize-none"}
          />
        </Field>

        <Field label="Repair Location">
          <div className="flex gap-2">
            {(["On-Site", "Off-Site"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setRepairType(t)}
                className={`flex-1 py-2 rounded text-xs font-bold uppercase tracking-wide border transition-colors ${
                  repairType === t
                    ? "bg-zinc-900 text-white border-zinc-900"
                    : "border-zinc-300 text-zinc-500 hover:bg-zinc-50"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </Field>

        {repairType === "Off-Site" && (
          <>
            <Field label="Service Location / Shop">
              <input
                type="text"
                placeholder="Joe's Diesel Repair, 123 Main St"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                className={inputCls}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Service Provider / Contact">
                <input
                  type="text"
                  placeholder="Contact name or company"
                  value={serviceProvider}
                  onChange={(e) => setServiceProvider(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Phone">
                <input
                  type="tel"
                  placeholder="(555) 000-0000"
                  value={servicePhone}
                  onChange={(e) => setServicePhone(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
            <Field label="Service / Ticket / PO Number">
              <input
                type="text"
                placeholder="WO-1234 / PO-5678"
                value={ticketNumber}
                onChange={(e) => setTicketNumber(e.target.value)}
                className={inputCls}
              />
            </Field>
          </>
        )}

        <Field label="Date Out of Service">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Additional Notes (optional)">
          <input
            type="text"
            placeholder="Expected return date, parts ordered, etc."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputCls}
          />
        </Field>

        <SubmitButton label={saving ? "Saving…" : "Mark Out of Service"} />
      </form>
    </Modal>
  );
}
