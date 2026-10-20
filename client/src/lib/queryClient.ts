import { QueryClient } from "@tanstack/react-query";

// Default fetcher: the first queryKey entry is the API path.
async function defaultQueryFn({ queryKey }: { queryKey: readonly unknown[] }) {
  const res = await fetch(String(queryKey[0]));
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  return res.json();
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, queryFn: defaultQueryFn },
  },
});

export async function apiRequest<T = unknown>(
  method: string,
  url: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text || res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
