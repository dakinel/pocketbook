import type { ReadingStatus, VaultBook } from '../types.ts';

export interface BookProgressState {
  lastPage: number;
  totalPages: number | null;
  bookmarkedPage: number | null;
  readingStatus: ReadingStatus;
  updatedAt: string;
}

const STORAGE_PREFIX = 'folio-bookkeeper-v1:';

export function readLocalBookProgress(bookId: string): BookProgressState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${bookId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BookProgressState>;
    if (!parsed || typeof parsed !== 'object') return null;
    const lastPage =
      typeof parsed.lastPage === 'number' && Number.isFinite(parsed.lastPage) && parsed.lastPage >= 1
        ? Math.floor(parsed.lastPage)
        : 1;
    const totalPages =
      typeof parsed.totalPages === 'number' && Number.isFinite(parsed.totalPages) && parsed.totalPages >= 1
        ? Math.floor(parsed.totalPages)
        : null;
    const bookmarkedPage =
      typeof parsed.bookmarkedPage === 'number' &&
      Number.isFinite(parsed.bookmarkedPage) &&
      parsed.bookmarkedPage >= 1
        ? Math.floor(parsed.bookmarkedPage)
        : null;
    const readingStatus: ReadingStatus =
      parsed.readingStatus === 'reading' ||
      parsed.readingStatus === 'completed' ||
      parsed.readingStatus === 'unread'
        ? parsed.readingStatus
        : 'unread';
    return {
      lastPage,
      totalPages,
      bookmarkedPage,
      readingStatus,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}

export function saveLocalBookProgress(bookId: string, state: BookProgressState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${bookId}`, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function resolveBookProgress(book: VaultBook): BookProgressState {
  const local = readLocalBookProgress(book.id);
  const serverLastPage =
    typeof book.lastPage === 'number' && Number.isFinite(book.lastPage) && book.lastPage >= 1
      ? Math.floor(book.lastPage)
      : 1;
  const serverBookmark =
    typeof book.bookmarkedPage === 'number' &&
    Number.isFinite(book.bookmarkedPage) &&
    book.bookmarkedPage >= 1
      ? Math.floor(book.bookmarkedPage)
      : null;
  const serverTotal =
    typeof book.totalPages === 'number' && Number.isFinite(book.totalPages) && book.totalPages >= 1
      ? Math.floor(book.totalPages)
      : null;
  const serverUpdatedAt = typeof book.lastReadAt === 'string' ? book.lastReadAt : '';

  if (local) {
    const localTime = Date.parse(local.updatedAt || '');
    const serverTime = Date.parse(serverUpdatedAt || '');
    if (
      !Number.isNaN(localTime) &&
      (Number.isNaN(serverTime) || localTime >= serverTime)
    ) {
      return local;
    }
  }

  return {
    lastPage: serverLastPage,
    totalPages: serverTotal,
    bookmarkedPage: serverBookmark,
    readingStatus: book.readingStatus || 'unread',
    updatedAt: serverUpdatedAt,
  };
}

export function getKeptPage(progress: BookProgressState): number | null {
  if (progress.bookmarkedPage && progress.bookmarkedPage >= 1) {
    return progress.bookmarkedPage;
  }
  if (progress.lastPage >= 2) {
    return progress.lastPage;
  }
  return null;
}

export function getBookKeptPage(book: VaultBook): number | null {
  return getKeptPage(resolveBookProgress(book));
}
