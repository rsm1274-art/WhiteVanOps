"use client";

import { useState, useEffect, useCallback } from "react";
import { DashboardData } from "@/types";

interface UseDashboardData {
  data: DashboardData | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useDashboardData(): UseDashboardData {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/dashboard");
      if (!res.ok) throw new Error("Failed to load dashboard data");
      const json: DashboardData = await res.json();
      setData(json);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Intentional: load dashboard data on mount. `reload` is also returned
    // for callers to re-invoke after mutations, so it can't be restructured
    // into an inline fetch-only effect without losing that reusable API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  return { data, loading, error, reload };
}
