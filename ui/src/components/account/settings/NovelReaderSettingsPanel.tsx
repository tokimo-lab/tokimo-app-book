/**
 * NovelReaderSettingsPanel — custom settings component for novel reader preferences.
 *
 * Mirrors settings from the in-reader panel (font size, family, weight, theme)
 * so users can configure defaults from the settings page.
 */

import type { AppSettingsRenderProps } from "../../../lib/settings-defs";

const THEME_SWATCHES = [
  { key: "light", bg: "#fefefe", label: "白色" },
  { key: "dark", bg: "#1a1a2e", label: "暗色" },
  { key: "sepia", bg: "#f4ecd8", label: "护眼" },
] as const;

const FONT_FAMILIES = [
  { key: "serif", label: "衬线体" },
  { key: "sans-serif", label: "无衬线体" },
  { key: "monospace", label: "等宽体" },
] as const;

export default function NovelReaderSettingsPanel({
  values,
  onChange,
}: AppSettingsRenderProps) {
  const fontSize = (values.fontSize as number) ?? 18;
  const fontFamily = (values.fontFamily as string) ?? "serif";
  const fontWeight = (values.fontWeight as string) ?? "normal";
  const theme = (values.theme as string) ?? "light";

  return (
    <div className="space-y-5">
      {/* Font size */}
      <div>
        <div className="mb-1.5 text-sm font-medium text-gray-700 dark:text-zinc-300">
          字体大小
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={14}
            max={24}
            step={2}
            value={fontSize}
            onChange={(e) =>
              onChange({ fontSize: Number.parseInt(e.target.value, 10) })
            }
            className="flex-1"
          />
          <span className="w-12 text-center text-sm tabular-nums text-gray-500">
            {fontSize}px
          </span>
        </div>
      </div>

      {/* Font family */}
      <div>
        <div className="mb-1.5 text-sm font-medium text-gray-700 dark:text-zinc-300">
          字体
        </div>
        <div className="flex gap-2">
          {FONT_FAMILIES.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onChange({ fontFamily: f.key })}
              className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors cursor-pointer ${
                fontFamily === f.key
                  ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] font-medium"
                  : "border-black/[0.1] dark:border-white/[0.12] text-gray-600 dark:text-zinc-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Font weight */}
      <div>
        <div className="mb-1.5 text-sm font-medium text-gray-700 dark:text-zinc-300">
          字重
        </div>
        <div className="flex gap-2">
          {(["normal", "bold"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onChange({ fontWeight: w })}
              className={`flex-1 rounded-lg border px-3 py-1.5 text-sm transition-colors cursor-pointer ${
                fontWeight === w
                  ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] font-medium"
                  : "border-black/[0.1] dark:border-white/[0.12] text-gray-600 dark:text-zinc-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              }`}
              style={{ fontWeight: w }}
            >
              {w === "normal" ? "正常" : "加粗"}
            </button>
          ))}
        </div>
      </div>

      {/* Theme */}
      <div>
        <div className="mb-1.5 text-sm font-medium text-gray-700 dark:text-zinc-300">
          阅读器背景
        </div>
        <div className="flex items-center gap-3">
          {THEME_SWATCHES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange({ theme: t.key })}
              className="flex flex-col items-center gap-1 cursor-pointer"
            >
              <div
                className="h-8 w-8 rounded-full border-2 transition-all"
                style={{
                  backgroundColor: t.bg,
                  borderColor:
                    theme === t.key ? "var(--accent)" : "rgba(0,0,0,0.1)",
                }}
              />
              <span className="text-xs text-gray-500">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
