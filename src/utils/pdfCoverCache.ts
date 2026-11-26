import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const DB_NAME = 'folio-cover-cache-v4';
const STORE_NAME = 'covers';
const memoryCache = new Map<string, string>();
const inFlight = new Map<string, Promise<string>>();

interface QueueJob {
  cacheKey: string;
  bookId: string;
  resolve: (url: string) => void;
  reject: (err: unknown) => void;
}

const jobQueue: QueueJob[] = [];
let activeWorkers = 0;
const MAX_CONCURRENCY = 2;

function makeCacheKey(bookId: string, sizeBytes: number): string {
  return `${bookId}:${sizeBytes}`;
}

export function getCachedPdfCoverSync(bookId: string, sizeBytes: number): string | null {
  return memoryCache.get(makeCacheKey(bookId, sizeBytes)) || null;
}

function openCoverDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readFromDb(key: string): Promise<string | null> {
  const db = await openCoverDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeToDb(key: string, value: string): Promise<void> {
  const db = await openCoverDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function analyzeCoverCanvas(canvas: HTMLCanvasElement): { isRichCover: boolean; hasInk: boolean } {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { isRichCover: true, hasInk: true };
  const { width, height } = canvas;
  const sample = ctx.getImageData(0, 0, width, height).data;
  let nonWhitePixels = 0;
  let colorPixels = 0;
  const step = 16; // sample every 4th pixel for speed
  let totalSampled = 0;
  for (let i = 0; i < sample.length; i += step) {
    totalSampled += 1;
    const r = sample[i];
    const g = sample[i + 1];
    const b = sample[i + 2];
    if (r < 232 || g < 232 || b < 232) {
      nonWhitePixels += 1;
      const spread = Math.max(r, g, b) - Math.min(r, g, b);
      if (spread > 18) {
        colorPixels += 1;
      }
    }
  }
  if (totalSampled === 0) return { isRichCover: true, hasInk: true };
  const inkRatio = nonWhitePixels / totalSampled;
  const colorRatio = colorPixels / totalSampled;
  const hasInk = inkRatio >= 0.008;
  const isRichCover = inkRatio >= 0.025 && !(inkRatio < 0.14 && colorRatio < 0.004);
  return { isRichCover, hasInk };
}

async function isBoilerplateFrontPage(page: pdfjsLib.PDFPageProxy): Promise<boolean> {
  try {
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .slice(0, 1200);
    return /digital\s+copy\s+of\s+a\s+book|google\s+book\s+search|generated\s+by\s+google|books\.google\.com|scanned\s+by\s+google|there\s+are\s+no\s+known\s+copyright|cornell\s+university\s+library|baker\s+library|ex\s+libris|table\s+of\s+contents/i.test(
      text
    );
  } catch {
    return false;
  }
}

async function renderCoverFromPdf(bookId: string): Promise<string> {
  const url = `/api/vault/${encodeURIComponent(bookId)}/file`;
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

  try {
    const doc = await loadingTask.promise;
    const maxCheck = Math.min(doc.numPages, 7);
    let chosenDataUrl = '';
    let fallbackDataUrl = '';

    for (let pageNum = 1; pageNum <= maxCheck; pageNum++) {
      const page = await doc.getPage(pageNum);
      const isBoilerplate = await isBoilerplateFrontPage(page);
      if (isBoilerplate) {
        continue;
      }

      const baseViewport = page.getViewport({ scale: 1 });
      const targetScale = Math.max(0.25, Math.min(0.9, 340 / Math.max(1, baseViewport.width)));
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

      const finalCanvas = outCtx ? outputCanvas : canvas;
      const { isRichCover, hasInk } = analyzeCoverCanvas(finalCanvas);
      const dataUrl = isRichCover || (hasInk && !fallbackDataUrl)
        ? finalCanvas.toDataURL('image/jpeg', 0.84)
        : '';

      canvas.width = 0;
      canvas.height = 0;
      outputCanvas.width = 0;
      outputCanvas.height = 0;

      if (isRichCover && dataUrl) {
        chosenDataUrl = dataUrl;
        break;
      }
      if (hasInk && dataUrl && !fallbackDataUrl) {
        fallbackDataUrl = dataUrl;
      }
    }

    const result = chosenDataUrl || fallbackDataUrl;
    if (!result) {
      throw new Error('No visual cover page available.');
    }
    return result;
  } finally {
    void loadingTask.destroy();
  }
}

async function persistCoverToServer(bookId: string, dataUrl: string): Promise<void> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (blob.size < 400 || blob.size > 300 * 1024) return;
    await fetch(`/api/vault/${encodeURIComponent(bookId)}/cover`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    });
  } catch {
    // Non-critical server warm-up
  }
}

function pumpQueue() {
  while (activeWorkers < MAX_CONCURRENCY && jobQueue.length > 0) {
    const job = jobQueue.shift();
    if (!job) break;
    activeWorkers += 1;
    renderCoverFromPdf(job.bookId)
      .then((dataUrl) => {
        memoryCache.set(job.cacheKey, dataUrl);
        void writeToDb(job.cacheKey, dataUrl);
        void persistCoverToServer(job.bookId, dataUrl);
        job.resolve(dataUrl);
      })
      .catch((err) => {
        job.reject(err);
      })
      .finally(() => {
        activeWorkers -= 1;
        pumpQueue();
      });
  }
}

export async function getOrRenderPdfCover(
  bookId: string,
  sizeBytes: number,
  prioritize = false
): Promise<string> {
  const cacheKey = makeCacheKey(bookId, sizeBytes);
  const mem = memoryCache.get(cacheKey);
  if (mem) return mem;

  const existingPromise = inFlight.get(cacheKey);
  if (existingPromise) return existingPromise;

  const promise = (async () => {
    const cachedDb = await readFromDb(cacheKey);
    if (cachedDb) {
      memoryCache.set(cacheKey, cachedDb);
      return cachedDb;
    }

    return await new Promise<string>((resolve, reject) => {
      const job: QueueJob = { cacheKey, bookId, resolve, reject };
      if (prioritize) {
        jobQueue.unshift(job);
      } else {
        jobQueue.push(job);
      }
      pumpQueue();
    });
  })().finally(() => {
    inFlight.delete(cacheKey);
  });

  inFlight.set(cacheKey, promise);
  return promise;
}
