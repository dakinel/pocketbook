import type { CSSProperties } from 'react';

export interface BookBindingTheme {
  primaryHex: string;
  spineEdge: string;
  spineHi: string;
  spineMid: string;
  spineDeep: string;
  spineBandHi: string;
  spineBandLo: string;
  backHi: string;
  backLo: string;
  coverBg: string;
  boardHi: string;
  boardLo: string;
  boardBorder: string;
}

const THEME_CACHE_PREFIX = 'folio-binding-theme-v1:';
const memoryThemeCache = new Map<string, BookBindingTheme>();
let sharedSampleCanvas: HTMLCanvasElement | null = null;
let sharedSampleCtx: CanvasRenderingContext2D | null = null;

function makeThemeKey(bookId: string, sizeBytes: number): string {
  return `${bookId}:${sizeBytes}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;

  if (max === rn) {
    h = (gn - bn) / d + (gn < bn ? 6 : 0);
  } else if (max === gn) {
    h = (bn - rn) / d + 2;
  } else {
    h = (rn - gn) / d + 4;
  }

  return { h: h * 60, s, l };
}

function hslToRgb(hDeg: number, sPct: number, lPct: number): [number, number, number] {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const s = clamp(sPct / 100, 0, 1);
  const l = clamp(lPct / 100, 0, 1);

  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}

function hslToHex(hDeg: number, sPct: number, lPct: number): string {
  const [r, g, b] = hslToRgb(hDeg, sPct, lPct);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hslToRgba(hDeg: number, sPct: number, lPct: number, alpha: number): string {
  const [r, g, b] = hslToRgb(hDeg, sPct, lPct);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildCompatibleBookTheme(hDeg: number, sPct: number, lPct: number): BookBindingTheme {
  const h = ((hDeg % 360) + 360) % 360;
  const s = clamp(sPct, 6, 78);
  const l = clamp(lPct, 14, 52);
  const isWarm = h < 68 || h >= 315;

  return {
    primaryHex: hslToHex(h, s, l),
    spineEdge: hslToHex(h, clamp(s * 0.96, 8, 78), clamp(l * 0.48, 7, 26)),
    spineHi: hslToHex(h, clamp(s * 0.84, 10, 72), clamp(l * 1.48, 22, 62)),
    spineMid: hslToHex(h, clamp(s * 0.92, 10, 75), clamp(l * 0.96, 14, 46)),
    spineDeep: hslToHex(h, clamp(s * 0.98, 8, 78), clamp(l * 0.38, 6, 22)),
    spineBandHi: isWarm
      ? hslToRgba(42, clamp(s * 0.55, 18, 48), 84, 0.42)
      : hslToRgba(h, clamp(s * 0.42, 14, 38), 86, 0.4),
    spineBandLo: hslToRgba(h, clamp(s * 0.85, 12, 62), clamp(l * 0.25, 5, 14), 0.58),
    backHi: hslToHex(h, clamp(s * 0.9, 10, 72), clamp(l * 1.12, 16, 52)),
    backLo: hslToHex(h, clamp(s * 0.95, 8, 76), clamp(l * 0.52, 8, 28)),
    coverBg: hslToHex(h, clamp(s * 0.88, 8, 72), clamp(l * 0.64, 10, 32)),
    boardHi: hslToHex(h, clamp(s * 0.72, 8, 56), clamp(l * 0.66, 11, 29)),
    boardLo: hslToHex(h, clamp(s * 0.78, 6, 60), clamp(l * 0.34, 6, 16)),
    boardBorder: hslToRgba(h, clamp(s * 0.58, 12, 58), clamp(l * 1.65, 58, 84), 0.24),
  };
}

function readThemeFromStorage(cacheKey: string): BookBindingTheme | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${THEME_CACHE_PREFIX}${cacheKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BookBindingTheme>;
    if (
      parsed &&
      typeof parsed.spineHi === 'string' &&
      typeof parsed.backHi === 'string' &&
      typeof parsed.boardHi === 'string'
    ) {
      return parsed as BookBindingTheme;
    }
    return null;
  } catch {
    return null;
  }
}

function writeThemeToStorage(cacheKey: string, theme: BookBindingTheme): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${THEME_CACHE_PREFIX}${cacheKey}`, JSON.stringify(theme));
  } catch {
    // Ignore storage quota issues
  }
}

