import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Circle,
  Contrast,
  Highlighter,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
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

export interface PageAnnotationPoint {
  x: number;
  y: number;
}

export interface PageAnnotation {
  id: string;
  pageNum: number;
  type: 'mark' | 'circle';
  rx: number;
  ry: number;
  points?: PageAnnotationPoint[];
}

export type PenToolMode = 'mark' | 'circle' | null;

export interface DraftPageStroke {
  pageNum: number;
  type: 'mark' | 'circle';
  points: PageAnnotationPoint[];
}

function pointsToSmoothSvgPath(points: PageAnnotationPoint[], w = 770, h = 1000): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const x = (points[0].x * w).toFixed(1);
    const y = (points[0].y * h).toFixed(1);
    return `M ${x} ${y} L ${x} ${y}`;
  }
  const pts = points.map((p) => ({ x: p.x * w, y: p.y * h }));
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const midX = ((pts[i].x + pts[i + 1].x) / 2).toFixed(1);
    const midY = ((pts[i].y + pts[i + 1].y) / 2).toFixed(1);
    d += ` Q ${pts[i].x.toFixed(1)} ${pts[i].y.toFixed(1)}, ${midX} ${midY}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

const PEN_MODE_ACCENTS = {
  read: {
    jewel: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.55)',
    tip: '#e0f2fe',
  },
  mark: {
    jewel: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.65)',
    tip: '#fef08a',
  },
  circle: {
    jewel: '#f43f5e',
    glow: 'rgba(244, 63, 94, 0.65)',
    tip: '#fecdd3',
  },
} as const;

export function FolioPenCursor({
  active,
  mode = 'read',
}: {
  active: boolean;
  mode?: 'read' | 'mark' | 'circle';
}) {
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const rigRef = useRef<HTMLDivElement | null>(null);
  const shadowRef = useRef<HTMLDivElement | null>(null);
  const uid = useId().replace(/:/g, '');

  const motionRef = useRef({
    visible: false,
    x: -200,
    y: -200,
    targetAngle: -4,
    angle: -4,
    pressed: false,
    pressAnim: 0,
    lastX: -200,
  });

  useEffect(() => {
    if (!active) {
      motionRef.current.visible = false;
      if (cursorRef.current) cursorRef.current.style.opacity = '0';
      return;
    }

    const syncVisibility = (target: EventTarget | null, pointerType?: string) => {
      if (pointerType && pointerType !== 'mouse') {
        motionRef.current.visible = false;
        return;
      }
      const el = target instanceof Element ? target : null;
      const onSurface = Boolean(el?.closest('.folio-pen-surface'));
      const onControl = Boolean(el?.closest('button, a, input, textarea, [data-pen-ignore]'));
      motionRef.current.visible = onSurface && !onControl;
    };

    const onPointerMove = (e: PointerEvent) => {
      const m = motionRef.current;
      if (e.pointerType !== 'mouse') {
        m.visible = false;
        return;
      }
      const dx = m.lastX > -100 ? e.clientX - m.lastX : 0;
      m.lastX = e.clientX;
      m.x = e.clientX;
      m.y = e.clientY;
      m.targetAngle = Math.max(-18, Math.min(16, -4 + dx * 0.42));
      syncVisibility(e.target, e.pointerType);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      motionRef.current.pressed = true;
      motionRef.current.x = e.clientX;
      motionRef.current.y = e.clientY;
      syncVisibility(e.target, e.pointerType);
    };

    const onPointerUp = () => {
      motionRef.current.pressed = false;
    };

    const onBlur = () => {
      motionRef.current.visible = false;
      motionRef.current.pressed = false;
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true });
    window.addEventListener('pointercancel', onPointerUp, { passive: true });
    window.addEventListener('blur', onBlur);

    let rafId = 0;
    const tick = () => {
      const m = motionRef.current;
      m.targetAngle += (-4 - m.targetAngle) * 0.14;
      m.angle += (m.targetAngle - m.angle) * 0.28;
      const targetPress = m.pressed ? 1 : 0;
      m.pressAnim += (targetPress - m.pressAnim) * 0.34;

      const cursorEl = cursorRef.current;
      const rigEl = rigRef.current;
      const shadowEl = shadowRef.current;

      if (cursorEl) {
        cursorEl.style.opacity = m.visible ? '1' : '0';
        if (m.visible) {
          cursorEl.style.transform = `translate3d(${m.x.toFixed(1)}px, ${m.y.toFixed(1)}px, 0)`;
        }
      }
      if (rigEl && m.visible) {
        const dipY = m.pressAnim * 1.6;
        const scale = 1 - m.pressAnim * 0.055;
        rigEl.style.transform = `translate3d(0, ${dipY.toFixed(2)}px, 0) rotate(${m.angle.toFixed(
          2
        )}deg) scale(${scale.toFixed(3)})`;
      }
      if (shadowEl && m.visible) {
        shadowEl.style.opacity = (0.28 + m.pressAnim * 0.36).toFixed(2);
        const sx = 4 - m.pressAnim * 2.4;
        const sy = 3 - m.pressAnim * 1.4;
        const sc = 1 - m.pressAnim * 0.24;
        shadowEl.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(
          1
        )}px, 0) scale(${sc.toFixed(2)})`;
      }
      rafId = window.requestAnimationFrame(tick);
    };
    rafId = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [active]);

  if (!active || typeof document === 'undefined') return null;
  const accent = PEN_MODE_ACCENTS[mode];

  return createPortal(
    <div ref={cursorRef} className="folio-pen-cursor" aria-hidden="true">
      <div ref={shadowRef} className="folio-pen-shadow" />
      <div ref={rigRef} className="folio-pen-rig">
        <svg
          width="46"
          height="46"
          viewBox="0 0 46 46"
          fill="none"
          className="-ml-[2px] -mt-[2px] drop-shadow-[0_6px_10px_rgba(0,0,0,0.34)]"
        >
          <defs>
            <linearGradient id={`nib-${uid}`} x1="2" y1="2" x2="18" y2="18" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#fff4cf" />
              <stop offset="45%" stopColor="#eab95e" />
              <stop offset="100%" stopColor="#9c6c1e" />
            </linearGradient>
            <linearGradient id={`barrel-${uid}`} x1="16" y1="16" x2="43" y2="43" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1e3440" />
              <stop offset="52%" stopColor="#0e1a22" />
              <stop offset="100%" stopColor="#070e13" />
            </linearGradient>
            <linearGradient id={`collar-${uid}`} x1="13" y1="18" x2="19" y2="12" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#b07c26" />
              <stop offset="50%" stopColor="#fae09e" />
              <stop offset="100%" stopColor="#9b691d" />
            </linearGradient>
          </defs>
          {/* Ink nib droplet glow */}
          <circle cx="2.5" cy="2.5" r="2.2" fill={accent.glow} />
          {/* Sculpted gold fountain nib */}
          <path
            d="M 2 2 L 15.8 8.2 L 17.6 13.6 L 13.6 17.6 L 8.2 15.8 Z"
            fill={`url(#nib-${uid})`}
            stroke="#734d11"
            strokeWidth="0.7"
            strokeLinejoin="round"
          />
          {/* Nib ink channel slit */}
          <path d="M 2.3 2.3 L 10.6 10.6" stroke="#2c1d06" strokeWidth="0.9" strokeLinecap="round" />
          {/* Mode-reactive jewel breather hole */}
          <circle cx="10.9" cy="10.9" r="1.85" fill={accent.jewel} stroke="#231704" strokeWidth="0.5" />
          <circle cx="2.3" cy="2.3" r="0.9" fill={accent.tip} />
          {/* Brushed gold collar */}
          <path
            d="M 13.3 17.8 L 17.8 13.3 L 20.5 16 L 16 20.5 Z"
            fill={`url(#collar-${uid})`}
            stroke="#734d11"
            strokeWidth="0.6"
          />
          {/* Obsidian lacquered barrel */}
          <path
            d="M 16.2 20.3 L 20.3 16.2 L 42.2 35.6 C 43.8 37.2, 43.8 39.8, 41.8 41.8 C 39.8 43.8, 37.2 43.8, 35.6 42.2 Z"
            fill={`url(#barrel-${uid})`}
            stroke="rgba(243, 198, 119, 0.36)"
            strokeWidth="0.75"
          />
          {/* Subtle barrel highlight */}
          <path
            d="M 19.8 18.6 L 38.6 35.8"
            stroke="rgba(255, 255, 255, 0.24)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          {/* Gold end finial */}
          <circle cx="39.5" cy="39.5" r="2.1" fill={`url(#collar-${uid})`} opacity="0.9" />
        </svg>
      </div>
    </div>,
    document.body
  );
}

