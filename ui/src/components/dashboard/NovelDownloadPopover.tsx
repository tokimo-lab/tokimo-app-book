/**
 * Safari 风格小说下载进度浮窗
 * 右上角按钮带角标，点击展开下载列表面板
 */

import {
  autoUpdate,
  FloatingPortal,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { Button } from "@tokiomo/components";
import { Download } from "lucide-react";
import { useState } from "react";
import { useNovelDownload } from "../../hooks";
import NovelDownloadPanel from "./NovelDownloadPanel";

export default function NovelDownloadPopover() {
  const [open, setOpen] = useState(false);
  const { activeCount, tasks } = useNovelDownload();

  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: "bottom-end",
    middleware: [offset(8), flip(), shift({ padding: 12 })],
    whileElementsMounted: autoUpdate,
  });

  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context);
  const { getReferenceProps, getFloatingProps } = useInteractions([
    click,
    dismiss,
    role,
  ]);

  return (
    <>
      <Button
        ref={refs.setReference}
        icon={<Download size={16} />}
        {...getReferenceProps()}
      >
        下载
        {activeCount > 0 && (
          <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-bold text-white">
            {activeCount > 99 ? "99+" : activeCount}
          </span>
        )}
      </Button>

      {open && tasks.length > 0 && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={{
              ...floatingStyles,
              background: "color-mix(in srgb, var(--bg-glass) 85%, black 15%)",
              backdropFilter:
                "blur(var(--glass-blur)) saturate(var(--glass-saturate))",
              WebkitBackdropFilter:
                "blur(var(--glass-blur)) saturate(var(--glass-saturate))",
            }}
            className="z-[9999] w-[440px] max-h-[70vh] rounded-xl border border-black/[0.06] dark:border-white/[0.08] shadow-2xl overflow-hidden"
            {...getFloatingProps()}
          >
            <div className="h-full flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--glass-border)]">
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  小说下载
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {tasks.length} 项
                </span>
              </div>

              {/* Download list */}
              <div className="flex-1 overflow-y-auto">
                <NovelDownloadPanel />
              </div>
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}
