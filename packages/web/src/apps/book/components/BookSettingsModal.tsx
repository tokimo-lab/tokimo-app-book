import { Modal, Spin } from "@tokiomo/components";
import { lazy, Suspense } from "react";

const BookSettingsPage = lazy(
  () => import("@/apps/settings/admin/BookSettingsPage"),
);

interface BookSettingsModalProps {
  open: boolean;
  onClose: () => void;
}

export default function BookSettingsModal({
  open,
  onClose,
}: BookSettingsModalProps) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      title="TokimoBook 设置"
      footer={null}
      width={960}
      destroyOnClose
      styles={{ body: { padding: 0 } }}
    >
      <div className="h-[640px]">
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center">
              <Spin />
            </div>
          }
        >
          <BookSettingsPage />
        </Suspense>
      </div>
    </Modal>
  );
}
