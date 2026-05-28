import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useWindowActions, type WindowState } from "@tokimo/sdk";
import { ConfigProvider, ToastProvider } from "@tokimo/ui";
import { useState } from "react";
import { getBridge, type ModalBridge } from "../modal-bridge";
import BookLibraryEditor from "./BookLibraryEditor";

type LibraryEditorBridge = Extract<ModalBridge, { kind: "library-editor" }>;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

function BookLibraryEditorContent({
  win,
  bridge,
}: {
  win: WindowState;
  bridge: LibraryEditorBridge;
}) {
  const { closeWindow } = useWindowActions();
  const bookId =
    typeof win.metadata?.bookId === "string"
      ? win.metadata.bookId
      : bridge.bookId;

  return (
    <BookLibraryEditor
      bookId={bookId}
      onSaved={(savedId) => {
        bridge.onSaved?.(savedId);
        closeWindow(win.id);
      }}
      onDeleted={() => {
        bridge.onDeleted?.();
        closeWindow(win.id);
      }}
      onCancel={() => closeWindow(win.id)}
    />
  );
}

export default function BookLibraryEditorWindow({ win }: { win: WindowState }) {
  const bridgeId =
    typeof win.metadata?.bridgeId === "string"
      ? win.metadata.bridgeId
      : undefined;
  const [bridge] = useState(() => (bridgeId ? getBridge(bridgeId) : undefined));

  if (bridge?.kind !== "library-editor") return null;

  return (
    <ConfigProvider>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <BookLibraryEditorContent win={win} bridge={bridge} />
        </QueryClientProvider>
      </ToastProvider>
    </ConfigProvider>
  );
}
