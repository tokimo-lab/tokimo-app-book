import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { useJobEvents, useAppEntityEvents } from "@tokimo/sdk";
import type { ShellJobEvent, AppEntityEvent } from "@tokimo/sdk";
import { bookApi } from "../api";
import type { BookContainerOutput } from "../types";

export interface BookLibraryProgressState {
  isActive: boolean;
  pct: number;
}

const BOOK_SCAN_JOB_TYPES = ["book_scrape"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberField(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" ? value : null;
}

function extractBookLibraryId(job: {
  appId: string | null;
  params: Record<string, unknown>;
  data?: Record<string, unknown> | null;
}) {
  const data = isRecord(job.data) ? job.data : null;
  return (
    job.appId ??
    stringField(job.params, "bookId") ??
    stringField(job.params, "bookLibraryId") ??
    stringField(job.params, "appId") ??
    stringField(data, "bookId") ??
    stringField(data, "bookLibraryId") ??
    stringField(data, "appId")
  );
}

function getJobProgress(event: ShellJobEvent): number {
  if (event.type !== "job_update") return 0;
  const job = event.job as Record<string, unknown>;
  const data = isRecord(job.data) ? job.data : null;
  const rich = isRecord(data?.progress) ? data.progress : null;
  const current = numberField(rich, "current");
  const total = numberField(rich, "total");
  const progress = typeof job.progress === "number" ? job.progress : 0;
  const pct =
    current !== null && total !== null && total > 0
      ? Math.round((current / total) * 100)
      : progress;
  return Math.max(0, Math.min(100, pct));
}

export function useLibraryItemProgress(
  libraries: BookContainerOutput[] | undefined,
): Record<string, BookLibraryProgressState> {
  const queryClient = useQueryClient();
  const [activeIds, setActiveIds] = useState<Set<string>>(new Set());
  const [progressPct, setProgressPct] = useState<Record<string, number>>({});

  const librariesRef = useRef<Set<string>>(new Set());
  const pendingByLibraryRef = useRef(new Map<string, Set<string>>());
  const entityRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    librariesRef.current = new Set((libraries ?? []).map((l) => l.id));
  }, [libraries]);

  useEffect(() => {
    if (!libraries) return;
    const syncing = libraries
      .filter((l) => l.syncStatus === "syncing")
      .map((l) => l.id);
    if (syncing.length === 0) return;
    setActiveIds((prev) => {
      const next = new Set(prev);
      for (const id of syncing) next.add(id);
      return next.size === prev.size ? prev : next;
    });
    setProgressPct((prev) => {
      const next = { ...prev };
      for (const id of syncing) next[id] ??= 0;
      return next;
    });
  }, [libraries]);

  useEffect(
    () => () => {
      if (entityRefreshTimerRef.current) {
        clearTimeout(entityRefreshTimerRef.current);
        entityRefreshTimerRef.current = null;
      }
    },
    [],
  );

  const refreshContent = useCallback(() => {
    bookApi.listItems.invalidate(queryClient);
    bookApi.list.invalidate(queryClient);
  }, [queryClient]);

  const scheduleEntityRefresh = useCallback(() => {
    if (entityRefreshTimerRef.current) return;
    entityRefreshTimerRef.current = setTimeout(() => {
      entityRefreshTimerRef.current = null;
      refreshContent();
    }, 800);
  }, [refreshContent]);

  const handleJobEvent = useCallback(
    (event: ShellJobEvent) => {
      if (event.type !== "job_update") return;
      const job = event.job as {
        id: string;
        status: string;
        appId: string | null;
        params: Record<string, unknown>;
        data?: Record<string, unknown> | null;
        progress: number;
      };
      const libraryId = extractBookLibraryId(job);
      if (!libraryId || !librariesRef.current.has(libraryId)) return;

      const jobId = job.id;
      const status = job.status;
      if (
        status === "completed" ||
        status === "partially_completed" ||
        status === "failed" ||
        status === "cancelled"
      ) {
        const pendingJobs = pendingByLibraryRef.current.get(libraryId);
        if (pendingJobs) {
          const wasNonEmpty = pendingJobs.size > 0;
          pendingJobs.delete(jobId);
          if (wasNonEmpty && pendingJobs.size === 0) {
            refreshContent();
            pendingByLibraryRef.current.delete(libraryId);
          }
        } else {
          refreshContent();
        }

        setProgressPct((prev) => {
          const next = { ...prev };
          if (status === "completed") {
            next[libraryId] = 100;
          } else {
            delete next[libraryId];
          }
          return next;
        });
        setActiveIds((prev) => {
          const next = new Set(prev);
          next.delete(libraryId);
          return next.size === prev.size ? prev : next;
        });
        return;
      }

      if (status === "pending" || status === "running") {
        let pendingJobs = pendingByLibraryRef.current.get(libraryId);
        if (!pendingJobs) {
          pendingJobs = new Set();
          pendingByLibraryRef.current.set(libraryId, pendingJobs);
        }
        pendingJobs.add(jobId);
      }

      const pct = getJobProgress(event);
      setProgressPct((prev) => ({ ...prev, [libraryId]: pct }));
      setActiveIds((prev) => {
        if (prev.has(libraryId)) return prev;
        const next = new Set(prev);
        next.add(libraryId);
        return next;
      });
    },
    [refreshContent],
  );

  const handleEntityEvent = useCallback(
    (event: AppEntityEvent) => {
      const scope = event.scope ?? "";
      const libraryId = scope.startsWith("library:")
        ? scope.slice("library:".length)
        : null;
      if (!libraryId || !librariesRef.current.has(libraryId)) return;
      scheduleEntityRefresh();
    },
    [scheduleEntityRefresh],
  );

  useJobEvents({
    jobTypes: [...BOOK_SCAN_JOB_TYPES],
    enabled: (libraries ?? []).length > 0,
    onEvent: handleJobEvent,
  });

  useAppEntityEvents({
    appId: "book",
    kind: "book_item",
    onEvent: handleEntityEvent,
  });

  const result: Record<string, BookLibraryProgressState> = {};
  for (const id of activeIds) {
    result[id] = { isActive: true, pct: progressPct[id] ?? 0 };
  }
  return result;
}
