import 'dotenv/config';
import { execFile as execFileCb } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import express, { type Request, type Response } from 'express';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createServer as createViteServer } from 'vite';
import type {
  ArchiveInspection,
  ArchivePdfFile,
  ArchiveSearchHit,
  BookKeeperColor,
  ReadingStatus,
  RequestedBookSpec,
  SwingTradeEbook,
  VaultBook,
} from './src/types.ts';

const PORT = Number(process.env.PORT) || 3000;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const DATA_DIR = path.resolve(process.cwd(), 'data', 'vault');
const VAULT_FILES_DIR = path.resolve(DATA_DIR, 'files');
const VAULT_COVERS_DIR = path.resolve(DATA_DIR, 'covers');
const CATALOG_PATH = path.resolve(DATA_DIR, 'catalog.json');
const OVERRIDES_PATH = path.resolve(DATA_DIR, 'overrides.json');

const LIBRARY_DIR = path.resolve(process.cwd(), 'library');
const LIBRARY_BOOKS_DIR = path.resolve(LIBRARY_DIR, 'books');
const LIBRARY_COVERS_DIR = path.resolve(LIBRARY_DIR, 'covers');
const LIBRARY_CATALOG_PATH = path.resolve(LIBRARY_DIR, 'catalog.json');

fs.mkdirSync(VAULT_FILES_DIR, { recursive: true });
fs.mkdirSync(VAULT_COVERS_DIR, { recursive: true });
fs.mkdirSync(LIBRARY_COVERS_DIR, { recursive: true });

const execFileAsync = promisify(execFileCb);
const GOOGLE_DISCLAIMER_RE =
  /digital\s+copy\s+of\s+a\s+book|google\s+book\s+search|generated\s+by\s+google|books\.google\.com|scanned\s+by\s+google/i;
const inFlightCovers = new Map<string, Promise<string | null>>();
const unavailableCovers = new Set<string>();
let activeCoverWorkers = 0;
const coverWaitQueue: Array<() => void> = [];

function resolveSafeCoverPath(baseDir: string, bookId: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(bookId)) {
    throw new Error('Invalid book cover identifier.');
  }
  const resolved = path.resolve(baseDir, `${bookId}.jpg`);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('Resolved cover path escapes storage boundary.');
  }
  return resolved;
}

async function withCoverSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeCoverWorkers >= 2) {
    await new Promise<void>((resolve) => {
      coverWaitQueue.push(resolve);
    });
  }
  activeCoverWorkers += 1;
  try {
    return await fn();
  } finally {
    activeCoverWorkers -= 1;
    const next = coverWaitQueue.shift();
    if (next) next();
  }
}

async function pickFirstReadablePage(pdfPath: string): Promise<{ startPage: number; numPages: number }> {
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const loadingTask = pdfjsLib.getDocument({ data, verbosity: 0 });
  try {
    const doc = await loadingTask.promise;
    const maxCheck = Math.min(doc.numPages, 7);
    let startPage = 1;
    for (let p = 1; p <= maxCheck; p++) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const text = tc.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
        .replace(/\s+/g, ' ')
        .slice(0, 1000);
      if (GOOGLE_DISCLAIMER_RE.test(text) && p < maxCheck) {
        startPage = p + 1;
      } else {
        break;
      }
    }
    return { startPage, numPages: doc.numPages };
  } catch {
    return { startPage: 1, numPages: 5 };
  } finally {
    await loadingTask.destroy().catch(() => {});
  }
}

async function ensureServerPdfCover(
  bookId: string,
  pdfPath: string,
  destDir: string
): Promise<string | null> {
  let outPath: string;
  try {
    outPath = resolveSafeCoverPath(destDir, bookId);
  } catch {
    return null;
  }

  if (unavailableCovers.has(outPath)) {
    return null;
  }

  if (fs.existsSync(outPath) && fs.statSync(outPath).size > 400) {
    return outPath;
  }

  const existing = inFlightCovers.get(outPath);
  if (existing) return existing;

  const job = withCoverSlot(async () => {
    if (unavailableCovers.has(outPath)) return null;
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 400) {
      return outPath;
    }
    if (!fs.existsSync(pdfPath)) return null;

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-cov-'));
    try {
      const { startPage, numPages } = await pickFirstReadablePage(pdfPath);
      const lastPage = Math.min(numPages, startPage + 5);

      await execFileAsync(
        'gs',
        [
          '-dNOPAUSE',
          '-dBATCH',
          '-dSAFER',
          '-dQUIET',
          '-sDEVICE=jpeg',
          '-dJPEGQ=86',
          '-r96',
          `-dFirstPage=${startPage}`,
          `-dLastPage=${lastPage}`,
          `-sOutputFile=${path.join(tmpDir, 'p-%d.jpg')}`,
          pdfPath,
        ],
        { timeout: 25000 }
      );

      const files = fs
        .readdirSync(tmpDir)
        .filter((f) => f.endsWith('.jpg'))
        .sort((a, b) => {
          const na = Number(a.match(/\d+/)?.[0] || 0);
          const nb = Number(b.match(/\d+/)?.[0] || 0);
          return na - nb;
        });

      let chosen: string | null = null;
      for (const f of files) {
        const fp = path.join(tmpDir, f);
        try {
          const { stdout } = await execFileAsync('convert', [
            fp,
            '-colorspace',
            'HSB',
            '-format',
            '%[fx:mean.g] %[fx:mean.b] %[fx:standard_deviation]',
            'info:',
          ]);
          const [meanSat, meanBri, std] = stdout.trim().split(' ').map(Number);
          const isBlankOrScan =
            Number.isNaN(std) ||
            std < 0.055 ||
            meanBri > 0.985 ||
            (meanBri > 0.91 && meanSat < 0.025);
          if (!isBlankOrScan) {
            chosen = f;
            break;
          }
        } catch {
          // Continue checking candidate pages
        }
      }

      if (!chosen) {
        unavailableCovers.add(outPath);
        return null;
      }

      const tmpOut = path.join(tmpDir, 'final.jpg');
      await execFileAsync('convert', [
        path.join(tmpDir, chosen),
        '-background',
        'white',
        '-alpha',
        'remove',
        '-alpha',
        'off',
        '-resize',
        '340x',
        '-strip',
        '-quality',
        '82',
        tmpOut,
      ]);

      fs.copyFileSync(tmpOut, outPath);
      return outPath;
    } catch {
      unavailableCovers.add(outPath);
      return null;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }).finally(() => {
    inFlightCovers.delete(outPath);
  });

  inFlightCovers.set(outPath, job);
  return job;
}

const ALLOWED_ARCHIVE_HOSTS = [
  'archive.org',
  'openlibrary.org',
  'commons.wikimedia.org',
  'upload.wikimedia.org',
  'www.gutenberg.org',
  'gutenberg.org',
  'www.swing-trade-stocks.com',
  'infobooks.org',
  'pdf.infobooks.org',
];

function isPrivateOrLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (lower === 'localhost' || lower.endsWith('.local') || lower === '0.0.0.0') {
    return true;
  }
  const ipVersion = net.isIP(lower);
  if (ipVersion === 4) {
    const parts = lower.split('.').map(Number);
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    return true; // Block all raw IPv4 literals for outbound archive fetches
  }
  if (ipVersion === 6 || lower.startsWith('[')) {
    return true;
  }
  return false;
}

function isAllowedRemoteHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (isPrivateOrLoopbackHost(lower)) return false;
  return ALLOWED_ARCHIVE_HOSTS.some(
    (allowed) => lower === allowed || lower.endsWith(`.${allowed}`)
  );
}

function validateRemoteHttpsUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== 'https:') {
    throw new Error('Only HTTPS archive URLs are permitted.');
  }
  if (!isAllowedRemoteHost(parsed.hostname)) {
    throw new Error(`Host "${parsed.hostname}" is not in the approved archive allowlist.`);
  }
  return parsed;
}

function validateIdentifier(id: string): string {
  const trimmed = id.trim();
  if (!/^[a-zA-Z0-9._-]{2,120}$/.test(trimmed)) {
    throw new Error('Invalid Archive.org identifier format.');
  }
  return trimmed;
}

function resolvePdfPathInDir(baseDir: string, storedFilename: string): string {
  if (!/^[a-zA-Z0-9_-]+\.pdf$/.test(storedFilename)) {
    throw new Error('Invalid stored filename.');
  }
  const resolved = path.resolve(baseDir, storedFilename);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('Resolved path escapes storage boundary.');
  }
  return resolved;
}

function resolveVaultFilePath(storedFilename: string): string {
  return resolvePdfPathInDir(VAULT_FILES_DIR, storedFilename);
}

function resolveLibraryFilePath(storedFilename: string): string {
  return resolvePdfPathInDir(LIBRARY_BOOKS_DIR, storedFilename);
}

