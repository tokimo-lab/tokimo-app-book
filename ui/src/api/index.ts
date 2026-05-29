/**
 * Typed React Query hooks for the Book app API endpoints.
 * All paths hit /api/apps/book/... which the shell proxies to the sidecar.
 */

import {
  type QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  BookContainerOutput,
  BookDetailOutput,
  BookOutput,
  BookProviderOutput,
  BookSearchResultOutput,
  PagedResult,
  VfsDto,
} from "../types";

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: "include", ...init });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === "string") msg = body.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  const json = (await res.json()) as {
    success: boolean;
    data: T;
    error?: string;
  };
  if (!json.success) throw new Error(json.error ?? "API error");
  return json.data;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function apiDelete<T>(path: string): Promise<T> {
  return apiFetch<T>(path, { method: "DELETE" });
}

// ── Query key factory ────────────────────────────────────────────────────────

const keys = {
  list: ["book", "list"] as const,
  listItems: (
    id: string,
    page: number,
    pageSize: number,
    sortBy: string,
    sortDir: string,
  ) => ["book", "items", id, page, pageSize, sortBy, sortDir] as const,
  detail: (id: string) => ["book", "detail", id] as const,
  providers: ["book", "providers"] as const,
  search: (query: string, libraryId: string) =>
    ["book", "search", query, libraryId] as const,
};

// ── API hooks ────────────────────────────────────────────────────────────────

export const bookApi = {
  list: {
    useQuery: () =>
      useQuery({
        queryKey: keys.list,
        queryFn: () => apiFetch<BookContainerOutput[]>("/api/apps/book"),
      }),
    invalidate: (qc: QueryClient) =>
      qc.invalidateQueries({ queryKey: keys.list }),
  },

  listItems: {
    useQuery: (params: {
      id: string;
      page: number;
      pageSize: number;
      sortBy: string;
      sortDir: string;
    }) => {
      const { id, page, pageSize, sortBy, sortDir } = params;
      const searchParams = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        sortBy,
        sortDir,
      });
      return useQuery({
        queryKey: keys.listItems(id, page, pageSize, sortBy, sortDir),
        queryFn: () =>
          apiFetch<PagedResult<BookOutput>>(
            `/api/apps/book/${encodeURIComponent(id)}/items?${searchParams}`,
          ),
        enabled: !!id,
      });
    },
    invalidate: (qc: QueryClient) =>
      qc.invalidateQueries({ queryKey: ["book", "items"] }),
  },

  getItemDetail: {
    useQuery: (params: { id: string }, opts?: { enabled?: boolean }) =>
      useQuery({
        queryKey: keys.detail(params.id),
        queryFn: () =>
          apiFetch<BookDetailOutput | null>(
            `/api/apps/book/item/${encodeURIComponent(params.id)}`,
          ),
        enabled: opts?.enabled !== false && !!params.id,
      }),
  },

  sync: {
    useMutation: (opts?: {
      onSuccess?: () => void;
      onError?: (err: Error) => void;
    }) =>
      useMutation({
        mutationFn: (input: { id: string; clearData?: boolean }) => {
          const { id, ...body } = input;
          return apiPost<{ success: boolean }>(
            `/api/apps/book/${encodeURIComponent(id)}/sync`,
            body,
          );
        },
        onSuccess: opts?.onSuccess,
        onError: opts?.onError,
      }),
  },

  listProviders: {
    useQuery: (opts?: { staleTime?: number }) =>
      useQuery({
        queryKey: keys.providers,
        queryFn: () =>
          apiFetch<BookProviderOutput[]>("/api/apps/book/providers"),
        staleTime: opts?.staleTime,
      }),
  },

  getBookInfo: {
    useMutation: () =>
      useMutation({
        mutationFn: (input: { provider: string; bookId: string }) =>
          apiPost<{
            bookName: string;
            author: string;
            summary: string;
            coverUrl: string;
            updateTime: string;
            wordCount: string;
            serialStatus: string;
            totalChapters: number;
          }>("/api/apps/book/book-info", input),
      }),
  },

  search: {
    useQuery: (
      params: { query: string; libraryId: string },
      opts?: { enabled?: boolean },
    ) =>
      useQuery({
        queryKey: keys.search(params.query, params.libraryId),
        queryFn: () => {
          const sp = new URLSearchParams({
            q: params.query,
            libraryId: params.libraryId,
          });
          return apiFetch<BookSearchResultOutput[]>(
            `/api/apps/book/search?${sp}`,
          );
        },
        enabled:
          opts?.enabled !== false && !!params.query && !!params.libraryId,
        staleTime: 60_000,
      }),
  },

  create: {
    useMutation: (opts?: {
      onSuccess?: (data: BookContainerOutput) => void;
      onError?: (err: Error) => void;
    }) =>
      useMutation({
        mutationFn: (input: {
          name: string;
          kind: string;
          sourceId?: string;
          rootPath?: string;
        }) => apiPost<BookContainerOutput>("/api/apps/book", input),
        onSuccess: opts?.onSuccess,
        onError: opts?.onError,
      }),
  },

  update: {
    useMutation: (opts?: {
      onSuccess?: () => void;
      onError?: (err: Error) => void;
    }) =>
      useMutation({
        mutationFn: (input: {
          id: string;
          name?: string;
          kind?: string;
          sourceId?: string;
          rootPath?: string;
        }) => {
          const { id, ...body } = input;
          return apiPatch<void>(
            `/api/apps/book/${encodeURIComponent(id)}`,
            body,
          );
        },
        onSuccess: opts?.onSuccess,
        onError: opts?.onError,
      }),
  },

  delete: {
    useMutation: (opts?: {
      onSuccess?: () => void;
      onError?: (err: Error) => void;
    }) =>
      useMutation({
        mutationFn: (id: string) =>
          apiDelete<void>(`/api/apps/book/${encodeURIComponent(id)}`),
        onSuccess: opts?.onSuccess,
        onError: opts?.onError,
      }),
  },

  reorder: {
    useMutation: (opts?: {
      onSuccess?: () => void;
      onError?: (err: Error) => void;
    }) =>
      useMutation({
        mutationFn: (ids: string[]) =>
          apiPost<void>("/api/apps/book/reorder", { ids }),
        onSuccess: opts?.onSuccess,
        onError: opts?.onError,
      }),
  },
};

