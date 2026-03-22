import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftOutlined,
  Button,
  Divider,
  Empty,
  Image,
  Spin,
  Tag,
} from "@tokiomo/components";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Heart,
  Star,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWindowManager } from "../../contexts/WindowManagerContext";
import type {
  NovelChapterOutput,
  NovelVolumeOutput,
} from "../../generated/rust-api";
import { api } from "../../generated/rust-api";
import { resolveStoragePath } from "../../lib/storage-url";
import { formatFileSize, SectionTitle } from "./media-detail-shared";

function formatWordCount(count: number | null | undefined): string {
  if (count == null) return "";
  if (count >= 10000) return `${(count / 10000).toFixed(1)}万字`;
  return `${count}字`;
}

function serialStatusLabel(status: string | null | undefined): string {
  if (!status) return "";
  if (status === "completed") return "已完结";
  if (status === "ongoing") return "连载中";
  return status;
}

function serialStatusColor(
  status: string | null | undefined,
): "green" | "blue" | "default" {
  if (status === "completed") return "green";
  if (status === "ongoing") return "blue";
  return "default";
}

// ── Volume Section (collapsible) ──────────────────────────────────────────────
function VolumeSection({
  volume,
  onOpenChapter,
}: {
  volume: NovelVolumeOutput;
  onOpenChapter: (chapterId: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-lg border border-[var(--glass-border)]">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown size={16} className="text-gray-400" />
        ) : (
          <ChevronRight size={16} className="text-gray-400" />
        )}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold">
            第{volume.volumeNumber}卷{volume.title ? ` · ${volume.title}` : ""}
          </span>
          <span className="ml-3 text-xs text-gray-400">
            {volume.chapterCount ?? volume.chapters.length}章
            {volume.wordCount != null && volume.wordCount > 0 && (
              <> · {formatWordCount(volume.wordCount)}</>
            )}
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-[var(--glass-border)]">
          {volume.chapters.map((ch) => (
            <ChapterRow
              key={ch.id}
              chapter={ch}
              onClick={() => onOpenChapter(ch.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Chapter Row ───────────────────────────────────────────────────────────────
function ChapterRow({
  chapter,
  onClick,
}: {
  chapter: NovelChapterOutput;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
      onClick={onClick}
    >
      <span className="w-12 flex-shrink-0 text-xs text-gray-400">
        #{chapter.chapterNumber}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        {chapter.title ?? `第${chapter.chapterNumber}章`}
      </span>
      {chapter.wordCount != null && chapter.wordCount > 0 && (
        <span className="flex-shrink-0 text-xs text-gray-400">
          {formatWordCount(chapter.wordCount)}
        </span>
      )}
    </button>
  );
}

// ── Favorite Button ───────────────────────────────────────────────────────────
function FavoriteButton({
  isFavorite,
  novelId,
}: {
  isFavorite: boolean;
  novelId: string;
}) {
  const qc = useQueryClient();
  const toggle = api.mediaLibrary.toggleFavorite.useMutation({
    onSuccess: () =>
      void api.novel.getNovelDetail.invalidate(qc, { id: novelId }),
  });

  return (
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.1]"
      onClick={() => toggle.mutate({ type: "movie", id: novelId })}
      title={isFavorite ? "取消收藏" : "收藏"}
    >
      <Heart
        size={20}
        className={isFavorite ? "fill-red-500 text-red-500" : "text-gray-400"}
      />
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function NovelDetailPage() {
  const { id, novelId } = useParams<{ id: string; novelId: string }>();
  const navigate = useNavigate();
  const { openWindow } = useWindowManager();

  const detailQuery = api.novel.getNovelDetail.useQuery(
    { id: novelId! },
    { enabled: !!novelId },
  );

  const novel = detailQuery.data;

  // Find the first chapter for "Start Reading"
  const firstChapterId = useMemo(() => {
    if (!novel) return null;
    if (novel.volumes.length > 0) {
      const firstVol = novel.volumes.find((v) => v.chapters.length > 0);
      if (firstVol) return firstVol.chapters[0].id;
    }
    if (novel.orphanChapters.length > 0) {
      return novel.orphanChapters[0].id;
    }
    return null;
  }, [novel]);

  const handleOpenChapter = useCallback(
    (chapterId: string) => {
      if (!novelId) return;
      openWindow({
        filePath: `novel://${novelId}/${chapterId}`,
        fileName: novel?.title ?? "小说",
        fileSystemId: "",
        type: "novel",
        novelId,
        chapterId,
      });
    },
    [openWindow, novelId, novel?.title],
  );

  const handleStartReading = useCallback(() => {
    if (!firstChapterId) return;
    handleOpenChapter(firstChapterId);
  }, [firstChapterId, handleOpenChapter]);

  if (detailQuery.isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spin />
      </div>
    );
  }

  if (!novel) {
    return (
      <div className="px-6 py-6">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/dashboard/library/${id}`)}
        >
          返回
        </Button>
        <div className="mt-12">
          <Empty description="小说不存在" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      {/* Back */}
      <div className="mb-6">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={() => navigate(`/dashboard/library/${id}`)}
        >
          返回
        </Button>
      </div>

      {/* Hero: Cover + Metadata */}
      <div className="flex items-start gap-6">
        {/* Cover */}
        <div className="hidden w-[180px] flex-shrink-0 overflow-hidden rounded-xl shadow-2xl md:block">
          {novel.coverPath ? (
            <Image
              src={resolveStoragePath(novel.coverPath)}
              alt={novel.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[2/3] flex-col items-center justify-center bg-[var(--bg-skeleton)] text-5xl">
              <BookOpen size={48} strokeWidth={1.5} className="text-gray-400" />
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold leading-tight md:text-3xl">
              {novel.title}
            </h1>
            <FavoriteButton isFavorite={novel.isFavorite} novelId={novel.id} />
          </div>

          {novel.originalTitle && novel.originalTitle !== novel.title && (
            <p className="mt-1 text-sm text-gray-500">{novel.originalTitle}</p>
          )}

          {/* Tags */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {novel.author && <Tag>{novel.author}</Tag>}
            {novel.year && <Tag>{novel.year}</Tag>}
            {novel.serialStatus && (
              <Tag color={serialStatusColor(novel.serialStatus)}>
                {serialStatusLabel(novel.serialStatus)}
              </Tag>
            )}
            {novel.publisher && <Tag>{novel.publisher}</Tag>}
            {novel.sourceProvider && <Tag>来源: {novel.sourceProvider}</Tag>}
          </div>

          {/* Stats */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
            {novel.totalChapters > 0 && (
              <span className="flex items-center gap-1">
                <BookOpen size={14} />
                {novel.totalChapters}章
              </span>
            )}
            {novel.wordCount != null && novel.wordCount > 0 && (
              <span className="flex items-center gap-1">
                <FileText size={14} />
                {formatWordCount(novel.wordCount)}
              </span>
            )}
            {novel.doubanRating != null && novel.doubanRating > 0 && (
              <span className="flex items-center gap-1">
                <Star size={14} className="text-yellow-500" />
                豆瓣 {novel.doubanRating.toFixed(1)}
              </span>
            )}
            {novel.bangumiRating != null && novel.bangumiRating > 0 && (
              <span className="flex items-center gap-1">
                <Star size={14} className="text-blue-500" />
                BGM {novel.bangumiRating.toFixed(1)}
              </span>
            )}
          </div>

          {/* Actions */}
          <div className="mt-5 flex items-center gap-3">
            {firstChapterId && (
              <Button variant="primary" onClick={handleStartReading}>
                <BookOpen size={16} className="mr-1.5" />
                开始阅读
              </Button>
            )}
          </div>

          {/* Overview */}
          {novel.overview && (
            <div className="mt-5">
              <p className="whitespace-pre-line text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                {novel.overview}
              </p>
            </div>
          )}
        </div>
      </div>

      <Divider className="my-8" />

      {/* Chapters */}
      <section>
        <SectionTitle>
          章节目录
          <span className="ml-2 text-sm font-normal text-gray-400">
            ({novel.totalChapters}章)
          </span>
        </SectionTitle>

        {novel.volumes.length === 0 && novel.orphanChapters.length === 0 ? (
          <Empty description="暂无章节" />
        ) : (
          <div className="space-y-3">
            {/* Volumes */}
            {novel.volumes.map((vol) => (
              <VolumeSection
                key={vol.id}
                volume={vol}
                onOpenChapter={handleOpenChapter}
              />
            ))}

            {/* Orphan chapters (no volume) */}
            {novel.orphanChapters.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-[var(--glass-border)]">
                {novel.volumes.length > 0 && (
                  <div className="px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-400">
                    其他章节
                  </div>
                )}
                {novel.orphanChapters.map((ch) => (
                  <ChapterRow
                    key={ch.id}
                    chapter={ch}
                    onClick={() => handleOpenChapter(ch.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Files */}
      {novel.files.length > 0 && (
        <>
          <Divider className="my-8" />
          <section>
            <SectionTitle>文件</SectionTitle>
            <div className="space-y-2">
              {novel.files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 rounded-lg border border-[var(--glass-border)] px-4 py-3"
                >
                  <FileText size={20} className="flex-shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {file.filename}
                    </p>
                    <p className="text-xs text-gray-400">
                      {file.mimeType ?? ""}
                      {file.size != null && <> · {formatFileSize(file.size)}</>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
