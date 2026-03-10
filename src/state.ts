import type { SupabaseClient } from '@supabase/supabase-js';
import type { PolyEvent, Filters } from './types.ts';

// ─── 중앙 상태 관리 ───

export let supabaseClient: SupabaseClient | null = null;
export let allEvents: PolyEvent[] = [];
export let currentDate: Date = new Date();
export let calendarOverviewStartWeek = 0;
export let isLoadingMore = false;

export let filters: Filters = {
    tags: [],
    excludedCategories: ['Sports'],
    timeRemaining: 'all',
    minVolume: 1000,
    minLiquidity: 0
};

export let tempFilters: Filters = { ...filters };

export let allTags: Record<string, number> = {};
export let allCategories: Record<string, number> = {};

export let tooltipElement: HTMLDivElement | null = null;
export let tooltipTimeout: ReturnType<typeof setTimeout> | null = null;

export let isAdminMode = false;
export let v2EditingEventId: string | null = null;

export type PageTab = 'calendar' | 'korea' | 'surebet';
export let currentTab: PageTab = 'calendar';
export let koreaEvents: PolyEvent[] = [];
export let koreaSort: 'endDate' | 'volume' | 'probability' = 'endDate';
export let koreaSelectedCategory: string | null = null;
export let sureBetEvents: PolyEvent[] = [];
export let sureBetSort: 'return' | 'annualized' | 'endDate' | 'volume' = 'annualized';
export let sureBetMinProb: number = 90;
export let sureBetSelectedCategory: string | null = null;
export let sureBetRefreshInterval: ReturnType<typeof setInterval> | null = null;
export let sureBetLastUpdate: number = 0;
export let sureBetIsRefreshing: boolean = false;

// ─── Setters ───

export function setSupabaseClient(client: SupabaseClient): void { supabaseClient = client; }
export function setAllEvents(events: PolyEvent[]): void { allEvents = events; }
export function setCurrentDate(date: Date): void { currentDate = date; }
export function setCalendarOverviewStartWeek(week: number): void { calendarOverviewStartWeek = week; }
export function setIsLoadingMore(loading: boolean): void { isLoadingMore = loading; }
export function setFilters(f: Filters): void { filters = f; }
export function setTempFilters(f: Filters): void { tempFilters = f; }
export function setAllTags(tags: Record<string, number>): void { allTags = tags; }
export function setAllCategories(cats: Record<string, number>): void { allCategories = cats; }
export function setTooltipElement(el: HTMLDivElement): void { tooltipElement = el; }
export function setTooltipTimeout(t: ReturnType<typeof setTimeout> | null): void { tooltipTimeout = t; }
export function setIsAdminMode(mode: boolean): void { isAdminMode = mode; }
export function setV2EditingEventId(id: string | null): void { v2EditingEventId = id; }
export function setCurrentTab(tab: PageTab): void { currentTab = tab; }
export function setKoreaEvents(events: PolyEvent[]): void { koreaEvents = events; }
export function setKoreaSort(sort: 'endDate' | 'volume' | 'probability'): void { koreaSort = sort; }
export function setKoreaSelectedCategory(cat: string | null): void { koreaSelectedCategory = cat; }
export function setSureBetEvents(events: PolyEvent[]): void { sureBetEvents = events; }
export function setSureBetSort(sort: 'return' | 'annualized' | 'endDate' | 'volume'): void { sureBetSort = sort; }
export function setSureBetMinProb(prob: number): void { sureBetMinProb = prob; }
export function setSureBetSelectedCategory(cat: string | null): void { sureBetSelectedCategory = cat; }
export function setSureBetRefreshInterval(id: ReturnType<typeof setInterval> | null): void { sureBetRefreshInterval = id; }
export function setSureBetLastUpdate(ts: number): void { sureBetLastUpdate = ts; }
export function setSureBetIsRefreshing(v: boolean): void { sureBetIsRefreshing = v; }
