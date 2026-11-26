import type { CSSProperties } from 'react';
import type { BookKeeperColor, ReadingStatus, VaultBook } from '../types.ts';

export interface BookKeeperPaletteEntry {
  id: BookKeeperColor;
  label: string;
  edge: string;
  hi: string;
  mid: string;
  sheen: string;
  text: string;
  swatch: string;
  buttonBg: string;
  buttonHover: string;
  buttonBorder: string;
  buttonMutedText: string;
  jumpBg: string;
  jumpHover: string;
  jumpText: string;
  glow: string;
}

export const BOOK_KEEPER_PALETTE: Record<BookKeeperColor, BookKeeperPaletteEntry> = {
  crimson: {
    id: 'crimson',
    label: 'Crimson Silk',
    edge: '#7f1d1d',
    hi: '#dc2626',
    mid: '#b91c1c',
    sheen: 'rgba(255, 220, 220, 0.35)',
    text: '#fff5f5',
    swatch: '#dc2626',
    buttonBg: '#b91c1c',
    buttonHover: '#dc2626',
    buttonBorder: 'rgba(252, 165, 165, 0.42)',
    buttonMutedText: '#fca5a5',
    jumpBg: 'rgba(127, 29, 29, 0.78)',
    jumpHover: '#991b1b',
    jumpText: '#fecaca',
    glow: '0 6px 18px rgba(185, 28, 28, 0.45)',
  },
  emerald: {
    id: 'emerald',
    label: 'Emerald Silk',
    edge: '#064e3b',
    hi: '#10b981',
    mid: '#059669',
    sheen: 'rgba(209, 250, 229, 0.36)',
    text: '#ecfdf5',
    swatch: '#10b981',
    buttonBg: '#059669',
    buttonHover: '#10b981',
    buttonBorder: 'rgba(110, 231, 183, 0.44)',
    buttonMutedText: '#6ee7b7',
    jumpBg: 'rgba(6, 78, 59, 0.78)',
    jumpHover: '#065f46',
    jumpText: '#a7f3d0',
    glow: '0 6px 18px rgba(5, 150, 105, 0.42)',
  },
  sapphire: {
    id: 'sapphire',
    label: 'Sapphire Silk',
    edge: '#1e3a8a',
    hi: '#3b82f6',
    mid: '#1d4ed8',
    sheen: 'rgba(219, 234, 254, 0.38)',
    text: '#eff6ff',
    swatch: '#3b82f6',
    buttonBg: '#1d4ed8',
    buttonHover: '#2563eb',
    buttonBorder: 'rgba(147, 197, 253, 0.44)',
    buttonMutedText: '#93c5fd',
    jumpBg: 'rgba(30, 58, 138, 0.78)',
    jumpHover: '#1e40af',
    jumpText: '#bfdbfe',
    glow: '0 6px 18px rgba(29, 78, 216, 0.45)',
  },
  amber: {
    id: 'amber',
    label: 'Saffron Gold',
    edge: '#78350f',
    hi: '#f59e0b',
    mid: '#d97706',
    sheen: 'rgba(254, 243, 199, 0.42)',
    text: '#fffbeb',
    swatch: '#f59e0b',
    buttonBg: '#d97706',
    buttonHover: '#f59e0b',
    buttonBorder: 'rgba(252, 211, 77, 0.46)',
    buttonMutedText: '#fcd34d',
    jumpBg: 'rgba(120, 53, 15, 0.78)',
    jumpHover: '#92400e',
    jumpText: '#fde68a',
    glow: '0 6px 18px rgba(217, 119, 6, 0.42)',
  },
  violet: {
    id: 'violet',
    label: 'Royal Plum',
    edge: '#4c1d95',
    hi: '#8b5cf6',
    mid: '#6d28d9',
    sheen: 'rgba(237, 233, 254, 0.38)',
    text: '#f5f3ff',
    swatch: '#8b5cf6',
    buttonBg: '#6d28d9',
    buttonHover: '#7c3aed',
    buttonBorder: 'rgba(196, 181, 253, 0.44)',
    buttonMutedText: '#c4b5fd',
    jumpBg: 'rgba(76, 29, 149, 0.78)',
    jumpHover: '#5b21b6',
    jumpText: '#ddd6fe',
    glow: '0 6px 18px rgba(109, 40, 217, 0.45)',
  },
  teal: {
    id: 'teal',
    label: 'Seafoam Teal',
    edge: '#134e4a',
    hi: '#14b8a6',
    mid: '#0f766e',
    sheen: 'rgba(204, 251, 241, 0.36)',
    text: '#f0fdfa',
    swatch: '#14b8a6',
    buttonBg: '#0f766e',
    buttonHover: '#0d9488',
    buttonBorder: 'rgba(94, 234, 212, 0.42)',
    buttonMutedText: '#5eead4',
    jumpBg: 'rgba(19, 78, 74, 0.78)',
    jumpHover: '#115e59',
    jumpText: '#99f6e4',
    glow: '0 6px 18px rgba(15, 118, 110, 0.44)',
  },
};

