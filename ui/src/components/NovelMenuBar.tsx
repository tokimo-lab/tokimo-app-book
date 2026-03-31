import { useQueryClient } from "@tanstack/react-query";
import { Checkbox, Modal } from "@tokiomo/components";
import { Download, FolderSync, RefreshCw } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { api } from "@/generated/rust-api";
import type { MenuBarConfig } from "@/system";
import { useMenuBar, useMessage, useWindowNav } from "@/system";
import NovelDownloadModal from "./NovelDownloadModal";

export default function NovelMenuBar({ children }: { children: ReactNode }) {
  const { params, navigate: navInWindow } = useWindowNav();
  const id = params.appId as string | undefined;
  const message = useMessage();
  const qc = useQueryClient();

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncClearData, setSyncClearData] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);

  const libraryQuery = api.app.getById.useQuery({ id: id! }, { enabled: !!id });
  const library = libraryQuery.data;

  const syncMut = api.app.sync.useMutation({
    onSuccess: () => {
      message.success("同步已开始");
      setSyncModalOpen(false);
      api.novel.listNovels.invalidate(qc);
    },
    onError: (error) => {
      message.error(error.message || "同步失败");
    },
  });

  const menuBarConfig: MenuBarConfig | null = useMemo(() => {
    if (!id) return null;

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
              onClick: () => void api.novel.listNovels.invalidate(qc),
            },
            {
              key: "download-novel",
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
        appId: id,
        searchType: "novel" as const,
        onSelect: (item) =>
          navInWindow(item.title ?? "Novel", { novelId: item.id }),
      },
    };
  }, [id, qc, syncMut.isPending, navInWindow]);

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
            await syncMut.mutateAsync({ id: id!, clearData: syncClearData });
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

      <NovelDownloadModal
        open={downloadOpen}
        onClose={() => setDownloadOpen(false)}
        appId={id!}
        appName={library?.name ?? "小说库"}
      />
    </>
  );
}
