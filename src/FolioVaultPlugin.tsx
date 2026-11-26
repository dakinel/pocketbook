import type * as React from 'react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import * as THREE from 'three';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Contrast,
  Highlighter,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  NotebookPen,
  PenTool,
  Plus,
  RotateCcw,
  Trash2,
  X,
  ZoomIn,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export type ReadingStatus = 'unread' | 'reading' | 'completed';

export type BookKeeperColor =
  | 'crimson'
  | 'emerald'
  | 'sapphire'
  | 'amber'
  | 'violet'
  | 'teal';

export interface VaultBook {
  id: string;
  bookKey: string | null;
  title: string;
  author: string;
  year: number | null;
  sourceType: 'archive' | 'ebook_collection' | 'infobooks' | 'upload';
  sourceIdentifier: string | null;
  sourceUrl: string | null;
  originalFilename: string;
  storedFilename: string;
  sizeBytes: number;
  coverPath: string | null;
  readingStatus: ReadingStatus;
  notes: string;
  storedAt: string;
  lastPage?: number | null;
  totalPages?: number | null;
  bookmarkedPage?: number | null;
  keeperColor?: BookKeeperColor | null;
  lastReadAt?: string | null;
}

/**
 * FolioVaultPlugin — Self-contained 1-file 3D floating books library + flip-book reader.
 *
 * External Project Migration (copy only this file, e.g. src/FolioVaultPlugin.tsx):
 *   1. Install peer dependencies:
 *      npm install three pdfjs-dist lucide-react
 *   2. Render anywhere (all CSS, Three.js shader backdrop, 60-book catalog,
 *      cover-matched 3D spines/backs/boards, Book Keepers, and PDF reader are self-contained):
 *      - Connected to your Vault backend (recommended for cached covers & Range PDF proxy):
 *        <FolioVaultPlugin apiBaseUrl="https://your-folio-vault-url" />
 *      - Standalone client-only mode:
 *        <FolioVaultPlugin />
 */
export interface FolioVaultPluginProps {
  /** Optional base URL of a Folio Vault server (e.g. "https://example.com"). Defaults to relative "/api/vault". */
  apiBaseUrl?: string;
  /** Optional base URL for PDF.js cmaps/wasm/standard_fonts/iccs. Auto-detects "/pdfjs/" and falls back to jsDelivr CDN. */
  pdfAssetsBaseUrl?: string;
  /** Optional explicit book catalog override. When omitted, fetches from apiBaseUrl and falls back to FOLIO_VAULT_BOOKS. */
  books?: VaultBook[];
  /** Render the Three.js floating 3D books shader backdrop behind the shelves. Defaults to true. */
  showBackground?: boolean;
  /** Allow deleting books from the server vault inside the reader Notes drawer. Defaults to true. */
  allowDelete?: boolean;
  /** Automatically inject custom 3D, chain-lock, Book Keeper, and flip-book CSS if not present. Defaults to true. */
  injectStyles?: boolean;
  /** Optional extra CSS class on the plugin root wrapper. */
  className?: string;
  /** Optional callback fired when an unlocked book is opened. */
  onSelectBook?: (book: VaultBook) => void;
  /** Optional callback fired once books finish loading. */
  onBooksLoaded?: (books: VaultBook[]) => void;
}

export interface FolioVaultPluginMountHandle {
  unmount: () => void;
  update: (nextProps?: Partial<FolioVaultPluginProps>) => void;
}

/**
 * Complete embedded books output from the Folio Vault catalog.
 */
export const FOLIO_VAULT_BOOKS: VaultBook[] = [
  {
    id: 'ib-10-most-profitable',
    bookKey: 'ib-10-most-profitable',
    title: '10 Most Profitable Trading Strategies',
    author: 'Nikhil Porwal',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '10-most-profitable-trading-strategies-nikhil-porwal-419.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/10-most-profitable-trading-strategies-nikhil-porwal-419.pdf',
    originalFilename: '10-most-profitable-trading-strategies-nikhil-porwal-419.pdf',
    storedFilename: 'ib-10-most-profitable.pdf',
    sizeBytes: 1060214,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Covers Inside Bar, Doji Reversal, Engulfing patterns, Trendline Breakout, Darvas Box, and ADX*EMA.',
    storedAt: '2026-11-25T16:04:17.974Z',
  },
  {
    id: 'ib-12-principles-investing',
    bookKey: 'ib-12-principles-investing',
    title: '12 Principles for Saving and Investing',
    author: 'Association Française de la Gestion Financière',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '12-principles-for-saving-and-investing-Association-Fran-aise-de-la-Gestion-financi-re.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/12-principles-for-saving-and-investing-Association-Fran-aise-de-la-Gestion-financi-re.pdf',
    originalFilename: '12-principles-for-saving-and-investing-Association-Fran-aise-de-la-Gestion-financi-re.pdf',
    storedFilename: 'ib-12-principles-investing.pdf',
    sizeBytes: 1558407,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Twelve enduring principles for risk tolerance, diversification, and medium-to-long-term market investing.',
    storedAt: '2026-11-25T17:37:03.547Z',
  },
  {
    id: 'sts-seven-habits',
    bookKey: 'sts-seven-habits',
    title: '7 Habits Of A Highly Successful Trader',
    author: 'Mark Crisp',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'successfultrader.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/successfultrader.pdf',
    originalFilename: 'successfultrader.pdf',
    storedFilename: 'sts-seven-habits.pdf',
    sizeBytes: 63866,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Examines seven core habits shared by consistently disciplined traders.',
    storedAt: '2026-11-25T14:46:59.552Z',
  },
  {
    id: 'ib-forex-trading-strategies',
    bookKey: 'ib-forex-trading-strategies',
    title: '7 Trading Strategies',
    author: 'Harry Turner',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '7.-Forex-Trading-Strategies-Author-Harry-Turner.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/537%20Forex/7.-Forex-Trading-Strategies-Author-Harry-Turner.pdf',
    originalFilename: '7.-Forex-Trading-Strategies-Author-Harry-Turner.pdf',
    storedFilename: 'ib-forex-trading-strategies.pdf',
    sizeBytes: 1193103,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Step-by-step entry/exit rules, position sizing, and market regime filtering across 7 technical strategies.',
    storedAt: '2026-11-25T17:37:06.291Z',
  },
  {
    id: 'ib-9-advanced-strategies',
    bookKey: 'ib-9-advanced-strategies',
    title: '9 Advanced and Profitable Trading Strategies',
    author: 'Roman Sadowski',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '08.-9-Advanced-and-Profitable-Trading-Strategies-Author-Roman-Sadowski.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/500%20Trading/08.-9-Advanced-and-Profitable-Trading-Strategies-Author-Roman-Sadowski.pdf',
    originalFilename: '08.-9-Advanced-and-Profitable-Trading-Strategies-Author-Roman-Sadowski.pdf',
    storedFilename: 'ib-9-advanced-strategies.pdf',
    sizeBytes: 1552712,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Covers momentum reversal, moving average crossover, Heikin-Ashi, RSI divergence, and Bollinger Bands.',
    storedAt: '2026-11-25T16:04:16.643Z',
  },
  {
    id: 'ib-complete-guide-day-trading',
    bookKey: 'ib-complete-guide-day-trading',
    title: 'A Complete Guide to Day Trading',
    author: 'Markus Heitkoetter',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'a-complete-guide-to-day-trading-markus-heitkoetter-412.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/a-complete-guide-to-day-trading-markus-heitkoetter-412.pdf',
    originalFilename: 'a-complete-guide-to-day-trading-markus-heitkoetter-412.pdf',
    storedFilename: 'ib-complete-guide-day-trading.pdf',
    sizeBytes: 1652538,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Day trading course covering market selection, 7-step strategy development, entry/exit rules, and money management.',
    storedAt: '2026-11-25T16:04:15.792Z',
  },
  {
    id: 'ib-guide-to-investing',
    bookKey: 'ib-guide-to-investing',
    title: 'A Guide to Investing',
    author: 'Schroders',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '15.A-Guide-to-Investing-Autor-Schroders.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/15.A-Guide-to-Investing-Autor-Schroders.pdf',
    originalFilename: '15.A-Guide-to-Investing-Autor-Schroders.pdf',
    storedFilename: 'ib-guide-to-investing.pdf',
    sizeBytes: 333399,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Institutional overview of risk, inflation protection, asset classes, and portfolio construction.',
    storedAt: '2026-11-25T17:37:01.267Z',
  },
  {
    id: 'sts-practical-swing',
    bookKey: 'sts-practical-swing',
    title: 'A Practical Guide To Swing Trading',
    author: 'Larry Swing',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'myswingtradingbook.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/myswingtradingbook.pdf',
    originalFilename: 'myswingtradingbook.pdf',
    storedFilename: 'sts-practical-swing.pdf',
    sizeBytes: 1275958,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Covers candlesticks, trend identification, moving averages, and swing setups.',
    storedAt: '2026-11-25T14:46:59.179Z',
  },
  {
    id: 'ib-practical-guide-swing-larry',
    bookKey: 'ib-practical-guide-swing-larry',
    title: 'A Practical Guide to Swing Trading (InfoBooks Edition)',
    author: 'Larry Swing',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '01.-A-Practical-Guide-to-Swing-Trading-Author-Larry-Swing.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/500%20Trading/01.-A-Practical-Guide-to-Swing-Trading-Author-Larry-Swing.pdf',
    originalFilename: '01.-A-Practical-Guide-to-Swing-Trading-Author-Larry-Swing.pdf',
    storedFilename: 'ib-practical-guide-swing-larry.pdf',
    sizeBytes: 807063,
    coverPath: null,
    readingStatus: 'unread',
    notes: "Practical swing trading guide with 'The Master Plan' entry/exit rules, candlesticks, and case studies.",
    storedAt: '2026-11-25T16:04:18.183Z',
  },
  {
    id: 'ib-quick-start-trading-coulling',
    bookKey: 'ib-quick-start-trading-coulling',
    title: 'A Quick Start Guide to Market Trading',
    author: 'Anna Coulling',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'a-quick-start-guide-to-forex-trading-anna-coulling-9077.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/a-quick-start-guide-to-forex-trading-anna-coulling-9077.pdf',
    originalFilename: 'a-quick-start-guide-to-forex-trading-anna-coulling-9077.pdf',
    storedFilename: 'ib-quick-start-trading-coulling.pdf',
    sizeBytes: 1234065,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Covers market participants, price discovery, trading psychology, and foundational technical analysis.',
    storedAt: '2026-11-25T17:37:06.063Z',
  },
  {
    id: 'ib-applied-corporate-finance',
    bookKey: 'ib-applied-corporate-finance',
    title: 'Applied Corporate Finance',
    author: 'Aswath Damodaran',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'applied-corporate-finance-aswath-damodaran-2023.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/applied-corporate-finance-aswath-damodaran-2023.pdf',
    originalFilename: 'applied-corporate-finance-aswath-damodaran-2023.pdf',
    storedFilename: 'ib-applied-corporate-finance.pdf',
    sizeBytes: 1053700,
    coverPath: '/src/assets/images/cover_applied_corporate_finance_1795671381692.jpg',
    readingStatus: 'unread',
    notes: 'NYU Stern valuation expert Aswath Damodaran on investment analysis, capital structure, dividends, and firm valuation.',
    storedAt: '2026-11-25T17:37:06.897Z',
  },
  {
    id: 'ib-business-finance-murray',
    bookKey: 'ib-business-finance-murray',
    title: 'Business Finance',
    author: 'Tim Murray',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'Business-Finance-Tim-Murray.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/271%20Finances/Business-Finance-Tim-Murray.pdf',
    originalFilename: 'Business-Finance-Tim-Murray.pdf',
    storedFilename: 'ib-business-finance-murray.pdf',
    sizeBytes: 322130,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Core equity and corporate finance lecture notes covering time value of money, stock valuation, and cost of capital.',
    storedAt: '2026-11-25T17:37:09.653Z',
  },
  {
    id: 'sts-charting-made-easy',
    bookKey: 'sts-charting-made-easy',
    title: 'Charting Made Easy',
    author: 'Technical Analysis Primer',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'chartingmadeeasy.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/chartingmadeeasy.pdf',
    originalFilename: 'chartingmadeeasy.pdf',
    storedFilename: 'sts-charting-made-easy.pdf',
    sizeBytes: 913841,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Covers support and resistance levels, trend lines, and foundational chart patterns.',
    storedAt: '2026-11-25T14:46:58.896Z',
  },
  {
    id: 'ib-corporate-finance-notes',
    bookKey: 'ib-corporate-finance-notes',
    title: 'Corporate Finance Study Notes',
    author: 'Zhipeng Yan',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'corporate-finance-study-notes-zhipeng-yan-2024.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/corporate-finance-study-notes-zhipeng-yan-2024.pdf',
    originalFilename: 'corporate-finance-study-notes-zhipeng-yan-2024.pdf',
    storedFilename: 'ib-corporate-finance-notes.pdf',
    sizeBytes: 590326,
    coverPath: null,
    readingStatus: 'unread',
    notes: '25 chapters covering NPV, CAPM, cost of capital, options, derivatives, and corporate valuation.',
    storedAt: '2026-11-25T17:37:07.081Z',
  },
  {
    id: 'ib-corporate-finance-theory',
    bookKey: 'ib-corporate-finance-theory',
    title: 'Corporate Finance: Theory and Practice',
    author: 'Pierre Vernimmen, Pascal Quiry, Yann Le Fur',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'corporate-finance-theory-and-practice-pierre-vernimmen-pascal-quiry-yann-le-fur-2022.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/corporate-finance-theory-and-practice-pierre-vernimmen-pascal-quiry-yann-le-fur-2022.pdf',
    originalFilename: 'corporate-finance-theory-and-practice-pierre-vernimmen-pascal-quiry-yann-le-fur-2022.pdf',
    storedFilename: 'ib-corporate-finance-theory.pdf',
    sizeBytes: 5557337,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Comprehensive corporate finance text covering financial statement analysis, DCF valuation, M&A, and securities.',
    storedAt: '2026-11-25T17:37:11.817Z',
  },
  {
    id: 'sts-day-trading-mind',
    bookKey: 'sts-day-trading-mind',
    title: 'Day Trading Mind',
    author: 'Trading Psychology',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'daytradingmind.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/daytradingmind.pdf',
    originalFilename: 'daytradingmind.pdf',
    storedFilename: 'sts-day-trading-mind.pdf',
    sizeBytes: 54860,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Practical mental focus techniques and emotional discipline routines for active traders.',
    storedAt: '2026-11-25T14:46:59.316Z',
  },
  {
    id: 'ib-financial-investments-stock-markets',
    bookKey: 'ib-financial-investments-stock-markets',
    title: 'Financial Investments and Stock Markets',
    author: 'Capital Market Authority',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '10.Financial-Investments-and-Stock-Markets-Autor-Capital-Market-Authority.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/10.Financial-Investments-and-Stock-Markets-Autor-Capital-Market-Authority.pdf',
    originalFilename: '10.Financial-Investments-and-Stock-Markets-Autor-Capital-Market-Authority.pdf',
    storedFilename: 'ib-financial-investments-stock-markets.pdf',
    sizeBytes: 371332,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Foundational guide to how financial investments and stock exchanges function.',
    storedAt: '2026-11-25T17:37:02.780Z',
  },
  {
    id: 'ib-first-steps-investing',
    bookKey: 'ib-first-steps-investing',
    title: 'First Steps to Investing',
    author: 'Prithvi Haldea',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '17.First-Steps-to-Investing-Autor-Prithvi-Haldea.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/17.First-Steps-to-Investing-Autor-Prithvi-Haldea.pdf',
    originalFilename: '17.First-Steps-to-Investing-Autor-Prithvi-Haldea.pdf',
    storedFilename: 'ib-first-steps-investing.pdf',
    sizeBytes: 106034,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Covers compounding, equity allocation, and how primary and secondary capital markets operate.',
    storedAt: '2026-11-25T17:37:01.637Z',
  },
  {
    id: 'ib-first-time-investor',
    bookKey: 'ib-first-time-investor',
    title: 'First-Time Investor: Grow and Protect Your Money',
    author: 'Paul A. Merriman & Richard Buck',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '01.First-Time-Investor-Grow-and-Protect-your-Money-Autor-Paul-A.-Merriman-and-Richard-Buck.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/01.First-Time-Investor-Grow-and-Protect-your-Money-Autor-Paul-A.-Merriman-and-Richard-Buck.pdf',
    originalFilename: '01.First-Time-Investor-Grow-and-Protect-your-Money-Autor-Paul-A.-Merriman-and-Richard-Buck.pdf',
    storedFilename: 'ib-first-time-investor.pdf',
    sizeBytes: 727878,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Core habits and portfolio choices that shape long-term equity and wealth returns.',
    storedAt: '2026-11-25T17:37:01.101Z',
  },
  {
    id: 'ib-derivatives-markets-fed',
    bookKey: 'ib-derivatives-markets-fed',
    title: 'FX and Interest Rate Derivatives Markets',
    author: 'Federal Reserve Bank of New York',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'the-foreign-exchange-and-interest-rate-derivatives-markets-federal-reserve-bank-of-new-york-9072.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/the-foreign-exchange-and-interest-rate-derivatives-markets-federal-reserve-bank-of-new-york-9072.pdf',
    originalFilename: 'the-foreign-exchange-and-interest-rate-derivatives-markets-federal-reserve-bank-of-new-york-9072.pdf',
    storedFilename: 'ib-derivatives-markets-fed.pdf',
    sizeBytes: 717910,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Federal Reserve survey detailing institutional derivatives turnover by instrument and counterparty.',
    storedAt: '2026-11-25T17:37:06.614Z',
  },
  {
    id: 'ib-guide-young-investors',
    bookKey: 'ib-guide-young-investors',
    title: 'Guide for Young Investors',
    author: 'Capital Market Authority',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '02.Guide-for-Young-Investors-Autor-Capital-Market-Authority.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/02.Guide-for-Young-Investors-Autor-Capital-Market-Authority.pdf',
    originalFilename: '02.Guide-for-Young-Investors-Autor-Capital-Market-Authority.pdf',
    storedFilename: 'ib-guide-young-investors.pdf',
    sizeBytes: 499582,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Choosing securities, evaluating performance, and managing portfolio risk.',
    storedAt: '2026-11-25T17:37:01.599Z',
  },
  {
    id: 'ib-become-successful-investor',
    bookKey: 'ib-become-successful-investor',
    title: 'How to Become a Successful Investor',
    author: 'Matti Korhonen',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '16.Beginner-s-Guide-How-to-Become-a-Successful-Investor-Autor-MattiKorhonen.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/16.Beginner-s-Guide-How-to-Become-a-Successful-Investor-Autor-MattiKorhonen.pdf',
    originalFilename: '16.Beginner-s-Guide-How-to-Become-a-Successful-Investor-Autor-MattiKorhonen.pdf',
    storedFilename: 'ib-become-successful-investor.pdf',
    sizeBytes: 456273,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Beginner guide centered on stock market investing, brokerage orders, and valuation.',
    storedAt: '2026-11-25T17:37:01.312Z',
  },
  {
    id: 'ib-how-to-trade-price-action',
    bookKey: 'ib-how-to-trade-price-action',
    title: 'How to Trade Price Action',
    author: 'Galen Woods',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'how-to-trade-price-action-galen-woods-415.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/how-to-trade-price-action-galen-woods-415.pdf',
    originalFilename: 'how-to-trade-price-action-galen-woods-415.pdf',
    storedFilename: 'ib-how-to-trade-price-action.pdf',
    sizeBytes: 2957235,
    coverPath: null,
    readingStatus: 'unread',
    notes: '11 chapters covering candlestick patterns, chart formations, and concrete price-action setups.',
    storedAt: '2026-11-25T16:04:17.147Z',
  },
  {
    id: 'ib-japanese-candlesticks',
    bookKey: 'ib-japanese-candlesticks',
    title: 'How to Trade With Japanese Candlesticks',
    author: 'Swissquote',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'how-to-trade-with-japanese-candlesticks-swissquote-9078.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/how-to-trade-with-japanese-candlesticks-swissquote-9078.pdf',
    originalFilename: 'how-to-trade-with-japanese-candlesticks-swissquote-9078.pdf',
    storedFilename: 'ib-japanese-candlesticks.pdf',
    sizeBytes: 1277181,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Illustrated catalogue of bullish and bearish candlestick reversal patterns and market validation rules.',
    storedAt: '2026-11-25T17:37:13.745Z',
  },
  {
    id: 'ib-chart-patterns-fidelity',
    bookKey: 'ib-chart-patterns-fidelity',
    title: 'Identifying Chart Patterns With Technical Analysis',
    author: 'Fidelity Investments',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'identifying-chart-patterns-with-technical-analysis-fidelity-investments-9079.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/identifying-chart-patterns-with-technical-analysis-fidelity-investments-9079.pdf',
    originalFilename: 'identifying-chart-patterns-with-technical-analysis-fidelity-investments-9079.pdf',
    storedFilename: 'ib-chart-patterns-fidelity.pdf',
    sizeBytes: 1946654,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Fidelity technical analysis workbook covering trendlines, support/resistance, and continuation/reversal patterns.',
    storedAt: '2026-11-25T17:37:05.759Z',
  },
  {
    id: 'ib-intro-financial-market',
    bookKey: 'ib-intro-financial-market',
    title: 'Introduction to Financial Markets',
    author: 'Siddharth Bagri, G.C. Sharma, Ashok Wadhwa',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '07.-An-Introduction-to-Financial-Market-Part-I-for-Class-XI-Author-Mr.-Siddharth-Bagri-Mr.-G.C.-Sharma-Mr.-Ashok-Wadhwa.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/271%20Finances/07.-An-Introduction-to-Financial-Market-Part-I-for-Class-XI-Author-Mr.-Siddharth-Bagri-Mr.-G.C.-Sharma-Mr.-Ashok-Wadhwa.pdf',
    originalFilename: '07.-An-Introduction-to-Financial-Market-Part-I-for-Class-XI-Author-Mr.-Siddharth-Bagri-Mr.-G.C.-Sharma-Mr.-Ashok-Wadhwa.pdf',
    storedFilename: 'ib-intro-financial-market.pdf',
    sizeBytes: 5724083,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Introduces securities markets, primary/secondary trading, derivatives, mutual funds, and risk management.',
    storedAt: '2026-11-25T17:37:10.788Z',
  },
  {
    id: 'sts-intro-forex',
    bookKey: 'sts-intro-forex',
    title: 'Introduction to Forex',
    author: 'Currency Markets Primer',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'introductiontoforex.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/introductiontoforex.pdf',
    originalFilename: 'introductiontoforex.pdf',
    storedFilename: 'sts-intro-forex.pdf',
    sizeBytes: 379712,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Explains the foreign exchange market and foundational currency trading mechanics.',
    storedAt: '2026-11-25T14:46:58.792Z',
  },
  {
    id: 'ib-intro-investment-banking',
    bookKey: 'ib-intro-investment-banking',
    title: 'Introduction to Investment Banking',
    author: 'John L. Teall',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'introduction-to-investment-banking-john-l-teall-8193.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/introduction-to-investment-banking-john-l-teall-8193.pdf',
    originalFilename: 'introduction-to-investment-banking-john-l-teall-8193.pdf',
    storedFilename: 'ib-intro-investment-banking.pdf',
    sizeBytes: 882834,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Covers IPOs, underwriting, mergers and acquisitions, leveraged buyouts, and institutional brokerage.',
    storedAt: '2026-11-25T17:37:03.807Z',
  },
  {
    id: 'ib-trading-system-development',
    bookKey: 'ib-trading-system-development',
    title: 'Introduction to Trading System Development',
    author: 'David Cardoza',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '04.-Introduction-to-Trading-System-Development-Author-David-Cardoza.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/500%20Trading/04.-Introduction-to-Trading-System-Development-Author-David-Cardoza.pdf',
    originalFilename: '04.-Introduction-to-Trading-System-Development-Author-David-Cardoza.pdf',
    storedFilename: 'ib-trading-system-development.pdf',
    sizeBytes: 560659,
    coverPath: '/src/assets/images/cover_trading_system_development_1795671601310.jpg',
    readingStatus: 'unread',
    notes: 'Building automated trading systems, trend-following crossovers, Monte Carlo analysis, and backtesting.',
    storedAt: '2026-11-25T16:04:15.529Z',
  },
  {
    id: 'ib-investing-for-beginners',
    bookKey: 'ib-investing-for-beginners',
    title: 'Investing for Beginners',
    author: 'The Motley Fool',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'Investing-for-Beginners-The-Motley-Fool.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/Investing-for-Beginners-The-Motley-Fool.pdf',
    originalFilename: 'Investing-for-Beginners-The-Motley-Fool.pdf',
    storedFilename: 'ib-investing-for-beginners.pdf',
    sizeBytes: 608853,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Plain-language introduction to stock investing, compounding, and long-term wealth building.',
    storedAt: '2026-11-25T17:37:01.206Z',
  },
  {
    id: 'ib-investment-banking',
    bookKey: 'ib-investment-banking',
    title: 'Investment Banking',
    author: 'Institute of Bankers',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'investment-banking-institute-of-bankers-8194.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/investment-banking-institute-of-bankers-8194.pdf',
    originalFilename: 'investment-banking-institute-of-bankers-8194.pdf',
    storedFilename: 'ib-investment-banking.pdf',
    sizeBytes: 4360091,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Comprehensive look at capital raising, equity advisory work, and institutional market transactions.',
    storedAt: '2026-11-25T17:37:04.907Z',
  },
  {
    id: 'ib-investment-banking-securities',
    bookKey: 'ib-investment-banking-securities',
    title: 'Investment Banking and Securities Issuance',
    author: 'Jay R. Ritter',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'investment-banking-and-securities-issuance-jay-r-ritter-8195.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/investment-banking-and-securities-issuance-jay-r-ritter-8195.pdf',
    originalFilename: 'investment-banking-and-securities-issuance-jay-r-ritter-8195.pdf',
    storedFilename: 'ib-investment-banking-securities.pdf',
    sizeBytes: 198958,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Authoritative academic overview of IPO pricing, underwriting mechanics, and securities issuance.',
    storedAt: '2026-11-25T17:37:05.185Z',
  },
  {
    id: 'ib-investment-dictionary',
    bookKey: 'ib-investment-dictionary',
    title: 'Investment Dictionary',
    author: 'Mercer',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '09.Investment-Dictionary-Autor-Mercer.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/09.Investment-Dictionary-Autor-Mercer.pdf',
    originalFilename: '09.Investment-Dictionary-Autor-Mercer.pdf',
    storedFilename: 'ib-investment-dictionary.pdf',
    sizeBytes: 238578,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Reference dictionary decoding capital markets, equity, fund, and portfolio management terminology.',
    storedAt: '2026-11-25T17:37:01.760Z',
  },
  {
    id: 'ib-investment-strategy-fidelity',
    bookKey: 'ib-investment-strategy-fidelity',
    title: 'Investment Strategy Guide',
    author: 'Fidelity Investments',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'Investment-Strategy-Fidelity-Investments.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/Investment-Strategy-Fidelity-Investments.pdf',
    originalFilename: 'Investment-Strategy-Fidelity-Investments.pdf',
    storedFilename: 'ib-investment-strategy-fidelity.pdf',
    sizeBytes: 252489,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Explains asset allocation, diversification, rebalancing, and tax-efficient equity investing.',
    storedAt: '2026-11-25T17:37:01.742Z',
  },
  {
    id: 'ib-investment-strategy-quarterly',
    bookKey: 'ib-investment-strategy-quarterly',
    title: 'Investment Strategy Quarterly',
    author: 'Raymond James',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'Investment-Strategy-Ouarterly-Raymond-James.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/Investment-Strategy-Ouarterly-Raymond-James.pdf',
    originalFilename: 'Investment-Strategy-Ouarterly-Raymond-James.pdf',
    storedFilename: 'ib-investment-strategy-quarterly.pdf',
    sizeBytes: 1021021,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Macroeconomic outlook and equity market strategy covering forces shaping portfolio returns.',
    storedAt: '2026-11-25T17:37:01.686Z',
  },
  {
    id: 'sts-top-trading-profits',
    bookKey: 'sts-top-trading-profits',
    title: 'Keys To Top Trading Profits',
    author: 'George Lane, Larry Williams, Linda Raschke & others',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'championstradingprofits.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/championstradingprofits.pdf',
    originalFilename: 'championstradingprofits.pdf',
    storedFilename: 'sts-top-trading-profits.pdf',
    sizeBytes: 2237748,
    coverPath: null,
    readingStatus: 'unread',
    notes: '18 trading champions share risk, indicator, and execution insights across interviews.',
    storedAt: '2026-11-25T14:46:59.476Z',
  },
  {
    id: 'sts-killer-patterns',
    bookKey: 'sts-killer-patterns',
    title: 'Killer Patterns',
    author: 'Swing-Trade-Stocks Guide',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'killerpatternsupdated_sts.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/killerpatternsupdated_sts.pdf',
    originalFilename: 'killerpatternsupdated_sts.pdf',
    storedFilename: 'sts-killer-patterns.pdf',
    sizeBytes: 117344,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Using MACD histograms to generate systematic buy and sell signals.',
    storedAt: '2026-11-25T14:46:58.663Z',
  },
  {
    id: 'ib-liquidity-markets-trading',
    bookKey: 'ib-liquidity-markets-trading',
    title: 'Liquidity, Markets and Trading in Action',
    author: 'Deniz Ozenbas, Michael S. Pagano, Robert A. Schwartz, Bruce W. Weber',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'liquidity-markets-and-trading-in-action-deniz-ozenbas-michael-s-pagano-robert-a-schwartz-bruce-w-weber-656.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/liquidity-markets-and-trading-in-action-deniz-ozenbas-michael-s-pagano-robert-a-schwartz-bruce-w-weber-656.pdf',
    originalFilename: 'liquidity-markets-and-trading-in-action-deniz-ozenbas-michael-s-pagano-robert-a-schwartz-bruce-w-weber-656.pdf',
    storedFilename: 'ib-liquidity-markets-trading.pdf',
    sizeBytes: 1996837,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Explores market microstructure, liquidity, finance, and order execution dynamics.',
    storedAt: '2026-11-25T16:04:15.387Z',
  },
  {
    id: 'ib-mastering-trading-psychology',
    bookKey: 'ib-mastering-trading-psychology',
    title: 'Mastering Trading Psychology',
    author: 'Andrew Aziz & Mike Baehr',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'mastering-trading-psychology-andrew-aziz-and-mike-baehr-414.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/mastering-trading-psychology-andrew-aziz-and-mike-baehr-414.pdf',
    originalFilename: 'mastering-trading-psychology-andrew-aziz-and-mike-baehr-414.pdf',
    storedFilename: 'ib-mastering-trading-psychology.pdf',
    sizeBytes: 3457285,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Exploration of trading psychology covering mindset, emotional discipline, and risk tolerance.',
    storedAt: '2026-11-25T16:04:14.978Z',
  },
  {
    id: 'sts-pattern-cycles',
    bookKey: 'sts-pattern-cycles',
    title: 'Pattern Cycles',
    author: 'Alan Farley',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'patterncycles.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/patterncycles.pdf',
    originalFilename: 'patterncycles.pdf',
    storedFilename: 'sts-pattern-cycles.pdf',
    sizeBytes: 94117,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Bottom reversals, breakouts, trend transitions, and Elliott Wave structure.',
    storedAt: '2026-11-25T14:46:59.376Z',
  },
  {
    id: 'ib-charts-how-to-read',
    bookKey: 'ib-charts-how-to-read',
    title: 'Price Charts and How to Read Them',
    author: 'Soho Markets',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'Forex-charts-and-how-to-read-them-Soho-Markets.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/537%20Forex/Forex-charts-and-how-to-read-them-Soho-Markets.pdf',
    originalFilename: 'Forex-charts-and-how-to-read-them-Soho-Markets.pdf',
    storedFilename: 'ib-charts-how-to-read.pdf',
    sizeBytes: 352522,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Annotated guide to line, bar, and candlestick charts, double tops, head-and-shoulders, and triangles.',
    storedAt: '2026-11-25T17:37:06.615Z',
  },
  {
    id: 'ib-principles-of-finance',
    bookKey: 'ib-principles-of-finance',
    title: 'Principles of Finance',
    author: 'Julie Dahlquist & Rainford Knight',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'Principles-of-Finance-Julie-Dahlquist-Rainford-Knight.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/271%20Finances/Principles-of-Finance-Julie-Dahlquist-Rainford-Knight.pdf',
    originalFilename: 'Principles-of-Finance-Julie-Dahlquist-Rainford-Knight.pdf',
    storedFilename: 'ib-principles-of-finance.pdf',
    sizeBytes: 10988965,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Peer-reviewed OpenStax textbook covering stocks, bonds, valuation, risk-return, and capital markets.',
    storedAt: '2026-11-25T17:37:09.527Z',
  },
  {
    id: 'ib-saving-investing-sec',
    bookKey: 'ib-saving-investing-sec',
    title: 'Saving and Investing Roadmap',
    author: 'U.S. Securities and Exchange Commission',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '30.Saving-and-Investing-Autor-SEC.gov.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/30.Saving-and-Investing-Autor-SEC.gov.pdf',
    originalFilename: '30.Saving-and-Investing-Autor-SEC.gov.pdf',
    storedFilename: 'ib-saving-investing-sec.pdf',
    sizeBytes: 819105,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Official SEC guide to stocks, bonds, mutual funds, asset allocation, and investor protection.',
    storedAt: '2026-11-25T17:37:02.935Z',
  },
  {
    id: 'sts-millionaire-traders',
    bookKey: 'sts-millionaire-traders',
    title: 'Secrets of Millionaire Traders',
    author: 'Trader Interviews Collection',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'million.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/million.pdf',
    originalFilename: 'million.pdf',
    storedFilename: 'sts-millionaire-traders.pdf',
    sizeBytes: 2002220,
    coverPath: null,
    readingStatus: 'unread',
    notes: '25 trading lessons and discipline habits distilled from interviews with experienced traders.',
    storedAt: '2026-11-25T14:46:59.272Z',
  },
  {
    id: 'ib-short-swing-trading',
    bookKey: 'ib-short-swing-trading',
    title: 'Short Swing Trading',
    author: 'David Graeme-Smith',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'short-swing-trading-david-graeme-smith-417.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/short-swing-trading-david-graeme-smith-417.pdf',
    originalFilename: 'short-swing-trading-david-graeme-smith-417.pdf',
    storedFilename: 'ib-short-swing-trading.pdf',
    sizeBytes: 1778119,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Step-by-step SST swing trading methodology covering pattern recognition, entry triggers, and stops.',
    storedAt: '2026-11-25T16:04:18.400Z',
  },
  {
    id: 'ib-smart-money-concept',
    bookKey: 'ib-smart-money-concept',
    title: 'Smart Money Concept Trading Strategy',
    author: 'Oreoluwa Fakolujo',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'smart-money-concept-trading-strategy-oreoluwa-fakolujo-9075.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/smart-money-concept-trading-strategy-oreoluwa-fakolujo-9075.pdf',
    originalFilename: 'smart-money-concept-trading-strategy-oreoluwa-fakolujo-9075.pdf',
    storedFilename: 'ib-smart-money-concept.pdf',
    sizeBytes: 1123891,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Covers order blocks, liquidity zones, institutional market structure shifts, and classic price action.',
    storedAt: '2026-11-25T17:37:05.537Z',
  },
  {
    id: 'ib-stock-investing-101',
    bookKey: 'ib-stock-investing-101',
    title: 'Stock Investing 101',
    author: 'Young Investors Society',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'Stock-Investing-101-Young-Investors-Society.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/Stock-Investing-101-Young-Investors-Society.pdf',
    originalFilename: 'Stock-Investing-101-Young-Investors-Society.pdf',
    storedFilename: 'ib-stock-investing-101.pdf',
    sizeBytes: 2865120,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Structured curriculum on how stocks work, analyzing economic moats, valuing companies, and building a portfolio.',
    storedAt: '2026-11-25T17:37:02.682Z',
  },
  {
    id: 'sts-candlestick-pivot',
    bookKey: 'sts-candlestick-pivot',
    title: 'Swing Trading Using Candlestick Charting',
    author: 'John Person',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'swingtradingpivot.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/swingtradingpivot.pdf',
    originalFilename: 'swingtradingpivot.pdf',
    storedFilename: 'sts-candlestick-pivot.pdf',
    sizeBytes: 1011558,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Combining candlestick charting formations with pivot point support/resistance analysis.',
    storedAt: '2026-11-25T14:46:59.410Z',
  },
  {
    id: 'ib-basics-investing-stocks',
    bookKey: 'ib-basics-investing-stocks',
    title: 'The Basics for Investing in Stocks',
    author: "Kiplinger's Personal Finance",
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: '12.The-Basics-for-Investing-in-Stocks-Autor-Kiplinger-s-Personal-Finance.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/12.The-Basics-for-Investing-in-Stocks-Autor-Kiplinger-s-Personal-Finance.pdf',
    originalFilename: '12.The-Basics-for-Investing-in-Stocks-Autor-Kiplinger-s-Personal-Finance.pdf',
    storedFilename: 'ib-basics-investing-stocks.pdf',
    sizeBytes: 241710,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Covers stock categories, fundamental stock selection, key valuation metrics, and sell discipline.',
    storedAt: '2026-11-25T17:37:02.707Z',
  },
  {
    id: 'ib-complete-guide-trading',
    bookKey: 'ib-complete-guide-trading',
    title: 'The Complete Guide to Trading',
    author: 'Corporate Finance Institute',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'the-complete-guide-to-trading-corporate-finance-institute-413.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/the-complete-guide-to-trading-corporate-finance-institute-413.pdf',
    originalFilename: 'the-complete-guide-to-trading-corporate-finance-institute-413.pdf',
    storedFilename: 'ib-complete-guide-trading.pdf',
    sizeBytes: 2954583,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Covers financial markets, trading concepts, stocks, bonds, forex, and derivatives fundamentals.',
    storedAt: '2026-11-25T16:04:14.450Z',
  },
  {
    id: 'ib-day-traders-bible',
    bookKey: 'ib-day-traders-bible',
    title: "The Day Trader's Bible",
    author: 'Richard D. Wyckoff',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'the-day-trader-s-bible-richard-d-wyckoff-416.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/the-day-trader-s-bible-richard-d-wyckoff-416.pdf',
    originalFilename: 'the-day-trader-s-bible-richard-d-wyckoff-416.pdf',
    storedFilename: 'ib-day-traders-bible.pdf',
    sizeBytes: 820266,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Classic 1919 seminal work on tape reading, supply and demand, and market psychology.',
    storedAt: '2026-11-25T16:04:16.148Z',
  },
  {
    id: 'ib-first-trading-manual',
    bookKey: 'ib-first-trading-manual',
    title: 'The First Trading Manual: Foundation Course and Strategies',
    author: 'Trader Tom',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'The-First-Trading-Manual-Foundation-Course-and-Strategies-Trader-Tom.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/500%20Trading/The-First-Trading-Manual-Foundation-Course-and-Strategies-Trader-Tom.pdf',
    originalFilename: 'The-First-Trading-Manual-Foundation-Course-and-Strategies-Trader-Tom.pdf',
    storedFilename: 'ib-first-trading-manual.pdf',
    sizeBytes: 3677453,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Foundation course covering technical analysis, price action, candlestick patterns, and trading psychology.',
    storedAt: '2026-11-25T16:04:13.880Z',
  },
  {
    id: 'ib-good-investor',
    bookKey: 'ib-good-investor',
    title: 'The Good Investor',
    author: 'Adrian Hornsby & Gabi Blumberg',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'The-Good-Investor-Adrian-Hornsby-Gabi-Blumberg.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/275%20Investment/The-Good-Investor-Adrian-Hornsby-Gabi-Blumberg.pdf',
    originalFilename: 'The-Good-Investor-Adrian-Hornsby-Gabi-Blumberg.pdf',
    storedFilename: 'ib-good-investor.pdf',
    sizeBytes: 930531,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Practical framework for screening opportunities, allocating capital, and measuring portfolio results.',
    storedAt: '2026-11-25T17:37:01.167Z',
  },
  {
    id: 'ib-power-of-divergence',
    bookKey: 'ib-power-of-divergence',
    title: 'The Power of Divergence Trading',
    author: 'David Carli',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'the-power-of-divergence-trading-david-carli-418.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/the-power-of-divergence-trading-david-carli-418.pdf',
    originalFilename: 'the-power-of-divergence-trading-david-carli-418.pdf',
    storedFilename: 'ib-power-of-divergence.pdf',
    sizeBytes: 4405440,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Focused guide on regular and hidden divergence strategies using RSI and MACD indicators.',
    storedAt: '2026-11-25T16:04:17.844Z',
  },
  {
    id: 'sts-trader-plan',
    bookKey: 'sts-trader-plan',
    title: 'The Trader Business Plan',
    author: 'Christopher Terry',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'traderplan.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/traderplan.pdf',
    originalFilename: 'traderplan.pdf',
    storedFilename: 'sts-trader-plan.pdf',
    sizeBytes: 56229,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Structuring a trading business plan including methodologies, goal setting, and record keeping.',
    storedAt: '2026-11-25T14:46:58.841Z',
  },
  {
    id: 'sts-fibonacci',
    bookKey: 'sts-fibonacci',
    title: 'The Truth About Fibonacci Trading',
    author: 'Bill Poulos',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'fib.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/fib.pdf',
    originalFilename: 'fib.pdf',
    storedFilename: 'sts-fibonacci.pdf',
    sizeBytes: 404344,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Step-by-step introduction to Fibonacci retracements and price extensions.',
    storedAt: '2026-11-25T14:46:58.944Z',
  },
  {
    id: 'sts-three-swing-examples',
    bookKey: 'sts-three-swing-examples',
    title: 'Three Swing Trading Examples',
    author: 'Alan Farley',
    year: null,
    sourceType: 'ebook_collection',
    sourceIdentifier: 'alanfarley.pdf',
    sourceUrl: 'https://www.swing-trade-stocks.com/support-files/alanfarley.pdf',
    originalFilename: 'alanfarley.pdf',
    storedFilename: 'sts-three-swing-examples.pdf',
    sizeBytes: 245903,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Walkthrough of three complete swing trading setups with annotated charts and rules.',
    storedAt: '2026-11-25T14:46:59.505Z',
  },
  {
    id: 'ib-trading-strategy-playbook',
    bookKey: 'ib-trading-strategy-playbook',
    title: 'Trading Strategy Playbook',
    author: 'OspreyFX',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'trading-strategy-playbook-ospreyfx-9071.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/PDF/trading-strategy-playbook-ospreyfx-9071.pdf',
    originalFilename: 'trading-strategy-playbook-ospreyfx-9071.pdf',
    storedFilename: 'ib-trading-strategy-playbook.pdf',
    sizeBytes: 538148,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Compares day trading, scalping, and swing trading styles with execution and capital requirements.',
    storedAt: '2026-11-25T17:37:05.706Z',
  },
  {
    id: 'ib-trading-volatility',
    bookKey: 'ib-trading-volatility',
    title: 'Trading Volatility',
    author: 'Colin Bennet',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'Trading-Volatility-Colin-Bennet.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/500%20Trading/Trading-Volatility-Colin-Bennet.pdf',
    originalFilename: 'Trading-Volatility-Colin-Bennet.pdf',
    storedFilename: 'ib-trading-volatility.pdf',
    sizeBytes: 2494314,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Comprehensive guide to volatility trading covering options, hedging, and derivatives strategies.',
    storedAt: '2026-11-25T16:04:13.716Z',
  },
  {
    id: 'ib-types-of-indicators',
    bookKey: 'ib-types-of-indicators',
    title: 'Types of Technical Indicators',
    author: 'Soho Markets',
    year: null,
    sourceType: 'infobooks',
    sourceIdentifier: 'Type-of-forex-indicators-Soho-Markets.pdf',
    sourceUrl: 'https://pdf.infobooks.org/ING/537%20Forex/Type-of-forex-indicators-Soho-Markets.pdf',
    originalFilename: 'Type-of-forex-indicators-Soho-Markets.pdf',
    storedFilename: 'ib-types-of-indicators.pdf',
    sizeBytes: 315895,
    coverPath: null,
    readingStatus: 'unread',
    notes: 'Concise reference on moving averages, MACD, RSI, Bollinger Bands, and momentum oscillators.',
    storedAt: '2026-11-25T17:37:06.386Z',
  },
];

