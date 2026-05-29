import { useWindowNav } from "@tokimo/sdk";
import { Button, Divider, Empty, Spin, Tag } from "@tokimo/ui";
import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileText,
  Heart,
  Star,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { bookApi } from "../api";
import { type BookTranslator, useBookI18n } from "../i18n";
import type { BookChapterOutput, BookVolumeOutput } from "../types";
import {
  formatFileSize,
  formatWordCount,
  posterThumbUrl,
  serialStatusColor,
} from "../utils";

// ── Local SectionTitle ────────────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 text-lg font-semibold text-fg-primary">{children}</h2>
  );
}

// ── Volume Section (collapsible) ──────────────────────────────────────────────
function VolumeSection({
  volume,
  onOpenChapter,
  t,
  locale,
}: {
  volume: BookVolumeOutput;
  onOpenChapter: (chapterId: string) => void;
  t: BookTranslator;
  locale: string | null | undefined;
}) {
  const [open, setOpen] = useState(true);

  return (
    <div className="overflow-hidden rounded-lg border border-border-base">
      <button
        type="button"
        className="cursor-pointer flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <ChevronDown size={16} className="text-fg-muted" />
        ) : (
          <ChevronRight size={16} className="text-fg-muted" />
        )}
        <div className="min-w-0 flex-1">
          <span className="text-sm font-semibold">
            {t("volumeTitle", { number: volume.volumeNumber })}
            {volume.title ? ` · ${volume.title}` : ""}
          </span>
          <span className="ml-3 text-xs text-fg-muted">
            {t("chapterCount", { count: volume.chapterCount ?? volume.chapters.length })}
            {volume.wordCount != null && volume.wordCount > 0 && (
              <> · {formatWordCount(volume.wordCount, locale)}</>
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
              t={t}
              locale={locale}
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
  t,
  locale,
}: {
  chapter: BookChapterOutput;
  onClick: () => void;
  t: BookTranslator;
  locale: string | null | undefined;
}) {
  return (
    <button
      type="button"
      className="cursor-pointer flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
      onClick={onClick}
    >
      <span className="w-12 flex-shrink-0 text-xs text-fg-muted">
        #{chapter.chapterNumber}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">
        {chapter.title ?? t("chapterTitle", { number: chapter.chapterNumber })}
      </span>
      {chapter.wordCount != null && chapter.wordCount > 0 && (
        <span className="flex-shrink-0 text-xs text-fg-muted">
          {formatWordCount(chapter.wordCount, locale)}
        </span>
      )}
    </button>
  );
}

