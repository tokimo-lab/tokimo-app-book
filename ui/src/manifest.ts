import { BookOpen } from "lucide-react";
import type { AppManifest } from "../_framework/types";

export const manifest: AppManifest = {
  id: "novel",
  name: "TokimoNovel",
  category: "system",
  fullBleed: true,
  defaultSize: { width: 1200, height: 800 },
  icon: BookOpen,
  image: "/page-icons/novel.png",
  color: "#8b5cf6",
  labelKey: "novel",
  order: 3,
  component: () => import("./components/NovelApp"),
  menuBar: () => import("./components/NovelMenuBar"),
  views: {
    "/": () => import("./components/NovelApp"),
    "/novels/:novelId": () => import("./pages/NovelDetailPage"),
  },
};
