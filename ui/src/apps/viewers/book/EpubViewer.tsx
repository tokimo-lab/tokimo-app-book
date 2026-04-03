/**
 * EpubViewer — Window content adapter for EPUB / MOBI / AZW3 files.
 * Custom parsers using JSZip (EPUB) and raw binary (MOBI/AZW3) — no third-party ebook library.
 */

import {
  ChevronLeft,
  ChevronRight,
  List,
  Minus,
  Palette,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildFileUrl } from "@/apps/finder/components/types";
import type { EpubBook, EpubTocItem } from "@/lib/epub-parser";
import { useWindowActive, type WindowState } from "@/system";
import { buildSshFileUrl } from "../file-url";

/* ── Reader theme presets ─────────────────────────── */

interface ReaderTheme {
  label: string;
  bg: string;
  text: string;
  /** Small swatch color for the picker button */
  swatch: string;
}

const READER_THEMES: ReaderTheme[] = [
  { label: "Light", bg: "#ffffff", text: "#1a1a1a", swatch: "#ffffff" },
  { label: "Warm", bg: "#f8f1e3", text: "#3b2e1a", swatch: "#f8f1e3" },
  { label: "Green", bg: "#e0eee0", text: "#2a3a2a", swatch: "#e0eee0" },
  { label: "Dark", bg: "#1a1a1a", text: "#d4d4d4", swatch: "#1a1a1a" },
];

const SCROLLBAR_CSS = `
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-button,
  ::-webkit-scrollbar-button:hover,
  ::-webkit-scrollbar-button:active {
    width: 0;
    height: 0;
    background: transparent;
    background-image: none;
    border: none;
    box-shadow: none;
  }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-track-piece { background: transparent; background-image: none; }
  ::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.24); border-radius: 999px; }
  ::-webkit-scrollbar-thumb:hover { background: rgba(128,128,128,0.16); }
  ::-webkit-scrollbar-corner { background: transparent; }
  * { scrollbar-width: thin; scrollbar-color: rgba(128,128,128,0.24) transparent; }
`;

/** Build CSS for the shadow-DOM reader. */
function buildReaderCSS(fontSizePct: number, theme: ReaderTheme): string {
  return `
    :host {
      display: block;
      overflow: auto;
      height: 100%;
      background: ${theme.bg};
    }
    .reader-body {
      margin: 0;
      padding: 16px 24px;
      font-family: "Noto Serif", "Source Han Serif", Georgia, serif;
      font-size: ${fontSizePct}%;
      line-height: 1.8;
      color: ${theme.text};
      word-wrap: break-word;
      overflow-wrap: break-word;
    }
    .reader-body img, .reader-body svg { max-width: 100%; height: auto; }
    .reader-body a { color: #2563eb; }
    .reader-body pre, .reader-body code { white-space: pre-wrap; word-break: break-all; }
    .reader-body table { border-collapse: collapse; max-width: 100%; }
    .reader-body td, .reader-body th { border: 1px solid #ddd; padding: 4px 8px; }
    ${SCROLLBAR_CSS}
  `;
}

/** Collect TOC entries (href + fragment) that belong to a given spine chapter. */
function collectTocFragments(
  items: EpubTocItem[],
  chapterHref: string,
): { href: string; fragment: string }[] {
  const result: { href: string; fragment: string }[] = [];
  for (const item of items) {
    const hashIdx = item.href.indexOf("#");
    const base = hashIdx >= 0 ? item.href.substring(0, hashIdx) : item.href;
    const fragment = hashIdx >= 0 ? item.href.substring(hashIdx + 1) : "";
    if (base === chapterHref) {
      result.push({ href: item.href, fragment });
    }
    result.push(...collectTocFragments(item.children, chapterHref));
  }
  return result;
}

