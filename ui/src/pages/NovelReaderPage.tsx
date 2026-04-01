import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWindowActions } from "@/system";

/**
 * NovelReaderPage — legacy route redirect.
 *
 * The novel reader now lives in a floating window. If someone navigates
 * to the old reader URL, open the window and redirect to the detail page.
 */
export default function NovelReaderPage() {
  const { id, novelId, chapterId } = useParams<{
    id: string;
    novelId: string;
    chapterId?: string;
  }>();
  const navigate = useNavigate();
  const { openWindow } = useWindowActions();

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    if (novelId && chapterId) {
      openWindow({
        type: "novel",
        title: "小说",
        route: `/chapters/${chapterId}`,
        novelId,
        chapterId,
      });
    }
    navigate(`/dashboard/app/${id}/novel/${novelId}`, { replace: true });
  }, []);

  return null;
}
