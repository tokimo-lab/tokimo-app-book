/**
 * Novel Download Context
 *
 * Tracks active/completed novel downloads client-side with detailed logs.
 * Downloads run as SSE streams, progress gets stored in context state.
 */

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { rustUrl } from "../lib/rust-api-runtime";

// ── Types ───────────────────────────────────────────────────────────────────

export type NovelDownloadStatus =
  | "downloading"
  | "completed"
  | "failed"
  | "cancelled";

export interface NovelDownloadLog {
  time: number;
  phase: string;
  message: string;
}

export interface NovelDownloadTask {
  id: string;
  title: string;
  author: string;
  provider: string;
  appId: string;
  status: NovelDownloadStatus;
  downloaded: number;
  failed: number;
  vipSkipped: number;
  rescued: number;
  total: number;
  currentChapter: string;
  novelId?: string;
  logs: NovelDownloadLog[];
  startedAt: number;
}

interface NovelDownloadContextValue {
  tasks: NovelDownloadTask[];
  activeCount: number;
  startDownload: (params: StartDownloadParams) => string;
  cancelDownload: (taskId: string) => void;
  removeTask: (taskId: string) => void;
  clearCompleted: () => void;
}

export interface StartDownloadParams {
  provider: string;
  bookId: string;
  appId: string;
  title: string;
  author: string;
  year?: number;
  totalChapters?: number;
}

const NovelDownloadContext = createContext<NovelDownloadContextValue>({
  tasks: [],
  activeCount: 0,
  startDownload: () => "",
  cancelDownload: () => {},
  removeTask: () => {},
  clearCompleted: () => {},
});

