import { useEffect, useId, useRef, useState } from 'react';
import { getCachedPdfCoverSync, getOrRenderPdfCover } from '../utils/pdfCoverCache.ts';

interface PdfCoverImageProps {
  bookId: string;
  sizeBytes: number;
  title: string;
  coverPath?: string | null;
  priority?: boolean;
  inView?: boolean;
  className?: string;
}

const loadedCoverUrls = new Set<string>();
const failedServerUrls = new Set<string>();
const unavailableFallbackIds = new Set<string>();

function rememberUrl(target: Set<string>, url: string) {
  if (target.size > 300) {
    const first = target.values().next().value;
    if (first) target.delete(first);
  }
  target.add(url);
}

interface ChainSpec {
  id: 'tl' | 'tr' | 'bl' | 'br';
  className: string;
  cx: number;
  cy: number;
  gx: number;
  gy: number;
  flipFront: boolean;
}

const CHAIN_SPECS: ChainSpec[] = [
  { id: 'tl', className: 'vault-chain-tl', cx: 0, cy: 0, gx: 83, gy: 110, flipFront: false },
  { id: 'tr', className: 'vault-chain-tr', cx: 200, cy: 0, gx: 117, gy: 110, flipFront: true },
  { id: 'bl', className: 'vault-chain-bl', cx: 0, cy: 272, gx: 68, gy: 164, flipFront: false },
  { id: 'br', className: 'vault-chain-br', cx: 200, cy: 272, gx: 132, gy: 164, flipFront: true },
];

function getChainGeometry(spec: ChainSpec) {
  const dx = spec.gx - spec.cx;
  const dy = spec.gy - spec.cy;
  const dist = Math.hypot(dx, dy);
  const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  const steps = 8;
  const stepDist = dist / steps;
  return { dist, angleDeg, steps, stepDist };
}

function TerminalGrabHalf({
  half,
  flipFront,
  steelGradId,
}: {
  half: 'back' | 'front';
  flipFront: boolean;
  steelGradId: string;
}) {
  // Draw either the rear-passing rail or front-passing rail of the terminal oval grab link
  const useLowerArc = half === 'front' ? !flipFront : flipFront;
  const d = useLowerArc
    ? 'M -11.5 0 C -11.5 6.8, -5.5 7.4, 0 7.4 C 5.5 7.4, 11.5 6.8, 11.5 0'
    : 'M -11.5 0 C -11.5 -6.8, -5.5 -7.4, 0 -7.4 C 5.5 -7.4, 11.5 -6.8, 11.5 0';

  return (
    <g>
      {half === 'front' ? (
        <path
          d={d}
          transform="translate(1.5, 4)"
          fill="none"
          stroke="rgba(0,0,0,0.52)"
          strokeWidth={5.2}
          strokeLinecap="round"
        />
      ) : null}
      <path
        d={d}
        fill="none"
        stroke="#050b0d"
        strokeWidth={5.4}
        strokeLinecap="round"
      />
      <path
        d={d}
        fill="none"
        stroke={`url(#${steelGradId})`}
        strokeWidth={3.1}
        strokeLinecap="round"
      />
      {half === 'front' ? (
        <path
          d={
            useLowerArc
              ? 'M -7 5.2 C -3 6.3, 3 6.3, 7 5.2'
              : 'M -7 -5.2 C -3 -6.3, 3 -6.3, 7 -5.2'
          }
          fill="none"
          stroke="rgba(238,252,252,0.72)"
          strokeWidth={0.95}
          strokeLinecap="round"
        />
      ) : null}
    </g>
  );
}

