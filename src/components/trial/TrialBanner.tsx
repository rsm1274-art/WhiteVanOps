"use client";

import { useEffect, useState } from "react";

/**
 * Thin "N days left" strip across the dashboard while the install is on its
 * 30-day trial. Reads /api/license (admin/superuser — the dashboard's own
 * audience); renders nothing when activated, not on a trial, or on error.
 */
export default function TrialBanner() {
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/license")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.trial?.isTrial && !d.trial.isLocked) setDaysLeft(d.trial.daysRemaining);
      })
      .catch(() => {});
  }, []);

  if (daysLeft === null) return null;
  const urgent = daysLeft <= 7;
  return (
    <div
      className={`mx-8 mt-4 px-4 py-2 border rounded text-xs flex flex-wrap items-center gap-x-2 ${
        urgent ? "bg-amber-50 border-amber-300 text-amber-900" : "bg-blue-50 border-blue-200 text-blue-900"
      }`}
    >
      <span className="font-bold uppercase tracking-wider">
        Trial: {daysLeft} day{daysLeft === 1 ? "" : "s"} left
      </span>
      <span>
        To keep using WhiteVanOps after the trial, choose <span className="font-semibold">Help → Enter activation key…</span>{" "}
        on the office computer. Your data stays as it is.
      </span>
    </div>
  );
}
