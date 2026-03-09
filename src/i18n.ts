import { renderCalendar } from './render/index.ts';
import type { PolyEvent, Language, TranslationSet } from './types.ts';

// ─── 번역 데이터 ───

export const translations: Record<Language, TranslationSet> = {
    ko: {
        search: '시장 검색...',
        filters: '필터',
        clickToAdd: '클릭하여 필터 추가',
        hideCategories: '카테고리 숨기기',
        timeRemaining: '남은 시간',
        minVolume: '최소 거래량',
        minLiquidity: '최소 유동성',
        tagsLabel: '태그:',
        searchTagsPlaceholder: '태그 검색...',
        showMore: '더보기',
        showLess: '접기',
        resetBtn: '초기화',
        applyFiltersBtn: '필터 적용',
        all: '전체',
        days: '일',
        dataRangeInfo: '앞으로 30일 이내 이벤트만 표시',
        refreshTooltip: '과거 이벤트 숨기기',
        categories: {
            'Sports': '스포츠',
            'Crypto': '암호화폐',
            'Politics': '정치',
            'Finance': '금융',
            'Pop Culture': '대중문화',
            'Science': '과학',
            'Uncategorized': '미분류'
        },
        markets: '개 시장',
        events: '개 이벤트',
        noEvents: '이벤트 없음',
        more: '더보기',
        loading: '로딩 중...',
        noResults: '결과 없음',
        volume: '거래량',
        volume24hr: '24시간 거래량',
        liquidity: '유동성',
        probability: '확률',
        activeMarkets: '활성 시장',
        activeMarketsDesc: '현재 활성화된 시장',
        totalLiquidity: '총 유동성',
        totalLiquidityDesc: '모든 활성 시장의 유동성',
        totalVolume: '총 거래량',
        totalVolumeDesc: '모든 활성 시장의 거래량',
        avgLiquidity: '평균 유동성',
        avgLiquidityDesc: '시장당 평균 유동성'
    },
    en: {
        search: 'Search markets...',
        filters: 'Filters',
        clickToAdd: 'Click to add filters',
        hideCategories: 'Hide Categories',
        timeRemaining: 'Time remaining',
        minVolume: 'Min Volume',
        minLiquidity: 'Min Liquidity',
        tagsLabel: 'Tags:',
        searchTagsPlaceholder: 'Search tags...',
        showMore: 'Show More',
        showLess: 'Show Less',
        resetBtn: 'Reset',
        applyFiltersBtn: 'Apply Filters',
        all: 'All',
        days: 'd',
        dataRangeInfo: 'Showing events within the next 30 days',
        refreshTooltip: 'Hide past events',
        categories: {
            'Sports': 'Sports',
            'Crypto': 'Crypto',
            'Politics': 'Politics',
            'Finance': 'Finance',
            'Pop Culture': 'Pop Culture',
            'Science': 'Science',
            'Uncategorized': 'Uncategorized'
        },
        markets: ' markets',
        events: ' events',
        noEvents: 'No events',
        more: 'more',
        loading: 'Loading...',
        noResults: 'No results',
        volume: 'Volume',
        volume24hr: '24hr Volume',
        liquidity: 'Liquidity',
        probability: 'Probability',
        activeMarkets: 'Active Markets',
        activeMarketsDesc: 'Currently active markets',
        totalLiquidity: 'Total Liquidity',
        totalLiquidityDesc: 'Liquidity across all active markets',
        totalVolume: 'Total Volume',
        totalVolumeDesc: 'Volume across all active markets',
        avgLiquidity: 'Avg Liquidity',
        avgLiquidityDesc: 'Average liquidity per market'
    }
};

export let currentLang: Language = (localStorage.getItem('language') as Language) || 'ko';

export function getTitle(event: PolyEvent): string {
    if (currentLang === 'ko' && event.title_ko) {
        return event.title_ko;
    }
    return event.title;
}

export function getLocale(): string {
    return currentLang === 'ko' ? 'ko-KR' : 'en-US';
}

