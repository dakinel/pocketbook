import { useEffect, useRef, useState } from 'react';
import { FileUp, X } from 'lucide-react';
import type { VaultBook } from '../types.ts';
import { formatBytes } from '../utils/format.ts';

export interface UploadPreset {
  bookKey?: string;
  title?: string;
  author?: string;
  year?: number;
  coverPath?: string;
}

interface UploadPdfModalProps {
  open: boolean;
  preset: UploadPreset | null;
  onClose: () => void;
  onUploaded: (item: VaultBook) => void;
}

export function UploadPdfModal({ open, preset, onClose, onUploaded }: UploadPdfModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [year, setYear] = useState('');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setTitle(preset?.title || '');
      setAuthor(preset?.author || '');
      setYear(preset?.year ? String(preset.year) : '');
      setError(null);
      setDragActive(false);
    }
  }, [open, preset]);

  if (!open) return null;

  function selectFile(picked: File | null) {
    if (!picked) return;
    if (picked.type !== 'application/pdf' && !picked.name.toLowerCase().endsWith('.pdf')) {
      setError('Please select a valid .pdf file.');
      return;
    }
    if (picked.size > 50 * 1024 * 1024) {
      setError('File exceeds the 50 MB vault storage limit.');
      return;
    }
    setError(null);
    setFile(picked);
    if (!title.trim()) {
      setTitle(picked.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) {
      setError('Choose a PDF file to store.');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/pdf',
        'X-Filename': encodeURIComponent(file.name),
        'X-Title': encodeURIComponent(title.trim() || file.name.replace(/\.pdf$/i, '')),
        'X-Author': encodeURIComponent(author.trim() || 'Personal Library Copy'),
      };
      if (year.trim()) {
        headers['X-Year'] = year.trim();
      }
      if (preset?.bookKey) {
        headers['X-Book-Key'] = preset.bookKey;
      }
      if (preset?.coverPath) {
        headers['X-Cover-Path'] = preset.coverPath;
      }

      const res = await fetch('/api/vault/upload', {
        method: 'POST',
        headers,
        body: file,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed.');
      }
      onUploaded(data.item);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to upload PDF.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#1A1816]/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
    >
      <div className="w-full max-w-lg bg-white border border-[#DFD9CE] rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E7E2D8]">
          <h2 id="upload-modal-title" className="font-serif text-xl font-medium text-[#1A1816]">
            Store Personal PDF in Vault
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close upload dialog"
            className="p-1.5 text-[#57534E] hover:text-[#1A1816] rounded-md hover:bg-[#F3EFE6] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              const dropped = e.dataTransfer.files?.[0] || null;
              selectFile(dropped);
            }}
            onClick={() => inputRef.current?.click()}
            className={`cursor-pointer rounded-md border border-dashed p-6 text-center transition-colors ${
              dragActive
                ? 'border-[#14532D] bg-[#14532D]/5'
                : 'border-[#CFC7B8] bg-[#FBF9F5] hover:border-[#78716C]'
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => selectFile(e.target.files?.[0] || null)}
            />
            <FileUp className="w-6 h-6 mx-auto text-[#78350F]" strokeWidth={1.5} />
            {file ? (
              <div className="mt-2">
                <p className="text-sm font-medium text-[#1A1816] truncate">{file.name}</p>
                <p className="text-xs font-mono text-[#57534E] tabular-nums mt-0.5">
                  {formatBytes(file.size)} · Ready to store
                </p>
              </div>
            ) : (
              <div className="mt-2">
                <p className="text-sm font-medium text-[#1A1816]">
                  Drop a PDF here or click to browse
                </p>
                <p className="text-xs text-[#57534E] mt-1">
                  Accepted format: PDF up to 50 MB
                </p>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="upload-title" className="block text-xs font-medium text-[#57534E]">
              Book Title
            </label>
            <input
              id="upload-title"
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. One Up on Wall Street"
              className="mt-1.5 w-full rounded-md border border-[#DFD9CE] bg-white px-3 py-2 text-sm text-[#1A1816] focus:outline-none focus:border-[#14532D]"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label htmlFor="upload-author" className="block text-xs font-medium text-[#57534E]">
                Author
              </label>
              <input
                id="upload-author"
                type="text"
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="e.g. Peter Lynch"
                className="mt-1.5 w-full rounded-md border border-[#DFD9CE] bg-white px-3 py-2 text-sm text-[#1A1816] focus:outline-none focus:border-[#14532D]"
              />
            </div>
            <div>
              <label htmlFor="upload-year" className="block text-xs font-medium text-[#57534E]">
                Year
              </label>
              <input
                id="upload-year"
                type="number"
                min={1400}
                max={2030}
                value={year}
                onChange={(e) => setYear(e.target.value)}
                placeholder="1989"
                className="mt-1.5 w-full rounded-md border border-[#DFD9CE] bg-white px-3 py-2 text-sm font-mono tabular-nums text-[#1A1816] focus:outline-none focus:border-[#14532D]"
              />
            </div>
          </div>

          {error ? (
            <p className="text-xs text-[#991B1B]" role="alert">
              {error}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#E7E2D8]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-[#57534E] hover:text-[#1A1816] rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={uploading || !file}
              className="px-4 py-2 text-xs font-medium text-white bg-[#14532D] rounded-md hover:bg-[#166534] disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {uploading ? 'Storing PDF...' : 'Store in Vault'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