export function getCachedBookBindingTheme(
  bookId: string,
  sizeBytes: number
): BookBindingTheme | null {
  const key = makeThemeKey(bookId, sizeBytes);
  const mem = memoryThemeCache.get(key);
  if (mem) return mem;
  const stored = readThemeFromStorage(key);
  if (stored) {
    memoryThemeCache.set(key, stored);
    return stored;
  }
  return null;
}

function getSampleContext(): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
} | null {
  if (typeof document === 'undefined') return null;
  if (!sharedSampleCanvas) {
    sharedSampleCanvas = document.createElement('canvas');
    sharedSampleCanvas.width = 18;
    sharedSampleCanvas.height = 24;
    sharedSampleCtx = sharedSampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!sharedSampleCtx) return null;
  return { canvas: sharedSampleCanvas, ctx: sharedSampleCtx };
}

export function analyzeCoverPixelData(
  pixels: Uint8ClampedArray,
  width: number,
  height: number
): BookBindingTheme {
  const NUM_BINS = 12;
  const binChromaScore = new Float64Array(NUM_BINS);
  const binWeight = new Float64Array(NUM_BINS);
  const binR = new Float64Array(NUM_BINS);
  const binG = new Float64Array(NUM_BINS);
  const binB = new Float64Array(NUM_BINS);

  let totalWeight = 0;
  let totalChromaWeight = 0;
  let totalL = 0;
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;

  let spineEdgeWeight = 0;
  let spineEdgeChromaWeight = 0;
  let spineEdgeR = 0;
  let spineEdgeG = 0;
  let spineEdgeB = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = pixels[idx + 3];
      if (alpha < 128) continue;

      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const { s, l, h } = rgbToHsl(r, g, b);

      const isPerimeter = x <= 1 || x >= width - 2 || y <= 1 || y >= height - 2;
      const isSpineEdge = x <= 2 && y >= 2 && y <= height - 3;
      const weight = (isPerimeter ? 2.1 : 1.0) * (isSpineEdge ? 1.45 : 1.0);

      totalWeight += weight;
      totalL += l * weight;
      totalR += r * weight;
      totalG += g * weight;
      totalB += b * weight;

      if (isSpineEdge) {
        spineEdgeWeight += weight;
        if (s >= 0.16 && l >= 0.08 && l <= 0.88) {
          spineEdgeChromaWeight += weight;
          spineEdgeR += r * weight;
          spineEdgeG += g * weight;
          spineEdgeB += b * weight;
        }
      }

      if (s >= 0.16 && l >= 0.08 && l <= 0.88) {
        const bin = Math.floor(((h + 15) % 360) / 30);
        const midtoneBias = 1 - Math.abs(l - 0.45) * 0.55;
        const score = weight * (0.4 + s * 1.4) * Math.max(0.35, midtoneBias);
        binChromaScore[bin] += score;
        binWeight[bin] += weight;
        binR[bin] += r * score;
        binG[bin] += g * score;
        binB[bin] += b * score;
        totalChromaWeight += weight;
      }
    }
  }

  if (totalWeight === 0) {
    return buildCompatibleBookTheme(191, 38, 22);
  }

  const avgL = totalL / totalWeight;
  const chromaticRatio = totalChromaWeight / totalWeight;
  const spineEdgeChromaRatio = spineEdgeWeight > 0 ? spineEdgeChromaWeight / spineEdgeWeight : 0;

  let bestBin = 0;
  let bestScore = -1;
  for (let i = 0; i < NUM_BINS; i++) {
    const prev = (i + NUM_BINS - 1) % NUM_BINS;
    const next = (i + 1) % NUM_BINS;
    const smoothScore =
      binChromaScore[i] + (binChromaScore[prev] + binChromaScore[next]) * 0.35;
    if (smoothScore > bestScore) {
      bestScore = smoothScore;
      bestBin = i;
    }
  }

  const prevBin = (bestBin + NUM_BINS - 1) % NUM_BINS;
  const nextBin = (bestBin + 1) % NUM_BINS;
  const clusterWeight = binWeight[bestBin] + (binWeight[prevBin] + binWeight[nextBin]) * 0.5;
  const clusterCoverage = clusterWeight / totalWeight;

  if (clusterCoverage >= 0.045 || chromaticRatio >= 0.1 || spineEdgeChromaRatio >= 0.25) {
    let sumScore = binChromaScore[bestBin];
    let sumR = binR[bestBin];
    let sumG = binG[bestBin];
    let sumB = binB[bestBin];

    if (binChromaScore[prevBin] > binChromaScore[bestBin] * 0.35) {
      sumScore += binChromaScore[prevBin] * 0.65;
      sumR += binR[prevBin] * 0.65;
      sumG += binG[prevBin] * 0.65;
      sumB += binB[prevBin] * 0.65;
    }
    if (binChromaScore[nextBin] > binChromaScore[bestBin] * 0.35) {
      sumScore += binChromaScore[nextBin] * 0.65;
      sumR += binR[nextBin] * 0.65;
      sumG += binG[nextBin] * 0.65;
      sumB += binB[nextBin] * 0.65;
    }

    if (spineEdgeChromaRatio >= 0.3 && spineEdgeChromaWeight > 0) {
      const seR = spineEdgeR / spineEdgeChromaWeight;
      const seG = spineEdgeG / spineEdgeChromaWeight;
      const seB = spineEdgeB / spineEdgeChromaWeight;
      const seHsl = rgbToHsl(seR, seG, seB);
      const clusterRgb = sumScore > 0 ? [sumR / sumScore, sumG / sumScore, sumB / sumScore] : [seR, seG, seB];
      const clusterHsl = rgbToHsl(clusterRgb[0], clusterRgb[1], clusterRgb[2]);
      const hueDiff = Math.abs(((seHsl.h - clusterHsl.h + 540) % 360) - 180);
      if (hueDiff < 45 && sumScore > 0) {
        const boost = sumScore * 0.35;
        sumScore += boost;
        sumR += seR * boost;
        sumG += seG * boost;
        sumB += seB * boost;
      }
    }

    if (sumScore > 0) {
      const hsl = rgbToHsl(sumR / sumScore, sumG / sumScore, sumB / sumScore);
      const isLightCoverWithAccent = avgL > 0.68;
      const targetS = isLightCoverWithAccent
        ? clamp(hsl.s * 100, 34, 72)
        : clamp(hsl.s * 100, 22, 76);
      const targetL = isLightCoverWithAccent
        ? clamp(hsl.l * 100, 28, 43)
        : clamp(hsl.l * 100, 18, 48);
      return buildCompatibleBookTheme(hsl.h, targetS, targetL);
    }
  }

  const avgHsl = rgbToHsl(totalR / totalWeight, totalG / totalWeight, totalB / totalWeight);
  if (avgL < 0.3) {
    return buildCompatibleBookTheme(
      avgHsl.s > 0.04 ? avgHsl.h : 200,
      clamp(avgHsl.s * 100, 8, 22),
      clamp(avgL * 90 + 6, 15, 25)
    );
  }
  if (avgL > 0.72) {
    const warmth = (totalR - totalB) / totalWeight;
    return warmth >= 4
      ? buildCompatibleBookTheme(34, 18, 38)
      : buildCompatibleBookTheme(210, 18, 34);
  }
  return buildCompatibleBookTheme(
    avgHsl.s > 0.04 ? avgHsl.h : 204,
    clamp(avgHsl.s * 100, 10, 24),
    clamp(avgL * 78, 22, 40)
  );
}

