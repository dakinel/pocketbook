import { useEffect, useState } from 'react';
import { Check, NotebookPen, Trash2, X } from 'lucide-react';
import type { ReadingStatus, VaultBook } from '../types.ts';
import { FlipBookReader, type PocketOriginRect } from './FlipBookReader.tsx';

interface PdfReaderModalProps {
  book: VaultBook | null;
  originRect: PocketOriginRect | null;
  onClose: () => void;
  onUpdate: (updated: VaultBook) => void;
  onDelete?: (book: VaultBook) => Promise<void>;
}

const STATUS_OPTIONS: Array<{ value: ReadingStatus; label: string }> = [
  { value: 'unread', label: 'Unread' },
  { value: 'reading', label: 'Reading' },
  { value: 'completed', label: 'Completed' },
];

export function PdfReaderModal({
  book,
  originRect,
  onClose,
  onUpdate,
  onDelete,
}: PdfReaderModalProps) {
  const [notes, setNotes] = useState('');
  const [readingStatus, setReadingStatus] = useState<ReadingStatus>('unread');
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [backdropVisible, setBackdropVisible] = useState(false);

  useEffect(() => {
    if (book) {
      setNotes(book.notes || '');
      setReadingStatus(book.readingStatus || 'unread');
      setShowNotes(false);
      setSavedNotice(false);
      setConfirmRemove(false);
      setRemoving(false);
      setError(null);
      setClosing(false);
      setBackdropVisible(false);
      const raf = window.requestAnimationFrame(() => {
        setBackdropVisible(true);
      });
      return () => window.cancelAnimationFrame(raf);
    }
  }, [book]);

  function requestClose() {
    if (closing) return;
    setClosing(true);
    setBackdropVisible(false);
    window.setTimeout(() => {
      onClose();
    }, 240);
  }

  useEffect(() => {
    if (!book) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showNotes) {
          setShowNotes(false);
        } else {
          requestClose();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  if (!book) return null;

  async function handleSave(nextStatus?: ReadingStatus) {
    if (!book) return;
    setSaving(true);
    setError(null);
    setSavedNotice(false);
    try {
      const res = await fetch(`/api/vault/${encodeURIComponent(book.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes,
          readingStatus: nextStatus ?? readingStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not save notes.');
      }
      onUpdate(data.item);
      setSavedNotice(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!book || !onDelete) return;
    setRemoving(true);
    setError(null);
    try {
      await onDelete(book);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove book.');
      setRemoving(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 transition-all duration-500 ${
        backdropVisible ? 'bg-black/84 backdrop-blur-lg opacity-100' : 'bg-black/0 opacity-0'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={book.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          requestClose();
        }
      }}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 transition-opacity duration-700 ${
          backdropVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background:
            'radial-gradient(ellipse 60% 56% at 50% 48%, rgba(243, 198, 119, 0.11), transparent 70%)',
        }}
      />
      <div className="fixed top-4 right-4 sm:top-5 sm:right-6 z-30 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowNotes((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border backdrop-blur-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            showNotes
              ? 'bg-[#f3c677] text-[#1A1816] border-[#f3c677]'
              : 'bg-black/45 text-white border-white/15 hover:bg-black/70'
          }`}
        >
          <NotebookPen className="w-3.5 h-3.5" />
          Notes
        </button>

        <button
          type="button"
          onClick={requestClose}
          aria-label="Close book"
          className="p-2 text-white/75 hover:text-white rounded-md bg-black/45 border border-white/15 hover:bg-black/70 backdrop-blur-md transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        className="w-full h-full flex items-center justify-center pointer-events-none"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            requestClose();
          }
        }}
      >
        <div className="pointer-events-auto w-full flex flex-col items-center justify-center">
          <FlipBookReader book={book} originRect={originRect} closing={closing} />
        </div>
      </div>

      {showNotes ? (
        <aside
          className="fixed top-16 right-4 sm:right-6 bottom-6 z-40 w-[min(92vw,360px)] flex flex-col bg-[#F8F6F1] text-[#1A1816] border border-[#DFD9CE] rounded-lg p-5 shadow-2xl overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pb-3 border-b border-[#E7E2D8]">
            <h2 className="font-serif text-base font-medium text-[#1A1816] line-clamp-1">
              {book.title}
            </h2>
            <p className="text-xs text-[#57534E] mt-0.5 truncate">{book.author}</p>
          </div>

          <div className="mt-4">
            <span className="text-xs font-medium text-[#57534E]">Reading Progress</span>
            <div className="mt-2 grid grid-cols-3 gap-1 p-1 bg-[#EDE8DD] rounded-md border border-[#DFD9CE]">
              {STATUS_OPTIONS.map((opt) => {
                const active = readingStatus === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setReadingStatus(opt.value);
                      void handleSave(opt.value);
                    }}
                    className={`px-2 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white text-[#1A1816] border border-[#DFD9CE]'
                        : 'text-[#57534E] hover:text-[#1A1816]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex-1 flex flex-col">
            <label
              htmlFor="vault-book-notes"
              className="text-xs font-medium text-[#57534E]"
            >
              Personal Study Notes &amp; Key Takeaways
            </label>
            <textarea
              id="vault-book-notes"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setSavedNotice(false);
              }}
              placeholder="Record page citations, investing principles, or chapter summaries..."
              className="mt-2 flex-1 min-h-[200px] w-full resize-none rounded-md border border-[#DFD9CE] bg-white p-3 text-sm leading-relaxed text-[#1A1816] placeholder:text-[#A8A29E] focus:outline-none focus:border-[#14532D]"
            />
          </div>

          {error ? (
            <p className="mt-3 text-xs text-[#991B1B]" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-3 pt-4 border-t border-[#E7E2D8]">
            <div className="text-xs text-[#57534E]">
              {savedNotice ? (
                <span className="inline-flex items-center gap-1 text-[#14532D] font-medium">
                  <Check className="w-3.5 h-3.5" />
                  Notes saved
                </span>
              ) : onDelete ? (
                confirmRemove ? (
                  <span className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      disabled={removing}
                      onClick={() => void handleDelete()}
                      className="text-xs font-medium text-[#991B1B] underline underline-offset-2"
                    >
                      {removing ? 'Removing...' : 'Confirm remove'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(false)}
                      className="text-xs text-[#57534E]"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    className="inline-flex items-center gap-1 text-xs text-[#78716C] hover:text-[#991B1B] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                )
              ) : null}
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="px-4 py-2 text-xs font-medium text-white bg-[#14532D] rounded-md hover:bg-[#166534] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {saving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
