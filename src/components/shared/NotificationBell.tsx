"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Package, Clock } from "lucide-react";
import { DashboardData } from "@/types";
import { getAlerts, AppAlert } from "@/lib/alerts";

interface Props {
  data: DashboardData;
  onNavigate: (target: "inventory" | "crm") => void;
}

export default function NotificationBell({ data, onNavigate }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, []);

  const alerts = getAlerts(data);
  const overdueJobs = alerts.filter((a) => a.type === "overdueJob");
  const lowStock = alerts.filter((a) => a.type === "lowStock");

  const handleAlertClick = (alert: AppAlert) => {
    setOpen(false);
    onNavigate(alert.type === "overdueJob" ? "crm" : "inventory");
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        title="Alerts"
        className="relative p-2 border border-zinc-200 text-zinc-600 hover:bg-zinc-50 rounded transition-colors"
      >
        <Bell className="h-4 w-4" />
        {alerts.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-red-600 text-white text-[10px] font-bold">
            {alerts.length > 99 ? "99+" : alerts.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-zinc-200 rounded shadow-lg z-50 max-h-96 overflow-y-auto">
          <div className="px-4 py-3 border-b border-zinc-100">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-800">
              Alerts {alerts.length > 0 && `(${alerts.length})`}
            </h4>
          </div>

          {alerts.length === 0 ? (
            <p className="px-4 py-6 text-xs text-zinc-400 text-center">All caught up — no alerts.</p>
          ) : (
            <div className="divide-y divide-zinc-100">
              {overdueJobs.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    Overdue Jobs
                  </p>
                  {overdueJobs.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => handleAlertClick(a)}
                      className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 flex items-start gap-2.5 transition-colors"
                    >
                      <Clock className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />
                      <span>
                        <span className="text-xs font-semibold text-zinc-800 block">{a.title}</span>
                        <span className="text-[11px] text-zinc-500">{a.detail}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {lowStock.length > 0 && (
                <div>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                    Low Stock
                  </p>
                  {lowStock.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => handleAlertClick(a)}
                      className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 flex items-start gap-2.5 transition-colors"
                    >
                      <Package className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />
                      <span>
                        <span className="text-xs font-semibold text-zinc-800 block">{a.title}</span>
                        <span className="text-[11px] text-zinc-500">{a.detail}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
