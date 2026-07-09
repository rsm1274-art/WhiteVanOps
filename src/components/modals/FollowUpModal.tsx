"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import { Client, ClientFollowUp, Personnel } from "@/types";
import { dateToLocalStr } from "@/lib/dateUtils";

interface Props {
  client: Client;
  personnel: Personnel[];
  /** When set, the modal edits this follow-up instead of creating one. */
  followUp?: ClientFollowUp;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function FollowUpModal({ client, personnel, followUp, onClose, onSuccess, onError }: Props) {
  const [dueDate, setDueDate] = useState(followUp ? dateToLocalStr(followUp.dueDate) : "");
  const [note, setNote] = useState(followUp?.note ?? "");
  const [assignedToId, setAssignedToId] = useState(followUp?.assignedToId ?? "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(
        followUp ? `/api/follow-ups/${followUp.id}` : `/api/clients/${client.id}/follow-ups`,
        {
          method: followUp ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dueDate, note, assignedToId: assignedToId || null }),
        }
      );
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save follow-up");
      onSuccess(followUp ? "Follow-up updated." : "Follow-up scheduled.");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to save follow-up");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader
        title={followUp ? "Edit Follow-Up" : "Schedule Follow-Up"}
        subtitle={client.name}
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Due Date">
          <input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="What needs to happen?">
          <textarea
            required
            rows={3}
            placeholder="Call to confirm annual maintenance contract renewal"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="p-2 border border-zinc-300 text-sm rounded focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700 resize-y"
          />
        </Field>
        <Field label="Assigned To (Optional)">
          <select value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)} className={selectCls}>
            <option value="">— Unassigned —</option>
            {personnel.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName}
              </option>
            ))}
          </select>
        </Field>
        <SubmitButton label={followUp ? "Save Changes" : "Schedule Follow-Up"} />
      </form>
    </Modal>
  );
}