export const BOOK_KEEPER_COLORS: BookKeeperColor[] = [
  'crimson',
  'emerald',
  'sapphire',
  'amber',
  'violet',
  'teal',
];

export function isValidBookKeeperColor(val: unknown): val is BookKeeperColor {
  return typeof val === 'string' && val in BOOK_KEEPER_PALETTE;
}

export function getDefaultBookKeeperColor(bookId: string): BookKeeperColor {
  let hash = 2166136261;
  for (let i = 0; i < bookId.length; i++) {
    hash ^= bookId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return BOOK_KEEPER_COLORS[Math.abs(hash) % BOOK_KEEPER_COLORS.length];
}

export function resolveBookKeeperColor(
  bookId: string,
  explicitColor?: BookKeeperColor | null
): BookKeeperColor {
  return isValidBookKeeperColor(explicitColor)
    ? explicitColor
    : getDefaultBookKeeperColor(bookId);
}

export function getBookKeeperRibbonStyle(color: BookKeeperColor): CSSProperties {
  const palette = BOOK_KEEPER_PALETTE[color] || BOOK_KEEPER_PALETTE.crimson;
  return {
    '--keeper-edge': palette.edge,
    '--keeper-hi': palette.hi,
    '--keeper-mid': palette.mid,
    '--keeper-sheen': palette.sheen,
    '--keeper-text': palette.text,
  } as CSSProperties;
}

export interface BookProgressState {
  lastPage: number;
  totalPages: number | null;
  bookmarkedPage: number | null;
  keeperColor: BookKeeperColor | null;
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
    const keeperColor = isValidBookKeeperColor(parsed.keeperColor) ? parsed.keeperColor : null;
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
      keeperColor,
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
  const serverColor = isValidBookKeeperColor(book.keeperColor) ? book.keeperColor : null;
  const serverUpdatedAt = typeof book.lastReadAt === 'string' ? book.lastReadAt : '';

  if (local) {
    const localTime = Date.parse(local.updatedAt || '');
    const serverTime = Date.parse(serverUpdatedAt || '');
    if (
      !Number.isNaN(localTime) &&
      (Number.isNaN(serverTime) || localTime >= serverTime)
    ) {
      return {
        ...local,
        keeperColor: local.keeperColor ?? serverColor,
      };
    }
  }

  return {
    lastPage: serverLastPage,
    totalPages: serverTotal,
    bookmarkedPage: serverBookmark,
    keeperColor: serverColor ?? local?.keeperColor ?? null,
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

export function getBookKeeperColor(book: VaultBook): BookKeeperColor {
  const progress = resolveBookProgress(book);
  return resolveBookKeeperColor(book.id, progress.keeperColor);
}
