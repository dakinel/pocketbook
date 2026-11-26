import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Circle,
  Highlighter,
  Loader2,
  Maximize2,
  Minimize2,
  PenTool,
  ZoomIn,
} from 'lucide-react';
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
import {
  extractBookBindingThemeFromImage,
  getBookBindingCssVars,
  getCachedBookBindingTheme,
  type BookBindingTheme,
} from '../utils/coverColorTheme.ts';
import {
  FocusedPageOverlay,
  FolioPenCursor,
  PageAnnotationsLayer,
  type DraftPageStroke,
  type FocusAnchor,
  type PageAnnotation,
  type PageAnnotationPoint,
  type PenToolMode,
} from './FocusedPageOverlay.tsx';

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

const PAGE_ANNOTATIONS_PREFIX = 'folio-page-annotations-v1:';

function loadBookAnnotations(bookId: string): PageAnnotation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${PAGE_ANNOTATIONS_PREFIX}${bookId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is PageAnnotation =>
          item &&
          typeof item.id === 'string' &&
          typeof item.pageNum === 'number' &&
          (item.type === 'mark' || item.type === 'circle') &&
          typeof item.rx === 'number' &&
          typeof item.ry === 'number'
      )
      .map((item) => ({
        ...item,
        points: Array.isArray(item.points)
          ? item.points.filter(
              (pt): pt is PageAnnotationPoint =>
                Boolean(pt) && typeof pt.x === 'number' && typeof pt.y === 'number'
            )
          : undefined,
      }));
  } catch {
    return [];
  }
}

