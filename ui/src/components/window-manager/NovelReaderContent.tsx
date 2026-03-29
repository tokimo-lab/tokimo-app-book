/**
 * NovelReaderContent — novel chapter reader inside a floating window.
 *
 * Displays chapter text with customizable typography (font size, family,
 * weight, background theme). Supports prev/next chapter navigation and
 * a reading progress bar. Settings are persisted in localStorage.
 */

import { Spin } from "@tokiomo/components";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Minus,
  Moon,
  Plus,
  Settings,
  Sun,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/generated/rust-api";
import { useWindowActive, type WindowState } from "@/system";

// ── Theme definitions ─────────────────────────────────────────────────────────

const THEME_MAP = {
  light: {
    bg: "#fefefe",
    text: "#333333",
    secondaryBg: "#f5f5f5",
    accent: "#e5e5e5",
  },
  dark: {
    bg: "#1a1a2e",
    text: "#d4d4d8",
    secondaryBg: "#16213e",
    accent: "#2a2a4e",
  },
  sepia: {
    bg: "#f4ecd8",
    text: "#5b4636",
    secondaryBg: "#e8dcc8",
    accent: "#d4c4a8",
  },
} as const;

type ReaderTheme = keyof typeof THEME_MAP;

const FONT_SIZE_MIN = 14;
const FONT_SIZE_MAX = 24;
const FONT_SIZE_STEP = 2;

const FONT_FAMILIES = {
  serif:
    '"Noto Serif SC", "Source Han Serif SC", "Source Han Serif", "SimSun", "STSong", serif',
  "sans-serif":
    '"Noto Sans SC", "Source Han Sans SC", -apple-system, BlinkMacSystemFont, sans-serif',
  monospace: '"JetBrains Mono", "Fira Code", "Source Code Pro", monospace',
} as const;

type FontFamilyKey = keyof typeof FONT_FAMILIES;

const FONT_FAMILY_LABELS: Record<FontFamilyKey, string> = {
  serif: "衬线体",
  "sans-serif": "无衬线体",
  monospace: "等宽体",
};

const STORAGE_KEY = "novel-reader-settings";

interface ReaderSettings {
  fontSize: number;
  fontFamily: FontFamilyKey;
  fontWeight: "normal" | "bold";
  theme: ReaderTheme;
}

function defaultSettings(): ReaderSettings {
  return {
    fontSize: 18,
    fontFamily: "serif",
    fontWeight: "normal",
    theme: "light",
  };
}

function loadSettings(): ReaderSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultSettings(), ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return defaultSettings();
}

