"use client";

import { useRouter } from "next/navigation";
import { ShieldAlert, BadgeCheck } from "lucide-react";
import { TrialUnlockForm } from "@/components/trial/TrialUnlockForm";

export function TrialExpiredClient({ machineId, stillLocked }: { machineId: string | null; stillLocked: boolean }) {
  const router = useRouter();

  const signInAgain = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8 gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="White Van Ops" className="h-14 w-14 rounded" />
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Fleet Operations</p>
            <h1 className="text-2xl font-bold text-zinc-900 uppercase tracking-wide">White Van Ops</h1>
          </div>
        </div>

        {stillLocked ? (
          <div className="flex items-start gap-3 mb-5 bg-amber-50 border border-amber-300 rounded px-4 py-3">
            <ShieldAlert className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-800 leading-relaxed space-y-2">
              <p className="font-semibold">The 30-day trial has ended. All your data is safe.</p>
              <p>
                To continue, open WhiteVanOps on the office computer and enter your activation key — it asks as soon
                as it opens. Then sign in again here.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-3 mb-5 bg-emerald-50 border border-emerald-300 rounded px-4 py-3">
            <BadgeCheck className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
            <p className="text-xs text-emerald-800 leading-relaxed">WhiteVanOps is now activated. Sign in again to continue.</p>
          </div>
        )}

        <button
          type="button"
          onClick={signInAgain}
          className="w-full py-2.5 bg-zinc-900 text-white text-xs font-bold uppercase tracking-widest rounded hover:bg-zinc-700 transition-colors"
        >
          Sign in again
        </button>

        {stillLocked && (
          <details className="mt-6 bg-white border border-zinc-300 rounded">
            <summary className="px-4 py-3 text-xs font-semibold text-zinc-600 cursor-pointer">
              No internet at the office? Use an offline unlock code
            </summary>
            <div className="px-4 pb-4">
              <TrialUnlockForm machineId={machineId} onUnlocked={() => router.push("/")} />
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
