import { useQueryClient } from "@tanstack/react-query";
import { Checkbox, Modal } from "@tokimo/ui";
import { Download, FolderSync, RefreshCw } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { api } from "@/generated/rust-api";
import type { MenuBarConfig } from "@/system";
import { useMenuBar, useMessage, useWindowNav } from "@/system";
import BookDownloadModal from "./BookDownloadModal";

export default function BookMenuBar({ children }: { children: ReactNode }) {
  const { navigate, params } = useWindowNav();
  const bookId = params.libraryId ?? undefined;
  const message = useMessage();
  const qc = useQueryClient();

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncClearData, setSyncClearData] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  const syncMut = api.book.sync.useMutation({
    onSuccess: () => {
      message.success("同步已开始");
      setSyncModalOpen(false);
      api.book.list.invalidate(qc);
      api.book.listItems.invalidate(qc);
    },
    onError: (error) => {
      message.error(error.message || "同步失败");
    },
  });

  const menuBarConfig: MenuBarConfig | null = useMemo(() => {
    if (!bookId) return null;

    return {
      menus: [
        {
          key: "actions",
          label: "操作",
          items: [
            {
              key: "refresh",
              label: "刷新",
              icon: <RefreshCw size={14} />,
              onClick: () => {
                api.book.list.invalidate(qc);
                api.book.listItems.invalidate(qc);
              },
            },
            {
              key: "download-book",
              label: "下载小说",
              icon: <Download size={14} />,
              onClick: () => setDownloadOpen(true),
            },
            { type: "divider" as const },
            {
              key: "sync",
              label: "同步资料库",
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
          navigate(`/books/${item.id}`, `TokimoBook · ${item.title ?? "Book"}`),
      },
    };
  }, [bookId, qc, syncMut.isPending, navigate]);

  useMenuBar(menuBarConfig);

  return (
    <>
      {children}

      <Modal
        open={syncModalOpen}
        title="同步小说库"
        okText="开始同步"
        cancelText="取消"
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
          清空数据重新同步
        </Checkbox>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          勾选后将删除应用中所有已有条目并重新完整同步，适合修复数据异常。
        </p>
      </Modal>

      {bookId && (
        <BookDownloadModal
          open={downloadOpen}
          onClose={() => setDownloadOpen(false)}
          bookId={bookId}
          appName="小说库"
        />
      )}
    </>
  );
}
