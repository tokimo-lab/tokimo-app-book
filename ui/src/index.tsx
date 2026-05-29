import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Dispose } from "@tokimo/sdk";
import { defineApp, RuntimeProvider } from "@tokimo/sdk";
import { ConfigProvider, ToastProvider } from "@tokimo/ui";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AppCtxProvider } from "./AppContext";
import BookApp from "./components/BookApp";
import BookMenuBar from "./components/BookMenuBar";
import { BookDownloadProvider } from "./hooks/BookDownloadContext";
import { getBookI18n } from "./i18n";
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
      defaultOptions: { queries: { retry: 1 } },
    });
    const locale = getBookI18n(ctx.locale).uiLocale;
    const root: Root = createRoot(container);

    root.render(
      <StrictMode>
        <RuntimeProvider value={ctx}>
          <AppCtxProvider value={ctx}>
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
          </AppCtxProvider>
        </RuntimeProvider>
      </StrictMode>,
    );
    return () => root.unmount();
  },
});
