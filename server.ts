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

function resolveVaultFilePath(storedFilename: string): string {
  if (!/^[a-zA-Z0-9_-]+\.pdf$/.test(storedFilename)) {
    throw new Error('Invalid stored filename.');
  }
  const resolved = path.resolve(VAULT_FILES_DIR, storedFilename);
  if (!resolved.startsWith(VAULT_FILES_DIR + path.sep)) {
    throw new Error('Resolved path escapes vault storage boundary.');
  }
  return resolved;
}

function sanitizeDownloadFilename(name: string): string {
  const base = name
    .replace(/\.pdf$/i, '')
    .replace(/[^a-zA-Z0-9._ -]+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'document'}.pdf`;
}

function readCatalog(): VaultBook[] {
  if (!fs.existsSync(CATALOG_PATH)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is VaultBook => {
      if (!item || typeof item.id !== 'string' || typeof item.storedFilename !== 'string') {
        return false;
      }
      try {
        const filePath = resolveVaultFilePath(item.storedFilename);
        return fs.existsSync(filePath);
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
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

  async function syncMissingCuratedBooks(): Promise<void> {
    if (syncState.syncing) return;

    const existing = readCatalog();
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
    console.log(`Vault sync finished: ${readCatalog().length} books stored.`);
  }

  app.get('/api/collections/infobooks-trading', (_req: Request, res: Response) => {
    const vault = readCatalog();
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

      const item = await storeInfoBookFromCatalog(bookKey);
      res.status(201).json({ item });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to store InfoBooks PDF.';
      res.status(502).json({ error: message });
    }
  });

  app.get('/api/books/requested', (_req: Request, res: Response) => {
    const vault = readCatalog();
    res.json({ books: buildRequestedBooksCatalog(vault) });
  });

  app.get('/api/collections/swing-trade-ebooks', async (_req: Request, res: Response) => {
    const vault = readCatalog();
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
    const items = readCatalog();
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
    void syncMissingCuratedBooks();
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
    const catalog = readCatalog();
    const item = catalog.find((entry) => entry.id === id);
    if (!item) {
      res.status(404).json({ error: 'Stored PDF not found in vault.' });
      return;
    }

    try {
      const filePath = resolveVaultFilePath(item.storedFilename);
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
      fs.createReadStream(filePath).pipe(res);
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
