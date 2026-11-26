import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, ChevronLeft, ChevronRight, Contrast, Loader2, Minus, Plus, RotateCcw, X } from 'lucide-react';
import type { BookKeeperColor } from '../types.ts';
import {
  BOOK_KEEPER_COLORS,
  BOOK_KEEPER_PALETTE,
  getBookKeeperRibbonStyle,
} from '../utils/bookProgress.ts';

export interface FocusAnchor {
  pageNum: number;
  rx: number;
  ry: number;
}

type PaperTone = 'crisp' | 'warm' | 'ink';

const TONE_LABELS: Record<PaperTone, string> = {
  crisp: 'Crisp',
  warm: 'Warm',
  ink: 'Ink+',
};

const TONE_FILTERS: Record<PaperTone, string> = {
  crisp: 'contrast(1.03)',
  warm: 'sepia(0.24) brightness(0.96) contrast(1.07)',
  ink: 'contrast(1.24) brightness(0.98)',
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 3.8;
const DEFAULT_FOCUS_ZOOM = 2.25;

interface FocusedPageOverlayProps {
  anchor: FocusAnchor;
  numPages: number;
  pageImages: Record<number, string>;
  hiResImages: Record<number, string>;
  pageErrors: Record<number, string>;
  keptPage?: number | null;
  keeperColor?: BookKeeperColor;
  onToggleBookmark?: (pageNum: number) => void;
  onSelectKeeperColor?: (color: BookKeeperColor, pageNum: number) => void;
  onRequestHiRes: (pageNum: number) => void;
  onChangePage: (nextPageNum: number) => void;
  onClose: () => void;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function FocusedPageOverlay({
  anchor,
  numPages,
  pageImages,
  hiResImages,
  pageErrors,
  keptPage = null,
  keeperColor = 'crimson',
  onToggleBookmark,
  onSelectKeeperColor,
  onRequestHiRes,
  onChangePage,
  onClose,
}: FocusedPageOverlayProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);
  const lastTouchTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{
    dist: number;
    startZoom: number;
    basePtX: number;
    basePtY: number;
  } | null>(null);

  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({
    w: typeof window !== 'undefined' ? window.innerWidth : 1200,
    h: typeof window !== 'undefined' ? window.innerHeight : 800,
  });
  const [imgAspect, setImgAspect] = useState(0.72);
  const [zoom, setZoom] = useState(DEFAULT_FOCUS_ZOOM);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [tone, setTone] = useState<PaperTone>('crisp');
  const [entered, setEntered] = useState(false);
  const [ribbonRevealed, setRibbonRevealed] = useState(false);

  const activeSrc = hiResImages[anchor.pageNum] || pageImages[anchor.pageNum] || '';
  const isHiResReady = Boolean(hiResImages[anchor.pageNum]);

  useEffect(() => {
    onRequestHiRes(anchor.pageNum);
  }, [anchor.pageNum, onRequestHiRes]);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    setRibbonRevealed(false);
    if (!entered || keptPage !== anchor.pageNum) return;
    const timer = window.setTimeout(() => {
      setRibbonRevealed(true);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [entered, keptPage, anchor.pageNum]);

  useEffect(() => {
    const updateSize = () => {
      const el = viewportRef.current;
      if (el) {
        setViewportSize({ w: el.clientWidth, h: el.clientHeight });
      } else {
        setViewportSize({ w: window.innerWidth, h: window.innerHeight });
      }
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const baseSize = useMemo(() => {
    const padX = viewportSize.w < 640 ? 16 : 72;
    const padY = viewportSize.w < 640 ? 156 : 136;
    const maxW = Math.min(Math.max(240, viewportSize.w - padX), 1040);
    const maxH = Math.max(240, viewportSize.h - padY);
    let w = maxW;
    let h = w / Math.max(0.2, imgAspect);
    if (h > maxH) {
      h = maxH;
      w = h * imgAspect;
    }
    return { w: Math.round(w), h: Math.round(h) };
  }, [viewportSize, imgAspect]);

  const clampPan = useCallback(
    (nextX: number, nextY: number, targetZoom: number) => {
      const maxPanX = Math.max(0, (baseSize.w * targetZoom - viewportSize.w * 0.72) / 2);
      const maxPanY = Math.max(0, (baseSize.h * targetZoom - viewportSize.h * 0.72) / 2);
      return {
        x: clamp(nextX, -maxPanX, maxPanX),
        y: clamp(nextY, -maxPanY, maxPanY),
      };
    },
    [baseSize.w, baseSize.h, viewportSize.w, viewportSize.h]
  );

  // Center the exact tapped coordinates (rx, ry) in the viewport whenever the anchor changes
  useEffect(() => {
    const targetZoom = DEFAULT_FOCUS_ZOOM;
    const offsetX = (anchor.rx - 0.5) * baseSize.w;
    const offsetY = (anchor.ry - 0.5) * baseSize.h;
    setZoom(targetZoom);
    setPan(clampPan(-offsetX * targetZoom, -offsetY * targetZoom, targetZoom));
  }, [anchor.pageNum, anchor.rx, anchor.ry, baseSize.w, baseSize.h, clampPan]);

  const zoomAtPoint = useCallback(
    (nextZoomRaw: number, clientX?: number, clientY?: number) => {
      const nextZoom = clamp(Number(nextZoomRaw.toFixed(2)), MIN_ZOOM, MAX_ZOOM);
      if (nextZoom <= 1.02) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }

      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect && typeof clientX === 'number' && typeof clientY === 'number') {
        const cx = clientX - (rect.left + rect.width / 2);
        const cy = clientY - (rect.top + rect.height / 2);
        const basePtX = (cx - pan.x) / zoom;
        const basePtY = (cy - pan.y) / zoom;
        const nextPanX = cx - basePtX * nextZoom;
        const nextPanY = cy - basePtY * nextZoom;
        setZoom(nextZoom);
        setPan(clampPan(nextPanX, nextPanY, nextZoom));
      } else {
        const scaleRatio = nextZoom / zoom;
        setZoom(nextZoom);
        setPan(clampPan(pan.x * scaleRatio, pan.y * scaleRatio, nextZoom));
      }
    },
    [clampPan, pan.x, pan.y, zoom]
  );

  const togglePointZoom = useCallback(
    (clientX: number, clientY: number) => {
      if (zoom > 1.25) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) {
        zoomAtPoint(DEFAULT_FOCUS_ZOOM);
        return;
      }
      const cx = clientX - (rect.left + rect.width / 2);
      const cy = clientY - (rect.top + rect.height / 2);
      const basePtX = (cx - pan.x) / zoom;
      const basePtY = (cy - pan.y) / zoom;
      const targetZoom = DEFAULT_FOCUS_ZOOM;
      setZoom(targetZoom);
      setPan(clampPan(-basePtX * targetZoom, -basePtY * targetZoom, targetZoom));
    },
    [clampPan, pan.x, pan.y, zoom, zoomAtPoint]
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      } else if (e.key === 'ArrowLeft') {
        if (anchor.pageNum > 1) {
          e.preventDefault();
          e.stopImmediatePropagation();
          onChangePage(anchor.pageNum - 1);
        }
      } else if (e.key === 'ArrowRight') {
        if (anchor.pageNum < numPages) {
          e.preventDefault();
          e.stopImmediatePropagation();
          onChangePage(anchor.pageNum + 1);
        }
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        e.stopImmediatePropagation();
        zoomAtPoint(zoom + 0.45);
      } else if (e.key === '-') {
        e.preventDefault();
        e.stopImmediatePropagation();
        zoomAtPoint(zoom - 0.45);
      } else if (e.key === '0') {
        e.preventDefault();
        e.stopImmediatePropagation();
        zoomAtPoint(1);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [anchor.pageNum, numPages, onChangePage, onClose, zoom, zoomAtPoint]);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture failure on unsupported browsers
    }
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 2) {
      const pts = Array.from(activePointersRef.current.values());
      const dist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const rect = viewportRef.current?.getBoundingClientRect();
      const cx = rect ? midX - (rect.left + rect.width / 2) : 0;
      const cy = rect ? midY - (rect.top + rect.height / 2) : 0;
      dragRef.current = null;
      pinchRef.current = {
        dist,
        startZoom: zoom,
        basePtX: (cx - pan.x) / zoom,
        basePtY: (cy - pan.y) / zoom,
      };
      setIsDragging(true);
      return;
    }

    if (activePointersRef.current.size === 1) {
      pinchRef.current = null;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
        moved: false,
      };
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (activePointersRef.current.size >= 2 && pinchRef.current) {
      const pts = Array.from(activePointersRef.current.values());
      const nextDist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const nextZoom = clamp(
        Number((pinchRef.current.startZoom * (nextDist / pinchRef.current.dist)).toFixed(2)),
        MIN_ZOOM,
        MAX_ZOOM
      );
      if (nextZoom <= 1.02) {
        setZoom(1);
        setPan({ x: 0, y: 0 });
        return;
      }
      const midX = (pts[0].x + pts[1].x) / 2;
      const midY = (pts[0].y + pts[1].y) / 2;
      const rect = viewportRef.current?.getBoundingClientRect();
      if (rect) {
        const cx = midX - (rect.left + rect.width / 2);
        const cy = midY - (rect.top + rect.height / 2);
        const nextPanX = cx - pinchRef.current.basePtX * nextZoom;
        const nextPanY = cy - pinchRef.current.basePtY * nextZoom;
        setZoom(nextZoom);
        setPan(clampPan(nextPanX, nextPanY, nextZoom));
      } else {
        setZoom(nextZoom);
      }
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true;
      setIsDragging(true);
    }
    if (drag.moved) {
      setPan(clampPan(drag.startPanX + dx, drag.startPanY + dy, zoom));
    }
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    activePointersRef.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }

    if (pinchRef.current) {
      if (activePointersRef.current.size < 2) {
        pinchRef.current = null;
        dragRef.current = null;
        setIsDragging(false);
      }
      return;
    }

    const drag = dragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      const wasTap = !drag.moved;
      dragRef.current = null;
      setIsDragging(false);

      if (wasTap && e.pointerType === 'touch') {
        const now = performance.now();
        const prev = lastTouchTapRef.current;
        if (prev && now - prev.time < 320 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30) {
          lastTouchTapRef.current = null;
          togglePointZoom(e.clientX, e.clientY);
        } else {
          lastTouchTapRef.current = { time: now, x: e.clientX, y: e.clientY };
        }
      }
    }
  }

  function cycleTone() {
    setTone((prev) => (prev === 'crisp' ? 'warm' : prev === 'warm' ? 'ink' : 'crisp'));
  }

  const zoomAtPointRef = useRef(zoomAtPoint);
  const zoomValRef = useRef(zoom);
  useEffect(() => {
    zoomAtPointRef.current = zoomAtPoint;
    zoomValRef.current = zoom;
  }, [zoomAtPoint, zoom]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.16 : 0.86;
      zoomAtPointRef.current(zoomValRef.current * factor, e.clientX, e.clientY);
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const content = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Focused reader — Page ${anchor.pageNum}`}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
      className={`fixed inset-0 h-dvh z-[80] flex flex-col select-none transition-opacity duration-200 ${
        entered ? 'bg-[#060d0f]/95 opacity-100' : 'bg-[#060d0f]/0 opacity-0'
      }`}
    >
      {/* Top minimal overlay bar */}
      <div
        className="relative z-20 flex items-center justify-between px-3 sm:px-6 pt-[max(0.75rem,env(safe-area-inset-top))] sm:pt-4 pointer-events-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-auto inline-flex items-center px-3 py-1.5 rounded-lg bg-[#0d191c]/90 border border-white/12 text-xs text-[#d6e6e7] shadow-lg">
          <span className="font-mono tabular-nums font-medium">
            Page {anchor.pageNum} / {numPages}
          </span>
        </div>

        <button
          type="button"
          onClick={onClose}
          aria-label="Exit page focus"
          className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0d191c]/90 hover:bg-[#16282d] border border-white/15 text-xs font-medium text-white shadow-lg transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
          <span>Done</span>
        </button>
      </div>

      {/* Interactive pan + point-zoom stage */}
      <div
        ref={viewportRef}
        onClick={(e) => {
          e.stopPropagation();
          if (e.target === e.currentTarget && !isDragging) {
            onClose();
          }
        }}
        className="relative flex-1 overflow-hidden flex items-center justify-center touch-none"
      >
        {pageErrors[anchor.pageNum] ? (
          <div className="px-6 py-5 rounded-lg bg-[#142024] border border-white/15 text-center text-sm text-[#fca5a5]">
            Could not render Page {anchor.pageNum}: {pageErrors[anchor.pageNum]}
          </div>
        ) : activeSrc ? (
          <div
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={(e) => {
              e.stopPropagation();
              togglePointZoom(e.clientX, e.clientY);
            }}
            style={{
              width: `${baseSize.w}px`,
              height: `${baseSize.h}px`,
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              transition: isDragging ? 'none' : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)',
              willChange: 'transform',
            }}
            className={`relative rounded-[4px] bg-white shadow-[0_28px_80px_rgba(0,0,0,0.82)] ring-1 ring-white/20 overflow-hidden ${
              isDragging ? 'cursor-grabbing' : zoom > 1.05 ? 'cursor-grab' : 'cursor-zoom-in'
            }`}
          >
            {ribbonRevealed && keptPage === anchor.pageNum ? (
              <div
                style={{
                  right: `${Math.round(18 / zoom)}px`,
                  transform: `scale(${(zoom > 1.05 ? 0.68 : 1) / zoom})`,
                  transformOrigin: 'top right',
                  transition: isDragging
                    ? 'none'
                    : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), right 260ms cubic-bezier(0.22, 1, 0.36, 1)',
                }}
                className="absolute top-0 z-20"
              >
                <button
                  key={`focus-keeper-${anchor.pageNum}`}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleBookmark?.(anchor.pageNum);
                  }}
                  style={getBookKeeperRibbonStyle(keeperColor)}
                  title={`${BOOK_KEEPER_PALETTE[keeperColor].label} Book Keeper at Page ${anchor.pageNum}${onToggleBookmark ? ' — click to toggle' : ''}`}
                  aria-label={`Book Keeper at Page ${anchor.pageNum}`}
                  className="reader-book-keeper-ribbon flex flex-col items-center justify-end cursor-pointer"
                >
                  <span
                    style={{ color: BOOK_KEEPER_PALETTE[keeperColor].text }}
                    className="text-[9px] font-mono font-bold tabular-nums leading-none"
                  >
                    p.{anchor.pageNum}
                  </span>
                </button>
              </div>
            ) : null}
            <img
              ref={imgRef}
              src={activeSrc}
              alt={`Focused Page ${anchor.pageNum}`}
              draggable={false}
              onLoad={(e) => {
                const { naturalWidth, naturalHeight } = e.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                  setImgAspect(naturalWidth / naturalHeight);
                }
              }}
              style={{ filter: TONE_FILTERS[tone] }}
              className="w-full h-full object-contain block select-none pointer-events-none"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-[#8fb8b6]">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="text-xs font-mono tabular-nums">Rendering Page {anchor.pageNum}...</span>
          </div>
        )}
      </div>

      {/* Bottom compact reading & zoom dock */}
      <div
        className="relative z-20 flex justify-center px-2 sm:px-3 pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-1 pointer-events-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pointer-events-auto flex flex-wrap items-center justify-center max-w-[calc(100vw-16px)] gap-1 sm:gap-2 px-2 sm:px-2.5 py-1.5 rounded-xl bg-[#0d191c]/92 border border-white/12 shadow-[0_18px_42px_-10px_rgba(0,0,0,0.75)] text-[11px] sm:text-xs text-white/90">
          <button
            type="button"
            disabled={anchor.pageNum <= 1}
            onClick={() => onChangePage(anchor.pageNum - 1)}
            aria-label="Previous page"
            className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            disabled={anchor.pageNum >= numPages}
            onClick={() => onChangePage(anchor.pageNum + 1)}
            aria-label="Next page"
            className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <span className="hidden sm:inline-block w-px h-4 bg-white/15" aria-hidden="true" />

          <button
            type="button"
            disabled={zoom <= MIN_ZOOM + 0.01}
            onClick={() => zoomAtPoint(zoom - 0.45)}
            aria-label="Zoom out"
            className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => zoomAtPoint(zoom > 1.05 ? 1 : DEFAULT_FOCUS_ZOOM)}
            title="Toggle 100% / Focus zoom"
            className="px-1.5 sm:px-2 py-1 rounded-md hover:bg-white/10 font-mono tabular-nums text-[11px] min-w-[42px] sm:min-w-[46px] text-center transition-colors cursor-pointer"
          >
            {Math.round(zoom * 100)}%
          </button>

          <button
            type="button"
            disabled={zoom >= MAX_ZOOM - 0.01}
            onClick={() => zoomAtPoint(zoom + 0.45)}
            aria-label="Zoom in"
            className="p-1.5 rounded-lg hover:bg-white/10 disabled:opacity-35 transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>

          {zoom > 1.05 ? (
            <button
              type="button"
              onClick={() => zoomAtPoint(1)}
              aria-label="Fit full page"
              title="Fit full page"
              className="p-1.5 rounded-lg hover:bg-white/10 text-[#9be4dc] transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          ) : null}

          <span className="hidden sm:inline-block w-px h-4 bg-white/15" aria-hidden="true" />

          <button
            type="button"
            onClick={cycleTone}
            title="Cycle reading paper contrast"
            className="inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg bg-white/8 hover:bg-white/15 text-[#d4ebea] whitespace-nowrap transition-colors cursor-pointer"
          >
            <Contrast className="w-3.5 h-3.5 text-[#7fd4cb]" />
            <span>{TONE_LABELS[tone]}</span>
          </button>

          {onToggleBookmark ? (
            <>
              <span className="hidden sm:inline-block w-px h-4 bg-white/15" aria-hidden="true" />
              <div className="inline-flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onToggleBookmark(anchor.pageNum)}
                  style={
                    keptPage === anchor.pageNum
                      ? {
                          backgroundColor: BOOK_KEEPER_PALETTE[keeperColor].buttonBg,
                          borderColor: BOOK_KEEPER_PALETTE[keeperColor].buttonBorder,
                          color: '#ffffff',
                          boxShadow: BOOK_KEEPER_PALETTE[keeperColor].glow,
                        }
                      : {
                          color: BOOK_KEEPER_PALETTE[keeperColor].buttonMutedText,
                        }
                  }
                  title={
                    keptPage === anchor.pageNum
                      ? 'Remove Book Keeper from this page'
                      : `Keep reading progress at Page ${anchor.pageNum}`
                  }
                  className={`inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-lg border whitespace-nowrap transition-colors cursor-pointer ${
                    keptPage === anchor.pageNum
                      ? ''
                      : 'bg-white/8 hover:bg-white/15 border-transparent hover:text-white'
                  }`}
                >
                  <Bookmark
                    className="w-3.5 h-3.5"
                    fill={keptPage === anchor.pageNum ? 'currentColor' : 'none'}
                  />
                  <span>{keptPage === anchor.pageNum ? `Kept p.${anchor.pageNum}` : 'Keep Page'}</span>
                </button>
                {onSelectKeeperColor ? (
                  <div
                    role="group"
                    aria-label="Book Keeper ribbon color"
                    className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg bg-white/6 border border-white/10"
                  >
                    {BOOK_KEEPER_COLORS.map((c) => {
                      const entry = BOOK_KEEPER_PALETTE[c];
                      const active = keeperColor === c;
                      return (
                        <button
                          key={c}
                          type="button"
                          onClick={() => onSelectKeeperColor(c, anchor.pageNum)}
                          title={`${entry.label} Book Keeper`}
                          aria-label={`Use ${entry.label} Book Keeper`}
                          aria-pressed={active}
                          style={{ backgroundColor: entry.swatch }}
                          className={`w-3.5 h-3.5 rounded-full transition-transform cursor-pointer ${
                            active
                              ? 'ring-2 ring-white ring-offset-1 ring-offset-[#0d191c] scale-110'
                              : 'opacity-75 hover:opacity-100 hover:scale-110'
                          }`}
                        />
                      );
                    })}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(content, document.body);
}
