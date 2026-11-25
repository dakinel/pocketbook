import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import type { VaultBook } from '../types.ts';
import { getCachedPdfCoverSync, getOrRenderPdfCover } from '../utils/pdfCoverCache.ts';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export interface PocketOriginRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface FlipBookReaderProps {
  book: VaultBook;
  originRect?: PocketOriginRect | null;
  closing?: boolean;
}

export function FlipBookReader({ book, originRect, closing = false }: FlipBookReaderProps) {
  const [numPages, setNumPages] = useState(0);
  const [currentSpread, setCurrentSpread] = useState(0);
  const [activeFlipLeaf, setActiveFlipLeaf] = useState<number | null>(null);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({});
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [docError, setDocError] = useState<string | null>(null);
  const [jumpValue, setJumpValue] = useState('1');
  const [singleZoom, setSingleZoom] = useState(false);

  // Two-stage book reveal: (1) emerge from pocket rect to center, (2) swing front hardcover open
  const [stageArrived, setStageArrived] = useState(false);
  const [coverOpened, setCoverOpened] = useState(false);
  const [coverFading, setCoverFading] = useState(false);
  const [coverSettled, setCoverSettled] = useState(false);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(() =>
    getCachedPdfCoverSync(book.id, book.sizeBytes)
  );

  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderedSetRef = useRef<Set<number>>(new Set());
  const inFlightSetRef = useRef<Set<number>>(new Set());
  const flipTimerRef = useRef<number | null>(null);

  const totalLeaves = Math.max(1, Math.ceil(numPages / 2));

  const initialTransform = useMemo(() => {
    if (!originRect || typeof window === 'undefined') {
      return 'translate3d(0, 64px, 0) scale(0.36) rotateX(18deg) rotateY(-16deg)';
    }
    const targetCenterX = window.innerWidth / 2;
    const targetCenterY = window.innerHeight / 2;
    const originCenterX = originRect.left + originRect.width / 2;
    const originCenterY = originRect.top + originRect.height / 2;
    const dx = Math.round(originCenterX - targetCenterX);
    const dy = Math.round(originCenterY - targetCenterY);
    const approxBookWidth = Math.min(window.innerWidth * 0.92, 1080);
    const scale = Math.max(0.14, Math.min(0.42, (originRect.width * 2) / approxBookWidth));
    return `translate3d(${dx}px, ${dy}px, 0) scale(${scale.toFixed(3)}) rotateX(18deg) rotateY(-22deg) rotateZ(-4deg)`;
  }, [originRect]);

  useEffect(() => {
    setStageArrived(false);
    setCoverOpened(false);
    setCoverFading(false);
    setCoverSettled(false);
    setCoverPreviewUrl(getCachedPdfCoverSync(book.id, book.sizeBytes));

    let cancelled = false;
    if (!getCachedPdfCoverSync(book.id, book.sizeBytes)) {
      getOrRenderPdfCover(book.id, book.sizeBytes, true)
        .then((url) => {
          if (!cancelled) setCoverPreviewUrl(url);
        })
        .catch(() => {});
    }

    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setStageArrived(true);
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [book.id, book.sizeBytes]);

  useEffect(() => {
    if (!stageArrived || loadingDoc || docError) return;
    const openTimer = window.setTimeout(() => {
      setCoverOpened(true);
    }, 340);
    const fadeTimer = window.setTimeout(() => {
      setCoverFading(true);
    }, 1360);
    const settleTimer = window.setTimeout(() => {
      setCoverSettled(true);
    }, 1620);
    return () => {
      window.clearTimeout(openTimer);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(settleTimer);
    };
  }, [stageArrived, loadingDoc, docError]);

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

  const stageStyle = closing
    ? { transform: initialTransform, opacity: 0 }
    : stageArrived
      ? { transform: 'translate3d(0, 0, 0) scale(1) rotateX(0deg)', opacity: 1 }
      : { transform: initialTransform, opacity: 0.2 };

  return (
    <div
      style={stageStyle}
      className="book-reveal-stage w-full flex flex-col items-center justify-center"
    >
      {docError ? (
        <div className="max-w-md bg-[#1a1d24]/95 border border-white/15 rounded-lg p-8 text-center shadow-2xl">
          <p className="font-serif text-lg text-[#fca5a5]">Unable to open PDF book</p>
          <p className="mt-1 text-sm text-white/80">{docError}</p>
        </div>
      ) : singleZoom ? (
        <div className="w-[min(92vw,900px)] h-[min(78vh,690px)] bg-[#141210] rounded-xl p-3 shadow-2xl flex flex-col">
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
        <div className={`bookWrapper ${coverOpened ? 'is-spread-open' : ''}`}>
          <div className="bookBg">
            <div className="bookBoardLeft" aria-hidden="true" />
            <div className="bookBoardRight" aria-hidden="true" />
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
                    {numPages > 0 ? `${numPages} Pages` : 'Loading...'}
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
                {!loadingDoc
                  ? visibleLeaves.map((k) => {
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
                    })
                  : null}

                {!coverSettled ? (
                  <div
                    aria-hidden="true"
                    className={`cover-reveal-leaf ${coverOpened ? 'is-open' : ''} ${
                      coverFading ? 'is-settled' : ''
                    }`}
                  >
                    <div className="pageFace front cover-sheen bg-[#22252d] flex items-center justify-center border-l border-black/40 rounded-r-[10px]">
                      {coverPreviewUrl || pageImages[1] ? (
                        <img
                          src={pageImages[1] || coverPreviewUrl || ''}
                          alt=""
                          className="w-full h-full object-cover object-top"
                        />
                      ) : (
                        <Loader2 className="w-6 h-6 animate-spin text-[#f3c677]" />
                      )}
                    </div>

                    <div className="pageFace back bg-gradient-to-r from-[#ece7dc] via-[#f5f1e8] to-[#e1dbd0]" />
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {!docError && numPages > 0 ? (
        <div
          className={`mt-4 flex flex-wrap items-center justify-between gap-3 w-[min(92vw,1080px)] text-xs text-white/85 transition-opacity duration-500 ${
            coverOpened ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentSpread <= 0}
              onClick={turnPrev}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 disabled:opacity-35 backdrop-blur-md transition-colors whitespace-nowrap"
            >
              <ChevronLeft className="w-4 h-4" />
              Previous Page
            </button>
            <button
              type="button"
              disabled={currentSpread >= totalLeaves}
              onClick={turnNext}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 disabled:opacity-35 backdrop-blur-md transition-colors whitespace-nowrap"
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
              className="w-16 rounded-md bg-black/45 border border-white/15 px-2 py-1 text-center font-mono tabular-nums text-white focus:outline-none focus:border-[#f3c677]"
            />
            <span className="font-mono tabular-nums text-white/75">of {numPages}</span>
            <button
              type="submit"
              className="px-2.5 py-1 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 text-white font-medium transition-colors"
            >
              Go
            </button>
          </form>

          <button
            type="button"
            onClick={() => setSingleZoom((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 backdrop-blur-md transition-colors whitespace-nowrap"
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
      ) : null}
    </div>
  );
}
