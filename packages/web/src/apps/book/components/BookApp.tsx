import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Spin } from "@tokiomo/components";
import { BookOpen, Plus } from "lucide-react";
import { Suspense, useEffect, useRef, useState } from "react";
import { api } from "@/generated/rust-api";
import { useContainerWidth } from "@/shared/hooks/use-container-width";
import { useWindowNav } from "@/system";
import { useJobEvents } from "@/system/events/useJobEvents";
import BookContent from "../pages/BookAppPage";
import BookSettingsModal from "./BookSettingsModal";
import BookSidebar from "./BookSidebar";

const STORAGE_KEY = "book-active-library";

const LoadingFallback = (
  <div className="flex h-full items-center justify-center">
    <Spin />
  </div>
);

export default function BookApp() {
  const { LazyViewComponent, route, navigate, updateTitle } = useWindowNav();
  const { data: libraries, isLoading } = api.book.list.useQuery();
  const [containerRef, containerWidth] = useContainerWidth();
  const sidebarCollapsed = containerWidth > 0 && containerWidth < 720;
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    if (!libraries?.length || initialized.current) return;
    initialized.current = true;
    const saved = localStorage.getItem(STORAGE_KEY);
    const id =
      saved && libraries.some((l) => l.id === saved) ? saved : libraries[0].id;
    setActiveLibraryId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, [libraries]);

  const activeLibrary = libraries?.find((l) => l.id === activeLibraryId);

  useEffect(() => {
    if (route === "/" && activeLibrary) {
      updateTitle(`TokimoBook · ${activeLibrary.name}`);
    }
  }, [route, activeLibrary, updateTitle]);

  const handleSelectLibrary = (id: string) => {
    setActiveLibraryId(id);
    localStorage.setItem(STORAGE_KEY, id);
    if (route !== "/") {
      navigate("/");
    }
  };

  // ── Sync progress tracking ──
  const queryClient = useQueryClient();

  const syncProgressQueries = useQueries({
    queries: (libraries ?? []).map((lib) => ({
      queryKey: api.book.getSyncProgress.queryKey({ id: lib.id }),
      queryFn: () => api.book.getSyncProgress.fetch({ id: lib.id }),
      enabled: lib.syncStatus === "syncing",
      refetchInterval: 3000 as const,
      staleTime: 2000,
    })),
  });

  const syncProgress: Record<string, { isActive: boolean; pct: number }> = {};
  for (let i = 0; i < (libraries ?? []).length; i++) {
    const lib = libraries![i];
    const q = syncProgressQueries[i];
    if (q?.data) {
      const d = q.data;
      const total = d.completed + d.running + d.pending + d.failed;
      const pct = total > 0 ? Math.round((d.completed / total) * 100) : 0;
      const isActive = d.status === "syncing" || d.running > 0 || d.pending > 0;
      if (isActive) {
        syncProgress[lib.id] = { isActive, pct };
      }
    } else if (lib.syncStatus === "syncing") {
      syncProgress[lib.id] = { isActive: true, pct: 0 };
    }
  }

  useJobEvents({
    onEvent: (event) => {
      if (event.type === "job_update") {
        const payload = event.job.payload as Record<string, unknown>;
        const appId = payload?.appId as string | undefined;
        if (appId && (libraries ?? []).some((l) => l.id === appId)) {
          queryClient.invalidateQueries({
            queryKey: api.book.getSyncProgress.queryKey({ id: appId }),
          });
          if (
            event.job.status === "completed" ||
            event.job.status === "failed"
          ) {
            api.book.list.invalidate(queryClient);
            api.book.listItems.invalidate(queryClient);
          }
        }
      }
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
    return (
      <>
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
            onClick={() => setSettingsOpen(true)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-700"
          >
            <Plus className="h-4 w-4" />
            新建书库
          </button>
        </div>
        <BookSettingsModal
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
        />
      </>
    );
  }

  const isDetailPage = route !== "/" && LazyViewComponent;

  return (
    <>
      <div
        ref={containerRef}
        className="grid h-full"
        style={{ gridTemplateColumns: `${sidebarCollapsed ? 48 : 200}px 1fr` }}
      >
        <BookSidebar
          libraries={libraries}
          activeId={activeLibraryId}
          onSelect={handleSelectLibrary}
          collapsed={sidebarCollapsed}
          onCreateClick={() => setSettingsOpen(true)}
          onSettingsClick={() => setSettingsOpen(true)}
          syncProgress={syncProgress}
        />
        <div
          className={`min-w-0 flex-1 overflow-auto${isDetailPage ? " px-3 py-3 lg:px-4 lg:py-4" : ""}`}
        >
          {isDetailPage ? (
            <Suspense fallback={LoadingFallback}>
              <LazyViewComponent />
            </Suspense>
          ) : (
            activeLibraryId &&
            activeLibrary && <BookContent bookId={activeLibraryId} />
          )}
        </div>
      </div>
      <BookSettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
}