function ChainLinksStrand({
  spec,
  steelGradId,
  edgeGradId,
}: {
  spec: ChainSpec;
  steelGradId: string;
  edgeGradId: string;
}) {
  const { dist, angleDeg, steps, stepDist } = getChainGeometry(spec);
  const linkOffsets = Array.from({ length: steps }, (_, i) => i * stepDist);

  return (
    <g className={`vault-chain-arm ${spec.className}`}>
      <g transform={`translate(${spec.cx}, ${spec.cy}) rotate(${angleDeg})`}>
        {linkOffsets.map((d, index) =>
          index % 2 === 0 ? (
            <g key={d} transform={`translate(${d}, 0)`}>
              {/* Cast shadow on book cover */}
              <rect
                x={-11.5}
                y={-2.5}
                width={23}
                height={12.5}
                rx={6.25}
                fill="none"
                stroke="rgba(0,0,0,0.48)"
                strokeWidth={5}
              />
              {/* Dark forged outline */}
              <rect
                x={-12}
                y={-6.4}
                width={24}
                height={12.8}
                rx={6.4}
                fill="none"
                stroke="#050b0d"
                strokeWidth={5.2}
              />
              {/* Brushed steel body */}
              <rect
                x={-12}
                y={-6.4}
                width={24}
                height={12.8}
                rx={6.4}
                fill="none"
                stroke={`url(#${steelGradId})`}
                strokeWidth={3}
              />
              {/* Top specular metallic gleam */}
              <line
                x1={-6.5}
                y1={-5.3}
                x2={6.5}
                y2={-5.3}
                stroke="rgba(235,252,252,0.68)"
                strokeWidth={0.95}
                strokeLinecap="round"
              />
            </g>
          ) : (
            <g key={d} transform={`translate(${d}, 0)`}>
              {/* Cast shadow on book cover */}
              <rect
                x={-10.5}
                y={0.6}
                width={22}
                height={6.2}
                rx={3.1}
                fill="rgba(0,0,0,0.48)"
              />
              {/* Dark outer casing */}
              <rect
                x={-11}
                y={-3.3}
                width={22}
                height={6.6}
                rx={3.3}
                fill="#050b0d"
              />
              {/* Machined steel center bar */}
              <rect
                x={-9.8}
                y={-2.1}
                width={19.6}
                height={4.2}
                rx={2.1}
                fill={`url(#${edgeGradId})`}
              />
              <line
                x1={-6.5}
                y1={-0.9}
                x2={6.5}
                y2={-0.9}
                stroke="rgba(245,255,255,0.72)"
                strokeWidth={0.8}
                strokeLinecap="round"
              />
            </g>
          )
        )}

        {/* Front half of terminal grab link clamping directly over the padlock shackle/lug */}
        <g transform={`translate(${dist}, 0)`}>
          <TerminalGrabHalf
            half="front"
            flipFront={spec.flipFront}
            steelGradId={steelGradId}
          />
        </g>
      </g>
    </g>
  );
}

