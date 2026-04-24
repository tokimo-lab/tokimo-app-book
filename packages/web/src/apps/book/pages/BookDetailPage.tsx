import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftOutlined,
  Button,
  Divider,
  Empty,
  Image,
  Spin,
  Tag,
} from "@tokimo/ui";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Heart,
  Star,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  formatFileSize,
  SectionTitle,
} from "@/apps/media/pages/media-detail-shared";
import type { BookChapterOutput, BookVolumeOutput } from "@/generated/rust-api";
import { api } from "@/generated/rust-api";
import { posterThumbUrl } from "@/lib/thumb";
import { useBackgroundArt, useWindowNav } from "@/system";

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
): "success" | "processing" | "default" {
  if (status === "completed") return "success";
  if (status === "ongoing") return "processing";
  return "default";
}

// ── Volume Section (collapsible) ──────────────────────────────────────────────
function VolumeSection({
  volume,
  onOpenChapter,
}: {
  volume: BookVolumeOutput;
  onOpenChapter: (chapterId: string) => void;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-lg border border-border-base">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown size={16} className="text-fg-muted" />
        ) : (
          <ChevronRight size={16} className="text-fg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold">
            第{volume.volumeNumber}卷{volume.title ? ` · ${volume.title}` : ""}
          </span>
          <span className="ml-3 text-xs text-fg-muted">
            {volume.chapterCount ?? volume.chapters.length}章
            {volume.wordCount != null && volume.wordCount > 0 && (
              <> · {formatWordCount(volume.wordCount)}</>
            )}
          </span>
        </div>
      </button>
      {open && (
        <div className="border-t border-border-base">
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
  chapter: BookChapterOutput;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
      onClick={onClick}
    >
      <span className="w-12 flex-shrink-0 text-xs text-fg-muted">
        #{chapter.chapterNumber}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        {chapter.title ?? `第${chapter.chapterNumber}章`}
      </span>
      {chapter.wordCount != null && chapter.wordCount > 0 && (
        <span className="flex-shrink-0 text-xs text-fg-muted">
          {formatWordCount(chapter.wordCount)}
        </span>
      )}
    </button>
  );
}

// ── Favorite Button ───────────────────────────────────────────────────────────
function FavoriteButton({
  isFavorite,
  bookId,
}: {
  isFavorite: boolean;
  bookId: string;
}) {
  const qc = useQueryClient();
  const toggle = api.video.toggleFavorite.useMutation({
    onSuccess: () => void api.book.getItemDetail.invalidate(qc, { id: bookId }),
  });

  return (
    <button
      type="button"
      className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.1]"
      onClick={() => toggle.mutate({ type: "movie", id: bookId })}
      title={isFavorite ? "取消收藏" : "收藏"}
    >
      <Heart
        size={20}
        className={isFavorite ? "fill-red-500 text-red-500" : "text-fg-muted"}
      />
    </button>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BookDetailPage() {
  const { params, goBack, openWindow } = useWindowNav();
  const bookId = params.bookId;

  const detailQuery = api.book.getItemDetail.useQuery(
    { id: bookId! },
    { enabled: !!bookId },
  );

  const bookDetail = detailQuery.data;

  const { setBackgroundArt } = useBackgroundArt();
  useEffect(() => {
    if (bookDetail?.coverPath) {
      setBackgroundArt(posterThumbUrl(bookDetail.coverPath, 1280) ?? null);
    }
    return () => {
      setBackgroundArt(null);
    };
  }, [bookDetail?.coverPath, setBackgroundArt]);

  // Find the first chapter for "Start Reading"
  const firstChapterId = useMemo(() => {
    if (!bookDetail) return null;
    if (bookDetail.volumes.length > 0) {
      const firstVol = bookDetail.volumes.find((v) => v.chapters.length > 0);
      if (firstVol) return firstVol.chapters[0].id;
    }
    if (bookDetail.orphanChapters.length > 0) {
      return bookDetail.orphanChapters[0].id;
    }
    return null;
  }, [bookDetail]);

  const handleOpenChapter = useCallback(
    (chapterId: string) => {
      if (!bookId) return;
      openWindow({
        type: "book",
        title: bookDetail?.title ?? "Book",
        route: `/chapters/${chapterId}`,
        sourceType: "book",
        sourceId: bookId,
        bookId,
        chapterId,
      });
    },
    [openWindow, bookId, bookDetail?.title],
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

  if (!bookDetail) {
    return (
      <div className="px-6 py-6">
        <Button icon={<ArrowLeftOutlined />} onClick={() => goBack()}>
          返回
        </Button>
        <div className="mt-12">
          <Empty description="Book不存在" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      {/* Back */}
      <div className="mb-6">
        <Button icon={<ArrowLeftOutlined />} onClick={() => goBack()}>
          返回
        </Button>
      </div>

      {/* Hero: Cover + Metadata */}
      <div className="flex items-start gap-6">
        {/* Cover */}
        <div className="hidden w-[180px] flex-shrink-0 overflow-hidden rounded-xl shadow-2xl md:block">
          {bookDetail.coverPath ? (
            <Image
              src={posterThumbUrl(bookDetail.coverPath, 300)}
              alt={bookDetail.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[2/3] flex-col items-center justify-center bg-[var(--bg-skeleton)] text-5xl">
              <BookOpen size={48} strokeWidth={1.5} className="text-fg-muted" />
            </div>
          )}
        </div>

        {/* Metadata */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold leading-tight md:text-3xl">
              {bookDetail.title}
            </h1>
            <FavoriteButton
              isFavorite={bookDetail.isFavorite}
              bookId={bookDetail.id}
            />
          </div>

          {bookDetail.originalTitle &&
            bookDetail.originalTitle !== bookDetail.title && (
              <p className="mt-1 text-sm text-fg-muted">
                {bookDetail.originalTitle}
              </p>
            )}

          {/* Tags */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {bookDetail.author && <Tag>{bookDetail.author}</Tag>}
            {bookDetail.year && <Tag>{bookDetail.year}</Tag>}
            {bookDetail.serialStatus && (
              <Tag color={serialStatusColor(bookDetail.serialStatus)}>
                {serialStatusLabel(bookDetail.serialStatus)}
              </Tag>
            )}
            {bookDetail.publisher && <Tag>{bookDetail.publisher}</Tag>}
            {bookDetail.sourceProvider && (
              <Tag>来源: {bookDetail.sourceProvider}</Tag>
            )}
            {bookDetail.scrapedAt ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                ✨ 已刮削
              </span>
            ) : (
              <span className="text-xs text-orange-400">未刮削</span>
            )}
          </div>

          {/* Stats */}
          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-fg-muted">
            {bookDetail.totalChapters > 0 && (
              <span className="flex items-center gap-1">
                <BookOpen size={14} />
                {bookDetail.totalChapters}章
              </span>
            )}
            {bookDetail.wordCount != null && bookDetail.wordCount > 0 && (
              <span className="flex items-center gap-1">
                <FileText size={14} />
                {formatWordCount(bookDetail.wordCount)}
              </span>
            )}
            {bookDetail.doubanRating != null && bookDetail.doubanRating > 0 && (
              <span className="flex items-center gap-1">
                <Star size={14} className="text-yellow-500" />
                豆瓣 {bookDetail.doubanRating.toFixed(1)}
              </span>
            )}
            {bookDetail.bangumiRating != null &&
              bookDetail.bangumiRating > 0 && (
                <span className="flex items-center gap-1">
                  <Star size={14} className="text-blue-500" />
                  BGM {bookDetail.bangumiRating.toFixed(1)}
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
          {bookDetail.overview && (
            <div className="mt-5">
              <p className="whitespace-pre-line text-sm leading-relaxed text-fg-secondary">
                {bookDetail.overview}
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
          <span className="ml-2 text-sm font-normal text-fg-muted">
            ({bookDetail.totalChapters}章)
          </span>
        </SectionTitle>

        {bookDetail.volumes.length === 0 &&
        bookDetail.orphanChapters.length === 0 ? (
          <Empty description="暂无章节" />
        ) : (
          <div className="space-y-3">
            {/* Volumes */}
            {bookDetail.volumes.map((vol) => (
              <VolumeSection
                key={vol.id}
                volume={vol}
                onOpenChapter={handleOpenChapter}
              />
            ))}

            {/* Orphan chapters (no volume) */}
            {bookDetail.orphanChapters.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border-base">
                {bookDetail.volumes.length > 0 && (
                  <div className="px-4 py-2.5 text-sm font-semibold text-fg-muted">
                    其他章节
                  </div>
                )}
                {bookDetail.orphanChapters.map((ch) => (
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
      {bookDetail.files.length > 0 && (
        <>
          <Divider className="my-8" />
          <section>
            <SectionTitle>文件</SectionTitle>
            <div className="space-y-2">
              {bookDetail.files.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-3 rounded-lg border border-border-base px-4 py-3"
                >
                  <FileText size={20} className="flex-shrink-0 text-fg-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {file.filename}
                    </p>
                    <p className="text-xs text-fg-muted">
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
