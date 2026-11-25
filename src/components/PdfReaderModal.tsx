import { useEffect, useState } from 'react';
import { Check, Download, NotebookPen, Trash2, X } from 'lucide-react';
import type { ReadingStatus, VaultBook } from '../types.ts';
import { formatBytes, formatShortDate } from '../utils/format.ts';
import { FlipBookReader } from './FlipBookReader.tsx';

interface PdfReaderModalProps {
  book: VaultBook | null;
  onClose: () => void;
  onUpdate: (updated: VaultBook) => void;
  onDelete?: (book: VaultBook) => Promise<void>;
}

const STATUS_OPTIONS: Array<{ value: ReadingStatus; label: string }> = [
  { value: 'unread', label: 'Unread' },
  { value: 'reading', label: 'Reading' },
  { value: 'completed', label: 'Completed' },
];

export function PdfReaderModal({ book, onClose, onUpdate, onDelete }: PdfReaderModalProps) {
  const [notes, setNotes] = useState('');
  const [readingStatus, setReadingStatus] = useState<ReadingStatus>('unread');
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (book) {
      setNotes(book.notes || '');
      setReadingStatus(book.readingStatus || 'unread');
      setSavedNotice(false);
      setConfirmRemove(false);
      setRemoving(false);
      setError(null);
    }
  }, [book]);

  useEffect(() => {
    if (!book) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [book, onClose]);

  if (!book) return null;

  const pdfDownloadUrl = `/api/vault/${encodeURIComponent(book.id)}/file?download=1`;

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#091524]/85 p-3 sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reader-title"
    >
      <div className="flex flex-col w-full max-w-[1380px] h-[94vh] bg-[#182f4a] text-[#1A1816] border border-white/15 rounded-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 bg-[#12243a] text-white border-b border-white/10">
          <div className="min-w-0">
            <h2
              id="reader-title"
              className="font-serif text-lg sm:text-xl font-medium text-white truncate"
            >
              {book.title}
            </h2>
            <p className="text-xs text-white/70 font-mono tabular-nums mt-0.5 truncate">
              {book.author} · {formatBytes(book.sizeBytes)} · Stored {formatShortDate(book.storedAt)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowNotes((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 ${
                showNotes
                  ? 'bg-[#f3c677] text-[#1A1816] border-[#f3c677]'
                  : 'bg-white/10 text-white border-white/15 hover:bg-white/20'
              }`}
            >
              <NotebookPen className="w-3.5 h-3.5" />
              Notes
            </button>
            <a
              href={pdfDownloadUrl}
              download={book.originalFilename}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#14532D] rounded-md hover:bg-[#166534] transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              Save PDF
            </a>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close reader"
              className="p-2 text-white/75 hover:text-white rounded-md hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col min-w-0">
            <FlipBookReader book={book} />
          </div>

          {showNotes ? (
            <aside className="w-80 sm:w-96 flex flex-col bg-[#F8F6F1] border-l border-[#DFD9CE] p-5 overflow-y-auto shrink-0">
              <div>
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
      </div>
    </div>
  );
}
