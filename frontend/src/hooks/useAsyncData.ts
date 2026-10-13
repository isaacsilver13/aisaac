import { useCallback, useEffect, useRef, useState } from "react";

interface UseAsyncDataResult<T> {
  data: T | null;
  loading: boolean;
  /** True only while an explicit refresh (not the initial load) is in flight. */
  refreshing: boolean;
  error: string | null;
  reload: (forceRefresh?: boolean) => Promise<void>;
}

/**
 * Runs `fetcher` on mount and exposes the loading/error/refreshing states
 * every page in this app was re-implementing by hand. `fetcher` receives
 * `forceRefresh` so pages that support a manual refresh button (Command
 * Center, Analytics, Coms) can thread it through to the API call.
 */
export function useAsyncData<T>(fetcher: (forceRefresh: boolean) => Promise<T>): UseAsyncDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<T | null>(null);

  const reload = useCallback(
    async (forceRefresh = false) => {
      setError(null);
      if (forceRefresh) {
        setRefreshing(true);
      } else if (dataRef.current === null) {
        setLoading(true);
      }
      try {
        const nextData = await fetcher(forceRefresh);
        dataRef.current = nextData;
        setData(nextData);
      } catch (requestError) {
        setError(requestError instanceof Error ? requestError.message : "Unable to reach the dashboard service.");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [fetcher],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void reload(false), 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  return { data, loading, refreshing, error, reload };
}
