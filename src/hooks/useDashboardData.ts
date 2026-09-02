"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardData } from "@/types";

interface UseDashboardData {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  refresh: () => void;
}

export function useDashboardData(): UseDashboardData {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async (silent: boolean) => {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard data");
      const json: DashboardData = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  /** Refetch with the full-screen loading state. */
  const reload = useCallback(() => {
    void fetchData(false);
  }, [fetchData]);

  /**
   * Refetch in the background, leaving `loading` alone.
   *
   * `page.tsx` returns a full-screen splash whenever `loading` is true, which
   * unmounts the entire tab tree and every component's local state with it. A
   * component that refreshes the dashboard and then expects to render its own
   * result — the import section's created-record summary, for one — must use
   * this, or it destroys the very output it is refreshing to show.
   */
  const refresh = useCallback(() => {
    void fetchData(true);
  }, [fetchData]);

  useEffect(() => {
    // Intentional: load dashboard data on mount. `reload` is also returned
    // for callers to re-invoke after mutations, so it can't be restructured
    // into an inline fetch-only effect without losing that reusable API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  return { data, loading, error, reload, refresh };
}
