import { useEffect, useId, useRef, useState } from 'react';
import { Lock, Unlock } from 'lucide-react';
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

const LINK_OFFSETS = [22, 46, 70, 94, 118, 142, 166];

function ChainArmLinks({ gradId }: { gradId: string }) {
  return (
    <>
      {LINK_OFFSETS.map((d, index) =>
        index % 2 === 0 ? (
          <g key={d} transform={`translate(${d}, 0)`}>
            <rect
              x={-13}
              y={-6}
              width={26}
              height={12}
              rx={6}
              fill="none"
              stroke="#071012"
              strokeWidth={5.2}
            />
            <rect
              x={-13}
              y={-6}
              width={26}
              height={12}
              rx={6}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={2.7}
            />
            <line
              x1={-7}
              y1={-4.6}
              x2={7}
              y2={-4.6}
              stroke="rgba(225,245,244,0.65)"
              strokeWidth={1}
              strokeLinecap="round"
            />
          </g>
        ) : (
          <g key={d} transform={`translate(${d}, 0)`}>
            <rect
              x={-11}
              y={-3.2}
              width={22}
              height={6.4}
              rx={3.2}
              fill="#071012"
            />
            <rect
              x={-9.8}
              y={-2}
              width={19.6}
              height={4}
              rx={2}
              fill={`url(#${gradId})`}
            />
          </g>
        )
      )}
    </>
  );
}

function LockedVaultCover({ breaking }: { breaking: boolean }) {
  const uid = useId().replace(/:/g, '');
  const gradId = `chainSteel-${uid}`;

  return (
    <div
      aria-hidden="true"
      className={`absolute inset-0 z-10 pointer-events-none select-none ${
        breaking ? 'vault-chain-breaking' : ''
      }`}
    >
      {/* Obsidian vault cover backing that dissolves cleanly as the cover reveals */}
      <div
        className={`absolute inset-0 bg-gradient-to-br from-[#182a2e] via-[#101c1f] to-[#081012] ${
          breaking ? 'vault-plate-breaking' : ''
        }`}
      >
        <div className="absolute inset-2.5 border border-[#7fd4cb]/24 rounded-[2px]" />
        <div className="absolute inset-4 border border-white/8 rounded-[1px]" />
      </div>

      {/* Heavy steel chains anchored to the four corners holding the center locker */}
      <svg
        viewBox="0 0 200 272"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full overflow-visible"
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#d5eaeb" />
            <stop offset="45%" stopColor="#759499" />
            <stop offset="100%" stopColor="#26383c" />
          </linearGradient>
        </defs>

        <g className="vault-chain-arm vault-chain-tl">
          <g transform="translate(100, 136) rotate(-126.3)">
            <ChainArmLinks gradId={gradId} />
          </g>
        </g>

        <g className="vault-chain-arm vault-chain-tr">
          <g transform="translate(100, 136) rotate(-53.7)">
            <ChainArmLinks gradId={gradId} />
          </g>
        </g>

        <g className="vault-chain-arm vault-chain-bl">
          <g transform="translate(100, 136) rotate(126.3)">
            <ChainArmLinks gradId={gradId} />
          </g>
        </g>

        <g className="vault-chain-arm vault-chain-br">
          <g transform="translate(100, 136) rotate(53.7)">
            <ChainArmLinks gradId={gradId} />
          </g>
        </g>
      </svg>

      {/* Kinetic fracture ring burst on unlock */}
      {breaking ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full border-2 border-[#a7f3ea] bg-[#7fd4cb]/25 shadow-[0_0_24px_rgba(127,212,203,0.75)] vault-shockwave-burst" />
        </div>
      ) : null}

      {/* Central steel padlock locker holding the four chains together */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div
          className={`w-14 h-14 rounded-xl bg-gradient-to-b from-[#17282c] to-[#0a1417] border border-[#8be3d9]/50 shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_24px_rgba(0,0,0,0.65)] flex items-center justify-center ${
            breaking ? 'vault-locker-breaking' : ''
          }`}
        >
          {breaking ? (
            <Unlock className="w-7 h-7 text-[#bff8f0]" strokeWidth={1.9} />
          ) : (
            <Lock className="w-7 h-7 text-[#8be3d9]" strokeWidth={1.9} />
          )}
        </div>
      </div>
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