function sanitizeDownloadFilename(name: string): string {
  const base = name
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'document'}.pdf`;
}

interface BookOverride {
  notes?: string;
  readingStatus?: ReadingStatus;
  hidden?: boolean;
  lastPage?: number | null;
  totalPages?: number | null;
  bookmarkedPage?: number | null;
  keeperColor?: BookKeeperColor | null;
  lastReadAt?: string | null;
}

interface CachedBookList {
  mtimeMs: number;
  size: number;
  items: VaultBook[];
}

const bookListCache = new Map<string, CachedBookList>();
let overridesCache: { mtimeMs: number; size: number; data: Record<string, BookOverride> } | null = null;

function hasValidRemoteSourceUrl(sourceUrl: unknown): sourceUrl is string {
  if (typeof sourceUrl !== 'string' || !sourceUrl.trim()) return false;
  try {
    validateRemoteHttpsUrl(sourceUrl);
    return true;
  } catch {
    return false;
  }
}

function readBookListFromFile(catalogFilePath: string, filesDir: string): VaultBook[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(catalogFilePath);
  } catch {
    bookListCache.delete(catalogFilePath);
    return [];
  }

  const cached = bookListCache.get(catalogFilePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.items;
  }

  try {
    const raw = fs.readFileSync(catalogFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const items = parsed.filter((item): item is VaultBook => {
      if (!item || typeof item.id !== 'string' || typeof item.storedFilename !== 'string') {
        return false;
      }
      if (hasValidRemoteSourceUrl(item.sourceUrl)) {
        return true;
      }
      try {
        const filePath = resolvePdfPathInDir(filesDir, item.storedFilename);
        return fs.existsSync(filePath);
      } catch {
        return false;
      }
    });
    bookListCache.set(catalogFilePath, { mtimeMs: stat.mtimeMs, size: stat.size, items });
    return items;
  } catch {
    return [];
  }
}

function readCatalog(): VaultBook[] {
  return readBookListFromFile(CATALOG_PATH, VAULT_FILES_DIR);
}

function readRepoLibrary(): VaultBook[] {
  return readBookListFromFile(LIBRARY_CATALOG_PATH, LIBRARY_BOOKS_DIR);
}

function readOverrides(): Record<string, BookOverride> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(OVERRIDES_PATH);
  } catch {
    overridesCache = null;
    return {};
  }

  if (overridesCache && overridesCache.mtimeMs === stat.mtimeMs && overridesCache.size === stat.size) {
    return overridesCache.data;
  }

  try {
    const raw = fs.readFileSync(OVERRIDES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const data = parsed as Record<string, BookOverride>;
    overridesCache = { mtimeMs: stat.mtimeMs, size: stat.size, data };
    return data;
  } catch {
    return {};
  }
}

function writeOverrides(overrides: Record<string, BookOverride>): void {
  const tempPath = `${OVERRIDES_PATH}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(overrides, null, 2), 'utf8');
  fs.renameSync(tempPath, OVERRIDES_PATH);
  overridesCache = null;
}

function applyOverride(book: VaultBook, override?: BookOverride): VaultBook {
  if (!override) return book;
  return {
    ...book,
    ...(typeof override.notes === 'string' ? { notes: override.notes } : {}),
    ...(override.readingStatus ? { readingStatus: override.readingStatus } : {}),
    ...(override.lastPage !== undefined ? { lastPage: override.lastPage } : {}),
    ...(override.totalPages !== undefined ? { totalPages: override.totalPages } : {}),
    ...(override.bookmarkedPage !== undefined ? { bookmarkedPage: override.bookmarkedPage } : {}),
    ...(override.keeperColor !== undefined ? { keeperColor: override.keeperColor } : {}),
    ...(override.lastReadAt !== undefined ? { lastReadAt: override.lastReadAt } : {}),
  };
}

function getCombinedCatalog(): VaultBook[] {
  const uploads = readCatalog();
  const repoBooks = readRepoLibrary();
  const overrides = readOverrides();
  const uploadKeys = new Set(uploads.map((item) => item.bookKey).filter(Boolean));

  const visibleRepoBooks = repoBooks
    .filter((book) => {
      if (overrides[book.id]?.hidden) return false;
      if (book.bookKey && uploadKeys.has(book.bookKey)) return false;
      return true;
    })
    .map((book) => applyOverride(book, overrides[book.id]));

  return [...uploads, ...visibleRepoBooks];
}

function writeCatalog(items: VaultBook[]): void {
  const tempPath = `${CATALOG_PATH}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(items, null, 2), 'utf8');
  fs.renameSync(tempPath, CATALOG_PATH);
  bookListCache.delete(CATALOG_PATH);
}

let catalogLock: Promise<void> = Promise.resolve();

function mutateCatalog(updater: (current: VaultBook[]) => VaultBook[]): Promise<void> {
  const next = catalogLock.then(() => {
    const current = readCatalog();
    const updated = updater(current);
    writeCatalog(updated);
  });
  catalogLock = next.catch(() => {});
  return next;
}

let overridesLock: Promise<void> = Promise.resolve();

function mutateOverrides(
  updater: (current: Record<string, BookOverride>) => Record<string, BookOverride>
): Promise<void> {
  const next = overridesLock.then(() => {
    const current = readOverrides();
    const updated = updater(current);
    writeOverrides(updated);
  });
  overridesLock = next.catch(() => {});
  return next;
}

interface FetchAllowlistedOptions {
  method?: 'GET' | 'HEAD';
  extraHeaders?: Record<string, string>;
  signal?: AbortSignal;
}

async function fetchAllowlisted(
  rawUrl: string,
  maxRedirects = 5,
  options?: FetchAllowlistedOptions
): Promise<globalThis.Response> {
  let parsed = validateRemoteHttpsUrl(rawUrl);
  let currentUrl = parsed.toString();
  const method = options?.method || 'GET';

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const isInfobooks =
      parsed.hostname === 'infobooks.org' || parsed.hostname.endsWith('.infobooks.org');
    const headers: Record<string, string> = {
      ...(options?.extraHeaders || {}),
      'User-Agent': isInfobooks
        ? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        : 'FolioVault/1.0 (Personal Digital Library)',
    };
    if (isInfobooks) {
      headers['Referer'] = 'https://infobooks.org/';
    }
    const res = await fetch(currentUrl, {
      method,
      redirect: 'manual',
      headers,
      signal: options?.signal,
    });
    if (res.status >= 300 && res.status < 400) {
      void res.body?.cancel().catch(() => {});
      const location = res.headers.get('location');
      if (!location) {
        throw new Error('Redirect response missing Location header.');
      }
      const nextUrl = new URL(location, currentUrl);
      parsed = validateRemoteHttpsUrl(nextUrl.toString());
      currentUrl = parsed.toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects while fetching archive resource.');
}

async function probeRemotePdfSource(
  pdfUrl: string
): Promise<{ ok: boolean; status: number; sizeBytes: number; isPdf: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetchAllowlisted(pdfUrl, 5, {
      method: 'GET',
      extraHeaders: { Range: 'bytes=0-1023' },
      signal: controller.signal,
    });
    if (!res.ok) {
      void res.body?.cancel().catch(() => {});
      return { ok: false, status: res.status, sizeBytes: 0, isPdf: false };
    }

    let sizeBytes = 0;
    const contentRange = res.headers.get('content-range');
    if (contentRange) {
      const match = contentRange.match(/\/(\d+)\s*$/);
      if (match) {
        sizeBytes = Number(match[1]) || 0;
      }
    }
    if (!sizeBytes && res.status === 200) {
      sizeBytes = Number(res.headers.get('content-length') || 0);
    }

    let headBytes = Buffer.alloc(0);
    if (res.body) {
      const reader = res.body.getReader();
      try {
        while (headBytes.byteLength < 16) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          headBytes = Buffer.concat([headBytes, Buffer.from(value)]);
        }
      } finally {
        void reader.cancel().catch(() => {});
      }
    }

    const isPdf = headBytes.subarray(0, 5).toString('ascii') === '%PDF-';
    return { ok: true, status: res.status, sizeBytes, isPdf };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectArchiveIdentifier(identifier: string): Promise<ArchiveInspection> {
  const safeId = validateIdentifier(identifier);
  const res = await fetchAllowlisted(`https://archive.org/metadata/${encodeURIComponent(safeId)}`);
  if (!res.ok) {
    throw new Error(`Archive metadata request failed (${res.status}).`);
  }
  const data = (await res.json()) as {
    metadata?: Record<string, unknown>;
    files?: Array<{
      name?: string;
      size?: string | number;
      format?: string;
      private?: string;
    }>;
  };
  const meta = data.metadata || {};
  const restrictedRaw = meta['access-restricted-item'];
  const isRestricted = restrictedRaw === true || restrictedRaw === 'true';

  const freePdfs: ArchivePdfFile[] = [];
  if (!isRestricted && Array.isArray(data.files)) {
    for (const file of data.files) {
      if (
        typeof file.name === 'string' &&
        file.name.toLowerCase().endsWith('.pdf') &&
        file.private !== 'true' &&
        !(file.format || '').toLowerCase().includes('encrypted')
      ) {
        freePdfs.push({
          name: file.name,
          sizeBytes: Number(file.size) || 0,
          format: file.format || 'PDF',
          downloadUrl: `https://archive.org/download/${encodeURIComponent(safeId)}/${encodeURIComponent(file.name)}`,
        });
      }
    }
  }

  freePdfs.sort((a, b) => {
    const aText = a.format.toLowerCase().includes('text pdf') ? 0 : 1;
    const bText = b.format.toLowerCase().includes('text pdf') ? 0 : 1;
    if (aText !== bText) return aText - bText;
    return b.sizeBytes - a.sizeBytes;
  });

  const titleVal = Array.isArray(meta.title) ? meta.title[0] : meta.title;
  const creatorVal = Array.isArray(meta.creator) ? meta.creator[0] : meta.creator;
  const yearVal = Array.isArray(meta.year) ? meta.year[0] : meta.year;

  return {
    identifier: safeId,
    title: typeof titleVal === 'string' ? titleVal : safeId,
    creator: typeof creatorVal === 'string' ? creatorVal : 'Unknown',
    year: yearVal ? String(yearVal) : '',
    isRestricted,
    detailsUrl: `https://archive.org/details/${encodeURIComponent(safeId)}`,
    borrowUrl: `https://archive.org/details/${encodeURIComponent(safeId)}`,
    freePdfs,
  };
}

