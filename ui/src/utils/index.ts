/**
 * Utility helpers for the Book sidecar UI.
 * Re-exports what's available from @tokimo/sdk; adds book-specific extras.
 */

// Re-export SDK utilities that the ported components rely on
export { posterThumbUrl, getAvatarIcon, getAvatarColor } from "@tokimo/sdk";

// ── Format helpers ───────────────────────────────────────────────────────────

export function formatWordCount(count: number | null | undefined): string {
  if (count == null) return "";
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万字`;
  return `${count}字`;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e3).toFixed(0)} KB`;
}

export function serialStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  if (status === "completed") return "已完结";
  if (status === "ongoing") return "连载中";
  return status;
}

export function serialStatusColor(
  status: string | null | undefined,
): "success" | "processing" | "default" {
  if (status === "completed") return "success";
  if (status === "ongoing") return "processing";
  return "default";
}

// ── Route parsing ─────────────────────────────────────────────────────────────

export interface BookRouteParams {
  libraryId?: string;
  bookId?: string;
  chapterId?: string;
}

/** Parse the current window route into named params. */
export function parseBookRoute(route: string): BookRouteParams {
  const clean = route.startsWith("/") ? route : `/${route}`;
  const libraryMatch = /^\/library\/([^/]+)/.exec(clean);
  if (libraryMatch) return { libraryId: libraryMatch[1] };
  const bookMatch = /^\/books\/([^/]+)/.exec(clean);
  if (bookMatch) return { bookId: bookMatch[1] };
  const chapterMatch = /^\/chapters\/([^/]+)/.exec(clean);
  if (chapterMatch) return { chapterId: chapterMatch[1] };
  return {};
}

// ── Container width hook ──────────────────────────────────────────────────────

import { useCallback, useLayoutEffect, useState } from "react";

export function useContainerWidth(): [
  ref: (el: HTMLDivElement | null) => void,
  width: number,
] {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  const ref = useCallback((node: HTMLDivElement | null) => {
    setEl(node);
  }, []);

  useLayoutEffect(() => {
    if (!el) {
      setWidth(0);
      return;
    }
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0]?.contentRect.width ?? 0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);

  return [ref, width];
}

// ── Sidebar collapsed state ───────────────────────────────────────────────────

export function useSidebarCollapsed(_key: string, autoCollapsed: boolean) {
  const [manualCollapsed, setManualCollapsed] = useState<boolean | null>(null);
  const collapsed = manualCollapsed !== null ? manualCollapsed : autoCollapsed;

  const onToggleCollapse = useCallback(() => {
    setManualCollapsed((prev) => {
      if (prev !== null) return !prev;
      return !autoCollapsed;
    });
  }, [autoCollapsed]);

  return { collapsed, onToggleCollapse };
}
