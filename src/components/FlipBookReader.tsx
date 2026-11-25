import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Bookmark, ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import type { ReadingStatus, VaultBook } from '../types.ts';
import {
  getKeptPage,
  resolveBookProgress,
  saveLocalBookProgress,
  type BookProgressState,
} from '../utils/bookProgress.ts';
import { getCachedPdfCoverSync, getOrRenderPdfCover } from '../utils/pdfCoverCache.ts';
import { FocusedPageOverlay, type FocusAnchor } from './FocusedPageOverlay.tsx';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

function computeImageNormalizedPoint(
  containerEl: HTMLElement,
  clientX: number,
  clientY: number
): { rx: number; ry: number } {
  const imgEl =
    containerEl instanceof HTMLImageElement
      ? containerEl
      : containerEl.querySelector('img');
  const target = imgEl || containerEl;
  const rect = target.getBoundingClientRect();
  const style = window.getComputedStyle(target);
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const padT = parseFloat(style.paddingTop) || 0;
  const padB = parseFloat(style.paddingBottom) || 0;

  const boxLeft = rect.left + padL;
  const boxTop = rect.top + padT;
  const boxW = Math.max(1, rect.width - padL - padR);
  const boxH = Math.max(1, rect.height - padT - padB);

  let drawnW = boxW;
  let drawnH = boxH;
  let offsetX = 0;
  let offsetY = 0;

  if (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
    const natAspect = imgEl.naturalWidth / imgEl.naturalHeight;
    const boxAspect = boxW / boxH;
    if (natAspect > boxAspect) {
      drawnH = boxW / natAspect;
      offsetY = (boxH - drawnH) / 2;
    } else {
      drawnW = boxH * natAspect;
      offsetX = (boxW - drawnW) / 2;
    }
  }

  const rx = Math.max(0.06, Math.min(0.94, (clientX - (boxLeft + offsetX)) / Math.max(1, drawnW)));
  const ry = Math.max(0.06, Math.min(0.94, (clientY - (boxTop + offsetY)) / Math.max(1, drawnH)));
  return { rx, ry };
}

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
  onBookUpdate?: (updated: VaultBook) => void;
}