function buildRequestedBooksCatalog(vault: VaultBook[]): RequestedBookSpec[] {
  const findStored = (key: string) =>
    vault.find((item) => item.bookKey === key) || null;

  return [
    {
      bookKey: 'one-up-on-wall-street',
      accessionCode: 'FOL.1989.03',
      title: 'One Up on Wall Street',
      subtitle: 'How to use what you already know to make money in the market',
      author: 'Peter Lynch & John Rothchild',
      year: 1989,
      rights: 'controlled_lending',
      rightsLabel: 'In Copyright · Library Lending Only',
      rightsExplanation:
        'Published in 1989 and still under copyright. No legal unencrypted public-domain PDF exists; you can borrow it free via Open Library Controlled Digital Lending or upload your own personal PDF copy to store it in this vault.',
      coverPath: '/src/assets/images/cover_one_up_wall_street_1795617501444.jpg',
      archiveIdentifier: 'oneuponwallstree00lync',
      alternateArchiveIdentifiers: ['oneuponwallstree00lync_0', 'oneuponwallstree0000lync'],
      openLibraryUrl: 'https://openlibrary.org/works/OL2841891W/One_up_on_Wall_Street',
      archiveDetailsUrl: 'https://archive.org/details/oneuponwallstree00lync',
      secondarySources: [
        {
          label: 'Open Library Borrow Page',
          url: 'https://openlibrary.org/works/OL2841891W/One_up_on_Wall_Street',
        },
        {
          label: 'Internet Archive Loan Copy',
          url: 'https://archive.org/details/oneuponwallstree00lync_0',
        },
      ],
      summary:
        'Explains how everyday investors can spot tenbaggers by categorizing companies into slow growers, stalwarts, fast growers, cyclicals, turnarounds, and asset plays.',
      storedItem: findStored('one-up-on-wall-street'),
    },
  ];
}

interface EbookDefinition {
  bookKey: string;
  indexNumber: number;
  title: string;
  authorOrFocus: string;
  description: string;
  filename: string;
  pdfUrl: string;
}

const SWING_TRADE_SOURCE_PAGE = 'https://www.swing-trade-stocks.com/e-books.html';

const SWING_TRADE_EBOOKS: EbookDefinition[] = [
  {
    bookKey: 'sts-killer-patterns',
    indexNumber: 1,
    title: 'Killer Patterns',
    authorOrFocus: 'Swing-Trade-Stocks Guide',
    description: 'Using MACD histograms to generate systematic buy and sell signals.',
    filename: 'killerpatternsupdated_sts.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/killerpatternsupdated_sts.pdf',
  },
  {
    bookKey: 'sts-intro-forex',
    indexNumber: 2,
    title: 'Introduction to Forex',
    authorOrFocus: 'Currency Markets Primer',
    description: 'Explains the foreign exchange market and foundational currency trading mechanics.',
    filename: 'introductiontoforex.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/introductiontoforex.pdf',
  },
  {
    bookKey: 'sts-trader-plan',
    indexNumber: 3,
    title: 'The Trader Business Plan',
    authorOrFocus: 'Christopher Terry',
    description: 'Structuring a trading business plan including methodologies, goal setting, and record keeping.',
    filename: 'traderplan.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/traderplan.pdf',
  },
  {
    bookKey: 'sts-charting-made-easy',
    indexNumber: 4,
    title: 'Charting Made Easy',
    authorOrFocus: 'Technical Analysis Primer',
    description: 'Covers support and resistance levels, trend lines, and foundational chart patterns.',
    filename: 'chartingmadeeasy.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/chartingmadeeasy.pdf',
  },
  {
    bookKey: 'sts-fibonacci',
    indexNumber: 5,
    title: 'The Truth About Fibonacci Trading',
    authorOrFocus: 'Bill Poulos',
    description: 'Step-by-step introduction to Fibonacci retracements and price extensions.',
    filename: 'fib.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/fib.pdf',
  },
  {
    bookKey: 'sts-indicators',
    indexNumber: 6,
    title: 'The eBook of Technical Market Indicators',
    authorOrFocus: 'Market Breadth & Sentiment',
    description: 'Covers advance/decline indicators, short-sale statistics, and market sentiment metrics.',
    filename: 'indicators.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/indicators.pdf',
  },
  {
    bookKey: 'sts-practical-swing',
    indexNumber: 7,
    title: 'A Practical Guide To Swing Trading',
    authorOrFocus: 'Larry Swing',
    description: 'Covers candlesticks, trend identification, moving averages, and swing setups.',
    filename: 'myswingtradingbook.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/myswingtradingbook.pdf',
  },
  {
    bookKey: 'sts-millionaire-traders',
    indexNumber: 8,
    title: 'Secrets of Millionaire Traders',
    authorOrFocus: 'Trader Interviews Collection',
    description: '25 trading lessons and discipline habits distilled from interviews with experienced traders.',
    filename: 'million.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/million.pdf',
  },
  {
    bookKey: 'sts-day-trading-mind',
    indexNumber: 9,
    title: 'Day Trading Mind',
    authorOrFocus: 'Trading Psychology',
    description: 'Practical mental focus techniques and emotional discipline routines for active traders.',
    filename: 'daytradingmind.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/daytradingmind.pdf',
  },
  {
    bookKey: 'sts-pattern-cycles',
    indexNumber: 10,
    title: 'Pattern Cycles',
    authorOrFocus: 'Alan Farley',
    description: 'Bottom reversals, breakouts, trend transitions, and Elliott Wave structure.',
    filename: 'patterncycles.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/patterncycles.pdf',
  },
  {
    bookKey: 'sts-candlestick-pivot',
    indexNumber: 11,
    title: 'Swing Trading Using Candlestick Charting',
    authorOrFocus: 'John Person',
    description: 'Combining candlestick charting formations with pivot point support/resistance analysis.',
    filename: 'swingtradingpivot.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/swingtradingpivot.pdf',
  },
  {
    bookKey: 'sts-top-trading-profits',
    indexNumber: 12,
    title: 'Keys To Top Trading Profits',
    authorOrFocus: 'George Lane, Larry Williams, Linda Raschke & others',
    description: '18 trading champions share risk, indicator, and execution insights across interviews.',
    filename: 'championstradingprofits.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/championstradingprofits.pdf',
  },
  {
    bookKey: 'sts-three-swing-examples',
    indexNumber: 13,
    title: 'Three Swing Trading Examples',
    authorOrFocus: 'Alan Farley',
    description: 'Walkthrough of three complete swing trading setups with annotated charts and rules.',
    filename: 'alanfarley.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/alanfarley.pdf',
  },
  {
    bookKey: 'sts-seven-habits',
    indexNumber: 14,
    title: '7 Habits Of A Highly Successful Trader',
    authorOrFocus: 'Mark Crisp',
    description: 'Examines seven core habits shared by consistently disciplined traders.',
    filename: 'successfultrader.pdf',
    pdfUrl: 'https://www.swing-trade-stocks.com/support-files/successfultrader.pdf',
  },
];

let ebookProbeCache: {
  checkedAt: number;
  statusByKey: Record<string, { available: boolean; sizeBytes: number | null }>;
} | null = null;

async function probeSwingTradeEbooks(): Promise<
  Record<string, { available: boolean; sizeBytes: number | null }>
> {
  const now = Date.now();
  if (ebookProbeCache && now - ebookProbeCache.checkedAt < 5 * 60 * 1000) {
    return ebookProbeCache.statusByKey;
  }

  const entries = await Promise.all(
    SWING_TRADE_EBOOKS.map(async (item) => {
      try {
        validateRemoteHttpsUrl(item.pdfUrl);
        const head = await fetch(item.pdfUrl, {
          method: 'HEAD',
          redirect: 'manual',
          headers: { 'User-Agent': 'FolioVault/1.0 (Personal Digital Library)' },
        });
        const contentType = (head.headers.get('content-type') || '').toLowerCase();
        const available = head.ok && contentType.includes('pdf');
        const len = Number(head.headers.get('content-length') || 0);
        return [
          item.bookKey,
          { available, sizeBytes: available && len > 0 ? len : null },
        ] as const;
      } catch {
        return [item.bookKey, { available: false, sizeBytes: null }] as const;
      }
    })
  );

  const statusByKey: Record<string, { available: boolean; sizeBytes: number | null }> = {};
  for (const [k, v] of entries) {
    statusByKey[k] = v;
  }
  ebookProbeCache = { checkedAt: now, statusByKey };
  return statusByKey;
}

const INFOBOOKS_SOURCE_PAGE = 'https://infobooks.org/free-pdf-books/business/trading/#trading-books';

