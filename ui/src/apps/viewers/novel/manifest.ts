import { BookOpenText } from "lucide-react";
import type { AppManifest } from "../../_framework/types";

export const manifest: AppManifest = {
  id: "viewer-novel",
  name: "小说阅读器",
  category: "app",
  windowType: "novel",
  component: () =>
    import("./NovelViewer").then((m) => ({
      default: m.NovelViewer,
    })),
  defaultSize: { width: 800, height: 700 },
  icon: BookOpenText,
  color: "#a855f7",
};