function saveBookAnnotations(bookId: string, annotations: PageAnnotation[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${PAGE_ANNOTATIONS_PREFIX}${bookId}`,
      JSON.stringify(annotations)
    );
  } catch {
    // Ignore storage quota errors
  }
}

function SpreadPageSurface({
  src,
  alt,
  annotations,
  freshIds,
  interactiveAnnotations = true,
  draftStroke = null,
  onRemoveAnnotation,
}: {
  src: string;
  alt: string;
  annotations: PageAnnotation[];
  freshIds?: Set<string>;
  interactiveAnnotations?: boolean;
  draftStroke?: { type: 'mark' | 'circle'; points: PageAnnotationPoint[] } | null;
  onRemoveAnnotation: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(0.77);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const style = window.getComputedStyle(el);
      const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      setBoxSize({
        w: Math.max(0, el.clientWidth - padX),
        h: Math.max(0, el.clientHeight - padY),
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (boxSize.w <= 0 || boxSize.h <= 0 || aspect <= 0) return undefined;
    let w = boxSize.w;
    let h = w / aspect;
    if (h > boxSize.h) {
      h = boxSize.h;
      w = h * aspect;
    }
    return { width: `${Math.round(w)}px`, height: `${Math.round(h)}px` };
  }, [boxSize.w, boxSize.h, aspect]);

  return (
    <div ref={hostRef} className="w-full h-full p-2 sm:p-3 flex items-center justify-center">
      <div style={fitStyle} className="relative shrink-0">
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) {
              setAspect(naturalWidth / naturalHeight);
            }
          }}
          className="w-full h-full object-contain block select-none"
        />
        <PageAnnotationsLayer
          annotations={annotations}
          freshIds={freshIds}
          interactive={interactiveAnnotations}
          draftStroke={draftStroke}
          onRemove={onRemoveAnnotation}
        />
      </div>
    </div>
  );
}

interface TapMenuAnchor {
  pageNum: number;
  rx: number;
  ry: number;
  screenX: number;
  screenY: number;
}

function DoubleTapFabMenu({
  anchor,
  onZoom,
  onMark,
  onCircle,
  onClose,
}: {
  anchor: TapMenuAnchor;
  onZoom: () => void;
  onMark: () => void;
  onCircle: () => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setActive(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [anchor]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const clampedX = Math.max(92, Math.min(vw - 92, anchor.screenX));
  const clampedY = Math.max(115, Math.min(vh - 46, anchor.screenY));

  const menuContent = (
    <div
      className="fixed inset-0 z-[95]"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        style={{
          position: 'fixed',
          left: `${Math.round(clampedX)}px`,
          top: `${Math.round(clampedY)}px`,
          transform: 'translate(-50%, -50%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`folio-fab-container ${active ? 'active' : ''}`}
          role="menu"
          aria-label={`Page ${anchor.pageNum} quick options`}
        >
          <span className="folio-fab-ripple" aria-hidden="true" />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close page options"
            title="Close options"
            className="folio-fab-button"
          >
            <span className="folio-fab-pen" aria-hidden="true">
              <PenTool className="w-[22px] h-[22px]" strokeWidth={2.1} />
            </span>
          </button>

          <div className="folio-fab-options">
            <button
              type="button"
              role="menuitem"
              title="Zoom"
              aria-label="Zoom page"
              onClick={(e) => {
                e.stopPropagation();
                onZoom();
              }}
              className="folio-fab-option folio-fab-opt-zoom"
            >
              <ZoomIn className="w-[18px] h-[18px]" strokeWidth={2.2} />
              <span className="text-[9px] font-semibold leading-none tracking-tight">Zoom</span>
            </button>

            <button
              type="button"
              role="menuitem"
              title="Mark"
              aria-label="Mark highlight on page"
              onClick={(e) => {
                e.stopPropagation();
                onMark();
              }}
              className="folio-fab-option folio-fab-opt-mark"
            >
              <Highlighter className="w-[18px] h-[18px]" strokeWidth={2.2} />
              <span className="text-[9px] font-semibold leading-none tracking-tight">Mark</span>
            </button>

            <button
              type="button"
              role="menuitem"
              title="Circle"
              aria-label="Circle on page"
              onClick={(e) => {
                e.stopPropagation();
                onCircle();
              }}
              className="folio-fab-option folio-fab-opt-circle"
            >
              <Circle className="w-[18px] h-[18px]" strokeWidth={2.3} />
              <span className="text-[9px] font-semibold leading-none tracking-tight">Circle</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(menuContent, document.body);
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
  const [tapMenu, setTapMenu] = useState<TapMenuAnchor | null>(null);
  const [activePenTool, setActivePenTool] = useState<PenToolMode>(null);
  const [draftStroke, setDraftStroke] = useState<DraftPageStroke | null>(null);
  const [freshAnnotationIds, setFreshAnnotationIds] = useState<Set<string>>(() => new Set());
  const [annotations, setAnnotations] = useState<PageAnnotation[]>(() =>
    loadBookAnnotations(book.id)
  );
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
  const [bindingTheme, setBindingTheme] = useState<BookBindingTheme | null>(() =>
    getCachedBookBindingTheme(book.id, book.sizeBytes)
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
  const lastTapMenuOpenedAtRef = useRef(0);
  const suppressClickUntilRef = useRef(0);
  const spreadSwipeRef = useRef<{ x: number; y: number } | null>(null);
  const strokeDraftRef = useRef<{
    pointerId: number;
    pageNum: number;
    type: 'mark' | 'circle';
    points: PageAnnotationPoint[];
    totalDist: number;
  } | null>(null);
  const freshTimersRef = useRef<number[]>([]);

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
    setBindingTheme(getCachedBookBindingTheme(book.id, book.sizeBytes));

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
      setTapMenu(null);
      setActivePenTool(null);
      setDraftStroke(null);
      strokeDraftRef.current = null;
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
    setAnnotations(loadBookAnnotations(bookRef.current.id));
    setLoadingDoc(true);
    setDocError(null);
    setNumPages(0);
    setCurrentSpread(0);
    setActiveFlipLeaf(null);
    setPageImages({});
    setHiResImages({});
    setFocusAnchor(null);
    setTapMenu(null);
    setActivePenTool(null);
    setDraftStroke(null);
    strokeDraftRef.current = null;
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

  const openPageFocusAtNormalized = useCallback(
    (pageNum: number, rx: number, ry: number) => {
      if (pageNum < 1 || pageNum > numPages) return;
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      void renderPdfPage(pageNum);
      void renderHiResPage(pageNum);
      hasInteractedRef.current = true;
      commitPageProgress(pageNum);
      setFocusAnchor({ pageNum, rx, ry });
    },
    [commitPageProgress, numPages, renderHiResPage, renderPdfPage]
  );

  const openTapOptionsMenu = useCallback(
    (pageNum: number, clientX: number, clientY: number, containerEl: HTMLElement) => {
      if (pageNum < 1 || pageNum > numPages) return;
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      const now = performance.now();
      if (now - lastTapMenuOpenedAtRef.current < 220) {
        return;
      }
      lastTapMenuOpenedAtRef.current = now;
      const { rx, ry } = computeImageNormalizedPoint(containerEl, clientX, clientY);
      setTapMenu({
        pageNum,
        rx,
        ry,
        screenX: clientX,
        screenY: clientY,
      });
    },
    [numPages]
  );

  useEffect(() => {
    return () => {
      for (const timer of freshTimersRef.current) {
        window.clearTimeout(timer);
      }
      freshTimersRef.current = [];
    };
  }, []);

  const markFreshAnnotation = useCallback((id: string) => {
    setFreshAnnotationIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const timer = window.setTimeout(() => {
      setFreshAnnotationIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 820);
    freshTimersRef.current.push(timer);
  }, []);

  const toggleAnnotationAtPoint = useCallback(
    (type: 'mark' | 'circle', pageNum: number, rx: number, ry: number) => {
      let addedId: string | null = null;
      setAnnotations((prev) => {
        const existingIndex = prev.findIndex(
          (item) =>
            !item.points &&
            item.pageNum === pageNum &&
            item.type === type &&
            Math.hypot(item.rx - rx, item.ry - ry) < 0.055
        );
        if (existingIndex >= 0) {
          const next = prev.filter((_, idx) => idx !== existingIndex);
          saveBookAnnotations(book.id, next);
          return next;
        }
        addedId = `${type}-${pageNum}-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const next = [
          ...prev,
          {
            id: addedId,
            pageNum,
            type,
            rx,
            ry,
          },
        ];
        saveBookAnnotations(book.id, next);
        return next;
      });
      if (addedId) {
        markFreshAnnotation(addedId);
      }
    },
    [book.id, markFreshAnnotation]
  );

  const addFreehandAnnotation = useCallback(
    (type: 'mark' | 'circle', pageNum: number, points: PageAnnotationPoint[]) => {
      if (points.length < 2) return;
      const sum = points.reduce(
        (acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }),
        { x: 0, y: 0 }
      );
      const rx = sum.x / points.length;
      const ry = sum.y / points.length;
      const id = `${type}-stroke-${pageNum}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      setAnnotations((prev) => {
        const next = [...prev, { id, pageNum, type, rx, ry, points }];
        saveBookAnnotations(book.id, next);
        return next;
      });
      markFreshAnnotation(id);
    },
    [book.id, markFreshAnnotation]
  );

  const removeAnnotationById = useCallback(
    (id: string) => {
      setAnnotations((prev) => {
        const next = prev.filter((item) => item.id !== id);
        saveBookAnnotations(book.id, next);
        return next;
      });
    },
    [book.id]
  );

  const handlePageTapPointerUp = useCallback(
    (pageNum: number, e: React.PointerEvent<HTMLElement>) => {
      if (activePenTool !== null || e.pointerType !== 'touch' || pageNum < 1 || pageNum > numPages) return;
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
        openTapOptionsMenu(pageNum, e.clientX, e.clientY, e.currentTarget);
      } else {
        lastPageTapRef.current = { time: now, x: e.clientX, y: e.clientY, pageNum };
      }
    },
    [activePenTool, numPages, openTapOptionsMenu]
  );

  const handlePageSurfacePointerDown = useCallback(
    (pageNum: number, e: React.PointerEvent<HTMLElement>) => {
      if (!activePenTool || pageNum < 1 || pageNum > numPages) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture failure
      }
      const { rx, ry } = computeImageNormalizedPoint(e.currentTarget, e.clientX, e.clientY);
      const firstPt: PageAnnotationPoint = { x: rx, y: ry };
      strokeDraftRef.current = {
        pointerId: e.pointerId,
        pageNum,
        type: activePenTool,
        points: [firstPt],
        totalDist: 0,
      };
      setDraftStroke({ pageNum, type: activePenTool, points: [firstPt] });
    },
    [activePenTool, numPages]
  );

  const handlePageSurfacePointerMove = useCallback(
    (pageNum: number, e: React.PointerEvent<HTMLElement>) => {
      const draft = strokeDraftRef.current;
      if (!draft || draft.pointerId !== e.pointerId || draft.pageNum !== pageNum) return;
      const { rx, ry } = computeImageNormalizedPoint(e.currentTarget, e.clientX, e.clientY);
      const prev = draft.points[draft.points.length - 1];
      const seg = Math.hypot(rx - prev.x, ry - prev.y);
      if (seg < 0.004) return;
      draft.points.push({ x: rx, y: ry });
      draft.totalDist += seg;
      setDraftStroke({ pageNum, type: draft.type, points: [...draft.points] });
    },
    []
  );

  const handlePageSurfacePointerUp = useCallback(
    (pageNum: number, e: React.PointerEvent<HTMLElement>) => {
      const draft = strokeDraftRef.current;
      if (draft && draft.pointerId === e.pointerId) {
        e.stopPropagation();
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        strokeDraftRef.current = null;
        setDraftStroke(null);
        suppressClickUntilRef.current = performance.now() + 360;
        if (draft.totalDist < 0.022 || draft.points.length < 2) {
          const origin = draft.points[0];
          if (origin) {
            toggleAnnotationAtPoint(draft.type, pageNum, origin.x, origin.y);
          }
        } else {
          addFreehandAnnotation(draft.type, pageNum, draft.points);
        }
        return;
      }
      handlePageTapPointerUp(pageNum, e);
    },
    [addFreehandAnnotation, handlePageTapPointerUp, toggleAnnotationAtPoint]
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
    setTapMenu(null);
    hasInteractedRef.current = true;
    const turningLeaf = currentSpread;
    setActiveFlipLeaf(turningLeaf);
    setCurrentSpread((prev) => Math.min(totalLeaves, prev + 1));
    if (flipTimerRef.current !== null) window.clearTimeout(flipTimerRef.current);
    flipTimerRef.current = window.setTimeout(() => setActiveFlipLeaf(null), 820);
  }, [currentSpread, totalLeaves]);

  const turnPrev = useCallback(() => {
    if (currentSpread <= 0) return;
    setTapMenu(null);
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
      if (e.key === 'Escape' && activePenTool && !tapMenu && !focusAnchor) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setActivePenTool(null);
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
  }, [activePenTool, focusAnchor, tapMenu, turnNext, turnPrev]);

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
        <SpreadPageSurface
          src={pageImages[pageNum]}
          alt={`Page ${pageNum}`}
          annotations={annotations.filter((item) => item.pageNum === pageNum)}
          freshIds={freshAnnotationIds}
          interactiveAnnotations={activePenTool === null}
          draftStroke={
            draftStroke && draftStroke.pageNum === pageNum
              ? { type: draftStroke.type, points: draftStroke.points }
              : null
          }
          onRemoveAnnotation={removeAnnotationById}
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
        <div
          style={
            bindingTheme
              ? {
                  background: `linear-gradient(145deg, ${bindingTheme.boardHi} 0%, ${bindingTheme.boardLo} 100%)`,
                  boxShadow: `0 25px 50px -12px rgba(0, 0, 0, 0.72), inset 0 1px 0 ${bindingTheme.boardBorder}`,
                }
              : undefined
          }
          className="w-[min(94vw,900px)] h-[min(64dvh,690px)] sm:w-[min(92vw,900px)] sm:h-[min(78dvh,690px)] bg-[#141210] rounded-xl p-2 sm:p-3 shadow-2xl flex flex-col transition-colors duration-500"
        >
          <div className="flex-1 overflow-y-auto bg-[#e9e5dc] rounded p-2.5 sm:p-4 space-y-3 sm:space-y-4">
            {zoomedLeftPage ? (
              <div
                className={`folio-pen-surface relative bg-white shadow mx-auto max-w-2xl ${
                  activePenTool ? 'touch-none' : ''
                }`}
                title={activePenTool ? 'Drag or tap with pen' : 'Double-click for page options'}
                onDoubleClick={(e) => {
                  if (activePenTool) return;
                  e.stopPropagation();
                  openTapOptionsMenu(zoomedLeftPage, e.clientX, e.clientY, e.currentTarget);
                }}
                onPointerDown={(e) => handlePageSurfacePointerDown(zoomedLeftPage, e)}
                onPointerMove={(e) => handlePageSurfacePointerMove(zoomedLeftPage, e)}
                onPointerUp={(e) => handlePageSurfacePointerUp(zoomedLeftPage, e)}
                onPointerCancel={(e) => handlePageSurfacePointerUp(zoomedLeftPage, e)}
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
                  <>
                    <img
                      src={pageImages[zoomedLeftPage]}
                      alt={`Page ${zoomedLeftPage}`}
                      draggable={false}
                      className="w-full h-auto block select-none"
                    />
                    <PageAnnotationsLayer
                      annotations={annotations.filter((item) => item.pageNum === zoomedLeftPage)}
                      freshIds={freshAnnotationIds}
                      interactive={activePenTool === null}
                      draftStroke={
                        draftStroke && draftStroke.pageNum === zoomedLeftPage
                          ? { type: draftStroke.type, points: draftStroke.points }
                          : null
                      }
                      onRemove={removeAnnotationById}
                    />
                  </>
                ) : (
                  <div className="py-24 text-center text-xs text-[#78716C]">
                    Rendering Page {zoomedLeftPage}...
                  </div>
                )}
              </div>
            ) : null}
            {zoomedRightPage ? (
              <div
                className={`folio-pen-surface relative bg-white shadow mx-auto max-w-2xl ${
                  activePenTool ? 'touch-none' : ''
                }`}
                title={activePenTool ? 'Drag or tap with pen' : 'Double-click for page options'}
                onDoubleClick={(e) => {
                  if (activePenTool) return;
                  e.stopPropagation();
                  openTapOptionsMenu(zoomedRightPage, e.clientX, e.clientY, e.currentTarget);
                }}
                onPointerDown={(e) => handlePageSurfacePointerDown(zoomedRightPage, e)}
                onPointerMove={(e) => handlePageSurfacePointerMove(zoomedRightPage, e)}
                onPointerUp={(e) => handlePageSurfacePointerUp(zoomedRightPage, e)}
                onPointerCancel={(e) => handlePageSurfacePointerUp(zoomedRightPage, e)}
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
                  <>
                    <img
                      src={pageImages[zoomedRightPage]}
                      alt={`Page ${zoomedRightPage}`}
                      draggable={false}
                      className="w-full h-auto block select-none"
                    />
                    <PageAnnotationsLayer
                      annotations={annotations.filter((item) => item.pageNum === zoomedRightPage)}
                      freshIds={freshAnnotationIds}
                      interactive={activePenTool === null}
                      draftStroke={
                        draftStroke && draftStroke.pageNum === zoomedRightPage
                          ? { type: draftStroke.type, points: draftStroke.points }
                          : null
                      }
                      onRemove={removeAnnotationById}
                    />
                  </>
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
          style={getBookBindingCssVars(bindingTheme)}
          className={`bookWrapper ${coverOpened ? 'is-spread-open' : ''}`}
          onTouchStart={(e) => {
            if (activePenTool !== null) {
              spreadSwipeRef.current = null;
              return;
            }
            if (e.touches.length === 1) {
              spreadSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            } else {
              spreadSwipeRef.current = null;
            }
          }}
          onTouchEnd={(e) => {
            if (activePenTool !== null) {
              spreadSwipeRef.current = null;
              return;
            }
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
                            if (activePenTool !== null || performance.now() < suppressClickUntilRef.current) {
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
                            className={`pageFace front folio-pen-surface ${activePenTool ? 'touch-none' : ''}`}
                            onDoubleClick={(e) => {
                              if (activePenTool === null && frontPageNum <= numPages) {
                                e.stopPropagation();
                                openTapOptionsMenu(frontPageNum, e.clientX, e.clientY, e.currentTarget);
                              }
                            }}
                            onPointerDown={(e) => handlePageSurfacePointerDown(frontPageNum, e)}
                            onPointerMove={(e) => handlePageSurfacePointerMove(frontPageNum, e)}
                            onPointerUp={(e) => handlePageSurfacePointerUp(frontPageNum, e)}
                            onPointerCancel={(e) => handlePageSurfacePointerUp(frontPageNum, e)}
                          >
                            {renderPageContent(frontPageNum, 'Blank Endpaper')}
                            <span className="absolute bottom-2 right-3 text-[10px] font-mono tabular-nums text-[#78716C]/80 pointer-events-none">
                              {frontPageNum <= numPages ? frontPageNum : ''}
                            </span>
                            <div className="pageFoldRight" />
                          </div>

                          <div
                            className={`pageFace back folio-pen-surface ${activePenTool ? 'touch-none' : ''}`}
                            onDoubleClick={(e) => {
                              if (activePenTool === null && backPageNum <= numPages) {
                                e.stopPropagation();
                                openTapOptionsMenu(backPageNum, e.clientX, e.clientY, e.currentTarget);
                              }
                            }}
                            onPointerDown={(e) => handlePageSurfacePointerDown(backPageNum, e)}
                            onPointerMove={(e) => handlePageSurfacePointerMove(backPageNum, e)}
                            onPointerUp={(e) => handlePageSurfacePointerUp(backPageNum, e)}
                            onPointerCancel={(e) => handlePageSurfacePointerUp(backPageNum, e)}
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
                    <div
                      style={bindingTheme ? { backgroundColor: bindingTheme.coverBg } : undefined}
                      className="pageFace front cover-sheen bg-[#22252d] flex items-center justify-center border-l border-black/40 rounded-r-[10px]"
                    >
                      {book.coverPath || coverPreviewUrl || pageImages[1] ? (
                        <img
                          src={book.coverPath || coverPreviewUrl || pageImages[1] || ''}
                          alt=""
                          onLoad={(e) => {
                            if (!bindingTheme) {
                              const extracted = extractBookBindingThemeFromImage(
                                e.currentTarget,
                                book.id,
                                book.sizeBytes
                              );
                              if (extracted) setBindingTheme(extracted);
                            }
                          }}
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

            <div
              role="group"
              aria-label="Fountain pen tools"
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md bg-black/45 border border-white/10 backdrop-blur-md"
            >
              <button
                type="button"
                aria-pressed={activePenTool === 'mark'}
                onClick={() => setActivePenTool((prev) => (prev === 'mark' ? null : 'mark'))}
                title={activePenTool === 'mark' ? 'Exit Mark pen' : 'Arm Mark highlighter pen'}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border transition-colors whitespace-nowrap cursor-pointer ${
                  activePenTool === 'mark'
                    ? 'bg-amber-400/20 border-amber-300/60 text-amber-200'
                    : 'border-transparent text-white/75 hover:text-white hover:bg-white/10'
                }`}
              >
                <Highlighter className="w-3.5 h-3.5 text-amber-300" />
                <span>Mark</span>
              </button>
              <button
                type="button"
                aria-pressed={activePenTool === 'circle'}
                onClick={() => setActivePenTool((prev) => (prev === 'circle' ? null : 'circle'))}
                title={activePenTool === 'circle' ? 'Exit Circle pen' : 'Arm Circle ink pen'}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border transition-colors whitespace-nowrap cursor-pointer ${
                  activePenTool === 'circle'
                    ? 'bg-rose-500/25 border-rose-300/60 text-rose-200'
                    : 'border-transparent text-white/75 hover:text-white hover:bg-white/10'
                }`}
              >
                <Circle className="w-3.5 h-3.5 text-rose-300" />
                <span>Circle</span>
              </button>
            </div>

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

      <FolioPenCursor
        active={!closing && !docError && numPages > 0 && !tapMenu}
        mode={activePenTool ?? 'read'}
      />

      {tapMenu && numPages > 0 ? (
        <DoubleTapFabMenu
          anchor={tapMenu}
          onClose={() => setTapMenu(null)}
          onZoom={() => {
            const target = tapMenu;
            setTapMenu(null);
            openPageFocusAtNormalized(target.pageNum, target.rx, target.ry);
          }}
          onMark={() => {
            const target = tapMenu;
            setTapMenu(null);
            toggleAnnotationAtPoint('mark', target.pageNum, target.rx, target.ry);
          }}
          onCircle={() => {
            const target = tapMenu;
            setTapMenu(null);
            toggleAnnotationAtPoint('circle', target.pageNum, target.rx, target.ry);
          }}
        />
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
          annotations={annotations.filter((item) => item.pageNum === focusAnchor.pageNum)}
          freshIds={freshAnnotationIds}
          activePenTool={activePenTool}
          onChangePenTool={setActivePenTool}
          onAddStamp={toggleAnnotationAtPoint}
          onAddStroke={addFreehandAnnotation}
          onRemoveAnnotation={removeAnnotationById}
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