export const FOLIO_VAULT_PLUGIN_CSS = `
.floating-books-bg { position: fixed; inset: 0; z-index: 0; pointer-events: none; opacity: 0; transition: opacity 1.6s ease; }
.floating-books-bg.ready { opacity: 1; }
.floating-books-bg canvas { display: block; width: 100%; height: 100%; }
.air-books-stage { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: clamp(44px, 6vw, 84px) clamp(36px, 5vw, 72px); max-width: 1440px; margin: 0 auto; padding: clamp(48px, 7vh, 88px) clamp(28px, 4.5vw, 68px) 76px; list-style: none; perspective: 1800px; }
.air-book-slot { --book-w: clamp(134px, 13vw, 180px); --book-h: calc(var(--book-w) * 1.36); --book-d: clamp(38px, 3.6vw, 52px); --half-d: calc(var(--book-d) * 0.5); --page-d: calc(var(--book-d) - 6px); --half-page-d: calc(var(--page-d) * -0.5); --depth-scale: 1; --depth-y: 0px; --rx: 14deg; --ry: -26deg; --rz: -4deg; --float-dur: 10.5s; --float-delay: 0s; position: relative; width: var(--book-w); height: var(--book-h); transform-style: preserve-3d; transform: translate3d(0, var(--depth-y), 0) scale(var(--depth-scale)); transition: transform 0.42s cubic-bezier(0.22, 1, 0.36, 1); z-index: 10; }
.air-book-slot[data-depth='1'] { --depth-scale: 1.08; --depth-y: -18px; z-index: 18; }
.air-book-slot[data-depth='2'] { --depth-scale: 0.99; --depth-y: 14px; z-index: 14; }
.air-book-slot[data-depth='3'] { --depth-scale: 0.91; --depth-y: -6px; z-index: 10; }
.air-book-slot[data-depth='4'] { --depth-scale: 0.85; --depth-y: 22px; z-index: 6; }
.air-book-slot:nth-child(6n + 1) { --book-d: clamp(42px, 4vw, 56px); --rx: 15deg; --ry: -28deg; --rz: -5deg; --float-dur: 10.2s; --float-delay: -0.8s; --keeper-sway-dir: 1; }
.air-book-slot:nth-child(6n + 2) { --book-d: clamp(36px, 3.4vw, 48px); --rx: -12deg; --ry: 24deg; --rz: 4deg; --float-dur: 11.8s; --float-delay: -2.4s; --keeper-sway-dir: -0.85; }
.air-book-slot:nth-child(6n + 3) { --book-d: clamp(46px, 4.3vw, 60px); --rx: 11deg; --ry: -22deg; --rz: 3deg; --float-dur: 9.8s; --float-delay: -4.1s; --keeper-sway-dir: 0.75; }
.air-book-slot:nth-child(6n + 4) { --book-d: clamp(38px, 3.6vw, 50px); --rx: -14deg; --ry: -30deg; --rz: -3.5deg; --float-dur: 12.6s; --float-delay: -1.6s; --keeper-sway-dir: -1.05; }
.air-book-slot:nth-child(6n + 5) { --book-d: clamp(44px, 4.1vw, 58px); --rx: 13deg; --ry: 26deg; --rz: -5.5deg; --float-dur: 10.9s; --float-delay: -5.2s; --keeper-sway-dir: 0.9; }
.air-book-slot:nth-child(6n + 6) { --book-d: clamp(40px, 3.8vw, 52px); --rx: -10deg; --ry: 20deg; --rz: 4deg; --float-dur: 11.4s; --float-delay: -3.1s; --keeper-sway-dir: -0.7; }
@keyframes airBookFloat { 0%, 100% { transform: translate3d(0, 0px, 0) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(var(--rz)); } 50% { transform: translate3d(0, -8px, 8px) rotateX(calc(var(--rx) - 2.5deg)) rotateY(calc(var(--ry) + 3.5deg)) rotateZ(calc(var(--rz) + 1deg)); } }
.air-book-float { width: 100%; height: 100%; transform-style: preserve-3d; animation: airBookFloat var(--float-dur) cubic-bezier(0.37, 0, 0.63, 1) var(--float-delay) infinite; }
.air-book-slot[data-inview='false'] .air-book-float { animation-play-state: paused; }
.air-book-slot:focus-within { z-index: 30; }
.air-book-slot:focus-within .air-book-float { animation-play-state: paused; }
.air-book-hit { display: block; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; appearance: none; -webkit-appearance: none; -webkit-tap-highlight-color: transparent; touch-action: manipulation; transform-style: preserve-3d; text-align: left; cursor: pointer; }
.air-book-body { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; transition: transform 0.36s cubic-bezier(0.22, 1, 0.36, 1); }
.air-book-hit:active .air-book-body { transform: translate3d(0, -4px, 22px) scale(0.98); }
.air-book-slot:focus-visible .air-book-body, .air-book-hit:focus-visible .air-book-body { transform: translate3d(0, -12px, 54px) rotateX(-4deg) rotateY(10deg) scale(1.06); }
@media (hover: hover) {
  .air-book-slot:hover { z-index: 30; }
  .air-book-slot:hover .air-book-float { animation-play-state: paused; }
  .air-book-slot:hover .air-book-body { transform: translate3d(0, -12px, 54px) rotateX(-4deg) rotateY(10deg) scale(1.06); }
}
.air-book-shadow-plane { position: absolute; inset: 8% -12% -14% 8%; transform: translateZ(calc(var(--half-d) * -1 - 26px)); background: radial-gradient(ellipse at 48% 52%, rgba(0, 0, 0, 0.56) 0%, rgba(0, 0, 0, 0.24) 50%, transparent 74%); pointer-events: none; transition: transform 0.36s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.36s ease; }
@media (hover: hover) { .air-book-slot:hover .air-book-shadow-plane, .air-book-slot:focus-within .air-book-shadow-plane { transform: translateZ(calc(var(--half-d) * -1 - 48px)) scale(1.08); opacity: 0.85; } }
.air-book-pages { position: absolute; top: 4px; right: 4px; width: var(--page-d); height: calc(100% - 8px); transform-origin: right center; transform: translate3d(0, 0, var(--half-page-d)) rotateY(90deg); background: linear-gradient(90deg, rgba(16, 28, 30, 0.32) 0%, transparent 16%, transparent 84%, rgba(16, 28, 30, 0.28) 100%), repeating-linear-gradient(90deg, #f2ede0 0px, #f2ede0 1.5px, #d6ccb8 1.5px, #d6ccb8 3px); box-shadow: inset 0 5px 7px rgba(14, 28, 30, 0.24), inset 0 -5px 7px rgba(14, 28, 30, 0.22); pointer-events: none; }
.air-book-spine { position: absolute; top: 0; left: 0; width: var(--book-d); height: 100%; transform-origin: left center; transform: translate3d(0, 0, calc(var(--half-d) * -1)) rotateY(-90deg); background: linear-gradient(90deg, var(--book-spine-edge, #17272b) 0%, var(--book-spine-hi, #37555b) 30%, var(--book-spine-mid, #243b40) 72%, var(--book-spine-deep, #132124) 100%); border-radius: 3px 0 0 3px; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14), inset 0 2px 0 rgba(255, 255, 255, 0.22), inset 0 -2px 0 rgba(0, 0, 0, 0.45); transition: background 0.45s ease; pointer-events: none; }
.air-book-spine::before, .air-book-spine::after { content: ''; position: absolute; left: 2px; right: 2px; height: 5px; background: linear-gradient(180deg, var(--book-band-hi, rgba(226, 236, 236, 0.36)) 0%, var(--book-band-lo, rgba(16, 28, 30, 0.55)) 100%); border-radius: 1px; }
.air-book-spine::before { top: 15%; }
.air-book-spine::after { bottom: 15%; }
.air-book-top { position: absolute; left: 4px; top: 4px; width: calc(100% - 8px); height: var(--page-d); transform-origin: center top; transform: translate3d(0, 0, var(--half-page-d)) rotateX(90deg); background: linear-gradient(180deg, rgba(16, 28, 30, 0.32) 0%, transparent 18%, transparent 82%, rgba(16, 28, 30, 0.28) 100%), repeating-linear-gradient(180deg, #f2ede0 0px, #f2ede0 1.5px, #d6ccb8 1.5px, #d6ccb8 3px); box-shadow: inset -5px 0 7px rgba(14, 28, 30, 0.22); pointer-events: none; }
.air-book-bottom { position: absolute; left: 4px; bottom: 4px; width: calc(100% - 8px); height: var(--page-d); transform-origin: center bottom; transform: translate3d(0, 0, var(--half-page-d)) rotateX(-90deg); background: linear-gradient(180deg, rgba(16, 28, 30, 0.28) 0%, transparent 18%, transparent 82%, rgba(16, 28, 30, 0.34) 100%), repeating-linear-gradient(180deg, #e6dfd0 0px, #e6dfd0 1.5px, #c9bfab 1.5px, #c9bfab 3px); box-shadow: inset -5px 0 7px rgba(14, 28, 30, 0.26); pointer-events: none; }
.air-book-back { position: absolute; inset: 0; border-radius: 6px 3px 3px 6px; transform: translateZ(calc(var(--half-d) * -1)) rotateY(180deg); background: linear-gradient(155deg, var(--book-back-hi, #2b4146) 0%, var(--book-back-lo, #162529) 100%); box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.14), 0 20px 38px rgba(0, 0, 0, 0.48); transition: background 0.45s ease; pointer-events: none; }
.air-book-keeper-wrap { position: absolute; right: 17%; top: -7px; bottom: -27px; width: 24px; transform: translateZ(calc(var(--half-d) - 7px)); transform-style: preserve-3d; pointer-events: none; transition: transform 0.36s cubic-bezier(0.22, 1, 0.36, 1); }
.air-book-keeper { width: 100%; height: 100%; background: linear-gradient(90deg, var(--keeper-edge, #7f1d1d) 0%, var(--keeper-hi, #dc2626) 36%, var(--keeper-mid, #b91c1c) 74%, var(--keeper-edge, #7f1d1d) 100%); clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 93%, 0 100%); box-shadow: inset 0 1px 0 var(--keeper-sheen, rgba(255, 220, 220, 0.35)), 0 8px 16px rgba(0, 0, 0, 0.45); display: flex; align-items: flex-end; justify-content: center; padding-bottom: 10px; transform-origin: 50% 76%; transform: translate3d(0, calc(var(--keeper-swing, 0) * 2.2px), 0) rotateX(calc(var(--keeper-swing, 0) * -13deg)) rotateZ(calc(var(--keeper-swing, 0) * var(--keeper-sway-dir, 1) * 5deg)); will-change: transform; pointer-events: none; }
.air-book-keeper-label { font-family: var(--font-mono, ui-monospace, monospace); font-size: 8.5px; font-weight: 700; letter-spacing: -0.02em; line-height: 1; color: var(--keeper-text, #fff5f5); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.65); font-variant-numeric: tabular-nums; }
@media (hover: hover) { .air-book-slot:hover .air-book-keeper-wrap, .air-book-slot:focus-within .air-book-keeper-wrap { transform: translateZ(calc(var(--half-d) - 5px)) translateY(2px); } }
.air-book-cover { position: relative; width: 100%; height: 100%; border-radius: 2px 6px 6px 2px; overflow: hidden; transform: translateZ(var(--half-d)); background: var(--book-cover-bg, #1a282b); box-shadow: inset 10px 0 14px rgba(10, 26, 28, 0.28), inset 2px 0 0 rgba(255, 255, 255, 0.2), inset -2px 0 2px rgba(255, 255, 255, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.18); transition: background 0.45s ease; }
.air-book-cover::before { content: ''; position: absolute; top: 0; bottom: 0; left: 9px; width: 3px; pointer-events: none; z-index: 2; background: linear-gradient(90deg, rgba(0, 0, 0, 0.28) 0%, rgba(255, 255, 255, 0.16) 60%, transparent 100%); }
.air-book-cover::after { content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 2; background: linear-gradient(118deg, rgba(255, 255, 255, 0.22) 0%, rgba(255, 255, 255, 0.04) 36%, transparent 62%, rgba(10, 26, 28, 0.14) 100%); }
@keyframes vaultPlateDissolve { 0% { opacity: 1; } 25% { opacity: 0.92; } 100% { opacity: 0; } }
@keyframes vaultShockwave { 0% { transform: scale(0.25); opacity: 0.95; } 55% { opacity: 0.7; } 100% { transform: scale(2.8); opacity: 0; } }
@keyframes vaultLockerBreak { 0% { transform: translate3d(0, 0, 0) scale(1) rotate(0deg); opacity: 1; } 14% { transform: translate3d(0, -8px, 0) scale(1.18) rotate(-8deg); opacity: 1; } 34% { transform: translate3d(4px, 6px, 0) scale(1.06) rotate(12deg); opacity: 1; } 100% { transform: translate3d(14px, 145px, 0) scale(0.72) rotate(38deg); opacity: 0; } }
@keyframes vaultChainSnapTL { 0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 1; } 18% { transform: translate3d(-14px, -12px, 0) rotate(-14deg); opacity: 1; } 100% { transform: translate3d(-72px, 34px, 0) rotate(-42deg); opacity: 0; } }
@keyframes vaultChainSnapTR { 0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 1; } 18% { transform: translate3d(14px, -12px, 0) rotate(14deg); opacity: 1; } 100% { transform: translate3d(72px, 34px, 0) rotate(42deg); opacity: 0; } }
@keyframes vaultChainSnapBL { 0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 1; } 18% { transform: translate3d(-14px, 10px, 0) rotate(12deg); opacity: 1; } 100% { transform: translate3d(-66px, 98px, 0) rotate(36deg); opacity: 0; } }
@keyframes vaultChainSnapBR { 0% { transform: translate3d(0, 0, 0) rotate(0deg); opacity: 1; } 18% { transform: translate3d(14px, 10px, 0) rotate(-12deg); opacity: 1; } 100% { transform: translate3d(66px, 98px, 0) rotate(-36deg); opacity: 0; } }
@keyframes vaultShacklePop { 0% { transform: translate3d(0, 0, 0) rotate(0deg); } 100% { transform: translate3d(-1px, -11px, 0) rotate(-14deg); } }
.vault-plate-breaking { animation: vaultPlateDissolve 0.62s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
.vault-shockwave-burst { animation: vaultShockwave 0.56s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
.vault-locker-group { transform-box: fill-box; transform-origin: center center; }
.vault-shackle-group { transform-box: view-box; transform-origin: 83px 125px; }
.vault-locker-breaking { animation: vaultLockerBreak 0.72s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
.vault-locker-breaking .vault-shackle-group { animation: vaultShacklePop 0.22s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
.vault-chain-arm { transform-box: view-box; }
.vault-chain-tl { transform-origin: 0% 0%; }
.vault-chain-tr { transform-origin: 100% 0%; }
.vault-chain-bl { transform-origin: 0% 100%; }
.vault-chain-br { transform-origin: 100% 100%; }
.vault-chain-breaking .vault-chain-tl { animation: vaultChainSnapTL 0.68s cubic-bezier(0.18, 0.9, 0.32, 1) forwards; }
.vault-chain-breaking .vault-chain-tr { animation: vaultChainSnapTR 0.68s cubic-bezier(0.18, 0.9, 0.32, 1) forwards; }
.vault-chain-breaking .vault-chain-bl { animation: vaultChainSnapBL 0.72s cubic-bezier(0.18, 0.9, 0.32, 1) forwards; }
.vault-chain-breaking .vault-chain-br { animation: vaultChainSnapBR 0.72s cubic-bezier(0.18, 0.9, 0.32, 1) forwards; }
@keyframes vaultChainVibrateA { 0%, 100% { transform: translate3d(0, 0, 0) rotate(0deg); } 12% { transform: translate3d(-1.9px, 1.5px, 0) rotate(-3.4deg); } 25% { transform: translate3d(1.7px, -1.2px, 0) rotate(3deg); } 38% { transform: translate3d(-1.4px, 1px, 0) rotate(-2.5deg); } 52% { transform: translate3d(1.1px, -0.8px, 0) rotate(1.9deg); } 66% { transform: translate3d(-0.7px, 0.5px, 0) rotate(-1.2deg); } 82% { transform: translate3d(0.35px, -0.25px, 0) rotate(0.6deg); } }
@keyframes vaultChainVibrateB { 0%, 100% { transform: translate3d(0, 0, 0) rotate(0deg); } 14% { transform: translate3d(1.8px, 1.4px, 0) rotate(3.2deg); } 28% { transform: translate3d(-1.6px, -1.1px, 0) rotate(-2.8deg); } 42% { transform: translate3d(1.3px, 0.9px, 0) rotate(2.2deg); } 56% { transform: translate3d(-1px, -0.7px, 0) rotate(-1.6deg); } 70% { transform: translate3d(0.6px, 0.4px, 0) rotate(1deg); } 85% { transform: translate3d(-0.3px, -0.2px, 0) rotate(-0.5deg); } }
@keyframes vaultLockerRattle { 0%, 100% { transform: translate3d(0, 0, 0) rotate(0deg); } 15% { transform: translate3d(-2.2px, 1px, 0) rotate(-6.5deg); } 30% { transform: translate3d(2.2px, -0.8px, 0) rotate(6deg); } 45% { transform: translate3d(-1.6px, 0.7px, 0) rotate(-4.5deg); } 60% { transform: translate3d(1.3px, -0.5px, 0) rotate(3.4deg); } 75% { transform: translate3d(-0.8px, 0.3px, 0) rotate(-2deg); } 88% { transform: translate3d(0.4px, -0.15px, 0) rotate(1deg); } }
@keyframes vaultShackleRattle { 0%, 100% { transform: translate3d(0, 0, 0); } 20% { transform: translate3d(0, -1.5px, 0); } 45% { transform: translate3d(0, 0.9px, 0); } 70% { transform: translate3d(0, -0.8px, 0); } }
@keyframes vaultBookLockedTap { 0%, 100% { transform: translate3d(0, 0, 0) rotateZ(0deg); } 20% { transform: translate3d(-1.5px, 1px, -6px) rotateZ(-1.3deg); } 45% { transform: translate3d(1.5px, -0.5px, -3px) rotateZ(1.1deg); } 70% { transform: translate3d(-0.8px, 0.4px, -1px) rotateZ(-0.6deg); } }
.vault-chain-rattling .vault-chain-tl, .vault-chain-rattling .vault-chain-br { animation: vaultChainVibrateA 0.44s cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
.vault-chain-rattling .vault-chain-tr, .vault-chain-rattling .vault-chain-bl { animation: vaultChainVibrateB 0.44s cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
.vault-locker-rattling { animation: vaultLockerRattle 0.44s cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
.vault-locker-rattling .vault-shackle-group { animation: vaultShackleRattle 0.44s cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
.air-book-slot.is-rattling .air-book-hit { animation: vaultBookLockedTap 0.36s cubic-bezier(0.36, 0.07, 0.19, 0.97) both; }
@keyframes coverSheen { 0% { transform: translateX(-140%) skewX(-18deg); opacity: 0; } 20% { opacity: 0.55; } 70% { opacity: 0.35; } 100% { transform: translateX(220%) skewX(-18deg); opacity: 0; } }
.book-reveal-stage { perspective: 2200px; transition: transform 0.7s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.38s ease; will-change: transform, opacity; }
.bookWrapper { width: min(92vw, 1080px); height: min(74dvh, 690px); margin: 0 auto; transform-style: preserve-3d; transform: translateX(-25%) rotateY(6deg); transition: transform 1.05s cubic-bezier(0.22, 1, 0.36, 1); }
.bookWrapper.is-spread-open { transform: translateX(0) rotateY(0deg); }
.bookBg { position: relative; width: 100%; height: 100%; transform-style: preserve-3d; }
.bookBoardLeft { position: absolute; top: 0; left: 0; width: 50%; height: 100%; border-radius: 12px 0 0 12px; background: linear-gradient(145deg, var(--book-board-hi, #1b1815) 0%, var(--book-board-lo, #0d0c0a) 100%); box-shadow: -14px 34px 70px rgba(0, 0, 0, 0.72), 0 12px 24px rgba(0, 0, 0, 0.55), inset 0 1px 0 var(--book-board-border, rgba(255, 255, 255, 0.14)); opacity: 0; transition: opacity 0.34s ease 0.24s, background 0.45s ease; }
.bookWrapper.is-spread-open .bookBoardLeft { opacity: 1; }
.bookBoardRight { position: absolute; top: 0; left: 50%; width: 50%; height: 100%; border-radius: 0 12px 12px 0; background: linear-gradient(145deg, var(--book-board-hi, #1b1815) 0%, var(--book-board-lo, #0d0c0a) 100%); box-shadow: 16px 34px 76px rgba(0, 0, 0, 0.8), 0 12px 26px rgba(0, 0, 0, 0.58), inset 0 1px 0 var(--book-board-border, rgba(255, 255, 255, 0.14)); transition: background 0.45s ease; }
.pageBg { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: calc(100% - 24px); height: calc(100% - 24px); border-radius: 2px; }
.pageWrapper { position: absolute; left: 50%; top: 0; width: 50%; height: 100%; z-index: 5; perspective: 2000px; -webkit-font-smoothing: antialiased; }
.cover-reveal-leaf { position: absolute; inset: -4px -4px -4px 0; z-index: 95; transform-style: preserve-3d; transform-origin: -2px center; transform: rotateY(0deg); border-radius: 0 10px 10px 0; box-shadow: 8px 20px 36px rgba(0, 0, 0, 0.55), inset 3px 0 6px rgba(255, 255, 255, 0.08); transition: transform 1.05s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.26s ease; pointer-events: none; }
.cover-reveal-leaf.is-open { transform: rotateY(-180deg); }
.cover-reveal-leaf.is-settled { opacity: 0; }
.cover-sheen { position: relative; overflow: hidden; }
.cover-sheen::after { content: ''; position: absolute; inset: 0; background: linear-gradient(105deg, transparent 20%, rgba(255, 232, 179, 0.16) 46%, rgba(255, 255, 255, 0.24) 50%, rgba(255, 232, 179, 0.14) 54%, transparent 80%); animation: coverSheen 1.25s cubic-bezier(0.22, 1, 0.36, 1) 0.22s both; pointer-events: none; }
.baseLeft { position: absolute; top: 0; left: 0; width: 50%; height: 100%; z-index: 1; overflow: hidden; opacity: 0; transition: opacity 0.34s ease 0.26s; background: linear-gradient(to right, #ffffff 0%, #ffffff 92%, #f5f3ee 97%, #d4d0c7 100%); }
.bookWrapper.is-spread-open .baseLeft { opacity: 1; }
.baseRight { position: absolute; top: 0; left: 50%; width: 50%; height: 100%; z-index: 1; overflow: hidden; background: linear-gradient(to right, #d4d0c7 0%, #f5f3ee 3%, #ffffff 8%, #ffffff 100%); }
.flip-page { position: absolute; inset: 0; transform-style: preserve-3d; transform-origin: -1px center; transition: transform 0.8s cubic-bezier(0.24, 1, 0.34, 1); cursor: pointer; }
.flip-page.is-flipped { transform: rotateY(-180deg); }
.flip-page.is-right { transform: rotateY(0deg); }
.pageFace { position: absolute; inset: 0; overflow: hidden; backface-visibility: hidden; -webkit-backface-visibility: hidden; }
.pageFace.front { background: linear-gradient(to right, #d4d0c7 0%, #f5f3ee 3%, #ffffff 8%, #ffffff 100%); }
.pageFace.back { transform: rotateY(-180deg); background: linear-gradient(to right, #ffffff 0%, #ffffff 92%, #f5f3ee 97%, #d4d0c7 100%); }
.pageFoldRight { position: absolute; width: 0px; height: 0px; top: 0; right: 0; pointer-events: none; border-left: 1px solid #d6d3cb; border-bottom: 1px solid #d6d3cb; box-shadow: -5px 5px 10px rgba(0, 0, 0, 0.14); background-image: linear-gradient(45deg, #e8e5dc 0%, #f3f1eb 48%, #ffffff 50%, #ffffff 100%); transition: width 0.25s ease, height 0.25s ease; }
@media (hover: hover) { .pageFace.front:hover .pageFoldRight { width: 48px; height: 48px; } }
.pageFoldLeft { position: absolute; width: 0px; height: 0px; top: 0; left: 0; pointer-events: none; border-right: 1px solid #d6d3cb; border-bottom: 1px solid #d6d3cb; box-shadow: 5px 5px 10px rgba(0, 0, 0, 0.14); background-image: linear-gradient(135deg, #ffffff 0%, #ffffff 50%, #f3f1eb 52%, #e8e5dc 100%); transition: width 0.25s ease, height 0.25s ease; }
@media (hover: hover) { .pageFace.back:hover .pageFoldLeft { width: 48px; height: 48px; } }
@keyframes readerKeeperReveal { 0% { opacity: 0; transform: translate3d(0, -26px, 24px) scaleY(0.42); } 65% { opacity: 1; transform: translate3d(0, 3px, 24px) scaleY(1.03); } 100% { opacity: 1; transform: translate3d(0, 0, 24px) scaleY(1); } }
.reader-book-keeper-ribbon { width: 28px; min-height: 54px; padding: 6px 2px 13px; color: var(--keeper-text, #fff5f5); background: linear-gradient(90deg, var(--keeper-edge, #7f1d1d) 0%, var(--keeper-hi, #dc2626) 38%, var(--keeper-mid, #b91c1c) 74%, var(--keeper-edge, #7f1d1d) 100%); clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 80%, 0 100%); box-shadow: 0 10px 18px rgba(0, 0, 0, 0.34), inset 0 1px 0 var(--keeper-sheen, rgba(255, 224, 224, 0.35)); transform-origin: top center; transform: translate3d(0, 0, 24px); animation: readerKeeperReveal 0.44s cubic-bezier(0.22, 1, 0.36, 1) both; transition: transform 0.24s cubic-bezier(0.22, 1, 0.36, 1); }
.reader-book-keeper-ribbon:hover { transform: translate3d(0, 3px, 24px); }
.reader-book-keeper-ribbon.is-compact { width: 22px; min-height: 40px; padding: 4px 2px 10px; }
@media (hover: hover) and (pointer: fine) {
  .folio-pen-surface, .folio-pen-surface img { cursor: none !important; }
  .folio-pen-surface button, .folio-pen-surface a, .folio-pen-surface input, .folio-pen-surface [data-pen-ignore] { cursor: pointer !important; }
}
.folio-pen-cursor { position: fixed; left: 0; top: 0; width: 0; height: 0; pointer-events: none; z-index: 140; opacity: 0; transition: opacity 0.16s ease; will-change: transform, opacity; }
.folio-pen-rig { transform-origin: 0px 0px; will-change: transform; }
.folio-pen-shadow { position: absolute; left: -4px; top: -2px; width: 14px; height: 7px; border-radius: 9999px; background: radial-gradient(ellipse at center, rgba(15, 23, 42, 0.42) 0%, transparent 74%); transform-origin: center; will-change: transform, opacity; }
@keyframes folioFabRipple { 0% { transform: translate(-50%, -50%) scale(0.32); opacity: 0.78; } 100% { transform: translate(-50%, -50%) scale(2.35); opacity: 0; } }
.folio-fab-container { position: relative; display: inline-block; }
.folio-fab-ripple { position: absolute; top: 50%; left: 50%; width: 66px; height: 66px; border-radius: 50%; border: 2px solid rgba(243, 198, 119, 0.75); background: radial-gradient(circle, rgba(56, 189, 248, 0.22) 0%, transparent 70%); pointer-events: none; animation: folioFabRipple 0.62s cubic-bezier(0.16, 1, 0.3, 1) forwards; z-index: 1; }
.folio-fab-button { position: relative; width: 60px; height: 60px; border: 1.5px solid rgba(243, 198, 119, 0.52); padding: 0; background: radial-gradient(circle at 30% 26%, #1f3644 0%, #0d1821 72%, #070e14 100%); color: #f3c677; border-radius: 50%; display: flex; align-items: center; justify-content: center; cursor: pointer; box-shadow: 0 12px 28px rgba(0, 0, 0, 0.48), 0 0 0 4px rgba(15, 28, 34, 0.28), inset 0 1px 1px rgba(255, 255, 255, 0.22); transition: transform 0.24s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.2s ease, background 0.2s ease, color 0.2s ease, border-color 0.2s ease; z-index: 2; }
.folio-fab-button:hover { transform: scale(1.07); box-shadow: 0 14px 32px rgba(0, 0, 0, 0.56), 0 0 0 5px rgba(243, 198, 119, 0.16), inset 0 1px 1px rgba(255, 255, 255, 0.28); }
.folio-fab-pen { display: flex; align-items: center; justify-content: center; transform: rotate(-18deg) scale(0.92); transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), color 0.2s ease; }
.folio-fab-container.active .folio-fab-button { background: radial-gradient(circle at 30% 28%, #fffdf8 0%, #f1ece1 100%); border-color: rgba(243, 198, 119, 0.85); color: #0f1b24; box-shadow: 0 14px 34px rgba(0, 0, 0, 0.46), 0 0 22px rgba(243, 198, 119, 0.26); }
.folio-fab-container.active .folio-fab-pen { transform: rotate(0deg) scale(1); }
.folio-fab-options { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); pointer-events: none; z-index: 3; }
.folio-fab-option { position: absolute; width: 52px; height: 52px; border: 1px solid rgba(186, 200, 210, 0.65); padding: 0; background: rgba(255, 253, 248, 0.96); border-radius: 50%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; color: #102029; text-decoration: none; cursor: pointer; box-shadow: 0 8px 20px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.95); opacity: 0; transform: translate(-50%, -50%) scale(0); transition: transform 0.34s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease-out, background 0.14s ease-out, color 0.14s ease-out, border-color 0.14s ease-out, box-shadow 0.14s ease-out; }
.folio-fab-container.active .folio-fab-option { opacity: 1; pointer-events: auto; }
.folio-fab-container.active .folio-fab-options .folio-fab-option:nth-child(1) { --offset-x: -64px; --offset-y: -42px; transform: translate(-50%, -50%) translate(var(--offset-x), var(--offset-y)) scale(1); transition-delay: 0.04s; }
.folio-fab-container.active .folio-fab-options .folio-fab-option:nth-child(2) { --offset-x: 0px; --offset-y: -84px; transform: translate(-50%, -50%) translate(var(--offset-x), var(--offset-y)) scale(1); transition-delay: 0.09s; }
.folio-fab-container.active .folio-fab-options .folio-fab-option:nth-child(3) { --offset-x: 64px; --offset-y: -42px; transform: translate(-50%, -50%) translate(var(--offset-x), var(--offset-y)) scale(1); transition-delay: 0.14s; }
.folio-fab-container.active .folio-fab-options .folio-fab-option:hover, .folio-fab-container.active .folio-fab-options .folio-fab-option:focus-visible { transform: translate(-50%, -50%) translate(var(--offset-x), var(--offset-y)) scale(1.12); background: linear-gradient(135deg, #0284c7, #38bdf8); border-color: rgba(186, 230, 253, 0.85); color: #ffffff; box-shadow: 0 12px 26px rgba(14, 165, 233, 0.42); transition-duration: 0.12s; transition-delay: 0s; outline: none; }
.folio-fab-container.active .folio-fab-options .folio-fab-option.folio-fab-opt-mark:hover, .folio-fab-container.active .folio-fab-options .folio-fab-option.folio-fab-opt-mark:focus-visible { background: linear-gradient(135deg, #d97706, #fbbf24); border-color: rgba(254, 243, 199, 0.9); color: #1c1203; box-shadow: 0 12px 26px rgba(245, 158, 11, 0.44); }
.folio-fab-container.active .folio-fab-options .folio-fab-option.folio-fab-opt-circle:hover, .folio-fab-container.active .folio-fab-options .folio-fab-option.folio-fab-opt-circle:focus-visible { background: linear-gradient(135deg, #be123c, #f43f5e); border-color: rgba(254, 205, 211, 0.85); color: #ffffff; box-shadow: 0 12px 26px rgba(225, 29, 72, 0.44); }
@keyframes folioStrokeDraw { 0% { stroke-dashoffset: 100; } 100% { stroke-dashoffset: 0; } }
@keyframes folioMarkNibSweep { 0% { transform: translate(-6%, 8%) scale(0.92); opacity: 0; } 18% { opacity: 1; } 80% { opacity: 1; } 100% { transform: translate(92%, -6%) scale(0.88); opacity: 0; } }
@keyframes folioCircleNibOrbit { 0% { transform: translate(16%, 34%) rotate(-8deg); opacity: 0; } 15% { opacity: 1; } 42% { transform: translate(68%, 12%) rotate(10deg); } 68% { transform: translate(86%, 54%) rotate(18deg); } 88% { transform: translate(34%, 84%) rotate(-4deg); opacity: 1; } 100% { transform: translate(18%, 34%) rotate(-12deg); opacity: 0; } }
.folio-draw-fresh { stroke-dasharray: 100; stroke-dashoffset: 100; animation: folioStrokeDraw 0.56s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
.folio-mark-fresh { stroke-dasharray: 100; stroke-dashoffset: 100; animation: folioStrokeDraw 0.44s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
.folio-nib-mark-tracer { animation: folioMarkNibSweep 0.52s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
.folio-nib-circle-tracer { animation: folioCircleNibOrbit 0.62s cubic-bezier(0.22, 1, 0.36, 1) forwards; }
.folio-page-mark { position: absolute; width: 24%; min-width: 46px; height: 3.8%; min-height: 13px; border: 0; padding: 0; background: transparent; mix-blend-mode: multiply; transform: translate(-50%, -50%) rotate(-0.8deg); cursor: pointer; transition: transform 0.15s ease, opacity 0.15s ease; }
.folio-page-mark:hover { transform: translate(-50%, -50%) rotate(-0.8deg) scale(1.06); opacity: 0.85; }
.folio-page-circle { position: absolute; width: 15%; min-width: 34px; aspect-ratio: 1 / 1; border: 0; padding: 0; background: transparent; transform: translate(-50%, -50%); cursor: pointer; transition: transform 0.15s ease, opacity 0.15s ease; }
.folio-page-circle:hover { transform: translate(-50%, -50%) scale(1.07); opacity: 0.85; }
@media (max-width: 639px) {
  .air-books-stage { gap: 38px 22px; padding: calc(28px + env(safe-area-inset-top, 0px)) 14px calc(68px + env(safe-area-inset-bottom, 0px)); }
  .air-book-slot { --book-w: clamp(104px, 34vw, 146px); --book-d: clamp(30px, 8.5vw, 42px); }
  .air-book-slot:nth-child(n) { --book-d: clamp(30px, 8.5vw, 42px); }
  .air-book-keeper-wrap { width: 20px; bottom: -22px; }
  .air-book-keeper { padding-bottom: 8px; }
  .air-book-keeper-label { font-size: 7.5px; }
  .bookWrapper { width: min(94vw, 1080px); height: min(56dvh, calc(94vw * 0.72)); }
  .pageBg { width: calc(100% - 12px); height: calc(100% - 12px); }
  .reader-book-keeper-ribbon { width: 22px; min-height: 42px; padding: 4px 2px 10px; }
}
@media (max-height: 520px) and (orientation: landscape) { .bookWrapper { height: min(62dvh, 420px); } }
@media (prefers-reduced-motion: reduce) {
  .floating-books-bg, .air-book-slot, .air-book-float, .air-book-body, .vault-plate-breaking, .vault-shockwave-burst, .vault-locker-breaking, .vault-locker-breaking .vault-shackle-group, .vault-chain-breaking .vault-chain-arm, .vault-chain-rattling .vault-chain-arm, .vault-locker-rattling, .vault-locker-rattling .vault-shackle-group, .air-book-slot.is-rattling .air-book-hit, .flip-page, .cover-reveal-leaf, .cover-sheen::after, .book-reveal-stage, .bookWrapper, .bookBoardLeft, .baseLeft, .pageFoldRight, .pageFoldLeft, .reader-book-keeper-ribbon, .air-book-keeper-wrap, .air-book-keeper, .folio-fab-container, .folio-fab-button, .folio-fab-pen, .folio-fab-ripple, .folio-fab-option, .folio-draw-fresh, .folio-mark-fresh, .folio-nib-mark-tracer, .folio-nib-circle-tracer, .folio-pen-cursor { transition: none !important; animation: none !important; }
  .air-book-keeper { transform: none !important; }
}
`;

