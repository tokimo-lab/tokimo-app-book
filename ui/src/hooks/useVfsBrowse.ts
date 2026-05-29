import { useRuntimeCtx, type ShellApi } from "@tokimo/sdk";
import type { PathSelectorBrowseArgs } from "@tokimo/ui";
import { useCallback } from "react";
import { getBookI18n } from "../i18n";
import {
  type BrowseBridge,
  registerBrowseBridge,
} from "../shared/browse-bridge";

/**
 * Returns an `onBrowse` adapter for `<PathSelector>` / `<StorageBindingsField>`.
 *
 * Opens a modal VfsBrowserWindow via the host shell, threading the picked
 * path back through a per-call bridge (avoids serializing functions across
 * the modal-window boundary).
 */
export function useVfsBrowse(shell: ShellApi) {
  const ctx = useRuntimeCtx();
  return useCallback(
    (args: PathSelectorBrowseArgs) =>
      new Promise<string | null>((resolve) => {
        const bridge: BrowseBridge = {
          kind: "vfs-browse",
          shell,
          initialPath: args.initialPath,
          sourceId: args.sourceId,
          protocolPrefix: args.protocolPrefix,
          locale: ctx.locale,
          resolve,
        };
        const bridgeId = registerBrowseBridge(bridge);
        shell.openModalWindow({
          component: () => import("../components/VfsBrowserWindow"),
          title: getBookI18n(ctx.locale).t("selectDirectory"),
          width: 600,
          height: 480,
          metadata: { bridgeId },
        });
      }),
    [shell, ctx.locale],
  );
}