// ── Favorite Button ───────────────────────────────────────────────────────────
function FavoriteButton({
  isFavorite,
  t,
}: {
  isFavorite: boolean;
  t: BookTranslator;
}) {
  return (
    <button
      type="button"
      className="flex h-9 w-9 cursor-not-allowed items-center justify-center rounded-full opacity-50 transition-colors hover:bg-black/[0.06] dark:hover:bg-white/[0.1]"
      title={t("favoriteComingSoon")}
      disabled
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
  const { route, goBack } = useWindowNav();
  const { t, locale } = useBookI18n();

  // Parse bookId from route: /books/:id
  const bookId = useMemo(() => {
    const m = /^\/books\/([^/]+)/.exec(route);
    return m ? m[1] : null;
  }, [route]);

  const detailQuery = bookApi.getItemDetail.useQuery(
    { id: bookId! },
    { enabled: !!bookId },
  );
  const bookDetail = detailQuery.data;

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
      // Chapter reading opens in a new window via shell — not yet supported in sidecar context
      console.info("[Book] Chapter reading:", chapterId, "for book:", bookId);
    },
    [bookId],
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
        <Button icon={<ArrowLeft size={16} />} onClick={() => goBack()}>
          {t("commonBack")}
        </Button>
        <div className="mt-12">
          <Empty description={t("bookNotFound")} />
        </div>
      </div>
    );
  }

  const coverUrl = posterThumbUrl(bookDetail.coverPath, 300);

  return (
    <div className="min-h-screen px-4 py-6 md:px-6">
      <div className="mb-6">
        <Button icon={<ArrowLeft size={16} />} onClick={() => goBack()}>
          {t("commonBack")}
        </Button>
      </div>

      <div className="flex items-start gap-6">
        {/* Cover */}
        <div className="hidden w-[180px] flex-shrink-0 overflow-hidden rounded-xl shadow-2xl md:block">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={bookDetail.title}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[2/3] flex-col items-center justify-center bg-[var(--bg-skeleton)]">
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
            <FavoriteButton isFavorite={bookDetail.isFavorite} t={t} />
          </div>

          {bookDetail.originalTitle &&
            bookDetail.originalTitle !== bookDetail.title && (
              <p className="mt-1 text-sm text-fg-muted">
                {bookDetail.originalTitle}
              </p>
            )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {bookDetail.author && <Tag>{bookDetail.author}</Tag>}
            {bookDetail.year && <Tag>{bookDetail.year}</Tag>}
            {bookDetail.serialStatus && (
              <Tag color={serialStatusColor(bookDetail.serialStatus)}>
                {bookDetail.serialStatus === "completed"
                  ? t("serialCompleted")
                  : bookDetail.serialStatus === "ongoing"
                    ? t("serialOngoing")
                    : bookDetail.serialStatus}
              </Tag>
            )}
            {bookDetail.publisher && <Tag>{bookDetail.publisher}</Tag>}
            {bookDetail.sourceProvider && (
              <Tag>{t("sourcePrefix", { source: bookDetail.sourceProvider })}</Tag>
            )}
            {bookDetail.scrapedAt ? (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-500">
                ✨ {t("scraped")}
              </span>
            ) : (
              <span className="text-xs text-orange-400">{t("notScraped")}</span>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-fg-muted">
            {bookDetail.totalChapters > 0 && (
              <span className="flex items-center gap-1">
                <BookOpen size={14} />
                {t("chapterCount", { count: bookDetail.totalChapters })}
              </span>
            )}
            {bookDetail.wordCount != null && bookDetail.wordCount > 0 && (
              <span className="flex items-center gap-1">
                <FileText size={14} />
                {formatWordCount(bookDetail.wordCount, locale)}
              </span>
            )}
            {bookDetail.doubanRating != null && bookDetail.doubanRating > 0 && (
              <span className="flex items-center gap-1">
                <Star size={14} className="text-yellow-500" />
                {t("doubanRating", { rating: bookDetail.doubanRating.toFixed(1) })}
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

          <div className="mt-5 flex items-center gap-3">
            {firstChapterId && (
              <Button variant="primary" onClick={handleStartReading}>
                <BookOpen size={16} className="mr-1.5" />
                {t("startReading")}
              </Button>
            )}
          </div>

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

      <section>
        <SectionTitle>
          {t("catalogTitle")}
          <span className="ml-2 text-sm font-normal text-fg-muted">
            ({t("chapterCount", { count: bookDetail.totalChapters })})
          </span>
        </SectionTitle>

        {bookDetail.volumes.length === 0 &&
        bookDetail.orphanChapters.length === 0 ? (
          <Empty description={t("emptyChapters")} />
        ) : (
          <div className="space-y-3">
            {bookDetail.volumes.map((vol) => (
              <VolumeSection
                key={vol.id}
                volume={vol}
                onOpenChapter={handleOpenChapter}
                t={t}
                locale={locale}
              />
            ))}
            {bookDetail.orphanChapters.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border-base">
                {bookDetail.volumes.length > 0 && (
                  <div className="px-4 py-2.5 text-sm font-semibold text-fg-muted">
                    {t("otherChapters")}
                  </div>
                )}
                {bookDetail.orphanChapters.map((ch) => (
                  <ChapterRow
                    key={ch.id}
                    chapter={ch}
                    onClick={() => handleOpenChapter(ch.id)}
                    t={t}
                    locale={locale}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {bookDetail.files.length > 0 && (
        <>
          <Divider className="my-8" />
          <section>
            <SectionTitle>{t("commonFiles")}</SectionTitle>
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
