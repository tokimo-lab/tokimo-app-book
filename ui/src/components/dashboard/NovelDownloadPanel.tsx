/**
 * Safari 风格小说下载面板
 * 展示下载列表、进度条、详细日志
 */

import { Modal, Popconfirm, Tag } from "@tokiomo/components";
import {
  AlertCircle,
  Ban,
  BookOpen,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  ScrollText,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNovelDownload } from "../../hooks";
import type {
  NovelDownloadLog,
  NovelDownloadStatus,
  NovelDownloadTask,
} from "../../hooks/NovelDownloadContext";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

const STATUS_CONFIG: Record<
  NovelDownloadStatus,
  { icon: React.ReactNode; label: string; color: string }
> = {
  downloading: {
    icon: <Loader2 size={14} className="animate-spin" />,
    label: "下载中",
    color: "text-[var(--accent)]",
  },
  completed: {
    icon: <CheckCircle size={14} />,
    label: "已完成",
    color: "text-green-500",
  },
  failed: {
    icon: <AlertCircle size={14} />,
    label: "失败",
    color: "text-red-500",
  },
  cancelled: {
    icon: <Ban size={14} />,
    label: "已取消",
    color: "text-zinc-600 dark:text-zinc-400",
  },
};

const PHASE_COLORS: Record<string, string> = {
  start: "text-blue-400",
  info: "text-cyan-400",
  progress: "text-green-400",
  vip: "text-amber-400",
  rescue: "text-emerald-400",
  error: "text-red-400",
  done: "text-emerald-400",
  cancel: "text-yellow-400",
};

// ── Log Modal ───────────────────────────────────────────────────────────────

function NovelDownloadLogModal({
  open,
  task,
  onClose,
}: {
  open: boolean;
  task: NovelDownloadTask | null;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const logsLen = task?.logs.length ?? 0;

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on new log entries
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [open, logsLen]);

  if (!task) return null;

  return (
    <Modal
      open={open}
      onCancel={onClose}
      title={
        <span className="flex items-center gap-2">
          <ScrollText size={16} />
          下载日志 — {task.title}
        </span>
      }
      footer={null}
      size="large"
      destroyOnHidden
      styles={{
        body: {
          padding: 0,
          background: "#09090b",
          borderRadius: "0 0 0.5rem 0.5rem",
          overflow: "hidden",
        },
      }}
    >
      {/* Summary bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-gray-800 text-xs">
        <span className="text-zinc-600 dark:text-zinc-400">
          源: <span className="text-gray-200">{task.provider}</span>
        </span>
        <span className="text-zinc-600 dark:text-zinc-400">
          进度:{" "}
          <span className="text-gray-200">
            {task.downloaded}/{task.total}
          </span>
        </span>
        {task.vipSkipped > 0 && (
          <span className="text-amber-400">VIP跳过: {task.vipSkipped}</span>
        )}
        {task.rescued > 0 && (
          <span className="text-emerald-400">VIP补全: {task.rescued}</span>
        )}
        {task.failed > 0 && (
          <span className="text-red-400">失败: {task.failed}</span>
        )}
        <span className="text-zinc-600 dark:text-zinc-400">
          耗时: {formatElapsed(Date.now() - task.startedAt)}
        </span>
      </div>

      {/* Log entries */}
      <div
        ref={scrollRef}
        className="h-[400px] overflow-y-auto font-mono text-xs leading-5 p-4"
      >
        {task.logs.map((log) => (
          <LogLine key={`${log.time}-${log.phase}`} log={log} />
        ))}
        {task.status === "downloading" && (
          <div className="mt-2 flex items-center gap-2 text-gray-500">
            <Loader2 size={12} className="animate-spin" />
            <span>下载进行中...</span>
          </div>
        )}
      </div>
    </Modal>
  );
}

function LogLine({ log }: { log: NovelDownloadLog }) {
  const phaseColor =
    PHASE_COLORS[log.phase] ?? "text-zinc-600 dark:text-zinc-400";
  return (
    <div className="flex gap-2 hover:bg-white/[0.03]">
      <span className="text-gray-600 shrink-0">{formatTime(log.time)}</span>
      <span className={`shrink-0 w-16 ${phaseColor}`}>
        [{log.phase.toUpperCase()}]
      </span>
      <span className="text-zinc-700 dark:text-zinc-300">{log.message}</span>
    </div>
  );
}

// ── Download Item ───────────────────────────────────────────────────────────