export function extractBookBindingThemeFromImage(
  img: HTMLImageElement,
  bookId: string,
  sizeBytes: number
): BookBindingTheme | null {
  const key = makeThemeKey(bookId, sizeBytes);
  const cached = getCachedBookBindingTheme(bookId, sizeBytes);
  if (cached) return cached;

  if (!img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return null;
  }

  const sampler = getSampleContext();
  if (!sampler) return null;

  try {
    const { canvas, ctx } = sampler;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const theme = analyzeCoverPixelData(data, canvas.width, canvas.height);
    memoryThemeCache.set(key, theme);
    writeThemeToStorage(key, theme);
    return theme;
  } catch {
    return null;
  }
}

export function getBookBindingCssVars(
  theme?: BookBindingTheme | null
): CSSProperties | undefined {
  if (!theme) return undefined;
  return {
    '--book-spine-edge': theme.spineEdge,
    '--book-spine-hi': theme.spineHi,
    '--book-spine-mid': theme.spineMid,
    '--book-spine-deep': theme.spineDeep,
    '--book-band-hi': theme.spineBandHi,
    '--book-band-lo': theme.spineBandLo,
    '--book-back-hi': theme.backHi,
    '--book-back-lo': theme.backLo,
    '--book-cover-bg': theme.coverBg,
    '--book-board-hi': theme.boardHi,
    '--book-board-lo': theme.boardLo,
    '--book-board-border': theme.boardBorder,
  } as CSSProperties;
}
