import { cn } from "@tokimo/ui";
import { getAvatarColor, getAvatarIcon } from "@tokimo/sdk";

const HASH_PALETTE = [
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#06b6d4",
  "#3b82f6",
  "#6366f1",
  "#a855f7",
  "#ec4899",
];

function hashColor(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = str.charCodeAt(i) + ((h << 5) - h);
  }
  return HASH_PALETTE[Math.abs(h) % HASH_PALETTE.length];
}

const LUCIDE_ICON_CATALOG: Record<string, string> = {
  BookOpen: "📖",
  Library: "📚",
  Book: "📕",
};

/** Resolve a lucide icon name to an emoji fallback for display. */
function resolveIcon(icon: string | null | undefined): string | null {
  if (!icon) return null;
  if (icon.startsWith("lucide:")) {
    const name = icon.slice(7);
    return LUCIDE_ICON_CATALOG[name] ?? name;
  }
  return LUCIDE_ICON_CATALOG[icon] ?? icon;
}

/**
 * Simplified AppIcon that renders an avatar icon for a library entry.
 * Does not depend on the full icon catalog from the main repo.
 */
export function AppIcon({
  icon,
  color,
  size = 24,
  className,
}: {
  icon?: string | null;
  color?: string | null;
  size?: number;
  className?: string;
}) {
  const displayText = resolveIcon(icon);
  const bgColor = color || (displayText ? hashColor(displayText) : "#6366f1");

  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-[20%] select-none shrink-0 overflow-hidden text-white/90",
        className,
      )}
      style={{ width: size, height: size, backgroundColor: bgColor }}
    >
      <span style={{ fontSize: size * 0.6, lineHeight: 1 }}>{displayText}</span>
    </div>
  );
}

/**
 * LibraryIcon — renders a library avatar using SDK helpers.
 */
export function LibraryIcon({
  avatar,
  name,
  size = 24,
}: {
  avatar: unknown;
  name: string;
  size?: number;
}) {
  const icon = getAvatarIcon(avatar) ?? name;
  const color = getAvatarColor(avatar) ?? undefined;
  return <AppIcon icon={icon} color={color ?? null} size={size} />;
}