export interface BrowseEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface BrowseDirectoryResponse {
  currentPath: string;
  parentPath: string | null;
  entries: BrowseEntry[];
}

export interface SourceStatEntry {
  path: string;
  size: number | null;
  modifiedAt: string | null;
  mode: string | null;
}

export const vfsApi = {
  list: {
    useQuery: () =>
      useQuery({
        queryKey: ["vfs", "list"],
        queryFn: () => apiFetch<VfsDto[]>("/api/vfs"),
      }),
  },
};

export function vfsBrowse(
  fileSystemId: string | undefined,
  path: string,
): Promise<BrowseDirectoryResponse> {
  const base = fileSystemId
    ? `/api/vfs/${encodeURIComponent(fileSystemId)}/browse`
    : "/api/vfs/local/browse";
  return apiFetch<BrowseDirectoryResponse>(
    `${base}?path=${encodeURIComponent(path)}`,
  );
}

export function vfsStat(
  paths: string[],
  fileSystemId: string | undefined,
): Promise<SourceStatEntry[]> {
  const url = fileSystemId
    ? `/api/vfs/${encodeURIComponent(fileSystemId)}/stat`
    : "/api/vfs/local/stat";
  return apiPost<SourceStatEntry[]>(url, { paths });
}

export const api = {
  book: bookApi,
  vfs: vfsApi,
};

export function useBookQueryClient() {
  return useQueryClient();
}