export function FlipBookReader({
  book,
  originRect,
  closing = false,
  onBookUpdate,
}: FlipBookReaderProps) {
  const [numPages, setNumPages] = useState(0);
  const [currentSpread, setCurrentSpread] = useState(0);
  const [activeFlipLeaf, setActiveFlipLeaf] = useState<number | null>(null);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({});
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [docError, setDocError] = useState<string | null>(null);
  const [jumpValue, setJumpValue] = useState('1');
  const [singleZoom, setSingleZoom] = useState(false);
  const [focusAnchor, setFocusAnchor] = useState<FocusAnchor | null>(null);
  const [hiResImages, setHiResImages] = useState<Record<number, string>>({});
  const [progress, setProgress] = useState<BookProgressState>(() => resolveBookProgress(book));

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
  const hiResSetRef = useRef<Set<number>>(new Set());
  const hiResInFlightRef = useRef<Set<number>>(new Set());
  const hiResOrderRef = useRef<number[]>([]);
  const flipTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const hasInteractedRef = useRef(false);
  const bookRef = useRef(book);
  const onBookUpdateRef = useRef(onBookUpdate);
  const lastPageTapRef = useRef<{ time: number; x: number; y: number; pageNum: number } | null>(null);
  const suppressClickUntilRef = useRef(0);

  useEffect(() => {
    bookRef.current = book;
    onBookUpdateRef.current = onBookUpdate;
  }, [book, onBookUpdate]);

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
    if (closing) {
      setFocusAnchor(null);
    }
  }, [closing]);

  const persistProgressToServer = useCallback(
    (targetBookId: string, nextProgress: BookProgressState, immediate = false) => {
      saveLocalBookProgress(targetBookId, nextProgress);

      const currentBook = bookRef.current;
      if (currentBook.id === targetBookId && onBookUpdateRef.current) {
        onBookUpdateRef.current({
          ...currentBook,
          lastPage: nextProgress.lastPage,
          totalPages: nextProgress.totalPages,
          bookmarkedPage: nextProgress.bookmarkedPage,
          readingStatus: nextProgress.readingStatus,
          lastReadAt: nextProgress.updatedAt,
        });
      }

      const sendPatch = () => {
        fetch(`/api/vault/${encodeURIComponent(targetBookId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lastPage: nextProgress.lastPage,
            totalPages: nextProgress.totalPages,
            bookmarkedPage: nextProgress.bookmarkedPage,
            readingStatus: nextProgress.readingStatus,
            lastReadAt: nextProgress.updatedAt,
          }),
        })
          .then(async (res) => {
            if (!res.ok) return;
            const data = (await res.json()) as { item?: VaultBook };
            if (data.item && bookRef.current.id === targetBookId && onBookUpdateRef.current) {
              onBookUpdateRef.current(data.item);
            }
          })
          .catch(() => {});
      };

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (immediate) {
        sendPatch();
      } else {
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null;
          sendPatch();
        }, 320);
      }
    },
    []
  );

  useEffect(() => {
    let cancelled = false;
    const initialProgress = resolveBookProgress(bookRef.current);
    hasInteractedRef.current = false;
    setProgress(initialProgress);
    setLoadingDoc(true);
    setDocError(null);
    setNumPages(0);
    setCurrentSpread(0);
    setActiveFlipLeaf(null);
    setPageImages({});
    setHiResImages({});
    setFocusAnchor(null);
    setPageErrors({});
    setJumpValue('1');
    renderedSetRef.current = new Set();
    inFlightSetRef.current = new Set();
    hiResSetRef.current = new Set();
    hiResInFlightRef.current = new Set();
    hiResOrderRef.current = [];

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
        const resumePage = getKeptPage(initialProgress);
        if (resumePage) {
          const clampedResume = Math.max(1, Math.min(doc.numPages, resumePage));
          setCurrentSpread(Math.floor(clampedResume / 2));
        }
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
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
      }
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
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
      canvas.width = 0;
      canvas.height = 0;
      outputCanvas.width = 0;
      outputCanvas.height = 0;
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

  const renderHiResPage = useCallback(async (pageNum: number) => {
    const doc = pdfDocRef.current;
    if (!doc || pageNum < 1 || pageNum > doc.numPages) return;
    if (hiResSetRef.current.has(pageNum) || hiResInFlightRef.current.has(pageNum)) {
      return;
    }

    hiResInFlightRef.current.add(pageNum);
    try {
      const page = await doc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const maxDim = Math.max(1, baseViewport.width, baseViewport.height);
      const targetScale = Math.max(2.1, Math.min(3.2, 2350 / maxDim));
      const viewport = page.getViewport({ scale: targetScale });

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

      const dataUrl = (outCtx ? outputCanvas : canvas).toDataURL('image/jpeg', 0.94);
      canvas.width = 0;
      canvas.height = 0;
      outputCanvas.width = 0;
      outputCanvas.height = 0;

      if (pdfDocRef.current !== doc) return;

      hiResSetRef.current.add(pageNum);
      hiResOrderRef.current = [...hiResOrderRef.current.filter((p) => p !== pageNum), pageNum];
      const evicted = hiResOrderRef.current.length > 4 ? hiResOrderRef.current.shift() : undefined;
      if (evicted !== undefined) {
        hiResSetRef.current.delete(evicted);
      }

      setHiResImages((prev) => {
        const next = { ...prev, [pageNum]: dataUrl };
        if (evicted !== undefined) {
          delete next[evicted];
        }
        return next;
      });
    } catch {
      // Base page image remains visible if hi-res upgrade is cancelled
    } finally {
      hiResInFlightRef.current.delete(pageNum);
    }
  }, []);

  const openPageFocus = useCallback(
    (pageNum: number, clientX: number, clientY: number, containerEl: HTMLElement) => {
      if (pageNum < 1 || pageNum > numPages) return;
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      const { rx, ry } = computeImageNormalizedPoint(containerEl, clientX, clientY);
      void renderPdfPage(pageNum);
      void renderHiResPage(pageNum);
      setFocusAnchor({ pageNum, rx, ry });
    },
    [numPages, renderHiResPage, renderPdfPage]
  );

  const handlePageTapPointerUp = useCallback(
    (pageNum: number, e: React.PointerEvent<HTMLElement>) => {
      if (e.pointerType !== 'touch' || pageNum < 1 || pageNum > numPages) return;
      const now = performance.now();
      const prev = lastPageTapRef.current;
      if (
        prev &&
        prev.pageNum === pageNum &&
        now - prev.time < 320 &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30
      ) {
        lastPageTapRef.current = null;
        suppressClickUntilRef.current = now + 420;
        openPageFocus(pageNum, e.clientX, e.clientY, e.currentTarget);
      } else {
        lastPageTapRef.current = { time: now, x: e.clientX, y: e.clientY, pageNum };
      }
    },
    [numPages, openPageFocus]
  );

  useEffect(() => {
    if (numPages === 0) return;
    const minPage = Math.max(1, currentSpread * 2 - 3);
    const maxPage = Math.min(numPages, currentSpread * 2 + 6);
    for (let p = minPage; p <= maxPage; p++) {
      void renderPdfPage(p);
    }
  }, [numPages, currentSpread, renderPdfPage]);

  const primarySpreadPage =
    numPages > 0
      ? currentSpread === 0
        ? 1
        : Math.min(numPages, currentSpread * 2)
      : 1;

  const commitPageProgress = useCallback(
    (
      targetPage: number,
      options?: { bookmarkedPage?: number | null; status?: ReadingStatus; immediate?: boolean }
    ) => {
      if (numPages <= 0) return;
      const clampedPage = Math.max(1, Math.min(numPages, targetPage));
      const now = new Date().toISOString();
      setProgress((prev) => {
        const nextStatus: ReadingStatus =
          options?.status ??
          (prev.readingStatus === 'completed'
            ? 'completed'
            : clampedPage >= 2 || (options?.bookmarkedPage ?? prev.bookmarkedPage) !== null
              ? 'reading'
              : 'unread');
        const nextState: BookProgressState = {
          lastPage: clampedPage,
          totalPages: numPages,
          bookmarkedPage:
            options && 'bookmarkedPage' in options
              ? (options.bookmarkedPage ?? null)
              : prev.bookmarkedPage,
          readingStatus: nextStatus,
          updatedAt: now,
        };
        persistProgressToServer(book.id, nextState, options?.immediate);
        return nextState;
      });
    },
    [book.id, numPages, persistProgressToServer]
  );

  const toggleBookKeeperAtPage = useCallback(
    (pageNum: number) => {
      if (numPages <= 0) return;
      const clampedPage = Math.max(1, Math.min(numPages, pageNum));
      hasInteractedRef.current = true;
      const currentKept = getKeptPage(progress);
      const spreadLeft = currentSpread === 0 ? null : currentSpread * 2;
      const spreadRight = currentSpread * 2 + 1 <= numPages ? currentSpread * 2 + 1 : null;
      const isAlreadyKeptHere =
        currentKept !== null &&
        (currentKept === clampedPage ||
          (clampedPage === primarySpreadPage &&
            (currentKept === spreadLeft || currentKept === spreadRight)));

      if (isAlreadyKeptHere) {
        commitPageProgress(1, {
          bookmarkedPage: null,
          status: 'unread',
          immediate: true,
        });
      } else {
        commitPageProgress(clampedPage, {
          bookmarkedPage: clampedPage,
          status: progress.readingStatus === 'completed' ? 'completed' : 'reading',
          immediate: true,
        });
      }
    },
    [commitPageProgress, currentSpread, numPages, primarySpreadPage, progress]
  );

  useEffect(() => {
    const leftPage = currentSpread === 0 ? 1 : Math.min(Math.max(1, numPages), currentSpread * 2);
    setJumpValue(String(leftPage));
    if (numPages > 0 && hasInteractedRef.current) {
      commitPageProgress(leftPage);
    }
  }, [currentSpread, numPages, commitPageProgress]);

  const turnNext = useCallback(() => {
    if (currentSpread >= totalLeaves) return;
    hasInteractedRef.current = true;
    const turningLeaf = currentSpread;
    setActiveFlipLeaf(turningLeaf);
    setCurrentSpread((prev) => Math.min(totalLeaves, prev + 1));
    if (flipTimerRef.current !== null) window.clearTimeout(flipTimerRef.current);
    flipTimerRef.current = window.setTimeout(() => setActiveFlipLeaf(null), 820);
  }, [currentSpread, totalLeaves]);

  const turnPrev = useCallback(() => {
    if (currentSpread <= 0) return;
    hasInteractedRef.current = true;
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
    hasInteractedRef.current = true;
    const clamped = Math.max(1, Math.min(numPages, targetPage));
    const targetSpread = Math.floor(clamped / 2);
    setActiveFlipLeaf(null);
    setCurrentSpread(targetSpread);
    commitPageProgress(clamped, { immediate: true });
  }

  const windowStart = Math.max(0, currentSpread - 2);
  const windowEnd = Math.min(totalLeaves - 1, currentSpread + 2);
  const visibleLeaves: number[] = [];
  for (let k = windowStart; k <= windowEnd; k++) {
    visibleLeaves.push(k);
  }

  const zoomedLeftPage = currentSpread === 0 ? null : currentSpread * 2;
  const zoomedRightPage = currentSpread * 2 + 1 <= numPages ? currentSpread * 2 + 1 : null;
  const keptPage = getKeptPage(progress);
  const keptOnLeft = keptPage !== null && zoomedLeftPage === keptPage;
  const keptOnRight = keptPage !== null && zoomedRightPage === keptPage;
  const keptOnCurrentSpread = keptOnLeft || keptOnRight;

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
          draggable={false}
          className="w-full h-full object-contain select-none p-2 sm:p-3 cursor-zoom-in"
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
              <div
                className="bg-white shadow mx-auto max-w-2xl cursor-zoom-in"
                title="Double-click to focus & read"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openPageFocus(zoomedLeftPage, e.clientX, e.clientY, e.currentTarget);
                }}
                onPointerUp={(e) => handlePageTapPointerUp(zoomedLeftPage, e)}
              >
                {pageImages[zoomedLeftPage] ? (
                  <img
                    src={pageImages[zoomedLeftPage]}
                    alt={`Page ${zoomedLeftPage}`}
                    draggable={false}
                    className="w-full h-auto block select-none"
                  />
                ) : (
                  <div className="py-24 text-center text-xs text-[#78716C]">
                    Rendering Page {zoomedLeftPage}...
                  </div>
                )}
              </div>
            ) : null}
            {zoomedRightPage ? (
              <div
                className="bg-white shadow mx-auto max-w-2xl cursor-zoom-in"
                title="Double-click to focus & read"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openPageFocus(zoomedRightPage, e.clientX, e.clientY, e.currentTarget);
                }}
                onPointerUp={(e) => handlePageTapPointerUp(zoomedRightPage, e)}
              >
                {pageImages[zoomedRightPage] ? (
                  <img
                    src={pageImages[zoomedRightPage]}
                    alt={`Page ${zoomedRightPage}`}
                    draggable={false}
                    className="w-full h-auto block select-none"
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
              {coverOpened && keptOnCurrentSpread && keptPage !== null ? (
                <button
                  type="button"
                  onClick={() => toggleBookKeeperAtPage(keptPage)}
                  title={`Book Keeper at Page ${keptPage} — click to remove`}
                  aria-label={`Remove red bookmark at Page ${keptPage}`}
                  className={`reader-book-keeper-ribbon absolute -top-2 z-[110] flex flex-col items-center justify-end cursor-pointer ${
                    keptOnLeft ? 'left-[10%]' : 'right-[10%]'
                  }`}
                >
                  <span className="text-[9px] font-mono font-bold tabular-nums text-[#fff5f5] leading-none">
                    p.{keptPage}
                  </span>
                </button>
              ) : null}
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
                          onClick={(e) => {
                            if (performance.now() < suppressClickUntilRef.current) {
                              return;
                            }
                            if (e.detail >= 2) {
                              if (clickTimerRef.current !== null) {
                                window.clearTimeout(clickTimerRef.current);
                                clickTimerRef.current = null;
                              }
                              return;
                            }
                            if (clickTimerRef.current !== null) {
                              window.clearTimeout(clickTimerRef.current);
                            }
                            clickTimerRef.current = window.setTimeout(() => {
                              clickTimerRef.current = null;
                              if (isFlipped) {
                                if (k === currentSpread - 1) turnPrev();
                              } else if (k === currentSpread) {
                                turnNext();
                              }
                            }, 195);
                          }}
                          className={`flip-page ${isFlipped ? 'is-flipped' : 'is-right'}`}
                        >
                          <div
                            className="pageFace front"
                            onDoubleClick={(e) => {
                              if (frontPageNum <= numPages) {
                                e.stopPropagation();
                                openPageFocus(frontPageNum, e.clientX, e.clientY, e.currentTarget);
                              }
                            }}
                            onPointerUp={(e) => handlePageTapPointerUp(frontPageNum, e)}
                          >
                            {renderPageContent(frontPageNum, 'Blank Endpaper')}
                            <span className="absolute bottom-2 right-3 text-[10px] font-mono tabular-nums text-[#78716C]/80 pointer-events-none">
                              {frontPageNum <= numPages ? frontPageNum : ''}
                            </span>
                            <div className="pageFoldRight" />
                          </div>

                          <div
                            className="pageFace back"
                            onDoubleClick={(e) => {
                              if (backPageNum <= numPages) {
                                e.stopPropagation();
                                openPageFocus(backPageNum, e.clientX, e.clientY, e.currentTarget);
                              }
                            }}
                            onPointerUp={(e) => handlePageTapPointerUp(backPageNum, e)}
                          >
                            {renderPageContent(backPageNum, 'End of Volume')}
                            <span className="absolute bottom-2 left-3 text-[10px] font-mono tabular-nums text-[#78716C]/80 pointer-events-none">
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => toggleBookKeeperAtPage(primarySpreadPage)}
              title={
                keptOnCurrentSpread && keptPage !== null
                  ? `Book Keeper active at Page ${keptPage} — click to clear`
                  : `Place red Book Keeper label on Page ${primarySpreadPage}`
              }
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border backdrop-blur-md transition-colors whitespace-nowrap cursor-pointer ${
                keptOnCurrentSpread
                  ? 'bg-[#b91c1c] hover:bg-[#dc2626] border-[#fca5a5]/40 text-white shadow-[0_6px_18px_rgba(185,28,28,0.45)]'
                  : 'bg-black/45 hover:bg-[#b91c1c]/85 border-white/10 hover:border-[#fca5a5]/35 text-[#fca5a5] hover:text-white'
              }`}
            >
              <Bookmark
                className="w-3.5 h-3.5"
                fill={keptOnCurrentSpread ? 'currentColor' : 'none'}
              />
              <span>
                {keptOnCurrentSpread && keptPage !== null
                  ? `Kept · p.${keptPage}`
                  : `Keep p.${primarySpreadPage}`}
              </span>
            </button>

            {keptPage !== null && !keptOnCurrentSpread ? (
              <button
                type="button"
                onClick={() => {
                  const clamped = Math.max(1, Math.min(numPages, keptPage));
                  setActiveFlipLeaf(null);
                  setCurrentSpread(Math.floor(clamped / 2));
                }}
                title={`Jump to bookmarked Page ${keptPage}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-[#7f1d1d]/75 hover:bg-[#991b1b] border border-[#fca5a5]/25 text-[#fecaca] font-mono tabular-nums transition-colors whitespace-nowrap cursor-pointer"
              >
                Go p.{keptPage}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setSingleZoom((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 backdrop-blur-md transition-colors whitespace-nowrap cursor-pointer"
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
      ) : null}

      {focusAnchor && numPages > 0 ? (
        <FocusedPageOverlay
          anchor={focusAnchor}
          numPages={numPages}
          pageImages={pageImages}
          hiResImages={hiResImages}
          pageErrors={pageErrors}
          keptPage={keptPage}
          onToggleBookmark={(pageNum) => toggleBookKeeperAtPage(pageNum)}
          onRequestHiRes={(pageNum) => {
            void renderPdfPage(pageNum);
            void renderHiResPage(pageNum);
          }}
          onChangePage={(nextPage) => {
            hasInteractedRef.current = true;
            const clamped = Math.max(1, Math.min(numPages, nextPage));
            setActiveFlipLeaf(null);
            setCurrentSpread(Math.floor(clamped / 2));
            void renderPdfPage(clamped);
            void renderHiResPage(clamped);
            setFocusAnchor({ pageNum: clamped, rx: 0.5, ry: 0.24 });
          }}
          onClose={() => setFocusAnchor(null)}
        />
      ) : null}
    </div>
  );
}
