import { initSupabase } from './supabase.ts';
import { initTheme, initDensity, toggleTheme, toggleDensity } from './theme.ts';
import { initLanguage, translations, currentLang } from './i18n.ts';
import { initQuickFilters, openFilterModal, closeFilterModal, setupFilterOptions, applyFilters, resetFilters, clearAllFilters, renderFilterTags, updateActiveFiltersDisplay } from './filters.ts';
import { loadData, loadMoreData, loadKoreaData, loadSureBetData, startSureBetRefresh, stopSureBetRefresh } from './data.ts';
import { renderCalendar } from './render/index.ts';
import { renderKoreaView, initKoreaSortListeners } from './render/koreaView.ts';
import { renderSureBetView, initSureBetListeners, stopCountdownTimer } from './render/sureBetView.ts';
import { initTooltip } from './render/tooltip.ts';
import { closeModal } from './render/modal.ts';
import { initV2Admin } from './admin.ts';
import { calendarOverviewStartWeek, setCalendarOverviewStartWeek, setCurrentDate, allEvents, currentTab, setCurrentTab, koreaEvents, sureBetEvents, liveWeatherEvents } from './state.ts';
import { renderLiveTrackerView, initLiveTrackerListeners, loadLiveWeatherMarkets } from './render/liveTrackerView.ts';
import type { PageTab } from './state.ts';
import { getKSTToday, addDays, toKSTDateString } from './utils.ts';
import type { Filters } from './types.ts';

document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 앱 시작');

    initTheme();
    initDensity();
    initLanguage();
    initSupabase();
    initQuickFilters();
    initTooltip();
    setupEventListeners();
    await loadData(() => {
        // SWR 백그라운드 갱신 완료 시 캘린더 자동 리렌더
        console.log('🔄 백그라운드 갱신 반영, 캘린더 리렌더');
        updateActiveFiltersDisplay();
        const searchQuery = (document.getElementById('searchInput') as HTMLInputElement)?.value || '';
        renderCalendar(searchQuery);
    });
    updateActiveFiltersDisplay();
    renderCalendar();

    initV2Admin();
    initKoreaSortListeners();
    initSureBetListeners();
    initLiveTrackerListeners();
    initPageTabs();

    // URL 기반 초기 탭 설정
    const initialTab = getTabFromPath();
    if (initialTab !== 'calendar') {
        await switchTab(initialTab);
    }

    // 브라우저 뒤로/앞으로 버튼 처리
    window.addEventListener('popstate', () => {
        const tab = getTabFromPath();
        if (tab !== currentTab) {
            switchTab(tab, false);
        }
    });
});

function setupEventListeners(): void {
    // Density toggle
    const densityToggle = document.getElementById('densityToggle');
    if (densityToggle) {
        densityToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleDensity();
        });
    }

    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleTheme();
        });
    }

    // Refresh button
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            handleRefresh();
        });
    }

    // Calendar Overview navigation
    document.getElementById('prevWeek')!.addEventListener('click', () => {
        if (calendarOverviewStartWeek > 0) {
            setCalendarOverviewStartWeek(calendarOverviewStartWeek - 1);
            renderCalendar();
        }
    });

    document.getElementById('nextWeek')!.addEventListener('click', async () => {
        setCalendarOverviewStartWeek(calendarOverviewStartWeek + 1);

        const todayKST = getKSTToday();
        const requiredEndDate = addDays(todayKST, 5 + (calendarOverviewStartWeek + 1) * 7 + 21);
        const lastEventDate = allEvents.length > 0 ? toKSTDateString(allEvents[allEvents.length - 1].end_date) : '';

        if (requiredEndDate > lastEventDate) {
            await loadMoreData(requiredEndDate);
        }

        renderCalendar();
    });

    // Today button
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if ((e.target as HTMLElement).dataset.view === 'today') {
                setCurrentDate(new Date());
                renderCalendar();
            }
        });
    });

    // Search
    (document.getElementById('searchInput') as HTMLInputElement).addEventListener('input', (e) => {
        renderCalendar((e.target as HTMLInputElement).value);
    });

    // Filter row click -> open filter modal
    document.getElementById('filtersRow')!.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('#clearFilters') || (e.target as HTMLElement).closest('.remove-tag')) {
            return;
        }
        openFilterModal();
    });

    // Filter modal events
    document.getElementById('filterModalClose')!.addEventListener('click', closeFilterModal);
    document.getElementById('filterModalOverlay')!.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeFilterModal();
    });

    // Filter options
    setupFilterOptions('timeRemainingOptions', 'timeRemaining' as keyof Filters);
    setupFilterOptions('minVolumeOptions', 'minVolume' as keyof Filters);
    setupFilterOptions('minLiquidityOptions', 'minLiquidity' as keyof Filters);

    // Tag search
    (document.getElementById('tagSearchInput') as HTMLInputElement).addEventListener('input', (e) => {
        renderFilterTags((e.target as HTMLInputElement).value);
    });

    // Show less tags toggle
    document.getElementById('showLessTags')!.addEventListener('click', (e) => {
        e.stopPropagation();
        const tagsContainer = document.getElementById('filterTags')!;
        tagsContainer.classList.toggle('collapsed');
        const btn = document.getElementById('showLessTags')!;
        const t = translations[currentLang];
        btn.textContent = tagsContainer.classList.contains('collapsed') ? t.showMore : t.showLess;
    });

    // Apply/Reset filters
    document.getElementById('applyFilters')!.addEventListener('click', applyFilters);
    document.getElementById('resetFilters')!.addEventListener('click', resetFilters);
    document.getElementById('clearFilters')!.addEventListener('click', (e) => {
        e.stopPropagation();
        clearAllFilters();
    });

    // Event modal
    document.getElementById('modalClose')!.addEventListener('click', closeModal);
    document.getElementById('modalOverlay')!.addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });

    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
            closeFilterModal();
        }
    });
}

