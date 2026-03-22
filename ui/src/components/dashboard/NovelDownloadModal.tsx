import { useQueryClient } from "@tanstack/react-query";
import { Button, Empty, Modal, Spin, Tag } from "@tokiomo/components";
import {
  BookOpen,
  ChevronRight,
  Download,
  Search,
  User,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { api } from "../../generated/rust-api";
import type { NovelSearchResultOutput } from "../../generated/rust-types";
import { rustUrl } from "../../lib/rust-api-runtime";

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

// ── Types ────────────────────────────────────────────────────────────────────

interface BookInfo {
  bookName: string;
  author: string;
  summary: string;
  coverUrl: string;
  updateTime: string;
  wordCount: string;
  serialStatus: string;
  totalChapters: number;
}

interface DownloadProgress {
  downloaded: number;
  total: number;
  failed: number;
  currentChapter: string;
  done: boolean;
  novelId?: string;
}

interface NovelDownloadModalProps {
  open: boolean;
  onClose: () => void;
  libraryId: string;
  libraryName: string;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function NovelDownloadModal({
  open,
  onClose,
  libraryId,
  libraryName,
}: NovelDownloadModalProps) {
  const qc = useQueryClient();

  // Search state
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<NovelSearchResultOutput[]>([]);
  const [searching, setSearching] = useState(false);
  const [providerCount, setProviderCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Detail & download state
  const [selectedResult, setSelectedResult] =
    useState<NovelSearchResultOutput | null>(null);
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [yearInput, setYearInput] = useState("");
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const downloadAbortRef = useRef<AbortController | null>(null);

  const providersQuery = api.novel.listProviders.useQuery({
    staleTime: 5 * 60_000,
  });
  const bookInfoMutation = api.novel.getBookInfo.useMutation();

  // ── Reset ─────────────────────────────────────────────────────────────────
  const resetAll = useCallback(() => {
    abortRef.current?.abort();
    downloadAbortRef.current?.abort();
    setKeyword("");
    setResults([]);
    setSearching(false);
    setSelectedResult(null);
    setBookInfo(null);
    setLoadingInfo(false);
    setYearInput("");
    setDownloadProgress(null);
    setDownloading(false);
  }, []);

  const handleClose = useCallback(() => {
    resetAll();
    onClose();
  }, [resetAll, onClose]);

  // ── Search ────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(() => {
    const trimmed = keyword.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setResults([]);
    setSearching(true);
    setSelectedResult(null);
    setBookInfo(null);
    setDownloadProgress(null);
    setProviderCount(providersQuery.data?.length ?? 0);

    fetchSseEvents(
      "/api/novel/search",
      { keyword: trimmed },
      (evt) => {
        if (evt.event === "result") {
          try {
            const item = JSON.parse(evt.data) as NovelSearchResultOutput;
            setResults((prev) => [...prev, item]);
          } catch {
            /* skip malformed */
          }
        }
      },
      ctrl.signal,
    )
      .catch((err) => {
        if ((err as Error).name !== "AbortError") {
          console.error("Novel search error:", err);
        }
      })
      .finally(() => setSearching(false));
  }, [keyword, providersQuery.data?.length]);

  // ── View Details ──────────────────────────────────────────────────────────
  const handleViewDetails = useCallback(
    (item: NovelSearchResultOutput) => {
      setSelectedResult(item);
      setBookInfo(null);
      setDownloadProgress(null);
      setDownloading(false);
      setYearInput("");
      setLoadingInfo(true);

      bookInfoMutation.mutate(
        { provider: item.site, bookId: item.bookId },
        {
          onSuccess: (data) => {
            setBookInfo(data as unknown as BookInfo);
            setLoadingInfo(false);
          },
          onError: () => setLoadingInfo(false),
        },
      );
    },
    [bookInfoMutation],
  );

  const handleBackToResults = useCallback(() => {
    downloadAbortRef.current?.abort();
    setSelectedResult(null);
    setBookInfo(null);
    setDownloadProgress(null);
    setDownloading(false);
  }, []);

  // ── Download ──────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!selectedResult || !libraryId) return;

    downloadAbortRef.current?.abort();
    const ctrl = new AbortController();
    downloadAbortRef.current = ctrl;

    setDownloading(true);
    setDownloadProgress({
      downloaded: 0,
      total: bookInfo?.totalChapters ?? 0,
      failed: 0,
      currentChapter: "",
      done: false,
    });

    let downloaded = 0;
    let failed = 0;
    let total = bookInfo?.totalChapters ?? 0;
    let novelId: string | undefined;

    fetchSseEvents(
      "/api/novel/download",
      {
        provider: selectedResult.site,
        bookId: selectedResult.bookId,
        libraryId,
        title: bookInfo?.bookName || selectedResult.title,
        year: yearInput ? Number.parseInt(yearInput, 10) : undefined,
      },
      (evt) => {
        if (evt.event === "book_info") {
          try {
            const info = JSON.parse(evt.data) as {
              totalChapters?: number;
              novelId?: string;
            };
            if (info.totalChapters) total = info.totalChapters;
            if (info.novelId) novelId = info.novelId;
          } catch {
            /* skip */
          }
        } else if (evt.event === "chapter") {
          downloaded++;
          try {
            const ch = JSON.parse(evt.data) as { title?: string };
            setDownloadProgress({
              downloaded,
              total,
              failed,
              currentChapter: ch.title ?? "",
              done: false,
              novelId,
            });
          } catch {
            setDownloadProgress({
              downloaded,
              total,
              failed,
              currentChapter: "",
              done: false,
              novelId,
            });
          }
        } else if (evt.event === "chapter_error") {
          failed++;
          setDownloadProgress((prev) => (prev ? { ...prev, failed } : prev));
        } else if (evt.event === "done") {
          try {
            const d = JSON.parse(evt.data) as { novelId?: string };
            if (d.novelId) novelId = d.novelId;
          } catch {
            /* skip */
          }
          setDownloadProgress({
            downloaded,
            total,
            failed,
            currentChapter: "",
            done: true,
            novelId,
          });
          setDownloading(false);
          // Refresh the novel list
          api.novel.listNovels.invalidate(qc);
        }
      },
      ctrl.signal,
    ).catch((err) => {
      if ((err as Error).name !== "AbortError") {
        console.error("Novel download error:", err);
      }
      setDownloading(false);
    });
  }, [selectedResult, libraryId, bookInfo, yearInput, qc]);

  const progressPercent =
    downloadProgress && downloadProgress.total > 0
      ? Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)
      : 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Modal
      open={open}
      onCancel={handleClose}
      title={
        <span className="flex items-center gap-2">
          <Download size={16} />
          下载小说
        </span>
      }
      footer={null}
      width={640}
    >
      {selectedResult ? (
        /* ── Detail / Download view ─────────────────────────────────────── */
        <div className="space-y-4">
          {/* Back button */}
          {!downloadProgress?.done && !downloading && (
            <button
              type="button"
              onClick={handleBackToResults}
              className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
            >
              ← 返回搜索结果
            </button>
          )}

          {loadingInfo ? (
            <div className="flex items-center justify-center py-10">
              <Spin />
            </div>
          ) : bookInfo ? (
            <div className="space-y-4">
              {/* Book meta */}
              <div className="space-y-2 text-sm">
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-[var(--text-muted)]">
                    📖 书名
                  </span>
                  <span className="font-medium">{bookInfo.bookName}</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-[var(--text-muted)]">
                    ✍️ 作者
                  </span>
                  <span>{bookInfo.author || "—"}</span>
                </div>
                {bookInfo.summary && (
                  <div className="flex gap-2">
                    <span className="w-16 shrink-0 text-[var(--text-muted)]">
                      📝 简介
                    </span>
                    <span className="line-clamp-3 text-[var(--text-secondary)]">
                      {bookInfo.summary}
                    </span>
                  </div>
                )}
                <div className="flex flex-wrap gap-4">
                  <span className="text-[var(--text-muted)]">
                    📊 {bookInfo.serialStatus || "—"}
                  </span>
                  <span className="text-[var(--text-muted)]">
                    章节: {bookInfo.totalChapters}
                  </span>
                  {bookInfo.wordCount && (
                    <span className="text-[var(--text-muted)]">
                      字数: {bookInfo.wordCount}
                    </span>
                  )}
                </div>
              </div>

              {/* Download config + button */}
              {!downloadProgress?.done && (
                <div className="space-y-3 border-t border-[var(--glass-border)] pt-2">
                  <div className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm text-[var(--text-muted)]">
                      目标媒体库
                    </span>
                    <span className="text-sm font-medium">{libraryName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-sm text-[var(--text-muted)]">
                      年份 (可选)
                    </span>
                    <input
                      className="h-9 flex-1 rounded-md border border-black/[0.08] bg-white/70 px-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] dark:border-white/[0.1] dark:bg-white/[0.03]"
                      placeholder="2005"
                      value={yearInput}
                      onChange={(e) => setYearInput(e.target.value)}
                      type="number"
                    />
                  </div>
                  <Button
                    variant="primary"
                    className="w-full"
                    icon={<Download size={16} />}
                    loading={downloading}
                    disabled={downloading}
                    onClick={handleDownload}
                  >
                    开始下载
                  </Button>
                </div>
              )}

              {/* Progress */}
              {downloadProgress && (
                <div className="space-y-2 border-t border-[var(--glass-border)] pt-2">
                  <div className="text-xs font-medium text-[var(--text-secondary)]">
                    {downloadProgress.done
                      ? `✅ 下载完成! ${downloadProgress.downloaded}/${downloadProgress.total} 成功, ${downloadProgress.failed} 失败`
                      : `下载中... ${downloadProgress.downloaded}/${downloadProgress.total}`}
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-all duration-300"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  {!downloadProgress.done &&
                    downloadProgress.currentChapter && (
                      <div className="truncate text-xs text-[var(--text-muted)]">
                        当前: {downloadProgress.currentChapter}
                      </div>
                    )}
                </div>
              )}
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-red-500">
              获取书籍信息失败，请重试
            </div>
          )}
        </div>
      ) : (
        /* ── Search view ────────────────────────────────────────────────── */
        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex gap-2">
            <div className="flex h-10 flex-1 items-center gap-2 rounded-md border border-black/[0.08] bg-white/70 px-3 transition-colors focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)] dark:border-white/[0.1] dark:bg-white/[0.03]">
              <Search size={16} className="shrink-0 text-[var(--text-muted)]" />
              <input
                className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
                placeholder="输入小说名称或作者..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => setKeyword("")}
                  className="shrink-0 cursor-pointer text-[var(--text-muted)] hover:text-gray-600 dark:hover:text-gray-300"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <Button
              variant="primary"
              icon={<Search size={16} />}
              loading={searching}
              onClick={handleSearch}
            >
              搜索
            </Button>
          </div>

          {/* Loading indicator */}
          {searching && (
            <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500">
              <Spin size="small" />
              <span>
                正在搜索 {providerCount} 个站点...
                {results.length > 0 && ` 已找到 ${results.length} 个结果`}
              </span>
            </div>
          )}

          {/* Results */}
          {results.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--text-secondary)]">
                搜索结果
              </span>
              <Tag>{results.length}</Tag>
            </div>
          )}

          {results.length > 0 ? (
            <div className="max-h-[400px] divide-y divide-[var(--glass-border)] overflow-y-auto rounded-lg border border-[var(--glass-border)]">
              {results.map((item, idx) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: results may have duplicate site+bookId from parallel streams
                  key={`${item.site}-${item.bookId}-${idx}`}
                  className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <BookOpen
                        size={14}
                        className="shrink-0 text-[var(--accent)]"
                      />
                      <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                        {item.title}
                      </span>
                      <Tag className="!text-[10px]">{item.site}</Tag>
                    </div>
                    <div className="mt-1 flex items-center gap-3 text-xs text-[var(--text-muted)]">
                      <span className="flex items-center gap-1">
                        <User size={11} />
                        {item.author || "—"}
                      </span>
                      {item.latestChapter && (
                        <span className="max-w-[200px] truncate">
                          最新: {item.latestChapter}
                        </span>
                      )}
                      {item.wordCount && <span>字数: {item.wordCount}</span>}
                    </div>
                  </div>
                  <Button
                    size="small"
                    variant="text"
                    icon={<ChevronRight size={14} />}
                    onClick={() => handleViewDetails(item)}
                  >
                    查看详情
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            !searching && (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="输入关键词搜索小说"
              />
            )
          )}
        </div>
      )}
    </Modal>
  );
}
