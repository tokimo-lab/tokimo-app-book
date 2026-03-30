import type { AppManifest } from "../_framework/types";

export const manifest: AppManifest = {
  id: "novel",
  name: "Novel Library",
  category: "page",
  supportedTypes: ["novel", "manga", "ebook"],
  defaultSize: { width: 1200, height: 800 },
  component: () => import("./pages/NovelAppPage"),
};
