import { useQueryClient } from "@tanstack/react-query";
import {
  useRuntimeCtx,
  useWindowActions,
  useWindowId,
  useWindowNav,
} from "@tokimo/sdk";
import { AppSetupGuide, Spin } from "@tokimo/ui";
import { FileText, Import, Library, Plus } from "lucide-react";
import { useCallback, useEffect } from "react";
import { bookApi } from "../api";
import { useLibraryItemProgress } from "../hooks/useLibraryItemProgress";
import { useBookI18n } from "../i18n";
import { registerBridge } from "../modal-bridge";
import BookAppPage from "../pages/BookAppPage";
import BookDetailPage from "../pages/BookDetailPage";
import {
  parseBookRoute,
  useContainerWidth,
  useSidebarCollapsed,
} from "../utils";
import BookSidebar from "./BookSidebar";

export default function BookApp() {
  const { route, replace } = useWindowNav();
  const _windowId = useWindowId();
  const { openModalWindow } = useWindowActions();
  const ctx = useRuntimeCtx();
  const { t } = useBookI18n();
  const qc = useQueryClient();

  const { libraryId: activeLibraryId, bookId } = parseBookRoute(route);
  const isDetailPage = !!bookId;

  const [containerRef, containerWidth] = useContainerWidth();
  const { collapsed: sidebarCollapsed, onToggleCollapse } = useSidebarCollapsed(
    "book",
    containerWidth > 0 && containerWidth < 720,
  );

  const { data: libraries, isLoading } = bookApi.list.useQuery();

  useEffect(() => {
    if (!libraries?.length) return;
    if (activeLibraryId) {
      const valid = libraries.some((l) => l.id === activeLibraryId);
      if (!valid) replace(`/library/${libraries[0].id}`);
      return;
    }
    replace(`/library/${libraries[0].id}`);
  }, [libraries, activeLibraryId, replace]);

  const activeLibrary = libraries?.find((l) => l.id === activeLibraryId);

  const openEditorModal = useCallback(
    (opts: { bookId?: string } = {}) => {
      const bridgeId = registerBridge({
        kind: "library-editor",
        ctx,
        bookId: opts.bookId,
        onSaved: () => {
          bookApi.list.invalidate(qc);
        },
        onDeleted: () => {
          bookApi.list.invalidate(qc);
          if (activeLibraryId && libraries && libraries.length > 1) {
            const remaining = libraries.filter((l) => l.id !== activeLibraryId);
            if (remaining.length > 0) {
              replace(`/library/${remaining[0].id}`);
            }
          }
        },
      });
      const metadata: Record<string, unknown> = { bridgeId };
      if (opts.bookId) metadata.bookId = opts.bookId;

      openModalWindow({
        component: () => import("./BookLibraryEditorWindow"),
        title: opts.bookId ? t("modalSettingsTitle") : t("modalCreateTitle"),
        width: 720,
        height: 640,
        metadata,
      });
    },
    [ctx, openModalWindow, activeLibraryId, libraries, replace, qc, t],
  );

  const handleAddLibrary = useCallback(() => {
    openEditorModal();
  }, [openEditorModal]);

  const syncProgress = useLibraryItemProgress(libraries);

  const handleSelectLibrary = (id: string) => {
    replace(`/library/${id}`);
  };

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
        imageSrc="/api/apps/book/assets/icon.png"
        accentColor="amber"
        title={t("setupTitle")}
        description={t("setupDescription")}
        features={[
          { icon: Import, label: t("setupFeatureDownload") },
          { icon: FileText, label: t("setupFeatureProgress") },
          { icon: Library, label: t("setupFeatureLibrary") },
        ]}
        actionLabel={t("setupAction")}
        actionIcon={Plus}
        onAction={handleAddLibrary}
      />
    );
  }

  return (
    <div ref={containerRef} className="relative flex h-full">
      <BookSidebar
        libraries={libraries}
        activeId={activeLibraryId ?? null}
        onSelect={handleSelectLibrary}
        collapsed={sidebarCollapsed}
        onCreateClick={handleAddLibrary}
        onSettingsClick={() =>
          activeLibraryId && openEditorModal({ bookId: activeLibraryId })
        }
        syncProgress={syncProgress}
        onToggleCollapse={onToggleCollapse}
      />
      <div
        className={`relative min-w-0 flex-1 overflow-auto${isDetailPage ? " px-3 py-3 lg:px-4 lg:py-4" : ""}`}
      >
        {isDetailPage ? (
          <BookDetailPage />
        ) : (
          activeLibraryId &&
          activeLibrary && (
            <BookAppPage
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
