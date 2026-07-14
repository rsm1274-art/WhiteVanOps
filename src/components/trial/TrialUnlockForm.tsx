"use client";

import { useState } from "react";

type Props = {
  machineId: string | null;
  onUnlocked: () => void;
};

export function TrialUnlockForm({ machineId, onUnlocked }: Props) {
  const [pastedKey, setPastedKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    setError(null);
    const trimmed = pastedKey.trim();
    if (!trimmed) {
      setError("Paste the activation key you received from your vendor.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/license", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unlock-trial", licenseKey: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to apply activation key.");
        return;
      }
      onUnlocked();
    } catch {
      setError("Network error — please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {machineId && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Machine ID (send this to your vendor)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={machineId}
              className="flex-1 font-mono text-xs bg-zinc-50 border border-zinc-300 rounded p-2 text-zinc-600 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(machineId)}
              className="px-3 py-2 bg-zinc-100 hover:bg-zinc-200 border border-zinc-300 rounded text-xs font-semibold text-zinc-700 transition-colors uppercase tracking-wider"
            >
              Copy
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Paste Activation Key
        </label>
        <textarea
          value={pastedKey}
          onChange={(e) => setPastedKey(e.target.value)}
          placeholder="Paste the cryptographically signed JSON block your vendor sent you..."
          className="w-full h-32 text-xs font-mono border-zinc-300 rounded focus:ring-blue-500 focus:border-blue-500 p-2 border bg-white placeholder-zinc-400"
        />
      </div>

      {error && <p className="text-xs text-red-600 font-medium">{error}</p>}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-2.5 bg-blue-700 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? "Verifying..." : "Apply Activation Key"}
      </button>
    </div>
  );
}
