export type RightsCategory = 'public_domain' | 'controlled_lending';

export type ReadingStatus = 'unread' | 'reading' | 'completed';

export type BookKeeperColor =
  | 'crimson'
  | 'emerald'
  | 'sapphire'
  | 'amber'
  | 'violet'
  | 'teal';

export interface RequestedBookSpec {
  bookKey: string;
  accessionCode: string;
  title: string;
  subtitle: string;
  author: string;
  year: number;
  rights: RightsCategory;
  rightsLabel: string;
  rightsExplanation: string;
  coverPath: string;
  archiveIdentifier: string;
  alternateArchiveIdentifiers?: string[];
  preferredPdfFilename?: string;
  openLibraryUrl: string;
  archiveDetailsUrl: string;
  secondarySources: Array<{
    label: string;
    url: string;
  }>;
  summary: string;
  storedItem: VaultBook | null;
}

export interface ArchivePdfFile {
  name: string;
  sizeBytes: number;
  format: string;
  downloadUrl: string;
}

export interface ArchiveInspection {
  identifier: string;
  title: string;
  creator: string;
  year: string;
  isRestricted: boolean;
  detailsUrl: string;
  borrowUrl: string;
  freePdfs: ArchivePdfFile[];
}

export interface ArchiveSearchHit {
  identifier: string;
  title: string;
  creator: string;
  year: string;
  hasTextPdf: boolean;
  hasEncryptedPdf: boolean;
  detailsUrl: string;
}

export interface SwingTradeEbook {
  bookKey: string;
  indexNumber: number;
  title: string;
  authorOrFocus: string;
  description: string;
  filename: string;
  pdfUrl: string;
  sourcePageUrl: string;
  available: boolean | null;
  expectedSizeBytes: number | null;
  storedItem: VaultBook | null;
}

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