export function getTranslatedCategory(category: string): string {
    const t = translations[currentLang];
    return t.categories[category] || category;
}

export function translatePage(): void {
    const t = translations[currentLang];

    const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
    if (searchInput) searchInput.placeholder = t.search;

    const dataRangeInfo = document.getElementById('dataRangeInfo');
    if (dataRangeInfo) dataRangeInfo.textContent = t.dataRangeInfo;

    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.setAttribute('title', t.refreshTooltip);

    const filterLabels = document.querySelectorAll('.filter-label');
    filterLabels.forEach(label => {
        if (label.textContent?.trim().includes('Filter')) {
            const svg = label.querySelector('svg');
            label.textContent = t.filters;
            if (svg) label.prepend(svg);
        }
    });

    const filterPlaceholder = document.querySelector('.filter-placeholder');
    if (filterPlaceholder) filterPlaceholder.textContent = t.clickToAdd;

    document.querySelectorAll('.category-label').forEach(el => {
        const originalCategory = el.getAttribute('data-category');
        if (originalCategory && t.categories[originalCategory]) {
            el.textContent = t.categories[originalCategory];
        }
    });

    const langToggle = document.getElementById('langToggle');
    if (langToggle) {
        const langText = langToggle.querySelector('.lang-text');
        if (langText) langText.textContent = currentLang.toUpperCase();
    }

    const filterModalTitle = document.getElementById('filterModalTitle');
    if (filterModalTitle) filterModalTitle.textContent = t.filters;

    const filterTagsLabel = document.getElementById('filterTagsLabel');
    if (filterTagsLabel) filterTagsLabel.textContent = t.tagsLabel;

    const tagSearchInput = document.getElementById('tagSearchInput') as HTMLInputElement | null;
    if (tagSearchInput) tagSearchInput.placeholder = t.searchTagsPlaceholder;

    const filterCategoriesLabel = document.getElementById('filterCategoriesLabel');
    if (filterCategoriesLabel) filterCategoriesLabel.textContent = t.hideCategories + ':';

    const filterTimeLabel = document.getElementById('filterTimeLabel');
    if (filterTimeLabel) filterTimeLabel.textContent = t.timeRemaining + ':';

    const filterVolumeLabel = document.getElementById('filterVolumeLabel');
    if (filterVolumeLabel) filterVolumeLabel.textContent = t.minVolume + ':';

    const filterLiquidityLabel = document.getElementById('filterLiquidityLabel');
    if (filterLiquidityLabel) filterLiquidityLabel.textContent = t.minLiquidity + ':';

    const showLessBtn = document.getElementById('showLessTags');
    if (showLessBtn) {
        const tagsContainer = document.getElementById('filterTags');
        showLessBtn.textContent = tagsContainer && tagsContainer.classList.contains('collapsed') ? t.showMore : t.showLess;
    }

    const resetBtn = document.getElementById('resetFilters');
    if (resetBtn) resetBtn.textContent = t.resetBtn;

    const applyBtn = document.getElementById('applyFilters');
    if (applyBtn) applyBtn.textContent = t.applyFiltersBtn;

    document.querySelectorAll('#timeRemainingOptions .filter-option').forEach(btn => {
        const val = (btn as HTMLElement).dataset.value;
        if (val === 'all') {
            btn.textContent = t.all;
        } else {
            btn.textContent = `< ${val}${t.days}`;
        }
    });

    document.querySelectorAll('#minVolumeOptions .filter-option, #minLiquidityOptions .filter-option').forEach(btn => {
        if ((btn as HTMLElement).dataset.value === '0') btn.textContent = t.all;
    });

    renderCalendar();
}

export function toggleLanguage(): void {
    currentLang = currentLang === 'ko' ? 'en' : 'ko';
    localStorage.setItem('language', currentLang);
    translatePage();
}

export function initLanguage(): void {
    translatePage();
    const langToggle = document.getElementById('langToggle');
    if (langToggle) {
        langToggle.addEventListener('click', toggleLanguage);
    }
}
