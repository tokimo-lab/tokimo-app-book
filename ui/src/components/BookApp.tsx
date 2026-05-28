import { AppSetupGuide, Spin } from "@tokimo/ui";
import { FileText, Import, Library, Plus } from "lucide-react";
import { useCallback, useEffect } from "react";
import { bookApi } from "../api";
import { useLibraryItemProgress } from "../hooks/useLibraryItemProgress";
import BookDetailPage from "../pages/BookDetailPage";
import BookAppPage from "../pages/BookAppPage";
import BookSidebar from "./BookSidebar";
import { useContainerWidth, useSidebarCollapsed, parseBookRoute } from "../utils";
import { useWindowNav, useToast } from "@tokimo/sdk";

export default function BookApp() {
  const { route, replace } = useWindowNav();
  const toast = useToast();

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

  const handleAddLibrary = useCallback(() => {
    toast.info("请通过 Tokimo 系统设置添加书库");
  }, [toast]);

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
        imageSrc="/icon.png"
        accentColor="amber"
        title="开始使用 TokimoBook"
        description="管理你的数字书库，下载小说，追踪阅读进度"
        features={[
          { icon: Import, label: "从多个源下载小说" },
          { icon: FileText, label: "跨设备同步阅读进度" },
          { icon: Library, label: "统一管理书库" },
        ]}
        actionLabel="添加书库"
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
        onSettingsClick={handleAddLibrary}
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
