import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookPlus, Loader2, RefreshCw, Upload } from 'lucide-react';
import { PdfReaderModal } from './components/PdfReaderModal.tsx';
import { UploadPdfModal, type UploadPreset } from './components/UploadPdfModal.tsx';
import type { VaultBook } from './types.ts';
import { formatBytes } from './utils/format.ts';

type ShelfFilter = 'all' | 'classics' | 'infobooks' | 'ebooks' | 'personal';

const FILTER_TABS: Array<{ id: ShelfFilter; label: string }> = [
  { id: 'all', label: 'All Books' },
  { id: 'classics', label: 'Classics' },
  { id: 'infobooks', label: 'InfoBooks' },
  { id: 'ebooks', label: 'Swing-Trade' },
  { id: 'personal', label: 'Personal' },
];

const CLOTH_PALETTES = [
  { bg: 'bg-[#1f4d36]', accent: 'border-[#d6b36a]/55', text: 'text-[#f6efe0]' },
  { bg: 'bg-[#6c2727]', accent: 'border-[#e6c280]/55', text: 'text-[#fbf4e8]' },
  { bg: 'bg-[#22324d]', accent: 'border-[#d4af68]/55', text: 'text-[#f2f4f8]' },
  { bg: 'bg-[#6b4226]', accent: 'border-[#edd19c]/55', text: 'text-[#fcf5ea]' },
  { bg: 'bg-[#3d314a]', accent: 'border-[#dec389]/55', text: 'text-[#f6f1fa]' },
  { bg: 'bg-[#2a4a4e]', accent: 'border-[#e0c07d]/55', text: 'text-[#eef6f6]' },
  { bg: 'bg-[#4f3829]', accent: 'border-[#e4c486]/55', text: 'text-[#faf2e6]' },
];

interface VaultResponsePayload {
  items: VaultBook[];
  totalBytes: number;
  syncing?: boolean;
  syncProgress?: { completed: number; total: number };
}