// ── SSE helpers ─────────────────────────────────────────────────────────────

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
  const res = await fetch(rustUrl(url), {
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

// ── Provider ────────────────────────────────────────────────────────────────

let nextId = 1;

export function NovelDownloadProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [tasks, setTasks] = useState<NovelDownloadTask[]>([]);
  const abortRefs = useRef<Map<string, AbortController>>(new Map());

  const addLog = useCallback(
    (taskId: string, phase: string, message: string) => {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId
            ? {
                ...t,
                logs: [...t.logs, { time: Date.now(), phase, message }],
              }
            : t,
        ),
      );
    },
    [],
  );

  const startDownload = useCallback(
    (params: StartDownloadParams): string => {
      const taskId = `novel-dl-${nextId++}`;
      const ctrl = new AbortController();
      abortRefs.current.set(taskId, ctrl);

      const task: NovelDownloadTask = {
        id: taskId,
        title: params.title,
        author: params.author,
        provider: params.provider,
        appId: params.appId,
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
            message: `开始下载《${params.title}》(${params.provider})`,
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
      let novelId: string | undefined;

      fetchSseEvents(
        "/api/novel/download",
        {
          provider: params.provider,
          bookId: params.bookId,
          appId: params.appId,
          title: params.title,
          year: params.year,
        },
        (evt) => {
          if (evt.event === "book_info") {
            try {
              const info = JSON.parse(evt.data) as {
                totalChapters?: number;
                novelId?: string;
                title?: string;
                author?: string;
              };
              if (info.totalChapters) total = info.totalChapters;
              if (info.novelId) novelId = info.novelId;
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId
                    ? { ...t, total, novelId: novelId ?? t.novelId }
                    : t,
                ),
              );
              addLog(taskId, "info", `获取书籍信息: ${total} 章`);
            } catch {
              /* skip */
            }
          } else if (evt.event === "searching_alternatives") {
            addLog(taskId, "info", "正在搜索其他源以补全 VIP 章节…");
          } else if (evt.event === "alt_sources_ready") {
            try {
              const d = JSON.parse(evt.data) as { mappedChapters?: number };
              if (d.mappedChapters && d.mappedChapters > 0) {
                addLog(
                  taskId,
                  "info",
                  `已找到其他源，可覆盖 ${d.mappedChapters} 个章节`,
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
                          total,
                          failed,
                          novelId: novelId ?? t.novelId,
                          currentChapter: ch.title ?? "",
                        }
                      : t,
                  ),
                );
                if (rescued % 20 === 1) {
                  addLog(
                    taskId,
                    "rescue",
                    `已从 ${ch.altSource} 补全 VIP 章节`,
                  );
                }
              } else {
                setTasks((prev) =>
                  prev.map((t) =>
                    t.id === taskId
                      ? {
                          ...t,
                          downloaded,
                          total,
                          failed,
                          novelId: novelId ?? t.novelId,
                          currentChapter: ch.title ?? "",
                        }
                      : t,
                  ),
                );
              }
              if (downloaded % 50 === 0 || downloaded === total) {
                addLog(taskId, "progress", `已下载 ${downloaded}/${total} 章`);
              }
            } catch {
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId
                    ? { ...t, downloaded, total, failed, currentChapter: "" }
                    : t,
                ),
              );
            }
          } else if (evt.event === "chapter_error") {
            failed++;
            try {
              const err = JSON.parse(evt.data) as {
                title?: string;
                error?: string;
              };
              addLog(
                taskId,
                "error",
                `章节失败: ${err.title ?? "?"} - ${err.error ?? "未知错误"}`,
              );
            } catch {
              addLog(taskId, "error", "章节下载失败");
            }
            setTasks((prev) =>
              prev.map((t) => (t.id === taskId ? { ...t, failed } : t)),
            );
          } else if (evt.event === "chapter_vip") {
            vipSkipped++;
            try {
              const ch = JSON.parse(evt.data) as { title?: string };
              setTasks((prev) =>
                prev.map((t) =>
                  t.id === taskId
                    ? { ...t, vipSkipped, currentChapter: ch.title ?? "" }
                    : t,
                ),
              );
              if (vipSkipped === 1) {
                addLog(taskId, "vip", "检测到 VIP 章节，已跳过");
              }
            } catch {
              setTasks((prev) =>
                prev.map((t) => (t.id === taskId ? { ...t, vipSkipped } : t)),
              );
            }
          } else if (evt.event === "done") {
            try {
              const d = JSON.parse(evt.data) as {
                novelId?: string;
                rescued?: number;
              };
              if (d.novelId) novelId = d.novelId;
              if (d.rescued) rescued = d.rescued;
            } catch {
              /* skip */
            }
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
                      total,
                      novelId: novelId ?? t.novelId,
                      currentChapter: "",
                    }
                  : t,
              ),
            );
            const parts = [`${downloaded} 成功`];
            if (rescued > 0) parts.push(`${rescued} VIP补全`);
            if (vipSkipped > 0) parts.push(`${vipSkipped} VIP跳过`);
            if (failed > 0) parts.push(`${failed} 失败`);
            addLog(taskId, "done", `下载完成: ${parts.join(", ")}`);
            abortRefs.current.delete(taskId);
          } else if (evt.event === "error") {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === taskId
                  ? { ...t, status: "failed", currentChapter: "" }
                  : t,
              ),
            );
            addLog(taskId, "error", `下载出错: ${evt.data}`);
            abortRefs.current.delete(taskId);
          }
        },
        ctrl.signal,
      ).catch((err) => {
        if ((err as Error).name === "AbortError") {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId
                ? { ...t, status: "cancelled", currentChapter: "" }
                : t,
            ),
          );
          addLog(taskId, "cancel", "下载已取消");
        } else {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === taskId
                ? { ...t, status: "failed", currentChapter: "" }
                : t,
            ),
          );
          addLog(taskId, "error", `连接失败: ${String(err)}`);
        }
        abortRefs.current.delete(taskId);
      });

      return taskId;
    },
    [addLog],
  );

  const cancelDownload = useCallback((taskId: string) => {
    const ctrl = abortRefs.current.get(taskId);
    if (ctrl) ctrl.abort();
  }, []);

  const removeTask = useCallback(
    (taskId: string) => {
      cancelDownload(taskId);
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    },
    [cancelDownload],
  );

  const clearCompleted = useCallback(() => {
    setTasks((prev) => prev.filter((t) => t.status === "downloading"));
  }, []);

  const activeCount = tasks.filter((t) => t.status === "downloading").length;

  return (
    <NovelDownloadContext.Provider
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
    </NovelDownloadContext.Provider>
  );
}

export function useNovelDownload() {
  return useContext(NovelDownloadContext);
}
