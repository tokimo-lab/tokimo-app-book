import { useQueryClient } from "@tanstack/react-query";
import { Spin } from "@tokimo/ui";
import { BookOpen, Plus } from "lucide-react";
import { Suspense, useCallback, useEffect, useState } from "react";
import BookLibraryEditor from "@/apps/settings/admin/BookLibraryEditor";
import { api } from "@/generated/rust-api";
import { useContainerWidth } from "@/shared/hooks/use-container-width";
import { useSidebarCollapsed } from "@/shared/hooks/use-sidebar-collapsed";
import { useSyncProgress } from "@/shared/hooks/use-sync-progress";
import { useWindowNav } from "@/system";
import BookContent from "../pages/BookAppPage";
import BookSidebar from "./BookSidebar";

/** See PHOTO_SCAN_JOB_TYPES. Backend: apps/book/handlers/sync.rs */
const BOOK_SCAN_JOB_TYPES = ["book_scrape"] as const;

type ViewMode = "content" | "settings" | "settings-new";

const LoadingFallback = (
  <div className="flex h-full items-center justify-center">
    <Spin />
  </div>
);

export default function BookApp() {
  const { LazyViewComponent, params, replace, updateTitle } = useWindowNav();
  const { data: libraries, isLoading } = api.book.list.useQuery();
  const [containerRef, containerWidth] = useContainerWidth();
  const { collapsed: sidebarCollapsed, onToggleCollapse } = useSidebarCollapsed(
    "book",
    containerWidth > 0 && containerWidth < 720,
  );
  const [mode, setMode] = useState<ViewMode>("content");

  const activeLibraryId = params.libraryId ?? null;

  const openSettings = useCallback(() => {
    setMode("settings");
  }, []);

  const openCreate = useCallback(() => {
    setMode("settings-new");
  }, []);

  useEffect(() => {
    if (!libraries?.length) return;
    if (params.libraryId) {
      const valid = libraries.some((l) => l.id === params.libraryId);
      if (!valid) replace(`/library/${libraries[0].id}`);
      return;
    }
    replace(`/library/${libraries[0].id}`);
  }, [libraries, params.libraryId, replace]);

  const activeLibrary = libraries?.find((l) => l.id === activeLibraryId);
  const isDetailPage = !!params.bookId;
  const isSettingsView = mode !== "content";

  useEffect(() => {
    if (isDetailPage) return;
    if (mode === "settings-new") {
      updateTitle("TokimoBook · 新建书库");
    } else if (mode === "settings" && activeLibrary) {
      updateTitle(`TokimoBook · ${activeLibrary.name} · 设置`);
    } else if (activeLibrary) {
      updateTitle(`TokimoBook · ${activeLibrary.name}`);
    }
  }, [activeLibrary, mode, isDetailPage, updateTitle]);

  const handleSelectLibrary = (id: string) => {
    replace(`/library/${id}`);
    setMode("content");
  };

  const handleSaved = (savedId: string) => {
    replace(`/library/${savedId}`);
    setMode("content");
  };

  const handleDeleted = () => {
    const remaining = (libraries ?? []).filter((l) => l.id !== activeLibraryId);
    const next = remaining[0]?.id;
    if (next) {
      replace(`/library/${next}`);
    } else {
      replace("/");
    }
    setMode("content");
  };

  const handleCancel = () => {
    setMode("content");
  };

  // ── Sync progress tracking (WS-driven + fallback polling) ──
  const queryClient = useQueryClient();

  const syncProgress = useSyncProgress({
    libraries,
    progressQueryKey: (id) => api.book.getSyncProgress.queryKey({ id }),
    fetchProgress: (id) => api.book.getSyncProgress.fetch({ id }),
    scanJobTypes: BOOK_SCAN_JOB_TYPES,
    onContentRefresh: () => {
      api.book.listItems.invalidate(queryClient);
    },
    onLibraryRefresh: () => {
      api.book.list.invalidate(queryClient);
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spin />
      </div>
    );
  }

  if (!libraries?.length) {
    if (mode === "settings-new") {
      return (
        <div ref={containerRef} className="relative flex h-full">
          <BookSidebar
            libraries={[]}
            activeId={null}
            onSelect={handleSelectLibrary}
            collapsed={sidebarCollapsed}
            onCreateClick={openCreate}
            onSettingsClick={openSettings}
            onToggleCollapse={onToggleCollapse}
            settingsActive
          />
          <div className="min-w-0 flex-1 overflow-hidden h-full">
            <BookLibraryEditor
              key="__new__"
              onSaved={handleSaved}
              onCancel={handleCancel}
            />
          </div>
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400">
          <BookOpen className="h-8 w-8" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-fg-primary">
            开始使用 TokimoBook
          </h2>
          <p className="mt-1 text-sm text-fg-muted">
            创建一个书库来管理你的图书和小说
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
        >
          <Plus className="h-4 w-4" />
          新建书库
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative flex h-full">
      <BookSidebar
        libraries={libraries}
        activeId={activeLibraryId}
        onSelect={handleSelectLibrary}
        collapsed={sidebarCollapsed}
        onCreateClick={openCreate}
        onSettingsClick={openSettings}
        syncProgress={syncProgress}
        onToggleCollapse={onToggleCollapse}
        settingsActive={isSettingsView && !isDetailPage}
      />
      <div
        className={`min-w-0 flex-1 overflow-auto${isDetailPage ? " px-3 py-3 lg:px-4 lg:py-4" : ""}`}
      >
        {isDetailPage && LazyViewComponent ? (
          <Suspense fallback={LoadingFallback}>
            <LazyViewComponent />
          </Suspense>
        ) : mode === "settings-new" ? (
          <BookLibraryEditor
            key="__new__"
            onSaved={handleSaved}
            onCancel={handleCancel}
          />
        ) : mode === "settings" && activeLibraryId ? (
          <BookLibraryEditor
            key={activeLibraryId}
            bookId={activeLibraryId}
            onSaved={handleSaved}
            onDeleted={handleDeleted}
            onCancel={handleCancel}
          />
        ) : (
          activeLibraryId &&
          activeLibrary && (
            <BookContent
              key={activeLibraryId}
              bookId={activeLibraryId}
              syncing={!!syncProgress[activeLibraryId]?.isActive}
            />
          )
        )}
      </div>
    </div>
  );
}
