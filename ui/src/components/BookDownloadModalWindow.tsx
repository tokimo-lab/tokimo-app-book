import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RuntimeProvider, type ShellWindowHandle } from "@tokimo/sdk";
import {
  Button,
  Empty,
  Spin,
  Tag,
  ConfigProvider,
  ToastProvider,
} from "@tokimo/ui";
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
import { bookApi } from "../api";
import { AppCtxProvider } from "../AppContext";
import { getBookI18n, useBookI18n } from "../i18n";
import { getBridge, type ModalBridge } from "../modal-bridge";
import type { BookSearchResultOutput } from "../types";

type BookDownloadBridge = Extract<ModalBridge, { kind: "book-download" }>;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// ── SSE helpers ───────────────────────────────────────────────────────────────

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

// ── Types ─────────────────────────────────────────────────────────────────────

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

// ── Ranking helpers ───────────────────────────────────────────────────────────

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
  const m = /([0-9.]+)\s*万/.exec(wc);
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

// ── Component ─────────────────────────────────────────────────────────────────

function BookDownloadModalContent({
  win,
  bridge,
}: {
  win: ShellWindowHandle;
  bridge: BookDownloadBridge;
}) {
  const { t } = useBookI18n();
  const { bookId, appName, startDownload } = bridge;

  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<BookSearchResultOutput[]>([]);
  const [searching, setSearching] = useState(false);
  const [providerCount, setProviderCount] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const [selectedBook, setSelectedBook] = useState<RankedBook | null>(null);
  const [selectedSource, setSelectedSource] =
    useState<BookSearchResultOutput | null>(null);
  const [bookInfo, setBookInfo] = useState<BookInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(false);
  const [yearInput, setYearInput] = useState("");

  const providersQuery = bookApi.listProviders.useQuery({
    staleTime: 5 * 60_000,
  });
  const bookInfoMutation = bookApi.getBookInfo.useMutation();

  const rankedBooks = useMemo(
    () => rankAndDedup(results, keyword),
    [results, keyword],
  );

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
    win.close();
  }, [resetAll, win]);

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
      .catch((err: unknown) => {
        if ((err as { name?: string }).name !== "AbortError") {
          console.error("Book search error:", err);
        }
      })
      .finally(() => setSearching(false));
  }, [keyword, providersQuery.data?.length]);

  const fetchBookInfo = useCallback(
    (source: BookSearchResultOutput) => {
      setBookInfo(null);
      setLoadingInfo(true);

      bookInfoMutation.mutate(
        { provider: source.site, bookId: source.bookId },
        {
          onSuccess: (data) => {
            setBookInfo(data);
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

    handleClose();
  }, [selectedSource, bookId, bookInfo, yearInput, startDownload, handleClose]);

  return (
    <div className="h-full overflow-auto p-4">
      <div className="mb-4 flex items-center gap-2 text-base font-semibold text-fg-primary">
        <Download size={16} />
        {t("downloadTitle")}
      </div>
      {selectedBook && selectedSource ? (
        <div className="space-y-4">
          <button
            type="button"
            onClick={handleBackToResults}
            className="cursor-pointer flex items-center gap-1 text-xs text-[var(--accent)] hover:underline"
          >
            {t("downloadBackToResults")}
          </button>

          {loadingInfo ? (
            <div className="flex items-center justify-center py-10">
              <Spin />
            </div>
          ) : bookInfo ? (
            <div className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-[var(--text-muted)]">
                    {t("downloadBookName")}
                  </span>
                  <span className="font-medium">{bookInfo.bookName}</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-[var(--text-muted)]">
                    {t("downloadAuthor")}
                  </span>
                  <span>{bookInfo.author || "—"}</span>
                </div>
                <div className="flex gap-2">
                  <span className="w-16 shrink-0 text-[var(--text-muted)]">
                    {t("downloadSource")}
                  </span>
                  <Tag className="!text-[10px]">{selectedSource.site}</Tag>
                </div>
                {bookInfo.summary && (
                  <div className="flex gap-2">
                    <span className="w-16 shrink-0 text-[var(--text-muted)]">
                      {t("downloadSummary")}
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
                    {t("commonChapters")}: {bookInfo.totalChapters}
                  </span>
                  {bookInfo.wordCount && (
                    <span className="text-[var(--text-muted)]">
                      {t("commonWordCount")}: {bookInfo.wordCount}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-3 border-t border-border-base pt-2">
                {selectedBook.sources.length > 1 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                      <Globe size={14} />
                      <span>{t("downloadSources")}</span>
                      <Tag className="!text-[10px]">
                        {t("downloadAvailableSources", {
                          count: selectedBook.sources.length,
                        })}
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
                            className={`cursor-pointer flex w-full items-center justify-between rounded px-3 py-2 text-left text-xs transition-colors ${
                              isActive
                                ? "bg-[var(--accent)]/10 text-[var(--accent)] ring-1 ring-[var(--accent)]/30"
                                : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                            }`}
                          >
                            <div className="flex min-w-0 items-center gap-2">
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
                              <span className="ml-2 shrink-0 text-[var(--text-muted)]">
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
                    {t("downloadTargetApp")}
                  </span>
                  <span className="text-sm font-medium">{appName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="w-24 shrink-0 text-sm text-[var(--text-muted)]">
                    {t("commonYearOptional")}
                  </span>
                  <input
                    className="h-10 flex-1 rounded-md border border-black/[0.08] bg-white/70 px-3 text-sm outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)] dark:border-white/[0.1] dark:bg-white/[0.03]"
                    placeholder="2005"
                    value={yearInput}
                    onChange={(e) => setYearInput(e.target.value)}
                    type="number"
                  />
                </div>
                <Button
                  variant="primary"
                  size="large"
                  className="w-full"
                  icon={<Download size={16} />}
                  onClick={handleDownload}
                >
                  {t("downloadStart")}
                </Button>
                <p className="text-center text-[10px] text-[var(--text-muted)]">
                  {t("downloadBackgroundHint")}
                </p>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-sm text-red-500">
              {t("downloadInfoFailed")}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex gap-2">
            <div className="flex h-10 flex-1 items-center gap-2 rounded-md border border-black/[0.08] bg-white/70 px-3 transition-colors focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent)] dark:border-white/[0.1] dark:bg-white/[0.03]">
              <Search size={16} className="shrink-0 text-[var(--text-muted)]" />
              <input
                className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
                placeholder={t("downloadSearchPlaceholder")}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.nativeEvent.isComposing)
                    handleSearch();
                }}
              />
              {keyword && (
                <button
                  type="button"
                  onClick={() => setKeyword("")}
                  className="cursor-pointer shrink-0 text-[var(--text-muted)] hover:text-fg-secondary"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <Button
              variant="primary"
              size="large"
              icon={<Search size={16} />}
              loading={searching}
              onClick={handleSearch}
            >
              {t("commonSearch")}
            </Button>
          </div>

          {searching && (
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              <Spin size="small" />
              <span>
                {t("downloadSearching", { count: providerCount })}
                {rankedBooks.length > 0 &&
                  t("downloadFound", { count: rankedBooks.length })}
              </span>
            </div>
          )}

          {rankedBooks.length > 0 && rankedBooks[0].score >= 80 && (
            <div className="rounded-lg border-2 border-[var(--accent)]/30 bg-[var(--accent)]/[0.04] p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--accent)]">
                  {t("downloadBestMatch")}
                </span>
                {rankedBooks[0].sources.length > 1 && (
                  <Tag className="!text-[10px]">
                    {t("downloadSourceCount", {
                      count: rankedBooks[0].sources.length,
                    })}
                  </Tag>
                )}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <BookOpen
                      size={16}
                      className="shrink-0 text-[var(--accent)]"
                    />
                    <span className="text-sm font-semibold text-[var(--text-primary)]">
                      {rankedBooks[0].best.title}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-xs text-[var(--text-muted)]">
                    <span className="flex items-center gap-1">
                      <User size={11} />
                      {rankedBooks[0].best.author || "—"}
                    </span>
                    {rankedBooks[0].best.wordCount && (
                      <span>
                        {t("commonWordCount")}: {rankedBooks[0].best.wordCount}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  variant="primary"
                  size="small"
                  icon={<Download size={14} />}
                  onClick={() => handleViewDetails(rankedBooks[0])}
                >
                  {t("commonDownload")}
                </Button>
              </div>
            </div>
          )}

          {(() => {
            const others =
              rankedBooks.length > 0 && rankedBooks[0].score >= 80
                ? rankedBooks.slice(1)
                : rankedBooks;
            return others.length > 0 ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-[var(--text-secondary)]">
                    {(rankedBooks[0]?.score ?? 0) >= 80
                      ? t("downloadOtherResults")
                      : t("downloadSearchResults")}
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
                              {t("downloadLatest", {
                                chapter: book.best.latestChapter,
                              })}
                            </span>
                          )}
                          {book.best.wordCount && (
                            <span>
                              {t("commonWordCount")}: {book.best.wordCount}
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        size="small"
                        variant="text"
                        icon={<ChevronRight size={14} />}
                        onClick={() => handleViewDetails(book)}
                      >
                        {t("downloadViewDetails")}
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              !searching && rankedBooks.length === 0 && (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t("emptySearchHint")}
                />
              )
            );
          })()}
        </div>
      )}
    </div>
  );
}

export default function BookDownloadModalWindow({
  win,
}: {
  win: ShellWindowHandle;
}) {
  const bridgeId =
    typeof win.metadata?.bridgeId === "string"
      ? win.metadata.bridgeId
      : undefined;
  const [bridge] = useState(() => (bridgeId ? getBridge(bridgeId) : undefined));

  if (bridge?.kind !== "book-download") return null;

  const locale = getBookI18n(bridge.ctx.locale).uiLocale;

  return (
    <RuntimeProvider value={bridge.ctx}>
      <AppCtxProvider value={bridge.ctx}>
        <ConfigProvider locale={locale}>
          <ToastProvider>
            <QueryClientProvider client={queryClient}>
              <BookDownloadModalContent win={win} bridge={bridge} />
            </QueryClientProvider>
          </ToastProvider>
        </ConfigProvider>
      </AppCtxProvider>
    </RuntimeProvider>
  );
}
