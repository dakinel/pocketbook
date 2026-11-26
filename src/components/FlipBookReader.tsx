import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { Bookmark, ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import type { BookKeeperColor, ReadingStatus, VaultBook } from '../types.ts';
import {
  BOOK_KEEPER_COLORS,
  BOOK_KEEPER_PALETTE,
  getBookKeeperRibbonStyle,
  getKeptPage,
  resolveBookKeeperColor,
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
  const [keeperRevealed, setKeeperRevealed] = useState(false);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(() =>
    getCachedPdfCoverSync(book.id, book.sizeBytes)
  );

  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderedSetRef = useRef<Set<number>>(new Set());
  const pageOrderRef = useRef<number[]>([]);
  const inFlightSetRef = useRef<Set<number>>(new Set());
  const hiResSetRef = useRef<Set<number>>(new Set());
  const hiResInFlightRef = useRef<Set<number>>(new Set());
  const hiResOrderRef = useRef<number[]>([]);
  const currentSpreadRef = useRef(0);
  const keptPageRef = useRef<number | null>(null);
  const focusPageRef = useRef<number | null>(null);
  const flipTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const hasInteractedRef = useRef(false);
  const pendingCommittedPageRef = useRef<number | null>(null);
  const bookRef = useRef(book);
  const onBookUpdateRef = useRef(onBookUpdate);
  const lastPageTapRef = useRef<{ time: number; x: number; y: number; pageNum: number } | null>(null);
  const suppressClickUntilRef = useRef(0);
  const spreadSwipeRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    bookRef.current = book;
    onBookUpdateRef.current = onBookUpdate;
  }, [book, onBookUpdate]);

  useEffect(() => {
    currentSpreadRef.current = currentSpread;
    keptPageRef.current = getKeptPage(progress);
    focusPageRef.current = focusAnchor?.pageNum ?? null;
  }, [currentSpread, progress, focusAnchor]);

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
    setKeeperRevealed(false);
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
          keeperColor: nextProgress.keeperColor,
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
            keeperColor: nextProgress.keeperColor,
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
    pendingCommittedPageRef.current = null;
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
    pageOrderRef.current = [];
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
      rangeChunkSize: 65536,
      disableAutoFetch: true,
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
      if (pdfDocRef.current !== doc) return;

      renderedSetRef.current.add(pageNum);
      pageOrderRef.current = [...pageOrderRef.current.filter((p) => p !== pageNum), pageNum];

      const evictedPages: number[] = [];
      if (pageOrderRef.current.length > 24) {
        const minKeep = currentSpreadRef.current * 2 - 4;
        const maxKeep = currentSpreadRef.current * 2 + 5;
        for (let i = 0; i < pageOrderRef.current.length && pageOrderRef.current.length - evictedPages.length > 24; i++) {
          const candidate = pageOrderRef.current[i];
          const isProtected =
            (candidate >= minKeep && candidate <= maxKeep) ||
            candidate === keptPageRef.current ||
            candidate === focusPageRef.current;
          if (!isProtected) {
            evictedPages.push(candidate);
          }
        }
        if (evictedPages.length > 0) {
          const evictSet = new Set(evictedPages);
          pageOrderRef.current = pageOrderRef.current.filter((p) => !evictSet.has(p));
          for (const p of evictedPages) {
            renderedSetRef.current.delete(p);
          }
        }
      }

      setPageImages((prev) => {
        const next = { ...prev, [pageNum]: dataUrl };
        for (const p of evictedPages) {
          delete next[p];
        }
        return next;
      });
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

  const commitPageProgress = useCallback(
    (
      targetPage: number,
      options?: {
        bookmarkedPage?: number | null;
        keeperColor?: BookKeeperColor | null;
        status?: ReadingStatus;
        immediate?: boolean;
        forceLastPage?: boolean;
      }
    ) => {
      if (numPages <= 0) return;
      const clampedPage = Math.max(1, Math.min(numPages, targetPage));
      const now = new Date().toISOString();
      setProgress((prev) => {
        const nextLastPage = options?.forceLastPage
          ? clampedPage
          : Math.max(prev.lastPage, clampedPage);
        const nextBookmark =
          options && 'bookmarkedPage' in options
            ? (options.bookmarkedPage ?? null)
            : prev.bookmarkedPage;
        const nextKeeperColor =
          options && 'keeperColor' in options
            ? (options.keeperColor ?? null)
            : prev.keeperColor;
        const nextStatus: ReadingStatus =
          options?.status ??
          (prev.readingStatus === 'completed'
            ? 'completed'
            : nextLastPage >= 2 || nextBookmark !== null
              ? 'reading'
              : 'unread');
        const nextState: BookProgressState = {
          lastPage: nextLastPage,
          totalPages: numPages,
          bookmarkedPage: nextBookmark,
          keeperColor: nextKeeperColor,
          readingStatus: nextStatus,
          updatedAt: now,
        };
        persistProgressToServer(book.id, nextState, options?.immediate);
        return nextState;
      });
    },
    [book.id, numPages, persistProgressToServer]
  );

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
      hasInteractedRef.current = true;
      commitPageProgress(pageNum);
      setFocusAnchor({ pageNum, rx, ry });
    },
    [commitPageProgress, numPages, renderHiResPage, renderPdfPage]
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
    let cancelled = false;
    const primary: number[] = [];
    if (currentSpread === 0) {
      primary.push(1);
    } else {
      primary.push(currentSpread * 2, currentSpread * 2 + 1);
    }
    const ordered: number[] = [];
    const seen = new Set<number>();
    const pushIfValid = (p: number) => {
      if (p >= 1 && p <= numPages && !seen.has(p)) {
        seen.add(p);
        ordered.push(p);
      }
    };
    for (const p of primary) pushIfValid(p);
    for (let offset = 1; offset <= 4; offset++) {
      pushIfValid(currentSpread * 2 + 1 + offset);
      pushIfValid(currentSpread * 2 - offset);
    }

    let cursor = 0;
    const workerCount = 2;
    const runWorker = async () => {
      while (!cancelled && cursor < ordered.length) {
        const nextPage = ordered[cursor++];
        await renderPdfPage(nextPage);
      }
    };
    for (let w = 0; w < workerCount; w++) {
      void runWorker();
    }
    return () => {
      cancelled = true;
    };
  }, [numPages, currentSpread, renderPdfPage]);

  const primarySpreadPage =
    numPages > 0
      ? currentSpread === 0
        ? 1
        : Math.min(numPages, currentSpread * 2)
      : 1;

  const activeKeeperColor = resolveBookKeeperColor(book.id, progress.keeperColor);

  const selectKeeperColorAtPage = useCallback(
    (nextColor: BookKeeperColor, pageNum: number) => {
      if (numPages <= 0) return;
      const clampedPage = Math.max(1, Math.min(numPages, pageNum));
      hasInteractedRef.current = true;
      const currentKept = getKeptPage(progress);
      const targetBookmark = currentKept ?? clampedPage;
      commitPageProgress(targetBookmark, {
        bookmarkedPage: targetBookmark,
        keeperColor: nextColor,
        status: progress.readingStatus === 'completed' ? 'completed' : 'reading',
        immediate: true,
      });
    },
    [commitPageProgress, numPages, progress]
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
          forceLastPage: true,
        });
      } else {
        commitPageProgress(clampedPage, {
          bookmarkedPage: clampedPage,
          keeperColor: activeKeeperColor,
          status: progress.readingStatus === 'completed' ? 'completed' : 'reading',
          immediate: true,
          forceLastPage: true,
        });
      }
    },
    [activeKeeperColor, commitPageProgress, currentSpread, numPages, primarySpreadPage, progress]
  );

  useEffect(() => {
    const pendingPage = pendingCommittedPageRef.current;
    pendingCommittedPageRef.current = null;
    const activePage =
      pendingPage !== null
        ? Math.max(1, Math.min(Math.max(1, numPages), pendingPage))
        : currentSpread === 0
          ? 1
          : Math.min(Math.max(1, numPages), currentSpread * 2);
    setJumpValue(String(activePage));
    if (numPages > 0 && hasInteractedRef.current) {
      commitPageProgress(activePage);
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
    pendingCommittedPageRef.current = clamped;
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
  const displayKeptPage =
    keptOnCurrentSpread && keptPage !== null
      ? keptPage
      : progress.bookmarkedPage === null &&
          progress.lastPage <= 1 &&
          currentSpread === 0 &&
          numPages > 0
        ? 1
        : null;
  const displayKeptOnLeft = displayKeptPage !== null && zoomedLeftPage === displayKeptPage;
  const displayKeptOnRight = displayKeptPage !== null && zoomedRightPage === displayKeptPage;

  const pageIsOpen = singleZoom
    ? stageArrived && !loadingDoc && !docError
    : coverFading && activeFlipLeaf === null && !loadingDoc && !docError;

  useEffect(() => {
    setKeeperRevealed(false);
    if (!pageIsOpen || displayKeptPage === null || closing) {
      return;
    }
    const timer = window.setTimeout(() => {
      setKeeperRevealed(true);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [pageIsOpen, displayKeptPage, currentSpread, closing]);

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
        <div className="w-[min(94vw,900px)] h-[min(64dvh,690px)] sm:w-[min(92vw,900px)] sm:h-[min(78dvh,690px)] bg-[#141210] rounded-xl p-2 sm:p-3 shadow-2xl flex flex-col">
          <div className="flex-1 overflow-y-auto bg-[#e9e5dc] rounded p-2.5 sm:p-4 space-y-3 sm:space-y-4">
            {zoomedLeftPage ? (
              <div
                className="relative bg-white shadow mx-auto max-w-2xl cursor-zoom-in"
                title="Double-click to focus & read"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openPageFocus(zoomedLeftPage, e.clientX, e.clientY, e.currentTarget);
                }}
                onPointerUp={(e) => handlePageTapPointerUp(zoomedLeftPage, e)}
              >
                {keeperRevealed && displayKeptOnLeft && displayKeptPage !== null ? (
                  <button
                    key={`zoom-keeper-${displayKeptPage}`}
                    type="button"
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBookKeeperAtPage(displayKeptPage);
                    }}
                    style={getBookKeeperRibbonStyle(activeKeeperColor)}
                    title={`${BOOK_KEEPER_PALETTE[activeKeeperColor].label} Book Keeper at Page ${displayKeptPage} — click to toggle`}
                    aria-label={`Bookmark at Page ${displayKeptPage}`}
                    className="reader-book-keeper-ribbon is-compact absolute top-0 left-4 z-20 flex flex-col items-center justify-end cursor-pointer"
                  >
                    <span
                      style={{ color: BOOK_KEEPER_PALETTE[activeKeeperColor].text }}
                      className="text-[8px] font-mono font-bold tabular-nums leading-none"
                    >
                      p.{displayKeptPage}
                    </span>
                  </button>
                ) : null}
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
                className="relative bg-white shadow mx-auto max-w-2xl cursor-zoom-in"
                title="Double-click to focus & read"
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openPageFocus(zoomedRightPage, e.clientX, e.clientY, e.currentTarget);
                }}
                onPointerUp={(e) => handlePageTapPointerUp(zoomedRightPage, e)}
              >
                {keeperRevealed && displayKeptOnRight && displayKeptPage !== null ? (
                  <button
                    key={`zoom-keeper-${displayKeptPage}`}
                    type="button"
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBookKeeperAtPage(displayKeptPage);
                    }}
                    style={getBookKeeperRibbonStyle(activeKeeperColor)}
                    title={`${BOOK_KEEPER_PALETTE[activeKeeperColor].label} Book Keeper at Page ${displayKeptPage} — click to toggle`}
                    aria-label={`Bookmark at Page ${displayKeptPage}`}
                    className="reader-book-keeper-ribbon is-compact absolute top-0 right-4 z-20 flex flex-col items-center justify-end cursor-pointer"
                  >
                    <span
                      style={{ color: BOOK_KEEPER_PALETTE[activeKeeperColor].text }}
                      className="text-[8px] font-mono font-bold tabular-nums leading-none"
                    >
                      p.{displayKeptPage}
                    </span>
                  </button>
                ) : null}
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
        <div
          className={`bookWrapper ${coverOpened ? 'is-spread-open' : ''}`}
          onTouchStart={(e) => {
            if (e.touches.length === 1) {
              spreadSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            } else {
              spreadSwipeRef.current = null;
            }
          }}
          onTouchEnd={(e) => {
            const start = spreadSwipeRef.current;
            spreadSwipeRef.current = null;
            if (!start || e.changedTouches.length !== 1) return;
            const dx = e.changedTouches[0].clientX - start.x;
            const dy = e.changedTouches[0].clientY - start.y;
            if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.35) {
              suppressClickUntilRef.current = performance.now() + 360;
              if (dx < 0) {
                turnNext();
              } else {
                turnPrev();
              }
            }
          }}
        >
          <div className="bookBg">
            <div className="bookBoardLeft" aria-hidden="true" />
            <div className="bookBoardRight" aria-hidden="true" />
            <div className="pageBg">
              <div className="baseLeft">
                <div className="w-full h-full flex flex-col items-center justify-center p-3 sm:p-10 text-center">
                  <p className="text-[9px] sm:text-[11px] font-mono uppercase tracking-widest text-[#78716C]">
                    Folio Edition
                  </p>
                  <h3 className="mt-1.5 sm:mt-3 font-serif text-sm sm:text-2xl font-medium text-[#1A1816] max-w-xs line-clamp-3 [text-wrap:balance]">
                    {book.title}
                  </h3>
                  <p className="mt-1 sm:mt-2 text-[11px] sm:text-sm text-[#57534E] line-clamp-1 max-w-full">
                    {book.author}
                  </p>
                  <div className="mt-3 sm:mt-6 pt-2 sm:pt-4 border-t border-[#E5E0D5] text-[10px] sm:text-xs font-mono tabular-nums text-[#78716C]">
                    {numPages > 0 ? `${numPages} Pages` : 'Loading...'}
                  </div>
                  <p className="mt-2 sm:mt-4 text-[10px] sm:text-[11px] text-[#78716C] hidden sm:block">
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
                      {book.coverPath || coverPreviewUrl || pageImages[1] ? (
                        <img
                          src={book.coverPath || coverPreviewUrl || pageImages[1] || ''}
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

              {keeperRevealed && displayKeptPage !== null && (displayKeptOnLeft || displayKeptOnRight) ? (
                <button
                  key={`spread-keeper-${displayKeptPage}-${displayKeptOnLeft ? 'L' : 'R'}`}
                  type="button"
                  onClick={() => toggleBookKeeperAtPage(displayKeptPage)}
                  style={getBookKeeperRibbonStyle(activeKeeperColor)}
                  title={
                    keptPage === displayKeptPage
                      ? `${BOOK_KEEPER_PALETTE[activeKeeperColor].label} Book Keeper at Page ${displayKeptPage} — click to remove`
                      : `Place ${BOOK_KEEPER_PALETTE[activeKeeperColor].label} Book Keeper at Page ${displayKeptPage}`
                  }
                  aria-label={`Toggle Book Keeper at Page ${displayKeptPage}`}
                  className={`reader-book-keeper-ribbon absolute -top-2 z-[120] flex flex-col items-center justify-end cursor-pointer ${
                    displayKeptOnLeft ? 'left-[10%]' : 'right-[10%]'
                  }`}
                >
                  <span
                    style={{ color: BOOK_KEEPER_PALETTE[activeKeeperColor].text }}
                    className="text-[9px] font-mono font-bold tabular-nums leading-none"
                  >
                    p.{displayKeptPage}
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {!docError && numPages > 0 ? (
        <div
          className={`mt-3 sm:mt-4 flex flex-wrap items-center justify-center sm:justify-between gap-2 sm:gap-3 w-[min(94vw,1080px)] sm:w-[min(92vw,1080px)] text-xs text-white/85 transition-opacity duration-500 ${
            coverOpened ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={currentSpread <= 0}
              onClick={turnPrev}
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 disabled:opacity-35 backdrop-blur-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="sm:hidden">Prev</span>
              <span className="hidden sm:inline">Previous Page</span>
            </button>
            <button
              type="button"
              disabled={currentSpread >= totalLeaves}
              onClick={turnNext}
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 disabled:opacity-35 backdrop-blur-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <span className="sm:hidden">Next</span>
              <span className="hidden sm:inline">Next Page</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5 sm:gap-2">
            <label htmlFor="flipbook-page-input" className="text-white/75 hidden sm:inline">
              Page
            </label>
            <input
              id="flipbook-page-input"
              type="number"
              min={1}
              max={numPages}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              className="w-12 sm:w-16 rounded-md bg-black/45 border border-white/15 px-1.5 sm:px-2 py-1 text-center font-mono tabular-nums text-white focus:outline-none focus:border-[#f3c677]"
            />
            <span className="font-mono tabular-nums text-white/75">/ {numPages}</span>
            <button
              type="submit"
              className="px-2 sm:px-2.5 py-1 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 text-white font-medium transition-colors cursor-pointer"
            >
              Go
            </button>
          </form>

          <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => toggleBookKeeperAtPage(primarySpreadPage)}
              style={
                keptOnCurrentSpread
                  ? {
                      backgroundColor: BOOK_KEEPER_PALETTE[activeKeeperColor].buttonBg,
                      borderColor: BOOK_KEEPER_PALETTE[activeKeeperColor].buttonBorder,
                      color: '#ffffff',
                      boxShadow: BOOK_KEEPER_PALETTE[activeKeeperColor].glow,
                    }
                  : {
                      color: BOOK_KEEPER_PALETTE[activeKeeperColor].buttonMutedText,
                    }
              }
              title={
                keptOnCurrentSpread && keptPage !== null
                  ? `Book Keeper active at Page ${keptPage} — click to clear`
                  : `Place ${BOOK_KEEPER_PALETTE[activeKeeperColor].label} Book Keeper on Page ${primarySpreadPage}`
              }
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md border backdrop-blur-md transition-colors whitespace-nowrap cursor-pointer ${
                keptOnCurrentSpread
                  ? ''
                  : 'bg-black/45 hover:bg-black/70 border-white/10 hover:text-white'
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

            <div
              role="group"
              aria-label="Book Keeper ribbon color"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-black/45 border border-white/10 backdrop-blur-md"
            >
              {BOOK_KEEPER_COLORS.map((c) => {
                const entry = BOOK_KEEPER_PALETTE[c];
                const active = activeKeeperColor === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => selectKeeperColorAtPage(c, primarySpreadPage)}
                    title={`${entry.label} Book Keeper`}
                    aria-label={`Use ${entry.label} Book Keeper`}
                    aria-pressed={active}
                    style={{ backgroundColor: entry.swatch }}
                    className={`w-3.5 h-3.5 rounded-full transition-transform cursor-pointer ${
                      active
                        ? 'ring-2 ring-white ring-offset-1 ring-offset-black/70 scale-110'
                        : 'opacity-75 hover:opacity-100 hover:scale-110'
                    }`}
                  />
                );
              })}
            </div>

            {keptPage !== null && !keptOnCurrentSpread ? (
              <button
                type="button"
                onClick={() => {
                  const clamped = Math.max(1, Math.min(numPages, keptPage));
                  setActiveFlipLeaf(null);
                  setCurrentSpread(Math.floor(clamped / 2));
                }}
                style={{
                  backgroundColor: BOOK_KEEPER_PALETTE[activeKeeperColor].jumpBg,
                  borderColor: BOOK_KEEPER_PALETTE[activeKeeperColor].buttonBorder,
                  color: BOOK_KEEPER_PALETTE[activeKeeperColor].jumpText,
                }}
                title={`Jump to bookmarked Page ${keptPage}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border font-mono tabular-nums transition-opacity hover:opacity-90 whitespace-nowrap cursor-pointer"
              >
                Go p.{keptPage}
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => setSingleZoom((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 backdrop-blur-md transition-colors whitespace-nowrap cursor-pointer"
            >
              {singleZoom ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span className="sm:hidden">3D Book</span>
                  <span className="hidden sm:inline">3D Spread View</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span className="sm:hidden">Single Page</span>
                  <span className="hidden sm:inline">Zoom Single Pages</span>
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
          keptPage={displayKeptPage ?? keptPage}
          keeperColor={activeKeeperColor}
          onToggleBookmark={(pageNum) => toggleBookKeeperAtPage(pageNum)}
          onSelectKeeperColor={(color, pageNum) => selectKeeperColorAtPage(color, pageNum)}
          onRequestHiRes={(pageNum) => {
            void renderPdfPage(pageNum);
            void renderHiResPage(pageNum);
          }}
          onChangePage={(nextPage) => {
            hasInteractedRef.current = true;
            const clamped = Math.max(1, Math.min(numPages, nextPage));
            const targetSpread = Math.floor(clamped / 2);
            pendingCommittedPageRef.current = clamped;
            setActiveFlipLeaf(null);
            setCurrentSpread(targetSpread);
            if (targetSpread === currentSpread) {
              pendingCommittedPageRef.current = null;
              commitPageProgress(clamped);
            }
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
