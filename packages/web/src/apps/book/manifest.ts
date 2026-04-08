import { BookOpen } from "lucide-react";
import type { AppManifest } from "../_framework/types";

export const manifest: AppManifest = {
  id: "book",
  name: "TokimoBook",
  category: "system",
  fullBleed: true,
  defaultSize: { width: 1200, height: 800 },
  icon: BookOpen,
  image: "/page-icons/book.png",
  color: "#8b5cf6",
  labelKey: "book",
  order: 3,
  component: () => import("./components/BookApp"),
  menuBar: () => import("./components/BookMenuBar"),
  views: {
    "/": () => import("./components/BookApp"),
    "/books/:bookId": () => import("./pages/BookDetailPage"),
  },
};
