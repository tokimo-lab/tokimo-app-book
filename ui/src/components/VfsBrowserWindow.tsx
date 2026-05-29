/**
 * VfsBrowserWindow — sidecar wrapper around @tokimo/ui FileBrowserWindow.
 *
 * Modal window opened via `useVfsBrowse`. Wraps the generic UI component
 * with Book's vfs API + bridge-based result delivery.
 */

import type { ShellWindowHandle } from "@tokimo/sdk";
import {
  ConfigProvider,
  type FileBrowserVfsApi,
  FileBrowserWindow,
} from "@tokimo/ui";
import { useState } from "react";
import { vfsBrowse, vfsStat } from "../api";
import { getBookI18n } from "../i18n";
import { clearBrowseBridge, getBrowseBridge } from "../shared/browse-bridge";

function createFileBrowserTranslator(locale: string | null | undefined) {
  const { t } = getBookI18n(locale);
  const dict: Record<string, string> = {
    "pathSelector.refresh": t("pathRefresh"),
    "pathSelector.selectDirectory": t("pathSelectDirectory"),
    "pathSelector.emptyDirectory": t("pathEmptyDirectory"),
    "pathSelector.colName": t("pathColName"),
    "pathSelector.colPermissions": t("pathColPermissions"),
    "pathSelector.colSize": t("pathColSize"),
    "pathSelector.colModified": t("pathColModified"),
    "pathSelector.cannotAccess": t("pathCannotAccess"),
    "common.cancel": t("commonCancel"),
  };
  return (key: string): string => dict[key] ?? key;
}

function formatLong(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString();
  } catch {
    return "";
  }
}

const vfsApi: FileBrowserVfsApi = {
  browse: (path, sourceId) => vfsBrowse(sourceId, path),
  stat: {
    stat: (paths, sourceId) => vfsStat(paths, sourceId),
  },
};

export default function VfsBrowserWindow({ win }: { win: ShellWindowHandle }) {
  const bridgeId =
    typeof win.metadata.bridgeId === "string" ? win.metadata.bridgeId : "";
  const [bridge] = useState(() =>
    bridgeId ? getBrowseBridge(bridgeId) : undefined,
  );

  if (!bridge) return null;

  const { uiLocale } = getBookI18n(bridge.locale);
  const t = createFileBrowserTranslator(bridge.locale);

  const finish = (path: string | null) => {
    bridge.resolve(path);
    clearBrowseBridge(bridgeId);
    win.close();
  };

  return (
    <ConfigProvider locale={uiLocale}>
      <FileBrowserWindow
        initialPath={bridge.initialPath}
        sourceId={bridge.sourceId}
        protocolPrefix={bridge.protocolPrefix}
        vfsApi={vfsApi}
        t={t}
        formatLong={formatLong}
        onConfirm={(path) => finish(path)}
        onCancel={() => finish(null)}
      />
    </ConfigProvider>
  );
}
