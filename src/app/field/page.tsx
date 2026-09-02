"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { cacheApiResponse, getCachedApiResponse, getSyncQueue, getStuckOps, type StuckOp } from "@/lib/idb";
import { submitWrite, drainSyncQueue, type DrainResult } from "@/lib/offlineWrite";
import { deriveSyncStatus } from "@/lib/syncStatus";
import StuckOpsPanel from "@/components/field/StuckOpsPanel";
import SyncStatusBar from "@/components/field/SyncStatusBar";
import JobCard from "@/components/field/JobCard";
import { ArrowLeft, RotateCw, AlertTriangle } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Personnel {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  defaultRate: number;
}

interface LineItem {
  id: string;
  inventoryItemId: string;
  inventoryItem: InventoryItem;
  quantity: number;
  rate: number;
  description: string;
}

interface TimeEntry {
  id: string;
  date: string;
  duration: string;
  serviceItem: string;
}

export interface FieldJob {
  id: string;
  status: string;
  scheduledDate: string;
  completionDate: string | null;
  notes: string | null;
  client: { name: string; contactName: string; locationAddress: string };
  vehicle: { make: string; model: string } | null;
  assignments: { personnel: Personnel }[];
  lineItems: LineItem[];
  equipment: { equipment: { id: string; name: string } }[];
  timeEntries: TimeEntry[];
}

