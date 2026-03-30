/**
 * NovelReaderSettingsPanel — custom settings component for novel reader preferences.
 *
 * Mirrors settings from the in-reader panel (font size, family, weight, theme)
 * so users can configure defaults from the settings page.
 */

import type { AppSettingsRenderProps } from "@/lib/settings-defs";

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
    <div className="divide-y divide-black/[0.04] dark:divide-white/[0.06]">
      {/* Font size */}
      <div className="flex items-start justify-between gap-6 px-4 py-3.5">
        <div className="min-w-0 pt-0.5">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-tight">
            字体大小
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2.5">
          <input
            type="range"
            min={14}
            max={24}
            step={2}
            value={fontSize}
            onChange={(e) =>
              onChange({ fontSize: Number.parseInt(e.target.value, 10) })
            }
            className="w-28 accent-[var(--accent)] h-1.5 appearance-none rounded-full bg-gray-200 dark:bg-gray-600 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--accent)] [&::-webkit-slider-thumb]:shadow-sm"
          />
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 tabular-nums w-10 text-right">
            {fontSize}px
          </span>
        </div>
      </div>

      {/* Font family */}
      <div className="flex items-start justify-between gap-6 px-4 py-3.5">
        <div className="min-w-0 pt-0.5">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-tight">
            字体
          </div>
        </div>
        <div className="shrink-0 flex gap-1.5">
          {FONT_FAMILIES.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => onChange({ fontFamily: f.key })}
              className={`rounded-lg border px-3 py-1 text-xs transition-colors cursor-pointer ${
                fontFamily === f.key
                  ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] font-medium"
                  : "border-black/[0.08] dark:border-white/[0.1] text-gray-600 dark:text-zinc-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Font weight */}
      <div className="flex items-start justify-between gap-6 px-4 py-3.5">
        <div className="min-w-0 pt-0.5">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-tight">
            字重
          </div>
        </div>
        <div className="shrink-0 flex gap-1.5">
          {(["normal", "bold"] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => onChange({ fontWeight: w })}
              className={`rounded-lg border px-3 py-1 text-xs transition-colors cursor-pointer ${
                fontWeight === w
                  ? "border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)] font-medium"
                  : "border-black/[0.08] dark:border-white/[0.1] text-gray-600 dark:text-zinc-400 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
              }`}
              style={{ fontWeight: w }}
            >
              {w === "normal" ? "正常" : "加粗"}
            </button>
          ))}
        </div>
      </div>

      {/* Theme */}
      <div className="flex items-start justify-between gap-6 px-4 py-3.5">
        <div className="min-w-0 pt-0.5">
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200 leading-tight">
            阅读器背景
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2.5">
          {THEME_SWATCHES.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => onChange({ theme: t.key })}
              className="flex flex-col items-center gap-1 cursor-pointer"
            >
              <div
                className="h-7 w-7 rounded-full border-2 transition-all"
                style={{
                  backgroundColor: t.bg,
                  borderColor:
                    theme === t.key ? "var(--accent)" : "rgba(0,0,0,0.1)",
                }}
              />
              <span className="text-[10px] text-gray-500">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