function DownloadTaskItem({
  task,
  onCancel,
  onRemove,
  onViewLog,
}: {
  task: NovelDownloadTask;
  onCancel: () => void;
  onRemove: () => void;
  onViewLog: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const config = STATUS_CONFIG[task.status];
  const processed = task.downloaded + task.vipSkipped;
  const percent =
    task.total > 0 ? Math.round((processed / task.total) * 100) : 0;
  const isActive = task.status === "downloading";
  const isDone = task.status === "completed";
  const barColor = isDone
    ? "bg-green-500"
    : task.status === "failed"
      ? "bg-red-500"
      : "bg-[var(--accent)]";

  const recentLogs = task.logs.slice(-3);

  return (
    <div className="px-4 py-3 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors">
      {/* Main row */}
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className="flex-shrink-0 w-9 h-12 rounded overflow-hidden bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
          <BookOpen size={20} className="text-zinc-600 dark:text-zinc-400" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title + status */}
          <div className="flex items-start justify-between gap-2">
            <p
              className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate leading-snug"
              title={task.title}
            >
              {task.title}
            </p>
            <div
              className={`flex-shrink-0 flex items-center gap-1 mt-0.5 ${config.color}`}
            >
              {config.icon}
            </div>
          </div>

          {/* Meta */}
          <div className="flex items-center gap-2 mt-0.5">
            <Tag className="!text-[10px]">{task.provider}</Tag>
            <span className={`text-xs font-medium ${config.color}`}>
              {config.label}
            </span>
            {task.author && (
              <span className="text-xs text-gray-500 truncate max-w-[120px]">
                {task.author}
              </span>
            )}
          </div>

          {/* Progress bar */}
          {(isActive || percent > 0) && (
            <div className="mt-1.5 space-y-0.5">
              <div className="h-1 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                  style={{
                    width: `${Math.min(100, Math.max(0, percent))}%`,
                  }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-zinc-600 dark:text-gray-500">
                <span>
                  {task.downloaded}/{task.total} 章
                  {task.rescued > 0 && (
                    <span className="text-emerald-400 ml-1">
                      ({task.rescued} 补全)
                    </span>
                  )}
                  {task.vipSkipped > 0 && (
                    <span className="text-amber-400 ml-1">
                      ({task.vipSkipped} VIP)
                    </span>
                  )}
                  {task.failed > 0 && (
                    <span className="text-red-400 ml-1">
                      ({task.failed} 失败)
                    </span>
                  )}
                </span>
                <span>
                  {isActive && task.currentChapter
                    ? task.currentChapter
                    : `${percent}%`}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-0.5 mt-0.5">
          {/* View log */}
          <button
            type="button"
            onClick={onViewLog}
            className="p-1 rounded text-zinc-600 dark:text-zinc-400 hover:text-[var(--accent)] transition-colors"
            title="查看日志"
          >
            <ScrollText size={14} />
          </button>

          {/* Expand inline logs */}
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="p-1 rounded text-zinc-600 dark:text-zinc-400 hover:text-gray-600 dark:hover:text-zinc-300 transition-colors"
            title={expanded ? "收起" : "展开日志"}
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {/* Cancel (only if active) */}
          {isActive && (
            <button
              type="button"
              onClick={onCancel}
              className="p-1 rounded text-zinc-600 dark:text-zinc-400 hover:text-red-500 transition-colors"
              title="取消"
            >
              <X size={14} />
            </button>
          )}

          {/* Remove (only if not active) */}
          {!isActive && (
            <Popconfirm
              title="移除该记录？"
              onConfirm={onRemove}
              okText="移除"
              cancelText="取消"
            >
              <button
                type="button"
                className="p-1 rounded text-zinc-600 dark:text-zinc-400 hover:text-red-500 transition-colors"
                title="移除"
              >
                <Trash2 size={14} />
              </button>
            </Popconfirm>
          )}
        </div>
      </div>

      {/* Inline log preview */}
      {expanded && recentLogs.length > 0 && (
        <div className="mt-2 ml-12 space-y-0.5 font-mono text-[10px] text-gray-500 bg-black/[0.03] dark:bg-white/[0.03] rounded p-2">
          {recentLogs.map((log) => (
            <div key={`${log.time}-${log.phase}`} className="flex gap-1.5">
              <span className="text-gray-600 dark:text-gray-600 shrink-0">
                {formatTime(log.time)}
              </span>
              <span
                className={
                  PHASE_COLORS[log.phase] ?? "text-zinc-600 dark:text-zinc-400"
                }
              >
                [{log.phase}]
              </span>
              <span className="truncate">{log.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Panel ──────────────────────────────────────────────────────────────

export default function NovelDownloadPanel() {
  const { tasks, activeCount, cancelDownload, removeTask, clearCompleted } =
    useNovelDownload();
  const [logTask, setLogTask] = useState<NovelDownloadTask | null>(null);
  const [logOpen, setLogOpen] = useState(false);

  const handleViewLog = useCallback(
    (task: NovelDownloadTask) => {
      // Always get freshest task
      const fresh = tasks.find((t) => t.id === task.id) ?? task;
      setLogTask(fresh);
      setLogOpen(true);
    },
    [tasks],
  );

  // Keep log modal updated with latest task data
  useEffect(() => {
    if (logTask && logOpen) {
      const fresh = tasks.find((t) => t.id === logTask.id);
      if (fresh && fresh.logs.length !== logTask.logs.length) {
        setLogTask(fresh);
      }
    }
  }, [tasks, logTask, logOpen]);

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-zinc-600 dark:text-zinc-400">
        <div className="text-4xl mb-3">📚</div>
        <p className="text-sm">暂无下载任务</p>
      </div>
    );
  }

  const doneCount = tasks.filter((t) => t.status !== "downloading").length;

  return (
    <>
      {/* Active summary */}
      {activeCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--accent)]/5 border-b border-[var(--glass-border)]">
          <Loader2 size={12} className="text-[var(--accent)] animate-spin" />
          <span className="text-xs text-[var(--accent-text)] font-medium">
            {activeCount} 个任务进行中
          </span>
        </div>
      )}

      {/* Clear completed */}
      {doneCount > 0 && (
        <div className="flex justify-end px-4 py-1.5 border-b border-[var(--glass-border)]">
          <button
            type="button"
            onClick={clearCompleted}
            className="text-[10px] text-zinc-600 dark:text-zinc-400 hover:text-[var(--accent)] transition-colors"
          >
            清除已完成
          </button>
        </div>
      )}

      {/* Task list */}
      <div className="divide-y divide-[var(--glass-border)]">
        {tasks.map((task) => (
          <DownloadTaskItem
            key={task.id}
            task={task}
            onCancel={() => cancelDownload(task.id)}
            onRemove={() => removeTask(task.id)}
            onViewLog={() => handleViewLog(task)}
          />
        ))}
      </div>

      {/* Log modal */}
      <NovelDownloadLogModal
        open={logOpen}
        task={logTask}
        onClose={() => {
          setLogOpen(false);
          setLogTask(null);
        }}
      />
    </>
  );
}
