import { Button, Empty, Modal, Select, Spin, Tag } from "@tokiomo/components";
import {
  BookOpen,
  ChevronRight,
  Download,
  Search,
  User,
  X,
} from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../../generated/rust-api";
import type { NovelSearchResultOutput } from "../../../generated/rust-types";
import { rustUrl } from "../../../lib/rust-api-runtime";

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

// ── Component ────────────────────────────────────────────────────────────────

export default function NovelSearchSection() {
  const { t } = useTranslation();
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<NovelSearchResultOutput[]>([]);
  const [searching, setSearching] = useState(false);
  const [providerCount, setProviderCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Download dialog state
  const [selectedResult, setSelectedResult] =
    useState<NovelSearchResultOutput | null>(null);
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [selectedLibraryId, setSelectedLibraryId] = useState<string>("");
  const [yearInput, setYearInput] = useState("");
  const [downloadProgress, setDownloadProgress] =
    useState<DownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const downloadAbortRef = useRef<AbortController | null>(null);

  // Library list for novel type
  const librariesQuery = api.mediaLibrary.list.useQuery({ staleTime: 60_000 });
  const novelLibraries = (librariesQuery.data ?? []).filter(
    (lib) => lib.type === "novel",
  );

  // Provider count
  const providersQuery = api.novel.listProviders.useQuery({
    staleTime: 5 * 60_000,
  });

  const bookInfoMutation = api.novel.getBookInfo.useMutation();

  // ── Search ───────────────────────────────────────────────────────────────

  const handleSearch = useCallback(() => {
    const trimmed = keyword.trim();
    if (!trimmed) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setResults([]);
    setSearching(true);
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

  // ── View Details (open download dialog) ──────────────────────────────────

  const handleViewDetails = useCallback(
    (item: NovelSearchResultOutput) => {
      setSelectedResult(item);
      setBookInfo(null);
      setDownloadProgress(null);
      setDownloading(false);
      setYearInput("");
      setSelectedLibraryId(novelLibraries[0]?.id ?? "");
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
    [bookInfoMutation, novelLibraries],
  );

  // ── Download ─────────────────────────────────────────────────────────────

  const handleDownload = useCallback(() => {
    if (!selectedResult || !selectedLibraryId) return;

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
        libraryId: selectedLibraryId,
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
        }
      },
      ctrl.signal,
    ).catch((err) => {
      if ((err as Error).name !== "AbortError") {
        console.error("Novel download error:", err);
      }
      setDownloading(false);
    });
  }, [selectedResult, selectedLibraryId, bookInfo, yearInput]);

  const closeDialog = () => {
    downloadAbortRef.current?.abort();
    setSelectedResult(null);
    setBookInfo(null);
    setDownloadProgress(null);
    setDownloading(false);
  };

  const progressPercent =
    downloadProgress && downloadProgress.total > 0
      ? Math.round((downloadProgress.downloaded / downloadProgress.total) * 100)
      : 0;

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-[var(--glass-border)] bg-black/[0.02] dark:bg-white/[0.03] p-4">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen size={18} className="text-[var(--accent)]" />
        <h5 className="text-base font-semibold mb-0">
          {t("novel.search.title", "搜索小说")}
        </h5>
      </div>

      {/* Search bar */}
      <div className="flex gap-2 mb-4">
        <div className="flex flex-1 items-center gap-2 rounded-md border border-black/[0.08] dark:border-white/[0.1] bg-white/70 dark:bg-white/[0.03] px-3 h-10 transition-colors focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)]">
          <Search size={16} className="shrink-0 text-[var(--text-muted)]" />
          <input
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-[var(--text-muted)] text-sm"
            placeholder={t("novel.search.placeholder", "输入小说名称或作者...")}
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
              className="cursor-pointer shrink-0 text-[var(--text-muted)] hover:text-gray-600 dark:hover:text-gray-300"
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
          {t("novel.search.searchBtn", "搜索")}
        </Button>
      </div>

      {/* Loading indicator */}
      {searching && (
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 mb-3">
          <Spin size="small" />
          <span>
            {t("novel.search.searching", "正在搜索 {{count}} 个站点...", {
              count: providerCount,
            })}
            {results.length > 0 &&
              ` ${t("novel.search.found", "已找到 {{count}} 个结果", { count: results.length })}`}
          </span>
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {t("novel.search.results", "搜索结果")}
          </span>
          <Tag>{results.length}</Tag>
        </div>
      )}

      {results.length > 0 ? (
        <div className="divide-y divide-[var(--glass-border)] rounded-lg border border-[var(--glass-border)] overflow-hidden">
          {results.map((item, idx) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: results may have duplicate site+bookId from parallel streams
              key={`${item.site}-${item.bookId}-${idx}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <BookOpen
                    size={14}
                    className="shrink-0 text-[var(--accent)]"
                  />
                  <span className="font-medium text-sm text-[var(--text-primary)] truncate">
                    {item.title}
                  </span>
                  <Tag className="!text-[10px]">{item.site}</Tag>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                  <span className="flex items-center gap-1">
                    <User size={11} />
                    {item.author || "—"}
                  </span>
                  {item.latestChapter && (
                    <span className="truncate max-w-[200px]">
                      {t("novel.search.latest", "最新")}: {item.latestChapter}
                    </span>
                  )}
                  {item.wordCount && (
                    <span>
                      {t("novel.search.wordCount", "字数")}: {item.wordCount}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="small"
                variant="text"
                icon={<ChevronRight size={14} />}
                onClick={() => handleViewDetails(item)}
              >
                {t("novel.search.viewDetails", "查看详情")}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        !searching && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("novel.search.emptyHint", "输入关键词搜索小说")}
          />
        )
      )}

      {/* ── Download Dialog ─────────────────────────────────────────────── */}
      <Modal
        open={!!selectedResult}
        onCancel={closeDialog}
        title={
          <span className="flex items-center gap-2">
            <Download size={16} />
            {selectedResult?.title ?? ""} — {t("novel.download.title", "下载")}
          </span>
        }
        footer={null}
        size="default"
        width={560}
      >
        {loadingInfo ? (
          <div className="flex items-center justify-center py-10">
            <Spin />
          </div>
        ) : bookInfo ? (
          <div className="space-y-4">
            {/* Book meta */}
            <div className="space-y-2 text-sm">
              <div className="flex gap-2">
                <span className="text-[var(--text-muted)] w-16 shrink-0">
                  📖 {t("novel.download.bookName", "书名")}
                </span>
                <span className="font-medium">{bookInfo.bookName}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-[var(--text-muted)] w-16 shrink-0">
                  ✍️ {t("novel.download.author", "作者")}
                </span>
                <span>{bookInfo.author || "—"}</span>
              </div>
              {bookInfo.summary && (
                <div className="flex gap-2">
                  <span className="text-[var(--text-muted)] w-16 shrink-0">
                    📝 {t("novel.download.summary", "简介")}
                  </span>
                  <span className="line-clamp-3 text-[var(--text-secondary)]">
                    {bookInfo.summary}
                  </span>
                </div>
              )}
              <div className="flex gap-4 flex-wrap">
                <span className="text-[var(--text-muted)]">
                  📊 {bookInfo.serialStatus || "—"}
                </span>
                <span className="text-[var(--text-muted)]">
                  {t("novel.download.chapters", "章节")}:{" "}
                  {bookInfo.totalChapters}
                </span>
                {bookInfo.wordCount && (
                  <span className="text-[var(--text-muted)]">
                    {t("novel.download.wordCount", "字数")}:{" "}
                    {bookInfo.wordCount}
                  </span>
                )}
              </div>
            </div>

            {/* Library selector + Year */}
            {!downloadProgress?.done && (
              <div className="space-y-3 pt-2 border-t border-[var(--glass-border)]">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[var(--text-muted)] w-24 shrink-0">
                    {t("novel.download.targetLibrary", "目标媒体库")}
                  </span>
                  <Select
                    className="flex-1"
                    value={selectedLibraryId}
                    onChange={setSelectedLibraryId}
                    options={novelLibraries.map((lib) => ({
                      value: lib.id,
                      label: lib.name,
                    }))}
                    placeholder={t(
                      "novel.download.selectLibrary",
                      "选择小说库",
                    )}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-[var(--text-muted)] w-24 shrink-0">
                    {t("novel.download.year", "年份 (可选)")}
                  </span>
                  <input
                    className="flex-1 rounded-md border border-black/[0.08] dark:border-white/[0.1] bg-white/70 dark:bg-white/[0.03] px-3 h-9 text-sm outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
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
                  disabled={!selectedLibraryId || downloading}
                  onClick={handleDownload}
                >
                  {t("novel.download.startDownload", "开始下载")}
                </Button>
              </div>
            )}

            {/* Download progress */}
            {downloadProgress && (
              <div className="space-y-2 pt-2 border-t border-[var(--glass-border)]">
                <div className="text-xs font-medium text-[var(--text-secondary)]">
                  {downloadProgress.done
                    ? `✅ ${t("novel.download.complete", "下载完成!")} ${downloadProgress.downloaded}/${downloadProgress.total} ${t("novel.download.success", "成功")}, ${downloadProgress.failed} ${t("novel.download.failed", "失败")}`
                    : `${t("novel.download.downloading", "下载中...")} ${downloadProgress.downloaded}/${downloadProgress.total}`}
                </div>
                {/* Progress bar */}
                <div className="w-full h-2 bg-black/[0.06] dark:bg-white/[0.08] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[var(--accent)] rounded-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
                {!downloadProgress.done && downloadProgress.currentChapter && (
                  <div className="text-xs text-[var(--text-muted)] truncate">
                    {t("novel.download.current", "当前")}:{" "}
                    {downloadProgress.currentChapter}
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-red-500">
            {t("novel.download.loadFailed", "获取书籍信息失败，请重试")}
          </div>
        )}
      </Modal>
    </div>
  );
}