function LockedVaultCover({ breaking }: { breaking: boolean }) {
  const uid = useId().replace(/:/g, '');
  const steelGradId = `chainSteel-${uid}`;
  const edgeGradId = `chainEdge-${uid}`;
  const shackleGradId = `shackleSteel-${uid}`;
  const bodyGradId = `lockBody-${uid}`;
  const brassGradId = `lockBrass-${uid}`;

  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 z-10 pointer-events-none select-none ${
        breaking ? 'vault-chain-breaking' : ''
      }`}
    >
      {/* Clean obsidian cover backing without extra inner borders or boxes */}
      <div
        className={`absolute inset-0 bg-gradient-to-br from-[#17282c] via-[#0e191c] to-[#060c0e] ${
          breaking ? 'vault-plate-breaking' : ''
        }`}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 48%, rgba(127, 212, 203, 0.09) 0%, transparent 62%)',
          }}
        />
      </div>

      {/* Unified SVG coordinate system so chain grab links interlock cleanly with the padlock */}
      <svg
        viewBox="0 0 200 272"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full overflow-visible"
      >
        <defs>
          <linearGradient id={steelGradId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#e6f5f5" />
            <stop offset="32%" stopColor="#92aeb3" />
            <stop offset="72%" stopColor="#3c5156" />
            <stop offset="100%" stopColor="#1c292c" />
          </linearGradient>

          <linearGradient id={edgeGradId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#eef9f9" />
            <stop offset="48%" stopColor="#8ca8ad" />
            <stop offset="100%" stopColor="#26383d" />
          </linearGradient>

          <linearGradient id={shackleGradId} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#657e83" />
            <stop offset="28%" stopColor="#e8f6f6" />
            <stop offset="56%" stopColor="#9ab5ba" />
            <stop offset="85%" stopColor="#384c52" />
            <stop offset="100%" stopColor="#7b969b" />
          </linearGradient>

          <linearGradient id={bodyGradId} x1="12%" y1="0%" x2="88%" y2="100%">
            <stop offset="0%" stopColor="#58747a" />
            <stop offset="28%" stopColor="#2d4247" />
            <stop offset="75%" stopColor="#152326" />
            <stop offset="100%" stopColor="#0a1214" />
          </linearGradient>

          <linearGradient id={brassGradId} x1="15%" y1="0%" x2="85%" y2="100%">
            <stop offset="0%" stopColor="#f5dfaf" />
            <stop offset="45%" stopColor="#c9994a" />
            <stop offset="100%" stopColor="#694816" />
          </linearGradient>
        </defs>

        {/* Layer 1: Rear half of terminal chain links passing behind the shackle & anchor lugs */}
        {CHAIN_SPECS.map((spec) => {
          const { dist, angleDeg } = getChainGeometry(spec);
          return (
            <g key={`${spec.id}-back`} className={`vault-chain-arm ${spec.className}`}>
              <g transform={`translate(${spec.cx}, ${spec.cy}) rotate(${angleDeg}) translate(${dist}, 0)`}>
                <TerminalGrabHalf
                  half="back"
                  flipFront={spec.flipFront}
                  steelGradId={steelGradId}
                />
              </g>
            </g>
          );
        })}

        {/* Layer 2: Real sculpted steel & brass padlock (no extra box or frame) */}
        <g className={`vault-locker-group ${breaking ? 'vault-locker-breaking' : ''}`}>
          {/* Realistic cast shadow of the padlock onto the book cover */}
          <g transform="translate(3, 7)" opacity="0.6">
            <path
              d="M 83 128 L 83 107 A 17 17 0 0 1 117 107 L 117 128"
              fill="none"
              stroke="#030708"
              strokeWidth={11}
              strokeLinecap="round"
            />
            <circle cx={68} cy={164} r={7.5} fill="none" stroke="#030708" strokeWidth={5.5} />
            <circle cx={132} cy={164} r={7.5} fill="none" stroke="#030708" strokeWidth={5.5} />
            <path
              d="M 76 125 L 124 125 L 130 131 L 130 170 L 123 177 L 77 177 L 70 170 L 70 131 Z"
              fill="#030708"
            />
          </g>

          {/* Forged steel lower anchor lugs bolted into the padlock flanks */}
          <g>
            <circle cx={68} cy={164} r={7.2} fill="none" stroke="#060d0f" strokeWidth={6} />
            <circle cx={68} cy={164} r={7.2} fill="none" stroke={`url(#${steelGradId})`} strokeWidth={3.4} />
            <circle cx={132} cy={164} r={7.2} fill="none" stroke="#060d0f" strokeWidth={6} />
            <circle cx={132} cy={164} r={7.2} fill="none" stroke={`url(#${steelGradId})`} strokeWidth={3.4} />
          </g>

          {/* Hardened U-shackle (pops upward on unlock) */}
          <g className="vault-shackle-group">
            <path
              d="M 83 128 L 83 107 A 17 17 0 0 1 117 107 L 117 128"
              fill="none"
              stroke="#050b0d"
              strokeWidth={11}
              strokeLinecap="round"
            />
            <path
              d="M 83 128 L 83 107 A 17 17 0 0 1 117 107 L 117 128"
              fill="none"
              stroke={`url(#${shackleGradId})`}
              strokeWidth={7.8}
              strokeLinecap="round"
            />
            {/* Cylindrical specular rim light along the shackle arch */}
            <path
              d="M 81.2 124 L 81.2 107 A 18.8 18.8 0 0 1 108 90.2"
              fill="none"
              stroke="rgba(244,254,254,0.72)"
              strokeWidth={1.35}
              strokeLinecap="round"
            />
            {/* Locking notch revealed on right leg as shackle opens */}
            <rect x={113} y={120.5} width={4.2} height={3} rx={0.8} fill="#091214" />
          </g>

          {/* Solid chamfered forged-steel padlock body */}
          <path
            d="M 76 125 L 124 125 L 130 131 L 130 170 L 123 177 L 77 177 L 70 170 L 70 131 Z"
            fill={`url(#${bodyGradId})`}
            stroke="#060d0f"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          {/* Machined top & left bevel highlight */}
          <path
            d="M 72.5 168.5 L 72.5 132 L 77 127.5 L 122.5 127.5"
            fill="none"
            stroke="rgba(225,248,248,0.36)"
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Subtle bottom-right dark chamfer edge */}
          <path
            d="M 127.5 133 L 127.5 169 L 122 174.5 L 78 174.5"
            fill="none"
            stroke="rgba(0,0,0,0.48)"
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Raised shackle entry collars */}
          <rect x={77.5} y={123.2} width={11} height={4.4} rx={1.6} fill="#1b2c30" stroke="#85a4a9" strokeWidth={0.75} />
          <rect x={111.5} y={123.2} width={11} height={4.4} rx={1.6} fill="#1b2c30" stroke="#85a4a9" strokeWidth={0.75} />

          {/* Corner steel hex/pin rivets directly in the solid casing */}
          {[
            [78, 134],
            [122, 134],
            [78, 168],
            [122, 168],
          ].map(([rx, ry]) => (
            <g key={`${rx}-${ry}`}>
              <circle cx={rx} cy={ry} r={2} fill="#070e10" />
              <circle cx={rx - 0.3} cy={ry - 0.3} r={1.35} fill="#88a7ac" />
            </g>
          ))}

          {/* Central antique-brass keyhole cylinder */}
          <circle cx={100} cy={151} r={11.5} fill="#070e10" />
          <circle
            cx={100}
            cy={151}
            r={10.2}
            fill={`url(#${brassGradId})`}
            stroke="rgba(255,244,214,0.48)"
            strokeWidth={0.8}
          />
          <circle cx={100} cy={151} r={7.2} fill="#16120b" stroke="rgba(232,191,112,0.28)" strokeWidth={0.6} />
          {/* Realistic keyhole slot */}
          <circle cx={100} cy={148.8} r={2.4} fill="#050809" />
          <path d="M 98.4 150.3 L 101.6 150.3 L 102.4 156.1 L 97.6 156.1 Z" fill="#050809" />
        </g>

        {/* Layer 3: Full forged steel chains + front clamping arcs gripping the padlock */}
        {CHAIN_SPECS.map((spec) => (
          <ChainLinksStrand
            key={spec.id}
            spec={spec}
            steelGradId={steelGradId}
            edgeGradId={edgeGradId}
          />
        ))}
      </svg>

      {/* Kinetic fracture ring burst on unlock */}
      {breaking ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full border-2 border-[#a7f3ea] bg-[#7fd4cb]/25 shadow-[0_0_24px_rgba(127,212,203,0.75)] vault-shockwave-burst" />
        </div>
      ) : null}
    </div>
  );
}

