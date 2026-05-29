import { useInfiniteScroll, useWindowNav } from "@tokimo/sdk";
import { Empty, PosterCard, Spin, Tag } from "@tokimo/ui";
import { BookOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bookApi } from "../api";
import { type BookTranslator, useBookI18n } from "../i18n";
import type { BookOutput } from "../types";
import { formatWordCount, posterThumbUrl } from "../utils";

const MIN_CARD_WIDTH = 150;
const CARD_GAP = 12;
const CARD_TITLE_HEIGHT = 52;

const SORT_OPTIONS = [
  { labelKey: "sortRecentlyAdded", value: "addedAt" },
  { labelKey: "sortTitleAsc", value: "title_asc" },
  { labelKey: "sortTitleDesc", value: "title_desc" },
  { labelKey: "sortAuthorAsc", value: "author_asc" },
  { labelKey: "sortYearDesc", value: "year_desc" },
  { labelKey: "sortWordCountDesc", value: "wordCount_desc" },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];

function parseSortValue(v: SortValue): { sortBy: string; sortDir: string } {
  switch (v) {
    case "addedAt":
      return { sortBy: "addedAt", sortDir: "desc" };
    case "title_asc":
      return { sortBy: "title", sortDir: "asc" };
    case "title_desc":
      return { sortBy: "title", sortDir: "desc" };
    case "author_asc":
      return { sortBy: "author", sortDir: "asc" };
    case "year_desc":
      return { sortBy: "year", sortDir: "desc" };
    case "wordCount_desc":
      return { sortBy: "wordCount", sortDir: "desc" };
  }
}

function BookCard({
  item,
  onClick,
  t,
  locale,
}: {
  item: BookOutput;
  onClick: () => void;
  t: BookTranslator;
  locale: string | null | undefined;
}) {
  return (
    <PosterCard
      src={posterThumbUrl(item.coverPath, 300)}
      alt={item.title}
      fallback={
        <div className="flex h-full flex-col items-center justify-center gap-2 text-fg-muted">
          <BookOpen size={36} strokeWidth={1.5} />
          <span className="max-w-[80%] truncate px-2 text-center text-xs">
            {item.title}
          </span>
        </div>
      }
      badges={
        <>
          {item.serialStatus && (
            <span className="absolute top-2 right-0 inline-flex items-center rounded-l-md border border-r-0 border-white/12 bg-[var(--sidebar-bg)] px-2 py-0.5 text-[10px] font-medium backdrop-blur-md">
              {item.serialStatus === "completed" ? (
                <span className="text-emerald-500">{t("serialCompleted")}</span>
              ) : (
                <span className="text-blue-500">{t("serialOngoing")}</span>
              )}
            </span>
          )}
          {item.chapterCount != null && item.chapterCount > 0 && (
            <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white backdrop-blur-sm">
              {t("chapterCount", { count: item.chapterCount })}
            </span>
          )}
          {!item.scrapedAt && (
            <span
              className="absolute top-1.5 left-1.5 h-2 w-2 rounded-full bg-orange-400 ring-1 ring-black/30"
              title={t("notScraped")}
            />
          )}
        </>
      }
      onClick={onClick}
    >
      <p
        className="truncate text-sm font-medium text-fg-primary"
        title={item.title}
      >
        {item.title}
      </p>
      <p className="truncate text-xs text-fg-muted">
        {[item.author, item.wordCount ? formatWordCount(item.wordCount, locale) : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </PosterCard>
  );
}

export default function BookAppPage({
  bookId: id,
  syncing,
}: {
  bookId: string;
  syncing?: boolean;
}) {
  const { navigate } = useWindowNav();
  const { t, locale } = useBookI18n();

  const [page, setPage] = useState(1);
  const [sortValue, setSortValue] = useState<SortValue>("addedAt");

  const gridWrapperRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = gridWrapperRef.current;
    if (!el) return;
    setContainerWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const cols = useMemo(
    () =>
      containerWidth > 0
        ? Math.max(
            2,
            Math.floor(
              (containerWidth + CARD_GAP) / (MIN_CARD_WIDTH + CARD_GAP),
            ),
          )
        : 4,
    [containerWidth],
  );

  const pageSize = useMemo(() => {
    const estimatedCols = Math.max(
      2,
      Math.floor(
        (window.innerWidth * 0.7 + CARD_GAP) / (MIN_CARD_WIDTH + CARD_GAP),
      ),
    );
    const cardWidth = (window.innerWidth * 0.7) / estimatedCols;
    const rowHeight = Math.round(cardWidth * 1.5) + CARD_TITLE_HEIGHT;
    const visibleRows = Math.ceil(window.innerHeight / (rowHeight + CARD_GAP));
    return Math.max(estimatedCols * (visibleRows + 6), 24);
  }, []);

  const sortParams = parseSortValue(sortValue);

  const booksQuery = bookApi.listItems.useQuery({
    id,
    page,
    pageSize,
    sortBy: sortParams.sortBy,
    sortDir: sortParams.sortDir,
  });

  const { items, total, hasMore, sentinelRef, reset } =
    useInfiniteScroll<BookOutput>({
      queryData: booksQuery.data,
      isFetching: booksQuery.isFetching,
      onLoadMore: () => setPage((p) => p + 1),
      enabled: !syncing,
    });

  const resetAll = useCallback(() => {
    reset();
    setPage(1);
  }, [reset]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally reset on id change
  useEffect(() => {
    resetAll();
    setSortValue("addedAt");
  }, [id]);

  const handleSortChange = (v: SortValue) => {
    setSortValue(v);
    resetAll();
  };

  const handleItemClick = useCallback(
    (item: BookOutput) => {
      navigate(`/books/${item.id}`, `${t("appName")} · ${item.title ?? t("appFallbackBook")}`);
    },
    [navigate, t],
  );

  if (
    (booksQuery.isLoading ||
      syncing ||
      (items.length === 0 && booksQuery.isFetching)) &&
    items.length === 0
  )
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    );

  return (
    <div className="flex h-full flex-col p-4">
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <h5 className="text-base font-semibold text-fg-primary">{t("commonAll")}</h5>
            <Tag>{total}</Tag>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs text-fg-muted">{t("commonSort")}</span>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSortChange(opt.value)}
                className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  sortValue === opt.value
                    ? "bg-primary text-white"
                    : "bg-black/[0.05] text-fg-secondary hover:bg-black/[0.1] dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
                }`}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div ref={gridWrapperRef} className="min-h-0 flex-1">
          {booksQuery.isLoading ||
          syncing ||
          (items.length === 0 && booksQuery.isFetching) ? (
            <div className="flex h-64 items-center justify-center">
              <Spin />
            </div>
          ) : items.length === 0 ? (
            <Empty description={t("emptyBooksSync")} />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: CARD_GAP,
                }}
              >
                {items.map((item) => (
                  <div key={item.id}>
                    <BookCard
                      item={item}
                      onClick={() => handleItemClick(item)}
                      t={t}
                      locale={locale}
                    />
                  </div>
                ))}
              </div>

              <div ref={sentinelRef} className="h-px" />
              <div className="mt-2 flex justify-center py-3">
                {booksQuery.isFetching && <Spin />}
                {!hasMore && total > 0 && !booksQuery.isFetching && (
                  <p className="text-xs text-fg-muted">{t("loadedAllBooks", { total })}</p>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