const INFOBOOKS_TRADING_BOOKS: EbookDefinition[] = [
  {
    bookKey: 'ib-trading-volatility',
    indexNumber: 1,
    title: 'Trading Volatility',
    authorOrFocus: 'Colin Bennet',
    description: 'Comprehensive guide to volatility trading covering options, hedging, and derivatives strategies.',
    filename: 'Trading-Volatility-Colin-Bennet.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/500%20Trading/Trading-Volatility-Colin-Bennet.pdf',
  },
  {
    bookKey: 'ib-first-trading-manual',
    indexNumber: 2,
    title: 'The First Trading Manual: Foundation Course and Strategies',
    authorOrFocus: 'Trader Tom',
    description: 'Foundation course covering technical analysis, price action, candlestick patterns, and trading psychology.',
    filename: 'The-First-Trading-Manual-Foundation-Course-and-Strategies-Trader-Tom.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/500%20Trading/The-First-Trading-Manual-Foundation-Course-and-Strategies-Trader-Tom.pdf',
  },
  {
    bookKey: 'ib-complete-guide-trading',
    indexNumber: 3,
    title: 'The Complete Guide to Trading',
    authorOrFocus: 'Corporate Finance Institute',
    description: 'Covers financial markets, trading concepts, stocks, bonds, forex, and derivatives fundamentals.',
    filename: 'the-complete-guide-to-trading-corporate-finance-institute-413.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/the-complete-guide-to-trading-corporate-finance-institute-413.pdf',
  },
  {
    bookKey: 'ib-mastering-trading-psychology',
    indexNumber: 4,
    title: 'Mastering Trading Psychology',
    authorOrFocus: 'Andrew Aziz & Mike Baehr',
    description: 'Exploration of trading psychology covering mindset, emotional discipline, and risk tolerance.',
    filename: 'mastering-trading-psychology-andrew-aziz-and-mike-baehr-414.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/mastering-trading-psychology-andrew-aziz-and-mike-baehr-414.pdf',
  },
  {
    bookKey: 'ib-liquidity-markets-trading',
    indexNumber: 5,
    title: 'Liquidity, Markets and Trading in Action',
    authorOrFocus: 'Deniz Ozenbas, Michael S. Pagano, Robert A. Schwartz, Bruce W. Weber',
    description: 'Explores market microstructure, liquidity, finance, and order execution dynamics.',
    filename: 'liquidity-markets-and-trading-in-action-deniz-ozenbas-michael-s-pagano-robert-a-schwartz-bruce-w-weber-656.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/liquidity-markets-and-trading-in-action-deniz-ozenbas-michael-s-pagano-robert-a-schwartz-bruce-w-weber-656.pdf',
  },
  {
    bookKey: 'ib-trading-system-development',
    indexNumber: 6,
    title: 'Introduction to Trading System Development',
    authorOrFocus: 'David Cardoza',
    description: 'Building automated trading systems, trend-following crossovers, Monte Carlo analysis, and backtesting.',
    filename: '04.-Introduction-to-Trading-System-Development-Author-David-Cardoza.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/500%20Trading/04.-Introduction-to-Trading-System-Development-Author-David-Cardoza.pdf',
  },
  {
    bookKey: 'ib-complete-guide-day-trading',
    indexNumber: 7,
    title: 'A Complete Guide to Day Trading',
    authorOrFocus: 'Markus Heitkoetter',
    description: 'Day trading course covering market selection, 7-step strategy development, entry/exit rules, and money management.',
    filename: 'a-complete-guide-to-day-trading-markus-heitkoetter-412.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/a-complete-guide-to-day-trading-markus-heitkoetter-412.pdf',
  },
  {
    bookKey: 'ib-day-traders-bible',
    indexNumber: 9,
    title: "The Day Trader's Bible",
    authorOrFocus: 'Richard D. Wyckoff',
    description: 'Classic 1919 seminal work on tape reading, supply and demand, and market psychology.',
    filename: 'the-day-trader-s-bible-richard-d-wyckoff-416.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/the-day-trader-s-bible-richard-d-wyckoff-416.pdf',
  },
  {
    bookKey: 'ib-9-advanced-strategies',
    indexNumber: 10,
    title: '9 Advanced and Profitable Trading Strategies',
    authorOrFocus: 'Roman Sadowski',
    description: 'Covers momentum reversal, moving average crossover, Heikin-Ashi, RSI divergence, and Bollinger Bands.',
    filename: '08.-9-Advanced-and-Profitable-Trading-Strategies-Author-Roman-Sadowski.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/500%20Trading/08.-9-Advanced-and-Profitable-Trading-Strategies-Author-Roman-Sadowski.pdf',
  },
  {
    bookKey: 'ib-how-to-trade-price-action',
    indexNumber: 11,
    title: 'How to Trade Price Action',
    authorOrFocus: 'Galen Woods',
    description: '11 chapters covering candlestick patterns, chart formations, and concrete price-action setups.',
    filename: 'how-to-trade-price-action-galen-woods-415.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/how-to-trade-price-action-galen-woods-415.pdf',
  },
  {
    bookKey: 'ib-power-of-divergence',
    indexNumber: 12,
    title: 'The Power of Divergence Trading',
    authorOrFocus: 'David Carli',
    description: 'Focused guide on regular and hidden divergence strategies using RSI and MACD indicators.',
    filename: 'the-power-of-divergence-trading-david-carli-418.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/the-power-of-divergence-trading-david-carli-418.pdf',
  },
  {
    bookKey: 'ib-10-most-profitable',
    indexNumber: 13,
    title: '10 Most Profitable Trading Strategies',
    authorOrFocus: 'Nikhil Porwal',
    description: 'Covers Inside Bar, Doji Reversal, Engulfing patterns, Trendline Breakout, Darvas Box, and ADX*EMA.',
    filename: '10-most-profitable-trading-strategies-nikhil-porwal-419.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/10-most-profitable-trading-strategies-nikhil-porwal-419.pdf',
  },
  {
    bookKey: 'ib-practical-guide-swing-larry',
    indexNumber: 14,
    title: 'A Practical Guide to Swing Trading (InfoBooks Edition)',
    authorOrFocus: 'Larry Swing',
    description: "Practical swing trading guide with 'The Master Plan' entry/exit rules, candlesticks, and case studies.",
    filename: '01.-A-Practical-Guide-to-Swing-Trading-Author-Larry-Swing.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/500%20Trading/01.-A-Practical-Guide-to-Swing-Trading-Author-Larry-Swing.pdf',
  },
  {
    bookKey: 'ib-short-swing-trading',
    indexNumber: 15,
    title: 'Short Swing Trading',
    authorOrFocus: 'David Graeme-Smith',
    description: 'Step-by-step SST swing trading methodology covering pattern recognition, entry triggers, and stops.',
    filename: 'short-swing-trading-david-graeme-smith-417.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/short-swing-trading-david-graeme-smith-417.pdf',
  },
  {
    bookKey: 'ib-first-time-investor',
    indexNumber: 16,
    title: 'First-Time Investor: Grow and Protect Your Money',
    authorOrFocus: 'Paul A. Merriman & Richard Buck',
    description: 'Core habits and portfolio choices that shape long-term equity and wealth returns.',
    filename: '01.First-Time-Investor-Grow-and-Protect-your-Money-Autor-Paul-A.-Merriman-and-Richard-Buck.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/01.First-Time-Investor-Grow-and-Protect-your-Money-Autor-Paul-A.-Merriman-and-Richard-Buck.pdf',
  },
  {
    bookKey: 'ib-good-investor',
    indexNumber: 17,
    title: 'The Good Investor',
    authorOrFocus: 'Adrian Hornsby & Gabi Blumberg',
    description: 'Practical framework for screening opportunities, allocating capital, and measuring portfolio results.',
    filename: 'The-Good-Investor-Adrian-Hornsby-Gabi-Blumberg.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/The-Good-Investor-Adrian-Hornsby-Gabi-Blumberg.pdf',
  },
  {
    bookKey: 'ib-investing-for-beginners',
    indexNumber: 18,
    title: 'Investing for Beginners',
    authorOrFocus: 'The Motley Fool',
    description: 'Plain-language introduction to stock investing, compounding, and long-term wealth building.',
    filename: 'Investing-for-Beginners-The-Motley-Fool.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/Investing-for-Beginners-The-Motley-Fool.pdf',
  },
  {
    bookKey: 'ib-guide-to-investing',
    indexNumber: 19,
    title: 'A Guide to Investing',
    authorOrFocus: 'Schroders',
    description: 'Institutional overview of risk, inflation protection, asset classes, and portfolio construction.',
    filename: '15.A-Guide-to-Investing-Autor-Schroders.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/15.A-Guide-to-Investing-Autor-Schroders.pdf',
  },
  {
    bookKey: 'ib-become-successful-investor',
    indexNumber: 20,
    title: 'How to Become a Successful Investor',
    authorOrFocus: 'Matti Korhonen',
    description: 'Beginner guide centered on stock market investing, brokerage orders, and valuation.',
    filename: '16.Beginner-s-Guide-How-to-Become-a-Successful-Investor-Autor-MattiKorhonen.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/16.Beginner-s-Guide-How-to-Become-a-Successful-Investor-Autor-MattiKorhonen.pdf',
  },
  {
    bookKey: 'ib-guide-young-investors',
    indexNumber: 21,
    title: 'Guide for Young Investors',
    authorOrFocus: 'Capital Market Authority',
    description: 'Choosing securities, evaluating performance, and managing portfolio risk.',
    filename: '02.Guide-for-Young-Investors-Autor-Capital-Market-Authority.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/02.Guide-for-Young-Investors-Autor-Capital-Market-Authority.pdf',
  },
  {
    bookKey: 'ib-first-steps-investing',
    indexNumber: 22,
    title: 'First Steps to Investing',
    authorOrFocus: 'Prithvi Haldea',
    description: 'Covers compounding, equity allocation, and how primary and secondary capital markets operate.',
    filename: '17.First-Steps-to-Investing-Autor-Prithvi-Haldea.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/17.First-Steps-to-Investing-Autor-Prithvi-Haldea.pdf',
  },
  {
    bookKey: 'ib-investment-strategy-quarterly',
    indexNumber: 23,
    title: 'Investment Strategy Quarterly',
    authorOrFocus: 'Raymond James',
    description: 'Macroeconomic outlook and equity market strategy covering forces shaping portfolio returns.',
    filename: 'Investment-Strategy-Ouarterly-Raymond-James.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/Investment-Strategy-Ouarterly-Raymond-James.pdf',
  },
  {
    bookKey: 'ib-investment-strategy-fidelity',
    indexNumber: 24,
    title: 'Investment Strategy Guide',
    authorOrFocus: 'Fidelity Investments',
    description: 'Explains asset allocation, diversification, rebalancing, and tax-efficient equity investing.',
    filename: 'Investment-Strategy-Fidelity-Investments.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/Investment-Strategy-Fidelity-Investments.pdf',
  },
  {
    bookKey: 'ib-investment-dictionary',
    indexNumber: 25,
    title: 'Investment Dictionary',
    authorOrFocus: 'Mercer',
    description: 'Reference dictionary decoding capital markets, equity, fund, and portfolio management terminology.',
    filename: '09.Investment-Dictionary-Autor-Mercer.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/09.Investment-Dictionary-Autor-Mercer.pdf',
  },
  {
    bookKey: 'ib-stock-investing-101',
    indexNumber: 26,
    title: 'Stock Investing 101',
    authorOrFocus: 'Young Investors Society',
    description: 'Structured curriculum on how stocks work, analyzing economic moats, valuing companies, and building a portfolio.',
    filename: 'Stock-Investing-101-Young-Investors-Society.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/Stock-Investing-101-Young-Investors-Society.pdf',
  },
  {
    bookKey: 'ib-basics-investing-stocks',
    indexNumber: 27,
    title: 'The Basics for Investing in Stocks',
    authorOrFocus: "Kiplinger's Personal Finance",
    description: 'Covers stock categories, fundamental stock selection, key valuation metrics, and sell discipline.',
    filename: '12.The-Basics-for-Investing-in-Stocks-Autor-Kiplinger-s-Personal-Finance.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/12.The-Basics-for-Investing-in-Stocks-Autor-Kiplinger-s-Personal-Finance.pdf',
  },
  {
    bookKey: 'ib-financial-investments-stock-markets',
    indexNumber: 28,
    title: 'Financial Investments and Stock Markets',
    authorOrFocus: 'Capital Market Authority',
    description: 'Foundational guide to how financial investments and stock exchanges function.',
    filename: '10.Financial-Investments-and-Stock-Markets-Autor-Capital-Market-Authority.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/10.Financial-Investments-and-Stock-Markets-Autor-Capital-Market-Authority.pdf',
  },
  {
    bookKey: 'ib-saving-investing-sec',
    indexNumber: 29,
    title: 'Saving and Investing Roadmap',
    authorOrFocus: 'U.S. Securities and Exchange Commission',
    description: 'Official SEC guide to stocks, bonds, mutual funds, asset allocation, and investor protection.',
    filename: '30.Saving-and-Investing-Autor-SEC.gov.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/30.Saving-and-Investing-Autor-SEC.gov.pdf',
  },
  {
    bookKey: 'ib-12-principles-investing',
    indexNumber: 30,
    title: '12 Principles for Saving and Investing',
    authorOrFocus: 'Association Française de la Gestion Financière',
    description: 'Twelve enduring principles for risk tolerance, diversification, and medium-to-long-term market investing.',
    filename: '12-principles-for-saving-and-investing-Association-Fran-aise-de-la-Gestion-financi-re.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/275%20Investment/12-principles-for-saving-and-investing-Association-Fran-aise-de-la-Gestion-financi-re.pdf',
  },
  {
    bookKey: 'ib-intro-investment-banking',
    indexNumber: 31,
    title: 'Introduction to Investment Banking',
    authorOrFocus: 'John L. Teall',
    description: 'Covers IPOs, underwriting, mergers and acquisitions, leveraged buyouts, and institutional brokerage.',
    filename: 'introduction-to-investment-banking-john-l-teall-8193.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/introduction-to-investment-banking-john-l-teall-8193.pdf',
  },
  {
    bookKey: 'ib-investment-banking',
    indexNumber: 32,
    title: 'Investment Banking',
    authorOrFocus: 'Institute of Bankers',
    description: 'Comprehensive look at capital raising, equity advisory work, and institutional market transactions.',
    filename: 'investment-banking-institute-of-bankers-8194.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/investment-banking-institute-of-bankers-8194.pdf',
  },
  {
    bookKey: 'ib-investment-banking-securities',
    indexNumber: 33,
    title: 'Investment Banking and Securities Issuance',
    authorOrFocus: 'Jay R. Ritter',
    description: 'Authoritative academic overview of IPO pricing, underwriting mechanics, and securities issuance.',
    filename: 'investment-banking-and-securities-issuance-jay-r-ritter-8195.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/investment-banking-and-securities-issuance-jay-r-ritter-8195.pdf',
  },
  {
    bookKey: 'ib-japanese-candlesticks',
    indexNumber: 34,
    title: 'How to Trade With Japanese Candlesticks',
    authorOrFocus: 'Swissquote',
    description: 'Illustrated catalogue of bullish and bearish candlestick reversal patterns and market validation rules.',
    filename: 'how-to-trade-with-japanese-candlesticks-swissquote-9078.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/how-to-trade-with-japanese-candlesticks-swissquote-9078.pdf',
  },
  {
    bookKey: 'ib-chart-patterns-fidelity',
    indexNumber: 35,
    title: 'Identifying Chart Patterns With Technical Analysis',
    authorOrFocus: 'Fidelity Investments',
    description: 'Fidelity technical analysis workbook covering trendlines, support/resistance, and continuation/reversal patterns.',
    filename: 'identifying-chart-patterns-with-technical-analysis-fidelity-investments-9079.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/identifying-chart-patterns-with-technical-analysis-fidelity-investments-9079.pdf',
  },
  {
    bookKey: 'ib-smart-money-concept',
    indexNumber: 36,
    title: 'Smart Money Concept Trading Strategy',
    authorOrFocus: 'Oreoluwa Fakolujo',
    description: 'Covers order blocks, liquidity zones, institutional market structure shifts, and classic price action.',
    filename: 'smart-money-concept-trading-strategy-oreoluwa-fakolujo-9075.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/smart-money-concept-trading-strategy-oreoluwa-fakolujo-9075.pdf',
  },
  {
    bookKey: 'ib-trading-strategy-playbook',
    indexNumber: 37,
    title: 'Trading Strategy Playbook',
    authorOrFocus: 'OspreyFX',
    description: 'Compares day trading, scalping, and swing trading styles with execution and capital requirements.',
    filename: 'trading-strategy-playbook-ospreyfx-9071.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/trading-strategy-playbook-ospreyfx-9071.pdf',
  },
  {
    bookKey: 'ib-quick-start-trading-coulling',
    indexNumber: 38,
    title: 'A Quick Start Guide to Market Trading',
    authorOrFocus: 'Anna Coulling',
    description: 'Covers market participants, price discovery, trading psychology, and foundational technical analysis.',
    filename: 'a-quick-start-guide-to-forex-trading-anna-coulling-9077.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/a-quick-start-guide-to-forex-trading-anna-coulling-9077.pdf',
  },
  {
    bookKey: 'ib-forex-trading-strategies',
    indexNumber: 39,
    title: '7 Trading Strategies',
    authorOrFocus: 'Harry Turner',
    description: 'Step-by-step entry/exit rules, position sizing, and market regime filtering across 7 technical strategies.',
    filename: '7.-Forex-Trading-Strategies-Author-Harry-Turner.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/537%20Forex/7.-Forex-Trading-Strategies-Author-Harry-Turner.pdf',
  },
  {
    bookKey: 'ib-charts-how-to-read',
    indexNumber: 40,
    title: 'Price Charts and How to Read Them',
    authorOrFocus: 'Soho Markets',
    description: 'Annotated guide to line, bar, and candlestick charts, double tops, head-and-shoulders, and triangles.',
    filename: 'Forex-charts-and-how-to-read-them-Soho-Markets.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/537%20Forex/Forex-charts-and-how-to-read-them-Soho-Markets.pdf',
  },
  {
    bookKey: 'ib-types-of-indicators',
    indexNumber: 41,
    title: 'Types of Technical Indicators',
    authorOrFocus: 'Soho Markets',
    description: 'Concise reference on moving averages, MACD, RSI, Bollinger Bands, and momentum oscillators.',
    filename: 'Type-of-forex-indicators-Soho-Markets.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/537%20Forex/Type-of-forex-indicators-Soho-Markets.pdf',
  },
  {
    bookKey: 'ib-derivatives-markets-fed',
    indexNumber: 42,
    title: 'FX and Interest Rate Derivatives Markets',
    authorOrFocus: 'Federal Reserve Bank of New York',
    description: 'Federal Reserve survey detailing institutional derivatives turnover by instrument and counterparty.',
    filename: 'the-foreign-exchange-and-interest-rate-derivatives-markets-federal-reserve-bank-of-new-york-9072.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/the-foreign-exchange-and-interest-rate-derivatives-markets-federal-reserve-bank-of-new-york-9072.pdf',
  },
  {
    bookKey: 'ib-applied-corporate-finance',
    indexNumber: 43,
    title: 'Applied Corporate Finance',
    authorOrFocus: 'Aswath Damodaran',
    description: 'NYU Stern valuation expert Aswath Damodaran on investment analysis, capital structure, dividends, and firm valuation.',
    filename: 'applied-corporate-finance-aswath-damodaran-2023.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/applied-corporate-finance-aswath-damodaran-2023.pdf',
  },
  {
    bookKey: 'ib-corporate-finance-theory',
    indexNumber: 44,
    title: 'Corporate Finance: Theory and Practice',
    authorOrFocus: 'Pierre Vernimmen, Pascal Quiry, Yann Le Fur',
    description: 'Comprehensive corporate finance text covering financial statement analysis, DCF valuation, M&A, and securities.',
    filename: 'corporate-finance-theory-and-practice-pierre-vernimmen-pascal-quiry-yann-le-fur-2022.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/corporate-finance-theory-and-practice-pierre-vernimmen-pascal-quiry-yann-le-fur-2022.pdf',
  },
  {
    bookKey: 'ib-corporate-finance-notes',
    indexNumber: 45,
    title: 'Corporate Finance Study Notes',
    authorOrFocus: 'Zhipeng Yan',
    description: '25 chapters covering NPV, CAPM, cost of capital, options, derivatives, and corporate valuation.',
    filename: 'corporate-finance-study-notes-zhipeng-yan-2024.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/PDF/corporate-finance-study-notes-zhipeng-yan-2024.pdf',
  },
  {
    bookKey: 'ib-principles-of-finance',
    indexNumber: 46,
    title: 'Principles of Finance',
    authorOrFocus: 'Julie Dahlquist & Rainford Knight',
    description: 'Peer-reviewed OpenStax textbook covering stocks, bonds, valuation, risk-return, and capital markets.',
    filename: 'Principles-of-Finance-Julie-Dahlquist-Rainford-Knight.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/271%20Finances/Principles-of-Finance-Julie-Dahlquist-Rainford-Knight.pdf',
  },
  {
    bookKey: 'ib-business-finance-murray',
    indexNumber: 47,
    title: 'Business Finance',
    authorOrFocus: 'Tim Murray',
    description: 'Core equity and corporate finance lecture notes covering time value of money, stock valuation, and cost of capital.',
    filename: 'Business-Finance-Tim-Murray.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/271%20Finances/Business-Finance-Tim-Murray.pdf',
  },
  {
    bookKey: 'ib-intro-financial-market',
    indexNumber: 48,
    title: 'Introduction to Financial Markets',
    authorOrFocus: 'Siddharth Bagri, G.C. Sharma, Ashok Wadhwa',
    description: 'Introduces securities markets, primary/secondary trading, derivatives, mutual funds, and risk management.',
    filename: '07.-An-Introduction-to-Financial-Market-Part-I-for-Class-XI-Author-Mr.-Siddharth-Bagri-Mr.-G.C.-Sharma-Mr.-Ashok-Wadhwa.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/271%20Finances/07.-An-Introduction-to-Financial-Market-Part-I-for-Class-XI-Author-Mr.-Siddharth-Bagri-Mr.-G.C.-Sharma-Mr.-Ashok-Wadhwa.pdf',
  },
];

