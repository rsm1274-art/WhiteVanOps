"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";

export default function ChangePasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newPassword, confirmPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to update password.");
        return;
      }
      if (data.role === "tech") {
        router.push("/field");
      } else {
        router.push("/");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="White Van Ops" className="h-14 w-14 rounded" />
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Fleet Operations</p>
            <h1 className="text-2xl font-bold text-zinc-900 uppercase tracking-wide">White Van Ops</h1>
          </div>
        </div>

        <div className="flex items-start gap-3 mb-5 bg-amber-50 border border-amber-300 rounded px-4 py-3">
          <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-xs text-amber-800 leading-relaxed">
            You must set a new password before continuing. Choose something secure — minimum 8 characters.
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-zinc-300 rounded p-8 space-y-5"
        >
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full px-3 py-2 bg-white border border-zinc-300 rounded text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full px-3 py-2 bg-white border border-zinc-300 rounded text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-700 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-blue-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Updating..." : "Set Password & Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