function ensurePluginStylesInjected() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('style[data-folio-vault-plugin="true"]')) return;
  try {
    const probe = document.createElement('ul');
    probe.className = 'air-books-stage';
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    document.body.appendChild(probe);
    const alreadyStyled = window.getComputedStyle(probe).perspective === '1800px';
    document.body.removeChild(probe);
    if (alreadyStyled) return;
  } catch {
    // Proceed to inject stylesheet
  }
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-folio-vault-plugin', 'true');
  styleEl.textContent = FOLIO_VAULT_PLUGIN_CSS;
  document.head.appendChild(styleEl);
}

const DEPTH_PLANES = [1, 3, 2, 4, 2, 1, 4, 3] as const;

function joinApiUrl(apiBaseUrl: string | undefined, path: string): string {
  const base = (apiBaseUrl || '').trim().replace(/\/+$/, '');
  if (!base) return path;
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function isCrossOriginUrl(url: string | null | undefined): boolean {
  if (!url || typeof window === 'undefined') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return false;
  }
}

let detectedPdfAssetsBasePromise: Promise<string> | null = null;

function resolvePdfAssetsBase(explicitBase?: string): Promise<string> {
  const trimmed = (explicitBase || '').trim();
  if (trimmed) {
    return Promise.resolve(trimmed.endsWith('/') ? trimmed : `${trimmed}/`);
  }
  if (!detectedPdfAssetsBasePromise) {
    const cdnFallback = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/`;
    if (typeof window === 'undefined' || typeof fetch !== 'function') {
      detectedPdfAssetsBasePromise = Promise.resolve('/pdfjs/');
    } else {
      detectedPdfAssetsBasePromise = fetch('/pdfjs/cmaps/Identity-H.bcmap', { method: 'HEAD' })
        .then((res) => {
          const ct = (res.headers.get('content-type') || '').toLowerCase();
          return res.ok && !ct.includes('text/html') ? '/pdfjs/' : cdnFallback;
        })
        .catch(() => cdnFallback);
    }
  }
  return detectedPdfAssetsBasePromise;
}

function resolveBookFileUrl(
  book: Pick<VaultBook, 'id' | 'sourceUrl'>,
  apiBaseUrl?: string,
  hasBackend = true
): string {
  if (hasBackend) {
    return joinApiUrl(apiBaseUrl, `/api/vault/${encodeURIComponent(book.id)}/file`);
  }
  return book.sourceUrl || joinApiUrl(apiBaseUrl, `/api/vault/${encodeURIComponent(book.id)}/file`);
}

export interface BookKeeperPaletteEntry {
  id: BookKeeperColor;
  label: string;
  edge: string;
  hi: string;
  mid: string;
  sheen: string;
  text: string;
  swatch: string;
  buttonBg: string;
  buttonBorder: string;
  buttonMutedText: string;
  jumpBg: string;
  jumpText: string;
  glow: string;
}

export const BOOK_KEEPER_PALETTE: Record<BookKeeperColor, BookKeeperPaletteEntry> = {
  crimson: {
    id: 'crimson',
    label: 'Crimson Silk',
    edge: '#7f1d1d',
    hi: '#dc2626',
    mid: '#b91c1c',
    sheen: 'rgba(255, 220, 220, 0.35)',
    text: '#fff5f5',
    swatch: '#dc2626',
    buttonBg: '#b91c1c',
    buttonBorder: 'rgba(252, 165, 165, 0.42)',
    buttonMutedText: '#fca5a5',
    jumpBg: 'rgba(127, 29, 29, 0.78)',
    jumpText: '#fecaca',
    glow: '0 6px 18px rgba(185, 28, 28, 0.45)',
  },
  emerald: {
    id: 'emerald',
    label: 'Emerald Silk',
    edge: '#064e3b',
    hi: '#10b981',
    mid: '#059669',
    sheen: 'rgba(209, 250, 229, 0.36)',
    text: '#ecfdf5',
    swatch: '#10b981',
    buttonBg: '#059669',
    buttonBorder: 'rgba(110, 231, 183, 0.44)',
    buttonMutedText: '#6ee7b7',
    jumpBg: 'rgba(6, 78, 59, 0.78)',
    jumpText: '#a7f3d0',
    glow: '0 6px 18px rgba(5, 150, 105, 0.42)',
  },
  sapphire: {
    id: 'sapphire',
    label: 'Sapphire Silk',
    edge: '#1e3a8a',
    hi: '#3b82f6',
    mid: '#1d4ed8',
    sheen: 'rgba(219, 234, 254, 0.38)',
    text: '#eff6ff',
    swatch: '#3b82f6',
    buttonBg: '#1d4ed8',
    buttonBorder: 'rgba(147, 197, 253, 0.44)',
    buttonMutedText: '#93c5fd',
    jumpBg: 'rgba(30, 58, 138, 0.78)',
    jumpText: '#bfdbfe',
    glow: '0 6px 18px rgba(29, 78, 216, 0.45)',
  },
  amber: {
    id: 'amber',
    label: 'Saffron Gold',
    edge: '#78350f',
    hi: '#f59e0b',
    mid: '#d97706',
    sheen: 'rgba(254, 243, 199, 0.42)',
    text: '#fffbeb',
    swatch: '#f59e0b',
    buttonBg: '#d97706',
    buttonBorder: 'rgba(252, 211, 77, 0.46)',
    buttonMutedText: '#fcd34d',
    jumpBg: 'rgba(120, 53, 15, 0.78)',
    jumpText: '#fde68a',
    glow: '0 6px 18px rgba(217, 119, 6, 0.42)',
  },
  violet: {
    id: 'violet',
    label: 'Royal Plum',
    edge: '#4c1d95',
    hi: '#8b5cf6',
    mid: '#6d28d9',
    sheen: 'rgba(237, 233, 254, 0.38)',
    text: '#f5f3ff',
    swatch: '#8b5cf6',
    buttonBg: '#6d28d9',
    buttonBorder: 'rgba(196, 181, 253, 0.44)',
    buttonMutedText: '#c4b5fd',
    jumpBg: 'rgba(76, 29, 149, 0.78)',
    jumpText: '#ddd6fe',
    glow: '0 6px 18px rgba(109, 40, 217, 0.45)',
  },
  teal: {
    id: 'teal',
    label: 'Seafoam Teal',
    edge: '#134e4a',
    hi: '#14b8a6',
    mid: '#0f766e',
    sheen: 'rgba(204, 251, 241, 0.36)',
    text: '#f0fdfa',
    swatch: '#14b8a6',
    buttonBg: '#0f766e',
    buttonBorder: 'rgba(94, 234, 212, 0.42)',
    buttonMutedText: '#5eead4',
    jumpBg: 'rgba(19, 78, 74, 0.78)',
    jumpText: '#99f6e4',
    glow: '0 6px 18px rgba(15, 118, 110, 0.44)',
  },
};

export const BOOK_KEEPER_COLORS: BookKeeperColor[] = [
  'crimson',
  'emerald',
  'sapphire',
  'amber',
  'violet',
  'teal',
];

function isValidBookKeeperColor(val: unknown): val is BookKeeperColor {
  return typeof val === 'string' && val in BOOK_KEEPER_PALETTE;
}

export function getDefaultBookKeeperColor(bookId: string): BookKeeperColor {
  let hash = 2166136261;
  for (let i = 0; i < bookId.length; i++) {
    hash ^= bookId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return BOOK_KEEPER_COLORS[Math.abs(hash) % BOOK_KEEPER_COLORS.length];
}

export function resolveBookKeeperColor(
  bookId: string,
  explicitColor?: BookKeeperColor | null
): BookKeeperColor {
  return isValidBookKeeperColor(explicitColor)
    ? explicitColor
    : getDefaultBookKeeperColor(bookId);
}

export function getBookKeeperRibbonStyle(color: BookKeeperColor): React.CSSProperties {
  const palette = BOOK_KEEPER_PALETTE[color] || BOOK_KEEPER_PALETTE.crimson;
  return {
    '--keeper-edge': palette.edge,
    '--keeper-hi': palette.hi,
    '--keeper-mid': palette.mid,
    '--keeper-sheen': palette.sheen,
    '--keeper-text': palette.text,
  } as React.CSSProperties;
}

export interface BookProgressState {
  lastPage: number;
  totalPages: number | null;
  bookmarkedPage: number | null;
  keeperColor: BookKeeperColor | null;
  readingStatus: ReadingStatus;
  updatedAt: string;
}

const PROGRESS_STORAGE_PREFIX = 'folio-bookkeeper-v1:';

export function readLocalBookProgress(bookId: string): BookProgressState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${PROGRESS_STORAGE_PREFIX}${bookId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BookProgressState>;
    if (!parsed || typeof parsed !== 'object') return null;
    const lastPage =
      typeof parsed.lastPage === 'number' && Number.isFinite(parsed.lastPage) && parsed.lastPage >= 1
        ? Math.floor(parsed.lastPage)
        : 1;
    const totalPages =
      typeof parsed.totalPages === 'number' && Number.isFinite(parsed.totalPages) && parsed.totalPages >= 1
        ? Math.floor(parsed.totalPages)
        : null;
    const bookmarkedPage =
      typeof parsed.bookmarkedPage === 'number' &&
      Number.isFinite(parsed.bookmarkedPage) &&
      parsed.bookmarkedPage >= 1
        ? Math.floor(parsed.bookmarkedPage)
        : null;
    const keeperColor = isValidBookKeeperColor(parsed.keeperColor) ? parsed.keeperColor : null;
    const readingStatus: ReadingStatus =
      parsed.readingStatus === 'reading' ||
      parsed.readingStatus === 'completed' ||
      parsed.readingStatus === 'unread'
        ? parsed.readingStatus
        : 'unread';
    return {
      lastPage,
      totalPages,
      bookmarkedPage,
      keeperColor,
      readingStatus,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}

export function saveLocalBookProgress(bookId: string, state: BookProgressState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${PROGRESS_STORAGE_PREFIX}${bookId}`, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

export function resolveBookProgress(book: VaultBook): BookProgressState {
  const local = readLocalBookProgress(book.id);
  const serverLastPage =
    typeof book.lastPage === 'number' && Number.isFinite(book.lastPage) && book.lastPage >= 1
      ? Math.floor(book.lastPage)
      : 1;
  const serverBookmark =
    typeof book.bookmarkedPage === 'number' &&
    Number.isFinite(book.bookmarkedPage) &&
    book.bookmarkedPage >= 1
      ? Math.floor(book.bookmarkedPage)
      : null;
  const serverTotal =
    typeof book.totalPages === 'number' && Number.isFinite(book.totalPages) && book.totalPages >= 1
      ? Math.floor(book.totalPages)
      : null;
  const serverColor = isValidBookKeeperColor(book.keeperColor) ? book.keeperColor : null;
  const serverUpdatedAt = typeof book.lastReadAt === 'string' ? book.lastReadAt : '';

  if (local) {
    const localTime = Date.parse(local.updatedAt || '');
    const serverTime = Date.parse(serverUpdatedAt || '');
    if (
      !Number.isNaN(localTime) &&
      (Number.isNaN(serverTime) || localTime >= serverTime)
    ) {
      return {
        ...local,
        keeperColor: local.keeperColor ?? serverColor,
      };
    }
  }

  return {
    lastPage: serverLastPage,
    totalPages: serverTotal,
    bookmarkedPage: serverBookmark,
    keeperColor: serverColor ?? local?.keeperColor ?? null,
    readingStatus: book.readingStatus || 'unread',
    updatedAt: serverUpdatedAt,
  };
}

export function getKeptPage(progress: BookProgressState): number | null {
  if (progress.bookmarkedPage && progress.bookmarkedPage >= 1) {
    return progress.bookmarkedPage;
  }
  if (progress.lastPage >= 2) {
    return progress.lastPage;
  }
  return null;
}

export function getBookKeptPage(book: VaultBook): number | null {
  return getKeptPage(resolveBookProgress(book));
}

export function getBookKeeperColor(book: VaultBook): BookKeeperColor {
  const progress = resolveBookProgress(book);
  return resolveBookKeeperColor(book.id, progress.keeperColor);
}

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

const BINDING_THEME_CACHE_PREFIX = 'folio-binding-theme-v1:';
const memoryBindingThemeCache = new Map<string, BookBindingTheme>();
let sharedThemeSampleCanvas: HTMLCanvasElement | null = null;
let sharedThemeSampleCtx: CanvasRenderingContext2D | null = null;

function clampBindingNum(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function bindingRgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: h * 60, s, l };
}

function bindingHslToRgb(hDeg: number, sPct: number, lPct: number): [number, number, number] {
  const h = (((hDeg % 360) + 360) % 360) / 360;
  const s = clampBindingNum(sPct / 100, 0, 1);
  const l = clampBindingNum(lPct / 100, 0, 1);
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

function bindingHslToHex(hDeg: number, sPct: number, lPct: number): string {
  const [r, g, b] = bindingHslToRgb(hDeg, sPct, lPct);
  const toHex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function bindingHslToRgba(hDeg: number, sPct: number, lPct: number, alpha: number): string {
  const [r, g, b] = bindingHslToRgb(hDeg, sPct, lPct);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildCompatibleBookTheme(hDeg: number, sPct: number, lPct: number): BookBindingTheme {
  const h = ((hDeg % 360) + 360) % 360;
  const s = clampBindingNum(sPct, 6, 78);
  const l = clampBindingNum(lPct, 14, 52);
  const isWarm = h < 68 || h >= 315;
  return {
    primaryHex: bindingHslToHex(h, s, l),
    spineEdge: bindingHslToHex(h, clampBindingNum(s * 0.96, 8, 78), clampBindingNum(l * 0.48, 7, 26)),
    spineHi: bindingHslToHex(h, clampBindingNum(s * 0.84, 10, 72), clampBindingNum(l * 1.48, 22, 62)),
    spineMid: bindingHslToHex(h, clampBindingNum(s * 0.92, 10, 75), clampBindingNum(l * 0.96, 14, 46)),
    spineDeep: bindingHslToHex(h, clampBindingNum(s * 0.98, 8, 78), clampBindingNum(l * 0.38, 6, 22)),
    spineBandHi: isWarm
      ? bindingHslToRgba(42, clampBindingNum(s * 0.55, 18, 48), 84, 0.42)
      : bindingHslToRgba(h, clampBindingNum(s * 0.42, 14, 38), 86, 0.4),
    spineBandLo: bindingHslToRgba(h, clampBindingNum(s * 0.85, 12, 62), clampBindingNum(l * 0.25, 5, 14), 0.58),
    backHi: bindingHslToHex(h, clampBindingNum(s * 0.9, 10, 72), clampBindingNum(l * 1.12, 16, 52)),
    backLo: bindingHslToHex(h, clampBindingNum(s * 0.95, 8, 76), clampBindingNum(l * 0.52, 8, 28)),
    coverBg: bindingHslToHex(h, clampBindingNum(s * 0.88, 8, 72), clampBindingNum(l * 0.64, 10, 32)),
    boardHi: bindingHslToHex(h, clampBindingNum(s * 0.72, 8, 56), clampBindingNum(l * 0.66, 11, 29)),
    boardLo: bindingHslToHex(h, clampBindingNum(s * 0.78, 6, 60), clampBindingNum(l * 0.34, 6, 16)),
    boardBorder: bindingHslToRgba(h, clampBindingNum(s * 0.58, 12, 58), clampBindingNum(l * 1.65, 58, 84), 0.24),
  };
}

export function getCachedBookBindingTheme(bookId: string, sizeBytes: number): BookBindingTheme | null {
  const key = `${bookId}:${sizeBytes}`;
  const mem = memoryBindingThemeCache.get(key);
  if (mem) return mem;
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${BINDING_THEME_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<BookBindingTheme>;
    if (
      parsed &&
      typeof parsed.spineHi === 'string' &&
      typeof parsed.backHi === 'string' &&
      typeof parsed.boardHi === 'string'
    ) {
      const valid = parsed as BookBindingTheme;
      memoryBindingThemeCache.set(key, valid);
      return valid;
    }
  } catch {
    // Ignore storage read errors
  }
  return null;
}

function analyzeCoverBindingPixels(
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
      if (pixels[idx + 3] < 128) continue;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const { s, l, h } = bindingRgbToHsl(r, g, b);
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

  if (totalWeight === 0) return buildCompatibleBookTheme(191, 38, 22);
  const avgL = totalL / totalWeight;
  const chromaticRatio = totalChromaWeight / totalWeight;
  const spineEdgeChromaRatio = spineEdgeWeight > 0 ? spineEdgeChromaWeight / spineEdgeWeight : 0;

  let bestBin = 0;
  let bestScore = -1;
  for (let i = 0; i < NUM_BINS; i++) {
    const prev = (i + NUM_BINS - 1) % NUM_BINS;
    const next = (i + 1) % NUM_BINS;
    const smoothScore = binChromaScore[i] + (binChromaScore[prev] + binChromaScore[next]) * 0.35;
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
      const seHsl = bindingRgbToHsl(seR, seG, seB);
      const cRgb = sumScore > 0 ? [sumR / sumScore, sumG / sumScore, sumB / sumScore] : [seR, seG, seB];
      const cHsl = bindingRgbToHsl(cRgb[0], cRgb[1], cRgb[2]);
      const hueDiff = Math.abs(((seHsl.h - cHsl.h + 540) % 360) - 180);
      if (hueDiff < 45 && sumScore > 0) {
        const boost = sumScore * 0.35;
        sumScore += boost;
        sumR += seR * boost;
        sumG += seG * boost;
        sumB += seB * boost;
      }
    }
    if (sumScore > 0) {
      const hsl = bindingRgbToHsl(sumR / sumScore, sumG / sumScore, sumB / sumScore);
      const isLightCoverWithAccent = avgL > 0.68;
      return buildCompatibleBookTheme(
        hsl.h,
        isLightCoverWithAccent ? clampBindingNum(hsl.s * 100, 34, 72) : clampBindingNum(hsl.s * 100, 22, 76),
        isLightCoverWithAccent ? clampBindingNum(hsl.l * 100, 28, 43) : clampBindingNum(hsl.l * 100, 18, 48)
      );
    }
  }

  const avgHsl = bindingRgbToHsl(totalR / totalWeight, totalG / totalWeight, totalB / totalWeight);
  if (avgL < 0.3) {
    return buildCompatibleBookTheme(
      avgHsl.s > 0.04 ? avgHsl.h : 200,
      clampBindingNum(avgHsl.s * 100, 8, 22),
      clampBindingNum(avgL * 90 + 6, 15, 25)
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
    clampBindingNum(avgHsl.s * 100, 10, 24),
    clampBindingNum(avgL * 78, 22, 40)
  );
}

export function extractBookBindingThemeFromImage(
  img: HTMLImageElement,
  bookId: string,
  sizeBytes: number
): BookBindingTheme | null {
  const key = `${bookId}:${sizeBytes}`;
  const cached = getCachedBookBindingTheme(bookId, sizeBytes);
  if (cached) return cached;
  if (typeof document === 'undefined' || !img || !img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
    return null;
  }
  if (!sharedThemeSampleCanvas) {
    sharedThemeSampleCanvas = document.createElement('canvas');
    sharedThemeSampleCanvas.width = 18;
    sharedThemeSampleCanvas.height = 24;
    sharedThemeSampleCtx = sharedThemeSampleCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!sharedThemeSampleCtx) return null;
  try {
    sharedThemeSampleCtx.clearRect(0, 0, sharedThemeSampleCanvas.width, sharedThemeSampleCanvas.height);
    sharedThemeSampleCtx.drawImage(img, 0, 0, sharedThemeSampleCanvas.width, sharedThemeSampleCanvas.height);
    const data = sharedThemeSampleCtx.getImageData(
      0,
      0,
      sharedThemeSampleCanvas.width,
      sharedThemeSampleCanvas.height
    ).data;
    const theme = analyzeCoverBindingPixels(
      data,
      sharedThemeSampleCanvas.width,
      sharedThemeSampleCanvas.height
    );
    memoryBindingThemeCache.set(key, theme);
    try {
      window.localStorage.setItem(`${BINDING_THEME_CACHE_PREFIX}${key}`, JSON.stringify(theme));
    } catch {
      // Ignore storage quota errors
    }
    return theme;
  } catch {
    return null;
  }
}

export function getBookBindingCssVars(
  theme?: BookBindingTheme | null
): React.CSSProperties | undefined {
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
  } as React.CSSProperties;
}

type VisibilityCallback = (visible: boolean) => void;

const visibilityListeners = new Map<Element, VisibilityCallback>();
let sharedVisibilityObserver: IntersectionObserver | null = null;

function getVisibilityObserver(): IntersectionObserver | null {
  if (typeof window === 'undefined' || typeof IntersectionObserver === 'undefined') {
    return null;
  }
  if (!sharedVisibilityObserver) {
    sharedVisibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const cb = visibilityListeners.get(entry.target);
          if (cb) {
            cb(entry.isIntersecting);
          }
        }
      },
      { rootMargin: '220px 0px', threshold: 0.01 }
    );
  }
  return sharedVisibilityObserver;
}