async function storeInfoBookFromCatalog(bookKey: string): Promise<VaultBook> {
  const def = INFOBOOKS_TRADING_BOOKS.find((item) => item.bookKey === bookKey);
  if (!def) {
    throw new Error('Requested InfoBooks entry was not found.');
  }

  const probe = await probeRemotePdfSource(def.pdfUrl);
  if (!probe.ok) {
    throw new Error(
      `InfoBooks returned HTTP ${probe.status} while verifying "${def.title}".`
    );
  }
  if (!probe.isPdf) {
    throw new Error(`Source did not return a valid PDF document for "${def.title}".`);
  }

  const id = crypto.randomUUID();
  const storedFilename = `${id}.pdf`;

  const vaultEntry: VaultBook = {
    id,
    bookKey: def.bookKey,
    title: def.title,
    author: def.authorOrFocus,
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: def.filename,
    sourceUrl: def.pdfUrl,
    originalFilename: def.filename,
    storedFilename,
    sizeBytes: probe.sizeBytes,
    coverPath: null,
    readingStatus: 'unread',
    notes: def.description,
    storedAt: new Date().toISOString(),
  };

  await mutateCatalog((current) => [
    vaultEntry,
    ...current.filter((existing) => existing.bookKey !== def.bookKey),
  ]);

  return vaultEntry;
}