function saveSettings(s: ReaderSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

// ── Reading Progress Bar ──────────────────────────────────────────────────────

function ReadingProgressBar({
  color,
  containerRef,
}: {
  color: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => {
      const scrollTop = el.scrollTop;
      const scrollHeight = el.scrollHeight - el.clientHeight;
      if (scrollHeight <= 0) {
        setProgress(100);
        return;
      }
      setProgress(Math.min(100, (scrollTop / scrollHeight) * 100));
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, [containerRef]);

  return (
    <div className="absolute top-0 right-0 left-0 z-10 h-[3px]">
      <div
        className="h-full transition-[width] duration-150"
        style={{ width: `${progress}%`, backgroundColor: color }}
      />
    </div>
  );
}

// ── Settings Panel ────────────────────────────────────────────────────────────

function SettingsPanel({
  settings,
  onUpdate,
  themeColors,
}: {
  settings: ReaderSettings;
  onUpdate: (patch: Partial<ReaderSettings>) => void;
  themeColors: (typeof THEME_MAP)[ReaderTheme];
}) {
  return (
    <div
      className="absolute right-4 bottom-16 z-20 w-56 rounded-xl p-4 shadow-xl backdrop-blur-md"
      style={{
        backgroundColor: `${themeColors.secondaryBg}f0`,
        color: themeColors.text,
      }}
    >
      {/* Font size */}
      <div className="mb-3">
        <p className="mb-1.5 text-xs opacity-60">字体大小</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:opacity-70 disabled:opacity-30"
            style={{ backgroundColor: themeColors.accent }}
            disabled={settings.fontSize <= FONT_SIZE_MIN}
            onClick={() =>
              onUpdate({
                fontSize: Math.max(
                  FONT_SIZE_MIN,
                  settings.fontSize - FONT_SIZE_STEP,
                ),
              })
            }
          >
            <Minus size={14} />
          </button>
          <span className="flex-1 text-center text-sm">
            {settings.fontSize}px
          </span>
          <button
            type="button"
            className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:opacity-70 disabled:opacity-30"
            style={{ backgroundColor: themeColors.accent }}
            disabled={settings.fontSize >= FONT_SIZE_MAX}
            onClick={() =>
              onUpdate({
                fontSize: Math.min(
                  FONT_SIZE_MAX,
                  settings.fontSize + FONT_SIZE_STEP,
                ),
              })
            }
          >
            <Plus size={14} />
          </button>
        </div>
      </div>

      {/* Font family */}
      <div className="mb-3">
        <p className="mb-1.5 text-xs opacity-60">字体</p>
        <div className="flex gap-1">
          {(Object.keys(FONT_FAMILIES) as FontFamilyKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className="flex-1 rounded-md px-1.5 py-1 text-xs transition-colors"
              style={{
                backgroundColor:
                  settings.fontFamily === key
                    ? themeColors.accent
                    : "transparent",
                opacity: settings.fontFamily === key ? 1 : 0.6,
              }}
              onClick={() => onUpdate({ fontFamily: key })}
            >
              {FONT_FAMILY_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {/* Font weight */}
      <div className="mb-3">
        <p className="mb-1.5 text-xs opacity-60">字重</p>
        <div className="flex gap-1">
          {(["normal", "bold"] as const).map((w) => (
            <button
              key={w}
              type="button"
              className="flex-1 rounded-md px-2 py-1 text-xs transition-colors"
              style={{
                backgroundColor:
                  settings.fontWeight === w
                    ? themeColors.accent
                    : "transparent",
                opacity: settings.fontWeight === w ? 1 : 0.6,
                fontWeight: w,
              }}
              onClick={() => onUpdate({ fontWeight: w })}
            >
              {w === "normal" ? "正常" : "加粗"}
            </button>
          ))}
        </div>
      </div>

      {/* Background theme */}
      <div>
        <p className="mb-1.5 text-xs opacity-60">背景</p>
        <div className="flex items-center gap-2">
          {(["light", "dark", "sepia"] as ReaderTheme[]).map((t) => (
            <button
              key={t}
              type="button"
              className="h-7 w-7 rounded-full border-2 transition-all"
              style={{
                backgroundColor: THEME_MAP[t].bg,
                borderColor:
                  settings.theme === t ? themeColors.text : "transparent",
              }}
              onClick={() => onUpdate({ theme: t })}
              title={t === "light" ? "白色" : t === "dark" ? "暗色" : "护眼"}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface NovelReaderContentProps {
  win: WindowState;
}

export function NovelReaderContent({ win }: NovelReaderContentProps) {
  const [currentChapterId, setCurrentChapterId] = useState(
    win.metadata.chapterId,
  );
  const [settings, setSettings] = useState<ReaderSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const novelId = win.metadata.novelId;
  const themeColors = THEME_MAP[settings.theme];

  const updateSettings = useCallback((patch: Partial<ReaderSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  // Fetch chapter content
  const contentQuery = api.novel.getChapterContent.useQuery(
    { novelId: novelId!, chapterId: currentChapterId! },
    { enabled: !!novelId && !!currentChapterId },
  );

  const chapter = contentQuery.data;

  // Split content into paragraphs
  const paragraphs = useMemo(() => {
    if (!chapter?.content) return [];
    return chapter.content
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((text, i) => ({
        id: `${currentChapterId}-${i}-${text.slice(0, 8)}`,
        text,
      }));
  }, [chapter?.content, currentChapterId]);

  // Scroll to top when chapter changes
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-run on chapter change
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentChapterId]);

  // Chapter navigation
  const handlePrev = useCallback(() => {
    if (chapter?.prevChapterId) setCurrentChapterId(chapter.prevChapterId);
  }, [chapter?.prevChapterId]);

  const handleNext = useCallback(() => {
    if (chapter?.nextChapterId) setCurrentChapterId(chapter.nextChapterId);
  }, [chapter?.nextChapterId]);

  // Keyboard navigation (only when this window is active)
  const windowActive = useWindowActive();
  useEffect(() => {
    if (!windowActive) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") handlePrev();
      if (e.key === "ArrowRight") handleNext();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [handlePrev, handleNext, windowActive]);

  // Loading
  if (contentQuery.isLoading) {
    return (
      <div
        className="flex h-full items-center justify-center"
        style={{ backgroundColor: themeColors.bg }}
      >
        <Spin />
      </div>
    );
  }

  if (!chapter) {
    return (
      <div
        className="flex h-full flex-col items-center justify-center gap-3"
        style={{ backgroundColor: themeColors.bg, color: themeColors.text }}
      >
        <p className="text-sm">章节内容不可用</p>
      </div>
    );
  }

  const ThemeIcon =
    settings.theme === "dark"
      ? Moon
      : settings.theme === "sepia"
        ? BookOpen
        : Sun;

  return (
    <div
      className="relative flex h-full flex-col transition-colors duration-300"
      style={{ backgroundColor: themeColors.bg, color: themeColors.text }}
    >
      <ReadingProgressBar
        color={settings.theme === "dark" ? "#6366f1" : "#3b82f6"}
        containerRef={scrollRef}
      />

      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between px-4 py-2 text-xs opacity-70"
        style={{ backgroundColor: themeColors.secondaryBg }}
      >
        <span className="truncate">{chapter.novelTitle}</span>
        <span className="ml-2 truncate">
          {chapter.volumeTitle ? `${chapter.volumeTitle} · ` : ""}
          {chapter.title ?? `第${chapter.chapterNumber}章`}
        </span>
      </div>

      {/* Scrollable content */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[700px] px-6 py-8 md:px-8">
          {/* Chapter title */}
          <h1
            className="mb-8 text-center font-bold leading-tight"
            style={{
              fontSize: settings.fontSize + 4,
              fontFamily: FONT_FAMILIES[settings.fontFamily],
            }}
          >
            {chapter.title ?? `第${chapter.chapterNumber}章`}
          </h1>

          {/* Paragraphs */}
          <article
            style={{
              fontSize: `${settings.fontSize}px`,
              fontFamily: FONT_FAMILIES[settings.fontFamily],
              fontWeight: settings.fontWeight,
              lineHeight: 1.9,
              letterSpacing: "0.04em",
            }}
          >
            {paragraphs.map((para) => (
              <p key={para.id} className="mb-4" style={{ textIndent: "2em" }}>
                {para.text}
              </p>
            ))}
          </article>

          {/* Bottom chapter navigation */}
          <div
            className="mt-12 flex items-center justify-between rounded-lg px-4 py-4"
            style={{ backgroundColor: themeColors.secondaryBg }}
          >
            <button
              type="button"
              className="flex items-center gap-1 text-sm disabled:opacity-30"
              disabled={!chapter.prevChapterId}
              onClick={handlePrev}
              style={{ color: themeColors.text }}
            >
              <ChevronLeft size={16} />
              上一章
            </button>
            <span className="text-xs opacity-50">
              第{chapter.chapterNumber}章
            </span>
            <button
              type="button"
              className="flex items-center gap-1 text-sm disabled:opacity-30"
              disabled={!chapter.nextChapterId}
              onClick={handleNext}
              style={{ color: themeColors.text }}
            >
              下一章
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Floating controls bar */}
      <div className="pointer-events-none absolute right-0 bottom-3 left-0 z-10 flex justify-center">
        <div
          className="pointer-events-auto flex items-center gap-1 rounded-full px-3 py-2 shadow-lg backdrop-blur-md"
          style={{ backgroundColor: `${themeColors.secondaryBg}ee` }}
        >
          {/* Previous chapter */}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:opacity-70 disabled:opacity-30"
            disabled={!chapter.prevChapterId}
            onClick={handlePrev}
            title="上一章"
          >
            <ChevronLeft size={18} />
          </button>

          <div
            className="mx-1 h-5 w-px opacity-20"
            style={{ backgroundColor: themeColors.text }}
          />

          {/* Font size decrease */}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:opacity-70 disabled:opacity-30"
            disabled={settings.fontSize <= FONT_SIZE_MIN}
            onClick={() =>
              updateSettings({
                fontSize: Math.max(
                  FONT_SIZE_MIN,
                  settings.fontSize - FONT_SIZE_STEP,
                ),
              })
            }
            title="缩小字体"
          >
            <Minus size={16} />
          </button>

          <span className="w-8 text-center text-xs opacity-60">
            {settings.fontSize}
          </span>

          {/* Font size increase */}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:opacity-70 disabled:opacity-30"
            disabled={settings.fontSize >= FONT_SIZE_MAX}
            onClick={() =>
              updateSettings({
                fontSize: Math.min(
                  FONT_SIZE_MAX,
                  settings.fontSize + FONT_SIZE_STEP,
                ),
              })
            }
            title="放大字体"
          >
            <Plus size={16} />
          </button>

          <div
            className="mx-1 h-5 w-px opacity-20"
            style={{ backgroundColor: themeColors.text }}
          />

          {/* Theme toggle */}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:opacity-70"
            onClick={() => {
              const cycle: ReaderTheme[] = ["light", "dark", "sepia"];
              const idx = cycle.indexOf(settings.theme);
              updateSettings({ theme: cycle[(idx + 1) % cycle.length] });
            }}
            title={`主题: ${settings.theme}`}
          >
            <ThemeIcon size={16} />
          </button>

          <div
            className="mx-1 h-5 w-px opacity-20"
            style={{ backgroundColor: themeColors.text }}
          />

          {/* Settings toggle */}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:opacity-70"
            onClick={() => setShowSettings((v) => !v)}
            title="设置"
          >
            <Settings size={16} />
          </button>

          <div
            className="mx-1 h-5 w-px opacity-20"
            style={{ backgroundColor: themeColors.text }}
          />

          {/* Next chapter */}
          <button
            type="button"
            className="flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:opacity-70 disabled:opacity-30"
            disabled={!chapter.nextChapterId}
            onClick={handleNext}
            title="下一章"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onUpdate={updateSettings}
          themeColors={themeColors}
        />
      )}
    </div>
  );
}

export default NovelReaderContent;
