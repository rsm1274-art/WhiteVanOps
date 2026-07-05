"use client";

import { useMemo, useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { DashboardData, Job } from "@/types";
import { dateToLocalStr } from "@/lib/dateUtils";
import { findClientSideConflicts } from "@/lib/clientJobConflicts";

interface Props {
  job: Job;
  data: DashboardData;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function EditJobModal({ job, data, onClose, onSuccess, onError }: Props) {
  const [clientId, setClientId] = useState(job.clientId);
  const [assignedVehicleId, setAssignedVehicleId] = useState(job.assignedVehicleId ?? "");
  const [scheduledDate, setScheduledDate] = useState(dateToLocalStr(job.scheduledDate));
  const [notes, setNotes] = useState(job.notes ?? "");
  const [saving, setSaving] = useState(false);

  const warnings = useMemo(
    () =>
      findClientSideConflicts({
        data,
        scheduledDate,
        assignedVehicleId,
        personnelIds: job.assignments.map((a) => a.personnelId),
        equipmentIds: job.equipment.map((e) => e.equipmentId),
        excludeJobId: job.id,
      }),
    [data, scheduledDate, assignedVehicleId, job.assignments, job.equipment, job.id]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: job.id,
          clientId,
          assignedVehicleId,
          scheduledDate,
          notes,
        }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to update job");
      onSuccess("Job details updated.");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to update job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader
        title="Edit Job Details"
        subtitle={`Job #${job.id.substring(0, 8)}`}
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Client">
          <select
            required
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className={selectCls}
          >
            {data.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.paymentTerms})
              </option>
            ))}
          </select>
        </Field>

        <Field label="Dispatch Fleet Vehicle (Van)">
          <select
            value={assignedVehicleId}
            onChange={(e) => setAssignedVehicleId(e.target.value)}
            className={selectCls}
          >
            <option value="">-- No Vehicle (Standalone Service) --</option>
            {data.vehicles
              .filter((v) => v.status === "Active" || v.id === job.assignedVehicleId)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.make} {v.model} ({v.vin.substring(0, 6)}...)
                </option>
              ))}
          </select>
        </Field>

        <Field label="Scheduled Date">
          <input
            required
            type="date"
            value={scheduledDate}
            onChange={(e) => setScheduledDate(e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Scope of Work / Notes">
          <textarea
            rows={3}
            placeholder="Describe the work to be done, access instructions, special requirements..."
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={`${inputCls} resize-none`}
          />
        </Field>

        <div className="px-3 py-2 bg-zinc-50 border border-zinc-200 rounded text-xs text-zinc-500">
          Crew and equipment assignments are managed from the <span className="font-semibold text-zinc-700">Resources</span> action on this job.
        </div>

        {warnings.length > 0 && (
          <div className="px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-900 space-y-1">
            <p className="font-bold uppercase tracking-wider text-[10px]">Availability Conflict{warnings.length > 1 ? "s" : ""}</p>
            {warnings.map((w, i) => (
              <p key={i}>{w}</p>
            ))}
          </div>
        )}

        <SubmitButton label={saving ? "Saving…" : "Save Job Details"} />
      </form>
    </Modal>
  );
}