async function storeSwingTradeEbookFromCatalog(
  bookKey: string
): Promise<{ item?: VaultBook; statusCode?: number; error?: string }> {
  const def = SWING_TRADE_EBOOKS.find((item) => item.bookKey === bookKey);
  if (!def) {
    return { statusCode: 404, error: 'Requested eBook entry was not found in the collection.' };
  }

  const probe = await probeRemotePdfSource(def.pdfUrl);
  if (!probe.ok) {
    return {
      statusCode: probe.status === 404 ? 404 : 502,
      error:
        probe.status === 404
          ? `"${def.title}" returned HTTP 404 (file is currently missing on swing-trade-stocks.com).`
          : `Source site returned HTTP ${probe.status} while verifying "${def.title}".`,
    };
  }
  if (!probe.isPdf) {
    return {
      statusCode: 422,
      error: `Source did not return a valid PDF document for "${def.title}".`,
    };
  }

  const id = crypto.randomUUID();
  const storedFilename = `${id}.pdf`;

  const vaultEntry: VaultBook = {
    id,
    bookKey: def.bookKey,
    title: def.title,
    author: def.authorOrFocus,
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: def.filename,
    sourceUrl: def.pdfUrl,
    originalFilename: def.filename,
    storedFilename,
    sizeBytes: probe.sizeBytes,
    coverPath: null,
    readingStatus: 'unread',
    notes: def.description,
    storedAt: new Date().toISOString(),
  };

  await mutateCatalog((current) => [
    vaultEntry,
    ...current.filter((existing) => existing.bookKey !== def.bookKey),
  ]);

  return { item: vaultEntry };
}