/** Set up scroll-based TOC tracking on the shadow-DOM host. */
function startScrollTracking(
  tocItems: EpubTocItem[],
  spineHref: string,
  host: HTMLDivElement,
  shadow: ShadowRoot,
  onActiveChange: (href: string) => void,
  cleanupRef: React.MutableRefObject<(() => void) | null>,
): void {
  cleanupRef.current?.();
  cleanupRef.current = null;

  const entries = collectTocFragments(tocItems, spineHref);

  if (entries.length === 0) {
    onActiveChange(spineHref);
    return;
  }

  const updateActive = () => {
    let current = entries[0]?.href ?? spineHref;
    for (const entry of entries) {
      if (!entry.fragment) continue;
      const el = shadow.querySelector<HTMLElement>(
        `[id="${CSS.escape(entry.fragment)}"]`,
      );
      if (el && el.getBoundingClientRect().top <= 30) {
        current = entry.href;
      }
    }
    onActiveChange(current);
  };

  updateActive();
  host.addEventListener("scroll", updateActive, { passive: true });
  cleanupRef.current = () => host.removeEventListener("scroll", updateActive);
}

export default function EpubViewer({ win }: { win: WindowState }) {
  const filePath = win.metadata.filePath ?? "";
  const fileSystemId = win.metadata.fileSystemId ?? "";
  const epubSrc =
    buildFileUrl(filePath, fileSystemId) ??
    buildSshFileUrl(win.metadata.sshTerminalId, filePath);

  const hostRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot | null>(null);
  const styleRef = useRef<HTMLStyleElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const bookRef = useRef<EpubBook | null>(null);
  const scrollCleanupRef = useRef<(() => void) | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toc, setToc] = useState<EpubTocItem[]>([]);
  const [showToc, setShowToc] = useState(true);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [totalChapters, setTotalChapters] = useState(0);
  const [fontSize, setFontSize] = useState(100);
  const [theme, setTheme] = useState<ReaderTheme>(READER_THEMES[0]);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const [activeHref, setActiveHref] = useState("");

  /* Keep refs in sync for use in effects that must not re-trigger on change */
  const fontSizeRef = useRef(fontSize);
  const themeRef = useRef(theme);
  fontSizeRef.current = fontSize;
  themeRef.current = theme;

  /* ── Shadow root init ──────────────────────────────── */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const shadow = host.shadowRoot ?? host.attachShadow({ mode: "open" });
    shadowRef.current = shadow;

    const styleEl = document.createElement("style");
    styleEl.textContent = buildReaderCSS(fontSizeRef.current, themeRef.current);
    shadow.appendChild(styleEl);
    styleRef.current = styleEl;

    const bodyEl = document.createElement("div");
    bodyEl.className = "reader-body";
    shadow.appendChild(bodyEl);
    contentRef.current = bodyEl;
  }, []);

  /* ── Load ebook ─────────────────────────────────── */

  const isMobi = /\.(mobi|azw3|azw|prc)$/i.test(filePath);

  useEffect(() => {
    if (!epubSrc) return;
    let destroyed = false;

    (async () => {
      try {
        const res = await fetch(epubSrc);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = await res.arrayBuffer();
        if (destroyed) return;

        let book: EpubBook;
        if (isMobi) {
          const { parseMobi } = await import("@/lib/mobi-parser");
          book = await parseMobi(buf);
        } else {
          const { parseEpub } = await import("@/lib/epub-parser");
          book = await parseEpub(buf);
        }
        if (destroyed) {
          book.destroy();
          return;
        }

        bookRef.current = book;
        setToc(book.toc);
        setTotalChapters(book.spine.length);
        setChapterIndex(0);

        const content = contentRef.current;
        if (content) {
          const html = await book.getChapterHtml(0);
          content.innerHTML = html;
        }

        const host = hostRef.current;
        const shadow = shadowRef.current;
        if (host && shadow) {
          host.scrollTo(0, 0);
          startScrollTracking(
            book.toc,
            book.spine[0]?.href ?? "",
            host,
            shadow,
            setActiveHref,
            scrollCleanupRef,
          );
        }
        if (!destroyed) setLoading(false);
      } catch (err) {
        if (!destroyed) {
          setError(err instanceof Error ? err.message : "Failed to load ebook");
          setLoading(false);
        }
      }
    })();

    return () => {
      destroyed = true;
      scrollCleanupRef.current?.();
      if (bookRef.current) {
        bookRef.current.destroy();
        bookRef.current = null;
      }
    };
  }, [epubSrc, isMobi]);

  /* ── Update styles on theme / font change ────────── */

  useEffect(() => {
    if (styleRef.current) {
      styleRef.current.textContent = buildReaderCSS(fontSize, theme);
    }
  }, [fontSize, theme]);

  /* ── Navigation ─────────────────────────────────── */

  const goTo = useCallback(
    async (index: number, fragment?: string) => {
      const book = bookRef.current;
      const host = hostRef.current;
      const shadow = shadowRef.current;
      const content = contentRef.current;
      if (!book || !host || !shadow || !content) return;
      if (index < 0 || index >= book.spine.length) return;
      setChapterIndex(index);

      const html = await book.getChapterHtml(index);
      content.innerHTML = html;

      if (fragment) {
        const el = shadow.querySelector<HTMLElement>(
          `[id="${CSS.escape(fragment)}"]`,
        );
        if (el) el.scrollIntoView();
        else host.scrollTo(0, 0);
      } else {
        host.scrollTo(0, 0);
      }
      startScrollTracking(
        toc,
        book.spine[index]?.href ?? "",
        host,
        shadow,
        setActiveHref,
        scrollCleanupRef,
      );
    },
    [toc],
  );

  const goPrev = useCallback(
    () => goTo(chapterIndex - 1),
    [goTo, chapterIndex],
  );
  const goNext = useCallback(
    () => goTo(chapterIndex + 1),
    [goTo, chapterIndex],
  );

  const goToHref = useCallback(
    (href: string) => {
      const book = bookRef.current;
      if (!book) return;
      const hashIdx = href.indexOf("#");
      const base = hashIdx >= 0 ? href.substring(0, hashIdx) : href;
      const fragment = hashIdx >= 0 ? href.substring(hashIdx + 1) : undefined;
      const idx = book.spine.findIndex(
        (s) =>
          s.href === base ||
          s.href.endsWith(`/${base}`) ||
          base.endsWith(s.href),
      );
      if (idx >= 0) goTo(idx, fragment);
    },
    [goTo],
  );

  /* ── Keyboard navigation (only when this window is active) ── */

  const windowActive = useWindowActive();

  useEffect(() => {
    if (!windowActive) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [goPrev, goNext, windowActive]);

  /* ── Font size ──────────────────────────────────── */

  const changeFontSize = useCallback((next: number) => {
    setFontSize(next);
  }, []);

  const increaseFontSize = useCallback(
    () => changeFontSize(Math.min(fontSize + 10, 200)),
    [changeFontSize, fontSize],
  );
  const decreaseFontSize = useCallback(
    () => changeFontSize(Math.max(fontSize - 10, 60)),
    [changeFontSize, fontSize],
  );
  const resetFontSize = useCallback(
    () => changeFontSize(100),
    [changeFontSize],
  );

  if (!epubSrc) return null;

  /* ── Render ─────────────────────────────────────── */

  return (
    <div className="flex h-full flex-col">
      {/* ── Toolbar ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border-base)] bg-[var(--bg-glass)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
        {toc.length > 0 && (
          <button
            type="button"
            onClick={() => setShowToc((v) => !v)}
            className={`rounded p-1 hover:bg-[var(--bg-glass-hover)] ${
              showToc
                ? "bg-[var(--bg-glass-hover)] text-[var(--text-primary)]"
                : ""
            }`}
            title="Table of contents"
          >
            <List size={14} />
          </button>
        )}

        <button
          type="button"
          onClick={goPrev}
          disabled={chapterIndex <= 0}
          className="rounded p-1 hover:bg-[var(--bg-glass-hover)] disabled:opacity-30"
          title="Previous chapter"
        >
          <ChevronLeft size={14} />
        </button>

        <span className="tabular-nums">
          {totalChapters > 0 ? `${chapterIndex + 1} / ${totalChapters}` : ""}
        </span>

        <button
          type="button"
          onClick={goNext}
          disabled={chapterIndex >= totalChapters - 1}
          className="rounded p-1 hover:bg-[var(--bg-glass-hover)] disabled:opacity-30"
          title="Next chapter"
        >
          <ChevronRight size={14} />
        </button>

        <div className="flex-1" />

        {/* Theme picker */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowThemePicker((v) => !v)}
            className={`rounded p-1 hover:bg-[var(--bg-glass-hover)] ${
              showThemePicker
                ? "bg-[var(--bg-glass-hover)] text-[var(--text-primary)]"
                : ""
            }`}
            title="Reader theme"
          >
            <Palette size={14} />
          </button>
          {showThemePicker && (
            <div className="absolute right-0 top-full z-20 mt-1 flex gap-1.5 rounded-lg border border-[var(--border-base)] bg-[var(--bg-elevated)] p-2 shadow-lg">
              {READER_THEMES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => {
                    setTheme(t);
                    setShowThemePicker(false);
                  }}
                  className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                    theme.label === t.label
                      ? "border-[var(--accent)] scale-110"
                      : "border-[var(--border-base)]"
                  }`}
                  style={{ background: t.swatch }}
                  title={t.label}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mx-1 h-3 w-px bg-[var(--border-base)]" />

        <button
          type="button"
          onClick={decreaseFontSize}
          className="rounded p-1 hover:bg-[var(--bg-glass-hover)]"
          title="Decrease font size"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          onClick={resetFontSize}
          className="rounded px-1.5 py-0.5 tabular-nums hover:bg-[var(--bg-glass-hover)]"
        >
          {fontSize}%
        </button>
        <button
          type="button"
          onClick={increaseFontSize}
          className="rounded p-1 hover:bg-[var(--bg-glass-hover)]"
          title="Increase font size"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* ── Content ── */}
      {error ? (
        <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-muted)]">
          {error}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* TOC sidebar */}
          {showToc && (
            <div className="w-56 shrink-0 overflow-auto border-r border-[var(--border-base)] bg-[var(--sidebar-bg)] p-2 text-xs">
              <TocTree
                items={toc}
                activeHref={activeHref}
                onSelect={goToHref}
              />
            </div>
          )}

          {/* Reader area */}
          <div className="relative flex-1 overflow-hidden">
            {loading && (
              <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-[var(--text-muted)]">
                Loading…
              </div>
            )}
            <div ref={hostRef} className="h-full w-full" />
          </div>
        </div>
      )}
    </div>
  );
}

/* ── TOC Tree ─────────────────────────────────────── */

function TocTree({
  items,
  activeHref,
  onSelect,
}: {
  items: EpubTocItem[];
  activeHref?: string;
  onSelect: (href: string) => void;
}) {
  return (
    <ul className="m-0 list-none space-y-0.5 pl-0">
      {items.map((item) => {
        const isActive = activeHref === item.href;
        return (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => onSelect(item.href)}
              className={`w-full cursor-pointer truncate rounded px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--accent-subtle)] hover:text-[var(--text-primary)] ${
                isActive
                  ? "bg-[var(--accent-subtle)] text-[var(--accent)]"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {item.label}
            </button>
            {item.children.length > 0 && (
              <div className="pl-3">
                <TocTree
                  items={item.children}
                  activeHref={activeHref}
                  onSelect={onSelect}
                />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
