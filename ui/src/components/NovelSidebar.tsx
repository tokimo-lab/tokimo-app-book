import { AppSidebar } from "@tokiomo/components";
import { Settings } from "lucide-react";
import type { NovelContainerOutput } from "@/generated/rust-types/NovelContainerOutput";
import { AppIcon } from "@/shared/components/icons";
import { useWindowActions } from "@/system";

export default function NovelSidebar({
  libraries,
  activeId,
  onSelect,
  collapsed,
}: {
  libraries: NovelContainerOutput[];
  activeId: string | null;
  onSelect: (id: string) => void;
  collapsed?: boolean;
}) {
  const { openWindow } = useWindowActions();

  const openSettings = () =>
    openWindow({
      type: "system",
      title: "系统设置",
      route: "/novel-settings",
      metadata: { pageId: "system-settings" },
    });

  const sections = [
    {
      items: libraries.map((lib) => ({
        key: lib.id,
        icon: <AppIcon icon={lib.icon} color={lib.color} size={20} />,
        label: lib.name,
        extra:
          lib.itemCount > 0 ? (
            <span className="text-[10px] tabular-nums text-fg-muted">
              {lib.itemCount}
            </span>
          ) : undefined,
      })),
    },
  ];

  return (
    <AppSidebar
      sections={sections}
      activeKey={activeId ?? undefined}
      onSelect={onSelect}
      collapsed={collapsed}
      footer={
        <button
          type="button"
          onClick={openSettings}
          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-fg-muted transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
        >
          <Settings size={14} className="shrink-0 opacity-60" />
          <span>TokimoNovel 设置</span>
        </button>
      }
    />
  );
}