async function storeArchiveBookFromSpec(params: {
  identifier: string;
  filename?: string;
  title?: string;
  author?: string;
  year?: number | string;
  bookKey?: string;
  coverPath?: string;
}): Promise<{ item?: VaultBook; statusCode?: number; error?: string; borrowUrl?: string }> {
  const identifier = validateIdentifier(params.identifier);
  const inspection = await inspectArchiveIdentifier(identifier);

  if (inspection.isRestricted || inspection.freePdfs.length === 0) {
    return {
      statusCode: 403,
      error:
        'This Archive.org edition is access-restricted (Controlled Digital Lending). Borrow it directly via Open Library or upload your own personal PDF.',
      borrowUrl: inspection.borrowUrl,
    };
  }

  const chosenPdf =
    (params.filename
      ? inspection.freePdfs.find((f) => f.name === params.filename)
      : undefined) || inspection.freePdfs[0];

  const probe = await probeRemotePdfSource(chosenPdf.downloadUrl);
  if (!probe.ok) {
    return {
      statusCode: 502,
      error: `Archive.org returned HTTP ${probe.status} while verifying the PDF.`,
    };
  }
  if (!probe.isPdf) {
    return { statusCode: 422, error: 'Remote source did not return a valid PDF document.' };
  }

  const id = crypto.randomUUID();
  const storedFilename = `${id}.pdf`;

  const numericYear =
    typeof params.year === 'number'
      ? params.year
      : params.year
        ? Number.parseInt(String(params.year), 10) || null
        : Number.parseInt(inspection.year, 10) || null;

  const vaultEntry: VaultBook = {
    id,
    bookKey: typeof params.bookKey === 'string' ? params.bookKey : null,
    title: (params.title || inspection.title || identifier).trim(),
    author: (params.author || inspection.creator || 'Unknown').trim(),
    year: numericYear,
    sourceType: 'archive',
    sourceIdentifier: identifier,
    sourceUrl: chosenPdf.downloadUrl,
    originalFilename: chosenPdf.name,
    storedFilename,
    sizeBytes: probe.sizeBytes || chosenPdf.sizeBytes || 0,
    coverPath:
      typeof params.coverPath === 'string' && params.coverPath.startsWith('/src/assets/images/')
        ? params.coverPath
        : null,
    readingStatus: 'unread',
    notes: '',
    storedAt: new Date().toISOString(),
  };

  await mutateCatalog((current) => [
    vaultEntry,
    ...current.filter(
      (existing) =>
        !(vaultEntry.bookKey && existing.bookKey === vaultEntry.bookKey) &&
        existing.sourceIdentifier !== identifier
    ),
  ]);

  return { item: vaultEntry };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/vault', (req: Request, res: Response, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range, If-Range');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'Accept-Ranges, Content-Range, Content-Length, ETag, Last-Modified'
    );
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  const syncState = {
    syncing: false,
    completed: 0,
    total: 0,
  };

  async function syncMissingCuratedBooks(unhideRepoBooks = false): Promise<void> {
    if (syncState.syncing || !unhideRepoBooks) return;

    syncState.syncing = true;
    syncState.completed = 0;
    syncState.total = 1;

    try {
      await mutateOverrides((current) => {
        const next: Record<string, BookOverride> = {};
        for (const [id, entry] of Object.entries(current)) {
          if (entry.hidden) {
            const rest = { ...entry };
            delete rest.hidden;
            if (Object.keys(rest).length > 0) {
              next[id] = rest;
            }
          } else {
            next[id] = entry;
          }
        }
        return next;
      });
      syncState.completed = 1;
    } finally {
      syncState.syncing = false;
    }
  }

  app.get('/api/collections/infobooks-trading', (_req: Request, res: Response) => {
    const vault = getCombinedCatalog();
    const books = INFOBOOKS_TRADING_BOOKS.map((def) => ({
      ...def,
      sourcePageUrl: INFOBOOKS_SOURCE_PAGE,
      storedItem: vault.find((v) => v.bookKey === def.bookKey) || null,
    }));
    res.json({ sourcePageUrl: INFOBOOKS_SOURCE_PAGE, books });
  });

  app.post('/api/vault/fetch-infobook', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as { bookKey?: string };
      const bookKey = String(body.bookKey || '').trim();
      const def = INFOBOOKS_TRADING_BOOKS.find((item) => item.bookKey === bookKey);
      if (!def) {
        res.status(404).json({ error: 'Requested InfoBooks entry was not found.' });
        return;
      }

      const repoMatch = readRepoLibrary().find((entry) => entry.bookKey === bookKey);
      if (repoMatch) {
        await mutateOverrides((current) => {
          const entry = current[repoMatch.id];
          if (!entry?.hidden) return current;
          const next = { ...current };
          const updatedEntry = { ...entry };
          delete updatedEntry.hidden;
          if (Object.keys(updatedEntry).length > 0) {
            next[repoMatch.id] = updatedEntry;
          } else {
            delete next[repoMatch.id];
          }
          return next;
        });
        const merged = applyOverride(repoMatch, readOverrides()[repoMatch.id]);
        res.status(200).json({ item: merged });
        return;
      }

      const item = await storeInfoBookFromCatalog(bookKey);
      res.status(201).json({ item });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to verify InfoBooks PDF.';
      res.status(502).json({ error: message });
    }
  });

  app.get('/api/books/requested', (_req: Request, res: Response) => {
    const vault = getCombinedCatalog();
    res.json({ books: buildRequestedBooksCatalog(vault) });
  });

  app.get('/api/collections/swing-trade-ebooks', async (_req: Request, res: Response) => {
    const vault = getCombinedCatalog();
    const probeMap = await probeSwingTradeEbooks();
    const ebooks: SwingTradeEbook[] = SWING_TRADE_EBOOKS.map((def) => {
      const probe = probeMap[def.bookKey];
      const storedItem = vault.find((v) => v.bookKey === def.bookKey) || null;
      return {
        bookKey: def.bookKey,
        indexNumber: def.indexNumber,
        title: def.title,
        authorOrFocus: def.authorOrFocus,
        description: def.description,
        filename: def.filename,
        pdfUrl: def.pdfUrl,
        sourcePageUrl: SWING_TRADE_SOURCE_PAGE,
        available: probe ? probe.available : null,
        expectedSizeBytes: probe ? probe.sizeBytes : null,
        storedItem,
      };
    });
    res.json({ sourcePageUrl: SWING_TRADE_SOURCE_PAGE, ebooks });
  });

  app.post('/api/vault/fetch-ebook', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as { bookKey?: string };
      const bookKey = String(body.bookKey || '').trim();
      const repoMatch = readRepoLibrary().find((entry) => entry.bookKey === bookKey);
      if (repoMatch) {
        await mutateOverrides((current) => {
          const entry = current[repoMatch.id];
          if (!entry?.hidden) return current;
          const next = { ...current };
          const updatedEntry = { ...entry };
          delete updatedEntry.hidden;
          if (Object.keys(updatedEntry).length > 0) {
            next[repoMatch.id] = updatedEntry;
          } else {
            delete next[repoMatch.id];
          }
          return next;
        });
        const merged = applyOverride(repoMatch, readOverrides()[repoMatch.id]);
        res.status(200).json({ item: merged });
        return;
      }

      const result = await storeSwingTradeEbookFromCatalog(bookKey);
      if (!result.item) {
        res.status(result.statusCode || 500).json({ error: result.error });
        return;
      }
      res.status(201).json({ item: result.item });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to register eBook PDF.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/vault', (_req: Request, res: Response) => {
    const items = getCombinedCatalog();
    const totalBytes = items.reduce((sum, item) => sum + (item.sizeBytes || 0), 0);
    res.json({
      items,
      totalBytes,
      syncing: syncState.syncing,
      syncProgress: {
        completed: syncState.completed,
        total: syncState.total,
      },
    });
  });

  app.post('/api/vault/sync', async (_req: Request, res: Response) => {
    await syncMissingCuratedBooks(true);
    res.status(200).json({
      syncing: syncState.syncing,
      syncProgress: {
        completed: syncState.completed,
        total: syncState.total,
      },
    });
  });

  app.get('/api/archive/search', async (req: Request, res: Response) => {
    const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (!query || query.length > 160) {
      res.status(400).json({ error: 'Provide a search query up to 160 characters.' });
      return;
    }

    try {
      const sanitizedTerm = query.replace(/[()[\]{}]/g, ' ').trim();
      const archiveQuery = `(${sanitizedTerm}) AND mediatype:(texts)`;
      const searchUrl =
        `https://archive.org/advancedsearch.php?q=${encodeURIComponent(archiveQuery)}` +
        `&fl[]=identifier,title,creator,year,format&rows=12&output=json`;

      const upstream = await fetchAllowlisted(searchUrl);
      if (!upstream.ok) {
        res.status(502).json({ error: 'Internet Archive search returned an error.' });
        return;
      }

      const payload = (await upstream.json()) as {
        response?: {
          docs?: Array<{
            identifier?: string;
            title?: string;
            creator?: string | string[];
            year?: string | number;
            format?: string[];
          }>;
        };
      };

      const docs = payload.response?.docs || [];
      const hits: ArchiveSearchHit[] = docs
        .filter((d) => typeof d.identifier === 'string')
        .map((d) => {
          const id = d.identifier as string;
          const formats = Array.isArray(d.format) ? d.format : [];
          const creator = Array.isArray(d.creator) ? d.creator[0] : d.creator;
          return {
            identifier: id,
            title: d.title || id,
            creator: creator || 'Unknown',
            year: d.year ? String(d.year) : '',
            hasTextPdf: formats.includes('Text PDF') || formats.includes('PDF'),
            hasEncryptedPdf:
              formats.includes('ACS Encrypted PDF') || formats.includes('LCP Encrypted PDF'),
            detailsUrl: `https://archive.org/details/${encodeURIComponent(id)}`,
          };
        });

      res.json({ hits });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Archive search failed.';
      res.status(500).json({ error: message });
    }
  });

  app.get('/api/archive/inspect/:identifier', async (req: Request, res: Response) => {
    try {
      const inspection = await inspectArchiveIdentifier(String(req.params.identifier || ''));
      res.json(inspection);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to inspect archive item.';
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/vault/fetch-archive', async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as {
        identifier?: string;
        filename?: string;
        title?: string;
        author?: string;
        year?: number | string;
        bookKey?: string;
        coverPath?: string;
      };

      const result = await storeArchiveBookFromSpec({
        identifier: String(body.identifier || ''),
        filename: body.filename,
        title: body.title,
        author: body.author,
        year: body.year,
        bookKey: body.bookKey,
        coverPath: body.coverPath,
      });

      if (!result.item) {
        res.status(result.statusCode || 500).json({
          error: result.error,
          ...(result.borrowUrl ? { borrowUrl: result.borrowUrl } : {}),
        });
        return;
      }

      res.status(201).json({ item: result.item });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to store PDF from Archive.org.';
      res.status(500).json({ error: message });
    }
  });

  app.post(
    '/api/vault/upload',
    express.raw({ type: 'application/pdf', limit: '50mb' }),
    async (req: Request, res: Response) => {
      try {
        const buffer = req.body;
        if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) {
          res.status(400).json({ error: 'Empty or invalid PDF payload.' });
          return;
        }
        if (buffer.byteLength > MAX_PDF_BYTES) {
          res.status(413).json({ error: 'PDF exceeds 50 MB limit.' });
          return;
        }
        if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
          res.status(422).json({ error: 'Uploaded file does not have a valid %PDF- header.' });
          return;
        }

        const decodeHeader = (key: string, fallback: string): string => {
          const val = req.header(key);
          if (!val) return fallback;
          try {
            return decodeURIComponent(val).trim().slice(0, 180) || fallback;
          } catch {
            return val.trim().slice(0, 180) || fallback;
          }
        };

        const originalFilename = sanitizeDownloadFilename(
          decodeHeader('x-filename', 'uploaded-book.pdf')
        );
        const title = decodeHeader(
          'x-title',
          originalFilename.replace(/\.pdf$/i, '')
        );
        const author = decodeHeader('x-author', 'Personal Library Copy');
        const yearHeader = req.header('x-year');
        const year = yearHeader ? Number.parseInt(yearHeader, 10) || null : null;
        const bookKeyRaw = req.header('x-book-key');
        const bookKey =
          bookKeyRaw && /^[a-z0-9-]+$/.test(bookKeyRaw) ? bookKeyRaw : null;
        const coverRaw = req.header('x-cover-path');
        const coverPath =
          coverRaw && coverRaw.startsWith('/src/assets/images/') ? coverRaw : null;

        const id = crypto.randomUUID();
        const storedFilename = `${id}.pdf`;
        const targetPath = resolveVaultFilePath(storedFilename);
        fs.writeFileSync(targetPath, buffer);

        const vaultEntry: VaultBook = {
          id,
          bookKey,
          title,
          author,
          year,
          sourceType: 'upload',
          sourceIdentifier: null,
          sourceUrl: null,
          originalFilename,
          storedFilename,
          sizeBytes: buffer.byteLength,
          coverPath,
          readingStatus: 'unread',
          notes: '',
          storedAt: new Date().toISOString(),
        };

        await mutateCatalog((current) => [
          vaultEntry,
          ...current.filter((existing) => !(bookKey && existing.bookKey === bookKey)),
        ]);

        await ensureServerPdfCover(id, targetPath, VAULT_COVERS_DIR);
        res.status(201).json({ item: vaultEntry });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'PDF upload failed.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.get('/api/vault/:id/cover', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const uploadItem = readCatalog().find((entry) => entry.id === id);
    const overrides = readOverrides();
    const repoItem =
      !uploadItem && !overrides[id]?.hidden
        ? readRepoLibrary().find((entry) => entry.id === id)
        : undefined;
    const item = uploadItem || repoItem;
    if (!item) {
      res.status(404).json({ error: 'Book not found in vault.' });
      return;
    }

    try {
      const coverDir = uploadItem ? VAULT_COVERS_DIR : LIBRARY_COVERS_DIR;
      const cachedCoverPath = resolveSafeCoverPath(coverDir, item.id);
      if (fs.existsSync(cachedCoverPath) && fs.statSync(cachedCoverPath).size > 400) {
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
        res.sendFile(cachedCoverPath);
        return;
      }

      if (!uploadItem) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(404).json({ error: 'Cover preview unavailable.' });
        return;
      }

      const pdfPath = resolveVaultFilePath(item.storedFilename);
      if (!fs.existsSync(pdfPath)) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(404).json({ error: 'Cover preview unavailable.' });
        return;
      }
      const generated = await ensureServerPdfCover(item.id, pdfPath, coverDir);
      if (!generated || !fs.existsSync(generated)) {
        res.setHeader('Cache-Control', 'no-store');
        res.status(404).json({ error: 'Cover preview unavailable.' });
        return;
      }

      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      res.sendFile(generated);
    } catch {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).json({ error: 'Unable to serve cover.' });
    }
  });

  app.post(
    '/api/vault/:id/cover',
    express.raw({ type: 'image/jpeg', limit: '350kb' }),
    (req: Request, res: Response) => {
      const id = String(req.params.id || '');
      const uploadItem = readCatalog().find((entry) => entry.id === id);
      const overrides = readOverrides();
      const repoItem =
        !uploadItem && !overrides[id]?.hidden
          ? readRepoLibrary().find((entry) => entry.id === id)
          : undefined;
      const item = uploadItem || repoItem;
      if (!item) {
        res.status(404).json({ error: 'Book not found.' });
        return;
      }

      const buffer = req.body;
      if (
        !Buffer.isBuffer(buffer) ||
        buffer.byteLength < 400 ||
        buffer.byteLength > 350 * 1024 ||
        buffer[0] !== 0xff ||
        buffer[1] !== 0xd8 ||
        buffer[2] !== 0xff
      ) {
        res.status(400).json({ error: 'Invalid JPEG cover payload.' });
        return;
      }

      try {
        const coverDir = uploadItem ? VAULT_COVERS_DIR : LIBRARY_COVERS_DIR;
        const outPath = resolveSafeCoverPath(coverDir, item.id);
        if (!fs.existsSync(outPath)) {
          fs.writeFileSync(outPath, buffer);
          unavailableCovers.delete(outPath);
        }
        res.status(204).end();
      } catch {
        res.status(400).json({ error: 'Unable to save cover.' });
      }
    }
  );

  async function handleVaultFileRequest(req: Request, res: Response) {
    const id = String(req.params.id || '');
    const uploadItem = readCatalog().find((entry) => entry.id === id);
    const overrides = readOverrides();
    const repoItem = !uploadItem && !overrides[id]?.hidden
      ? readRepoLibrary().find((entry) => entry.id === id)
      : undefined;
    const item = uploadItem || repoItem;
    if (!item) {
      res.status(404).json({ error: 'PDF not found in vault.' });
      return;
    }

    const isHead = req.method === 'HEAD';
    const isDownload = req.query.download === '1';
    const safeName = sanitizeDownloadFilename(item.title || item.originalFilename);

    try {
      const localFilePath = uploadItem
        ? resolveVaultFilePath(item.storedFilename)
        : resolveLibraryFilePath(item.storedFilename);

      if (fs.existsSync(localFilePath)) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader(
          'Content-Disposition',
          `${isDownload ? 'attachment' : 'inline'}; filename="${safeName}"`
        );
        if (!uploadItem && !isDownload) {
          res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
        }
        res.sendFile(localFilePath);
        return;
      }

      if (!hasValidRemoteSourceUrl(item.sourceUrl)) {
        res.status(404).json({ error: 'PDF file missing on disk and no approved source URL is configured.' });
        return;
      }

      const forwardHeaders: Record<string, string> = {};
      const rangeHeader = req.headers.range;
      if (
        typeof rangeHeader === 'string' &&
        rangeHeader.length <= 128 &&
        /^bytes=\d*-\d*(?:,\s*\d*-\d*)*$/i.test(rangeHeader.trim())
      ) {
        forwardHeaders['Range'] = rangeHeader.trim();
      }
      const ifRangeHeader = req.headers['if-range'];
      if (
        typeof ifRangeHeader === 'string' &&
        ifRangeHeader.length > 0 &&
        ifRangeHeader.length <= 128 &&
        !/[^\x20-\x7e]/.test(ifRangeHeader)
      ) {
        forwardHeaders['If-Range'] = ifRangeHeader;
      }

      const controller = new AbortController();
      const timeoutMs = forwardHeaders['Range'] || isHead ? 25000 : 60000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let activeNodeStream: Readable | null = null;

      res.on('close', () => {
        clearTimeout(timer);
        if (!res.writableEnded) {
          controller.abort();
          activeNodeStream?.destroy();
        }
      });

      const upstream = await fetchAllowlisted(item.sourceUrl, 5, {
        method: isHead ? 'HEAD' : 'GET',
        extraHeaders: forwardHeaders,
        signal: controller.signal,
      });

      if (upstream.status === 416) {
        void upstream.body?.cancel().catch(() => {});
        clearTimeout(timer);
        const cr = upstream.headers.get('content-range');
        if (cr) res.setHeader('Content-Range', cr);
        res.status(416).end();
        return;
      }

      if (!upstream.ok) {
        void upstream.body?.cancel().catch(() => {});
        clearTimeout(timer);
        res.status(upstream.status === 404 ? 404 : 502).json({
          error: `Remote source returned HTTP ${upstream.status}.`,
        });
        return;
      }

      const upstreamType = (upstream.headers.get('content-type') || '').toLowerCase();
      if (upstreamType.includes('text/html')) {
        void upstream.body?.cancel().catch(() => {});
        clearTimeout(timer);
        res.status(502).json({ error: 'Remote source returned HTML instead of a PDF.' });
        return;
      }

      res.status(upstream.status);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `${isDownload ? 'attachment' : 'inline'}; filename="${safeName}"`
      );

      for (const headerName of [
        'accept-ranges',
        'content-range',
        'content-length',
        'etag',
        'last-modified',
      ]) {
        const val = upstream.headers.get(headerName);
        if (val) {
          res.setHeader(headerName, val);
        }
      }

      if (!isDownload && !forwardHeaders['Range']) {
        res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      }

      if (isHead || !upstream.body) {
        void upstream.body?.cancel().catch(() => {});
        clearTimeout(timer);
        res.end();
        return;
      }

      activeNodeStream = Readable.fromWeb(
        upstream.body as unknown as import('node:stream/web').ReadableStream<Uint8Array>
      );
      activeNodeStream.on('end', () => clearTimeout(timer));
      activeNodeStream.on('close', () => clearTimeout(timer));
      activeNodeStream.on('error', () => {
        clearTimeout(timer);
        if (!res.headersSent) {
          res.status(502).end();
        } else {
          res.destroy();
        }
      });
      activeNodeStream.pipe(res);
    } catch (err) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      const message = err instanceof Error ? err.message : 'Unable to stream PDF.';
      res.status(502).json({ error: message });
    }
  }

  app.head('/api/vault/:id/file', (req: Request, res: Response) => {
    void handleVaultFileRequest(req, res);
  });

  app.get('/api/vault/:id/file', (req: Request, res: Response) => {
    void handleVaultFileRequest(req, res);
  });

  app.patch('/api/vault/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const body = (req.body || {}) as {
      notes?: string;
      readingStatus?: ReadingStatus;
      lastPage?: number | null;
      totalPages?: number | null;
      bookmarkedPage?: number | null;
      keeperColor?: BookKeeperColor | null;
      lastReadAt?: string | null;
    };

    const sanitizePageNumber = (val: unknown): number | null | undefined => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      if (typeof val === 'number' && Number.isFinite(val) && val >= 1 && val <= 100000) {
        return Math.floor(val);
      }
      return undefined;
    };

    const sanitizeKeeperColor = (val: unknown): BookKeeperColor | null | undefined => {
      if (val === undefined) return undefined;
      if (val === null) return null;
      if (
        val === 'crimson' ||
        val === 'emerald' ||
        val === 'sapphire' ||
        val === 'amber' ||
        val === 'violet' ||
        val === 'teal'
      ) {
        return val;
      }
      return undefined;
    };

    const nextLastPage = sanitizePageNumber(body.lastPage);
    const nextTotalPages = sanitizePageNumber(body.totalPages);
    const nextBookmarkedPage = sanitizePageNumber(body.bookmarkedPage);
    const nextKeeperColor = sanitizeKeeperColor(body.keeperColor);
    const nextLastReadAt =
      body.lastReadAt === null
        ? null
        : typeof body.lastReadAt === 'string' && body.lastReadAt.length <= 64
          ? body.lastReadAt
          : undefined;

    let updatedItem: VaultBook | null = null;
    await mutateCatalog((current) => {
      const index = current.findIndex((entry) => entry.id === id);
      if (index === -1) return current;
      const updated: VaultBook = { ...current[index] };
      if (typeof body.notes === 'string') {
        updated.notes = body.notes.slice(0, 10000);
      }
      if (
        body.readingStatus === 'unread' ||
        body.readingStatus === 'reading' ||
        body.readingStatus === 'completed'
      ) {
        updated.readingStatus = body.readingStatus;
      }
      if (nextLastPage !== undefined) updated.lastPage = nextLastPage;
      if (nextTotalPages !== undefined) updated.totalPages = nextTotalPages;
      if (nextBookmarkedPage !== undefined) updated.bookmarkedPage = nextBookmarkedPage;
      if (nextKeeperColor !== undefined) updated.keeperColor = nextKeeperColor;
      if (nextLastReadAt !== undefined) updated.lastReadAt = nextLastReadAt;
      updatedItem = updated;
      const next = [...current];
      next[index] = updated;
      return next;
    });

    if (!updatedItem) {
      const repoBook = readRepoLibrary().find((entry) => entry.id === id);
      if (repoBook && !readOverrides()[id]?.hidden) {
        let merged: VaultBook = repoBook;
        await mutateOverrides((current) => {
          const prev = current[id] || {};
          const nextEntry: BookOverride = { ...prev };
          if (typeof body.notes === 'string') {
            nextEntry.notes = body.notes.slice(0, 10000);
          }
          if (
            body.readingStatus === 'unread' ||
            body.readingStatus === 'reading' ||
            body.readingStatus === 'completed'
          ) {
            nextEntry.readingStatus = body.readingStatus;
          }
          if (nextLastPage !== undefined) nextEntry.lastPage = nextLastPage;
          if (nextTotalPages !== undefined) nextEntry.totalPages = nextTotalPages;
          if (nextBookmarkedPage !== undefined) nextEntry.bookmarkedPage = nextBookmarkedPage;
          if (nextKeeperColor !== undefined) nextEntry.keeperColor = nextKeeperColor;
          if (nextLastReadAt !== undefined) nextEntry.lastReadAt = nextLastReadAt;
          merged = applyOverride(repoBook, nextEntry);
          return { ...current, [id]: nextEntry };
        });
        updatedItem = merged;
      }
    }

    if (!updatedItem) {
      res.status(404).json({ error: 'Stored book not found.' });
      return;
    }
    res.json({ item: updatedItem });
  });

  app.delete('/api/vault/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    try {
      let removed: VaultBook | null = null;
      await mutateCatalog((current) => {
        const item = current.find((entry) => entry.id === id);
        if (!item) return current;
        removed = item;
        const filePath = resolveVaultFilePath(item.storedFilename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
        try {
          const coverFile = resolveSafeCoverPath(VAULT_COVERS_DIR, item.id);
          if (fs.existsSync(coverFile)) {
            fs.unlinkSync(coverFile);
          }
        } catch {
          // ignore
        }
        return current.filter((entry) => entry.id !== id);
      });

      if (!removed) {
        const repoBook = readRepoLibrary().find((entry) => entry.id === id);
        if (repoBook && !readOverrides()[id]?.hidden) {
          await mutateOverrides((current) => ({
            ...current,
            [id]: { ...(current[id] || {}), hidden: true },
          }));
          removed = repoBook;
        }
      }

      if (!removed) {
        res.status(404).json({ error: 'Stored book not found.' });
        return;
      }
      res.json({ removedId: id });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to remove file.';
      res.status(400).json({ error: message });
    }
  });

  const pdfjsDistDir = path.resolve(process.cwd(), 'node_modules', 'pdfjs-dist');
  app.use('/pdfjs/wasm', express.static(path.resolve(pdfjsDistDir, 'wasm')));
  app.use('/pdfjs/cmaps', express.static(path.resolve(pdfjsDistDir, 'cmaps')));
  app.use('/pdfjs/standard_fonts', express.static(path.resolve(pdfjsDistDir, 'standard_fonts')));
  app.use('/pdfjs/iccs', express.static(path.resolve(pdfjsDistDir, 'iccs')));

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Folio Vault running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
