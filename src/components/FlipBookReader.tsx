import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import type { VaultBook } from '../types.ts';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface FlipBookReaderProps {
  book: VaultBook;
}

export function FlipBookReader({ book }: FlipBookReaderProps) {
  const [numPages, setNumPages] = useState(0);
  const [currentSpread, setCurrentSpread] = useState(0);
  const [activeFlipLeaf, setActiveFlipLeaf] = useState<number | null>(null);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({});
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [docError, setDocError] = useState<string | null>(null);
  const [jumpValue, setJumpValue] = useState('1');
  const [singleZoom, setSingleZoom] = useState(false);

  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderedSetRef = useRef<Set<number>>(new Set());
  const inFlightSetRef = useRef<Set<number>>(new Set());
  const flipTimerRef = useRef<number | null>(null);

  const totalLeaves = Math.max(1, Math.ceil(numPages / 2));

  useEffect(() => {
    let cancelled = false;
    setLoadingDoc(true);
    setDocError(null);
    setNumPages(0);
    setCurrentSpread(0);
    setActiveFlipLeaf(null);
    setPageImages({});
    setPageErrors({});
    setJumpValue('1');
    renderedSetRef.current = new Set();
    inFlightSetRef.current = new Set();

    const url = `/api/vault/${encodeURIComponent(book.id)}/file`;
    const loadingTask = pdfjsLib.getDocument({
      url,
      wasmUrl: '/pdfjs/wasm/',
      cMapUrl: '/pdfjs/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: '/pdfjs/standard_fonts/',
      iccUrl: '/pdfjs/iccs/',
    });

    loadingTask.promise
      .then((doc) => {
        if (cancelled) {
          void loadingTask.destroy();
          return;
        }
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setLoadingDoc(false);
      })
      .catch((err) => {
        if (!cancelled) {
          setDocError(err instanceof Error ? err.message : 'Unable to open PDF inside reader.');
          setLoadingDoc(false);
        }
      });

    return () => {
      cancelled = true;
      if (flipTimerRef.current !== null) {
        window.clearTimeout(flipTimerRef.current);
      }
      pdfDocRef.current = null;
      void loadingTask.destroy();
    };
  }, [book.id]);

  const renderPdfPage = useCallback(async (pageNum: number) => {
    const doc = pdfDocRef.current;
    if (!doc || pageNum < 1 || pageNum > doc.numPages) return;
    if (renderedSetRef.current.has(pageNum) || inFlightSetRef.current.has(pageNum)) {
      return;
    }

    inFlightSetRef.current.add(pageNum);
    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.75 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(viewport.width));
      canvas.height = Math.max(1, Math.floor(viewport.height));

      await page.render({ canvas, viewport }).promise;

      // Composite onto an opaque white backing so transparent PDF pages render cleanly as JPEG
      const outputCanvas = document.createElement('canvas');
      outputCanvas.width = canvas.width;
      outputCanvas.height = canvas.height;
      const outCtx = outputCanvas.getContext('2d');
      if (outCtx) {
        outCtx.fillStyle = '#ffffff';
        outCtx.fillRect(0, 0, outputCanvas.width, outputCanvas.height);
        outCtx.drawImage(canvas, 0, 0);
      }

      const dataUrl = (outCtx ? outputCanvas : canvas).toDataURL('image/jpeg', 0.92);
      renderedSetRef.current.add(pageNum);
      setPageImages((prev) => ({ ...prev, [pageNum]: dataUrl }));
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name !== 'RenderingCancelledException') {
        setPageErrors((prev) => ({
          ...prev,
          [pageNum]: err instanceof Error ? err.message : 'Page render failed.',
        }));
      }
    } finally {
      inFlightSetRef.current.delete(pageNum);
    }
  }, []);

  useEffect(() => {
    if (numPages === 0) return;
    const minPage = Math.max(1, currentSpread * 2 - 3);
    const maxPage = Math.min(numPages, currentSpread * 2 + 6);
    for (let p = minPage; p <= maxPage; p++) {
      void renderPdfPage(p);
    }
  }, [numPages, currentSpread, renderPdfPage]);

  useEffect(() => {
    const leftPage = currentSpread === 0 ? 1 : currentSpread * 2;
    setJumpValue(String(leftPage));
  }, [currentSpread]);

  const turnNext = useCallback(() => {
    if (currentSpread >= totalLeaves) return;
    const turningLeaf = currentSpread;
    setActiveFlipLeaf(turningLeaf);
    setCurrentSpread((prev) => Math.min(totalLeaves, prev + 1));
    if (flipTimerRef.current !== null) window.clearTimeout(flipTimerRef.current);
    flipTimerRef.current = window.setTimeout(() => setActiveFlipLeaf(null), 820);
  }, [currentSpread, totalLeaves]);

  const turnPrev = useCallback(() => {
    if (currentSpread <= 0) return;
    const turningLeaf = currentSpread - 1;
    setActiveFlipLeaf(turningLeaf);
    setCurrentSpread((prev) => Math.max(0, prev - 1));
    if (flipTimerRef.current !== null) window.clearTimeout(flipTimerRef.current);
    flipTimerRef.current = window.setTimeout(() => setActiveFlipLeaf(null), 820);
  }, [currentSpread]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        turnNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        turnPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turnNext, turnPrev]);

  function handleJumpSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetPage = Number.parseInt(jumpValue, 10);
    if (!Number.isFinite(targetPage) || numPages <= 0) return;
    const clamped = Math.max(1, Math.min(numPages, targetPage));
    const targetSpread = Math.floor(clamped / 2);
    setActiveFlipLeaf(null);
    setCurrentSpread(targetSpread);
  }

  if (loadingDoc) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-white/80">
        <Loader2 className="w-7 h-7 animate-spin text-[#f3c677]" />
        <p className="mt-3 font-serif text-lg text-white">Opening {book.title}...</p>
        <p className="mt-1 text-xs text-white/70">Rendering book pages inside the reader</p>
      </div>
    );
  }

  if (docError) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <p className="font-serif text-lg text-[#fca5a5]">Unable to open PDF book</p>
        <p className="mt-1 text-sm text-white/80">{docError}</p>
      </div>
    );
  }

  const windowStart = Math.max(0, currentSpread - 2);
  const windowEnd = Math.min(totalLeaves - 1, currentSpread + 2);
  const visibleLeaves: number[] = [];
  for (let k = windowStart; k <= windowEnd; k++) {
    visibleLeaves.push(k);
  }

  const zoomedLeftPage = currentSpread === 0 ? null : currentSpread * 2;
  const zoomedRightPage = currentSpread * 2 + 1 <= numPages ? currentSpread * 2 + 1 : null;

  const renderPageContent = (pageNum: number, emptyLabel: string) => {
    if (pageNum > numPages) {
      return (
        <div className="w-full h-full flex items-center justify-center text-xs text-[#A8A29E] font-serif italic">
          {emptyLabel}
        </div>
      );
    }
    if (pageErrors[pageNum]) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-xs text-[#991B1B]">
          <span>Could not render Page {pageNum}</span>
          <span className="mt-1 text-[11px] text-[#78716C]">{pageErrors[pageNum]}</span>
        </div>
      );
    }
    if (pageImages[pageNum]) {
      return (
        <img
          src={pageImages[pageNum]}
          alt={`Page ${pageNum}`}
          className="w-full h-full object-contain pointer-events-none select-none p-2 sm:p-3"
        />
      );
    }
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-[#78716C]">
        <Loader2 className="w-4 h-4 animate-spin mb-2" />
        <span className="text-xs font-mono tabular-nums">Page {pageNum}</span>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col justify-between p-4 sm:p-6 bg-[#182f4a] overflow-hidden">
      <div className="flex-1 flex items-center justify-center min-h-0">
        {singleZoom ? (
          <div className="w-full max-w-4xl h-[min(74vh,660px)] bg-[#141210] rounded-xl p-3 shadow-2xl flex flex-col">
            <div className="flex-1 overflow-y-auto bg-[#e9e5dc] rounded p-4 space-y-4">
              {zoomedLeftPage ? (
                <div className="bg-white shadow mx-auto max-w-2xl">
                  {pageImages[zoomedLeftPage] ? (
                    <img
                      src={pageImages[zoomedLeftPage]}
                      alt={`Page ${zoomedLeftPage}`}
                      className="w-full h-auto block"
                    />
                  ) : (
                    <div className="py-24 text-center text-xs text-[#78716C]">
                      Rendering Page {zoomedLeftPage}...
                    </div>
                  )}
                </div>
              ) : null}
              {zoomedRightPage ? (
                <div className="bg-white shadow mx-auto max-w-2xl">
                  {pageImages[zoomedRightPage] ? (
                    <img
                      src={pageImages[zoomedRightPage]}
                      alt={`Page ${zoomedRightPage}`}
                      className="w-full h-auto block"
                    />
                  ) : (
                    <div className="py-24 text-center text-xs text-[#78716C]">
                      Rendering Page {zoomedRightPage}...
                    </div>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="bookWrapper">
            <div className="bookBg">
              <div className="pageBg">
                <div className="baseLeft">
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 sm:p-10 text-center">
                    <p className="text-[11px] font-mono uppercase tracking-widest text-[#78716C]">
                      Folio Edition
                    </p>
                    <h3 className="mt-3 font-serif text-xl sm:text-2xl font-medium text-[#1A1816] max-w-xs [text-wrap:balance]">
                      {book.title}
                    </h3>
                    <p className="mt-2 text-xs sm:text-sm text-[#57534E]">{book.author}</p>
                    <div className="mt-6 pt-4 border-t border-[#E5E0D5] text-xs font-mono tabular-nums text-[#78716C]">
                      {numPages} Pages
                    </div>
                    <p className="mt-4 text-[11px] text-[#78716C]">
                      Click the right page to turn forward
                    </p>
                  </div>
                </div>

                <div className="baseRight">
                  <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
                    <p className="font-serif text-lg text-[#1A1816]">End of Book</p>
                    <p className="mt-1 text-xs text-[#78716C]">
                      Click the left page to turn back
                    </p>
                  </div>
                </div>

                <div className="pageWrapper">
                  {visibleLeaves.map((k) => {
                    const frontPageNum = k * 2 + 1;
                    const backPageNum = k * 2 + 2;
                    const isFlipped = k < currentSpread;

                    let zIndex: number;
                    if (activeFlipLeaf === k) {
                      zIndex = 100;
                    } else if (isFlipped) {
                      zIndex = 10 + k;
                    } else {
                      zIndex = 60 - (k - currentSpread);
                    }

                    return (
                      <div
                        key={k}
                        style={{ zIndex }}
                        onClick={() => {
                          if (isFlipped) {
                            if (k === currentSpread - 1) turnPrev();
                          } else if (k === currentSpread) {
                            turnNext();
                          }
                        }}
                        className={`flip-page ${isFlipped ? 'is-flipped' : 'is-right'}`}
                      >
                        <div className="pageFace front">
                          {renderPageContent(frontPageNum, 'Blank Endpaper')}
                          <span className="absolute bottom-2 right-3 text-[10px] font-mono tabular-nums text-[#78716C]/80">
                            {frontPageNum <= numPages ? frontPageNum : ''}
                          </span>
                          <div className="pageFoldRight" />
                        </div>

                        <div className="pageFace back">
                          {renderPageContent(backPageNum, 'End of Volume')}
                          <span className="absolute bottom-2 left-3 text-[10px] font-mono tabular-nums text-[#78716C]/80">
                            {backPageNum <= numPages ? backPageNum : ''}
                          </span>
                          <div className="pageFoldLeft" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 max-w-[1040px] w-full mx-auto text-xs text-white/90">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={currentSpread <= 0}
            onClick={turnPrev}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-35 transition-colors whitespace-nowrap"
          >
            <ChevronLeft className="w-4 h-4" />
            Previous Page
          </button>
          <button
            type="button"
            disabled={currentSpread >= totalLeaves}
            onClick={turnNext}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 disabled:opacity-35 transition-colors whitespace-nowrap"
          >
            Next Page
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleJumpSubmit} className="flex items-center gap-2">
          <label htmlFor="flipbook-page-input" className="text-white/75">
            Page
          </label>
          <input
            id="flipbook-page-input"
            type="number"
            min={1}
            max={numPages}
            value={jumpValue}
            onChange={(e) => setJumpValue(e.target.value)}
            className="w-16 rounded bg-white/10 border border-white/20 px-2 py-1 text-center font-mono tabular-nums text-white focus:outline-none focus:border-[#f3c677]"
          />
          <span className="font-mono tabular-nums text-white/75">of {numPages}</span>
          <button
            type="submit"
            className="px-2.5 py-1 rounded bg-white/15 hover:bg-white/25 text-white font-medium transition-colors"
          >
            Go
          </button>
        </form>

        <button
          type="button"
          onClick={() => setSingleZoom((prev) => !prev)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 transition-colors whitespace-nowrap"
        >
          {singleZoom ? (
            <>
              <Minimize2 className="w-3.5 h-3.5" />
              3D Spread View
            </>
          ) : (
            <>
              <Maximize2 className="w-3.5 h-3.5" />
              Zoom Single Pages
            </>
          )}
        </button>
      </div>
    </div>
  );
}
