import { useQueryClient } from "@tanstack/react-query";
import type { MenuBarConfig } from "@tokimo/sdk";
import { useMenuBar, useToast, useWindowNav } from "@tokimo/sdk";
import { Checkbox, Modal } from "@tokimo/ui";
import { Download, FolderSync, RefreshCw } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { bookApi } from "../api";
import { useBookI18n } from "../i18n";
import BookDownloadModal from "./BookDownloadModal";

export default function BookMenuBar({ children }: { children: ReactNode }) {
  const { route, navigate } = useWindowNav();
  const toast = useToast();
  const { t } = useBookI18n();
  const qc = useQueryClient();

  const bookIdMatch = /^\/library\/([^/]+)/.exec(route);
  const bookId = bookIdMatch ? bookIdMatch[1] : undefined;

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncClearData, setSyncClearData] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  const syncMut = bookApi.sync.useMutation({
    onSuccess: () => {
      toast.success(t("syncStarted"));
      setSyncModalOpen(false);
      bookApi.list.invalidate(qc);
      bookApi.listItems.invalidate(qc);
    },
    onError: (error) => {
      toast.error((error as Error).message || t("syncFailed"));
    },
  });

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
              onClick: () => setDownloadOpen(true),
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
          navigate(`/books/${item.id}`, `${t("appName")} · ${item.title ?? t("appFallbackBook")}`),
      },
    };
  }, [bookId, qc, syncMut.isPending, navigate, t]);

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

      {bookId && (
        <BookDownloadModal
          open={downloadOpen}
          onClose={() => setDownloadOpen(false)}
          bookId={bookId}
          appName={t("libraryAppName")}
        />
      )}
    </>
  );
}
