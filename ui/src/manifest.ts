import type { SettingsSectionDef } from "@/lib/settings-defs";
import type { AppManifest } from "../_framework/types";

function readingLibrarySettings(): SettingsSectionDef[] {
  return [
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
            { label: "settings.library.sortTitleDesc", value: "title_desc" },
          ],
        },
        {
          key: "defaultView",
          type: "select",
          label: "settings.library.defaultView",
          defaultValue: "grid",
          options: [
            { label: "settings.library.viewGrid", value: "grid" },
            { label: "settings.library.viewList", value: "list" },
          ],
        },
      ],
    },
  ];
}

export const manifest: AppManifest = {
  id: "novel",
  name: "Novel Library",
  category: "page",
  supportedTypes: ["novel", "manga", "ebook"],
  defaultSize: { width: 1200, height: 800 },
  component: () => import("./pages/NovelAppPage"),
  menuBar: () => import("./components/NovelMenuBar"),

  settings: readingLibrarySettings(),
  settingsByType: {
    novel: [
      ...readingLibrarySettings(),
      {
        key: "reader",
        label: "settings.novel.reader",
        fields: [
          {
            key: "fontSize",
            type: "slider",
            label: "settings.novel.fontSize",
            defaultValue: 18,
            min: 14,
            max: 24,
            step: 2,
          },
          {
            key: "fontFamily",
            type: "select",
            label: "settings.novel.fontFamily",
            defaultValue: "serif",
            options: [
              { label: "settings.novel.fontSerif", value: "serif" },
              { label: "settings.novel.fontSansSerif", value: "sans-serif" },
              { label: "settings.novel.fontMonospace", value: "monospace" },
            ],
          },
          {
            key: "fontWeight",
            type: "select",
            label: "settings.novel.fontWeight",
            defaultValue: "normal",
            options: [
              { label: "settings.novel.weightNormal", value: "normal" },
              { label: "settings.novel.weightBold", value: "bold" },
            ],
          },
          {
            key: "theme",
            type: "select",
            label: "settings.novel.readerTheme",
            defaultValue: "light",
            options: [
              { label: "settings.novel.themeLight", value: "light" },
              { label: "settings.novel.themeDark", value: "dark" },
              { label: "settings.novel.themeSepia", value: "sepia" },
            ],
          },
        ],
      },
    ],
  },
};