const LAST_SYNCED_KEY = "wvo.lastSyncedAt";

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function FieldPage() {
  const [allPersonnel, setAllPersonnel] = useState<Personnel[]>([]);
  const [tech, setTech] = useState<Personnel | null>(null);
  const [jobs, setJobs] = useState<FieldJob[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ text: string; isError: boolean } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("active");
  const [isOnline, setIsOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastStop, setLastStop] = useState<DrainResult["stopped"] | null>(null);
  const [isDraining, setIsDraining] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [stuckOps, setStuckOps] = useState<StuckOp[]>([]);
  const [showStuckPanel, setShowStuckPanel] = useState(false);

  const checkSyncStatus = async () => {
    try {
      const q = await getSyncQueue();
      setPendingCount(q.length);
      // A write just got queued (submitWrite caught a fetch failure) rather
      // than going through drainSyncQueue, so lastStop was never set. Without
      // this, the first off-network write shows the generic "pending" status
      // instead of "office network not found" until the next drain attempt.
      if (q.length > 0) {
        setLastStop((prev) => (prev === null ? "unreachable" : prev));
      }
      setStuckOps(await getStuckOps());
    } catch { }
  };

  const showToast = (text: string, isError = false) => {
    setToast({ text, isError });
    setTimeout(() => setToast(null), 5000);
  };

  const isDrainingRef = useRef(false);

  const processSync = async () => {
    if (isDrainingRef.current) return;
    isDrainingRef.current = true;
    setIsDraining(true);
    try {
      const { synced, stuck, stopped } = await drainSyncQueue();
      setLastStop(stopped);
      if (synced > 0) {
        const now = Date.now();
        localStorage.setItem(LAST_SYNCED_KEY, String(now));
        setLastSyncedAt(now);
      }
      if (stopped === "auth") {
        showToast("Session expired. Log in again to sync your changes.", true);
        return;
      }
      if (synced === 0 && stuck === 0) return;
      checkSyncStatus();
      if (tech) loadJobs(tech.id);
      if (stuck > 0) {
        showToast(`${stuck} change${stuck === 1 ? "" : "s"} could not be saved and need${stuck === 1 ? "s" : ""} your attention.`, true);
      } else {
        showToast(
          stopped === "complete"
            ? "Background sync completed. All changes saved to server."
            : `Synced ${synced} change${synced === 1 ? "" : "s"}. The rest are still queued.`
        );
      }
    } catch (err) {
      console.error("Sync failed", err);
    } finally {
      isDrainingRef.current = false;
      setIsDraining(false);
    }
  };

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const stored = Number(localStorage.getItem(LAST_SYNCED_KEY));
    if (Number.isFinite(stored) && stored > 0) setLastSyncedAt(stored);
    const onOnline = () => { setIsOnline(true); processSync(); };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    checkSyncStatus();

    // Drain on mount, not just on an online event: if the server was down while
    // the device kept its connection, no online event ever fires and queued
    // writes would otherwise sit here indefinitely.
    processSync();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
    }

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [tech]); // processSync needs current tech for loadJobs

  // Load personnel list on mount; auto-select if session user is a tech with a linked record
  useEffect(() => {
    Promise.all([
      fetch("/api/field").then((r) => { if (!r.ok) throw new Error(); return r.json(); })
        .then(data => { cacheApiResponse("/api/field", data); return data; })
        .catch(async () => {
          const cached = await getCachedApiResponse("/api/field");
          if (cached) return cached;
          throw new Error("No offline cache for field metadata");
        }),
      fetch("/api/auth/me").then((r) => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([fieldData, sessionUser]) => {
        const personnel: Personnel[] = fieldData.personnel ?? [];
        setAllPersonnel(personnel);

        // If the logged-in user is a tech linked to a Personnel record, auto-select
        if (sessionUser?.role === "tech" && sessionUser?.personnelId) {
          const linked = personnel.find((p: Personnel) => p.id === sessionUser.personnelId);
          if (linked) {
            setTech(linked);
            setLoading(false);
            return;
          }
        }

        // Fall back to localStorage
        const savedId = localStorage.getItem("fieldTechId");
        if (savedId) {
          const found = personnel.find((p: Personnel) => p.id === savedId);
          if (found) setTech(found);
        }
        setLoading(false);
      })
      .catch(() => {
        showToast("Failed to connect to server", true);
        setLoading(false);
      });
  }, []);

  const loadJobs = useCallback(async (personnelId: string) => {
    setLoading(true);
    const url = `/api/field?personnelId=${personnelId}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setJobs(data.jobs ?? []);
      setInventoryItems(data.inventoryItems ?? []);
      await cacheApiResponse(url, data);
    } catch {
      const cached = await getCachedApiResponse(url);
      if (cached) {
        setJobs(cached.jobs ?? []);
        setInventoryItems(cached.inventoryItems ?? []);
        showToast("Loaded jobs from offline cache", false);
      } else {
        showToast("Failed to load assignments", true);
      }
    } finally {
      setLoading(false);
      checkSyncStatus();
    }
  }, []);

  useEffect(() => {
    // Intentional: load this tech's jobs whenever the selected tech changes.
    // `loadJobs` is a useCallback reused elsewhere (e.g. after status
    // updates), so it stays a named function rather than an inline effect.
    if (tech) loadJobs(tech.id);
  }, [tech, loadJobs]);

  const selectTech = (p: Personnel) => {
    localStorage.setItem("fieldTechId", p.id);
    setTech(p);
  };

  const signOut = () => {
    localStorage.removeItem("fieldTechId");
    setTech(null);
    setJobs([]);
  };

  const filteredJobs = jobs.filter((j) => {
    if (statusFilter === "active") return j.status !== "Completed";
    if (statusFilter === "completed") return j.status === "Completed";
    return true;
  });

  // ---------------------------------------------------------------------------
  // Technician picker screen
  // ---------------------------------------------------------------------------
  if (!tech) {
    return (
      <div className="min-h-screen bg-zinc-900 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="White Van Ops" className="inline-block h-16 w-16 rounded-2xl mb-4" />
            <h1 className="text-2xl font-bold text-white tracking-tight">Field Module</h1>
            <p className="text-zinc-400 text-sm mt-1">White Van Operations</p>
          </div>

          {loading ? (
            <div className="text-center text-zinc-500 text-sm">Loading…</div>
          ) : allPersonnel.length === 0 ? (
            <p className="text-center text-zinc-500 text-sm">No technicians configured.</p>
          ) : (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-widest text-zinc-500 text-center mb-4">
                Who are you?
              </p>
              {allPersonnel.map((p) => (
                <button
                  key={p.id}
                  onClick={() => selectTech(p)}
                  className="w-full flex items-center gap-3 px-4 py-4 bg-zinc-800 hover:bg-zinc-700 rounded-xl text-left transition-colors group"
                >
                  <div className="h-9 w-9 rounded-full bg-zinc-700 group-hover:bg-zinc-600 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-white">
                      {p.firstName[0]}{p.lastName[0]}
                    </span>
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">{p.firstName} {p.lastName}</p>
                    <p className="text-zinc-400 text-xs">{p.role}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main field view
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col">
      {/* Header */}
      <header className="bg-zinc-900 text-white px-4 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold">
            {tech.firstName[0]}{tech.lastName[0]}
          </div>
          <div>
            <p className="text-xs text-zinc-400 uppercase tracking-wide font-semibold">Field Module</p>
            <p className="text-sm font-bold leading-tight">{tech.firstName} {tech.lastName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isOnline && (
            <span className="text-[10px] bg-red-900/50 text-red-100 px-2 py-1 rounded font-bold uppercase tracking-widest flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> Offline
            </span>
          )}
          <button
            onClick={() => loadJobs(tech.id)}
            className="p-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 transition-colors"
            title="Refresh"
          >
            <RotateCw className="h-4 w-4" />
          </button>
          <button
            onClick={signOut}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-bold uppercase tracking-wide transition-colors"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Switch
          </button>
        </div>
      </header>

      <SyncStatusBar
        status={deriveSyncStatus({ pendingCount, isDraining, lastStop, lastSyncedAt })}
        onSyncNow={processSync}
      />

      {stuckOps.length > 0 && (
        <button
          onClick={() => setShowStuckPanel(true)}
          className="w-full flex items-center gap-2 bg-amber-500/15 border border-amber-500/40 text-amber-500 text-xs font-bold uppercase tracking-wider rounded-lg px-4 py-3"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {stuckOps.length} {stuckOps.length === 1 ? "entry needs" : "entries need"} attention
        </button>
      )}

      {/* Admin link */}
      <div className="bg-zinc-800 text-center py-1.5">
        <Link href="/" className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500 hover:text-zinc-300 transition-colors">
          ← Back to Admin Dashboard
        </Link>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mx-4 mt-4 p-3 rounded-lg flex items-center justify-between text-sm font-semibold ${
          toast.isError ? "bg-red-50 text-red-800 border border-red-200" : "bg-emerald-50 text-emerald-800 border border-emerald-200"
        }`}>
          <span>{toast.text}</span>
          <button onClick={() => setToast(null)} className="ml-4 text-xs opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-6 space-y-4">
        {/* Summary + filter */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Your Assignments</p>
            <p className="text-2xl font-bold text-zinc-900">{filteredJobs.length} job{filteredJobs.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="flex gap-1.5 bg-white border border-zinc-200 rounded-lg p-1">
            {[
              { key: "active", label: "Active" },
              { key: "completed", label: "Done" },
              { key: "all", label: "All" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStatusFilter(key)}
                className={`px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wide transition-colors ${
                  statusFilter === key ? "bg-zinc-900 text-white" : "text-zinc-500 hover:text-zinc-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
            <RotateCw className="h-6 w-6 animate-spin mb-3" />
            <p className="text-sm font-medium uppercase tracking-wide">Loading assignments…</p>
          </div>
        ) : filteredJobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
            <AlertTriangle className="h-8 w-8 mb-3 opacity-40" />
            <p className="text-sm font-medium">No {statusFilter === "all" ? "" : statusFilter + " "}assignments found.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredJobs.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              techId={tech.id}
              inventoryItems={inventoryItems}
              onRefresh={() => { checkSyncStatus(); loadJobs(tech.id); }}
              onError={showToast}
            />
          ))}
        </div>
        )}
      </main>

      {showStuckPanel && stuckOps.length > 0 && (
        <StuckOpsPanel
          stuckOps={stuckOps}
          jobs={jobs}
          onClose={() => setShowStuckPanel(false)}
          onResolved={(message) => {
            showToast(message);
            checkSyncStatus();
            if (tech) loadJobs(tech.id);
            getStuckOps().then((s) => { if (s.length === 0) setShowStuckPanel(false); });
          }}
          onError={showToast}
        />
      )}
    </div>
  );
}
