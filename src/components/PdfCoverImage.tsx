import { useEffect, useRef, useState } from 'react';
import { getCachedPdfCoverSync, getOrRenderPdfCover } from '../utils/pdfCoverCache.ts';

interface PdfCoverImageProps {
  bookId: string;
  sizeBytes: number;
  title: string;
  className?: string;
}

export function PdfCoverImage({ bookId, sizeBytes, title, className = '' }: PdfCoverImageProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(() =>
    getCachedPdfCoverSync(bookId, sizeBytes)
  );
  const [failed, setFailed] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(() => Boolean(getCachedPdfCoverSync(bookId, sizeBytes)));
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cached = getCachedPdfCoverSync(bookId, sizeBytes);
    if (cached) {
      setCoverUrl(cached);
      setShouldLoad(true);
      setFailed(false);
      return;
    }

    setCoverUrl(null);
    setFailed(false);

    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') {
      setShouldLoad(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '280px 0px' }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [bookId, sizeBytes]);

  useEffect(() => {
    if (!shouldLoad || coverUrl) return;
    let cancelled = false;

    getOrRenderPdfCover(bookId, sizeBytes)
      .then((url) => {
        if (!cancelled) {
          setCoverUrl(url);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [shouldLoad, coverUrl, bookId, sizeBytes]);

  return (
    <div ref={containerRef} className={`w-full h-full bg-[#e8e3d8] ${className}`}>
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={title}
          className="w-full h-full object-cover object-top block"
        />
      ) : (
        <div
          aria-hidden="true"
          className={`w-full h-full bg-gradient-to-b from-[#2b2e36] to-[#1e2128] ${
            failed ? '' : 'animate-pulse'
          }`}
        />
      )}
    </div>
  );
}