export function PdfCoverImage({
  bookId,
  sizeBytes,
  title,
  coverPath,
  priority = false,
  inView = true,
  className = '',
}: PdfCoverImageProps) {
  const serverCoverUrl = `/api/vault/${encodeURIComponent(bookId)}/cover?v=5-${sizeBytes}`;
  const hasValidAssetCoverProp =
    Boolean(coverPath) && coverPath!.startsWith('/src/assets/images/');

  const [fallbackUrl, setFallbackUrl] = useState<string | null>(() =>
    getCachedPdfCoverSync(bookId, sizeBytes)
  );
  const [serverError, setServerError] = useState(() => failedServerUrls.has(serverCoverUrl));
  const [assetError, setAssetError] = useState(() =>
    Boolean(hasValidAssetCoverProp && failedServerUrls.has(coverPath!))
  );
  const [hasEnteredView, setHasEnteredView] = useState(priority || inView);

  useEffect(() => {
    if (priority || inView) {
      setHasEnteredView(true);
    }
  }, [priority, inView]);

  const hasValidAssetCover = hasValidAssetCoverProp && !assetError;
  const activeSrc = hasValidAssetCover
    ? coverPath!
    : !serverError
      ? serverCoverUrl
      : fallbackUrl;

  const [imageReady, setImageReady] = useState(() =>
    Boolean(activeSrc && loadedCoverUrls.has(activeSrc))
  );
  const [breaking, setBreaking] = useState(false);
  const wasReadyRef = useRef(imageReady);

  useEffect(() => {
    const cached = getCachedPdfCoverSync(bookId, sizeBytes);
    const nextAssetErr = Boolean(hasValidAssetCoverProp && failedServerUrls.has(coverPath!));
    const nextServerErr = failedServerUrls.has(serverCoverUrl);
    setFallbackUrl(cached);
    setAssetError(nextAssetErr);
    setServerError(nextServerErr);
    const initialSrc =
      hasValidAssetCoverProp && !nextAssetErr
        ? coverPath!
        : !nextServerErr
          ? serverCoverUrl
          : cached;
    const alreadyLoaded = Boolean(initialSrc && loadedCoverUrls.has(initialSrc));
    setImageReady(alreadyLoaded);
    setBreaking(false);
    wasReadyRef.current = alreadyLoaded;
  }, [bookId, sizeBytes, coverPath, hasValidAssetCoverProp, serverCoverUrl]);

  useEffect(() => {
    if (!breaking) return;
    const timer = window.setTimeout(() => {
      setBreaking(false);
    }, 760);
    return () => window.clearTimeout(timer);
  }, [breaking]);

  useEffect(() => {
    const cacheKey = `${bookId}:${sizeBytes}`;
    if (
      !hasEnteredView ||
      !serverError ||
      hasValidAssetCover ||
      fallbackUrl ||
      unavailableFallbackIds.has(cacheKey)
    ) {
      return;
    }

    let cancelled = false;
    getOrRenderPdfCover(bookId, sizeBytes, priority)
      .then((url) => {
        if (!cancelled) {
          setFallbackUrl(url);
        }
      })
      .catch(() => {
        unavailableFallbackIds.add(cacheKey);
      });

    return () => {
      cancelled = true;
    };
  }, [hasEnteredView, serverError, hasValidAssetCover, fallbackUrl, bookId, sizeBytes, priority]);

  const shouldRenderImg = Boolean(activeSrc) && (hasEnteredView || imageReady);

  return (
    <div className={`w-full h-full relative bg-[#0c1619] ${className}`}>
      {shouldRenderImg ? (
        <img
          src={activeSrc!}
          alt={title}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={(e) => {
            const img = e.currentTarget;
            const src = activeSrc;
            const finish = () => {
              if (!img.isConnected || img.naturalWidth === 0) return;
              if (src) rememberUrl(loadedCoverUrls, src);
              if (!wasReadyRef.current) {
                wasReadyRef.current = true;
                setBreaking(true);
              }
              setImageReady(true);
            };
            if (typeof img.decode === 'function') {
              img.decode().then(finish, finish);
            } else {
              finish();
            }
          }}
          onError={() => {
            wasReadyRef.current = false;
            setBreaking(false);
            setImageReady(false);
            if (hasValidAssetCover) {
              rememberUrl(failedServerUrls, coverPath!);
              setAssetError(true);
            } else if (!serverError) {
              rememberUrl(failedServerUrls, serverCoverUrl);
              setServerError(true);
            } else {
              setFallbackUrl(null);
            }
          }}
          className={`absolute inset-0 w-full h-full object-cover object-top block transition-all duration-300 ${
            imageReady ? 'opacity-100 scale-100' : 'opacity-0 scale-[1.03]'
          }`}
        />
      ) : null}
      {!imageReady || breaking ? <LockedVaultCover breaking={breaking} /> : null}
    </div>
  );
}
