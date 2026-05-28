import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Dispose } from "@tokimo/sdk";
import { defineApp, RuntimeProvider } from "@tokimo/sdk";
import {
  ConfigProvider,
  ToastProvider,
  enUS as uiEnUS,
  zhCN as uiZhCN,
} from "@tokimo/ui";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import BookApp from "./components/BookApp";
import BookMenuBar from "./components/BookMenuBar";
import { BookDownloadProvider } from "./hooks/BookDownloadContext";
import "./index.css";

export default defineApp({
  id: "book",
  manifest: {
    id: "book",
    appName: "TokimoBook",
    icon: "BookOpen",
    image: "icon.png",
    color: "#D97706",
    windowType: "tokimo-book",
    defaultSize: { width: 1200, height: 820 },
    category: "page",
  },
  mount(container, ctx): Dispose {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
    });
    const locale = ctx.locale.startsWith("zh") ? uiZhCN : uiEnUS;
    const root: Root = createRoot(container);

    root.render(
      <StrictMode>
        <RuntimeProvider value={ctx}>
          <QueryClientProvider client={queryClient}>
            <ConfigProvider locale={locale}>
              <ToastProvider>
                <BookDownloadProvider>
                  <BookMenuBar>
                    <BookApp />
                  </BookMenuBar>
                </BookDownloadProvider>
              </ToastProvider>
            </ConfigProvider>
          </QueryClientProvider>
        </RuntimeProvider>
      </StrictMode>,
    );
    return () => root.unmount();
  },
});
