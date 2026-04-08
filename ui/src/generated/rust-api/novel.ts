import {
  createMutation,
  createPathMutation,
  createQuery,
} from "../../lib/rust-api-runtime";
import type {
  NovelChapterContentOutput,
  NovelContainerOutput,
  NovelDetailOutput,
  NovelOutput,
  NovelProviderOutput,
} from "../rust-types/index";

// ── Input types (hand-maintained) ───────────────────────────────────────────

interface CreateNovelInput {
  name: string;
  type: string;
  icon?: string | null;
  color?: string | null;
  description?: string | null;
  scrapeEnabled?: boolean;
  scrapeAgents?: string[];
  settings?: Record<string, unknown> | null;
  sources?: {
    sourceId: string;
    rootPath: string;
    sortOrder: number;
    isDefaultDownload?: boolean;
  }[];
}

interface UpdateNovelInput {
  id: string;
  name?: string;
  icon?: string | null;
  color?: string | null;
  description?: string | null;
  scrapeEnabled?: boolean;
  scrapeAgents?: string[];
  settings?: Record<string, unknown> | null;
  sources?: {
    sourceId: string;
    rootPath: string;
    sortOrder: number;
    isDefaultDownload?: boolean;
  }[];
}

interface ListNovelItemsInput {
  id: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: string;
  search?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function novelItemsParamsFn(
  input: ListNovelItemsInput,
): Record<string, string> {
  const p: Record<string, string> = {};
  if (input.page != null) p.page = String(input.page);
  if (input.pageSize != null) p.pageSize = String(input.pageSize);
  if (input.sortBy) p.sortBy = input.sortBy;
  if (input.sortDir) p.sortDir = input.sortDir;
  if (input.search) p.search = input.search;
  return p;
}

// ── Novel API ────────────────────────────────────────────────────────────────

export const novelApi = {
  // Container CRUD
  list: createQuery<void, NovelContainerOutput[]>({
    path: "/api/apps/novel",
  }),
  getById: createQuery<{ id: string }, NovelContainerOutput | null>({
    path: "/api/apps/novel/{id}",
    pathFn: (input) => `/api/apps/novel/${encodeURIComponent(input.id)}`,
  }),
  create: createMutation<CreateNovelInput, NovelContainerOutput>({
    path: "/api/apps/novel",
  }),
  update: createPathMutation<UpdateNovelInput, NovelContainerOutput>({
    method: "PATCH",
    pathFn: (input) => `/api/apps/novel/${encodeURIComponent(input.id)}`,
    bodyFn: (input) => {
      const { id: _id, ...body } = input;
      return body;
    },
  }),
  delete: createPathMutation<string, { success: boolean }>({
    method: "DELETE",
    pathFn: (id) => `/api/apps/novel/${encodeURIComponent(id)}`,
  }),
  reorder: createMutation<
    { id: string; sortOrder: number }[],
    { success: boolean }
  >({
    path: "/api/apps/novel/reorder",
    bodyFn: (input) => ({ orders: input }),
  }),

  // Content / browsing
  listItems: createQuery<
    ListNovelItemsInput,
    { items: NovelOutput[]; total: number; page: number; pageSize: number }
  >({
    path: "/api/apps/novel/{id}/items",
    pathFn: (input) => `/api/apps/novel/${encodeURIComponent(input.id)}/items`,
    paramsFn: novelItemsParamsFn,
  }),
  getItemDetail: createQuery<{ id: string }, NovelDetailOutput | null>({
    path: "/api/apps/novel/item/{id}",
    pathFn: (input) => `/api/apps/novel/item/${encodeURIComponent(input.id)}`,
  }),
  getChapterContent: createQuery<
    { novelId: string; chapterId: string },
    NovelChapterContentOutput | null
  >({
    path: "/api/apps/novel/item/{novelId}/chapters/{chapterId}/content",
    pathFn: (input) =>
      `/api/apps/novel/item/${encodeURIComponent(input.novelId)}/chapters/${encodeURIComponent(input.chapterId)}/content`,
  }),

  // Download / search
  listProviders: createQuery<void, NovelProviderOutput[]>({
    path: "/api/apps/novel/providers",
  }),
  getBookInfo: createMutation<
    { provider: string; bookId: string },
    {
      bookName: string;
      author: string;
      summary: string;
      coverUrl: string;
      updateTime: string;
      wordCount: string;
      serialStatus: string;
      volumes: Array<{
        volumeName: string;
        chapterCount: number;
        chapters: Array<{ title: string; chapterId: string }>;
      }>;
      totalChapters: number;
    }
  >({
    path: "/api/apps/novel/book-info",
  }),

  // Sync
  sync: createPathMutation<
    { id: string; clearData?: boolean },
    { success: boolean }
  >({
    method: "POST",
    pathFn: (input) => `/api/apps/novel/${encodeURIComponent(input.id)}/sync`,
    bodyFn: (input) => {
      const { id: _id, ...body } = input;
      return body;
    },
  }),
  getSyncStatus: createQuery<
    { id: string },
    { novelId: string; status: string; lastSyncAt: string | null }
  >({
    path: "/api/apps/novel/{id}/sync-status",
    pathFn: (input) =>
      `/api/apps/novel/${encodeURIComponent(input.id)}/sync-status`,
  }),
} as const;
