import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAsyncData } from "./useAsyncData";

describe("useAsyncData", () => {
  it("loads data on mount", async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 42 });
    const { result } = renderHook(() => useAsyncData(fetcher));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ value: 42 });
    expect(result.current.error).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(false);
  });

  it("surfaces a fetch failure as a readable error message", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("service unreachable"));
    const { result } = renderHook(() => useAsyncData(fetcher));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("service unreachable");
    expect(result.current.data).toBeNull();
  });

  it("tracks refreshing separately from the initial load and forwards forceRefresh", async () => {
    const fetcher = vi.fn().mockResolvedValue({ value: 1 });
    const { result } = renderHook(() => useAsyncData(fetcher));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.reload(true);
    });

    expect(fetcher).toHaveBeenLastCalledWith(true);
    expect(result.current.refreshing).toBe(false);
  });

  it("returns to loading while retrying an initial failure", async () => {
    let resolveRetry!: (value: { value: number }) => void;
    const fetcher = vi.fn()
      .mockRejectedValueOnce(new Error("service unreachable"))
      .mockImplementationOnce(() => new Promise<{ value: number }>((resolve) => {
        resolveRetry = resolve;
      }));
    const { result } = renderHook(() => useAsyncData(fetcher));
    await waitFor(() => expect(result.current.error).toBe("service unreachable"));

    let retry!: Promise<void>;
    act(() => {
      retry = result.current.reload();
    });
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();

    resolveRetry({ value: 2 });
    await act(async () => retry);
    expect(result.current.loading).toBe(false);
    expect(result.current.data).toEqual({ value: 2 });
  });
});
