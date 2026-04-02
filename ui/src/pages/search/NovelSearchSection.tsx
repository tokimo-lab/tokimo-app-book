import {
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Spin,
  Tag,
} from "@tokiomo/components";
import {
  BookOpen,
  ChevronRight,
  Download,
  Search,
  User,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/generated/rust-api";
import type { NovelSearchResultOutput } from "@/generated/rust-types";
import { rustUrl } from "@/lib/rust-api-runtime";

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

// ── Result ranking helpers ────────────────────────────────────────────────────

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

function scoreResult(item: NovelSearchResultOutput, keyword: string): number {
  const nt = normalizeTitle(item.title);
  const nk = normalizeTitle(keyword);
  if (nt === nk) return 100;
  if (nt.startsWith(nk)) return 80;
  if (nk.startsWith(nt)) return 70;
  if (nt.includes(nk)) return 60;
  if (nk.includes(nt)) return 50;
  return 10;
}

function parseWordCount(wc: string): number {
  if (!wc) return 0;
  const m = wc.match(/([\d.]+)\s*万/);
  if (m) return Number.parseFloat(m[1]) * 10000;
  const n = Number.parseInt(wc.replace(/\D/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
}

interface RankedBook {
  best: NovelSearchResultOutput;
  sources: NovelSearchResultOutput[];
  score: number;
}

function rankAndDedup(
  results: NovelSearchResultOutput[],
  keyword: string,
): RankedBook[] {
  const groups = new Map<string, NovelSearchResultOutput[]>();
  for (const item of results) {
    const key = `${normalizeTitle(item.title)}||${normalizeTitle(item.author || "")}`;
    const arr = groups.get(key);
    if (arr) arr.push(item);
    else groups.set(key, [item]);
  }
  const ranked: RankedBook[] = [];
  for (const sources of groups.values()) {
    const best = sources.reduce((a, b) =>
      parseWordCount(b.wordCount) > parseWordCount(a.wordCount) ? b : a,
    );
    ranked.push({ best, sources, score: scoreResult(best, keyword) });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return parseWordCount(b.best.wordCount) - parseWordCount(a.best.wordCount);
  });
  return ranked;
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
  const librariesQuery = api.app.list.useQuery({ staleTime: 60_000 });
  const novelLibraries = (librariesQuery.data ?? []).filter(
    (lib) => lib.type === "novel",
  );

  // Provider count
  const providersQuery = api.novel.listProviders.useQuery({
    staleTime: 5 * 60_000,
  });

  const bookInfoMutation = api.novel.getBookInfo.useMutation();

  // ── Ranked & deduped results ─────────────────────────────────────────────

  const rankedBooks = useMemo(
    () => rankAndDedup(results, keyword),
    [results, keyword],
  );
  const bestMatch =
    rankedBooks.length > 0 && rankedBooks[0].score >= 80
      ? rankedBooks[0]
      : null;
  const otherBooks = bestMatch ? rankedBooks.slice(1) : rankedBooks;

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
      "/api/apps/novel/search",
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
      "/api/apps/novel/download",
      {
        provider: selectedResult.site,
        bookId: selectedResult.bookId,
        appId: selectedLibraryId,
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
        <Input
          prefix={<Search size={16} />}
          suffix={
            keyword ? (
              <button
                type="button"
                onClick={() => setKeyword("")}
                className="cursor-pointer text-[var(--text-muted)] hover:text-fg-secondary"
              >
                <X size={14} />
              </button>
            ) : undefined
          }
          size="large"
          className="flex-1"
          placeholder={t("novel.search.placeholder", "输入小说名称或作者...")}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
        />
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
        <div className="flex items-center gap-2 text-xs text-fg-muted mb-3">
          <Spin size="small" />
          <span>
            {t("novel.search.searching", "正在搜索 {{count}} 个站点...", {
              count: providerCount,
            })}
            {rankedBooks.length > 0 &&
              ` ${t("novel.search.foundBooks", "已找到 {{count}} 本书", { count: rankedBooks.length })}`}
          </span>
        </div>
      )}

      {/* Best match */}
      {bestMatch && (
        <div className="mb-4 rounded-lg border-2 border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-xs font-semibold text-[var(--accent)] uppercase tracking-wide">
              {t("novel.search.bestMatch", "最佳匹配")}
            </span>
            {bestMatch.sources.length > 1 && (
              <Tag className="!text-[10px]">
                {t("novel.search.sourceCount", "{{count}} 个源", {
                  count: bestMatch.sources.length,
                })}
              </Tag>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <BookOpen size={16} className="shrink-0 text-[var(--accent)]" />
                <span className="font-semibold text-base text-[var(--text-primary)]">
                  {bestMatch.best.title}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                <span className="flex items-center gap-1">
                  <User size={11} />
                  {bestMatch.best.author || "—"}
                </span>
                {bestMatch.best.wordCount && (
                  <span>
                    {t("novel.search.wordCount", "字数")}:{" "}
                    {bestMatch.best.wordCount}
                  </span>
                )}
                {bestMatch.best.latestChapter && (
                  <span className="truncate max-w-[200px]">
                    {t("novel.search.latest", "最新")}:{" "}
                    {bestMatch.best.latestChapter}
                  </span>
                )}
              </div>
            </div>
            <Button
              variant="primary"
              icon={<Download size={16} />}
              onClick={() => handleViewDetails(bestMatch.best)}
            >
              {t("novel.download.title", "下载")}
            </Button>
          </div>
        </div>
      )}

      {/* Other results */}
      {otherBooks.length > 0 && (
        <div className="mb-2 flex items-center gap-2">
          <span className="text-sm font-medium text-[var(--text-secondary)]">
            {bestMatch
              ? t("novel.search.otherResults", "其他结果")
              : t("novel.search.results", "搜索结果")}
          </span>
          <Tag>{otherBooks.length}</Tag>
        </div>
      )}

      {otherBooks.length > 0 ? (
        <div className="divide-y divide-[var(--glass-border)] rounded-lg border border-[var(--glass-border)] overflow-hidden">
          {otherBooks.map((book) => (
            <div
              key={`${book.best.site}-${book.best.bookId}`}
              className="flex items-center justify-between px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.04] transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <BookOpen
                    size={14}
                    className="shrink-0 text-[var(--accent)]"
                  />
                  <span className="font-medium text-sm text-[var(--text-primary)] truncate">
                    {book.best.title}
                  </span>
                  <Tag className="!text-[10px]">{book.best.site}</Tag>
                  {book.sources.length > 1 && (
                    <Tag className="!text-[10px]">
                      +{book.sources.length - 1}
                    </Tag>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                  <span className="flex items-center gap-1">
                    <User size={11} />
                    {book.best.author || "—"}
                  </span>
                  {book.best.latestChapter && (
                    <span className="truncate max-w-[200px]">
                      {t("novel.search.latest", "最新")}:{" "}
                      {book.best.latestChapter}
                    </span>
                  )}
                  {book.best.wordCount && (
                    <span>
                      {t("novel.search.wordCount", "字数")}:{" "}
                      {book.best.wordCount}
                    </span>
                  )}
                </div>
              </div>
              <Button
                size="small"
                variant="text"
                icon={<ChevronRight size={14} />}
                onClick={() => handleViewDetails(book.best)}
              >
                {t("novel.search.viewDetails", "查看详情")}
              </Button>
            </div>
          ))}
        </div>
      ) : (
        !searching &&
        !bestMatch && (
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
                    {t("novel.download.targetLibrary", "目标应用")}
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
                  <Input
                    className="flex-1"
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
