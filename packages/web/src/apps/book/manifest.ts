import { BookOpen } from "lucide-react";
import type { AppManifest } from "../_framework/types";

export const manifest: AppManifest = {
  id: "book",
  category: "system",
  fullBleed: true,
  defaultSize: { width: 1200, height: 800 },
  icon: BookOpen,
  image: "/page-icons/book.png",
  color: "#8b5cf6",
  appName: "dashboard.menu.book",
  order: 3,
  component: () => import("./components/BookApp"),
  menuBar: () => import("./components/BookMenuBar"),
  views: {
    "/": () => import("./components/BookApp"),
    "/books/:bookId": () => import("./pages/BookDetailPage"),
  },

  userSettings: {
    order: 12,
    libraryDomain: "book",
    sections: [
      {
        key: "display",
        label: "settings.library.display",
        fields: [
          {
            key: "defaultSort",
            type: "select",
            label: "settings.library.defaultSort",
            defaultValue: "addedAt",
            options: [
              { label: "settings.library.sortAddedAt", value: "addedAt" },
              { label: "settings.library.sortTitleAsc", value: "title_asc" },
              {
                label: "settings.library.sortTitleDesc",
                value: "title_desc",
              },
              { label: "settings.library.sortAuthor", value: "author_asc" },
              { label: "settings.library.sortYearDesc", value: "year_desc" },
              {
                label: "settings.library.sortWordCount",
                value: "wordCount_desc",
              },
            ],
          },
        ],
      },
    ],
  },
};
