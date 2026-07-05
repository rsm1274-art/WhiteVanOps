"use client";

import { useState } from "react";
import { X } from "lucide-react";
import Modal, { ModalHeader, Field, inputCls, SubmitButton } from "@/components/shared/Modal";
import { Personnel, PersonnelQualification, PersonnelTimeOff } from "@/types";

const CATEGORIES = ["Certification", "License", "Skill", "Other"];
const TIMEOFF_TYPES = ["Vacation", "Sick", "Personal", "Other"];

const CATEGORY_COLORS: Record<string, string> = {
  Certification: "bg-blue-100 text-blue-800",
  License: "bg-purple-100 text-purple-800",
  Skill: "bg-emerald-100 text-emerald-800",
  Other: "bg-zinc-100 text-zinc-700",
};

const TIMEOFF_COLORS: Record<string, string> = {
  Vacation: "bg-sky-100 text-sky-800",
  Sick: "bg-red-100 text-red-800",
  Personal: "bg-amber-100 text-amber-800",
  Other: "bg-zinc-100 text-zinc-700",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

interface Props {
  personnel: Personnel;
  onClose: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

export default function EditPersonnelModal({ personnel, onClose, onSuccess, onError }: Props) {
  const [quals, setQuals] = useState<PersonnelQualification[]>(personnel.qualifications);
  const [timeoffs, setTimeoffs] = useState<PersonnelTimeOff[]>(personnel.timeOff);
  const [activeSection, setActiveSection] = useState<"qualifications" | "timeoff">("qualifications");

  // Qualification form state
  const [qTag, setQTag] = useState("");
  const [qCategory, setQCategory] = useState("Certification");
  const [qIssuedBy, setQIssuedBy] = useState("");
  const [qExpiresAt, setQExpiresAt] = useState("");
  const [qNotes, setQNotes] = useState("");
  const [qSaving, setQSaving] = useState(false);

  // Time-off form state
  const [tType, setTType] = useState("Vacation");
  const [tStart, setTStart] = useState("");
  const [tEnd, setTEnd] = useState("");
  const [tNotes, setTNotes] = useState("");
  const [tSaving, setTSaving] = useState(false);

  const call = async (body: object) => {
    const res = await fetch("/api/personnel", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || "Request failed");
    return result;
  };

  const addQual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!qTag.trim()) return;
    setQSaving(true);
    try {
      const newQual = await call({
        action: "add_qualification",
        personnelId: personnel.id,
        tag: qTag,
        category: qCategory,
        issuedBy: qIssuedBy,
        expiresAt: qExpiresAt,
        notes: qNotes,
      });
      setQuals((prev) => [...prev, newQual]);
      setQTag(""); setQCategory("Certification"); setQIssuedBy(""); setQExpiresAt(""); setQNotes("");
      onSuccess("Qualification added.");
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to add qualification");
    } finally {
      setQSaving(false);
    }
  };

  const removeQual = async (id: string) => {
    try {
      await call({ action: "remove_qualification", qualificationId: id });
      setQuals((prev) => prev.filter((q) => q.id !== id));
      onSuccess("Qualification removed.");
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to remove qualification");
    }
  };

  const addTimeOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tStart || !tEnd) return;
    if (new Date(tEnd) < new Date(tStart)) { onError("End date must be on or after start date."); return; }
    setTSaving(true);
    try {
      const newEntry = await call({
        action: "add_timeoff",
        personnelId: personnel.id,
        type: tType,
        startDate: tStart,
        endDate: tEnd,
        notes: tNotes,
      });
      setTimeoffs((prev) => [...prev, newEntry].sort((a, b) => a.startDate.localeCompare(b.startDate)));
      setTType("Vacation"); setTStart(""); setTEnd(""); setTNotes("");
      onSuccess("Time off recorded.");
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to add time off");
    } finally {
      setTSaving(false);
    }
  };

  const removeTimeOff = async (id: string) => {
    try {
      await call({ action: "remove_timeoff", timeOffId: id });
      setTimeoffs((prev) => prev.filter((t) => t.id !== id));
      onSuccess("Time off removed.");
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : "Failed to remove time off");
    }
  };

  return (
    <Modal onClose={onClose}>
      <ModalHeader
        title={`${personnel.firstName} ${personnel.lastName} — Profile`}
        onClose={onClose}
      />

      {/* Section tabs */}
      <div className="flex gap-1 bg-zinc-100 rounded p-1 mb-5">
        {(["qualifications", "timeoff"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-wide rounded transition-colors ${
              activeSection === s ? "bg-white text-zinc-900 shadow-sm" : "text-zinc-500 hover:text-zinc-700"
            }`}
          >
            {s === "qualifications" ? `Qualifications (${quals.length})` : `Time Off (${timeoffs.length})`}
          </button>
        ))}
      </div>

      {/* ── Qualifications ── */}
      {activeSection === "qualifications" && (
        <div className="space-y-4">
          {/* Existing */}
          {quals.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-3">No qualifications on record.</p>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {quals.map((q) => (
                <div key={q.id} className="flex items-start justify-between gap-2 p-2.5 border border-zinc-100 rounded bg-zinc-50">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${CATEGORY_COLORS[q.category] ?? "bg-zinc-100 text-zinc-700"}`}>
                        {q.category}
                      </span>
                      <span className="text-sm font-semibold text-zinc-800">{q.tag}</span>
                    </div>
                    {q.issuedBy && <p className="text-[10px] text-zinc-500 mt-0.5">Issued by: {q.issuedBy}</p>}
                    {q.expiresAt && (
                      <p className={`text-[10px] mt-0.5 font-semibold ${new Date(q.expiresAt) < new Date() ? "text-red-500" : "text-zinc-500"}`}>
                        Expires: {formatDate(q.expiresAt)}
                        {new Date(q.expiresAt) < new Date() ? " — EXPIRED" : ""}
                      </p>
                    )}
                    {q.notes && <p className="text-[10px] text-zinc-400 mt-0.5 italic">{q.notes}</p>}
                  </div>
                  <button onClick={() => removeQual(q.id)} className="text-red-400 hover:text-red-600 shrink-0">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add form */}
          <div className="border-t border-zinc-100 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3">Add Qualification</p>
            <form onSubmit={addQual} className="space-y-3">
              <Field label="Qualification / Tag">
                <input
                  required type="text" placeholder="e.g. AWS D1.1 Structural Welding"
                  value={qTag} onChange={(e) => setQTag(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label="Category">
                <select value={qCategory} onChange={(e) => setQCategory(e.target.value)} className={inputCls}>
                  {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Issued By (optional)">
                  <input type="text" placeholder="AWS, OSHA, State DMV…" value={qIssuedBy} onChange={(e) => setQIssuedBy(e.target.value)} className={inputCls} />
                </Field>
                <Field label="Expiry Date (optional)">
                  <input type="date" value={qExpiresAt} onChange={(e) => setQExpiresAt(e.target.value)} className={inputCls} />
                </Field>
              </div>
              <Field label="Notes (optional)">
                <input type="text" placeholder="Any additional detail…" value={qNotes} onChange={(e) => setQNotes(e.target.value)} className={inputCls} />
              </Field>
              <SubmitButton label={qSaving ? "Saving…" : "Add Qualification"} />
            </form>
          </div>
        </div>
      )}

      {/* ── Time Off ── */}
      {activeSection === "timeoff" && (
        <div className="space-y-4">
          {timeoffs.length === 0 ? (
            <p className="text-xs text-zinc-400 text-center py-3">No time off scheduled.</p>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {timeoffs.map((t) => {
                const isPast = new Date(t.endDate) < new Date();
                return (
                  <div key={t.id} className={`flex items-start justify-between gap-2 p-2.5 border rounded ${isPast ? "opacity-50 border-zinc-100 bg-white" : "border-zinc-200 bg-zinc-50"}`}>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${TIMEOFF_COLORS[t.type] ?? "bg-zinc-100 text-zinc-700"}`}>
                          {t.type}
                        </span>
                        <span className="text-xs font-semibold text-zinc-700">
                          {formatDate(t.startDate)} – {formatDate(t.endDate)}
                        </span>
                      </div>
                      {t.notes && <p className="text-[10px] text-zinc-400 mt-0.5 italic">{t.notes}</p>}
                    </div>
                    <button onClick={() => removeTimeOff(t.id)} className="text-red-400 hover:text-red-600 shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="border-t border-zinc-100 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 mb-3">Schedule Time Off</p>
            <form onSubmit={addTimeOff} className="space-y-3">
              <Field label="Type">
                <select value={tType} onChange={(e) => setTType(e.target.value)} className={inputCls}>
                  {TIMEOFF_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start Date">
                  <input required type="date" value={tStart} onChange={(e) => setTStart(e.target.value)} className={inputCls} />
                </Field>
                <Field label="End Date">
                  <input required type="date" value={tEnd} onChange={(e) => setTEnd(e.target.value)} className={inputCls} />
                </Field>
              </div>
              <Field label="Notes (optional)">
                <input type="text" placeholder="Approved by, reason, etc." value={tNotes} onChange={(e) => setTNotes(e.target.value)} className={inputCls} />
              </Field>
              <SubmitButton label={tSaving ? "Saving…" : "Add Time Off"} />
            </form>
          </div>
        </div>
      )}
    </Modal>
  );
}
