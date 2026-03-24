import {
  Button,
  Empty,
  Modal,
  PosterCard,
  Spin,
  SyncOutlined,
} from "@tokiomo/components";
import { BookOpen, Plus, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import NovelDownloadModal from "../../components/dashboard/NovelDownloadModal";
import NovelDownloadPopover from "../../components/dashboard/NovelDownloadPopover";
import { useWindowNav } from "../../components/window-manager/WindowNavContext";
import type { NovelOutput } from "../../generated/rust-api";
import { api } from "../../generated/rust-api";
import { useMessage } from "../../hooks";
import { buildPosterUrl } from "../../lib/poster";
import { AppSearchBox } from "./AppSearchBox";

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
        <div className="flex h-full flex-col items-center justify-center gap-2 text-gray-400">
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
      <p className="truncate text-xs text-gray-400">
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
  const message = useMessage();

  const [page, setPage] = useState(1);
  const [allItems, setAllItems] = useState<NovelOutput[]>([]);
  const [sortValue, setSortValue] = useState<SortValue>("addedAt");
  const [searchText, setSearchText] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const lastAppendedPageRef = useRef(0);
  const isLoadingMoreRef = useRef(false);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

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
  const libraryQuery = api.app.getById.useQuery({ id: id! }, { enabled: !!id });
  const library = libraryQuery.data;

  const sortParams = parseSortValue(sortValue);

  const novelsQuery = api.novel.listNovels.useQuery(
    {
      appId: id!,
      page,
      pageSize,
      sortBy: sortParams.sortBy,
      sortDir: sortParams.sortDir,
      search: searchText || undefined,
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

  // Infinite scroll
  useEffect(() => {
    const handleScroll = () => {
      if (isLoadingMoreRef.current || !hasMore || novelsQuery.isFetching)
        return;
      const scrollBottom =
        document.documentElement.scrollHeight -
        window.scrollY -
        window.innerHeight;
      if (scrollBottom < 600) {
        isLoadingMoreRef.current = true;
        setPage((p) => p + 1);
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [hasMore, novelsQuery.isFetching]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSortChange = useCallback(
    (v: SortValue) => {
      setSortValue(v);
      resetPagination();
    },
    [resetPagination],
  );

  const handleSearch = useCallback(() => {
    setSearchText(searchInput.trim());
    resetPagination();
  }, [searchInput, resetPagination]);

  const handleSearchClear = useCallback(() => {
    setSearchInput("");
    setSearchText("");
    resetPagination();
  }, [resetPagination]);

  const handleItemClick = useCallback(
    (item: NovelOutput) => {
      navInWindow(item.title ?? "Novel", { novelId: item.id });
    },
    [navInWindow],
  );

  // ── Sync ────────────────────────────────────────────────────────────────────
  const syncMut = api.app.sync.useMutation({
    onSuccess: () => {
      message.success({ content: "同步已开始" });
      setSyncModalOpen(false);
    },
    onError: () => {
      message.error({ content: "同步失败" });
    },
  });

  const handleSync = useCallback(() => {
    if (!id) return;
    syncMut.mutate({ id });
  }, [id, syncMut]);

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      {/* Global search box — matches video library UX */}
      {id && (
        <div className="mb-6">
          <AppSearchBox
            appId={id}
            isTv={false}
            isNovel
            onSelect={() => {}}
            onSelectNovel={(item) =>
              navInWindow(item.title ?? "Novel", { novelId: item.id })
            }
          />
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">{library?.name ?? "小说库"}</h1>
          {total > 0 && (
            <p className="mt-1 text-sm text-gray-500">共 {total} 本</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <NovelDownloadPopover />
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            onClick={() => setDownloadOpen(true)}
          >
            下载小说
          </Button>
          <Button
            icon={<SyncOutlined />}
            onClick={() => setSyncModalOpen(true)}
          >
            同步
          </Button>
        </div>
      </div>

      {/* Toolbar: sort + search */}
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-xs text-gray-400">排序</span>
          {SORT_OPTIONS.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => handleSortChange(opt.value)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                sortValue === opt.value
                  ? "bg-[var(--accent)] text-white"
                  : "bg-black/[0.05] text-gray-600 hover:bg-black/[0.1] dark:bg-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.12]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="搜索标题/作者…"
              className="h-8 w-48 rounded-md border border-[var(--glass-border)] bg-transparent pl-8 pr-3 text-sm outline-none focus:border-[var(--accent)]"
            />
            <Search
              size={14}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-gray-400"
            />
          </div>
          {searchText && (
            <button
              type="button"
              onClick={handleSearchClear}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {/* Grid */}
      <div ref={gridWrapperRef}>
        {novelsQuery.isLoading && allItems.length === 0 ? (
          <div className="flex justify-center py-20">
            <Spin />
          </div>
        ) : allItems.length === 0 ? (
          <Empty description={searchText ? "未找到匹配的小说" : "暂无小说"} />
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
                <p className="text-xs text-gray-400">已加载全部 {total} 本</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Sync Modal */}
      <Modal
        open={syncModalOpen}
        onCancel={() => setSyncModalOpen(false)}
        title="同步小说库"
        footer={null}
      >
        <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
          将扫描应用目录并更新小说元数据。
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setSyncModalOpen(false)}>取消</Button>
          <Button
            variant="primary"
            loading={syncMut.isPending}
            onClick={handleSync}
          >
            开始同步
          </Button>
        </div>
      </Modal>

      {/* Download Modal */}
      <NovelDownloadModal
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        appId={id ?? ""}
        appName={library?.name ?? "小说库"}
      />
    </div>
  );
}
