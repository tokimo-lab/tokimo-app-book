import { useQueryClient } from "@tanstack/react-query";
import type { MenuBarConfig } from "@tokimo/sdk";
import {
  useMenuBar,
  useRuntimeCtx,
  useToast,
  useWindowActions,
  useWindowNav,
} from "@tokimo/sdk";
import { Checkbox, Modal } from "@tokimo/ui";
import { Download, FolderSync, RefreshCw } from "lucide-react";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { bookApi } from "../api";
import { useBookDownload } from "../hooks/BookDownloadContext";
import { useBookI18n } from "../i18n";
import { registerBridge } from "../modal-bridge";

export default function BookMenuBar({ children }: { children: ReactNode }) {
  const { route, navigate } = useWindowNav();
  const { openModalWindow } = useWindowActions();
  const ctx = useRuntimeCtx();
  const toast = useToast();
  const { t } = useBookI18n();
  const qc = useQueryClient();
  const { startDownload } = useBookDownload();

  const bookIdMatch = /^\/library\/([^/]+)/.exec(route);
  const bookId = bookIdMatch ? bookIdMatch[1] : undefined;

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncClearData, setSyncClearData] = useState(false);

  const syncMut = bookApi.sync.useMutation({
    onSuccess: () => {
      toast.success(t("syncStarted"));
      setSyncModalOpen(false);
      qc.refetchQueries({ queryKey: ["book"], type: "all" });
    },
    onError: (error) => {
      toast.error((error as Error).message || t("syncFailed"));
    },
  });

  const openDownloadWindow = useCallback(() => {
    if (!bookId) return;
    const bridgeId = registerBridge({
      kind: "book-download",
      ctx,
      bookId,
      appName: t("libraryAppName"),
      startDownload,
    });

    openModalWindow({
      component: () => import("./BookDownloadModalWindow"),
      title: t("downloadTitle"),
      width: 680,
      height: 640,
      metadata: { bridgeId, bookId },
    });
  }, [bookId, ctx, openModalWindow, startDownload, t]);

  const menuBarConfig: MenuBarConfig | null = useMemo(() => {
    if (!bookId) return null;

    return {
      menus: [
        {
          key: "actions",
          label: t("menuActions"),
          items: [
            {
              key: "refresh",
              label: t("commonRefresh"),
              icon: <RefreshCw size={14} />,
              onClick: () => {
                bookApi.list.invalidate(qc);
                bookApi.listItems.invalidate(qc);
              },
            },
            {
              key: "download-book",
              label: t("menuDownloadBook"),
              icon: <Download size={14} />,
              onClick: openDownloadWindow,
            },
            { type: "divider" as const },
            {
              key: "sync",
              label: t("menuSyncLibrary"),
              icon: <FolderSync size={14} />,
              disabled: syncMut.isPending,
              onClick: () => {
                setSyncClearData(false);
                setSyncModalOpen(true);
              },
            },
          ],
        },
      ],
      search: {
        appId: bookId,
        searchType: "book" as const,
        onSelect: (item) =>
          navigate(
            `/books/${item.id}`,
            `${t("appName")} · ${item.title ?? t("appFallbackBook")}`,
          ),
      },
    };
  }, [bookId, qc, syncMut.isPending, navigate, openDownloadWindow, t]);

  useMenuBar(menuBarConfig);

  return (
    <>
      {children}

      <Modal
        open={syncModalOpen}
        title={t("syncModalTitle")}
        okText={t("syncModalOk")}
        cancelText={t("commonCancel")}
        confirmLoading={syncMut.isPending}
        onCancel={() => setSyncModalOpen(false)}
        onOk={async () => {
          try {
            await syncMut.mutateAsync({
              id: bookId!,
              clearData: syncClearData,
            });
          } finally {
            setSyncModalOpen(false);
          }
        }}
      >
        <Checkbox
          checked={syncClearData}
          onChange={(e) => setSyncClearData(e.target.checked)}
        >
          {t("syncClearData")}
        </Checkbox>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {t("syncClearDataHint")}
        </p>
      </Modal>
    </>
  );
}