export default function App() {
  const [books, setBooks] = useState<VaultBook[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ completed: number; total: number }>({
    completed: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ShelfFilter>('all');

  const [activeBook, setActiveBook] = useState<VaultBook | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadPreset, setUploadPreset] = useState<UploadPreset | null>(null);

  const loadBooks = useCallback(async () => {
    try {
      const res = await fetch('/api/vault');
      if (!res.ok) {
        throw new Error('Could not load stored books.');
      }
      const data = (await res.json()) as VaultResponsePayload;
      const sorted = [...data.items].sort((a, b) => {
        const rank = (item: VaultBook) =>
          item.sourceType === 'archive'
            ? 0
            : item.sourceType === 'upload'
              ? 1
              : item.sourceType === 'infobooks'
                ? 2
                : 3;
        const diff = rank(a) - rank(b);
        if (diff !== 0) return diff;
        return a.title.localeCompare(b.title);
      });
      setBooks(sorted);
      setTotalBytes(data.totalBytes);
      setSyncing(Boolean(data.syncing));
      if (data.syncProgress) {
        setSyncProgress(data.syncProgress);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load books.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    if (!syncing) return;
    const timer = window.setInterval(() => {
      void loadBooks();
    }, 1800);
    return () => window.clearInterval(timer);
  }, [syncing, loadBooks]);

  async function handleSyncMissing() {
    setSyncing(true);
    try {
      await fetch('/api/vault/sync', { method: 'POST' });
      await loadBooks();
    } catch {
      setSyncing(false);
    }
  }

  const hasOneUp = useMemo(
    () => books.some((b) => b.bookKey === 'one-up-on-wall-street'),
    [books]
  );

  const visibleBooks = useMemo(() => {
    if (filter === 'all') return books;
    if (filter === 'classics') {
      return books.filter(
        (b) => b.sourceType === 'archive' || b.bookKey === 'one-up-on-wall-street'
      );
    }
    if (filter === 'ebooks') {
      return books.filter((b) => b.sourceType === 'ebook_collection');
    }
    if (filter === 'infobooks') {
      return books.filter((b) => b.sourceType === 'infobooks');
    }
    return books.filter((b) => b.sourceType === 'upload');
  }, [books, filter]);

  const counts = useMemo<Record<ShelfFilter, number>>(
    () => ({
      all: books.length,
      classics: books.filter(
        (b) => b.sourceType === 'archive' || b.bookKey === 'one-up-on-wall-street'
      ).length,
      ebooks: books.filter((b) => b.sourceType === 'ebook_collection').length,
      infobooks: books.filter((b) => b.sourceType === 'infobooks').length,
      personal: books.filter((b) => b.sourceType === 'upload').length,
    }),
    [books]
  );

  const missingCuratedBooks = counts.infobooks < 15 || counts.ebooks < 13 || counts.classics < 2;

  async function handleDeleteBook(book: VaultBook) {
    const res = await fetch(`/api/vault/${encodeURIComponent(book.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Could not remove book.');
    }
    setActiveBook(null);
    await loadBooks();
  }

  return (
    <div className="denim-canvas flex flex-col">
      <header className="sticky top-0 z-30 bg-[#152c47]/90 backdrop-blur-md border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <a
            href="#top"
            className="font-serif text-lg sm:text-xl font-semibold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Books in Pockets
          </a>

          <nav
            aria-label="Book shelf filters"
            className="hidden lg:flex items-center gap-5 text-sm font-medium"
          >
            {FILTER_TABS.map((tab) => {
              const active = filter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilter(tab.id)}
                  className={`transition-colors whitespace-nowrap shrink-0 pb-0.5 tabular-nums ${
                    active
                      ? 'text-[#f3c677] border-b border-[#f3c677]'
                      : 'text-white/80 hover:text-white'
                  }`}
                >
                  {tab.label} ({counts[tab.id]})
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            {missingCuratedBooks && !syncing ? (
              <button
                type="button"
                onClick={() => void handleSyncMissing()}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-white/10 border border-white/15 rounded-md hover:bg-white/20 transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Sync Books
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => {
                setUploadPreset(null);
                setUploadOpen(true);
              }}
              className="inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 text-xs font-medium text-[#1A1816] bg-[#f3c677] rounded-md hover:bg-[#f7d392] transition-colors whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              Upload Book PDF
            </button>
          </div>
        </div>
      </header>

      <main id="top" className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-8 pb-2 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <h1 className="font-serif text-3xl sm:text-4xl font-medium tracking-tight text-white [text-wrap:balance]">
                Your Stored Book Collection
              </h1>
              <p className="mt-1.5 text-sm text-white/80 font-mono tabular-nums">
                {visibleBooks.length} {visibleBooks.length === 1 ? 'Book' : 'Books'} Ready to Read
                <span aria-hidden="true"> · </span>
                {formatBytes(totalBytes)} Stored Locally
              </p>
            </div>

            {syncing ? (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-[#102238]/85 border border-[#f3c677]/40 text-xs text-[#f3c677] font-mono tabular-nums self-start sm:self-auto">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>
                  Syncing books
                  {syncProgress.total > 0
                    ? ` (${syncProgress.completed}/${syncProgress.total})`
                    : '...'}
                </span>
              </div>
            ) : null}
          </div>

          <div
            aria-label="Mobile and tablet shelf filters"
            className="flex lg:hidden flex-wrap items-center gap-1.5 p-1.5 bg-[#102238]/75 rounded-md border border-white/10"
          >
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded whitespace-nowrap tabular-nums transition-colors ${
                  filter === tab.id
                    ? 'bg-[#f3c677] text-[#1A1816]'
                    : 'text-white/80 hover:text-white'
                }`}
              >
                {tab.label} ({counts[tab.id]})
              </button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="max-w-3xl mx-auto px-6 mt-6">
            <div
              role="alert"
              className="px-4 py-3 bg-[#7f1d1d]/80 border border-white/20 rounded-md text-sm text-white"
            >
              {error}
            </div>
          </div>
        ) : null}

        {loading ? (
          <div className="max-w-7xl mx-auto px-6 py-24 text-center text-sm text-white/75">
            Pulling your books from the vault...
          </div>
        ) : (
          <ul className="pocket-grid" aria-label="Stored books in jean pockets">
            {visibleBooks.map((book, idx) => {
              const palette = CLOTH_PALETTES[idx % CLOTH_PALETTES.length];
              const sourceLabel =
                book.sourceType === 'infobooks'
                  ? 'InfoBooks'
                  : book.sourceType === 'ebook_collection'
                    ? 'Swing-Trade'
                    : book.sourceType === 'archive'
                      ? 'Archive'
                      : 'Personal';
              return (
                <li key={book.id} className="jean-pocket group">
                  <button
                    type="button"
                    onClick={() => setActiveBook(book)}
                    aria-label={`Open ${book.title} by ${book.author}`}
                    className="w-full h-full relative block text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3c677] rounded-sm cursor-pointer"
                  >
                    <div className={`pocket-book ${palette.bg}`}>
                      {book.coverPath ? (
                        <div className="relative w-full h-full">
                          <img
                            src={book.coverPath}
                            alt={book.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 via-black/45 to-transparent px-2.5 pt-2 pb-5">
                            <p className="font-serif text-[11px] sm:text-xs font-medium leading-tight text-white line-clamp-2">
                              {book.title}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`w-full h-full p-2.5 sm:p-3 flex flex-col justify-between ${palette.text}`}
                        >
                          <div className={`border ${palette.accent} rounded-[2px] p-2 h-[68%] flex flex-col justify-between`}>
                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[8px] font-mono uppercase tracking-wider text-[#f3c677] truncate">
                                {sourceLabel}
                              </span>
                              <span className="text-[8px] font-mono tabular-nums opacity-70 shrink-0">
                                {formatBytes(book.sizeBytes)}
                              </span>
                            </div>
                            <p className="font-serif text-[11px] sm:text-xs font-semibold leading-snug line-clamp-3">
                              {book.title}
                            </p>
                            <span className="text-[9px] font-mono opacity-80 truncate">
                              {book.author}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  </button>

                  <p className="mt-2 px-1 text-center text-xs font-medium text-white/95 leading-snug line-clamp-2 drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]">
                    {book.title}
                  </p>
                  <p className="mt-0.5 text-center text-[10px] font-mono text-[#f3c677]/85">
                    {sourceLabel}
                  </p>
                </li>
              );
            })}

            {!hasOneUp && (filter === 'all' || filter === 'classics' || filter === 'personal') ? (
              <li className="jean-pocket group">
                <button
                  type="button"
                  onClick={() => {
                    setUploadPreset({
                      bookKey: 'one-up-on-wall-street',
                      title: 'One Up on Wall Street',
                      author: 'Peter Lynch & John Rothchild',
                      year: 1989,
                      coverPath: '/src/assets/images/cover_one_up_wall_street_1795617501444.jpg',
                    });
                    setUploadOpen(true);
                  }}
                  aria-label="Upload PDF for One Up on Wall Street"
                  className="w-full h-full relative block text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f3c677] rounded-sm cursor-pointer"
                >
                  <div className="pocket-book bg-[#163827] border border-dashed border-[#f3c677]/70 flex flex-col items-center justify-start pt-4 px-2 text-center text-[#f6efe0]">
                    <BookPlus className="w-5 h-5 text-[#f3c677] mb-1.5" strokeWidth={1.6} />
                    <p className="font-serif text-[11px] font-medium leading-tight">
                      One Up on Wall Street
                    </p>
                    <p className="mt-1 text-[10px] font-mono text-[#f3c677]">
                      Insert PDF
                    </p>
                  </div>
                </button>
                <p className="mt-2 px-1 text-center text-xs font-medium text-[#f3c677] leading-snug drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                  One Up on Wall Street (Add PDF)
                </p>
              </li>
            ) : null}
          </ul>
        )}
      </main>

      <PdfReaderModal
        book={activeBook}
        onClose={() => setActiveBook(null)}
        onUpdate={(updated) => {
          setActiveBook(updated);
          void loadBooks();
        }}
        onDelete={handleDeleteBook}
      />

      <UploadPdfModal
        open={uploadOpen}
        preset={uploadPreset}
        onClose={() => setUploadOpen(false)}
        onUploaded={(item) => {
          setActiveBook(item);
          void loadBooks();
        }}
      />
    </div>
  );
}
