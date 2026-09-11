"use client";

import { useEffect, useState } from "react";
import Modal, { ModalHeader, Field, inputCls, selectCls, SubmitButton } from "@/components/shared/Modal";
import type { ReportDefinition } from "@/lib/reports/types";
import type { ReportFolder, SavedReport } from "@/types";

interface Props {
  definition: ReportDefinition;
  /** Present when re-saving an already-loaded report (PATCH); absent for a fresh save (POST). */
  editing?: SavedReport | null;
  onClose: () => void;
  onSuccess: (msg: string, report: SavedReport) => void;
  onError: (msg: string) => void;
}

const NEW_FOLDER_VALUE = "__new__";

export default function SaveReportModal({ definition, editing, onClose, onSuccess, onError }: Props) {
  const [folders, setFolders] = useState<ReportFolder[]>([]);
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [folderChoice, setFolderChoice] = useState<string>(editing?.folderId ?? "");
  const [newFolderName, setNewFolderName] = useState("");
  const [isShared, setIsShared] = useState(editing?.isShared ?? false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch("/api/reports/folders")
      .then((r) => r.json())
      .then((json: ReportFolder[]) => setFolders(json))
      .catch(() => {
        // Non-fatal: folder picker just shows no existing folders. The save
        // itself still works (folderId can stay null).
      });
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      let folderId: string | null = folderChoice || null;
      if (folderChoice === NEW_FOLDER_VALUE) {
        if (!newFolderName.trim()) throw new Error("Enter a name for the new folder");
        const folderRes = await fetch("/api/reports/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newFolderName.trim() }),
        });
        const folderJson = await folderRes.json();
        if (!folderRes.ok) throw new Error(folderJson.error || "Failed to create folder");
        folderId = folderJson.id;
      }

      const url = editing ? `/api/reports/${editing.id}` : "/api/reports";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: description || null, definition, folderId, isShared }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to save report");
      onSuccess(editing ? "Report updated." : "Report saved.", result);
      onClose();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to save report");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader title={editing ? "Update Saved Report" : "Save Report"} onClose={onClose} />
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Report Name">
          <input
            required
            type="text"
            placeholder="Open Jobs by Technician"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Description (optional)">
          <input
            type="text"
            placeholder="What this report is for"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Folder">
          <select value={folderChoice} onChange={(e) => setFolderChoice(e.target.value)} className={selectCls}>
            <option value="">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.isPublic ? " (public)" : ""}
              </option>
            ))}
            <option value={NEW_FOLDER_VALUE}>+ New folder...</option>
          </select>
        </Field>
        {folderChoice === NEW_FOLDER_VALUE && (
          <Field label="New Folder Name">
            <input
              required
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              className={inputCls}
            />
          </Field>
        )}
        <Field label="Sharing">
          <label className="flex items-center gap-2 text-xs text-zinc-600">
            <input type="checkbox" checked={isShared} onChange={(e) => setIsShared(e.target.checked)} />
            Share with other admins and superusers
          </label>
        </Field>
        <SubmitButton label={isSaving ? "Saving..." : editing ? "Update Report" : "Save Report"} />
      </form>
    </Modal>
  );
}
