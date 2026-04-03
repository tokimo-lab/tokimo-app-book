import { BookOpen } from "lucide-react";
import type { AppManifest } from "../../_framework/types";

export const manifest: AppManifest = {
  id: "viewer-book",
  name: "图书阅读器",
  category: "app",
  windowType: ["epub", "mobi"],
  component: () => import("./EpubViewer"),
  defaultSize: { width: 900, height: 700 },
  icon: BookOpen,
  color: "#059669",
};
