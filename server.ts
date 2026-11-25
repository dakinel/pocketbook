import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { createServer as createViteServer } from 'vite';
import type {
  ArchiveInspection,
  ArchivePdfFile,
  ArchiveSearchHit,
  ReadingStatus,
  RequestedBookSpec,
  SwingTradeEbook,
  VaultBook,
} from './src/types.ts';

const PORT = Number(process.env.PORT) || 3000;
const MAX_PDF_BYTES = 50 * 1024 * 1024;
const DATA_DIR = path.resolve(process.cwd(), 'data', 'vault');
const VAULT_FILES_DIR = path.resolve(DATA_DIR, 'files');
const CATALOG_PATH = path.resolve(DATA_DIR, 'catalog.json');
const OVERRIDES_PATH = path.resolve(DATA_DIR, 'overrides.json');

const LIBRARY_DIR = path.resolve(process.cwd(), 'library');
const LIBRARY_BOOKS_DIR = path.resolve(LIBRARY_DIR, 'books');
const LIBRARY_CATALOG_PATH = path.resolve(LIBRARY_DIR, 'catalog.json');

fs.mkdirSync(VAULT_FILES_DIR, { recursive: true });

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
}

function readBookListFromFile(catalogFilePath: string, filesDir: string): VaultBook[] {
  if (!fs.existsSync(catalogFilePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(catalogFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is VaultBook => {
      if (!item || typeof item.id !== 'string' || typeof item.storedFilename !== 'string') {
        return false;
      }
      try {
        const filePath = resolvePdfPathInDir(filesDir, item.storedFilename);
        return fs.existsSync(filePath);
      } catch {
        return false;
      }
    });
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
  if (!fs.existsSync(OVERRIDES_PATH)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(OVERRIDES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, BookOverride>;
  } catch {
    return {};
  }
}

function writeOverrides(overrides: Record<string, BookOverride>): void {
  const tempPath = `${OVERRIDES_PATH}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(overrides, null, 2), 'utf8');
  fs.renameSync(tempPath, OVERRIDES_PATH);
}

function applyOverride(book: VaultBook, override?: BookOverride): VaultBook {
  if (!override) return book;
  return {
    ...book,
    ...(typeof override.notes === 'string' ? { notes: override.notes } : {}),
    ...(override.readingStatus ? { readingStatus: override.readingStatus } : {}),
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

async function fetchAllowlisted(rawUrl: string, maxRedirects = 5): Promise<globalThis.Response> {
  let parsed = validateRemoteHttpsUrl(rawUrl);
  let currentUrl = parsed.toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const isInfobooks =
      parsed.hostname === 'infobooks.org' || parsed.hostname.endsWith('.infobooks.org');
    const headers: Record<string, string> = {
      'User-Agent': isInfobooks
        ? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
        : 'FolioVault/1.0 (Personal Digital Library)',
    };
    if (isInfobooks) {
      headers['Referer'] = 'https://infobooks.org/';
    }
    const res = await fetch(currentUrl, {
      redirect: 'manual',
      headers,
    });
    if (res.status >= 300 && res.status < 400) {
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
      bookKey: 'reminiscences-stock-operator',
      accessionCode: 'FOL.1923.01',
      title: 'Reminiscences of a Stock Operator',
      subtitle: 'Fictionalized biography of market speculator Jesse Livermore',
      author: 'Edwin Lefèvre',
      year: 1923,
      rights: 'public_domain',
      rightsLabel: 'Public Domain (US Pre-1931)',
      rightsExplanation:
        'Originally published in 1923 by George H. Doran Company. Free, unencrypted Text PDF editions are openly downloadable from the Internet Archive and Wikimedia Commons.',
      coverPath: '/src/assets/images/cover_stock_operator_1795617500977.jpg',
      archiveIdentifier: 'JesseLivermoreReminiscencesOfAStockOperator',
      alternateArchiveIdentifiers: ['reminiscencesofs0000edwi'],
      preferredPdfFilename: 'Jesse Livermore Reminiscences Of A Stock Operator.pdf',
      openLibraryUrl: 'https://openlibrary.org/works/OL15393933W/Reminiscences_of_a_Stock_Operator',
      archiveDetailsUrl: 'https://archive.org/details/JesseLivermoreReminiscencesOfAStockOperator',
      secondarySources: [
        {
          label: 'Wikimedia Commons PDF',
          url: 'https://commons.wikimedia.org/wiki/File:Reminiscences_of_a_Stock_Operator.pdf',
        },
        {
          label: 'Project Gutenberg eText',
          url: 'https://www.gutenberg.org/ebooks/60979',
        },
      ],
      summary:
        'Chronicles tape reading, market psychology, position sizing, and emotional discipline through the early twentieth-century bucket shops and Wall Street exchanges.',
      storedItem: findStored('reminiscences-stock-operator'),
    },
    {
      bookKey: 'richest-man-in-babylon',
      accessionCode: 'FOL.1926.02',
      title: 'The Richest Man in Babylon',
      subtitle: 'Timeless parables on thrift, compounding, and capital preservation',
      author: 'George S. Clason',
      year: 1926,
      rights: 'public_domain',
      rightsLabel: 'Public Domain (US Pre-1931)',
      rightsExplanation:
        'Early Babylonian parables and compiled 1926–1930 pamphlets are in the US public domain. Unencrypted Text PDFs are freely downloadable from the Internet Archive.',
      coverPath: '/src/assets/images/cover_richest_babylon_1795617502112.jpg',
      archiveIdentifier: 'richestmaninbaby0000geor_q8e2',
      alternateArchiveIdentifiers: ['isbn_9798395421142'],
      preferredPdfFilename: 'richestmaninbaby0000geor_q8e2.pdf',
      openLibraryUrl: 'https://openlibrary.org/works/OL16180379W/The_Richest_Man_in_Babylon',
      archiveDetailsUrl: 'https://archive.org/details/richestmaninbaby0000geor_q8e2',
      secondarySources: [
        {
          label: 'Wikisource Edition',
          url: 'https://en.wikisource.org/wiki/The_Richest_Man_In_Babylon_and_Other_Stories',
        },
        {
          label: 'Alternate Archive Scan',
          url: 'https://archive.org/details/isbn_9798395421142',
        },
      ],
      summary:
        'Presents seven foundational cures for a lean purse and the five laws of gold through parables set in ancient Babylon.',
      storedItem: findStored('richest-man-in-babylon'),
    },
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
    {
      bookKey: 'scientific-stock-speculation',
      accessionCode: 'FOL.1920.04',
      title: 'Scientific Stock Speculation',
      subtitle: 'Foundational Dow essays on price trends and risk management',
      author: 'Charles H. Dow',
      year: 1920,
      rights: 'public_domain',
      rightsLabel: 'Public Domain (US Pre-1931)',
      rightsExplanation: 'Public-domain compilation of Charles Dow’s foundational Wall Street essays.',
      coverPath: '',
      archiveIdentifier: 'scientificstocks00dowc',
      preferredPdfFilename: 'scientificstocks00dowc.pdf',
      openLibraryUrl: 'https://archive.org/details/scientificstocks00dowc',
      archiveDetailsUrl: 'https://archive.org/details/scientificstocks00dowc',
      secondarySources: [],
      summary: "Charles Dow's foundational essays on market trends, price movements, and disciplined speculation.",
      storedItem: findStored('scientific-stock-speculation'),
    },
    {
      bookKey: 'stock-market-barometer',
      accessionCode: 'FOL.1922.05',
      title: 'The Stock Market Barometer',
      subtitle: 'Dow Theory and forecasting market movements since 1897',
      author: 'William Peter Hamilton',
      year: 1922,
      rights: 'public_domain',
      rightsLabel: 'Public Domain (US Pre-1931)',
      rightsExplanation: 'Public-domain 1922 classic explaining Dow Theory.',
      coverPath: '',
      archiveIdentifier: 'stockmarketbaro00hamigoog',
      preferredPdfFilename: 'stockmarketbaro00hamigoog.pdf',
      openLibraryUrl: 'https://archive.org/details/stockmarketbaro00hamigoog',
      archiveDetailsUrl: 'https://archive.org/details/stockmarketbaro00hamigoog',
      secondarySources: [],
      summary: 'Classic exposition of Dow Theory and the forecasting power of stock market averages since 1897.',
      storedItem: findStored('stock-market-barometer'),
    },
    {
      bookKey: 'studies-in-tape-reading',
      accessionCode: 'FOL.1910.06',
      title: 'Studies in Tape Reading',
      subtitle: 'Classic treatise on price action, volume, and order flow',
      author: 'Richard D. Wyckoff',
      year: 1910,
      rights: 'public_domain',
      rightsLabel: 'Public Domain (US Pre-1931)',
      rightsExplanation: 'Public-domain 1910 edition by Richard D. Wyckoff.',
      coverPath: '',
      archiveIdentifier: 'studiesintapere01wyckgoog',
      preferredPdfFilename: 'studiesintapere01wyckgoog_text.pdf',
      openLibraryUrl: 'https://archive.org/details/studiesintapere01wyckgoog',
      archiveDetailsUrl: 'https://archive.org/details/studiesintapere01wyckgoog',
      secondarySources: [],
      summary: 'Seminal work on reading stock ticker tape, volume, price action, and institutional order flow.',
      storedItem: findStored('studies-in-tape-reading'),
    },
    {
      bookKey: 'how-i-trade-and-invest',
      accessionCode: 'FOL.1922.07',
      title: 'How I Trade and Invest in Stocks and Bonds',
      subtitle: 'Thirty-three years of Wall Street methods and risk discipline',
      author: 'Richard D. Wyckoff',
      year: 1922,
      rights: 'public_domain',
      rightsLabel: 'Public Domain (US Pre-1931)',
      rightsExplanation: 'Public-domain 1922 volume by Richard D. Wyckoff.',
      coverPath: '',
      archiveIdentifier: 'cu31924031269552',
      preferredPdfFilename: 'cu31924031269552.pdf',
      openLibraryUrl: 'https://archive.org/details/cu31924031269552',
      archiveDetailsUrl: 'https://archive.org/details/cu31924031269552',
      secondarySources: [],
      summary: 'Thirty-three years of Wall Street trading and investment principles, tape reading, and risk control.',
      storedItem: findStored('how-i-trade-and-invest'),
    },
    {
      bookKey: 'abc-of-stock-speculation',
      accessionCode: 'FOL.1903.08',
      title: 'The A B C of Stock Speculation',
      subtitle: 'Early Wall Street Journal compilation that coined Dow Theory',
      author: 'S. A. Nelson',
      year: 1903,
      rights: 'public_domain',
      rightsLabel: 'Public Domain (US Pre-1931)',
      rightsExplanation: 'Public-domain 1903 edition compiling Charles Dow editorials.',
      coverPath: '',
      archiveIdentifier: 'abcstockspecula00nelsgoog',
      preferredPdfFilename: 'abcstockspecula00nelsgoog_text.pdf',
      openLibraryUrl: 'https://archive.org/details/abcstockspecula00nelsgoog',
      archiveDetailsUrl: 'https://archive.org/details/abcstockspecula00nelsgoog',
      secondarySources: [],
      summary: "Introduced the term Dow Theory, compiling Charles Dow's Wall Street Journal editorials on stock speculation.",
      storedItem: findStored('abc-of-stock-speculation'),
    },
    {
      bookKey: 'pitfalls-of-speculation',
      accessionCode: 'FOL.1906.09',
      title: 'The Pitfalls of Speculation',
      subtitle: 'Behavioral and structural traps in equity speculation',
      author: 'Thomas Gibson',
      year: 1906,
      rights: 'public_domain',
      rightsLabel: 'Public Domain (US Pre-1931)',
      rightsExplanation: 'Public-domain 1906 market psychology classic.',
      coverPath: '',
      archiveIdentifier: 'pitfallsspecula00gibsgoog',
      preferredPdfFilename: 'pitfallsspecula00gibsgoog_text.pdf',
      openLibraryUrl: 'https://archive.org/details/pitfallsspecula00gibsgoog',
      archiveDetailsUrl: 'https://archive.org/details/pitfallsspecula00gibsgoog',
      secondarySources: [],
      summary: 'Analyzes common behavioral and structural mistakes made by equity and commodity speculators.',
      storedItem: findStored('pitfalls-of-speculation'),
    },
    {
      bookKey: 'elements-of-speculation',
      accessionCode: 'FOL.1913.10',
      title: 'The Elements of Speculation',
      subtitle: 'Market cycles, earnings reports, and security valuation',
      author: 'Thomas Gibson',
      year: 1913,
      rights: 'public_domain',
      rightsLabel: 'Public Domain (US Pre-1931)',
      rightsExplanation: 'Public-domain 1913 edition by Thomas Gibson.',
      coverPath: '',
      archiveIdentifier: 'cu31924013779438',
      preferredPdfFilename: 'cu31924013779438.pdf',
      openLibraryUrl: 'https://archive.org/details/cu31924013779438',
      archiveDetailsUrl: 'https://archive.org/details/cu31924013779438',
      secondarySources: [],
      summary: 'Covers market cycles, manipulation, crop and earnings reports, and security valuation fundamentals.',
      storedItem: findStored('elements-of-speculation'),
    },
    {
      bookKey: 'business-barometers',
      accessionCode: 'FOL.1911.11',
      title: 'Business Barometers Used in the Accumulation of Money',
      subtitle: 'Macroeconomic cycles and long-term capital allocation',
      author: 'Roger Ward Babson',
      year: 1911,
      rights: 'public_domain',
      rightsLabel: 'Public Domain (US Pre-1931)',
      rightsExplanation: 'Public-domain 1911 treatise by Roger Ward Babson.',
      coverPath: '',
      archiveIdentifier: 'businessbaromet04babsgoog',
      preferredPdfFilename: 'businessbaromet04babsgoog.pdf',
      openLibraryUrl: 'https://archive.org/details/businessbaromet04babsgoog',
      archiveDetailsUrl: 'https://archive.org/details/businessbaromet04babsgoog',
      secondarySources: [],
      summary: 'Foundational treatise on macroeconomic indicators, market cycles, and long-term capital accumulation.',
      storedItem: findStored('business-barometers'),
    },
    {
      bookKey: 'extraordinary-popular-delusions',
      accessionCode: 'FOL.1841.12',
      title: 'Memoirs of Extraordinary Popular Delusions',
      subtitle: 'Historical study of speculative bubbles and crowd psychology',
      author: 'Charles Mackay',
      year: 1841,
      rights: 'public_domain',
      rightsLabel: 'Public Domain (US Pre-1931)',
      rightsExplanation: 'Public-domain 1841 classic by Charles Mackay.',
      coverPath: '',
      archiveIdentifier: 'memoirsextraord12mackgoog',
      preferredPdfFilename: 'memoirsextraord12mackgoog.pdf',
      openLibraryUrl: 'https://archive.org/details/memoirsextraord12mackgoog',
      archiveDetailsUrl: 'https://archive.org/details/memoirsextraord12mackgoog',
      secondarySources: [],
      summary: 'Classic chronicle of crowd psychology and financial manias including the South Sea Bubble and Tulipomania.',
      storedItem: findStored('extraordinary-popular-delusions'),
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
    bookKey: 'ib-day-trading-beginners',
    indexNumber: 8,
    title: 'Day Trading Guide For Beginners',
    authorOrFocus: 'Warrior Trading',
    description: 'Step-by-step guide to day trading basics including tools, order types, chart reading, and setups.',
    filename: 'Day-Trading-Guide-For-Beginners-Warrior-Trading.pdf',
    pdfUrl: 'https://pdf.infobooks.org/ING/500%20Trading/Day-Trading-Guide-For-Beginners-Warrior-Trading.pdf',
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

  const fileResponse = await fetchAllowlisted(def.pdfUrl);
  if (!fileResponse.ok) {
    throw new Error(
      `InfoBooks returned HTTP ${fileResponse.status} while downloading "${def.title}".`
    );
  }

  const contentLength = Number(fileResponse.headers.get('content-length') || 0);
  if (contentLength > MAX_PDF_BYTES) {
    throw new Error('PDF exceeds the 50 MB vault storage limit.');
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_PDF_BYTES) {
    throw new Error('Downloaded file size is invalid or exceeds 50 MB.');
  }
  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error(`Source did not return a valid PDF document for "${def.title}".`);
  }

  const id = crypto.randomUUID();
  const storedFilename = `${id}.pdf`;
  const targetPath = resolveVaultFilePath(storedFilename);
  fs.writeFileSync(targetPath, buffer);

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
    sizeBytes: buffer.byteLength,
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

  const fileResponse = await fetchAllowlisted(def.pdfUrl);
  if (!fileResponse.ok) {
    return {
      statusCode: fileResponse.status === 404 ? 404 : 502,
      error:
        fileResponse.status === 404
          ? `"${def.title}" returned HTTP 404 (file is currently missing on swing-trade-stocks.com).`
          : `Source site returned HTTP ${fileResponse.status} while downloading "${def.title}".`,
    };
  }

  const contentLength = Number(fileResponse.headers.get('content-length') || 0);
  if (contentLength > MAX_PDF_BYTES) {
    return { statusCode: 413, error: 'PDF exceeds the 50 MB vault storage limit.' };
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.byteLength === 0 || buffer.byteLength > MAX_PDF_BYTES) {
    return { statusCode: 413, error: 'Downloaded file size is invalid or exceeds 50 MB.' };
  }

  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return {
      statusCode: 422,
      error: `Source did not return a valid PDF document for "${def.title}".`,
    };
  }

  const id = crypto.randomUUID();
  const storedFilename = `${id}.pdf`;
  const targetPath = resolveVaultFilePath(storedFilename);
  fs.writeFileSync(targetPath, buffer);

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
    sizeBytes: buffer.byteLength,
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

  const fileResponse = await fetchAllowlisted(chosenPdf.downloadUrl);
  if (!fileResponse.ok) {
    return {
      statusCode: 502,
      error: `Archive.org returned HTTP ${fileResponse.status} while downloading the PDF.`,
    };
  }

  const contentLength = Number(fileResponse.headers.get('content-length') || 0);
  if (contentLength > MAX_PDF_BYTES) {
    return { statusCode: 413, error: 'PDF exceeds the 50 MB vault storage limit.' };
  }

  const arrayBuffer = await fileResponse.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.byteLength === 0 || buffer.byteLength > MAX_PDF_BYTES) {
    return { statusCode: 413, error: 'Downloaded file size is invalid or exceeds 50 MB.' };
  }

  if (buffer.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return { statusCode: 422, error: 'Remote source did not return a valid PDF document.' };
  }

  const id = crypto.randomUUID();
  const storedFilename = `${id}.pdf`;
  const targetPath = resolveVaultFilePath(storedFilename);
  fs.writeFileSync(targetPath, buffer);

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
    sourceUrl: inspection.detailsUrl,
    originalFilename: chosenPdf.name,
    storedFilename,
    sizeBytes: buffer.byteLength,
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

  const syncState = {
    syncing: false,
    completed: 0,
    total: 0,
  };

  async function syncMissingCuratedBooks(unhideRepoBooks = false): Promise<void> {
    if (syncState.syncing) return;

    if (unhideRepoBooks) {
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
    }

    const existing = getCombinedCatalog();
    const existingKeys = new Set(existing.map((item) => item.bookKey).filter(Boolean));

    const missingInfobooks = INFOBOOKS_TRADING_BOOKS.filter(
      (ib) => !existingKeys.has(ib.bookKey)
    );
    const missingClassics = buildRequestedBooksCatalog(existing).filter(
      (c) => c.rights === 'public_domain' && !existingKeys.has(c.bookKey)
    );
    const missingEbooks = SWING_TRADE_EBOOKS.filter(
      (eb) => eb.bookKey !== 'sts-indicators' && !existingKeys.has(eb.bookKey)
    );

    const tasks: Array<() => Promise<void>> = [
      ...missingInfobooks.map((ib) => async () => {
        await storeInfoBookFromCatalog(ib.bookKey);
      }),
      ...missingClassics.map((c) => async () => {
        await storeArchiveBookFromSpec({
          identifier: c.archiveIdentifier,
          filename: c.preferredPdfFilename,
          title: c.title,
          author: c.author,
          year: c.year,
          bookKey: c.bookKey,
          coverPath: c.coverPath,
        });
      }),
      ...missingEbooks.map((eb) => async () => {
        await storeSwingTradeEbookFromCatalog(eb.bookKey);
      }),
    ];

    if (tasks.length === 0) return;

    syncState.syncing = true;
    syncState.completed = 0;
    syncState.total = tasks.length;

    console.log(
      `Syncing ${tasks.length} missing curated books (${missingInfobooks.length} InfoBooks, ${missingClassics.length} classics, ${missingEbooks.length} Swing-Trade)...`
    );

    let cursor = 0;
    const workerCount = Math.min(4, tasks.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < tasks.length) {
        const index = cursor++;
        try {
          await tasks[index]();
        } catch {
          // Ignore transient network errors during background sync
        } finally {
          syncState.completed += 1;
        }
      }
    });

    await Promise.all(workers);
    syncState.syncing = false;
    console.log(`Vault sync finished: ${getCombinedCatalog().length} books available.`);
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
      const message = err instanceof Error ? err.message : 'Failed to store InfoBooks PDF.';
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
      const message = err instanceof Error ? err.message : 'Failed to store eBook PDF.';
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

  app.post('/api/vault/sync', (_req: Request, res: Response) => {
    void syncMissingCuratedBooks(true);
    res.status(202).json({
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

        res.status(201).json({ item: vaultEntry });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'PDF upload failed.';
        res.status(500).json({ error: message });
      }
    }
  );

  app.get('/api/vault/:id/file', (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const uploadItem = readCatalog().find((entry) => entry.id === id);
    const overrides = readOverrides();
    const repoItem = !uploadItem && !overrides[id]?.hidden
      ? readRepoLibrary().find((entry) => entry.id === id)
      : undefined;
    const item = uploadItem || repoItem;
    if (!item) {
      res.status(404).json({ error: 'Stored PDF not found in vault.' });
      return;
    }

    try {
      const filePath = uploadItem
        ? resolveVaultFilePath(item.storedFilename)
        : resolveLibraryFilePath(item.storedFilename);
      if (!fs.existsSync(filePath)) {
        res.status(404).json({ error: 'PDF file missing on disk.' });
        return;
      }
      const isDownload = req.query.download === '1';
      const safeName = sanitizeDownloadFilename(item.title || item.originalFilename);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader(
        'Content-Disposition',
        `${isDownload ? 'attachment' : 'inline'}; filename="${safeName}"`
      );
      if (!uploadItem && !isDownload) {
        res.setHeader('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
      }
      res.sendFile(filePath);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to stream PDF.';
      res.status(400).json({ error: message });
    }
  });

  app.patch('/api/vault/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id || '');
    const body = (req.body || {}) as {
      notes?: string;
      readingStatus?: ReadingStatus;
    };

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
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Folio Vault running at http://0.0.0.0:${PORT}`);
    void syncMissingCuratedBooks();
  });
}

startServer();
