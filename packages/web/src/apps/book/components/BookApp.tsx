import { useQueryClient } from "@tanstack/react-query";
import { AppSetupGuide, Spin } from "@tokimo/ui";
import { FileText, Import, Library, Plus } from "lucide-react";
import { Suspense, useCallback, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/generated/rust-api";
import { useContainerWidth } from "@/shared/hooks/use-container-width";
import { useSidebarCollapsed } from "@/shared/hooks/use-sidebar-collapsed";
import { useJobProgress } from "@/shared/hooks/use-sync-progress";
import { useWindowActions, useWindowId, useWindowNav } from "@/system";
import { PickCancelled, pickWithBridge } from "@/system/window-bridge";
import BookContent from "../pages/BookAppPage";
import BookSidebar from "./BookSidebar";

/** See PHOTO_SCAN_JOB_TYPES. Backend: apps/book/handlers/sync.rs */
const BOOK_SCAN_JOB_TYPES = ["book_scrape"] as const;

const LoadingFallback = (
  <div className="flex h-full items-center justify-center">
    <Spin />
  </div>
);

export default function BookApp() {
  const { t } = useTranslation();
  const { LazyViewComponent, params, replace, updateTitle } = useWindowNav();
  const { data: libraries, isLoading } = api.book.list.useQuery();
  const [containerRef, containerWidth] = useContainerWidth();
  const { collapsed: sidebarCollapsed, onToggleCollapse } = useSidebarCollapsed(
    "book",
    containerWidth > 0 && containerWidth < 720,
  );

  const windowId = useWindowId();
  const { openModalWindow } = useWindowActions();

  const activeLibraryId = params.libraryId ?? null;

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

  const openEditorModal = useCallback(
    async (opts: { bookId?: string } = {}) => {
      const isEdit = !!opts.bookId;
      try {
        const created = await pickWithBridge<{ id: string }>(openModalWindow, {
          component: () =>
            import("@/apps/settings/admin/BookLibraryEditorWindow"),
          parentWindowId: windowId,
          title: isEdit ? "TokimoBook · 设置" : "TokimoBook · 新建书库",
          width: 720,
          height: 640,
          noResize: true,
          noMinimize: true,
          metadata: isEdit
            ? ({ bookId: opts.bookId } as Record<string, unknown>)
            : undefined,
        });
        if (!isEdit) {
          replace(`/library/${created.id}`);
        }
      } catch (err) {
        if (err instanceof PickCancelled) return;
        throw err;
      }
    },
    [openModalWindow, windowId, replace],
  );

  useEffect(() => {
    if (!isDetailPage && activeLibrary) {
      updateTitle(`TokimoBook · ${activeLibrary.name}`);
    }
  }, [activeLibrary, isDetailPage, updateTitle]);

  const handleSelectLibrary = (id: string) => {
    replace(`/library/${id}`);
  };

  // ── Job progress tracking (WS-driven + fallback polling) ──
  const queryClient = useQueryClient();

  const syncProgress = useJobProgress({
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
    return (
      <AppSetupGuide
        imageSrc="/page-icons/book.png"
        accentColor="amber"
        title={t("common.setupGuide.getStarted", { name: "TokimoBook" })}
        description={t("common.setupGuide.bookTagline")}
        features={(
          t("common.setupGuide.bookFeatures", {
            returnObjects: true,
          }) as string[]
        ).map((label, i) => ({
          icon: [Import, FileText, Library][i],
          label,
        }))}
        actionLabel={t("common.setupGuide.bookAction")}
        actionIcon={Plus}
        onAction={() => {
          void openEditorModal();
        }}
      />
    );
  }

  return (
    <div ref={containerRef} className="relative flex h-full">
      <BookSidebar
        libraries={libraries}
        activeId={activeLibraryId}
        onSelect={handleSelectLibrary}
        collapsed={sidebarCollapsed}
        onCreateClick={() => {
          void openEditorModal();
        }}
        onSettingsClick={() => {
          if (activeLibraryId) {
            void openEditorModal({ bookId: activeLibraryId });
          }
        }}
        syncProgress={syncProgress}
        onToggleCollapse={onToggleCollapse}
      />
      <div
        className={`relative min-w-0 flex-1 overflow-auto${isDetailPage ? " px-3 py-3 lg:px-4 lg:py-4" : ""}`}
      >
        {isDetailPage && LazyViewComponent ? (
          <Suspense fallback={LoadingFallback}>
            <LazyViewComponent />
          </Suspense>
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
