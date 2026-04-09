import { Button, Empty, Modal, Spin, Tag } from "@tokiomo/components";
import {
  BookOpen,
  ChevronRight,
  Download,
  Globe,
  Search,
  User,
  X,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { api } from "@/generated/rust-api";
import type { BookSearchResultOutput } from "@/generated/rust-types";
import { rustUrl } from "@/lib/rust-api-runtime";
import { useBookDownload } from "../hooks/BookDownloadContext";

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

interface BookDownloadModalProps {
  open: boolean;
  onClose: () => void;
  bookId: string;
  appName: string;
}

// ── Ranking helpers ─────────────────────────────────────────────────────────

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, "");
}

function scoreResult(item: BookSearchResultOutput, keyword: string): number {
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
  best: BookSearchResultOutput;
  sources: BookSearchResultOutput[];
  score: number;
}

function rankAndDedup(
  results: BookSearchResultOutput[],
  keyword: string,
): RankedBook[] {
  const groups = new Map<string, BookSearchResultOutput[]>();
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

export default function BookDownloadModal({
  open,
  onClose,
  bookId,
  appName,
}: BookDownloadModalProps) {
  const { startDownload } = useBookDownload();

  // Search state
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<BookSearchResultOutput[]>([]);
  const [searching, setSearching] = useState(false);
  const [providerCount, setProviderCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // Detail state
  const [selectedBook, setSelectedBook] = useState<RankedBook | null>(null);
  const [selectedSource, setSelectedSource] =
    useState<BookSearchResultOutput | null>(null);
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [yearInput, setYearInput] = useState("");

  const providersQuery = api.book.listProviders.useQuery({
    staleTime: 5 * 60_000,
  });
  const bookInfoMutation = api.book.getBookInfo.useMutation();

  // ── Ranked results ────────────────────────────────────────────────────────

  const rankedBooks = useMemo(
    () => rankAndDedup(results, keyword),
    [results, keyword],
  );

  // ── Reset ─────────────────────────────────────────────────────────────────
  const resetAll = useCallback(() => {
    abortRef.current?.abort();
    setKeyword("");
    setResults([]);
    setSearching(false);
    setSelectedBook(null);
    setSelectedSource(null);
    setBookInfo(null);
    setLoadingInfo(false);
    setYearInput("");
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
    setSelectedBook(null);
    setSelectedSource(null);
    setBookInfo(null);
    setProviderCount(providersQuery.data?.length ?? 0);

    fetchSseEvents(
      "/api/apps/book/search",
      { keyword: trimmed },
      (evt) => {
        if (evt.event === "result") {
          try {
            const item = JSON.parse(evt.data) as BookSearchResultOutput;
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
          console.error("Book search error:", err);
        }
      })
      .finally(() => setSearching(false));
  }, [keyword, providersQuery.data?.length]);

  // ── View Details ──────────────────────────────────────────────────────────
  const fetchBookInfo = useCallback(
    (source: BookSearchResultOutput) => {
      setBookInfo(null);
      setLoadingInfo(true);

      bookInfoMutation.mutate(
        { provider: source.site, bookId: source.bookId },
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

  const handleViewDetails = useCallback(
    (book: RankedBook) => {
      setSelectedBook(book);
      setSelectedSource(book.best);
      setYearInput("");
      fetchBookInfo(book.best);
    },
    [fetchBookInfo],
  );

  const handleSourceChange = useCallback(
    (source: BookSearchResultOutput) => {
      setSelectedSource(source);
      fetchBookInfo(source);
    },
    [fetchBookInfo],
  );

  const handleBackToResults = useCallback(() => {
    setSelectedBook(null);
    setSelectedSource(null);
    setBookInfo(null);
  }, []);

  // ── Download ──────────────────────────────────────────────────────────────
  const handleDownload = useCallback(() => {
    if (!selectedSource || !bookId) return;

    startDownload({
      provider: selectedSource.site,
      bookId: selectedSource.bookId,
      libraryId: bookId,
      title: bookInfo?.bookName || selectedSource.title,
      author: bookInfo?.author || selectedSource.author,
      year: yearInput ? Number.parseInt(yearInput, 10) : undefined,
      totalChapters: bookInfo?.totalChapters,
    });

    // Close modal — progress tracked in popover
    handleClose();
  }, [selectedSource, bookId, bookInfo, yearInput, startDownload, handleClose]);

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
      {selectedBook && selectedSource ? (
        /* ── Detail view ────────────────────────────────────────────────── */
        <div className="space-y-4">
          {/* Back button */}
          <button
            type="button"
            onClick={handleBackToResults}
            className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
          >
            ← 返回搜索结果
          </button>

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
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-[var(--text-muted)]">
                    🌐 来源
                  </span>
                  <Tag className="!text-[10px]">{selectedSource.site}</Tag>
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
              <div className="space-y-3 border-t border-border-base pt-2">
                {/* Source selector */}
                {selectedBook.sources.length > 1 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                      <Globe size={14} />
                      <span>下载源</span>
                      <Tag className="!text-[10px]">
                        {selectedBook.sources.length} 个可用
                      </Tag>
                    </div>
                    <div className="max-h-[140px] space-y-1 overflow-y-auto rounded-md border border-border-base p-1">
                      {selectedBook.sources.map((source) => {
                        const isActive =
                          source.site === selectedSource.site &&
                          source.bookId === selectedSource.bookId;
                        return (
                          <button
                            type="button"
                            key={`${source.site}-${source.bookId}`}
                            onClick={() => {
                              if (!isActive) handleSourceChange(source);
                            }}
                            className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-xs transition-colors ${
                              isActive
                                ? "bg-[var(--accent)]/10 text-[var(--accent)] ring-1 ring-[var(--accent)]/30"
                                : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <Tag
                                className={`!text-[10px] shrink-0 ${isActive ? "!bg-[var(--accent)]/20 !text-[var(--accent)]" : ""}`}
                              >
                                {source.site}
                              </Tag>
                              {source.latestChapter && (
                                <span className="truncate text-[var(--text-muted)]">
                                  {source.latestChapter}
                                </span>
                              )}
                            </div>
                            {source.wordCount && (
                              <span className="shrink-0 ml-2 text-[var(--text-muted)]">
                                {source.wordCount}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm text-[var(--text-muted)]">
                    目标应用
                  </span>
                  <span className="text-sm font-medium">{appName}</span>
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
                  onClick={handleDownload}
                >
                  开始下载
                </Button>
                <p className="text-[10px] text-[var(--text-muted)] text-center">
                  下载将在后台进行，可在右上角「下载」按钮查看进度和日志
                </p>
              </div>
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
                  className="shrink-0 cursor-pointer text-[var(--text-muted)] hover:text-fg-secondary"
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
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              <Spin size="small" />
              <span>
                正在搜索 {providerCount} 个站点...
                {rankedBooks.length > 0 && ` 已找到 ${rankedBooks.length} 本书`}
              </span>
            </div>
          )}

          {/* Best match */}
          {rankedBooks.length > 0 && rankedBooks[0].score >= 80 && (
            <div className="rounded-lg border-2 border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-[var(--accent)] uppercase tracking-wide">
                  最佳匹配
                </span>
                {rankedBooks[0].sources.length > 1 && (
                  <Tag className="!text-[10px]">
                    {rankedBooks[0].sources.length} 个源
                  </Tag>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <BookOpen
                      size={16}
                      className="shrink-0 text-[var(--accent)]"
                    />
                    <span className="font-semibold text-sm text-[var(--text-primary)]">
                      {rankedBooks[0].best.title}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
                    <span className="flex items-center gap-1">
                      <User size={11} />
                      {rankedBooks[0].best.author || "—"}
                    </span>
                    {rankedBooks[0].best.wordCount && (
                      <span>字数: {rankedBooks[0].best.wordCount}</span>
                    )}
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="small"
                  icon={<Download size={14} />}
                  onClick={() => handleViewDetails(rankedBooks[0])}
                >
                  下载
                </Button>
              </div>
            </div>
          )}

          {/* Other results */}
          {(() => {
            const others =
              rankedBooks.length > 0 && rankedBooks[0].score >= 80
                ? rankedBooks.slice(1)
                : rankedBooks;
            return others.length > 0 ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    {rankedBooks[0]?.score >= 80 ? "其他结果" : "搜索结果"}
                  </span>
                  <Tag>{others.length}</Tag>
                </div>
                <div className="max-h-[350px] divide-y divide-[var(--border-base)] overflow-y-auto rounded-lg border border-border-base">
                  {others.map((book) => (
                    <div
                      key={`${book.best.site}-${book.best.bookId}`}
                      className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-black/[0.02] dark:hover:bg-white/[0.04]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <BookOpen
                            size={14}
                            className="shrink-0 text-[var(--accent)]"
                          />
                          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
                            {book.best.title}
                          </span>
                          <Tag className="!text-[10px]">{book.best.site}</Tag>
                          {book.sources.length > 1 && (
                            <Tag className="!text-[10px]">
                              +{book.sources.length - 1}
                            </Tag>
                          )}
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-[var(--text-muted)]">
                          <span className="flex items-center gap-1">
                            <User size={11} />
                            {book.best.author || "—"}
                          </span>
                          {book.best.latestChapter && (
                            <span className="max-w-[200px] truncate">
                              最新: {book.best.latestChapter}
                            </span>
                          )}
                          {book.best.wordCount && (
                            <span>字数: {book.best.wordCount}</span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="small"
                        variant="text"
                        icon={<ChevronRight size={14} />}
                        onClick={() => handleViewDetails(book)}
                      >
                        查看详情
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              !searching && rankedBooks.length === 0 && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="输入关键词搜索小说"
                />
              )
            );
          })()}
        </div>
      )}
    </Modal>
  );
}