// ─── URL 라우팅 ───

const ROUTE_MAP: Record<string, PageTab> = {
    '/99market': 'surebet',
    '/komarket': 'korea',
    '/live': 'live',
};

const TAB_TO_PATH: Record<PageTab, string> = {
    calendar: '/',
    surebet: '/99market',
    korea: '/komarket',
    live: '/live',
};

function getTabFromPath(): PageTab {
    const path = window.location.pathname;
    return ROUTE_MAP[path] || 'calendar';
}

// ─── 페이지 탭 전환 ───

function initPageTabs(): void {
    document.querySelectorAll('.page-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = (tab as HTMLElement).dataset.tab as PageTab;
            if (tabName && tabName !== currentTab) {
                switchTab(tabName);
            }
        });
    });
}

async function switchTab(tab: PageTab, pushState = true): Promise<void> {
    setCurrentTab(tab);

    // URL 업데이트 (pushState=false일 때는 popstate에서 호출된 경우)
    const targetPath = TAB_TO_PATH[tab];
    if (pushState && window.location.pathname !== targetPath) {
        history.pushState({ tab }, '', targetPath);
    }

    // 탭 버튼 활성화 상태
    document.querySelectorAll('.page-tab').forEach(btn => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
    });

    // 캘린더 관련 섹션들
    const calendarSections = [
        document.querySelector('.info-banner'),
        document.querySelector('.toolbar'),
        document.querySelector('.quick-filters'),
        document.querySelector('.filters-row'),
        document.querySelector('.week-section'),
        document.querySelector('.calendar-overview-section'),
    ];

    const koreaSection = document.getElementById('koreaViewSection');
    const sureBetSection = document.getElementById('sureBetSection');
    const liveSection = document.getElementById('liveViewSection');

    // 모든 섹션 숨김
    calendarSections.forEach(el => {
        if (el) (el as HTMLElement).style.display = 'none';
    });
    if (koreaSection) koreaSection.style.display = 'none';
    if (sureBetSection) sureBetSection.style.display = 'none';
    if (liveSection) liveSection.style.display = 'none';

    // surebet 탭 벗어날 때 자동 갱신 + 카운트다운 중지
    stopSureBetRefresh();
    stopCountdownTimer();

    if (tab === 'calendar') {
        calendarSections.forEach(el => {
            if (el) (el as HTMLElement).style.display = '';
        });
    } else if (tab === 'surebet') {
        if (sureBetSection) sureBetSection.style.display = '';

        // 99% 마켓 데이터 로드
        if (sureBetEvents.length === 0) {
            await loadSureBetData();
        }
        renderSureBetView();

        // 자동 갱신 시작 (10초 간격)
        startSureBetRefresh(() => renderSureBetView());
    } else if (tab === 'korea') {
        if (koreaSection) koreaSection.style.display = '';

        // 한국 데이터 로드 (최초 1회)
        if (koreaEvents.length === 0) {
            await loadKoreaData();
        }
        renderKoreaView();
    } else if (tab === 'live') {
        if (liveSection) liveSection.style.display = '';

        // 날씨 마켓 데이터 로드 (최초 1회)
        if (liveWeatherEvents.length === 0) {
            await loadLiveWeatherMarkets();
        }
        renderLiveTrackerView();
    }
}

function handleRefresh(): void {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.classList.add('rotating');

    const searchQuery = (document.getElementById('searchInput') as HTMLInputElement).value;
    renderCalendar(searchQuery);

    setTimeout(() => {
        if (refreshBtn) refreshBtn.classList.remove('rotating');
    }, 500);
}
