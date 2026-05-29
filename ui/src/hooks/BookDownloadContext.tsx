/**
 * Book Download Context
 *
 * Tracks active/completed book downloads client-side with detailed logs.
 * Downloads run as SSE streams, progress gets stored in context state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { useBookI18n } from "../i18n";

// ── Types ────────────────────────────────────────────────────────────────────

export type BookDownloadStatus =
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export interface BookDownloadLog {
  time: number;
  phase: string;
  message: string;
}

export interface BookDownloadTask {
  id: string;
  title: string;
  author: string;
  provider: string;
  libraryId: string;
  status: BookDownloadStatus;
  downloaded: number;
  failed: number;
  vipSkipped: number;
  rescued: number;
  total: number;
  currentChapter: string;
  downloadedBookId?: string;
  logs: BookDownloadLog[];
  startedAt: number;
}

interface BookDownloadContextValue {
  tasks: BookDownloadTask[];
  activeCount: number;
  startDownload: (params: StartDownloadParams) => string;
  cancelDownload: (taskId: string) => void;
  removeTask: (taskId: string) => void;
  clearCompleted: () => void;
}

export interface StartDownloadParams {
  provider: string;
  bookId: string;
  libraryId: string;
  title: string;
  author: string;
  year?: number;
  totalChapters?: number;
}

const BookDownloadContext = createContext<BookDownloadContextValue>({
  tasks: [],
  activeCount: 0,
  startDownload: () => "",
  cancelDownload: () => {},
  removeTask: () => {},
  clearCompleted: () => {},
});

// ── SSE helpers ──────────────────────────────────────────────────────────────

interface SseEvent {
  event: string;
  data: string;
}

async function fetchSseEvents(
  url: string,
  body: object,
  onEvent: (evt: SseEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  // Direct fetch is required here because typed clients do not expose the SSE ReadableStream.
  const res = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`SSE request failed: ${res.status}`);
  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      if (!part.trim()) continue;
      let event = "";
      let data = "";
      for (const line of part.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7).trim();
        else if (line.startsWith("data: ")) data = line.slice(6).trim();
      }
      if (data) onEvent({ event, data });
    }
  }
}

// ── Provider ─────────────────────────────────────────────────────────────────

let nextId = 1;

export function BookDownloadProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { t } = useBookI18n();
  const [tasks, setTasks] = useState<BookDownloadTask[]>([]);
  const abortRefs = useRef<Map<string, AbortController>>(new Map());

  const addLog = useCallback(
    (taskId: string, phase: string, message: string) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? { ...t, logs: [...t.logs, { time: Date.now(), phase, message }] }
            : t,
        ),
      );
    },
    [],
  );

  const startDownload = useCallback(
    (params: StartDownloadParams): string => {
      const taskId = `book-dl-${nextId++}`;
      const ctrl = new AbortController();
      abortRefs.current.set(taskId, ctrl);

      const task: BookDownloadTask = {
        id: taskId,
        title: params.title,
        author: params.author,
        provider: params.provider,
        libraryId: params.libraryId,
        status: "downloading",
        downloaded: 0,
        failed: 0,
        vipSkipped: 0,
        rescued: 0,
        total: params.totalChapters ?? 0,
        currentChapter: "",
        logs: [
          {
            time: Date.now(),
            phase: "start",
            message: t("downloadLogStart", {
              title: params.title,
              provider: params.provider,
            }),
          },
        ],
        startedAt: Date.now(),
      };

      setTasks((prev) => [task, ...prev]);

      let downloaded = 0;
      let failed = 0;
      let vipSkipped = 0;
      let rescued = 0;
      let total = params.totalChapters ?? 0;
      let downloadedBookItemId: string | undefined;

      fetchSseEvents(
        "/api/apps/book/download",
        {
          provider: params.provider,
          bookId: params.bookId,
          libraryId: params.libraryId,
          title: params.title,
          year: params.year,
        },
        (evt) => {
          if (evt.event === "book_info") {
            try {
              const info = JSON.parse(evt.data) as {
                totalChapters?: number;
                bookId?: string;
              };
              if (info.totalChapters) total = info.totalChapters;
              if (info.bookId) downloadedBookItemId = info.bookId;
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId
                    ? {
                        ...t,
                        total,
                        downloadedBookId:
                          downloadedBookItemId ?? t.downloadedBookId,
                      }
                    : t,
                ),
              );
              addLog(taskId, "info", t("downloadLogBookInfo", { total }));
            } catch {
              /* skip */
            }
          } else if (evt.event === "searching_alternatives") {
            addLog(taskId, "info", t("downloadLogSearchingAlternatives"));
          } else if (evt.event === "alt_sources_ready") {
            try {
              const d = JSON.parse(evt.data) as { mappedChapters?: number };
              if (d.mappedChapters && d.mappedChapters > 0) {
                addLog(
                  taskId,
                  "info",
                  t("downloadLogAltSourcesReady", { count: d.mappedChapters }),
                );
              }
            } catch {
              /* skip */
            }
          } else if (evt.event === "chapter") {
            downloaded++;
            try {
              const ch = JSON.parse(evt.data) as {
                title?: string;
                altSource?: string;
              };
              if (ch.altSource) {
                rescued++;
                setTasks((prev) =>
                  prev.map((t) =>
                    t.id === taskId
                      ? {
                          ...t,
                          downloaded,
                          rescued,
                          currentChapter: ch.title ?? "",
                        }
                      : t,
                  ),
                );
              } else {
                setTasks((prev) =>
                  prev.map((t) =>
                    t.id === taskId
                      ? { ...t, downloaded, currentChapter: ch.title ?? "" }
                      : t,
                  ),
                );
              }
            } catch {
              setTasks((prev) =>
                prev.map((t) => (t.id === taskId ? { ...t, downloaded } : t)),
              );
            }
          } else if (evt.event === "chapter_failed") {
            failed++;
            setTasks((prev) =>
              prev.map((t) => (t.id === taskId ? { ...t, failed } : t)),
            );
          } else if (evt.event === "vip_skipped") {
            vipSkipped++;
            setTasks((prev) =>
              prev.map((t) => (t.id === taskId ? { ...t, vipSkipped } : t)),
            );
          } else if (evt.event === "completed") {
            try {
              const d = JSON.parse(evt.data) as {
                downloadedChapters?: number;
                failedChapters?: number;
              };
              if (d.downloadedChapters != null)
                downloaded = d.downloadedChapters;
              if (d.failedChapters != null) failed = d.failedChapters;
            } catch {
              /* skip */
            }
            addLog(
              taskId,
              "done",
              t("downloadLogCompleted", {
                downloaded,
                failed,
                vip:
                  vipSkipped > 0
                    ? t("downloadLogVipSkipped", { count: vipSkipped })
                    : "",
                rescued:
                  rescued > 0
                    ? t("downloadLogRescued", { count: rescued })
                    : "",
              }),
            );
            abortRefs.current.delete(taskId);
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId
                  ? {
                      ...t,
                      status: "completed",
                      downloaded,
                      failed,
                      vipSkipped,
                      rescued,
                    }
                  : t,
              ),
            );
          } else if (evt.event === "error") {
            const msg = (() => {
              try {
                const d = JSON.parse(evt.data) as { message?: string };
                return d.message ?? evt.data;
              } catch {
                return evt.data;
              }
            })();
            addLog(taskId, "error", t("downloadLogError", { message: msg }));
            abortRefs.current.delete(taskId);
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId ? { ...t, status: "failed" } : t,
              ),
            );
          }
        },
        ctrl.signal,
      ).catch((err: unknown) => {
        if ((err as { name?: string }).name === "AbortError") {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId && t.status === "downloading"
                ? { ...t, status: "cancelled" }
                : t,
            ),
          );
        } else {
          addLog(
            taskId,
            "error",
            t("downloadLogNetworkError", { message: (err as Error).message }),
          );
          setTasks((prev) =>
            prev.map((t) => (t.id === taskId ? { ...t, status: "failed" } : t)),
          );
        }
        abortRefs.current.delete(taskId);
      });

      return taskId;
    },
    [addLog, t],
  );

  const cancelDownload = useCallback((taskId: string) => {
    const ctrl = abortRefs.current.get(taskId);
    if (ctrl) {
      ctrl.abort();
      abortRefs.current.delete(taskId);
    }
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId && t.status === "downloading"
          ? { ...t, status: "cancelled" }
          : t,
      ),
    );
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }, []);

  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === "downloading"));
  }, []);

  const activeCount = tasks.filter((t) => t.status === "downloading").length;

  return (
    <BookDownloadContext.Provider
      value={{
        tasks,
        activeCount,
        startDownload,
        cancelDownload,
        removeTask,
        clearCompleted,
      }}
    >
      {children}
    </BookDownloadContext.Provider>
  );
}

export function useBookDownload(): BookDownloadContextValue {
  return useContext(BookDownloadContext);
}
