import { Empty, PosterCard, Spin, Tag } from "@tokiomo/components";
import { BookOpen } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NovelOutput } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import { buildPosterUrl } from "@/lib/poster";
import { useWindowNav } from "@/system";

const MIN_CARD_WIDTH = 150;
const CARD_GAP = 12;
const CARD_TITLE_HEIGHT = 52;

const SORT_OPTIONS = [
  { label: "最近添加", value: "addedAt" },
  { label: "标题 A-Z", value: "title_asc" },
  { label: "标题 Z-A", value: "title_desc" },
  { label: "作者", value: "author_asc" },
  { label: "年份 最新", value: "year_desc" },
  { label: "字数 最多", value: "wordCount_desc" },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];

function parseSortValue(v: SortValue): {
  sortBy: string;
  sortDir: string;
} {
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

function formatWordCount(count: number | null): string {
  if (count == null) return "";
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万字`;
  return `${count}字`;
}

// ── Book Card ────────────────────────────────────────────────────────────────
function BookCard({
  item,
  onClick,
}: {
  item: NovelOutput;
  onClick: () => void;
}) {
  return (
    <PosterCard
      src={item.coverPath ? buildPosterUrl(item.coverPath) : undefined}
      alt={item.title}
      fallback={
        <div className="flex h-full flex-col items-center justify-center gap-2 text-zinc-600 dark:text-zinc-400">
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
                <span className="text-emerald-500">完结</span>
              ) : (
                <span className="text-blue-500">连载</span>
              )}
            </span>
          )}
          {item.chapterCount != null && item.chapterCount > 0 && (
            <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white backdrop-blur-sm">
              {item.chapterCount}章
            </span>
          )}
          {!item.scrapedAt && (
            <span
              className="absolute top-1.5 left-1.5 h-2 w-2 rounded-full bg-orange-400 ring-1 ring-black/30"
              title="未刮削"
            />
          )}
        </>
      }
      onClick={onClick}
    >
      <p
        className="truncate text-sm font-medium text-gray-900 dark:text-gray-100"
        title={item.title}
      >
        {item.title}
      </p>
      <p className="truncate text-xs text-zinc-600 dark:text-zinc-400">
        {[item.author, item.wordCount ? formatWordCount(item.wordCount) : null]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </PosterCard>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function NovelAppPage() {
  const { params, navigate: navInWindow } = useWindowNav();
  const id = params.appId as string | undefined;

  const [page, setPage] = useState(1);
  const [allItems, setAllItems] = useState<NovelOutput[]>([]);
  const [sortValue, setSortValue] = useState<SortValue>("addedAt");
  const lastAppendedPageRef = useRef(0);
  const isLoadingMoreRef = useRef(false);

  // ── Grid layout ─────────────────────────────────────────────────────────────
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

  const resetPagination = useCallback(() => {
    lastAppendedPageRef.current = 0;
    setAllItems([]);
    setPage(1);
  }, []);

  // ── Data ────────────────────────────────────────────────────────────────────
  api.app.getById.useQuery({ id: id! }, { enabled: !!id });

  const sortParams = parseSortValue(sortValue);

  const novelsQuery = api.novel.listNovels.useQuery(
    {
      appId: id!,
      page,
      pageSize,
      sortBy: sortParams.sortBy,
      sortDir: sortParams.sortDir,
    },
    { enabled: !!id },
  );

  const total = novelsQuery.data?.total ?? 0;
  const hasMore = allItems.length < total;

  // Append items
  useEffect(() => {
    const items = novelsQuery.data?.items;
    if (!items || novelsQuery.data?.page == null) return;
    const currentPage = novelsQuery.data.page;
    if (currentPage <= lastAppendedPageRef.current) return;
    lastAppendedPageRef.current = currentPage;
    setAllItems((prev) => {
      const existingIds = new Set(prev.map((i) => i.id));
      const newItems = items.filter((i) => !existingIds.has(i.id));
      return [...prev, ...newItems];
    });
    isLoadingMoreRef.current = false;
  }, [novelsQuery.data]);

  // Infinite scroll (nearest scrollable ancestor — matches MediaAppPage)
  useEffect(() => {
    let container: HTMLElement | null =
      gridWrapperRef.current?.parentElement ?? null;
    while (container) {
      const ov = getComputedStyle(container).overflowY;
      if (ov === "auto" || ov === "scroll") break;
      container = container.parentElement;
    }
    if (!container) return;

    const check = () => {
      if (isLoadingMoreRef.current || !hasMore || novelsQuery.isFetching)
        return;
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollTop + clientHeight >= scrollHeight - 600) {
        isLoadingMoreRef.current = true;
        setPage((p) => p + 1);
      }
    };

    container.addEventListener("scroll", check, { passive: true });
    check();
    return () => container.removeEventListener("scroll", check);
  }, [hasMore, novelsQuery.isFetching]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSortChange = (v: SortValue) => {
    setSortValue(v);
    resetPagination();
  };

  const handleItemClick = useCallback(
    (item: NovelOutput) => {
      navInWindow(item.title ?? "Novel", { novelId: item.id });
    },
    [navInWindow],
  );

  if (!id) return null;

  return (
    <div className="space-y-4">
      {/* Sort + Content */}
      <section className="rounded-xl border border-[var(--glass-border)] bg-black/[0.02] p-4 dark:bg-white/[0.03]">
        {/* Header */}
        <div className="mb-4 space-y-3">
          <div className="flex items-center gap-2">
            <h5 className="text-base font-semibold text-gray-800 dark:text-gray-100">
              全部
            </h5>
            <Tag>{total}</Tag>
          </div>

          {/* 排序 */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-0.5 text-xs text-zinc-600 dark:text-gray-500">
              排序
            </span>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSortChange(opt.value)}
                className={`cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  sortValue === opt.value
                    ? "bg-primary text-white"
                    : "bg-black/[0.05] text-gray-600 hover:bg-black/[0.1] dark:bg-white/[0.08] dark:text-zinc-300 dark:hover:bg-white/[0.14]"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Content — wrapper always mounted for ResizeObserver */}
        <div ref={gridWrapperRef}>
          {novelsQuery.isLoading && allItems.length === 0 ? (
            <div className="flex h-64 items-center justify-center">
              <Spin />
            </div>
          ) : allItems.length === 0 ? (
            <Empty description="暂无小说" />
          ) : (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                  gap: CARD_GAP,
                }}
              >
                {allItems.map((item) => (
                  <BookCard
                    key={item.id}
                    item={item}
                    onClick={() => handleItemClick(item)}
                  />
                ))}
              </div>

              <div className="mt-2 flex justify-center py-3">
                {novelsQuery.isFetching && <Spin />}
                {!hasMore && total > 0 && !novelsQuery.isFetching && (
                  <p className="text-xs text-zinc-600 dark:text-zinc-400">
                    已加载全部 {total} 本
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
