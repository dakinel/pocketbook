import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { FloatingBooksBackground } from './components/FloatingBooksBackground.tsx';
import { PdfCoverImage } from './components/PdfCoverImage.tsx';
import { PdfReaderModal } from './components/PdfReaderModal.tsx';
import { getBookKeptPage } from './utils/bookProgress.ts';
import { observeElementVisibility } from './utils/viewportObserver.ts';
import type { VaultBook } from './types.ts';

const DEPTH_PLANES = [1, 3, 2, 4, 2, 1, 4, 3] as const;

interface VaultResponsePayload {
  items: VaultBook[];
  totalBytes: number;
}

interface FloatingBookSlotProps {
  book: VaultBook;
  depth: number;
  priority: boolean;
  onSelect: (book: VaultBook, buttonEl: HTMLButtonElement) => void;
}

function FloatingBookSlot({ book, depth, priority, onSelect }: FloatingBookSlotProps) {
  const slotRef = useRef<HTMLLIElement>(null);
  const [inView, setInView] = useState(priority);

  useEffect(() => {
    const node = slotRef.current;
    if (!node) return;
    return observeElementVisibility(node, setInView);
  }, []);

  const keptPage = getBookKeptPage(book);
  const labelText = keptPage
    ? `${book.title} — ${book.author} (Kept at Page ${keptPage})`
    : `${book.title} — ${book.author}`;

  return (
    <li
      ref={slotRef}
      data-depth={depth}
      data-inview={inView ? 'true' : 'false'}
      className="air-book-slot"
    >
      <div className="air-book-float">
        <button
          type="button"
          title={labelText}
          onClick={(e) => onSelect(book, e.currentTarget)}
          aria-label={`Open ${labelText}`}
          className="air-book-hit focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a6064] rounded-md"
        >
          <div className="air-book-body">
            <span className="air-book-shadow-plane" aria-hidden="true" />
            <span className="air-book-back" aria-hidden="true" />
            <span className="air-book-spine" aria-hidden="true" />
            <span className="air-book-pages" aria-hidden="true" />
            <span className="air-book-top" aria-hidden="true" />
            <span className="air-book-bottom" aria-hidden="true" />
            {keptPage !== null ? (
              <span className="air-book-keeper" aria-hidden="true">
                <span className="air-book-keeper-label">p.{keptPage}</span>
              </span>
            ) : null}
            <div className="air-book-cover">
              <PdfCoverImage
                bookId={book.id}
                sizeBytes={book.sizeBytes}
                title={book.title}
                coverPath={book.coverPath}
                priority={priority}
                inView={inView}
              />
            </div>
          </div>
        </button>
      </div>
    </li>
  );
}

export default function App() {
  const [books, setBooks] = useState<VaultBook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeBook, setActiveBook] = useState<VaultBook | null>(null);
  const [originRect, setOriginRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const loadBooks = useCallback(async () => {
    try {
      const res = await fetch('/api/vault');
      if (!res.ok) {
        throw new Error('Could not load stored books.');
      }
      const data = (await res.json()) as VaultResponsePayload;
      const sorted = [...data.items].sort((a, b) => a.title.localeCompare(b.title));
      setBooks(sorted);
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
    <>
      <FloatingBooksBackground />

      <div className="relative z-10 min-h-screen flex flex-col">
        <main className="flex-1">
          {error ? (
            <div className="max-w-xl mx-auto px-4 pt-6">
              <div
                role="alert"
                className="px-4 py-3 bg-[#fef2f2]/95 border border-[#991b1b]/25 rounded-md text-sm text-[#7f1d1d]"
              >
                {error}
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="min-h-screen flex items-center justify-center px-6">
              <Loader2 className="w-6 h-6 text-[#7fd4cb] animate-spin" aria-label="Loading books" />
            </div>
          ) : (
            <ul className="air-books-stage" aria-label="Floating 3D books library">
              {books.map((book, idx) => (
                <FloatingBookSlot
                  key={book.id}
                  book={book}
                  depth={DEPTH_PLANES[idx % DEPTH_PLANES.length]}
                  priority={idx < 12}
                  onSelect={(selected, buttonEl) => {
                    const coverNode = buttonEl.querySelector('.air-book-cover');
                    const rect = (coverNode || buttonEl).getBoundingClientRect();
                    setOriginRect({
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height,
                    });
                    setActiveBook(selected);
                  }}
                />
              ))}
            </ul>
          )}
        </main>

        <PdfReaderModal
          book={activeBook}
          originRect={originRect}
          onClose={() => {
            setActiveBook(null);
            setOriginRect(null);
          }}
          onUpdate={(updated) => {
            setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
            setActiveBook((prev) => (prev && prev.id === updated.id ? updated : prev));
          }}
          onDelete={handleDeleteBook}
        />
      </div>
    </>
  );
}
