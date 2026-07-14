"use client";

import { useRouter } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { TrialUnlockForm } from "@/components/trial/TrialUnlockForm";

export function TrialExpiredClient({ machineId }: { machineId: string | null }) {
  const router = useRouter();

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
            Your 30-day trial has ended. Enter an activation key to continue using WhiteVanOps.
          </p>
        </div>

        <div className="bg-white border border-zinc-300 rounded p-8">
          <TrialUnlockForm machineId={machineId} onUnlocked={() => router.push("/")} />
        </div>
      </div>
    </div>
  );
}
