import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWindowManager } from "../../contexts/WindowManagerContext";

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
  const { openWindow } = useWindowManager();

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount
  useEffect(() => {
    if (novelId && chapterId) {
      openWindow({
        filePath: `novel://${novelId}/${chapterId}`,
        fileName: "小说",
        fileSystemId: "",
        type: "novel",
        novelId,
        chapterId,
      });
    }
    navigate(`/dashboard/library/${id}/novel/${novelId}`, { replace: true });
  }, []);

  return null;
}