function observeElementVisibility(
  el: Element,
  callback: VisibilityCallback
): () => void {
  const observer = getVisibilityObserver();
  if (!observer) {
    callback(true);
    return () => {};
  }
  visibilityListeners.set(el, callback);
  observer.observe(el);
  return () => {
    visibilityListeners.delete(el);
    observer.unobserve(el);
  };
}

const COVER_DB_NAME = 'folio-cover-cache-v4';
const COVER_STORE_NAME = 'covers';
const coverMemoryCache = new Map<string, string>();
const coverInFlight = new Map<string, Promise<string>>();

interface CoverQueueJob {
  cacheKey: string;
  bookId: string;
  pdfUrl: string;
  apiBaseUrl?: string;
  pdfAssetsBaseUrl?: string;
  hasBackend: boolean;
  resolve: (url: string) => void;
  reject: (err: unknown) => void;
}

const coverJobQueue: CoverQueueJob[] = [];
let coverActiveWorkers = 0;
const MAX_COVER_CONCURRENCY = 2;

function makeCoverCacheKey(bookId: string, sizeBytes: number): string {
  return `${bookId}:${sizeBytes}`;
}

function getCachedPdfCoverSync(bookId: string, sizeBytes: number): string | null {
  return coverMemoryCache.get(makeCoverCacheKey(bookId, sizeBytes)) || null;
}

function openCoverDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(COVER_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(COVER_STORE_NAME)) {
          db.createObjectStore(COVER_STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readCoverFromDb(key: string): Promise<string | null> {
  const db = await openCoverDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(COVER_STORE_NAME, 'readonly');
      const store = tx.objectStore(COVER_STORE_NAME);
      const req = store.get(key);
      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function writeCoverToDb(key: string, value: string): Promise<void> {
  const db = await openCoverDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(COVER_STORE_NAME, 'readwrite');
      const store = tx.objectStore(COVER_STORE_NAME);
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
  const step = 16;
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

async function renderCoverFromPdf(pdfUrl: string, pdfAssetsBaseUrl?: string): Promise<string> {
  const assetsBase = await resolvePdfAssetsBase(pdfAssetsBaseUrl);
  const loadingTask = pdfjsLib.getDocument({
    url: pdfUrl,
    wasmUrl: `${assetsBase}wasm/`,
    cMapUrl: `${assetsBase}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assetsBase}standard_fonts/`,
    iccUrl: `${assetsBase}iccs/`,
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

async function persistCoverToServer(
  bookId: string,
  dataUrl: string,
  apiBaseUrl?: string
): Promise<void> {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (blob.size < 400 || blob.size > 300 * 1024) return;
    await fetch(joinApiUrl(apiBaseUrl, `/api/vault/${encodeURIComponent(bookId)}/cover`), {
      method: 'POST',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    });
  } catch {
    // Non-critical server warm-up
  }
}

function pumpCoverQueue() {
  while (coverActiveWorkers < MAX_COVER_CONCURRENCY && coverJobQueue.length > 0) {
    const job = coverJobQueue.shift();
    if (!job) break;
    coverActiveWorkers += 1;
    renderCoverFromPdf(job.pdfUrl, job.pdfAssetsBaseUrl)
      .then((dataUrl) => {
        coverMemoryCache.set(job.cacheKey, dataUrl);
        void writeCoverToDb(job.cacheKey, dataUrl);
        if (job.hasBackend) {
          void persistCoverToServer(job.bookId, dataUrl, job.apiBaseUrl);
        }
        job.resolve(dataUrl);
      })
      .catch((err) => {
        job.reject(err);
      })
      .finally(() => {
        coverActiveWorkers -= 1;
        pumpCoverQueue();
      });
  }
}

async function getOrRenderPdfCover(
  bookId: string,
  sizeBytes: number,
  prioritize = false,
  options?: { pdfUrl?: string; apiBaseUrl?: string; pdfAssetsBaseUrl?: string; hasBackend?: boolean }
): Promise<string> {
  const cacheKey = makeCoverCacheKey(bookId, sizeBytes);
  const mem = coverMemoryCache.get(cacheKey);
  if (mem) return mem;

  const existingPromise = coverInFlight.get(cacheKey);
  if (existingPromise) return existingPromise;

  const apiBaseUrl = options?.apiBaseUrl;
  const pdfAssetsBaseUrl = options?.pdfAssetsBaseUrl;
  const hasBackend = options?.hasBackend ?? true;
  const pdfUrl =
    options?.pdfUrl || joinApiUrl(apiBaseUrl, `/api/vault/${encodeURIComponent(bookId)}/file`);

  const promise = (async () => {
    const cachedDb = await readCoverFromDb(cacheKey);
    if (cachedDb) {
      coverMemoryCache.set(cacheKey, cachedDb);
      return cachedDb;
    }

    return await new Promise<string>((resolve, reject) => {
      const job: CoverQueueJob = {
        cacheKey,
        bookId,
        pdfUrl,
        apiBaseUrl,
        pdfAssetsBaseUrl,
        hasBackend,
        resolve,
        reject,
      };
      if (prioritize) {
        coverJobQueue.unshift(job);
      } else {
        coverJobQueue.push(job);
      }
      pumpCoverQueue();
    });
  })().finally(() => {
    coverInFlight.delete(cacheKey);
  });

  coverInFlight.set(cacheKey, promise);
  return promise;
}

interface BgCoverTheme {
  top: string;
  bot: string;
  fg: string;
  ac: string;
}

interface BgCoverDesign {
  theme: BgCoverTheme;
  variant: number;
  face: THREE.MeshPhysicalMaterial | null;
  edge: THREE.MeshStandardMaterial | null;
  tex: THREE.CanvasTexture | null;
}

interface BgFloatingBookEntry {
  mesh: THREE.Group;
  r: number;
  base: THREE.Euler;
  baseY: number;
  amp: number;
  bob: number;
  speed: number;
  phase: number;
  foilMaterial: THREE.ShaderMaterial;
}

const BG_THEMES: BgCoverTheme[] = [
  { top: '#2b363b', bot: '#12181b', fg: '#e8f1f0', ac: '#8fe0cf' },
  { top: '#f7f9f9', bot: '#d6dfe0', fg: '#17302d', ac: '#2e8f86' },
  { top: '#1a6064', bot: '#0a2b2e', fg: '#e2f6f1', ac: '#a8f0dc' },
  { top: '#d3e3f0', bot: '#9ab5cc', fg: '#14283a', ac: '#3b6f9e' },
  { top: '#232c52', bot: '#0b0f25', fg: '#e6e9ff', ac: '#9aa8ff' },
  { top: '#f3ae93', bot: '#d4623f', fg: '#2a120b', ac: '#fff1e8' },
  { top: '#c3d5c1', bot: '#8ba68b', fg: '#142418', ac: '#2f5d3e' },
];

function bgHexToRgba(hex: string, alpha: number): string {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function bgDrawCover(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  th: BgCoverTheme,
  variant: number
) {
  const grd = ctx.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, th.top);
  grd.addColorStop(1, th.bot);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, w, h);

  const cx = w / 2;

  if (variant === 0) {
    const cy = h * 0.42;
    const sph = ctx.createRadialGradient(cx - 14, cy - 14, 4, cx, cy, 78);
    sph.addColorStop(0, bgHexToRgba(th.ac, 1));
    sph.addColorStop(1, bgHexToRgba(th.ac, 0));
    ctx.fillStyle = sph;
    ctx.beginPath();
    ctx.arc(cx, cy, 78, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < 6; k++) {
      ctx.strokeStyle = bgHexToRgba(th.fg, 0.38 - k * 0.05);
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.arc(cx, cy, 70 + k * 34, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = bgHexToRgba(th.fg, 0.9);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(0.9) * 138, cy + Math.sin(0.9) * 138, 5, 0, Math.PI * 2);
    ctx.fill();
  } else if (variant === 1) {
    const hy = h * 0.52;
    const sun = ctx.createLinearGradient(0, hy - 130, 0, hy);
    sun.addColorStop(0, bgHexToRgba(th.ac, 0.95));
    sun.addColorStop(1, bgHexToRgba(th.ac, 0.05));
    ctx.fillStyle = sun;
    ctx.beginPath();
    ctx.arc(cx, hy, 130, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = bgHexToRgba(th.fg, 0.6);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(40, hy);
    ctx.lineTo(w - 40, hy);
    ctx.stroke();
    ctx.lineWidth = 1;
    for (let i = -10; i <= 10; i++) {
      ctx.strokeStyle = bgHexToRgba(th.fg, 0.22);
      ctx.beginPath();
      ctx.moveTo(cx + i * 10, hy);
      ctx.lineTo(cx + i * 70, h * 0.92);
      ctx.stroke();
    }
    for (let k = 1; k <= 9; k++) {
      const yy = hy + Math.pow(k / 9, 2) * (h * 0.4);
      ctx.strokeStyle = bgHexToRgba(th.fg, 0.2);
      ctx.beginPath();
      ctx.moveTo(0, yy);
      ctx.lineTo(w, yy);
      ctx.stroke();
    }
  } else if (variant === 2) {
    for (let k = 0; k < 31; k++) {
      ctx.strokeStyle = bgHexToRgba(
        k % 6 === 0 ? th.ac : th.fg,
        0.16 + (1 - Math.abs(k - 15) / 15) * 0.5
      );
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 60; x <= w - 60; x += 4) {
        const y =
          h * 0.45 +
          (k - 15) * 7 +
          Math.sin(x * 0.018 + k * 0.22) * 40 * (1 - Math.abs(k - 15) / 22);
        if (x === 60) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (variant === 3) {
    const blobs: Array<[number, number, number, string, number]> = [
      [w * 0.3, h * 0.35, 190, th.ac, 0.6],
      [w * 0.72, h * 0.5, 210, th.fg, 0.2],
      [w * 0.45, h * 0.72, 160, th.ac, 0.38],
    ];
    for (const b of blobs) {
      const rg = ctx.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2]);
      rg.addColorStop(0, bgHexToRgba(b[3], b[4]));
      rg.addColorStop(1, bgHexToRgba(b[3], 0));
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.strokeStyle = bgHexToRgba(th.fg, 0.6);
    ctx.lineWidth = 1.5;
    ctx.strokeRect(56, 56, w - 112, h - 112);
  } else if (variant === 4) {
    for (let gx = 40; gx < w - 30; gx += 16) {
      for (let gy = 40; gy < h * 0.82; gy += 16) {
        const dd = Math.hypot(gx - w * 0.7, gy - h * 0.3);
        const rr = Math.max(0, 1 - dd / 380) * 6.2;
        if (rr < 0.4) continue;
        ctx.fillStyle = bgHexToRgba(th.ac, 0.95);
        ctx.beginPath();
        ctx.arc(gx, gy, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    for (let i = 0; i < 44; i++) {
      const bh = 30 + Math.abs(Math.sin(i * 0.5) * Math.cos(i * 0.17)) * 200;
      ctx.fillStyle = i % 7 === 0 ? bgHexToRgba(th.ac, 1) : bgHexToRgba(th.fg, 0.8);
      ctx.fillRect(36 + i * 10, h * 0.42 - bh / 2, 5, bh);
    }
  }

  ctx.strokeStyle = bgHexToRgba(th.fg, 0.5);
  ctx.lineWidth = 1.5;
  const corners: Array<[number, number, number, number]> = [
    [24, 24, 1, 1],
    [w - 24, 24, -1, 1],
    [24, h - 24, 1, -1],
    [w - 24, h - 24, -1, -1],
  ];
  for (const c of corners) {
    ctx.beginPath();
    ctx.moveTo(c[0] + c[2] * 16, c[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(c[0], c[1] + c[3] * 16);
    ctx.stroke();
  }

  ctx.fillStyle = bgHexToRgba(th.ac, 1);
  ctx.fillRect(48, h - 100, 70, 6);
  ctx.fillStyle = bgHexToRgba(th.fg, 0.55);
  ctx.fillRect(48, h - 82, 150, 2);
  ctx.fillStyle = bgHexToRgba(th.fg, 0.35);
  ctx.fillRect(48, h - 72, 110, 2);
  ctx.strokeStyle = bgHexToRgba(th.ac, 0.9);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(w - 74, h - 84, 24, 24);

  for (let i = 0; i < 6000; i++) {
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1, 1);
  }
}

const BG_FOIL_VS = [
  'varying vec2 vUv; varying vec3 vN; varying vec3 vP;',
  'void main(){',
  '  vUv = uv;',
  '  vN = normalize(mat3(modelMatrix) * normal);',
  '  vec4 wp = modelMatrix * vec4(position, 1.0);',
  '  vP = wp.xyz;',
  '  gl_Position = projectionMatrix * viewMatrix * wp;',
  '}',
].join('\n');

const BG_FOIL_FS = [
  'uniform float uTime; uniform float uShape; uniform float uSeed;',
  'uniform vec3 uFogColor; uniform float uFogNear; uniform float uFogFar;',
  'varying vec2 vUv; varying vec3 vN; varying vec3 vP;',
  'vec3 iri(float t){ return 0.5 + 0.5*cos(6.28318*(t + vec3(0.0,0.33,0.67))); }',
  'float ln(float d, float w, float aa){ float ww = max(w, aa); return 1.0 - smoothstep(ww*0.5, ww, abs(d)); }',
  'void main(){',
  '  vec2 p = (vUv - 0.5) * vec2(1.0, 1.25);',
  '  float aa = fwidth(vUv.y) * 1.3;',
  '  float m = 0.0;',
  '  if (uShape < 0.5) {',
  '    float r = length(p - vec2(0.0, 0.1));',
  '    m = ln(r-0.30,0.004,aa) + 0.6*ln(r-0.38,0.003,aa) + 0.4*ln(r-0.22,0.003,aa);',
  '  } else if (uShape < 1.5) {',
  '    vec2 q = p - vec2(0.0, -0.025);',
  '    m = ln(length(q)-0.26,0.004,aa) * step(0.0,q.y);',
  '    m += ln(q.y,0.004,aa) * step(abs(q.x),0.36);',
  '  } else if (uShape < 2.5) {',
  '    float s = 0.08*sin(p.x*9.2 + uSeed*6.0);',
  '    float inX = step(abs(p.x),0.34);',
  '    m = ln(p.y-0.0625-s,0.004,aa)*inX + 0.5*ln(p.y+0.0125-s,0.003,aa)*inX;',
  '  } else if (uShape < 3.5) {',
  '    float d = max(abs(p.x)-0.39, abs(p.y)-0.516);',
  '    m = ln(d,0.005,aa);',
  '  } else if (uShape < 4.5) {',
  '    float d = p.x*0.8 + p.y*0.6 + 0.15;',
  '    m = ln(d,0.004,aa)*step(abs(p.x),0.4)*step(abs(p.y),0.55);',
  '    m += ln(length(p-vec2(0.2,0.25))-0.06,0.003,aa);',
  '  } else {',
  '    m = ln(p.y+0.17,0.005,aa)*step(abs(p.x),0.43) + ln(p.y-0.37,0.003,aa)*step(abs(p.x),0.43)*0.6;',
  '  }',
  '  m += ln(length(p-vec2(0.34,0.54))-0.025,0.003,aa);',
  '  vec3 N = normalize(vN);',
  '  vec3 V = normalize(cameraPosition - vP);',
  '  float f = pow(1.0 - abs(dot(N,V)), 1.5);',
  '  float hue = f*1.1 + p.x*0.5 + p.y*0.35 + uTime*0.05 + uSeed;',
  '  vec3 col = mix(iri(hue), vec3(1.0), 0.2);',
  '  col = pow(col, vec3(2.2));',
  '  float a = clamp(m,0.0,1.0) * (0.7 + 0.3*f);',
  '  a *= 1.0 - smoothstep(uFogNear, uFogFar, length(cameraPosition - vP));',
  '  gl_FragColor = vec4(col, a);',
  '  #include <tonemapping_fragment>',
  '  #include <colorspace_fragment>',
  '}',
].join('\n');

const _bgLookTarget = new THREE.Vector3(0, 0, 0);
const _bgDrawSize = new THREE.Vector2();

function detectSoftwareWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return false;
  }
}

export function FloatingBooksBackground({ paused = false }: { paused?: boolean } = {}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(paused);
  const resumeLoopRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
    if (!paused) {
      resumeLoopRef.current?.();
    }
  }, [paused]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowPower =
      Math.min(window.innerWidth, window.innerHeight) < 700 ||
      /Mobi|Android/i.test(navigator.userAgent);
    const isSoftwareGl = detectSoftwareWebGL();

    const fogColor = new THREE.Color(0x0d191c);
    const fogNear = 8;
    const fogFar = 15;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      return;
    }

    renderer.setPixelRatio(
      isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, lowPower ? 1.5 : 2)
    );
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.autoClear = false;
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(0, 0, 10);

    const bgScene = new THREE.Scene();
    const bgCam = new THREE.Camera();
    const bgMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRes: { value: new THREE.Vector2(1, 1) },
        uMouse: { value: new THREE.Vector2(0, 0) },
      },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: [
        'uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse;',
        'float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }',
        'float noise(vec2 p){',
        '  vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
        '  return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x), mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x), f.y);',
        '}',
        'void main(){',
        '  vec2 uv = gl_FragCoord.xy / uRes;',
        '  float asp = uRes.x / uRes.y;',
        '  vec2 p = vec2(uv.x*asp, uv.y);',
        '  vec3 edge = vec3(0.024,0.047,0.055);',
        '  vec3 mid  = vec3(0.051,0.098,0.110);',
        '  vec3 hi   = vec3(0.094,0.165,0.180);',
        '  float d = length((uv - vec2(0.68,0.5)) * vec2(asp,1.0));',
        '  vec3 col = mix(hi, mid, smoothstep(0.0,0.58,d));',
        '  col = mix(col, edge, smoothstep(0.45,1.25,d));',
        '  float n1 = noise(p*1.5 + vec2(uTime*0.02,-uTime*0.015) + uMouse*0.3);',
        '  float n2 = noise(p*2.8 - vec2(uTime*0.018, uTime*0.010));',
        '  col = mix(col, vec3(0.07,0.23,0.22), smoothstep(0.46,0.86,n1)*0.36);',
        '  col = mix(col, vec3(0.08,0.15,0.27), smoothstep(0.52,0.88,n2)*0.28);',
        '  col *= 1.0 - 0.22*smoothstep(0.45,1.2,length((uv-0.5)*vec2(asp,1.0)));',
        '  col += (hash(gl_FragCoord.xy) - 0.5) * 0.022;',
        '  gl_FragColor = vec4(col, 1.0);',
        '}',
      ].join('\n'),
      depthTest: false,
      depthWrite: false,
    });
    const bgGeo = new THREE.PlaneGeometry(2, 2);
    const bgQuad = new THREE.Mesh(bgGeo, bgMat);
    bgQuad.frustumCulled = false;
    bgScene.add(bgQuad);

    const envScene = new THREE.Scene();
    const skyGeo = new THREE.SphereGeometry(30, 32, 16);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader:
        'varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: [
        'varying float vY;',
        'void main(){',
        '  vec3 top = vec3(0.75,0.88,0.89);',
        '  vec3 hor = vec3(0.22,0.32,0.34);',
        '  vec3 bot = vec3(0.04,0.06,0.08);',
        '  vec3 c = vY > 0.0 ? mix(hor, top, pow(vY,0.65)) : mix(hor, bot, pow(-vY,0.65));',
        '  gl_FragColor = vec4(c, 1.0);',
        '}',
      ].join('\n'),
    });
    envScene.add(new THREE.Mesh(skyGeo, skyMat));

    const softboxDisposables: Array<{ geo: THREE.PlaneGeometry; mat: THREE.MeshBasicMaterial }> = [];
    const addSoftbox = (
      w: number,
      h: number,
      x: number,
      y: number,
      z: number,
      r: number,
      g: number,
      b: number
    ) => {
      const geo = new THREE.PlaneGeometry(w, h);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(r, g, b),
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.lookAt(0, 0, 0);
      envScene.add(m);
      softboxDisposables.push({ geo, mat });
    };
    addSoftbox(16, 7, 0, 16, 6, 4.0, 4.0, 4.0);
    addSoftbox(7, 12, 16, 4, 8, 2.2, 3.4, 3.2);
    addSoftbox(5, 14, -16, 2, -6, 2.6, 2.6, 3.0);
    addSoftbox(18, 3, 0, -12, 4, 1.2, 1.3, 1.3);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(envScene, 0.02);
    scene.environment = envTarget.texture;
    pmrem.dispose();
    skyGeo.dispose();
    skyMat.dispose();
    for (const s of softboxDisposables) {
      s.geo.dispose();
      s.mat.dispose();
    }

    scene.add(new THREE.HemisphereLight(0xdaf0ef, 0x0d191c, 0.36));

    const key = new THREE.DirectionalLight(0xfff1dc, 1.18);
    key.position.set(8, 12, 14);
    key.castShadow = !isSoftwareGl;
    const sm = lowPower ? 1024 : 2048;
    key.shadow.mapSize.set(sm, sm);
    key.shadow.camera.left = -9;
    key.shadow.camera.right = 9;
    key.shadow.camera.top = 9;
    key.shadow.camera.bottom = -9;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 50;
    key.shadow.bias = -0.0004;
    key.shadow.radius = 4;
    scene.add(key);

    const maxAniso = renderer.capabilities.getMaxAnisotropy();

    function canvasTexture(
      w: number,
      h: number,
      draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
    ): THREE.CanvasTexture {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (ctx) {
        draw(ctx, w, h);
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = Math.min(8, maxAniso);
      return tex;
    }

    function pagesTexture(vertical: boolean): THREE.CanvasTexture {
      return canvasTexture(256, 256, (g, w, h) => {
        g.fillStyle = '#f3eee2';
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 90; i++) {
          const p = Math.random() * (vertical ? w : h);
          g.fillStyle = `rgba(120,105,80,${0.05 + Math.random() * 0.1})`;
          if (vertical) g.fillRect(p, 0, 1, h);
          else g.fillRect(0, p, w, 1);
        }
        const sh = g.createLinearGradient(0, 0, vertical ? w : 0, vertical ? 0 : h);
        sh.addColorStop(0, 'rgba(0,0,0,0.12)');
        sh.addColorStop(0.5, 'rgba(0,0,0,0)');
        sh.addColorStop(1, 'rgba(0,0,0,0.12)');
        g.fillStyle = sh;
        g.fillRect(0, 0, w, h);
      });
    }

    const CW = 512;
    const CH = 640;
    const designs: BgCoverDesign[] = [];
    for (let di = 0; di < 12; di++) {
      designs.push({
        theme: BG_THEMES[di % BG_THEMES.length],
        variant: (di * 5 + Math.floor(di / 7) * 2) % 6,
        face: null,
        edge: null,
        tex: null,
      });
    }

    function ensureDesign(d: BgCoverDesign) {
      if (d.face && d.edge) return d;
      const tex = canvasTexture(CW, CH, (g, w, h) => bgDrawCover(g, w, h, d.theme, d.variant));
      d.tex = tex;
      d.face = new THREE.MeshPhysicalMaterial({
        map: tex,
        roughness: 0.38,
        metalness: 0.0,
        clearcoat: 0.85,
        clearcoatRoughness: 0.18,
        envMapIntensity: 0.9,
      });
      d.edge = new THREE.MeshStandardMaterial({
        color: Number.parseInt(d.theme.bot.slice(1), 16),
        roughness: 0.45,
        metalness: 0.15,
        envMapIntensity: 0.8,
      });
      return d;
    }

    const sharedTimeUniform = { value: 0 };
    const sharedFogColorUniform = { value: fogColor };
    const sharedFogNearUniform = { value: fogNear };
    const sharedFogFarUniform = { value: fogFar };

    function foilMaterial(shape: number, seed: number): THREE.ShaderMaterial {
      return new THREE.ShaderMaterial({
        uniforms: {
          uTime: sharedTimeUniform,
          uShape: { value: shape },
          uSeed: { value: seed },
          uFogColor: sharedFogColorUniform,
          uFogNear: sharedFogNearUniform,
          uFogFar: sharedFogFarUniform,
        },
        vertexShader: BG_FOIL_VS,
        fragmentShader: BG_FOIL_FS,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
    }

    const W = 2.4;
    const H = 3;
    const D = 0.72;

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xdfe6e6,
      roughness: 0.22,
      metalness: 1.0,
      envMapIntensity: 1.1,
    });
    const pageTexV = pagesTexture(true);
    const pageTexH = pagesTexture(false);
    const pageEdge = new THREE.MeshStandardMaterial({
      color: 0xece6d8,
      roughness: 0.95,
      envMapIntensity: 0.4,
    });
    const pageV = new THREE.MeshStandardMaterial({
      map: pageTexV,
      roughness: 0.95,
      envMapIntensity: 0.4,
    });
    const pageH = new THREE.MeshStandardMaterial({
      map: pageTexH,
      roughness: 0.95,
      envMapIntensity: 0.4,
    });
    const pageMats = [pageEdge, pageV, pageH, pageH, pageEdge, pageEdge];

    const coverGeo = new THREE.BoxGeometry(W, H, 0.06);
    const spineGeo = new THREE.BoxGeometry(0.07, H, D + 0.06);
    const pagesGeo = new THREE.BoxGeometry(W - 0.12, H - 0.18, D - 0.04);
    const bandGeo = new THREE.BoxGeometry(0.085, 0.045, D + 0.07);
    const foilGeo = new THREE.PlaneGeometry(W, H);

    function createBook(design: BgCoverDesign): { group: THREE.Group; foilMat: THREE.ShaderMaterial } {
      const d = ensureDesign(design);
      const group = new THREE.Group();
      const faceMat = d.face!;
      const edgeMat = d.edge!;

      const front = new THREE.Mesh(coverGeo, [edgeMat, edgeMat, edgeMat, edgeMat, faceMat, edgeMat]);
      const back = new THREE.Mesh(coverGeo, [edgeMat, edgeMat, edgeMat, edgeMat, edgeMat, faceMat]);
      front.position.z = D / 2;
      back.position.z = -D / 2;

      const spine = new THREE.Mesh(spineGeo, edgeMat);
      spine.position.x = W / 2;

      const pages = new THREE.Mesh(pagesGeo, pageMats);
      pages.position.x = -0.03;

      group.add(front, back, spine, pages);

      for (const y of [0.98, -0.98]) {
        const band = new THREE.Mesh(bandGeo, chromeMat);
        band.position.set(W / 2 + 0.01, y, 0);
        group.add(band);
      }

      group.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) {
          o.castShadow = !isSoftwareGl;
          o.receiveShadow = !isSoftwareGl;
        }
      });

      const seed = Math.random();
      const fm = foilMaterial(d.variant, seed);
      const foilF = new THREE.Mesh(foilGeo, fm);
      foilF.position.z = D / 2 + 0.034;
      const foilB = new THREE.Mesh(foilGeo, fm);
      foilB.position.z = -(D / 2 + 0.034);
      foilB.rotation.y = Math.PI;
      group.add(foilF, foilB);

      return { group, foilMat: fm };
    }

    const cluster = new THREE.Group();
    scene.add(cluster);

    const books: BgFloatingBookEntry[] = [];
    const COUNT = lowPower ? 22 : 38;

    function tooClose(pos: THREE.Vector3, r: number): boolean {
      for (let i = 0; i < books.length; i++) {
        if (pos.distanceTo(books[i].mesh.position) < (r + books[i].r) * 1.7) {
          return true;
        }
      }
      return false;
    }

    const candidatePos = new THREE.Vector3();
    for (let n = 0; n < COUNT; n++) {
      const { group: mesh, foilMat } = createBook(
        designs[Math.floor(Math.random() * designs.length)]
      );
      const s = 0.12 + Math.pow(Math.random(), 1.4) * 0.32;
      mesh.scale.set(s, s, s * (0.8 + Math.random() * 0.7));

      const r = s * 1.9;
      let tries = 0;
      do {
        candidatePos.set(
          (Math.random() - 0.5) * 13,
          (Math.random() - 0.5) * 7.4,
          (Math.random() - 0.5) * 6.4
        );
        tries++;
      } while (tooClose(candidatePos, r) && tries < 100);

      mesh.position.copy(candidatePos);
      mesh.rotation.set(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      cluster.add(mesh);
      books.push({
        mesh,
        r,
        base: mesh.rotation.clone(),
        baseY: candidatePos.y,
        amp: 0.15 + Math.random() * 0.35,
        bob: 0.05 + Math.random() * 0.12,
        speed: 0.15 + Math.random() * 0.25,
        phase: Math.random() * Math.PI * 2,
        foilMaterial: foilMat,
      });
    }

    function layout() {
      const w = window.innerWidth;
      const h = window.innerHeight;
      renderer.setSize(w, h, false);
      renderer.getDrawingBufferSize(_bgDrawSize);
      bgMat.uniforms.uRes.value.copy(_bgDrawSize);
      camera.aspect = w / Math.max(1, h);
      const wide = camera.aspect > 1.15;
      cluster.position.x = wide ? 2.0 : 0;
      camera.position.z = wide ? 10 : 13;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', layout);
    layout();

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const mouse = { x: 0, y: 0 };
    const smooth = { x: 0, y: 0 };
    const onPointerMove = (e: PointerEvent) => {
      mouse.x = e.clientX / Math.max(1, window.innerWidth) - 0.5;
      mouse.y = e.clientY / Math.max(1, window.innerHeight) - 0.5;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    let disposed = false;
    let contextLost = false;
    let frameId = 0;
    let loopActive = false;
    let elapsedTime = 0;

    const onContextLost = (e: Event) => {
      e.preventDefault();
      contextLost = true;
    };
    const onContextRestored = () => {
      contextLost = false;
      layout();
      resumeLoop();
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

    const clock = new THREE.Clock();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed || pausedRef.current || document.hidden) {
          loopActive = false;
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function renderFrame() {
      if (disposed) {
        loopActive = false;
        return;
      }
      if (pausedRef.current || document.hidden) {
        loopActive = false;
        return;
      }
      if (!contextLost) {
        const dt = Math.min(0.05, clock.getDelta());
        if (!reduceMotion) {
          elapsedTime += dt;
        }
        const t = reduceMotion ? 0 : elapsedTime;

        smooth.x += (mouse.x - smooth.x) * 0.04;
        smooth.y += (mouse.y - smooth.y) * 0.04;

        sharedTimeUniform.value = t;
        bgMat.uniforms.uTime.value = t;
        bgMat.uniforms.uMouse.value.set(smooth.x, smooth.y);

        camera.position.x = smooth.x * 1.2;
        camera.position.y = -smooth.y * 0.8;
        camera.lookAt(_bgLookTarget);

        cluster.rotation.y = Math.sin(t * 0.05) * 0.35 + smooth.x * 0.25;
        cluster.rotation.x = Math.sin(t * 0.08) * 0.05 - smooth.y * 0.15;
        cluster.position.y = (window.pageYOffset || 0) * 0.0016;

        for (let i = 0; i < books.length; i++) {
          const b = books[i];
          const m = b.mesh;
          const k = t * b.speed + b.phase;
          m.rotation.x = b.base.x + Math.sin(k) * b.amp;
          m.rotation.y = b.base.y + Math.cos(k * 0.8) * b.amp;
          m.rotation.z = b.base.z + Math.sin(k * 0.6) * b.amp * 0.6;
          m.position.y = b.baseY + Math.sin(k * 1.1) * b.bob;
        }

        renderer.clear();
        renderer.render(bgScene, bgCam);
        renderer.clearDepth();
        renderer.render(scene, camera);
      }

      if (isSoftwareGl) {
        afterDraw(renderFrame);
      } else {
        frameId = window.requestAnimationFrame(renderFrame);
      }
    }

    function resumeLoop() {
      if (disposed || loopActive || pausedRef.current || document.hidden) return;
      loopActive = true;
      clock.getDelta();
      renderFrame();
    }

    resumeLoopRef.current = resumeLoop;

    const onVisibilityChange = () => {
      if (!document.hidden && !pausedRef.current) {
        resumeLoop();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    resumeLoop();
    const readyRaf = window.requestAnimationFrame(() => setReady(true));

    return () => {
      disposed = true;
      loopActive = false;
      resumeLoopRef.current = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.cancelAnimationFrame(readyRaf);
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(frameId);
      window.removeEventListener('resize', layout);
      window.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

      coverGeo.dispose();
      spineGeo.dispose();
      pagesGeo.dispose();
      bandGeo.dispose();
      foilGeo.dispose();
      bgGeo.dispose();
      bgMat.dispose();
      chromeMat.dispose();
      pageEdge.dispose();
      pageV.dispose();
      pageH.dispose();
      pageTexV.dispose();
      pageTexH.dispose();
      envTarget.dispose();

      for (const d of designs) {
        d.face?.dispose();
        d.edge?.dispose();
        d.tex?.dispose();
      }
      for (const b of books) {
        b.foilMaterial.dispose();
      }

      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      id="bg"
      aria-hidden="true"
      className={`floating-books-bg ${ready ? 'ready' : ''}`}
    />
  );
}

const loadedCoverUrls = new Set<string>();
const failedServerUrls = new Set<string>();
const unavailableFallbackIds = new Set<string>();

function rememberCoverUrl(target: Set<string>, url: string) {
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
              <rect
                x={-10.5}
                y={0.6}
                width={22}
                height={6.2}
                rx={3.1}
                fill="rgba(0,0,0,0.48)"
              />
              <rect
                x={-11}
                y={-3.3}
                width={22}
                height={6.6}
                rx={3.3}
                fill="#050b0d"
              />
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

function LockedVaultCover({
  breaking,
  rattling,
}: {
  breaking: boolean;
  rattling: boolean;
}) {
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
        breaking ? 'vault-chain-breaking' : rattling ? 'vault-chain-rattling' : ''
      }`}
    >
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

        <g
          className={`vault-locker-group ${
            breaking ? 'vault-locker-breaking' : rattling ? 'vault-locker-rattling' : ''
          }`}
        >
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

          <g>
            <circle cx={68} cy={164} r={7.2} fill="none" stroke="#060d0f" strokeWidth={6} />
            <circle cx={68} cy={164} r={7.2} fill="none" stroke={`url(#${steelGradId})`} strokeWidth={3.4} />
            <circle cx={132} cy={164} r={7.2} fill="none" stroke="#060d0f" strokeWidth={6} />
            <circle cx={132} cy={164} r={7.2} fill="none" stroke={`url(#${steelGradId})`} strokeWidth={3.4} />
          </g>

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
            <path
              d="M 81.2 124 L 81.2 107 A 18.8 18.8 0 0 1 108 90.2"
              fill="none"
              stroke="rgba(244,254,254,0.72)"
              strokeWidth={1.35}
              strokeLinecap="round"
            />
            <rect x={113} y={120.5} width={4.2} height={3} rx={0.8} fill="#091214" />
          </g>

          <path
            d="M 76 125 L 124 125 L 130 131 L 130 170 L 123 177 L 77 177 L 70 170 L 70 131 Z"
            fill={`url(#${bodyGradId})`}
            stroke="#060d0f"
            strokeWidth={1.6}
            strokeLinejoin="round"
          />
          <path
            d="M 72.5 168.5 L 72.5 132 L 77 127.5 L 122.5 127.5"
            fill="none"
            stroke="rgba(225,248,248,0.36)"
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M 127.5 133 L 127.5 169 L 122 174.5 L 78 174.5"
            fill="none"
            stroke="rgba(0,0,0,0.48)"
            strokeWidth={1.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          <rect x={77.5} y={123.2} width={11} height={4.4} rx={1.6} fill="#1b2c30" stroke="#85a4a9" strokeWidth={0.75} />
          <rect x={111.5} y={123.2} width={11} height={4.4} rx={1.6} fill="#1b2c30" stroke="#85a4a9" strokeWidth={0.75} />

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
          <circle cx={100} cy={148.8} r={2.4} fill="#050809" />
          <path d="M 98.4 150.3 L 101.6 150.3 L 102.4 156.1 L 97.6 156.1 Z" fill="#050809" />
        </g>

        {CHAIN_SPECS.map((spec) => (
          <ChainLinksStrand
            key={spec.id}
            spec={spec}
            steelGradId={steelGradId}
            edgeGradId={edgeGradId}
          />
        ))}
      </svg>

      {breaking ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full border-2 border-[#a7f3ea] bg-[#7fd4cb]/25 shadow-[0_0_24px_rgba(127,212,203,0.75)] vault-shockwave-burst" />
        </div>
      ) : null}
    </div>
  );
}

interface PdfCoverImageProps {
  bookId: string;
  sizeBytes: number;
  title: string;
  coverPath?: string | null;
  sourceUrl?: string | null;
  apiBaseUrl?: string;
  pdfAssetsBaseUrl?: string;
  hasBackend?: boolean;
  priority?: boolean;
  inView?: boolean;
  rattleTrigger?: number;
  onLockedChange?: (locked: boolean) => void;
  onBindingTheme?: (theme: BookBindingTheme) => void;
  className?: string;
}

export function PdfCoverImage({
  bookId,
  sizeBytes,
  title,
  coverPath,
  sourceUrl,
  apiBaseUrl,
  pdfAssetsBaseUrl,
  hasBackend = true,
  priority = false,
  inView = true,
  rattleTrigger = 0,
  onLockedChange,
  onBindingTheme,
  className = '',
}: PdfCoverImageProps) {
  const serverCoverUrl = joinApiUrl(
    apiBaseUrl,
    `/api/vault/${encodeURIComponent(bookId)}/cover?v=5-${sizeBytes}`
  );
  const hasValidAssetCoverProp =
    Boolean(coverPath) &&
    (coverPath!.startsWith('/src/assets/images/') ||
      coverPath!.startsWith('http://') ||
      coverPath!.startsWith('https://') ||
      coverPath!.startsWith('data:'));

  const [fallbackUrl, setFallbackUrl] = useState<string | null>(() =>
    getCachedPdfCoverSync(bookId, sizeBytes)
  );
  const [serverError, setServerError] = useState(() =>
    !hasBackend || failedServerUrls.has(serverCoverUrl)
  );
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
  const [rattling, setRattling] = useState(false);
  const wasReadyRef = useRef(imageReady);
  const onBindingThemeRef = useRef(onBindingTheme);

  useEffect(() => {
    onBindingThemeRef.current = onBindingTheme;
  }, [onBindingTheme]);

  useEffect(() => {
    const cachedTheme = getCachedBookBindingTheme(bookId, sizeBytes);
    if (cachedTheme) {
      onBindingThemeRef.current?.(cachedTheme);
    }
  }, [bookId, sizeBytes]);

  useEffect(() => {
    onLockedChange?.(!imageReady);
  }, [imageReady, onLockedChange]);

  useEffect(() => {
    if (!rattleTrigger || imageReady || breaking) return;
    setHasEnteredView(true);
    setRattling(false);
    const raf = window.requestAnimationFrame(() => {
      setRattling(true);
    });
    const timer = window.setTimeout(() => {
      setRattling(false);
    }, 460);
    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [rattleTrigger, imageReady, breaking]);

  useEffect(() => {
    const cached = getCachedPdfCoverSync(bookId, sizeBytes);
    const nextAssetErr = Boolean(hasValidAssetCoverProp && failedServerUrls.has(coverPath!));
    const nextServerErr = !hasBackend || failedServerUrls.has(serverCoverUrl);
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
    setRattling(false);
    wasReadyRef.current = alreadyLoaded;
  }, [bookId, sizeBytes, coverPath, hasValidAssetCoverProp, serverCoverUrl, hasBackend]);

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
    const pdfUrl = resolveBookFileUrl({ id: bookId, sourceUrl: sourceUrl ?? null }, apiBaseUrl, hasBackend);
    getOrRenderPdfCover(bookId, sizeBytes, priority, { pdfUrl, apiBaseUrl, pdfAssetsBaseUrl, hasBackend })
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
  }, [hasEnteredView, serverError, hasValidAssetCover, fallbackUrl, bookId, sizeBytes, priority, sourceUrl, apiBaseUrl, pdfAssetsBaseUrl, hasBackend]);

  const shouldRenderImg = Boolean(activeSrc) && (hasEnteredView || imageReady);
  const useAnonymousCors = activeSrc === serverCoverUrl && isCrossOriginUrl(activeSrc);

  return (
    <div className={`w-full h-full relative bg-[#0c1619] ${className}`}>
      {shouldRenderImg ? (
        <img
          src={activeSrc!}
          alt={title}
          crossOrigin={useAnonymousCors ? 'anonymous' : undefined}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : 'auto'}
          onLoad={(e) => {
            const img = e.currentTarget;
            const src = activeSrc;
            const finish = () => {
              if (!img.isConnected || img.naturalWidth === 0) return;
              if (src) rememberCoverUrl(loadedCoverUrls, src);
              const theme = extractBookBindingThemeFromImage(img, bookId, sizeBytes);
              if (theme) {
                onBindingThemeRef.current?.(theme);
              }
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
              rememberCoverUrl(failedServerUrls, coverPath!);
              setAssetError(true);
            } else if (!serverError) {
              rememberCoverUrl(failedServerUrls, serverCoverUrl);
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
      {!imageReady || breaking ? (
        <LockedVaultCover breaking={breaking} rattling={rattling && !breaking} />
      ) : null}
    </div>
  );
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

function FolioPenCursor({
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
          <circle cx="2.5" cy="2.5" r="2.2" fill={accent.glow} />
          <path
            d="M 2 2 L 15.8 8.2 L 17.6 13.6 L 13.6 17.6 L 8.2 15.8 Z"
            fill={`url(#nib-${uid})`}
            stroke="#734d11"
            strokeWidth="0.7"
            strokeLinejoin="round"
          />
          <path d="M 2.3 2.3 L 10.6 10.6" stroke="#2c1d06" strokeWidth="0.9" strokeLinecap="round" />
          <circle cx="10.9" cy="10.9" r="1.85" fill={accent.jewel} stroke="#231704" strokeWidth="0.5" />
          <circle cx="2.3" cy="2.3" r="0.9" fill={accent.tip} />
          <path
            d="M 13.3 17.8 L 17.8 13.3 L 20.5 16 L 16 20.5 Z"
            fill={`url(#collar-${uid})`}
            stroke="#734d11"
            strokeWidth="0.6"
          />
          <path
            d="M 16.2 20.3 L 20.3 16.2 L 42.2 35.6 C 43.8 37.2, 43.8 39.8, 41.8 41.8 C 39.8 43.8, 37.2 43.8, 35.6 42.2 Z"
            fill={`url(#barrel-${uid})`}
            stroke="rgba(243, 198, 119, 0.36)"
            strokeWidth="0.75"
          />
          <path
            d="M 19.8 18.6 L 38.6 35.8"
            stroke="rgba(255, 255, 255, 0.24)"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          <circle cx="39.5" cy="39.5" r="2.1" fill={`url(#collar-${uid})`} opacity="0.9" />
        </svg>
      </div>
    </div>,
    document.body
  );
}

const PAGE_ANNOTATIONS_PREFIX = 'folio-page-annotations-v1:';

function loadBookAnnotations(bookId: string): PageAnnotation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(`${PAGE_ANNOTATIONS_PREFIX}${bookId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is PageAnnotation =>
          item &&
          typeof item.id === 'string' &&
          typeof item.pageNum === 'number' &&
          (item.type === 'mark' || item.type === 'circle') &&
          typeof item.rx === 'number' &&
          typeof item.ry === 'number'
      )
      .map((item) => ({
        ...item,
        points: Array.isArray(item.points)
          ? item.points.filter(
              (pt): pt is PageAnnotationPoint =>
                Boolean(pt) && typeof pt.x === 'number' && typeof pt.y === 'number'
            )
          : undefined,
      }));
  } catch {
    return [];
  }
}

function saveBookAnnotations(bookId: string, annotations: PageAnnotation[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${PAGE_ANNOTATIONS_PREFIX}${bookId}`,
      JSON.stringify(annotations)
    );
  } catch {
    // Ignore storage quota errors
  }
}

function PageAnnotationsLayer({
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

function SpreadPageSurface({
  src,
  alt,
  annotations,
  freshIds,
  interactiveAnnotations = true,
  draftStroke = null,
  onRemoveAnnotation,
}: {
  src: string;
  alt: string;
  annotations: PageAnnotation[];
  freshIds?: Set<string>;
  interactiveAnnotations?: boolean;
  draftStroke?: { type: 'mark' | 'circle'; points: PageAnnotationPoint[] } | null;
  onRemoveAnnotation: (id: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [boxSize, setBoxSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [aspect, setAspect] = useState(0.77);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const measure = () => {
      const style = window.getComputedStyle(el);
      const padX = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const padY = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.paddingBottom) || 0);
      setBoxSize({
        w: Math.max(0, el.clientWidth - padX),
        h: Math.max(0, el.clientHeight - padY),
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fitStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (boxSize.w <= 0 || boxSize.h <= 0 || aspect <= 0) return undefined;
    let w = boxSize.w;
    let h = w / aspect;
    if (h > boxSize.h) {
      h = boxSize.h;
      w = h * aspect;
    }
    return { width: `${Math.round(w)}px`, height: `${Math.round(h)}px` };
  }, [boxSize.w, boxSize.h, aspect]);

  return (
    <div ref={hostRef} className="w-full h-full p-2 sm:p-3 flex items-center justify-center">
      <div style={fitStyle} className="relative shrink-0">
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(e) => {
            const { naturalWidth, naturalHeight } = e.currentTarget;
            if (naturalWidth > 0 && naturalHeight > 0) {
              setAspect(naturalWidth / naturalHeight);
            }
          }}
          className="w-full h-full object-contain block select-none"
        />
        <PageAnnotationsLayer
          annotations={annotations}
          freshIds={freshIds}
          interactive={interactiveAnnotations}
          draftStroke={draftStroke}
          onRemove={onRemoveAnnotation}
        />
      </div>
    </div>
  );
}

interface TapMenuAnchor {
  pageNum: number;
  rx: number;
  ry: number;
  screenX: number;
  screenY: number;
}

function DoubleTapFabMenu({
  anchor,
  onZoom,
  onMark,
  onCircle,
  onClose,
}: {
  anchor: TapMenuAnchor;
  onZoom: () => void;
  onMark: () => void;
  onCircle: () => void;
  onClose: () => void;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setActive(true);
      });
    });
    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [anchor]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const clampedX = Math.max(92, Math.min(vw - 92, anchor.screenX));
  const clampedY = Math.max(115, Math.min(vh - 46, anchor.screenY));

  const menuContent = (
    <div
      className="fixed inset-0 z-[95]"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        style={{
          position: 'fixed',
          left: `${Math.round(clampedX)}px`,
          top: `${Math.round(clampedY)}px`,
          transform: 'translate(-50%, -50%)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`folio-fab-container ${active ? 'active' : ''}`}
          role="menu"
          aria-label={`Page ${anchor.pageNum} quick options`}
        >
          <span className="folio-fab-ripple" aria-hidden="true" />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Close page options"
            title="Close options"
            className="folio-fab-button"
          >
            <span className="folio-fab-pen" aria-hidden="true">
              <PenTool className="w-[22px] h-[22px]" strokeWidth={2.1} />
            </span>
          </button>

          <div className="folio-fab-options">
            <button
              type="button"
              role="menuitem"
              title="Zoom"
              aria-label="Zoom page"
              onClick={(e) => {
                e.stopPropagation();
                onZoom();
              }}
              className="folio-fab-option folio-fab-opt-zoom"
            >
              <ZoomIn className="w-[18px] h-[18px]" strokeWidth={2.2} />
              <span className="text-[9px] font-semibold leading-none tracking-tight">Zoom</span>
            </button>

            <button
              type="button"
              role="menuitem"
              title="Mark"
              aria-label="Mark highlight on page"
              onClick={(e) => {
                e.stopPropagation();
                onMark();
              }}
              className="folio-fab-option folio-fab-opt-mark"
            >
              <Highlighter className="w-[18px] h-[18px]" strokeWidth={2.2} />
              <span className="text-[9px] font-semibold leading-none tracking-tight">Mark</span>
            </button>

            <button
              type="button"
              role="menuitem"
              title="Circle"
              aria-label="Circle on page"
              onClick={(e) => {
                e.stopPropagation();
                onCircle();
              }}
              className="folio-fab-option folio-fab-opt-circle"
            >
              <Circle className="w-[18px] h-[18px]" strokeWidth={2.3} />
              <span className="text-[9px] font-semibold leading-none tracking-tight">Circle</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return null;
  return createPortal(menuContent, document.body);
}

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

const MIN_FOCUS_ZOOM = 1;
const MAX_FOCUS_ZOOM = 3.8;
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

function clampVal(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function FocusedPageOverlay({
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
        x: clampVal(nextX, -maxPanX, maxPanX),
        y: clampVal(nextY, -maxPanY, maxPanY),
      };
    },
    [baseSize.w, baseSize.h, viewportSize.w, viewportSize.h]
  );

  useEffect(() => {
    const targetZoom = DEFAULT_FOCUS_ZOOM;
    const offsetX = (anchor.rx - 0.5) * baseSize.w;
    const offsetY = (anchor.ry - 0.5) * baseSize.h;
    setZoom(targetZoom);
    setPan(clampPan(-offsetX * targetZoom, -offsetY * targetZoom, targetZoom));
  }, [anchor.pageNum, anchor.rx, anchor.ry, baseSize.w, baseSize.h, clampPan]);

  const zoomAtPoint = useCallback(
    (nextZoomRaw: number, clientX?: number, clientY?: number) => {
      const nextZoom = clampVal(Number(nextZoomRaw.toFixed(2)), MIN_FOCUS_ZOOM, MAX_FOCUS_ZOOM);
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
      x: clampVal((clientX - rect.left) / rect.width, 0.03, 0.97),
      y: clampVal((clientY - rect.top) / rect.height, 0.03, 0.97),
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
      const nextZoom = clampVal(
        Number((pinchRef.current.startZoom * (nextDist / pinchRef.current.dist)).toFixed(2)),
        MIN_FOCUS_ZOOM,
        MAX_FOCUS_ZOOM
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
            disabled={zoom <= MIN_FOCUS_ZOOM + 0.01}
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
            disabled={zoom >= MAX_FOCUS_ZOOM - 0.01}
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

export interface PocketOriginRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function computeImageNormalizedPoint(
  containerEl: HTMLElement,
  clientX: number,
  clientY: number
): { rx: number; ry: number } {
  const imgEl =
    containerEl instanceof HTMLImageElement
      ? containerEl
      : containerEl.querySelector('img');
  const target = imgEl || containerEl;
  const rect = target.getBoundingClientRect();
  const style = window.getComputedStyle(target);
  const padL = parseFloat(style.paddingLeft) || 0;
  const padR = parseFloat(style.paddingRight) || 0;
  const padT = parseFloat(style.paddingTop) || 0;
  const padB = parseFloat(style.paddingBottom) || 0;

  const boxLeft = rect.left + padL;
  const boxTop = rect.top + padT;
  const boxW = Math.max(1, rect.width - padL - padR);
  const boxH = Math.max(1, rect.height - padT - padB);

  let drawnW = boxW;
  let drawnH = boxH;
  let offsetX = 0;
  let offsetY = 0;

  if (imgEl && imgEl.naturalWidth > 0 && imgEl.naturalHeight > 0) {
    const natAspect = imgEl.naturalWidth / imgEl.naturalHeight;
    const boxAspect = boxW / boxH;
    if (natAspect > boxAspect) {
      drawnH = boxW / natAspect;
      offsetY = (boxH - drawnH) / 2;
    } else {
      drawnW = boxH * natAspect;
      offsetX = (boxW - drawnW) / 2;
    }
  }

  const rx = Math.max(0.06, Math.min(0.94, (clientX - (boxLeft + offsetX)) / Math.max(1, drawnW)));
  const ry = Math.max(0.06, Math.min(0.94, (clientY - (boxTop + offsetY)) / Math.max(1, drawnH)));
  return { rx, ry };
}

interface FlipBookReaderProps {
  book: VaultBook;
  originRect?: PocketOriginRect | null;
  closing?: boolean;
  apiBaseUrl?: string;
  pdfAssetsBaseUrl?: string;
  hasBackend?: boolean;
  onBookUpdate?: (updated: VaultBook) => void;
}

export function FlipBookReader({
  book,
  originRect,
  closing = false,
  apiBaseUrl,
  pdfAssetsBaseUrl,
  hasBackend = true,
  onBookUpdate,
}: FlipBookReaderProps) {
  const [numPages, setNumPages] = useState(0);
  const [currentSpread, setCurrentSpread] = useState(0);
  const [activeFlipLeaf, setActiveFlipLeaf] = useState<number | null>(null);
  const [pageImages, setPageImages] = useState<Record<number, string>>({});
  const [pageErrors, setPageErrors] = useState<Record<number, string>>({});
  const [loadingDoc, setLoadingDoc] = useState(true);
  const [docError, setDocError] = useState<string | null>(null);
  const [jumpValue, setJumpValue] = useState('1');
  const [singleZoom, setSingleZoom] = useState(false);
  const [focusAnchor, setFocusAnchor] = useState<FocusAnchor | null>(null);
  const [tapMenu, setTapMenu] = useState<TapMenuAnchor | null>(null);
  const [activePenTool, setActivePenTool] = useState<PenToolMode>(null);
  const [draftStroke, setDraftStroke] = useState<DraftPageStroke | null>(null);
  const [freshAnnotationIds, setFreshAnnotationIds] = useState<Set<string>>(() => new Set());
  const [annotations, setAnnotations] = useState<PageAnnotation[]>(() =>
    loadBookAnnotations(book.id)
  );
  const [hiResImages, setHiResImages] = useState<Record<number, string>>({});
  const [progress, setProgress] = useState<BookProgressState>(() => resolveBookProgress(book));

  const [stageArrived, setStageArrived] = useState(false);
  const [coverOpened, setCoverOpened] = useState(false);
  const [coverFading, setCoverFading] = useState(false);
  const [coverSettled, setCoverSettled] = useState(false);
  const [keeperRevealed, setKeeperRevealed] = useState(false);
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(() =>
    getCachedPdfCoverSync(book.id, book.sizeBytes)
  );
  const [bindingTheme, setBindingTheme] = useState<BookBindingTheme | null>(() =>
    getCachedBookBindingTheme(book.id, book.sizeBytes)
  );

  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderedSetRef = useRef<Set<number>>(new Set());
  const pageOrderRef = useRef<number[]>([]);
  const inFlightSetRef = useRef<Set<number>>(new Set());
  const hiResSetRef = useRef<Set<number>>(new Set());
  const hiResInFlightRef = useRef<Set<number>>(new Set());
  const hiResOrderRef = useRef<number[]>([]);
  const currentSpreadRef = useRef(0);
  const keptPageRef = useRef<number | null>(null);
  const focusPageRef = useRef<number | null>(null);
  const flipTimerRef = useRef<number | null>(null);
  const clickTimerRef = useRef<number | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const hasInteractedRef = useRef(false);
  const pendingCommittedPageRef = useRef<number | null>(null);
  const bookRef = useRef(book);
  const onBookUpdateRef = useRef(onBookUpdate);
  const lastPageTapRef = useRef<{ time: number; x: number; y: number; pageNum: number } | null>(null);
  const lastTapMenuOpenedAtRef = useRef(0);
  const suppressClickUntilRef = useRef(0);
  const spreadSwipeRef = useRef<{ x: number; y: number } | null>(null);
  const strokeDraftRef = useRef<{
    pointerId: number;
    pageNum: number;
    type: 'mark' | 'circle';
    points: PageAnnotationPoint[];
    totalDist: number;
  } | null>(null);
  const freshTimersRef = useRef<number[]>([]);

  useEffect(() => {
    bookRef.current = book;
    onBookUpdateRef.current = onBookUpdate;
  }, [book, onBookUpdate]);

  useEffect(() => {
    currentSpreadRef.current = currentSpread;
    keptPageRef.current = getKeptPage(progress);
    focusPageRef.current = focusAnchor?.pageNum ?? null;
  }, [currentSpread, progress, focusAnchor]);

  const totalLeaves = Math.max(1, Math.ceil(numPages / 2));

  const initialTransform = useMemo(() => {
    if (!originRect || typeof window === 'undefined') {
      return 'translate3d(0, 64px, 0) scale(0.36) rotateX(18deg) rotateY(-16deg)';
    }
    const targetCenterX = window.innerWidth / 2;
    const targetCenterY = window.innerHeight / 2;
    const originCenterX = originRect.left + originRect.width / 2;
    const originCenterY = originRect.top + originRect.height / 2;
    const dx = Math.round(originCenterX - targetCenterX);
    const dy = Math.round(originCenterY - targetCenterY);
    const approxBookWidth = Math.min(window.innerWidth * 0.92, 1080);
    const scale = Math.max(0.14, Math.min(0.42, (originRect.width * 2) / approxBookWidth));
    return `translate3d(${dx}px, ${dy}px, 0) scale(${scale.toFixed(3)}) rotateX(18deg) rotateY(-22deg) rotateZ(-4deg)`;
  }, [originRect]);

  useEffect(() => {
    setStageArrived(false);
    setCoverOpened(false);
    setCoverFading(false);
    setCoverSettled(false);
    setKeeperRevealed(false);

    const serverCoverUrl = hasBackend
      ? joinApiUrl(apiBaseUrl, `/api/vault/${encodeURIComponent(book.id)}/cover`)
      : null;
    const syncCached =
      book.coverPath ||
      getCachedPdfCoverSync(book.id, book.sizeBytes) ||
      (serverCoverUrl && !failedServerUrls.has(serverCoverUrl) ? serverCoverUrl : null);
    setCoverPreviewUrl(syncCached);
    setBindingTheme(getCachedBookBindingTheme(book.id, book.sizeBytes));

    let cancelled = false;
    if (!syncCached) {
      const pdfUrl = resolveBookFileUrl(
        { id: book.id, sourceUrl: book.sourceUrl },
        apiBaseUrl,
        hasBackend
      );
      getOrRenderPdfCover(book.id, book.sizeBytes, true, { pdfUrl, apiBaseUrl, pdfAssetsBaseUrl, hasBackend })
        .then((url) => {
          if (!cancelled) setCoverPreviewUrl(url);
        })
        .catch(() => {});
    }

    let raf2 = 0;
    const raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        setStageArrived(true);
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [book.id, book.sizeBytes, book.sourceUrl, book.coverPath, apiBaseUrl, hasBackend]);

  useEffect(() => {
    if (!stageArrived || loadingDoc || docError) return;
    const openTimer = window.setTimeout(() => {
      setCoverOpened(true);
    }, 340);
    const fadeTimer = window.setTimeout(() => {
      setCoverFading(true);
    }, 1360);
    const settleTimer = window.setTimeout(() => {
      setCoverSettled(true);
    }, 1620);
    return () => {
      window.clearTimeout(openTimer);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(settleTimer);
    };
  }, [stageArrived, loadingDoc, docError]);

  useEffect(() => {
    if (closing) {
      setFocusAnchor(null);
      setTapMenu(null);
      setActivePenTool(null);
      setDraftStroke(null);
      strokeDraftRef.current = null;
    }
  }, [closing]);

  const persistProgressToServer = useCallback(
    (targetBookId: string, nextProgress: BookProgressState, immediate = false) => {
      saveLocalBookProgress(targetBookId, nextProgress);

      const currentBook = bookRef.current;
      if (currentBook.id === targetBookId && onBookUpdateRef.current) {
        onBookUpdateRef.current({
          ...currentBook,
          lastPage: nextProgress.lastPage,
          totalPages: nextProgress.totalPages,
          bookmarkedPage: nextProgress.bookmarkedPage,
          keeperColor: nextProgress.keeperColor,
          readingStatus: nextProgress.readingStatus,
          lastReadAt: nextProgress.updatedAt,
        });
      }

      if (!hasBackend) return;

      const sendPatch = () => {
        fetch(joinApiUrl(apiBaseUrl, `/api/vault/${encodeURIComponent(targetBookId)}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            lastPage: nextProgress.lastPage,
            totalPages: nextProgress.totalPages,
            bookmarkedPage: nextProgress.bookmarkedPage,
            keeperColor: nextProgress.keeperColor,
            readingStatus: nextProgress.readingStatus,
            lastReadAt: nextProgress.updatedAt,
          }),
        })
          .then(async (res) => {
            if (!res.ok) return;
            const data = (await res.json()) as { item?: VaultBook };
            if (data.item && bookRef.current.id === targetBookId && onBookUpdateRef.current) {
              onBookUpdateRef.current(data.item);
            }
          })
          .catch(() => {});
      };

      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }

      if (immediate) {
        sendPatch();
      } else {
        saveTimerRef.current = window.setTimeout(() => {
          saveTimerRef.current = null;
          sendPatch();
        }, 320);
      }
    },
    [apiBaseUrl, hasBackend]
  );

  useEffect(() => {
    let cancelled = false;
    const initialProgress = resolveBookProgress(bookRef.current);
    hasInteractedRef.current = false;
    pendingCommittedPageRef.current = null;
    setProgress(initialProgress);
    setAnnotations(loadBookAnnotations(bookRef.current.id));
    setLoadingDoc(true);
    setDocError(null);
    setNumPages(0);
    setCurrentSpread(0);
    setActiveFlipLeaf(null);
    setPageImages({});
    setHiResImages({});
    setFocusAnchor(null);
    setTapMenu(null);
    setActivePenTool(null);
    setDraftStroke(null);
    strokeDraftRef.current = null;
    setPageErrors({});
    setJumpValue('1');
    renderedSetRef.current = new Set();
    pageOrderRef.current = [];
    inFlightSetRef.current = new Set();
    hiResSetRef.current = new Set();
    hiResInFlightRef.current = new Set();
    hiResOrderRef.current = [];

    const url = resolveBookFileUrl(book, apiBaseUrl, hasBackend);
    let activeLoadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    void resolvePdfAssetsBase(pdfAssetsBaseUrl).then((assetsBase) => {
      if (cancelled) return;
      const loadingTask = pdfjsLib.getDocument({
        url,
        wasmUrl: `${assetsBase}wasm/`,
        cMapUrl: `${assetsBase}cmaps/`,
        cMapPacked: true,
        standardFontDataUrl: `${assetsBase}standard_fonts/`,
        iccUrl: `${assetsBase}iccs/`,
        rangeChunkSize: 65536,
        disableAutoFetch: true,
      });
      activeLoadingTask = loadingTask;

      loadingTask.promise
        .then((doc) => {
          if (cancelled) {
            void loadingTask.destroy();
            return;
          }
          pdfDocRef.current = doc;
          setNumPages(doc.numPages);
          const resumePage = getKeptPage(initialProgress);
          if (resumePage) {
            const clampedResume = Math.max(1, Math.min(doc.numPages, resumePage));
            setCurrentSpread(Math.floor(clampedResume / 2));
          }
          setLoadingDoc(false);
        })
        .catch((err) => {
          if (!cancelled) {
            setDocError(err instanceof Error ? err.message : 'Unable to open PDF inside reader.');
            setLoadingDoc(false);
          }
        });
    });

    return () => {
      cancelled = true;
      if (flipTimerRef.current !== null) {
        window.clearTimeout(flipTimerRef.current);
      }
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
      }
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      pdfDocRef.current = null;
      if (activeLoadingTask) {
        void activeLoadingTask.destroy();
      }
    };
  }, [book.id, book.sourceUrl, apiBaseUrl, pdfAssetsBaseUrl, hasBackend]);

  const renderPdfPage = useCallback(async (pageNum: number) => {
    const doc = pdfDocRef.current;
    if (!doc || pageNum < 1 || pageNum > doc.numPages) return;
    if (renderedSetRef.current.has(pageNum) || inFlightSetRef.current.has(pageNum)) {
      return;
    }

    inFlightSetRef.current.add(pageNum);
    try {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.75 });
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

      const dataUrl = (outCtx ? outputCanvas : canvas).toDataURL('image/jpeg', 0.92);
      canvas.width = 0;
      canvas.height = 0;
      outputCanvas.width = 0;
      outputCanvas.height = 0;
      if (pdfDocRef.current !== doc) return;

      renderedSetRef.current.add(pageNum);
      pageOrderRef.current = [...pageOrderRef.current.filter((p) => p !== pageNum), pageNum];

      const evictedPages: number[] = [];
      if (pageOrderRef.current.length > 24) {
        const minKeep = currentSpreadRef.current * 2 - 4;
        const maxKeep = currentSpreadRef.current * 2 + 5;
        for (let i = 0; i < pageOrderRef.current.length && pageOrderRef.current.length - evictedPages.length > 24; i++) {
          const candidate = pageOrderRef.current[i];
          const isProtected =
            (candidate >= minKeep && candidate <= maxKeep) ||
            candidate === keptPageRef.current ||
            candidate === focusPageRef.current;
          if (!isProtected) {
            evictedPages.push(candidate);
          }
        }
        if (evictedPages.length > 0) {
          const evictSet = new Set(evictedPages);
          pageOrderRef.current = pageOrderRef.current.filter((p) => !evictSet.has(p));
          for (const p of evictedPages) {
            renderedSetRef.current.delete(p);
          }
        }
      }

      setPageImages((prev) => {
        const next = { ...prev, [pageNum]: dataUrl };
        for (const p of evictedPages) {
          delete next[p];
        }
        return next;
      });
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name !== 'RenderingCancelledException') {
        setPageErrors((prev) => ({
          ...prev,
          [pageNum]: err instanceof Error ? err.message : 'Page render failed.',
        }));
      }
    } finally {
      inFlightSetRef.current.delete(pageNum);
    }
  }, []);

  const renderHiResPage = useCallback(async (pageNum: number) => {
    const doc = pdfDocRef.current;
    if (!doc || pageNum < 1 || pageNum > doc.numPages) return;
    if (hiResSetRef.current.has(pageNum) || hiResInFlightRef.current.has(pageNum)) {
      return;
    }

    hiResInFlightRef.current.add(pageNum);
    try {
      const page = await doc.getPage(pageNum);
      const baseViewport = page.getViewport({ scale: 1 });
      const maxDim = Math.max(1, baseViewport.width, baseViewport.height);
      const targetScale = Math.max(2.1, Math.min(3.2, 2350 / maxDim));
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

      const dataUrl = (outCtx ? outputCanvas : canvas).toDataURL('image/jpeg', 0.94);
      canvas.width = 0;
      canvas.height = 0;
      outputCanvas.width = 0;
      outputCanvas.height = 0;

      if (pdfDocRef.current !== doc) return;

      hiResSetRef.current.add(pageNum);
      hiResOrderRef.current = [...hiResOrderRef.current.filter((p) => p !== pageNum), pageNum];
      const evicted = hiResOrderRef.current.length > 4 ? hiResOrderRef.current.shift() : undefined;
      if (evicted !== undefined) {
        hiResSetRef.current.delete(evicted);
      }

      setHiResImages((prev) => {
        const next = { ...prev, [pageNum]: dataUrl };
        if (evicted !== undefined) {
          delete next[evicted];
        }
        return next;
      });
    } catch {
      // Base page image remains visible
    } finally {
      hiResInFlightRef.current.delete(pageNum);
    }
  }, []);

  const commitPageProgress = useCallback(
    (
      targetPage: number,
      options?: {
        bookmarkedPage?: number | null;
        keeperColor?: BookKeeperColor | null;
        status?: ReadingStatus;
        immediate?: boolean;
        forceLastPage?: boolean;
      }
    ) => {
      if (numPages <= 0) return;
      const clampedPage = Math.max(1, Math.min(numPages, targetPage));
      const now = new Date().toISOString();
      setProgress((prev) => {
        const nextLastPage = options?.forceLastPage
          ? clampedPage
          : Math.max(prev.lastPage, clampedPage);
        const nextBookmark =
          options && 'bookmarkedPage' in options
            ? (options.bookmarkedPage ?? null)
            : prev.bookmarkedPage;
        const nextKeeperColor =
          options && 'keeperColor' in options
            ? (options.keeperColor ?? null)
            : prev.keeperColor;
        const nextStatus: ReadingStatus =
          options?.status ??
          (prev.readingStatus === 'completed'
            ? 'completed'
            : nextLastPage >= 2 || nextBookmark !== null
              ? 'reading'
              : 'unread');
        const nextState: BookProgressState = {
          lastPage: nextLastPage,
          totalPages: numPages,
          bookmarkedPage: nextBookmark,
          keeperColor: nextKeeperColor,
          readingStatus: nextStatus,
          updatedAt: now,
        };
        persistProgressToServer(book.id, nextState, options?.immediate);
        return nextState;
      });
    },
    [book.id, numPages, persistProgressToServer]
  );

  const openPageFocusAtNormalized = useCallback(
    (pageNum: number, rx: number, ry: number) => {
      if (pageNum < 1 || pageNum > numPages) return;
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      void renderPdfPage(pageNum);
      void renderHiResPage(pageNum);
      hasInteractedRef.current = true;
      commitPageProgress(pageNum);
      setFocusAnchor({ pageNum, rx, ry });
    },
    [commitPageProgress, numPages, renderHiResPage, renderPdfPage]
  );

  const openTapOptionsMenu = useCallback(
    (pageNum: number, clientX: number, clientY: number, containerEl: HTMLElement) => {
      if (pageNum < 1 || pageNum > numPages) return;
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = null;
      }
      const now = performance.now();
      if (now - lastTapMenuOpenedAtRef.current < 220) {
        return;
      }
      lastTapMenuOpenedAtRef.current = now;
      const { rx, ry } = computeImageNormalizedPoint(containerEl, clientX, clientY);
      setTapMenu({
        pageNum,
        rx,
        ry,
        screenX: clientX,
        screenY: clientY,
      });
    },
    [numPages]
  );

  useEffect(() => {
    return () => {
      for (const timer of freshTimersRef.current) {
        window.clearTimeout(timer);
      }
      freshTimersRef.current = [];
    };
  }, []);

  const markFreshAnnotation = useCallback((id: string) => {
    setFreshAnnotationIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    const timer = window.setTimeout(() => {
      setFreshAnnotationIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }, 820);
    freshTimersRef.current.push(timer);
  }, []);

  const toggleAnnotationAtPoint = useCallback(
    (type: 'mark' | 'circle', pageNum: number, rx: number, ry: number) => {
      let addedId: string | null = null;
      setAnnotations((prev) => {
        const existingIndex = prev.findIndex(
          (item) =>
            !item.points &&
            item.pageNum === pageNum &&
            item.type === type &&
            Math.hypot(item.rx - rx, item.ry - ry) < 0.055
        );
        if (existingIndex >= 0) {
          const next = prev.filter((_, idx) => idx !== existingIndex);
          saveBookAnnotations(book.id, next);
          return next;
        }
        addedId = `${type}-${pageNum}-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const next = [
          ...prev,
          {
            id: addedId,
            pageNum,
            type,
            rx,
            ry,
          },
        ];
        saveBookAnnotations(book.id, next);
        return next;
      });
      if (addedId) {
        markFreshAnnotation(addedId);
      }
    },
    [book.id, markFreshAnnotation]
  );

  const addFreehandAnnotation = useCallback(
    (type: 'mark' | 'circle', pageNum: number, points: PageAnnotationPoint[]) => {
      if (points.length < 2) return;
      const sum = points.reduce(
        (acc, pt) => ({ x: acc.x + pt.x, y: acc.y + pt.y }),
        { x: 0, y: 0 }
      );
      const rx = sum.x / points.length;
      const ry = sum.y / points.length;
      const id = `${type}-stroke-${pageNum}-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      setAnnotations((prev) => {
        const next = [...prev, { id, pageNum, type, rx, ry, points }];
        saveBookAnnotations(book.id, next);
        return next;
      });
      markFreshAnnotation(id);
    },
    [book.id, markFreshAnnotation]
  );

  const removeAnnotationById = useCallback(
    (id: string) => {
      setAnnotations((prev) => {
        const next = prev.filter((item) => item.id !== id);
        saveBookAnnotations(book.id, next);
        return next;
      });
    },
    [book.id]
  );

  const handlePageTapPointerUp = useCallback(
    (pageNum: number, e: React.PointerEvent<HTMLElement>) => {
      if (activePenTool !== null || e.pointerType !== 'touch' || pageNum < 1 || pageNum > numPages) return;
      const now = performance.now();
      const prev = lastPageTapRef.current;
      if (
        prev &&
        prev.pageNum === pageNum &&
        now - prev.time < 320 &&
        Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 30
      ) {
        lastPageTapRef.current = null;
        suppressClickUntilRef.current = now + 420;
        openTapOptionsMenu(pageNum, e.clientX, e.clientY, e.currentTarget);
      } else {
        lastPageTapRef.current = { time: now, x: e.clientX, y: e.clientY, pageNum };
      }
    },
    [activePenTool, numPages, openTapOptionsMenu]
  );

  const handlePageSurfacePointerDown = useCallback(
    (pageNum: number, e: React.PointerEvent<HTMLElement>) => {
      if (!activePenTool || pageNum < 1 || pageNum > numPages) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.stopPropagation();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore capture failure
      }
      const { rx, ry } = computeImageNormalizedPoint(e.currentTarget, e.clientX, e.clientY);
      const firstPt: PageAnnotationPoint = { x: rx, y: ry };
      strokeDraftRef.current = {
        pointerId: e.pointerId,
        pageNum,
        type: activePenTool,
        points: [firstPt],
        totalDist: 0,
      };
      setDraftStroke({ pageNum, type: activePenTool, points: [firstPt] });
    },
    [activePenTool, numPages]
  );

  const handlePageSurfacePointerMove = useCallback(
    (pageNum: number, e: React.PointerEvent<HTMLElement>) => {
      const draft = strokeDraftRef.current;
      if (!draft || draft.pointerId !== e.pointerId || draft.pageNum !== pageNum) return;
      const { rx, ry } = computeImageNormalizedPoint(e.currentTarget, e.clientX, e.clientY);
      const prev = draft.points[draft.points.length - 1];
      const seg = Math.hypot(rx - prev.x, ry - prev.y);
      if (seg < 0.004) return;
      draft.points.push({ x: rx, y: ry });
      draft.totalDist += seg;
      setDraftStroke({ pageNum, type: draft.type, points: [...draft.points] });
    },
    []
  );

  const handlePageSurfacePointerUp = useCallback(
    (pageNum: number, e: React.PointerEvent<HTMLElement>) => {
      const draft = strokeDraftRef.current;
      if (draft && draft.pointerId === e.pointerId) {
        e.stopPropagation();
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        strokeDraftRef.current = null;
        setDraftStroke(null);
        suppressClickUntilRef.current = performance.now() + 360;
        if (draft.totalDist < 0.022 || draft.points.length < 2) {
          const origin = draft.points[0];
          if (origin) {
            toggleAnnotationAtPoint(draft.type, pageNum, origin.x, origin.y);
          }
        } else {
          addFreehandAnnotation(draft.type, pageNum, draft.points);
        }
        return;
      }
      handlePageTapPointerUp(pageNum, e);
    },
    [addFreehandAnnotation, handlePageTapPointerUp, toggleAnnotationAtPoint]
  );

  useEffect(() => {
    if (numPages === 0) return;
    let cancelled = false;
    const primary: number[] = [];
    if (currentSpread === 0) {
      primary.push(1);
    } else {
      primary.push(currentSpread * 2, currentSpread * 2 + 1);
    }
    const ordered: number[] = [];
    const seen = new Set<number>();
    const pushIfValid = (p: number) => {
      if (p >= 1 && p <= numPages && !seen.has(p)) {
        seen.add(p);
        ordered.push(p);
      }
    };
    for (const p of primary) pushIfValid(p);
    for (let offset = 1; offset <= 4; offset++) {
      pushIfValid(currentSpread * 2 + 1 + offset);
      pushIfValid(currentSpread * 2 - offset);
    }

    let cursor = 0;
    const workerCount = 2;
    const runWorker = async () => {
      while (!cancelled && cursor < ordered.length) {
        const nextPage = ordered[cursor++];
        await renderPdfPage(nextPage);
      }
    };
    for (let w = 0; w < workerCount; w++) {
      void runWorker();
    }
    return () => {
      cancelled = true;
    };
  }, [numPages, currentSpread, renderPdfPage]);

  const primarySpreadPage =
    numPages > 0
      ? currentSpread === 0
        ? 1
        : Math.min(numPages, currentSpread * 2)
      : 1;

  const activeKeeperColor = resolveBookKeeperColor(book.id, progress.keeperColor);

  const selectKeeperColorAtPage = useCallback(
    (nextColor: BookKeeperColor, pageNum: number) => {
      if (numPages <= 0) return;
      const clampedPage = Math.max(1, Math.min(numPages, pageNum));
      hasInteractedRef.current = true;
      const currentKept = getKeptPage(progress);
      const targetBookmark = currentKept ?? clampedPage;
      commitPageProgress(targetBookmark, {
        bookmarkedPage: targetBookmark,
        keeperColor: nextColor,
        status: progress.readingStatus === 'completed' ? 'completed' : 'reading',
        immediate: true,
      });
    },
    [commitPageProgress, numPages, progress]
  );

  const toggleBookKeeperAtPage = useCallback(
    (pageNum: number) => {
      if (numPages <= 0) return;
      const clampedPage = Math.max(1, Math.min(numPages, pageNum));
      hasInteractedRef.current = true;
      const currentKept = getKeptPage(progress);
      const spreadLeft = currentSpread === 0 ? null : currentSpread * 2;
      const spreadRight = currentSpread * 2 + 1 <= numPages ? currentSpread * 2 + 1 : null;
      const isAlreadyKeptHere =
        currentKept !== null &&
        (currentKept === clampedPage ||
          (clampedPage === primarySpreadPage &&
            (currentKept === spreadLeft || currentKept === spreadRight)));

      if (isAlreadyKeptHere) {
        commitPageProgress(1, {
          bookmarkedPage: null,
          status: 'unread',
          immediate: true,
          forceLastPage: true,
        });
      } else {
        commitPageProgress(clampedPage, {
          bookmarkedPage: clampedPage,
          keeperColor: activeKeeperColor,
          status: progress.readingStatus === 'completed' ? 'completed' : 'reading',
          immediate: true,
          forceLastPage: true,
        });
      }
    },
    [activeKeeperColor, commitPageProgress, currentSpread, numPages, primarySpreadPage, progress]
  );

  useEffect(() => {
    const pendingPage = pendingCommittedPageRef.current;
    pendingCommittedPageRef.current = null;
    const activePage =
      pendingPage !== null
        ? Math.max(1, Math.min(Math.max(1, numPages), pendingPage))
        : currentSpread === 0
          ? 1
          : Math.min(Math.max(1, numPages), currentSpread * 2);
    setJumpValue(String(activePage));
    if (numPages > 0 && hasInteractedRef.current) {
      commitPageProgress(activePage);
    }
  }, [currentSpread, numPages, commitPageProgress]);

  const turnNext = useCallback(() => {
    if (currentSpread >= totalLeaves) return;
    setTapMenu(null);
    hasInteractedRef.current = true;
    const turningLeaf = currentSpread;
    setActiveFlipLeaf(turningLeaf);
    setCurrentSpread((prev) => Math.min(totalLeaves, prev + 1));
    if (flipTimerRef.current !== null) window.clearTimeout(flipTimerRef.current);
    flipTimerRef.current = window.setTimeout(() => setActiveFlipLeaf(null), 820);
  }, [currentSpread, totalLeaves]);

  const turnPrev = useCallback(() => {
    if (currentSpread <= 0) return;
    setTapMenu(null);
    hasInteractedRef.current = true;
    const turningLeaf = currentSpread - 1;
    setActiveFlipLeaf(turningLeaf);
    setCurrentSpread((prev) => Math.max(0, prev - 1));
    if (flipTimerRef.current !== null) window.clearTimeout(flipTimerRef.current);
    flipTimerRef.current = window.setTimeout(() => setActiveFlipLeaf(null), 820);
  }, [currentSpread]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT')) {
        return;
      }
      if (e.key === 'Escape' && activePenTool && !tapMenu && !focusAnchor) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setActivePenTool(null);
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        turnNext();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        turnPrev();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activePenTool, focusAnchor, tapMenu, turnNext, turnPrev]);

  function handleJumpSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetPage = Number.parseInt(jumpValue, 10);
    if (!Number.isFinite(targetPage) || numPages <= 0) return;
    hasInteractedRef.current = true;
    const clamped = Math.max(1, Math.min(numPages, targetPage));
    const targetSpread = Math.floor(clamped / 2);
    pendingCommittedPageRef.current = clamped;
    setActiveFlipLeaf(null);
    setCurrentSpread(targetSpread);
    commitPageProgress(clamped, { immediate: true });
  }

  const windowStart = Math.max(0, currentSpread - 2);
  const windowEnd = Math.min(totalLeaves - 1, currentSpread + 2);
  const visibleLeaves: number[] = [];
  for (let k = windowStart; k <= windowEnd; k++) {
    visibleLeaves.push(k);
  }

  const zoomedLeftPage = currentSpread === 0 ? null : currentSpread * 2;
  const zoomedRightPage = currentSpread * 2 + 1 <= numPages ? currentSpread * 2 + 1 : null;
  const keptPage = getKeptPage(progress);
  const keptOnLeft = keptPage !== null && zoomedLeftPage === keptPage;
  const keptOnRight = keptPage !== null && zoomedRightPage === keptPage;
  const keptOnCurrentSpread = keptOnLeft || keptOnRight;
  const displayKeptPage =
    keptOnCurrentSpread && keptPage !== null
      ? keptPage
      : progress.bookmarkedPage === null &&
          progress.lastPage <= 1 &&
          currentSpread === 0 &&
          numPages > 0
        ? 1
        : null;
  const displayKeptOnLeft = displayKeptPage !== null && zoomedLeftPage === displayKeptPage;
  const displayKeptOnRight = displayKeptPage !== null && zoomedRightPage === displayKeptPage;

  const pageIsOpen = singleZoom
    ? stageArrived && !loadingDoc && !docError
    : coverFading && activeFlipLeaf === null && !loadingDoc && !docError;

  useEffect(() => {
    setKeeperRevealed(false);
    if (!pageIsOpen || displayKeptPage === null || closing) {
      return;
    }
    const timer = window.setTimeout(() => {
      setKeeperRevealed(true);
    }, 320);
    return () => window.clearTimeout(timer);
  }, [pageIsOpen, displayKeptPage, currentSpread, closing]);

  const renderPageContent = (pageNum: number, emptyLabel: string) => {
    if (pageNum > numPages) {
      return (
        <div className="w-full h-full flex items-center justify-center text-xs text-[#A8A29E] font-serif italic">
          {emptyLabel}
        </div>
      );
    }
    if (pageErrors[pageNum]) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center text-xs text-[#991B1B]">
          <span>Could not render Page {pageNum}</span>
          <span className="mt-1 text-[11px] text-[#78716C]">{pageErrors[pageNum]}</span>
        </div>
      );
    }
    if (pageImages[pageNum]) {
      return (
        <SpreadPageSurface
          src={pageImages[pageNum]}
          alt={`Page ${pageNum}`}
          annotations={annotations.filter((item) => item.pageNum === pageNum)}
          freshIds={freshAnnotationIds}
          interactiveAnnotations={activePenTool === null}
          draftStroke={
            draftStroke && draftStroke.pageNum === pageNum
              ? { type: draftStroke.type, points: draftStroke.points }
              : null
          }
          onRemoveAnnotation={removeAnnotationById}
        />
      );
    }
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-[#78716C]">
        <Loader2 className="w-4 h-4 animate-spin mb-2" />
        <span className="text-xs font-mono tabular-nums">Page {pageNum}</span>
      </div>
    );
  };

  const stageStyle = closing
    ? { transform: initialTransform, opacity: 0 }
    : stageArrived
      ? { transform: 'translate3d(0, 0, 0) scale(1) rotateX(0deg)', opacity: 1 }
      : { transform: initialTransform, opacity: 0.2 };

  return (
    <div
      style={stageStyle}
      className="book-reveal-stage w-full flex flex-col items-center justify-center"
    >
      {docError ? (
        <div className="max-w-md bg-[#1a1d24]/95 border border-white/15 rounded-lg p-8 text-center shadow-2xl">
          <p className="font-serif text-lg text-[#fca5a5]">Unable to open PDF book</p>
          <p className="mt-1 text-sm text-white/80">{docError}</p>
        </div>
      ) : singleZoom ? (
        <div
          style={
            bindingTheme
              ? {
                  background: `linear-gradient(145deg, ${bindingTheme.boardHi} 0%, ${bindingTheme.boardLo} 100%)`,
                  boxShadow: `0 25px 50px -12px rgba(0, 0, 0, 0.72), inset 0 1px 0 ${bindingTheme.boardBorder}`,
                }
              : undefined
          }
          className="w-[min(94vw,900px)] h-[min(64dvh,690px)] sm:w-[min(92vw,900px)] sm:h-[min(78dvh,690px)] bg-[#141210] rounded-xl p-2 sm:p-3 shadow-2xl flex flex-col transition-colors duration-500"
        >
          <div className="flex-1 overflow-y-auto bg-[#e9e5dc] rounded p-2.5 sm:p-4 space-y-3 sm:space-y-4">
            {zoomedLeftPage ? (
              <div
                className={`folio-pen-surface relative bg-white shadow mx-auto max-w-2xl ${
                  activePenTool ? 'touch-none' : ''
                }`}
                title={activePenTool ? 'Drag or tap with pen' : 'Double-click for page options'}
                onDoubleClick={(e) => {
                  if (activePenTool) return;
                  e.stopPropagation();
                  openTapOptionsMenu(zoomedLeftPage, e.clientX, e.clientY, e.currentTarget);
                }}
                onPointerDown={(e) => handlePageSurfacePointerDown(zoomedLeftPage, e)}
                onPointerMove={(e) => handlePageSurfacePointerMove(zoomedLeftPage, e)}
                onPointerUp={(e) => handlePageSurfacePointerUp(zoomedLeftPage, e)}
                onPointerCancel={(e) => handlePageSurfacePointerUp(zoomedLeftPage, e)}
              >
                {keeperRevealed && displayKeptOnLeft && displayKeptPage !== null ? (
                  <button
                    key={`zoom-keeper-${displayKeptPage}`}
                    type="button"
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBookKeeperAtPage(displayKeptPage);
                    }}
                    style={getBookKeeperRibbonStyle(activeKeeperColor)}
                    title={`${BOOK_KEEPER_PALETTE[activeKeeperColor].label} Book Keeper at Page ${displayKeptPage} — click to toggle`}
                    aria-label={`Bookmark at Page ${displayKeptPage}`}
                    className="reader-book-keeper-ribbon is-compact absolute top-0 left-4 z-20 flex flex-col items-center justify-end cursor-pointer"
                  >
                    <span
                      style={{ color: BOOK_KEEPER_PALETTE[activeKeeperColor].text }}
                      className="text-[8px] font-mono font-bold tabular-nums leading-none"
                    >
                      p.{displayKeptPage}
                    </span>
                  </button>
                ) : null}
                {pageImages[zoomedLeftPage] ? (
                  <>
                    <img
                      src={pageImages[zoomedLeftPage]}
                      alt={`Page ${zoomedLeftPage}`}
                      draggable={false}
                      className="w-full h-auto block select-none"
                    />
                    <PageAnnotationsLayer
                      annotations={annotations.filter((item) => item.pageNum === zoomedLeftPage)}
                      freshIds={freshAnnotationIds}
                      interactive={activePenTool === null}
                      draftStroke={
                        draftStroke && draftStroke.pageNum === zoomedLeftPage
                          ? { type: draftStroke.type, points: draftStroke.points }
                          : null
                      }
                      onRemove={removeAnnotationById}
                    />
                  </>
                ) : (
                  <div className="py-24 text-center text-xs text-[#78716C]">
                    Rendering Page {zoomedLeftPage}...
                  </div>
                )}
              </div>
            ) : null}
            {zoomedRightPage ? (
              <div
                className={`folio-pen-surface relative bg-white shadow mx-auto max-w-2xl ${
                  activePenTool ? 'touch-none' : ''
                }`}
                title={activePenTool ? 'Drag or tap with pen' : 'Double-click for page options'}
                onDoubleClick={(e) => {
                  if (activePenTool) return;
                  e.stopPropagation();
                  openTapOptionsMenu(zoomedRightPage, e.clientX, e.clientY, e.currentTarget);
                }}
                onPointerDown={(e) => handlePageSurfacePointerDown(zoomedRightPage, e)}
                onPointerMove={(e) => handlePageSurfacePointerMove(zoomedRightPage, e)}
                onPointerUp={(e) => handlePageSurfacePointerUp(zoomedRightPage, e)}
                onPointerCancel={(e) => handlePageSurfacePointerUp(zoomedRightPage, e)}
              >
                {keeperRevealed && displayKeptOnRight && displayKeptPage !== null ? (
                  <button
                    key={`zoom-keeper-${displayKeptPage}`}
                    type="button"
                    onDoubleClick={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleBookKeeperAtPage(displayKeptPage);
                    }}
                    style={getBookKeeperRibbonStyle(activeKeeperColor)}
                    title={`${BOOK_KEEPER_PALETTE[activeKeeperColor].label} Book Keeper at Page ${displayKeptPage} — click to toggle`}
                    aria-label={`Bookmark at Page ${displayKeptPage}`}
                    className="reader-book-keeper-ribbon is-compact absolute top-0 right-4 z-20 flex flex-col items-center justify-end cursor-pointer"
                  >
                    <span
                      style={{ color: BOOK_KEEPER_PALETTE[activeKeeperColor].text }}
                      className="text-[8px] font-mono font-bold tabular-nums leading-none"
                    >
                      p.{displayKeptPage}
                    </span>
                  </button>
                ) : null}
                {pageImages[zoomedRightPage] ? (
                  <>
                    <img
                      src={pageImages[zoomedRightPage]}
                      alt={`Page ${zoomedRightPage}`}
                      draggable={false}
                      className="w-full h-auto block select-none"
                    />
                    <PageAnnotationsLayer
                      annotations={annotations.filter((item) => item.pageNum === zoomedRightPage)}
                      freshIds={freshAnnotationIds}
                      interactive={activePenTool === null}
                      draftStroke={
                        draftStroke && draftStroke.pageNum === zoomedRightPage
                          ? { type: draftStroke.type, points: draftStroke.points }
                          : null
                      }
                      onRemove={removeAnnotationById}
                    />
                  </>
                ) : (
                  <div className="py-24 text-center text-xs text-[#78716C]">
                    Rendering Page {zoomedRightPage}...
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div
          style={getBookBindingCssVars(bindingTheme)}
          className={`bookWrapper ${coverOpened ? 'is-spread-open' : ''}`}
          onTouchStart={(e) => {
            if (activePenTool !== null) {
              spreadSwipeRef.current = null;
              return;
            }
            if (e.touches.length === 1) {
              spreadSwipeRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            } else {
              spreadSwipeRef.current = null;
            }
          }}
          onTouchEnd={(e) => {
            if (activePenTool !== null) {
              spreadSwipeRef.current = null;
              return;
            }
            const start = spreadSwipeRef.current;
            spreadSwipeRef.current = null;
            if (!start || e.changedTouches.length !== 1) return;
            const dx = e.changedTouches[0].clientX - start.x;
            const dy = e.changedTouches[0].clientY - start.y;
            if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.35) {
              suppressClickUntilRef.current = performance.now() + 360;
              if (dx < 0) {
                turnNext();
              } else {
                turnPrev();
              }
            }
          }}
        >
          <div className="bookBg">
            <div className="bookBoardLeft" aria-hidden="true" />
            <div className="bookBoardRight" aria-hidden="true" />
            <div className="pageBg">
              <div className="baseLeft">
                <div className="w-full h-full flex flex-col items-center justify-center p-3 sm:p-10 text-center">
                  <p className="text-[9px] sm:text-[11px] font-mono uppercase tracking-widest text-[#78716C]">
                    Folio Edition
                  </p>
                  <h3 className="mt-1.5 sm:mt-3 font-serif text-sm sm:text-2xl font-medium text-[#1A1816] max-w-xs line-clamp-3 [text-wrap:balance]">
                    {book.title}
                  </h3>
                  <p className="mt-1 sm:mt-2 text-[11px] sm:text-sm text-[#57534E] line-clamp-1 max-w-full">
                    {book.author}
                  </p>
                  <div className="mt-3 sm:mt-6 pt-2 sm:pt-4 border-t border-[#E5E0D5] text-[10px] sm:text-xs font-mono tabular-nums text-[#78716C]">
                    {numPages > 0 ? `${numPages} Pages` : 'Loading...'}
                  </div>
                  <p className="mt-2 sm:mt-4 text-[10px] sm:text-[11px] text-[#78716C] hidden sm:block">
                    Click the right page to turn forward
                  </p>
                </div>
              </div>

              <div className="baseRight">
                <div className="w-full h-full flex flex-col items-center justify-center p-6 text-center">
                  <p className="font-serif text-lg text-[#1A1816]">End of Book</p>
                  <p className="mt-1 text-xs text-[#78716C]">
                    Click the left page to turn back
                  </p>
                </div>
              </div>

              <div className="pageWrapper">
                {!loadingDoc
                  ? visibleLeaves.map((k) => {
                      const frontPageNum = k * 2 + 1;
                      const backPageNum = k * 2 + 2;
                      const isFlipped = k < currentSpread;

                      let zIndex: number;
                      if (activeFlipLeaf === k) {
                        zIndex = 100;
                      } else if (isFlipped) {
                        zIndex = 10 + k;
                      } else {
                        zIndex = 60 - (k - currentSpread);
                      }

                      return (
                        <div
                          key={k}
                          style={{ zIndex }}
                          onClick={(e) => {
                            if (activePenTool !== null || performance.now() < suppressClickUntilRef.current) {
                              return;
                            }
                            if (e.detail >= 2) {
                              if (clickTimerRef.current !== null) {
                                window.clearTimeout(clickTimerRef.current);
                                clickTimerRef.current = null;
                              }
                              return;
                            }
                            if (clickTimerRef.current !== null) {
                              window.clearTimeout(clickTimerRef.current);
                            }
                            clickTimerRef.current = window.setTimeout(() => {
                              clickTimerRef.current = null;
                              if (isFlipped) {
                                if (k === currentSpread - 1) turnPrev();
                              } else if (k === currentSpread) {
                                turnNext();
                              }
                            }, 195);
                          }}
                          className={`flip-page ${isFlipped ? 'is-flipped' : 'is-right'}`}
                        >
                          <div
                            className={`pageFace front folio-pen-surface ${activePenTool ? 'touch-none' : ''}`}
                            onDoubleClick={(e) => {
                              if (activePenTool === null && frontPageNum <= numPages) {
                                e.stopPropagation();
                                openTapOptionsMenu(frontPageNum, e.clientX, e.clientY, e.currentTarget);
                              }
                            }}
                            onPointerDown={(e) => handlePageSurfacePointerDown(frontPageNum, e)}
                            onPointerMove={(e) => handlePageSurfacePointerMove(frontPageNum, e)}
                            onPointerUp={(e) => handlePageSurfacePointerUp(frontPageNum, e)}
                            onPointerCancel={(e) => handlePageSurfacePointerUp(frontPageNum, e)}
                          >
                            {renderPageContent(frontPageNum, 'Blank Endpaper')}
                            <span className="absolute bottom-2 right-3 text-[10px] font-mono tabular-nums text-[#78716C]/80 pointer-events-none">
                              {frontPageNum <= numPages ? frontPageNum : ''}
                            </span>
                            <div className="pageFoldRight" />
                          </div>

                          <div
                            className={`pageFace back folio-pen-surface ${activePenTool ? 'touch-none' : ''}`}
                            onDoubleClick={(e) => {
                              if (activePenTool === null && backPageNum <= numPages) {
                                e.stopPropagation();
                                openTapOptionsMenu(backPageNum, e.clientX, e.clientY, e.currentTarget);
                              }
                            }}
                            onPointerDown={(e) => handlePageSurfacePointerDown(backPageNum, e)}
                            onPointerMove={(e) => handlePageSurfacePointerMove(backPageNum, e)}
                            onPointerUp={(e) => handlePageSurfacePointerUp(backPageNum, e)}
                            onPointerCancel={(e) => handlePageSurfacePointerUp(backPageNum, e)}
                          >
                            {renderPageContent(backPageNum, 'End of Volume')}
                            <span className="absolute bottom-2 left-3 text-[10px] font-mono tabular-nums text-[#78716C]/80 pointer-events-none">
                              {backPageNum <= numPages ? backPageNum : ''}
                            </span>
                            <div className="pageFoldLeft" />
                          </div>
                        </div>
                      );
                    })
                  : null}

                {!coverSettled ? (
                  <div
                    aria-hidden="true"
                    className={`cover-reveal-leaf ${coverOpened ? 'is-open' : ''} ${
                      coverFading ? 'is-settled' : ''
                    }`}
                  >
                    <div
                      style={bindingTheme ? { backgroundColor: bindingTheme.coverBg } : undefined}
                      className="pageFace front cover-sheen bg-[#22252d] flex items-center justify-center border-l border-black/40 rounded-r-[10px]"
                    >
                      {book.coverPath || coverPreviewUrl || pageImages[1] ? (
                        <img
                          src={book.coverPath || coverPreviewUrl || pageImages[1] || ''}
                          alt=""
                          crossOrigin={
                            isCrossOriginUrl(book.coverPath || coverPreviewUrl || '') &&
                            Boolean(apiBaseUrl) &&
                            (coverPreviewUrl || '').startsWith(apiBaseUrl!.trim().replace(/\/+$/, ''))
                              ? 'anonymous'
                              : undefined
                          }
                          onLoad={(e) => {
                            if (!bindingTheme) {
                              const extracted = extractBookBindingThemeFromImage(
                                e.currentTarget,
                                book.id,
                                book.sizeBytes
                              );
                              if (extracted) setBindingTheme(extracted);
                            }
                          }}
                          onError={() => {
                            if (coverPreviewUrl && !coverPreviewUrl.startsWith('data:')) {
                              setCoverPreviewUrl(pageImages[1] || null);
                            }
                          }}
                          className="w-full h-full object-cover object-top"
                        />
                      ) : (
                        <Loader2 className="w-6 h-6 animate-spin text-[#f3c677]" />
                      )}
                    </div>

                    <div className="pageFace back bg-gradient-to-r from-[#ece7dc] via-[#f5f1e8] to-[#e1dbd0]" />
                  </div>
                ) : null}
              </div>

              {keeperRevealed && displayKeptPage !== null && (displayKeptOnLeft || displayKeptOnRight) ? (
                <button
                  key={`spread-keeper-${displayKeptPage}-${displayKeptOnLeft ? 'L' : 'R'}`}
                  type="button"
                  onClick={() => toggleBookKeeperAtPage(displayKeptPage)}
                  style={getBookKeeperRibbonStyle(activeKeeperColor)}
                  title={
                    keptPage === displayKeptPage
                      ? `${BOOK_KEEPER_PALETTE[activeKeeperColor].label} Book Keeper at Page ${displayKeptPage} — click to remove`
                      : `Place ${BOOK_KEEPER_PALETTE[activeKeeperColor].label} Book Keeper at Page ${displayKeptPage}`
                  }
                  aria-label={`Toggle Book Keeper at Page ${displayKeptPage}`}
                  className={`reader-book-keeper-ribbon absolute -top-2 z-[120] flex flex-col items-center justify-end cursor-pointer ${
                    displayKeptOnLeft ? 'left-[10%]' : 'right-[10%]'
                  }`}
                >
                  <span
                    style={{ color: BOOK_KEEPER_PALETTE[activeKeeperColor].text }}
                    className="text-[9px] font-mono font-bold tabular-nums leading-none"
                  >
                    p.{displayKeptPage}
                  </span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {!docError && numPages > 0 ? (
        <div
          className={`mt-3 sm:mt-4 flex flex-wrap items-center justify-center sm:justify-between gap-2 sm:gap-3 w-[min(94vw,1080px)] sm:w-[min(92vw,1080px)] text-xs text-white/85 transition-opacity duration-500 ${
            coverOpened ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              disabled={currentSpread <= 0}
              onClick={turnPrev}
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 disabled:opacity-35 backdrop-blur-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span className="sm:hidden">Prev</span>
              <span className="hidden sm:inline">Previous Page</span>
            </button>
            <button
              type="button"
              disabled={currentSpread >= totalLeaves}
              onClick={turnNext}
              className="inline-flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 disabled:opacity-35 backdrop-blur-md transition-colors whitespace-nowrap cursor-pointer"
            >
              <span className="sm:hidden">Next</span>
              <span className="hidden sm:inline">Next Page</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5 sm:gap-2">
            <label htmlFor="flipbook-page-input" className="text-white/75 hidden sm:inline">
              Page
            </label>
            <input
              id="flipbook-page-input"
              type="number"
              min={1}
              max={numPages}
              value={jumpValue}
              onChange={(e) => setJumpValue(e.target.value)}
              className="w-12 sm:w-16 rounded-md bg-black/45 border border-white/15 px-1.5 sm:px-2 py-1 text-center font-mono tabular-nums text-white focus:outline-none focus:border-[#f3c677]"
            />
            <span className="font-mono tabular-nums text-white/75">/ {numPages}</span>
            <button
              type="submit"
              className="px-2 sm:px-2.5 py-1 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 text-white font-medium transition-colors cursor-pointer"
            >
              Go
            </button>
          </form>

          <div className="flex flex-wrap items-center justify-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => toggleBookKeeperAtPage(primarySpreadPage)}
              style={
                keptOnCurrentSpread
                  ? {
                      backgroundColor: BOOK_KEEPER_PALETTE[activeKeeperColor].buttonBg,
                      borderColor: BOOK_KEEPER_PALETTE[activeKeeperColor].buttonBorder,
                      color: '#ffffff',
                      boxShadow: BOOK_KEEPER_PALETTE[activeKeeperColor].glow,
                    }
                  : {
                      color: BOOK_KEEPER_PALETTE[activeKeeperColor].buttonMutedText,
                    }
              }
              title={
                keptOnCurrentSpread && keptPage !== null
                  ? `Book Keeper active at Page ${keptPage} — click to clear`
                  : `Place ${BOOK_KEEPER_PALETTE[activeKeeperColor].label} Book Keeper on Page ${primarySpreadPage}`
              }
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md border backdrop-blur-md transition-colors whitespace-nowrap cursor-pointer ${
                keptOnCurrentSpread
                  ? ''
                  : 'bg-black/45 hover:bg-black/70 border-white/10 hover:text-white'
              }`}
            >
              <Bookmark
                className="w-3.5 h-3.5"
                fill={keptOnCurrentSpread ? 'currentColor' : 'none'}
              />
              <span>
                {keptOnCurrentSpread && keptPage !== null
                  ? `Kept · p.${keptPage}`
                  : `Keep p.${primarySpreadPage}`}
              </span>
            </button>

            <div
              role="group"
              aria-label="Book Keeper ribbon color"
              className="inline-flex items-center gap-1 px-2 py-1.5 rounded-md bg-black/45 border border-white/10 backdrop-blur-md"
            >
              {BOOK_KEEPER_COLORS.map((c) => {
                const entry = BOOK_KEEPER_PALETTE[c];
                const active = activeKeeperColor === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => selectKeeperColorAtPage(c, primarySpreadPage)}
                    title={`${entry.label} Book Keeper`}
                    aria-label={`Use ${entry.label} Book Keeper`}
                    aria-pressed={active}
                    style={{ backgroundColor: entry.swatch }}
                    className={`w-3.5 h-3.5 rounded-full transition-transform cursor-pointer ${
                      active
                        ? 'ring-2 ring-white ring-offset-1 ring-offset-black/70 scale-110'
                        : 'opacity-75 hover:opacity-100 hover:scale-110'
                    }`}
                  />
                );
              })}
            </div>

            {keptPage !== null && !keptOnCurrentSpread ? (
              <button
                type="button"
                onClick={() => {
                  const clamped = Math.max(1, Math.min(numPages, keptPage));
                  setActiveFlipLeaf(null);
                  setCurrentSpread(Math.floor(clamped / 2));
                }}
                style={{
                  backgroundColor: BOOK_KEEPER_PALETTE[activeKeeperColor].jumpBg,
                  borderColor: BOOK_KEEPER_PALETTE[activeKeeperColor].buttonBorder,
                  color: BOOK_KEEPER_PALETTE[activeKeeperColor].jumpText,
                }}
                title={`Jump to bookmarked Page ${keptPage}`}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border font-mono tabular-nums transition-opacity hover:opacity-90 whitespace-nowrap cursor-pointer"
              >
                Go p.{keptPage}
              </button>
            ) : null}

            <div
              role="group"
              aria-label="Fountain pen tools"
              className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md bg-black/45 border border-white/10 backdrop-blur-md"
            >
              <button
                type="button"
                aria-pressed={activePenTool === 'mark'}
                onClick={() => setActivePenTool((prev) => (prev === 'mark' ? null : 'mark'))}
                title={activePenTool === 'mark' ? 'Exit Mark pen' : 'Arm Mark highlighter pen'}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border transition-colors whitespace-nowrap cursor-pointer ${
                  activePenTool === 'mark'
                    ? 'bg-amber-400/20 border-amber-300/60 text-amber-200'
                    : 'border-transparent text-white/75 hover:text-white hover:bg-white/10'
                }`}
              >
                <Highlighter className="w-3.5 h-3.5 text-amber-300" />
                <span>Mark</span>
              </button>
              <button
                type="button"
                aria-pressed={activePenTool === 'circle'}
                onClick={() => setActivePenTool((prev) => (prev === 'circle' ? null : 'circle'))}
                title={activePenTool === 'circle' ? 'Exit Circle pen' : 'Arm Circle ink pen'}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border transition-colors whitespace-nowrap cursor-pointer ${
                  activePenTool === 'circle'
                    ? 'bg-rose-500/25 border-rose-300/60 text-rose-200'
                    : 'border-transparent text-white/75 hover:text-white hover:bg-white/10'
                }`}
              >
                <Circle className="w-3.5 h-3.5 text-rose-300" />
                <span>Circle</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setSingleZoom((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-md bg-black/45 hover:bg-black/70 border border-white/10 backdrop-blur-md transition-colors whitespace-nowrap cursor-pointer"
            >
              {singleZoom ? (
                <>
                  <Minimize2 className="w-3.5 h-3.5" />
                  <span className="sm:hidden">3D Book</span>
                  <span className="hidden sm:inline">3D Spread View</span>
                </>
              ) : (
                <>
                  <Maximize2 className="w-3.5 h-3.5" />
                  <span className="sm:hidden">Single Page</span>
                  <span className="hidden sm:inline">Zoom Single Pages</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : null}

      <FolioPenCursor
        active={!closing && !docError && numPages > 0 && !tapMenu}
        mode={activePenTool ?? 'read'}
      />

      {tapMenu && numPages > 0 ? (
        <DoubleTapFabMenu
          anchor={tapMenu}
          onClose={() => setTapMenu(null)}
          onZoom={() => {
            const target = tapMenu;
            setTapMenu(null);
            openPageFocusAtNormalized(target.pageNum, target.rx, target.ry);
          }}
          onMark={() => {
            const target = tapMenu;
            setTapMenu(null);
            toggleAnnotationAtPoint('mark', target.pageNum, target.rx, target.ry);
          }}
          onCircle={() => {
            const target = tapMenu;
            setTapMenu(null);
            toggleAnnotationAtPoint('circle', target.pageNum, target.rx, target.ry);
          }}
        />
      ) : null}

      {focusAnchor && numPages > 0 ? (
        <FocusedPageOverlay
          anchor={focusAnchor}
          numPages={numPages}
          pageImages={pageImages}
          hiResImages={hiResImages}
          pageErrors={pageErrors}
          keptPage={displayKeptPage ?? keptPage}
          keeperColor={activeKeeperColor}
          annotations={annotations.filter((item) => item.pageNum === focusAnchor.pageNum)}
          freshIds={freshAnnotationIds}
          activePenTool={activePenTool}
          onChangePenTool={setActivePenTool}
          onAddStamp={toggleAnnotationAtPoint}
          onAddStroke={addFreehandAnnotation}
          onRemoveAnnotation={removeAnnotationById}
          onToggleBookmark={(pageNum) => toggleBookKeeperAtPage(pageNum)}
          onSelectKeeperColor={(color, pageNum) => selectKeeperColorAtPage(color, pageNum)}
          onRequestHiRes={(pageNum) => {
            void renderPdfPage(pageNum);
            void renderHiResPage(pageNum);
          }}
          onChangePage={(nextPage) => {
            hasInteractedRef.current = true;
            const clamped = Math.max(1, Math.min(numPages, nextPage));
            const targetSpread = Math.floor(clamped / 2);
            pendingCommittedPageRef.current = clamped;
            setActiveFlipLeaf(null);
            setCurrentSpread(targetSpread);
            if (targetSpread === currentSpread) {
              pendingCommittedPageRef.current = null;
              commitPageProgress(clamped);
            }
            void renderPdfPage(clamped);
            void renderHiResPage(clamped);
            setFocusAnchor({ pageNum: clamped, rx: 0.5, ry: 0.24 });
          }}
          onClose={() => setFocusAnchor(null)}
        />
      ) : null}
    </div>
  );
}

interface PdfReaderModalProps {
  book: VaultBook | null;
  originRect: PocketOriginRect | null;
  apiBaseUrl?: string;
  pdfAssetsBaseUrl?: string;
  hasBackend?: boolean;
  onClose: () => void;
  onUpdate: (updated: VaultBook) => void;
  onDelete?: (book: VaultBook) => Promise<void>;
}

const READING_STATUS_OPTIONS: Array<{ value: ReadingStatus; label: string }> = [
  { value: 'unread', label: 'Unread' },
  { value: 'reading', label: 'Reading' },
  { value: 'completed', label: 'Completed' },
];

export function PdfReaderModal({
  book,
  originRect,
  apiBaseUrl,
  pdfAssetsBaseUrl,
  hasBackend = true,
  onClose,
  onUpdate,
  onDelete,
}: PdfReaderModalProps) {
  const [notes, setNotes] = useState('');
  const [readingStatus, setReadingStatus] = useState<ReadingStatus>('unread');
  const [showNotes, setShowNotes] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedNotice, setSavedNotice] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [backdropVisible, setBackdropVisible] = useState(false);

  const closeTimerRef = useRef<number | null>(null);
  const showNotesRef = useRef(showNotes);
  const bookId = book?.id ?? null;

  useEffect(() => {
    showNotesRef.current = showNotes;
  }, [showNotes]);

  useEffect(() => {
    if (bookId && book) {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setNotes(book.notes || '');
      setReadingStatus(book.readingStatus || 'unread');
      setShowNotes(false);
      setSavedNotice(false);
      setConfirmRemove(false);
      setRemoving(false);
      setError(null);
      setClosing(false);
      setBackdropVisible(false);
      const raf = window.requestAnimationFrame(() => {
        setBackdropVisible(true);
      });
      return () => window.cancelAnimationFrame(raf);
    }
  }, [bookId]);

  useEffect(() => {
    if (book) {
      setReadingStatus(book.readingStatus || 'unread');
    }
  }, [book?.readingStatus]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, []);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setBackdropVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, 240);
  }, [closing, onClose]);

  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  }, [requestClose]);

  useEffect(() => {
    if (!bookId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showNotesRef.current) {
          setShowNotes(false);
        } else {
          requestCloseRef.current();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [bookId]);

  if (!book) return null;

  async function handleSave(nextStatus?: ReadingStatus) {
    if (!book) return;
    setSaving(true);
    setError(null);
    setSavedNotice(false);
    const resolvedStatus = nextStatus ?? readingStatus;
    try {
      const currentProgress = resolveBookProgress(book);
      saveLocalBookProgress(book.id, {
        ...currentProgress,
        readingStatus: resolvedStatus,
        updatedAt: new Date().toISOString(),
      });

      if (!hasBackend) {
        onUpdate({
          ...book,
          notes,
          readingStatus: resolvedStatus,
        });
        setSavedNotice(true);
        return;
      }

      const res = await fetch(joinApiUrl(apiBaseUrl, `/api/vault/${encodeURIComponent(book.id)}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes,
          readingStatus: resolvedStatus,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not save notes.');
      }
      onUpdate(data.item);
      setSavedNotice(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!book || !onDelete) return;
    setRemoving(true);
    setError(null);
    try {
      await onDelete(book);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove book.');
      setRemoving(false);
    }
  }

  return (
    <div
      className={`fixed inset-0 h-dvh z-50 flex items-center justify-center px-2.5 pt-14 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6 transition-all duration-500 ${
        backdropVisible ? 'bg-[#091214]/90 opacity-100' : 'bg-[#091214]/0 opacity-0'
      }`}
      role="dialog"
      aria-modal="true"
      aria-label={book.title}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          requestClose();
        }
      }}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-0 transition-opacity duration-700 ${
          backdropVisible ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          background:
            'radial-gradient(ellipse 60% 56% at 50% 48%, rgba(143, 224, 207, 0.12), transparent 70%)',
        }}
      />
      <div className="fixed top-[max(0.75rem,env(safe-area-inset-top))] right-3 sm:top-5 sm:right-6 z-30 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setShowNotes((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
            showNotes
              ? 'bg-[#e4eeef] text-[#112224] border-[#e4eeef]'
              : 'bg-[#0c181a]/85 text-white border-white/15 hover:bg-[#0c181a]'
          }`}
        >
          <NotebookPen className="w-3.5 h-3.5" />
          Notes
        </button>

        <button
          type="button"
          onClick={requestClose}
          aria-label="Close book"
          className="p-2 text-white/80 hover:text-white rounded-md bg-[#0c181a]/85 border border-white/15 hover:bg-[#0c181a] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        className="w-full h-full flex items-center justify-center pointer-events-none"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            requestClose();
          }
        }}
      >
        <div className="pointer-events-auto w-full flex flex-col items-center justify-center">
          <FlipBookReader
            book={book}
            originRect={originRect}
            closing={closing}
            apiBaseUrl={apiBaseUrl}
            pdfAssetsBaseUrl={pdfAssetsBaseUrl}
            hasBackend={hasBackend}
            onBookUpdate={onUpdate}
          />
        </div>
      </div>

      {showNotes ? (
        <aside
          className="fixed top-14 left-3 right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] sm:top-16 sm:left-auto sm:right-6 sm:bottom-6 sm:w-[360px] z-40 flex flex-col bg-[#F8F6F1] text-[#1A1816] border border-[#DFD9CE] rounded-lg p-4 sm:p-5 shadow-2xl overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="pb-3 border-b border-[#E7E2D8]">
            <h2 className="font-serif text-base font-medium text-[#1A1816] line-clamp-1">
              {book.title}
            </h2>
            <p className="text-xs text-[#57534E] mt-0.5 truncate">{book.author}</p>
          </div>

          <div className="mt-4">
            <span className="text-xs font-medium text-[#57534E]">Reading Progress</span>
            <div className="mt-2 grid grid-cols-3 gap-1 p-1 bg-[#EDE8DD] rounded-md border border-[#DFD9CE]">
              {READING_STATUS_OPTIONS.map((opt) => {
                const active = readingStatus === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setReadingStatus(opt.value);
                      void handleSave(opt.value);
                    }}
                    className={`px-2 py-1.5 text-xs font-medium rounded transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-white text-[#1A1816] border border-[#DFD9CE]'
                        : 'text-[#57534E] hover:text-[#1A1816]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-5 flex-1 flex flex-col">
            <label
              htmlFor="vault-book-notes"
              className="text-xs font-medium text-[#57534E]"
            >
              Personal Study Notes &amp; Key Takeaways
            </label>
            <textarea
              id="vault-book-notes"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                setSavedNotice(false);
              }}
              placeholder="Record page citations, investing principles, or chapter summaries..."
              className="mt-2 flex-1 min-h-[140px] sm:min-h-[200px] w-full resize-none rounded-md border border-[#DFD9CE] bg-white p-3 text-sm leading-relaxed text-[#1A1816] placeholder:text-[#A8A29E] focus:outline-none focus:border-[#14532D]"
            />
          </div>

          {error ? (
            <p className="mt-3 text-xs text-[#991B1B]" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-3 pt-4 border-t border-[#E7E2D8]">
            <div className="text-xs text-[#57534E]">
              {savedNotice ? (
                <span className="inline-flex items-center gap-1 text-[#14532D] font-medium">
                  <Check className="w-3.5 h-3.5" />
                  Notes saved
                </span>
              ) : onDelete ? (
                confirmRemove ? (
                  <span className="inline-flex items-center gap-2">
                    <button
                      type="button"
                      disabled={removing}
                      onClick={() => void handleDelete()}
                      className="text-xs font-medium text-[#991B1B] underline underline-offset-2"
                    >
                      {removing ? 'Removing...' : 'Confirm remove'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(false)}
                      className="text-xs text-[#57534E]"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmRemove(true)}
                    className="inline-flex items-center gap-1 text-xs text-[#78716C] hover:text-[#991B1B] transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Remove
                  </button>
                )
              ) : null}
            </div>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSave()}
              className="px-4 py-2 text-xs font-medium text-white bg-[#14532D] rounded-md hover:bg-[#166534] disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              {saving ? 'Saving...' : 'Save Notes'}
            </button>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

interface FloatingBookSlotProps {
  book: VaultBook;
  depth: number;
  priority: boolean;
  apiBaseUrl?: string;
  pdfAssetsBaseUrl?: string;
  hasBackend: boolean;
  onSelect: (book: VaultBook, buttonEl: HTMLButtonElement) => void;
}

function FloatingBookSlot({
  book,
  depth,
  priority,
  apiBaseUrl,
  pdfAssetsBaseUrl,
  hasBackend,
  onSelect,
}: FloatingBookSlotProps) {
  const slotRef = useRef<HTMLLIElement>(null);
  const rattleTimerRef = useRef<number | null>(null);
  const rattleRafRef = useRef<number | null>(null);
  const [inView, setInView] = useState(priority);
  const [isLocked, setIsLocked] = useState(true);
  const [rattleNonce, setRattleNonce] = useState(0);
  const [isRattling, setIsRattling] = useState(false);
  const [bindingTheme, setBindingTheme] = useState<BookBindingTheme | null>(() =>
    getCachedBookBindingTheme(book.id, book.sizeBytes)
  );

  useEffect(() => {
    const node = slotRef.current;
    if (!node) return;
    return observeElementVisibility(node, setInView);
  }, []);

  useEffect(() => {
    return () => {
      if (rattleTimerRef.current !== null) {
        window.clearTimeout(rattleTimerRef.current);
      }
      if (rattleRafRef.current !== null) {
        window.cancelAnimationFrame(rattleRafRef.current);
      }
    };
  }, []);

  const keptPage = getBookKeptPage(book);
  const labelText = keptPage
    ? `${book.title} — ${book.author} (Kept at Page ${keptPage})`
    : `${book.title} — ${book.author}`;

  function handleBookPress(buttonEl: HTMLButtonElement) {
    if (isLocked) {
      setRattleNonce((n) => n + 1);
      setIsRattling(false);
      if (rattleRafRef.current !== null) {
        window.cancelAnimationFrame(rattleRafRef.current);
      }
      rattleRafRef.current = window.requestAnimationFrame(() => {
        setIsRattling(true);
        rattleRafRef.current = null;
      });
      if (rattleTimerRef.current !== null) {
        window.clearTimeout(rattleTimerRef.current);
      }
      rattleTimerRef.current = window.setTimeout(() => {
        setIsRattling(false);
        rattleTimerRef.current = null;
      }, 460);
      try {
        navigator.vibrate?.([14, 24, 10]);
      } catch {
        // Ignore on browsers without Vibration API
      }
      return;
    }
    onSelect(book, buttonEl);
  }

  return (
    <li
      ref={slotRef}
      data-depth={depth}
      data-inview={inView ? 'true' : 'false'}
      data-locked={isLocked ? 'true' : 'false'}
      className={`air-book-slot ${isRattling ? 'is-rattling' : ''}`}
    >
      <div className="air-book-float">
        <button
          type="button"
          title={isLocked ? `${labelText} — Locked` : labelText}
          onClick={(e) => handleBookPress(e.currentTarget)}
          aria-label={isLocked ? `${labelText} — Locked` : `Open ${labelText}`}
          className="air-book-hit focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1a6064] rounded-md"
        >
          <div
            className="air-book-body"
            style={!isLocked ? getBookBindingCssVars(bindingTheme) : undefined}
          >
            <span className="air-book-shadow-plane" aria-hidden="true" />
            <span className="air-book-back" aria-hidden="true" />
            <span className="air-book-spine" aria-hidden="true" />
            <span className="air-book-pages" aria-hidden="true" />
            <span className="air-book-top" aria-hidden="true" />
            <span className="air-book-bottom" aria-hidden="true" />
            {keptPage !== null ? (
              <span className="air-book-keeper-wrap" aria-hidden="true">
                <span
                  className="air-book-keeper"
                  style={getBookKeeperRibbonStyle(getBookKeeperColor(book))}
                >
                  <span className="air-book-keeper-label">p.{keptPage}</span>
                </span>
              </span>
            ) : null}
            <div className="air-book-cover">
              <PdfCoverImage
                bookId={book.id}
                sizeBytes={book.sizeBytes}
                title={book.title}
                coverPath={book.coverPath}
                sourceUrl={book.sourceUrl}
                apiBaseUrl={apiBaseUrl}
                pdfAssetsBaseUrl={pdfAssetsBaseUrl}
                hasBackend={hasBackend}
                priority={priority}
                inView={inView}
                rattleTrigger={rattleNonce}
                onLockedChange={setIsLocked}
                onBindingTheme={setBindingTheme}
              />
            </div>
          </div>
        </button>
      </div>
    </li>
  );
}

interface VaultApiPayload {
  items: VaultBook[];
  totalBytes?: number;
}

export function FolioVaultPlugin({
  apiBaseUrl,
  pdfAssetsBaseUrl,
  books: externalBooks,
  showBackground = true,
  allowDelete = true,
  injectStyles = true,
  className = '',
  onSelectBook,
  onBooksLoaded,
}: FolioVaultPluginProps = {}) {
  const [books, setBooks] = useState<VaultBook[]>(() =>
    externalBooks
      ? [...externalBooks].sort((a, b) => a.title.localeCompare(b.title))
      : []
  );
  const [hasBackend, setHasBackend] = useState(!externalBooks || Boolean(apiBaseUrl));
  const [loading, setLoading] = useState(!externalBooks);
  const [error, setError] = useState<string | null>(null);

  const [activeBook, setActiveBook] = useState<VaultBook | null>(null);
  const [originRect, setOriginRect] = useState<PocketOriginRect | null>(null);
  const stageRootRef = useRef<HTMLDivElement>(null);
  const onBooksLoadedRef = useRef(onBooksLoaded);

  useEffect(() => {
    onBooksLoadedRef.current = onBooksLoaded;
  }, [onBooksLoaded]);

  useEffect(() => {
    if (injectStyles) {
      ensurePluginStylesInjected();
    }
  }, [injectStyles]);

  const loadBooks = useCallback(async () => {
    if (externalBooks) {
      const sorted = [...externalBooks].sort((a, b) => a.title.localeCompare(b.title));
      setBooks(sorted);
      setHasBackend(Boolean(apiBaseUrl));
      setLoading(false);
      setError(null);
      onBooksLoadedRef.current?.(sorted);
      return;
    }

    try {
      const res = await fetch(joinApiUrl(apiBaseUrl, '/api/vault'));
      if (!res.ok) {
        throw new Error('Could not load stored books.');
      }
      const data = (await res.json()) as VaultApiPayload;
      const sorted = [...(data.items || [])].sort((a, b) => a.title.localeCompare(b.title));
      setBooks(sorted);
      setHasBackend(true);
      setError(null);
      onBooksLoadedRef.current?.(sorted);
    } catch {
      const fallback = [...FOLIO_VAULT_BOOKS].sort((a, b) => a.title.localeCompare(b.title));
      setBooks(fallback);
      setHasBackend(false);
      setError(null);
      onBooksLoadedRef.current?.(fallback);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, externalBooks]);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  useEffect(() => {
    const root = stageRootRef.current;
    if (!root) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      root.style.setProperty('--keeper-swing', '0');
      return;
    }

    let pos = 0;
    let vel = 0;
    let lastScrollY = window.scrollY;
    let lastTs = 0;
    let rafId = 0;

    const stiffness = 135;
    const damping = 11.5;

    const step = (ts: number) => {
      const dt = lastTs ? Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000)) : 1 / 60;
      lastTs = ts;

      const force = -stiffness * pos - damping * vel;
      vel += force * dt;
      pos += vel * dt;
      if (pos > 1.2) {
        pos = 1.2;
        vel *= 0.5;
      } else if (pos < -1.2) {
        pos = -1.2;
        vel *= 0.5;
      }

      root.style.setProperty('--keeper-swing', pos.toFixed(4));

      if (Math.abs(pos) < 0.002 && Math.abs(vel) < 0.002) {
        pos = 0;
        vel = 0;
        lastTs = 0;
        rafId = 0;
        root.style.setProperty('--keeper-swing', '0');
        return;
      }

      rafId = window.requestAnimationFrame(step);
    };

    const onScroll = () => {
      const currentY = window.scrollY;
      const dy = currentY - lastScrollY;
      lastScrollY = currentY;
      if (Math.abs(dy) < 0.25) return;

      const impulse = Math.max(-2.6, Math.min(2.6, dy * 0.065));
      vel = Math.max(-7.5, Math.min(7.5, vel + impulse));

      if (!rafId) {
        lastTs = 0;
        rafId = window.requestAnimationFrame(step);
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  async function handleDeleteBook(book: VaultBook) {
    if (!hasBackend) return;
    const res = await fetch(joinApiUrl(apiBaseUrl, `/api/vault/${encodeURIComponent(book.id)}`), {
      method: 'DELETE',
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Could not remove book.');
    }
    setActiveBook(null);
    await loadBooks();
  }

  return (
    <>
      {showBackground ? <FloatingBooksBackground paused={Boolean(activeBook)} /> : null}

      <div ref={stageRootRef} className={`relative z-10 min-h-dvh flex flex-col ${className}`}>
        <main className="flex-1">
          {error ? (
            <div className="max-w-xl mx-auto px-4 pt-6">
              <div
                role="alert"
                className="px-4 py-3 bg-[#fef2f2]/95 border border-[#991b1b]/25 rounded-md text-sm text-[#7f1d1d]"
              >
                {error}
              </div>
            </div>
          ) : null}

          {loading ? (
            <div className="min-h-dvh flex items-center justify-center px-6">
              <Loader2 className="w-6 h-6 text-[#7fd4cb] animate-spin" aria-label="Loading books" />
            </div>
          ) : (
            <ul className="air-books-stage" aria-label="Floating 3D books library">
              {books.map((book, idx) => (
                <FloatingBookSlot
                  key={book.id}
                  book={book}
                  depth={DEPTH_PLANES[idx % DEPTH_PLANES.length]}
                  priority={idx < 12}
                  apiBaseUrl={apiBaseUrl}
                  pdfAssetsBaseUrl={pdfAssetsBaseUrl}
                  hasBackend={hasBackend}
                  onSelect={(selected, buttonEl) => {
                    const coverNode = buttonEl.querySelector('.air-book-cover');
                    const rect = (coverNode || buttonEl).getBoundingClientRect();
                    setOriginRect({
                      left: rect.left,
                      top: rect.top,
                      width: rect.width,
                      height: rect.height,
                    });
                    setActiveBook(selected);
                    onSelectBook?.(selected);
                  }}
                />
              ))}
            </ul>
          )}
        </main>

        <PdfReaderModal
          book={activeBook}
          originRect={originRect}
          apiBaseUrl={apiBaseUrl}
          pdfAssetsBaseUrl={pdfAssetsBaseUrl}
          hasBackend={hasBackend}
          onClose={() => {
            setActiveBook(null);
            setOriginRect(null);
          }}
          onUpdate={(updated) => {
            setBooks((prev) => prev.map((b) => (b.id === updated.id ? updated : b)));
            setActiveBook((prev) => (prev && prev.id === updated.id ? updated : prev));
          }}
          onDelete={allowDelete && hasBackend ? handleDeleteBook : undefined}
        />
      </div>
    </>
  );
}

export function mountFolioVaultPlugin(
  target: HTMLElement | string,
  props: FolioVaultPluginProps = {}
): FolioVaultPluginMountHandle {
  const host = typeof target === 'string' ? document.querySelector<HTMLElement>(target) : target;
  if (!host) {
    throw new Error(`FolioVaultPlugin mount target not found: ${String(target)}`);
  }

  let currentProps: FolioVaultPluginProps = { ...props };
  const root: Root = createRoot(host);
  root.render(<FolioVaultPlugin {...currentProps} />);

  return {
    update(nextProps = {}) {
      currentProps = { ...currentProps, ...nextProps };
      root.render(<FolioVaultPlugin {...currentProps} />);
    },
    unmount() {
      root.unmount();
    },
  };
}

export default FolioVaultPlugin;
