"use client";

import { useState } from "react";
import Modal, { ModalHeader, Field, SubmitButton } from "@/components/shared/Modal";
import { Client } from "@/types";

interface Props {
  client: Client;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function AddClientNoteModal({ client, onClose, onSuccess, onError }: Props) {
  const [body, setBody] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`/api/clients/${client.id}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to add note");
      onSuccess("Note added to client record.");
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to add note");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Add Client Note" subtitle={client.name} onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Note / Communication Log Entry">
          <textarea
            required
            rows={5}
            placeholder="Called about upcoming service window; spoke with front office..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="p-2 border border-zinc-300 text-sm rounded focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700 resize-y"
          />
        </Field>
        <SubmitButton label="Save Note" />
      </form>
    </Modal>
  );
}
