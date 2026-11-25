import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const DB_NAME = 'folio-cover-cache-v1';
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
const MAX_CONCURRENCY = 3;

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

function isCanvasMostlyBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;
  const { width, height } = canvas;
  const sample = ctx.getImageData(0, 0, width, height).data;
  let nonWhitePixels = 0;
  const step = 16; // sample every 4th pixel for speed
  let totalSampled = 0;
  for (let i = 0; i < sample.length; i += step) {
    totalSampled += 1;
    const r = sample[i];
    const g = sample[i + 1];
    const b = sample[i + 2];
    if (r < 236 || g < 236 || b < 236) {
      nonWhitePixels += 1;
    }
  }
  return totalSampled > 0 && nonWhitePixels / totalSampled < 0.008;
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
    const maxCheck = Math.min(doc.numPages, 4);
    let chosenDataUrl = '';

    for (let pageNum = 1; pageNum <= maxCheck; pageNum++) {
      const page = await doc.getPage(pageNum);
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
      chosenDataUrl = finalCanvas.toDataURL('image/jpeg', 0.86);

      if (!isCanvasMostlyBlank(finalCanvas)) {
        break;
      }
    }

    if (!chosenDataUrl) {
      throw new Error('Empty PDF cover.');
    }
    return chosenDataUrl;
  } finally {
    void loadingTask.destroy();
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
