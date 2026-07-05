"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { DashboardData, NewTimeForm } from "@/types";

const BLANK: NewTimeForm = {
  jobId: "",
  personnelId: "",
  date: "",
  hours: "",
  minutes: "00",
  serviceItem: "Field Labor",
  payrollItem: "Regular Pay",
};

interface Props {
  data: DashboardData;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function LogTimeModal({ data, onClose, onSuccess, onError }: Props) {
  const [form, setForm] = useState<NewTimeForm>(BLANK);

  const set = (k: keyof NewTimeForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const h = parseInt(form.hours, 10);
    const m = parseInt(form.minutes, 10);
    if (isNaN(h) || h < 0 || isNaN(m) || m < 0 || m > 59) {
      onError("Please enter a valid duration (hours ≥ 0, minutes 0–59).");
      return;
    }
    const duration = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    try {
      const res = await fetch("/api/time", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: form.jobId,
          personnelId: form.personnelId,
          date: form.date,
          duration,
          serviceItem: form.serviceItem,
          payrollItem: form.payrollItem,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to log time");
      onSuccess("Labor time logged successfully!");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to log time");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Log Crew Labor Hours" onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Select Job">
          <select required value={form.jobId} onChange={set("jobId")} className={selectCls}>
            <option value="">-- Select Active Job --</option>
            {data.jobs
              .filter((j) => j.status !== "Cancelled")
              .map((j) => (
                <option key={j.id} value={j.id}>
                  Job #{j.id.substring(0, 6)} — {j.client.name} ({j.status})
                </option>
              ))}
          </select>
        </Field>

        <Field label="Technician">
          <select required value={form.personnelId} onChange={set("personnelId")} className={selectCls}>
            <option value="">-- Select Technician --</option>
            {data.personnel
              .filter((p) => p.role === "Technician")
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </option>
              ))}
          </select>
        </Field>

        <Field label="Service Date">
          <input required type="date" value={form.date} onChange={set("date")} className={inputCls} />
        </Field>

        <Field label="Duration">
          <div className="flex items-center gap-2">
            <div className="flex flex-col flex-1 gap-1">
              <input
                required
                type="number"
                min="0"
                max="99"
                placeholder="0"
                value={form.hours}
                onChange={set("hours")}
                className={inputCls}
              />
              <span className="text-[10px] text-zinc-400 text-center">Hours</span>
            </div>
            <span className="text-zinc-400 font-bold text-lg pb-4">:</span>
            <div className="flex flex-col flex-1 gap-1">
              <input
                required
                type="number"
                min="0"
                max="59"
                placeholder="00"
                value={form.minutes}
                onChange={set("minutes")}
                className={inputCls}
              />
              <span className="text-[10px] text-zinc-400 text-center">Minutes</span>
            </div>
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Service Item">
            <select value={form.serviceItem} onChange={set("serviceItem")} className={selectCls}>
              <option value="Field Labor">Field Labor</option>
              <option value="Dispatch Ops">Dispatch Ops</option>
              <option value="Emergency Service">Emergency Service</option>
            </select>
          </Field>
          <Field label="Payroll Item">
            <select value={form.payrollItem} onChange={set("payrollItem")} className={selectCls}>
              <option value="Regular Pay">Regular Pay</option>
              <option value="Overtime">Overtime</option>
            </select>
          </Field>
        </div>

        <SubmitButton label="Log Hours" />
      </form>
    </Modal>
  );
}
