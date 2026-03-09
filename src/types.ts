// ─── 핵심 도메인 타입 ───

export interface PolyEvent {
  id: string;
  title: string;
  title_ko?: string | null;
  slug?: string;
  event_slug?: string;
  end_date: string;
  volume: number;
  volume_24hr?: number;
  probs: number[];
  category: string;
  closed?: boolean;
  image_url?: string | null;
  tags?: string[];
  hidden?: boolean;
  description?: string | null;
  description_ko?: string | null;
  liquidity?: number;
  outcomes?: string[];
  _totalVolume?: number;
  _groupSize?: number;
}

export interface Filters {
  tags: string[];
  excludedCategories: string[];
  timeRemaining: string | number;
  minVolume: number;
  minLiquidity: number;
}

export type Category =
  | 'Sports'
  | 'Crypto'
  | 'Politics'
  | 'Pop Culture'
  | 'Science'
  | 'Business'
  | 'Technology'
  | 'Gaming'
  | 'Music'
  | 'Finance'
  | 'Uncategorized';

export type Language = 'ko' | 'en';

export type Theme = 'dark' | 'light';
export type Density = 'comfortable' | 'compact' | 'spacious';

// ─── 번역 타입 ───

export interface TranslationSet {
  search: string;
  filters: string;
  clickToAdd: string;
  hideCategories: string;
  timeRemaining: string;
  minVolume: string;
  minLiquidity: string;
  tagsLabel: string;
  searchTagsPlaceholder: string;
  showMore: string;
  showLess: string;
  resetBtn: string;
  applyFiltersBtn: string;
  all: string;
  days: string;
  dataRangeInfo: string;
  refreshTooltip: string;
  categories: Record<string, string>;
  markets: string;
  events: string;
  noEvents: string;
  more: string;
  loading: string;
  noResults: string;
  volume: string;
  volume24hr: string;
  liquidity: string;
  probability: string;
  activeMarkets: string;
  activeMarketsDesc: string;
  totalLiquidity: string;
  totalLiquidityDesc: string;
  totalVolume: string;
  totalVolumeDesc: string;
  avgLiquidity: string;
  avgLiquidityDesc: string;
}

// ─── Window 글로벌 확장 (admin 브릿지) ───

declare global {
  interface Window {
    __v2OpenEditModal?: (eventId: string) => void;
    __v2ToggleHidden?: (eventId: string) => void;
  }
}
