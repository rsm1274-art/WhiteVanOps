"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { DashboardData } from "@/types";

interface UseDashboardData {
  data: DashboardData | null;
  loading: boolean;
  reloading: boolean;
  error: string | null;
  reload: () => void;
}

export function useDashboardData(): UseDashboardData {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirror the latest data into a ref so `reload` can stay a stable callback
  // (empty deps) while still deciding foreground-vs-background from current state.
  const dataRef = useRef<DashboardData | null>(null);
  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const reload = useCallback(async () => {
    // Foreground (the full-page loading gate) only on the very first load, when
    // there's nothing to show yet. Every post-mutation reload runs in the
    // background so the dashboard stays rendered instead of flashing the spinner.
    const background = dataRef.current !== null;
    try {
      if (background) {
        setReloading(true);
      } else {
        setLoading(true);
        // Only the first (foreground) load clears the fatal error state; a failed
        // background refetch must not blow away a working dashboard.
        setError(null);
      }
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard data");
      const json: DashboardData = await res.json();
      setData(json);
    } catch (err: unknown) {
      // Background refetch failures are non-fatal: the triggering mutation
      // already succeeded server-side, so keep the existing (now slightly stale)
      // data rather than replacing the whole view with the error screen.
      if (!background) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      }
    } finally {
      if (background) {
        setReloading(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    // Intentional: load dashboard data on mount. `reload` is also returned
    // for callers to re-invoke after mutations, so it can't be restructured
    // into an inline fetch-only effect without losing that reusable API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  return { data, loading, reloading, error, reload };
}
