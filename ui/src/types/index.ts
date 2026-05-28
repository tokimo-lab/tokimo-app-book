// Types mirroring the Rust-generated types for the Book app.
// Kept minimal — only the fields the UI actually renders.

export interface BookContainerOutput {
  id: string;
  name: string;
  type?: string;
  avatar: unknown;
  description?: string | null;
  itemCount: number;
  syncStatus: string | null;
  sources?: StorageBinding[];
  rootPath?: string | null;
  sourceId?: string | null;
  sourceType?: string | null;
}

export interface StorageBinding {
  sourceId: string;
  rootPath: string;
  sortOrder?: number;
  isDefaultDownload?: boolean;
}

export interface BookOutput {
  id: string;
  title: string;
  author: string | null;
  coverPath: string | null;
  serialStatus: string | null;
  chapterCount: number | null;
  wordCount: number | null;
  scrapedAt: string | null;
}

export interface BookChapterOutput {
  id: string;
  chapterNumber: number;
  title: string | null;
  wordCount: number | null;
}

export interface BookVolumeOutput {
  id: string;
  volumeNumber: number;
  title: string | null;
  chapterCount: number | null;
  wordCount: number | null;
  chapters: BookChapterOutput[];
}

export interface BookFileOutput {
  id: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
}

export interface BookDetailOutput {
  id: string;
  title: string;
  originalTitle: string | null;
  author: string | null;
  coverPath: string | null;
  overview: string | null;
  year: number | null;
  serialStatus: string | null;
  wordCount: number | null;
  totalChapters: number;
  volumes: BookVolumeOutput[];
  orphanChapters: BookChapterOutput[];
  files: BookFileOutput[];
  publisher: string | null;
  sourceProvider: string | null;
  scrapedAt: string | null;
  isFavorite: boolean;
  doubanRating: number | null;
  bangumiRating: number | null;
}

export interface BookProviderOutput {
  id: string;
  name: string;
  description: string | null;
}

export interface BookSearchResultOutput {
  site: string;
  bookId: string;
  title: string;
  author: string;
  latestChapter: string;
  updateDate: string;
  wordCount: string;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface VfsDto {
  id: string;
  name: string;
  type: string;
}