export function PageAnnotationsLayer({
  annotations,
  onRemove,
  interactive = true,
  freshIds,
  draftStroke = null,
}: {
  annotations: PageAnnotation[];
  onRemove?: (id: string) => void;
  interactive?: boolean;
  freshIds?: Set<string>;
  draftStroke?: { type: 'mark' | 'circle'; points: PageAnnotationPoint[] } | null;
}) {
  const freehandAnnotations = annotations.filter((item) => item.points && item.points.length >= 2);
  const stampAnnotations = annotations.filter((item) => !item.points || item.points.length < 2);
  const hasFreehandOrDraft = freehandAnnotations.length > 0 || Boolean(draftStroke && draftStroke.points.length >= 2);

  if (annotations.length === 0 && !hasFreehandOrDraft) return null;

  return (
    <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
      {hasFreehandOrDraft ? (
        <svg
          viewBox="0 0 770 1000"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full pointer-events-none"
          aria-hidden={!interactive}
        >
          {freehandAnnotations.map((ann) => {
            const pathD = pointsToSmoothSvgPath(ann.points!);
            const isFresh = Boolean(freshIds?.has(ann.id));
            if (ann.type === 'mark') {
              return (
                <g
                  key={ann.id}
                  pointerEvents={interactive ? 'stroke' : 'none'}
                  className={interactive ? 'cursor-pointer' : undefined}
                  onPointerDown={interactive ? (e) => e.stopPropagation() : undefined}
                  onPointerUp={interactive ? (e) => e.stopPropagation() : undefined}
                  onDoubleClick={interactive ? (e) => e.stopPropagation() : undefined}
                  onClick={
                    interactive
                      ? (e) => {
                          e.stopPropagation();
                          onRemove?.(ann.id);
                        }
                      : undefined
                  }
                >
                  <title>Pen highlight — click to remove</title>
                  <path
                    d={pathD}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="44"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d={pathD}
                    pathLength={100}
                    fill="none"
                    stroke="rgba(250, 204, 21, 0.44)"
                    strokeWidth="32"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={isFresh ? 'folio-mark-fresh' : undefined}
                  />
                  <path
                    d={pathD}
                    pathLength={100}
                    fill="none"
                    stroke="rgba(245, 158, 11, 0.28)"
                    strokeWidth="12"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={isFresh ? 'folio-mark-fresh' : undefined}
                  />
                </g>
              );
            }
            return (
              <g
                key={ann.id}
                pointerEvents={interactive ? 'stroke' : 'none'}
                className={interactive ? 'cursor-pointer' : undefined}
                onPointerDown={interactive ? (e) => e.stopPropagation() : undefined}
                onPointerUp={interactive ? (e) => e.stopPropagation() : undefined}
                onDoubleClick={interactive ? (e) => e.stopPropagation() : undefined}
                onClick={
                  interactive
                    ? (e) => {
                        e.stopPropagation();
                        onRemove?.(ann.id);
                      }
                    : undefined
                }
              >
                <title>Pen ink circle — click to remove</title>
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="30"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d={pathD}
                  pathLength={100}
                  fill="rgba(225, 29, 72, 0.05)"
                  stroke="#e11d48"
                  strokeWidth="8.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isFresh ? 'folio-draw-fresh' : undefined}
                />
                <path
                  d={pathD}
                  pathLength={100}
                  fill="none"
                  stroke="#9f1239"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.65"
                  className={isFresh ? 'folio-draw-fresh' : undefined}
                />
              </g>
            );
          })}

          {draftStroke && draftStroke.points.length >= 2 ? (
            <path
              d={pointsToSmoothSvgPath(draftStroke.points)}
              fill={draftStroke.type === 'circle' ? 'rgba(225, 29, 72, 0.05)' : 'none'}
              stroke={
                draftStroke.type === 'mark' ? 'rgba(250, 204, 21, 0.56)' : '#e11d48'
              }
              strokeWidth={draftStroke.type === 'mark' ? 32 : 8.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </svg>
      ) : null}

      {stampAnnotations.map((ann) => {
        const isFresh = Boolean(freshIds?.has(ann.id));
        const style: React.CSSProperties = {
          left: `${(ann.rx * 100).toFixed(2)}%`,
          top: `${(ann.ry * 100).toFixed(2)}%`,
        };
        if (ann.type === 'mark') {
          return (
            <button
              key={ann.id}
              type="button"
              style={style}
              title="Highlighted mark — click to remove"
              aria-label="Remove page mark"
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onRemove?.(ann.id);
              }}
              className={`folio-page-mark ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
            >
              <svg viewBox="0 0 180 28" preserveAspectRatio="none" className="w-full h-full overflow-visible" aria-hidden="true">
                <path
                  d="M 6 15 Q 52 10, 96 14 T 174 13"
                  pathLength={100}
                  fill="none"
                  stroke="rgba(250, 204, 21, 0.54)"
                  strokeWidth="17"
                  strokeLinecap="round"
                  className={isFresh ? 'folio-mark-fresh' : undefined}
                />
                <path
                  d="M 10 17 Q 76 13, 168 15"
                  pathLength={100}
                  fill="none"
                  stroke="rgba(245, 158, 11, 0.34)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  className={isFresh ? 'folio-mark-fresh' : undefined}
                />
              </svg>
              {isFresh ? (
                <span
                  aria-hidden="true"
                  className="folio-nib-mark-tracer pointer-events-none absolute left-0 top-1/2 -mt-3 text-amber-600 drop-shadow"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M2 2L14 7L17 12L12 17L7 14Z" fill="#eab308" stroke="#78350f" strokeWidth="1.2" />
                    <circle cx="9.5" cy="9.5" r="1.6" fill="#fef08a" />
                  </svg>
                </span>
              ) : null}
            </button>
          );
        }
        return (
          <button
            key={ann.id}
            type="button"
            style={style}
            title="Ink circle — click to remove"
            aria-label="Remove ink circle"
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove?.(ann.id);
            }}
            className={`folio-page-circle ${interactive ? 'pointer-events-auto' : 'pointer-events-none'}`}
          >
            <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible" aria-hidden="true">
              <ellipse
                cx="50"
                cy="50"
                rx="40"
                ry="34"
                pathLength={100}
                fill="rgba(225, 29, 72, 0.08)"
                stroke="#e11d48"
                strokeWidth="4.2"
                strokeLinecap="round"
                transform="rotate(-7 50 50)"
                className={isFresh ? 'folio-draw-fresh' : undefined}
              />
              <path
                d="M 19 36 C 34 14, 77 14, 88 41 C 94 64, 71 86, 44 84 C 19 82, 11 58, 22 33"
                pathLength={100}
                fill="none"
                stroke="#be123c"
                strokeWidth="2.4"
                strokeLinecap="round"
                opacity="0.72"
                className={isFresh ? 'folio-draw-fresh' : undefined}
              />
            </svg>
            {isFresh ? (
              <span
                aria-hidden="true"
                className="folio-nib-circle-tracer pointer-events-none absolute inset-0"
              >
                <svg width="16" height="16" viewBox="0 0 24 24">
                  <path d="M2 2L14 7L17 12L12 17L7 14Z" fill="#f43f5e" stroke="#881337" strokeWidth="1.2" />
                  <circle cx="9.5" cy="9.5" r="1.6" fill="#ffe4e6" />
                </svg>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
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
  annotations?: PageAnnotation[];
  freshIds?: Set<string>;
  activePenTool?: PenToolMode;
  onChangePenTool?: (tool: PenToolMode) => void;
  onAddStamp?: (type: 'mark' | 'circle', pageNum: number, rx: number, ry: number) => void;
  onAddStroke?: (type: 'mark' | 'circle', pageNum: number, points: PageAnnotationPoint[]) => void;
  onRemoveAnnotation?: (id: string) => void;
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
  annotations = [],
  freshIds,
  activePenTool = null,
  onChangePenTool,
  onAddStamp,
  onAddStroke,
  onRemoveAnnotation,
  onToggleBookmark,
  onSelectKeeperColor,
  onRequestHiRes,
  onChangePage,
  onClose,
}: FocusedPageOverlayProps) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pageSheetRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  } | null>(null);
  const penDrawRef = useRef<{
    pointerId: number;
    type: 'mark' | 'circle';
    points: PageAnnotationPoint[];
    totalDist: number;
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
  const [draftStroke, setDraftStroke] = useState<DraftPageStroke | null>(null);
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
        if (activePenTool) {
          onChangePenTool?.(null);
        } else {
          onClose();
        }
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
  }, [activePenTool, anchor.pageNum, numPages, onChangePage, onChangePenTool, onClose, zoom, zoomAtPoint]);

  const toNormalizedSheetPoint = useCallback((clientX: number, clientY: number): PageAnnotationPoint | null => {
    const el = pageSheetRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clamp((clientX - rect.left) / rect.width, 0.03, 0.97),
      y: clamp((clientY - rect.top) / rect.height, 0.03, 0.97),
    };
  }, []);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore capture failure on unsupported browsers
    }
    activePointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (activePointersRef.current.size === 2) {
      penDrawRef.current = null;
      setDraftStroke(null);
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
      if (activePenTool) {
        const pt = toNormalizedSheetPoint(e.clientX, e.clientY);
        if (pt) {
          penDrawRef.current = {
            pointerId: e.pointerId,
            type: activePenTool,
            points: [pt],
            totalDist: 0,
          };
          setDraftStroke({ pageNum: anchor.pageNum, type: activePenTool, points: [pt] });
          return;
        }
      }
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

    const stroke = penDrawRef.current;
    if (stroke && stroke.pointerId === e.pointerId) {
      const pt = toNormalizedSheetPoint(e.clientX, e.clientY);
      if (pt) {
        const prev = stroke.points[stroke.points.length - 1];
        const seg = Math.hypot(pt.x - prev.x, pt.y - prev.y);
        if (seg >= 0.004) {
          stroke.points.push(pt);
          stroke.totalDist += seg;
          setDraftStroke({
            pageNum: anchor.pageNum,
            type: stroke.type,
            points: [...stroke.points],
          });
        }
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

    const stroke = penDrawRef.current;
    if (stroke && stroke.pointerId === e.pointerId) {
      penDrawRef.current = null;
      setDraftStroke(null);
      if (stroke.totalDist < 0.022 || stroke.points.length < 2) {
        const origin = stroke.points[0];
        if (origin) {
          onAddStamp?.(stroke.type, anchor.pageNum, origin.x, origin.y);
        }
      } else {
        onAddStroke?.(stroke.type, anchor.pageNum, stroke.points);
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
            ref={pageSheetRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={(e) => {
              if (activePenTool) return;
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
            className={`folio-pen-surface relative rounded-[4px] bg-white shadow-[0_28px_80px_rgba(0,0,0,0.82)] ring-1 ring-white/20 overflow-hidden ${
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
            <PageAnnotationsLayer
              annotations={annotations}
              freshIds={freshIds}
              interactive={activePenTool === null}
              draftStroke={
                draftStroke && draftStroke.pageNum === anchor.pageNum
                  ? { type: draftStroke.type, points: draftStroke.points }
                  : null
              }
              onRemove={onRemoveAnnotation}
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

          {onChangePenTool ? (
            <>
              <span className="hidden sm:inline-block w-px h-4 bg-white/15" aria-hidden="true" />
              <div role="group" aria-label="Fountain pen tools" className="inline-flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={activePenTool === 'mark'}
                  onClick={() => onChangePenTool(activePenTool === 'mark' ? null : 'mark')}
                  title={activePenTool === 'mark' ? 'Exit Mark pen' : 'Arm Mark highlighter pen'}
                  className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border whitespace-nowrap transition-colors cursor-pointer ${
                    activePenTool === 'mark'
                      ? 'bg-amber-400/20 border-amber-300/60 text-amber-200'
                      : 'bg-white/8 hover:bg-white/15 border-transparent text-[#d4ebea]'
                  }`}
                >
                  <Highlighter className="w-3.5 h-3.5 text-amber-300" />
                  <span>Mark</span>
                </button>
                <button
                  type="button"
                  aria-pressed={activePenTool === 'circle'}
                  onClick={() => onChangePenTool(activePenTool === 'circle' ? null : 'circle')}
                  title={activePenTool === 'circle' ? 'Exit Circle pen' : 'Arm Circle ink pen'}
                  className={`inline-flex items-center gap-1 px-2 sm:px-2.5 py-1 rounded-lg border whitespace-nowrap transition-colors cursor-pointer ${
                    activePenTool === 'circle'
                      ? 'bg-rose-500/25 border-rose-300/60 text-rose-200'
                      : 'bg-white/8 hover:bg-white/15 border-transparent text-[#d4ebea]'
                  }`}
                >
                  <Circle className="w-3.5 h-3.5 text-rose-300" />
                  <span>Circle</span>
                </button>
              </div>
            </>
          ) : null}

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
