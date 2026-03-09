// Supabase Configuration (config.js에서 가져옴)
const SUPABASE_URL = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_URL : '';
const SUPABASE_ANON_KEY = typeof CONFIG !== 'undefined' ? CONFIG.SUPABASE_ANON_KEY : '';

// KST (Korea Standard Time) 변환 함수들

// UTC ISO 문자열을 KST 날짜 문자열 (YYYY-MM-DD)로 변환
function toKSTDateString(dateInput) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    // toLocaleString을 사용하여 KST로 변환
    const kstString = date.toLocaleString('en-CA', { timeZone: 'Asia/Seoul' });
    // en-CA 로케일은 YYYY-MM-DD 형식 반환
    return kstString.split(',')[0];
}

// 현재 KST 날짜 문자열 (YYYY-MM-DD) 반환
function getKSTToday() {
    const now = new Date();
    // toLocaleString을 사용하여 KST로 변환
    const kstString = now.toLocaleString('en-CA', { timeZone: 'Asia/Seoul' });
    return kstString.split(',')[0];
}

// KST 기준 현재 Date 객체 반환 (시간 비교용)
function getKSTNow() {
    // 현재 시간을 그대로 반환 (Date 객체는 항상 UTC 기반)
    // 시간 비교는 UTC 기준으로 해도 결과는 동일
    return new Date();
}

// UTC 날짜를 KST 시간 (HH:MM) 문자열로 변환
function getKSTTime(dateInput) {
    if (!dateInput) return '';
    const date = new Date(dateInput);
    const kstString = date.toLocaleString('en-US', {
        timeZone: 'Asia/Seoul',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    });
    return kstString;
}

// 시간대별 클래스 반환 (dawn: 0-6시, day: 6-18시, night: 18-24시)
function getTimeClass(timeString) {
    const hour = parseInt(timeString.split(':')[0]);
    if (hour >= 0 && hour < 6) return 'dawn';
    if (hour >= 6 && hour < 18) return 'day';
    return 'night';
}

// 날짜에 일수 더하기
function addDays(dateStr, days) {
    const date = new Date(dateStr + 'T00:00:00');
    date.setDate(date.getDate() + days);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 주간 범위 계산 (시작일부터 N주)
function getWeekRange(startDate, weeks) {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(start);
    end.setDate(end.getDate() + (weeks * 7) - 1);
    return {
        start: toKSTDateString(start),
        end: toKSTDateString(end)
    };
}

// State
let supabaseClient = null;
let allEvents = [];
let currentDate = new Date();
let calendarOverviewStartWeek = 0; // 0 = Week View 직후부터, 1 = 1주 더 뒤, etc.
let isLoadingMore = false; // 추가 데이터 로딩 중 플래그

// Filter state (기본값: 거래량 $1K 이상, 스포츠 카테고리 제외)
let filters = {
    tags: [],
    excludedCategories: ['Sports'], // 기본적으로 스포츠 제외 (위법성 고려)
    timeRemaining: 'all',
    minVolume: 1000, // $1K로 낮춰서 암호화폐 시장 포함
    minLiquidity: 0
};

// Temp filter state (for modal)
let tempFilters = { ...filters };

// All available tags with counts
let allTags = {};

// All available categories with counts
let allCategories = {};

// Category to Emoji mapping
const categoryEmojis = {
    'Sports': '⚽',
    'Crypto': '💰',
    'Politics': '🏛️',
    'Pop Culture': '🎬',
    'Science': '🔬',
    'Business': '💼',
    'Technology': '💻',
    'Gaming': '🎮',
    'Music': '🎵',
    'default': '📊'
};

// Category to Color mapping
const categoryColors = {
    'Sports': '#3b82f6',      // Blue
    'Crypto': '#f59e0b',      // Amber
    'Politics': '#ef4444',    // Red
    'Pop Culture': '#ec4899', // Pink
    'Science': '#10b981',     // Green
    'Business': '#8b5cf6',    // Purple
    'Technology': '#06b6d4',  // Cyan
    'Gaming': '#f97316',      // Orange
    'Finance': '#6366f1',     // Indigo
    'Music': '#d946ef',       // Fuchsia
    'Uncategorized': '#6b7280', // Gray
    'default': '#6b7280'      // Gray
};

// Known image hosts (observed from existing data); not strictly enforced
const IMAGE_HOST_ALLOWLIST = new Set([
    'polymarket-upload.s3.us-east-2.amazonaws.com',
    'cdn.pandascore.co'
]);

// Tooltip element
let tooltipElement = null;
let tooltipTimeout = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🚀 앱 시작');

    initTheme();
    initDensity();
    initLanguage();
    initSupabase();
    initQuickFilters();
    initTooltip();
    setupEventListeners();
    await loadData();
    updateActiveFiltersDisplay(); // 기본 필터 UI 표시
    renderCalendar();

    // V2 Admin 초기화 (supabaseClient 준비된 후 실행)
    if (typeof initV2Admin === 'function') {
        initV2Admin();
    }
});

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
}

function initDensity() {
    const savedDensity = localStorage.getItem('density') || 'comfortable';
    document.documentElement.setAttribute('data-density', savedDensity);
}

function initSupabase() {
    if (!SUPABASE_URL || SUPABASE_URL === 'YOUR_SUPABASE_URL') {
        console.warn('Supabase URL이 설정되지 않았습니다.');
        return;
    }
    try {
        supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('✅ Supabase 클라이언트 생성 완료');
    } catch (e) {
        console.error('❌ Supabase 클라이언트 생성 실패:', e);
    }
}

function setupEventListeners() {
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
    document.getElementById('prevWeek').addEventListener('click', () => {
        if (calendarOverviewStartWeek > 0) {
            calendarOverviewStartWeek--;
            renderCalendar();
        }
    });

    document.getElementById('nextWeek').addEventListener('click', async () => {
        calendarOverviewStartWeek++;

        // 추가 데이터 필요 시 lazy loading
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
            if (e.target.dataset.view === 'today') {
                currentDate = new Date();
                renderCalendar();
            }
        });
    });

    // Search
    document.getElementById('searchInput').addEventListener('input', (e) => {
        renderCalendar(e.target.value);
    });

    // Filter row click -> open filter modal
    document.getElementById('filtersRow').addEventListener('click', (e) => {
        // clearFilters 버튼 클릭 시 모달 열지 않음
        if (e.target.closest('#clearFilters') || e.target.closest('.remove-tag')) {
            return;
        }
        openFilterModal();
    });

    // Filter modal events
    document.getElementById('filterModalClose').addEventListener('click', closeFilterModal);
    document.getElementById('filterModalOverlay').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeFilterModal();
    });

    // Filter options
    setupFilterOptions('timeRemainingOptions', 'timeRemaining');
    setupFilterOptions('minVolumeOptions', 'minVolume');
    setupFilterOptions('minLiquidityOptions', 'minLiquidity');

    // Tag search
    document.getElementById('tagSearchInput').addEventListener('input', (e) => {
        renderFilterTags(e.target.value);
    });

    // Show less tags toggle
    document.getElementById('showLessTags').addEventListener('click', (e) => {
        e.stopPropagation();
        const tagsContainer = document.getElementById('filterTags');
        tagsContainer.classList.toggle('collapsed');
        const btn = document.getElementById('showLessTags');
        const t = translations[currentLang];
        btn.textContent = tagsContainer.classList.contains('collapsed') ? t.showMore : t.showLess;
    });

    // Apply/Reset filters
    document.getElementById('applyFilters').addEventListener('click', applyFilters);
    document.getElementById('resetFilters').addEventListener('click', resetFilters);
    document.getElementById('clearFilters').addEventListener('click', (e) => {
        e.stopPropagation();
        clearAllFilters();
    });

    // Event modal
    document.getElementById('modalClose').addEventListener('click', closeModal);
    document.getElementById('modalOverlay').addEventListener('click', (e) => {
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

function setupFilterOptions(containerId, filterKey) {
    const container = document.getElementById(containerId);
    container.querySelectorAll('.filter-option').forEach(btn => {
        btn.addEventListener('click', () => {
            container.querySelectorAll('.filter-option').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            tempFilters[filterKey] = btn.dataset.value === 'all' ? 'all' : parseInt(btn.dataset.value);
        });
    });
}

function toggleTheme() {
    const html = document.documentElement;
    const currentTheme = html.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

function toggleDensity() {
    const html = document.documentElement;
    const currentDensity = html.getAttribute('data-density') || 'comfortable';

    // Cycle through: comfortable -> compact -> spacious -> comfortable
    let newDensity;
    if (currentDensity === 'comfortable') {
        newDensity = 'compact';
    } else if (currentDensity === 'compact') {
        newDensity = 'spacious';
    } else {
        newDensity = 'comfortable';
    }

    html.setAttribute('data-density', newDensity);
    localStorage.setItem('density', newDensity);
}

function handleRefresh() {
    const refreshBtn = document.getElementById('refreshBtn');

    // Add rotation animation
    if (refreshBtn) {
        refreshBtn.classList.add('rotating');
    }

    // Re-render calendar to filter out past events
    const searchQuery = document.getElementById('searchInput').value;
    renderCalendar(searchQuery);

    // Remove rotation animation after 500ms
    setTimeout(() => {
        if (refreshBtn) {
            refreshBtn.classList.remove('rotating');
        }
    }, 500);
}

function initQuickFilters() {
    const quickFiltersContainer = document.getElementById('quickFilters');
    if (!quickFiltersContainer) return;

    // Clear existing content
    quickFiltersContainer.innerHTML = '';

    // Create category chips (exclude Uncategorized and default)
    const mainCategories = Object.keys(categoryColors).filter(cat =>
        cat !== 'default' && cat !== 'Uncategorized'
    );

    mainCategories.forEach(category => {
        const color = categoryColors[category];
        const chip = document.createElement('button');
        chip.className = 'category-chip';
        chip.dataset.category = category;

        // Check if category is excluded by default
        if (filters.excludedCategories.includes(category)) {
            chip.classList.add('excluded');
        }

        chip.innerHTML = `
            <span class="category-chip-color" style="background-color: ${color};"></span>
            <span>${category}</span>
        `;

        chip.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleCategoryFilter(category);
        });

        quickFiltersContainer.appendChild(chip);
    });
}

function toggleCategoryFilter(category) {
    const index = filters.excludedCategories.indexOf(category);

    if (index > -1) {
        // Remove from excluded (show this category)
        filters.excludedCategories.splice(index, 1);
    } else {
        // Add to excluded (hide this category)
        filters.excludedCategories.push(category);
    }

    // Update UI
    updateQuickFilterChips();
    updateActiveFiltersDisplay();
    renderCalendar();
}

function updateQuickFilterChips() {
    const chips = document.querySelectorAll('.category-chip');
    chips.forEach(chip => {
        const category = chip.dataset.category;
        if (filters.excludedCategories.includes(category)) {
            chip.classList.add('excluded');
        } else {
            chip.classList.remove('excluded');
        }
    });
}

// Tooltip functions
function initTooltip() {
    // Create tooltip element
    tooltipElement = document.createElement('div');
    tooltipElement.className = 'event-tooltip';
    document.body.appendChild(tooltipElement);
}

function showEventTooltip(event, eventData) {
    if (!tooltipElement || !eventData) return;

    // Clear any existing timeout
    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
    }

    // Get event details
    const prob = getMainProb(eventData);
    const probClass = prob < 30 ? 'low' : prob < 70 ? 'mid' : '';
    const volume = formatCurrency(eventData._totalVolume || eventData.volume || 0);
    const volume24hr = formatCurrency(eventData.volume_24hr || 0);
    const category = inferCategory(eventData);
    const categoryColor = categoryColors[category] || categoryColors['default'];

    // Get liquidity if available
    const liquidity = eventData.liquidity ? formatCurrency(eventData.liquidity) : 'N/A';

    // Build tooltip HTML
    const t = translations[currentLang];
    tooltipElement.innerHTML = `
        <div class="tooltip-title">${escapeHtml(getTitle(eventData))}</div>
        <div class="tooltip-stats">
            <div class="tooltip-stat">
                <span class="tooltip-stat-label">${t.probability || 'Probability'}:</span>
                <span class="tooltip-stat-value prob ${probClass}">${prob}%</span>
            </div>
            <div class="tooltip-stat">
                <span class="tooltip-stat-label">${t.volume || 'Volume'}:</span>
                <span class="tooltip-stat-value">${volume}</span>
            </div>
            <div class="tooltip-stat">
                <span class="tooltip-stat-label">${t.volume24hr || '24hr Volume'}:</span>
                <span class="tooltip-stat-value">${volume24hr}</span>
            </div>
            ${liquidity !== 'N/A' ? `
            <div class="tooltip-stat">
                <span class="tooltip-stat-label">${t.liquidity || 'Liquidity'}:</span>
                <span class="tooltip-stat-value">${liquidity}</span>
            </div>
            ` : ''}
        </div>
        <div class="tooltip-category">
            <span class="tooltip-category-dot" style="background-color: ${categoryColor};"></span>
            ${escapeHtml(category)}
        </div>
    `;

    // Position tooltip near cursor
    positionTooltip(event);

    // Show tooltip with delay
    tooltipTimeout = setTimeout(() => {
        tooltipElement.classList.add('visible');
    }, 300);
}

function hideEventTooltip() {
    if (tooltipTimeout) {
        clearTimeout(tooltipTimeout);
    }
    if (tooltipElement) {
        tooltipElement.classList.remove('visible');
    }
}

function positionTooltip(event) {
    if (!tooltipElement) return;

    const padding = 10;
    const tooltipRect = tooltipElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let x = event.clientX + padding;
    let y = event.clientY + padding;

    // Adjust if tooltip goes off right edge
    if (x + tooltipRect.width > viewportWidth - padding) {
        x = event.clientX - tooltipRect.width - padding;
    }

    // Adjust if tooltip goes off bottom edge
    if (y + tooltipRect.height > viewportHeight - padding) {
        y = event.clientY - tooltipRect.height - padding;
    }

    // Ensure tooltip doesn't go off top or left edges
    x = Math.max(padding, x);
    y = Math.max(padding, y);

    tooltipElement.style.left = x + 'px';
    tooltipElement.style.top = y + 'px';
}

// 🎯 그룹화된 시장 통합 (image_url + end_date 기반)
// Polymarket에서 같은 이벤트 그룹은 동일한 image_url을 공유하므로
// 이를 활용하여 자동으로 모든 유형의 시장을 그룹핑합니다.
function groupSimilarMarkets(events) {
    const groups = new Map();

    events.forEach(event => {
        let groupKey;

        if (event.image_url) {
            // 🎯 핵심: image_url + end_date로 그룹화
            // 같은 이미지 = 같은 이벤트 그룹 (Polymarket 규칙)
            // end_date도 포함하여 다른 날짜의 시장은 별도 표시
            groupKey = `${event.image_url}|${event.end_date}`;
        } else {
            // image_url이 없는 경우 개별 이벤트로 처리
            groupKey = `no-image-${event.id}`;
        }

        if (!groups.has(groupKey)) {
            groups.set(groupKey, []);
        }
        groups.get(groupKey).push(event);
    });

    // 각 그룹에서 대표 이벤트 선택
    const deduplicated = [];
    let groupedCount = 0;

    groups.forEach(group => {
        if (group.length === 1) {
            // 단일 시장 → 그대로 표시
            deduplicated.push(group[0]);
        } else {
            // 그룹화된 시장 → Yes 확률이 가장 높은 옵션을 대표로 선택
            groupedCount++;

            // 총 거래량 합산 (그룹 전체 규모 표시용)
            const totalVolume = group.reduce((sum, e) => sum + parseFloat(e.volume || 0), 0);

            const best = group.reduce((best, curr) => {
                const bestYesProb = parseFloat(best.probs[0]);
                const currYesProb = parseFloat(curr.probs[0]);
                return currYesProb > bestYesProb ? curr : best;
            });

            // 총 거래량 저장 (UI 표시용)
            best._totalVolume = totalVolume;
            best._groupSize = group.length;

            deduplicated.push(best);
        }
    });

    if (groupedCount > 0) {
        console.log(`🎯 ${groupedCount}개 그룹 통합됨 (${events.length}개 → ${deduplicated.length}개)`);
    }

    return deduplicated;
}

async function loadData() {
    console.log('📥 데이터 로드 시작');

    if (!supabaseClient) {
        console.log('⚠️ Supabase 없음 - 데모 데이터 사용');
        allEvents = generateDemoData();
        // 🎯 그룹화 적용
        allEvents = groupSimilarMarkets(allEvents);
        extractTags();
        extractCategories();
        return;
    }

    // 🚀 개선 3: 캐시 확인 (LocalStorage + 서버 버전 체크)
    const cacheKey = 'polymarket_events_cache';
    const cacheTimeKey = 'polymarket_cache_time';
    const CACHE_DURATION = 5 * 60 * 1000; // 5분

    try {
        const cachedData = localStorage.getItem(cacheKey);
        const cacheTime = localStorage.getItem(cacheTimeKey);

        if (cachedData && cacheTime) {
            const age = Date.now() - parseInt(cacheTime);
            if (age < CACHE_DURATION) {
                // 서버 캐시 버전 확인 (관리자 수정 감지)
                let cacheValid = true;
                try {
                    const { data: meta } = await supabaseClient
                        .from('cache_meta')
                        .select('last_updated')
                        .eq('id', 1)
                        .single();
                    if (meta && new Date(meta.last_updated).getTime() > parseInt(cacheTime)) {
                        console.log('⚠️ 관리자 수정 감지, 캐시 무효화');
                        cacheValid = false;
                    }
                } catch (e) {
                    // cache_meta 조회 실패 시 캐시 그대로 사용
                }

                if (cacheValid) {
                    console.log('✅ 캐시에서 로드 (', Math.round(age / 1000), '초 전)');
                    allEvents = JSON.parse(cachedData);
                    // 🎯 그룹화 적용
                    allEvents = groupSimilarMarkets(allEvents);
                    extractTags();
                    extractCategories();
                    return;
                }
            } else {
                console.log('⚠️ 캐시 만료됨, 새로 로드');
            }
        }
    } catch (e) {
        console.log('⚠️ 캐시 로드 실패, 새로 로드');
    }

    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 2000, 4000]; // 1초, 2초, 4초 대기

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const PAGE_SIZE = 1000;

            const now = new Date().toISOString();

            // 🚀 개선 1: Week View (5일) + Upcoming (3주) 전체 로드
            const upcomingWeeks = new Date();
            upcomingWeeks.setDate(upcomingWeeks.getDate() + 5 + 21); // Week View 5일 + Upcoming 3주
            const maxDate = upcomingWeeks.toISOString();

            // 🚀 병렬 fetch: 2개씩 동시 요청 (Supabase 타임아웃 방지)
            const CONCURRENT = 2;
            let allData = [];
            let offset = 0;
            let hasMore = true;

            const fetchPage = (off) => supabaseClient
                .from('poly_events')
                .select('id, title, title_ko, slug, event_slug, end_date, volume, volume_24hr, probs, category, closed, image_url, tags, hidden')
                .gte('end_date', now)
                .lte('end_date', maxDate)
                .gte('volume', 1000)
                .eq('hidden', false)
                .order('end_date', { ascending: true })
                .range(off, off + PAGE_SIZE - 1);

            while (hasMore) {
                // 2페이지씩 동시 요청
                const batch = [];
                for (let i = 0; i < CONCURRENT; i++) {
                    batch.push(fetchPage(offset + i * PAGE_SIZE));
                }

                const results = await Promise.all(batch);
                let batchCount = 0;

                for (const result of results) {
                    if (result.error) throw result.error;
                    if (result.data && result.data.length > 0) {
                        allData = allData.concat(result.data);
                        batchCount += result.data.length;
                    }
                }

                console.log(`📦 ${allData.length}건 로드됨...`);
                offset += CONCURRENT * PAGE_SIZE;
                hasMore = batchCount >= CONCURRENT * PAGE_SIZE;
            }

            console.log('✅ 데이터 로드 성공:', allData.length, '건');
            allEvents = allData;

            // 🎯 그룹화 적용 (캐시 저장 전)
            allEvents = groupSimilarMarkets(allEvents);

            // 🚀 개선 3: 캐시에 저장
            try {
                localStorage.setItem(cacheKey, JSON.stringify(allEvents));
                localStorage.setItem(cacheTimeKey, Date.now().toString());
                console.log('💾 캐시에 저장 완료');
            } catch (e) {
                console.warn('⚠️ 캐시 저장 실패 (용량 초과 가능성):', e);
            }

            extractTags();
            extractCategories();
            return; // 성공 시 함수 종료
        } catch (error) {
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAYS[attempt];
                console.warn(`⚠️ 데이터 로드 실패 (${attempt + 1}/${MAX_RETRIES}), ${delay / 1000}초 후 재시도...`, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error('❌ 데이터 로드 최종 실패 (재시도 모두 소진):', error);
                allEvents = generateDemoData();
                // 🎯 그룹화 적용
                allEvents = groupSimilarMarkets(allEvents);
                extractTags();
            }
        }
    }
}

function extractTags() {
    allTags = {};
    allEvents.forEach(event => {
        if (event.tags && Array.isArray(event.tags)) {
            event.tags.forEach(tag => {
                if (tag) {
                    allTags[tag] = (allTags[tag] || 0) + 1;
                }
            });
        }
    });

    // Sort by count
    const sortedTags = Object.entries(allTags)
        .sort((a, b) => b[1] - a[1])
        .reduce((obj, [key, value]) => {
            obj[key] = value;
            return obj;
        }, {});

    allTags = sortedTags;
    document.getElementById('tagCount').textContent = `(${Object.keys(allTags).length})`;
}

// 이벤트의 카테고리를 반환하는 함수 (API 데이터 직접 사용)
function inferCategory(event) {
    return event.category || 'Uncategorized';
}

function extractCategories() {
    allCategories = {};

    allEvents.forEach(event => {
        const category = inferCategory(event);
        allCategories[category] = (allCategories[category] || 0) + 1;
    });

    // Sort by count
    const sortedCategories = Object.entries(allCategories)
        .sort((a, b) => b[1] - a[1])
        .reduce((obj, [key, value]) => {
            obj[key] = value;
            return obj;
        }, {});

    allCategories = sortedCategories;
}

// 추가 데이터 로딩 (Calendar Overview에서 스크롤 시)
async function loadMoreData(targetDate) {
    if (!supabaseClient || isLoadingMore) return;

    isLoadingMore = true;
    console.log('📥 추가 데이터 로딩 중...');

    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const lastEvent = allEvents[allEvents.length - 1];
            const startDate = lastEvent ? lastEvent.end_date : new Date().toISOString();

            let query = supabaseClient
                .from('poly_events')
                .select('id, title, title_ko, slug, event_slug, end_date, volume, volume_24hr, probs, category, closed, image_url, tags, hidden, description, description_ko')
                .gte('end_date', startDate)
                .lte('end_date', targetDate)
                .gte('volume', 1000)  // $1K 이상 (암호화폐 포함)
                .order('end_date', { ascending: true })
                .limit(1000);

            // admin 모드가 아닐 때만 hidden 필터 적용
            if (!isAdminMode) {
                query = query.eq('hidden', false);
            }

            const { data, error } = await query;

            if (error) throw error;

            if (data && data.length > 0) {
                // 중복 제거
                const existingIds = new Set(allEvents.map(e => e.id));
                const newEvents = data.filter(e => !existingIds.has(e.id));

                allEvents = allEvents.concat(newEvents);
                console.log('✅ 추가 로드:', newEvents.length, '건');

                // 🎯 전체 데이터 재그룹화 (새 이벤트가 기존 그룹에 속할 수 있음)
                allEvents = groupSimilarMarkets(allEvents);

                // 캐시 업데이트
                try {
                    localStorage.setItem('polymarket_events_cache', JSON.stringify(allEvents));
                    localStorage.setItem('polymarket_cache_time', Date.now().toString());
                } catch (e) {
                    console.warn('⚠️ 캐시 업데이트 실패');
                }

                extractTags();
                extractCategories();
            }
            break; // 성공 시 루프 종료
        } catch (error) {
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAYS[attempt];
                console.warn(`⚠️ 추가 데이터 로드 실패 (${attempt + 1}/${MAX_RETRIES}), ${delay / 1000}초 후 재시도...`, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error('❌ 추가 데이터 로드 최종 실패:', error);
            }
        }
    }

    isLoadingMore = false;
}

function generateDemoData() {
    const categories = ['Sports', 'Crypto', 'Politics', 'Pop Culture', 'Science', 'Business'];
    const demoTags = ['Sports', 'Games', 'Soccer', 'Politics', 'Basketball', 'Crypto', 'NCAA', 'Trump', 'Elections'];
    const demoEvents = [];
    const now = new Date();

    for (let i = 0; i < 500; i++) {
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + Math.floor(Math.random() * 60) - 10);

        const prob = Math.random();
        const eventTags = [];
        const numTags = Math.floor(Math.random() * 3);
        for (let j = 0; j < numTags; j++) {
            eventTags.push(demoTags[Math.floor(Math.random() * demoTags.length)]);
        }

        demoEvents.push({
            id: `demo-${i}`,
            title: `Demo Market ${i + 1}`,
            slug: `demo-market-${i + 1}`,
            end_date: endDate.toISOString(),
            volume: Math.random() * 10000000,
            volume_24hr: Math.random() * 500000,
            probs: [prob.toFixed(2), (1 - prob).toFixed(2)],
            outcomes: ['Yes', 'No'],
            category: categories[Math.floor(Math.random() * categories.length)],
            tags: eventTags
        });
    }

    return demoEvents;
}


function formatNumber(num) {
    return new Intl.NumberFormat().format(num);
}

function formatCurrency(num) {
    if (num >= 1000000000) return (num / 1000000000).toFixed(1) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(0) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(0) + 'K';
    return num.toFixed(0);
}

// Filter Modal Functions
function openFilterModal() {
    tempFilters = JSON.parse(JSON.stringify(filters));
    renderFilterTags();
    renderFilterCategories();
    syncFilterUI();
    document.getElementById('filterModalOverlay').classList.add('active');
}

function closeFilterModal() {
    document.getElementById('filterModalOverlay').classList.remove('active');
}

function renderFilterTags(searchQuery = '') {
    const container = document.getElementById('filterTags');
    container.innerHTML = '';

    const query = searchQuery.toLowerCase();
    const filteredTags = Object.entries(allTags)
        .filter(([tag]) => tag.toLowerCase().includes(query));

    filteredTags.forEach(([tag, count]) => {
        const chip = document.createElement('button');
        chip.className = `tag-chip${tempFilters.tags.includes(tag) ? ' active' : ''}`;
        chip.innerHTML = `${tag} <span class="tag-count">${count}</span>`;
        chip.addEventListener('click', () => {
            if (tempFilters.tags.includes(tag)) {
                tempFilters.tags = tempFilters.tags.filter(t => t !== tag);
                chip.classList.remove('active');
            } else {
                tempFilters.tags.push(tag);
                chip.classList.add('active');
            }
        });
        container.appendChild(chip);
    });
}

function renderFilterCategories() {
    const container = document.getElementById('filterCategories');
    container.innerHTML = '';

    Object.entries(allCategories).forEach(([category, count]) => {
        const chip = document.createElement('button');
        chip.className = `tag-chip${tempFilters.excludedCategories.includes(category) ? ' excluded' : ''}`;
        chip.innerHTML = `${category} <span class="tag-count">${count}</span>`;
        chip.addEventListener('click', () => {
            if (tempFilters.excludedCategories.includes(category)) {
                tempFilters.excludedCategories = tempFilters.excludedCategories.filter(c => c !== category);
                chip.classList.remove('excluded');
            } else {
                tempFilters.excludedCategories.push(category);
                chip.classList.add('excluded');
            }
        });
        container.appendChild(chip);
    });
}

function syncFilterUI() {
    // Time remaining
    document.querySelectorAll('#timeRemainingOptions .filter-option').forEach(btn => {
        const value = btn.dataset.value === 'all' ? 'all' : parseInt(btn.dataset.value);
        btn.classList.toggle('active', tempFilters.timeRemaining === value);
    });

    // Min Volume
    document.querySelectorAll('#minVolumeOptions .filter-option').forEach(btn => {
        const value = parseInt(btn.dataset.value);
        btn.classList.toggle('active', tempFilters.minVolume === value);
    });

    // Min Liquidity
    document.querySelectorAll('#minLiquidityOptions .filter-option').forEach(btn => {
        const value = parseInt(btn.dataset.value);
        btn.classList.toggle('active', tempFilters.minLiquidity === value);
    });
}

function applyFilters() {
    filters = JSON.parse(JSON.stringify(tempFilters));
    closeFilterModal();
    updateQuickFilterChips();
    updateActiveFiltersDisplay();
    renderCalendar();
}

function resetFilters() {
    tempFilters = {
        tags: [],
        excludedCategories: ['Sports'], // 기본적으로 스포츠 제외 유지
        timeRemaining: 'all',
        minVolume: 10000,
        minLiquidity: 0
    };
    renderFilterTags();
    renderFilterCategories();
    syncFilterUI();
}

function clearAllFilters() {
    filters = {
        tags: [],
        excludedCategories: ['Sports'], // 기본적으로 스포츠 제외 유지
        timeRemaining: 'all',
        minVolume: 10000,
        minLiquidity: 0
    };
    updateQuickFilterChips();
    updateActiveFiltersDisplay();
    renderCalendar();
}

function updateActiveFiltersDisplay() {
    const container = document.getElementById('activeFilters');
    const clearBtn = document.getElementById('clearFilters');
    container.innerHTML = '';

    let hasFilters = false;

    // Tags
    filters.tags.forEach(tag => {
        hasFilters = true;
        const tagEl = document.createElement('span');
        tagEl.className = 'filter-tag';
        tagEl.innerHTML = `${tag} <span class="remove-tag" data-type="tag" data-value="${tag}">×</span>`;
        container.appendChild(tagEl);
    });

    // Excluded Categories
    filters.excludedCategories.forEach(category => {
        hasFilters = true;
        const tagEl = document.createElement('span');
        tagEl.className = 'filter-tag excluded';
        tagEl.innerHTML = `🚫 ${category} <span class="remove-tag" data-type="excludedCategory" data-value="${category}">×</span>`;
        container.appendChild(tagEl);
    });

    // Time remaining
    if (filters.timeRemaining !== 'all') {
        hasFilters = true;
        const tagEl = document.createElement('span');
        tagEl.className = 'filter-tag';
        tagEl.innerHTML = `< ${filters.timeRemaining} days <span class="remove-tag" data-type="timeRemaining">×</span>`;
        container.appendChild(tagEl);
    }

    // Min Volume
    if (filters.minVolume > 0) {
        hasFilters = true;
        const tagEl = document.createElement('span');
        tagEl.className = 'filter-tag';
        tagEl.innerHTML = `Vol > $${formatCurrency(filters.minVolume)} <span class="remove-tag" data-type="minVolume">×</span>`;
        container.appendChild(tagEl);
    }

    // Min Liquidity
    if (filters.minLiquidity > 0) {
        hasFilters = true;
        const tagEl = document.createElement('span');
        tagEl.className = 'filter-tag';
        tagEl.innerHTML = `Liq > $${formatCurrency(filters.minLiquidity)} <span class="remove-tag" data-type="minLiquidity">×</span>`;
        container.appendChild(tagEl);
    }

    if (!hasFilters) {
        container.innerHTML = '<span class="filter-placeholder">Click to add filters</span>';
    }

    clearBtn.style.display = hasFilters ? 'block' : 'none';

    // Add remove handlers
    container.querySelectorAll('.remove-tag').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const type = btn.dataset.type;
            const value = btn.dataset.value;

            if (type === 'tag') {
                filters.tags = filters.tags.filter(t => t !== value);
            } else if (type === 'excludedCategory') {
                filters.excludedCategories = filters.excludedCategories.filter(c => c !== value);
            } else if (type === 'timeRemaining') {
                filters.timeRemaining = 'all';
            } else if (type === 'minVolume') {
                filters.minVolume = 0;
            } else if (type === 'minLiquidity') {
                filters.minLiquidity = 0;
            }

            updateActiveFiltersDisplay();
            renderCalendar();
        });
    });
}

function getFilteredEvents(searchQuery = '') {
    let filtered = [...allEvents];
    const now = new Date();

    // Apply tag filter
    if (filters.tags.length > 0) {
        filtered = filtered.filter(e =>
            e.tags && filters.tags.some(tag => e.tags.includes(tag))
        );
    }

    // Apply category exclusion filter
    if (filters.excludedCategories.length > 0) {
        filtered = filtered.filter(e =>
            !filters.excludedCategories.includes(inferCategory(e))
        );
    }

    // 기본적으로 과거 이벤트 및 정산 완료 시장 제외 (항상 적용)
    filtered = filtered.filter(e => {
        const endDate = new Date(e.end_date);
        const isClosed = e.closed === true;
        return endDate >= now && !isClosed;  // 마감 전 + 미정산만
    });

    // Apply time remaining filter (추가 범위 제한)
    if (filters.timeRemaining !== 'all') {
        const days = parseInt(filters.timeRemaining);
        const maxDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
        filtered = filtered.filter(e => {
            const endDate = new Date(e.end_date);
            return endDate <= maxDate;
        });
    }

    // Apply min volume filter
    if (filters.minVolume > 0) {
        filtered = filtered.filter(e => parseFloat(e.volume) >= filters.minVolume);
    }

    // Apply min liquidity filter (using volume * 0.1 as approximate liquidity)
    if (filters.minLiquidity > 0) {
        filtered = filtered.filter(e => parseFloat(e.volume) * 0.1 >= filters.minLiquidity);
    }

    // Apply search
    if (searchQuery) {
        const query = searchQuery.toLowerCase();
        filtered = filtered.filter(e =>
            e.title?.toLowerCase().includes(query) ||
            e.title_ko?.toLowerCase().includes(query) ||
            e.category?.toLowerCase().includes(query)
        );
    }

    return filtered;
}

// Week View 렌더링 (현재 주 7일간 상세 타임라인)
function renderWeekView(searchQuery = '') {
    const todayKST = getKSTToday();
    const filtered = getFilteredEvents(searchQuery);

    // 현재 KST 시간 (시간 비교용)
    const nowKST = new Date();

    // 이번 주 날짜 계산 (오늘 포함 5일)
    const weekDates = [];
    for (let i = 0; i < 5; i++) {
        weekDates.push(addDays(todayKST, i));
    }

    // 이벤트를 날짜별로 그룹화
    const eventsByDate = {};
    filtered.forEach(event => {
        if (event.end_date) {
            const dateKey = toKSTDateString(event.end_date);
            if (weekDates.includes(dateKey)) {
                // 오늘 날짜인 경우, 현재 시간보다 미래인 이벤트만 포함
                if (dateKey === todayKST) {
                    const eventEndTime = new Date(event.end_date);
                    if (eventEndTime > nowKST) {
                        if (!eventsByDate[dateKey]) {
                            eventsByDate[dateKey] = [];
                        }
                        eventsByDate[dateKey].push(event);
                    }
                } else {
                    // 오늘이 아닌 날짜는 모두 포함
                    if (!eventsByDate[dateKey]) {
                        eventsByDate[dateKey] = [];
                    }
                    eventsByDate[dateKey].push(event);
                }
            }
        }
    });

    // 각 날짜의 이벤트를 시간순으로 정렬
    Object.keys(eventsByDate).forEach(dateKey => {
        eventsByDate[dateKey].sort((a, b) => {
            return new Date(a.end_date).getTime() - new Date(b.end_date).getTime();
        });
    });

    // Week range 업데이트
    const weekStart = new Date(todayKST + 'T00:00:00');
    const weekEnd = new Date(addDays(todayKST, 4) + 'T00:00:00');
    const weekRangeText = `${weekStart.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })} - ${weekEnd.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })}`;
    document.getElementById('weekRange').textContent = weekRangeText;

    // Week timeline 렌더링
    const timeline = document.getElementById('weekTimeline');
    timeline.innerHTML = '';

    weekDates.forEach(dateKey => {
        const dayEvents = eventsByDate[dateKey] || [];
        const date = new Date(dateKey + 'T00:00:00');
        const isToday = dateKey === todayKST;

        const dayEl = document.createElement('div');
        dayEl.className = `week-day${isToday ? ' today' : ''}`;

        // 날짜 헤더
        const dayName = date.toLocaleDateString(getLocale(), { weekday: 'short', timeZone: 'Asia/Seoul' });
        const dayNumber = date.getDate();
        const monthName = date.toLocaleDateString(getLocale(), { month: 'short', timeZone: 'Asia/Seoul' });
        const dayDateText = currentLang === 'ko' ? `${monthName} ${dayNumber}일` : `${monthName} ${dayNumber}`;

        dayEl.innerHTML = `
            <div class="week-day-header">
                <div class="week-day-name">${dayName}</div>
                <div class="week-day-date">${dayDateText}</div>
                ${dayEvents.length > 0 ? `<div class="week-event-count">${dayEvents.length}${translations[currentLang].events}</div>` : ''}
            </div>
            <div class="week-day-events" id="week-${dateKey}"></div>
        `;

        timeline.appendChild(dayEl);

        // 이벤트 렌더링
        const eventsContainer = document.getElementById(`week-${dateKey}`);
        if (dayEvents.length === 0) {
            eventsContainer.innerHTML = `<div class="week-no-events">${translations[currentLang].noEvents}</div>`;
        } else {
            dayEvents.forEach(event => {
                renderWeekEventCard(eventsContainer, event);
            });
        }
    });
}

// Week View 개별 이벤트 카드 렌더링
function renderWeekEventCard(container, event) {
    const time = getKSTTime(event.end_date);
    const timeClass = getTimeClass(time);
    const imageUrl = event.image_url || '';
    const prob = getMainProb(event);
    const probClass = prob < 30 ? 'low' : prob < 70 ? 'mid' : '';
    const volume = formatCurrency(event.volume);
    const slugSafe = escapeHtml(event.slug || '');
    const eventSlugSafe = escapeHtml(event.event_slug || '');
    const category = inferCategory(event);
    const categoryColor = categoryColors[category] || categoryColors['default'];

    const eventEl = document.createElement('div');
    eventEl.className = 'week-event';
    eventEl.style.borderLeftColor = categoryColor;
    eventEl.setAttribute('data-category', category);
    if (event.hidden) eventEl.setAttribute('data-hidden', 'true');
    eventEl.onclick = () => openEventLink(slugSafe, '', eventSlugSafe);

    eventEl.addEventListener('mouseenter', (e) => showEventTooltip(e, event));
    eventEl.addEventListener('mousemove', (e) => positionTooltip(e));
    eventEl.addEventListener('mouseleave', hideEventTooltip);

    // Admin 컨트롤 (admin-mode일 때만 CSS로 표시)
    const safeEventId = escapeHtml(event.id);
    const adminControls = `
        <div class="admin-event-controls">
            <button class="admin-ctrl-btn" data-admin-action="edit" data-event-id="${safeEventId}" title="편집">&#9998;</button>
            <button class="admin-ctrl-btn hide-btn" data-admin-action="toggle-hidden" data-event-id="${safeEventId}" title="${event.hidden ? '노출' : '숨김'}">${event.hidden ? '&#9711;' : '&#10005;'}</button>
        </div>
    `;

    eventEl.innerHTML = `
        ${adminControls}
        <div class="week-event-time ${timeClass}">${time}</div>
        <div class="week-event-content">
            <div class="week-event-header">
                <img class="week-event-image" alt="">
                <span class="week-event-title">${escapeHtml(getTitle(event))}</span>
                <button class="event-link-btn" data-polymarket-slug="${slugSafe}" title="Open in Polymarket">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                </button>
            </div>
            <div class="week-event-meta">
                <span class="week-event-prob ${probClass}">${prob}%</span>
                <span class="week-event-volume">Vol: $${volume}</span>
            </div>
        </div>
    `;

    const eventImg = eventEl.querySelector('.week-event-image');
    if (eventImg) applySafeImage(eventImg, imageUrl);

    // 이벤트 위임: Polymarket 링크 버튼
    const linkBtn = eventEl.querySelector('.event-link-btn[data-polymarket-slug]');
    if (linkBtn) {
        linkBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            window.open('https://polymarket.com/event/' + linkBtn.dataset.polymarketSlug, '_blank');
        });
    }

    // 이벤트 위임: Admin 컨트롤
    eventEl.querySelectorAll('[data-admin-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.eventId;
            if (btn.dataset.adminAction === 'edit') v2OpenEditModal(id);
            else if (btn.dataset.adminAction === 'toggle-hidden') v2ToggleHidden(id);
        });
    });

    container.appendChild(eventEl);
}

// Calendar Overview 렌더링 (3주간 개요)
function renderCalendarOverview(searchQuery = '') {
    const todayKST = getKSTToday();
    const filtered = getFilteredEvents(searchQuery);

    // 시작 날짜 계산 (Week View 끝난 다음날부터 + 추가 주)
    const startDate = addDays(todayKST, 5 + (calendarOverviewStartWeek * 7));

    // 3주간 날짜 계산
    const weekDates = [];
    for (let i = 0; i < 21; i++) {
        weekDates.push(addDays(startDate, i));
    }

    // 이벤트를 날짜별로 그룹화
    const eventsByDate = {};
    filtered.forEach(event => {
        if (event.end_date) {
            const dateKey = toKSTDateString(event.end_date);
            if (weekDates.includes(dateKey)) {
                if (!eventsByDate[dateKey]) {
                    eventsByDate[dateKey] = [];
                }
                eventsByDate[dateKey].push(event);
            }
        }
    });

    // Calendar range 업데이트
    const rangeStart = new Date(startDate + 'T00:00:00');
    const rangeEnd = new Date(addDays(startDate, 20) + 'T00:00:00');
    const rangeText = `${rangeStart.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })} - ${rangeEnd.toLocaleDateString(getLocale(), { month: 'short', day: 'numeric', timeZone: 'Asia/Seoul' })}`;
    document.getElementById('calendarRange').textContent = rangeText;

    // Calendar days 렌더링
    const daysContainer = document.getElementById('calendarOverviewDays');
    daysContainer.innerHTML = '';

    let previousMonth = null;
    weekDates.forEach(dateKey => {
        const dayEvents = eventsByDate[dateKey] || [];
        const date = new Date(dateKey + 'T00:00:00');
        const isToday = dateKey === todayKST;

        const dayEl = document.createElement('div');
        dayEl.className = `calendar-overview-day${isToday ? ' today' : ''}`;

        const dayNumber = date.getDate();
        const currentMonth = date.getMonth();

        // 월이 바뀌는지 확인 (1일이거나 이전 월과 다를 때)
        const isNewMonth = previousMonth !== null && previousMonth !== currentMonth;
        previousMonth = currentMonth;

        // 월 정보 생성 (월이 바뀔 때만)
        let monthLabel = '';
        if (isNewMonth || dayNumber === 1) {
            const monthName = date.toLocaleDateString(getLocale(), { month: 'short', timeZone: 'Asia/Seoul' });
            monthLabel = `<div class="calendar-overview-month-label">${monthName}</div>`;
        }

        // 거래량 기준 상위 3개 선택
        const sortedEvents = [...dayEvents].sort((a, b) => (parseFloat(b.volume) || 0) - (parseFloat(a.volume) || 0));
        const topEvents = sortedEvents.slice(0, 3);

        // Build day element
        dayEl.innerHTML = `
            ${monthLabel}
            <div class="calendar-overview-day-number">${dayNumber}</div>
            ${topEvents.length > 0 ? '<div class="calendar-overview-events"></div>' : ''}
            ${dayEvents.length > 3 ? `<div class="calendar-overview-more-link" data-date-key="${escapeHtml(dateKey)}">+${dayEvents.length - 3} ${translations[currentLang].more}</div>` : ''}
        `;

        daysContainer.appendChild(dayEl);

        // more 링크 이벤트 바인딩
        const moreLink = dayEl.querySelector('.calendar-overview-more-link[data-date-key]');
        if (moreLink) {
            moreLink.addEventListener('click', () => {
                showDayEvents(moreLink.dataset.dateKey);
            });
        }

        // 이벤트 렌더링
        if (topEvents.length > 0) {
            const eventsContainer = dayEl.querySelector('.calendar-overview-events');
            topEvents.forEach(event => {
                renderOverviewEventItem(eventsContainer, event);
            });
        }
    });
}

// Calendar Overview 개별 이벤트 아이템
function renderOverviewEventItem(container, event) {
    const imageUrl = event.image_url || '';
    const prob = getMainProb(event);
    const probClass = prob < 30 ? 'low' : prob < 70 ? 'mid' : '';
    const title = truncate(getTitle(event), 25);
    const slugSafe = escapeHtml(event.slug || '');
    const eventSlugSafe = escapeHtml(event.event_slug || '');
    const category = inferCategory(event);
    const categoryColor = categoryColors[category] || categoryColors['default'];

    const eventEl = document.createElement('div');
    eventEl.className = 'calendar-overview-event';
    eventEl.dataset.category = category;
    if (event.hidden) eventEl.setAttribute('data-hidden', 'true');
    eventEl.style.borderLeftColor = categoryColor;
    eventEl.onclick = (e) => { e.stopPropagation(); openEventLink(slugSafe, '', eventSlugSafe); };

    eventEl.addEventListener('mouseenter', (e) => showEventTooltip(e, event));
    eventEl.addEventListener('mousemove', (e) => positionTooltip(e));
    eventEl.addEventListener('mouseleave', hideEventTooltip);

    // Admin 컨트롤 (admin-mode일 때만 CSS로 표시)
    const safeEventId = escapeHtml(event.id);
    const adminHtml = `
        <div class="admin-event-controls overview-admin-controls">
            <button class="admin-ctrl-btn" data-admin-action="edit" data-event-id="${safeEventId}" title="편집">&#9998;</button>
            <button class="admin-ctrl-btn hide-btn" data-admin-action="toggle-hidden" data-event-id="${safeEventId}" title="${event.hidden ? '노출' : '숨김'}">${event.hidden ? '&#9711;' : '&#10005;'}</button>
        </div>
    `;

    eventEl.innerHTML = `
        ${adminHtml}
        <img class="overview-event-image" alt="">
        <span class="overview-event-title">${escapeHtml(title)}</span>
        <span class="overview-event-prob ${probClass}">${prob}%</span>
    `;

    const eventImg = eventEl.querySelector('.overview-event-image');
    if (eventImg) applySafeImage(eventImg, imageUrl);

    // 이벤트 위임: Admin 컨트롤
    eventEl.querySelectorAll('[data-admin-action]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = btn.dataset.eventId;
            if (btn.dataset.adminAction === 'edit') v2OpenEditModal(id);
            else if (btn.dataset.adminAction === 'toggle-hidden') v2ToggleHidden(id);
        });
    });

    container.appendChild(eventEl);
}

function renderCalendar(searchQuery = '') {
    if (document.startViewTransition) {
        document.startViewTransition(() => {
            renderWeekView(searchQuery);
            renderCalendarOverview(searchQuery);
        });
    } else {
        renderWeekView(searchQuery);
        renderCalendarOverview(searchQuery);
    }
}

function getMainProb(event) {
    if (!event.probs || !Array.isArray(event.probs)) return 50;
    const prob = parseFloat(event.probs[0]);
    return Math.round(prob * 100);
}

function truncate(str, length) {
    if (!str) return '';
    return str.length > length ? str.substring(0, length) + '...' : str;
}

function sanitizeImageUrl(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'https:') return '';
        if (!IMAGE_HOST_ALLOWLIST.has(parsed.host)) {
            console.warn('[image] Unknown host:', parsed.host);
        }
        return parsed.toString();
    } catch (e) {
        return '';
    }
}

function applySafeImage(imgEl, url) {
    if (!imgEl) return;
    const safeUrl = sanitizeImageUrl(url);
    if (!safeUrl) {
        imgEl.style.display = 'none';
        return;
    }
    imgEl.src = safeUrl;
    imgEl.addEventListener('error', () => {
        imgEl.style.display = 'none';
    }, { once: true });
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function highlightSearchTerm(text, searchTerm) {
    if (!text || !searchTerm || searchTerm.trim() === '') {
        return escapeHtml(text);
    }

    const escapedText = escapeHtml(text);
    const escapedTerm = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex special chars
    const regex = new RegExp(`(${escapedTerm})`, 'gi');

    return escapedText.replace(regex, '<span class="search-highlight">$1</span>');
}

function openEventLink(slug, searchQuery, eventSlug) {
    if (searchQuery) {
        // 그룹화된 이벤트는 검색 페이지로 이동
        const encoded = encodeURIComponent(searchQuery);
        window.open(`https://polymarket.com/markets?_q=${encoded}`, '_blank');
    } else if (eventSlug) {
        // ✅ event_slug가 있으면 바로 사용 (가장 정확한 URL)
        // API의 events[0].slug로, 그룹 이벤트 페이지 URL과 정확히 일치
        window.open(`https://polymarket.com/event/${eventSlug}`, '_blank');
    } else if (slug) {
        // ⚠️ event_slug가 없는 경우 기존 패턴 기반 정규화로 폴백
        let normalizedSlug = slug;

        // 패턴 1: 온도 시장 (연도-온도값[단위][옵션])
        // Fahrenheit 양수: -2026-41forbelow, -2026-42-43f, -2026-52forhigher
        // Celsius 양수: -2026-0c, -2026-1c, -2026-14corhigher, -2026-35corbelow
        // Celsius 음수: -2026-neg-3c, -2026-neg-4corbelow (토론토 등)
        const tempRangePattern = /-(\d{4})-(?:neg-)?\d+-?\d*[cf](?:orhigher|orbelow)?$/;

        // 패턴 2: 숫자 범위 시장 (날짜-숫자범위)
        // ⚠️ 날짜 패턴 제외: -11-2026 (일-연도) vs -380-399 (트윗 수)
        // → 3자리 이상 숫자만 매칭하여 날짜 보호
        // 예: -february-10-380-399, -december-16-260-279
        const numericRangePattern = /-(\d{3,}-\d{2,})$/;

        // 패턴 2-1: 플러스 패턴 (예: 580+, 140+)
        // 예: elon-musk-of-tweets-february-6-february-13-580plus
        const plusPattern = /-\d+plus$/;

        // 패턴 3: 가격 above/below (coin-above-price-on-date)
        // 예: ethereum-above-2600-on-february-10 → ethereum-above-on-february-10
        // 소수점 표기: xrp-above-1pt5-on → xrp-above-on
        const priceAboveBelowPattern = /-(above|below)-[\d]+(?:pt\d+)?k?-on-/;

        // 패턴 4: 가격 between (be-between-price1-price2)
        // 예: bitcoin-be-between-74000-76000-on → bitcoin-price-on
        // 소수점 지원: xrp-between-0pt90-1pt00 (XRP $0.90-$1.00)
        const priceBetweenPattern = /-be-between-[\d]+(?:pt\d+)?-[\d]+(?:pt\d+)?-on-/;

        // 패턴 5: greater than / less than
        // 예: will-the-price-of-solana-be-greater-than-130-on-february-12 → solana-price-on-february-12
        // 소수점 지원: xrp-greater-than-1pt70 (XRP $1.70)
        const greaterLessThanPattern = /^will-the-price-of-([^-]+)-be-(?:greater-than|less-than)-[\d]+(?:pt\d+)?-on-(.+)$/;

        // 패턴 6: reach / dip to (ID 제거 버전, 검색 페이지용)
        // 예1: will-ethereum-reach-2800-february-9-15 → 검색: "Ethereum February 9-15"
        // 예2: will-bitcoin-dip-to-60k-in-february-2026-644-513-935 → 검색: "Bitcoin February 2026"
        const reachDipPattern = /^will-([^-]+)-(?:reach|dip-to)-[\d]+(?:pt\d+)?k?-((?:in|on|by)-.+?)(?:-\d{3}-\d{3}-\d{3})?$/;

        // 패턴 7: Trump say "this week" (그룹 페이지로 직접 이동)
        // 예: will-trump-say-olympics-this-week-february-15 → what-will-trump-say-this-week-february-15
        const trumpSayThisWeekPattern = /^will-trump-say-.+-this-week-(.+)$/;

        // 패턴 8: Robot dancers (검색 페이지용)
        // 예: will-agibot-have-robot-dancers-at-the-2026-spring-festival-gala → 검색: "Robot dancers 2026 Spring Festival Gala"
        const robotDancersPattern = /^will-[^-]+-have-robot-dancers-at-(.+)$/;

        // 패턴 9: Stock close at (검색 페이지용)
        // 예: will-amzn-close-between-235-and-240-week-february-13-2026 → 검색: "AMZN close February 13 2026"
        const stockClosePattern = /^will-([a-z]+)-close-(?:above|between)-[\d]+(?:-and-[\d]+)?-week-(.+)$/;

        // 패턴 10: Exactly N [event] (검색 페이지용)
        // 예: will-there-be-exactly-3-earthquakes-of-magnitude-6pt5-or-higher-worldwide-by-february-15 → 검색: "Earthquakes magnitude 6.5 February 15"
        const exactlyNumberPattern = /^will-there-be-exactly-\d+-(.+)$/;

        if (tempRangePattern.test(slug)) {
            // 온도 범위 부분 제거 (연도까지만 유지)
            normalizedSlug = slug.replace(tempRangePattern, '-$1');
        } else if (priceAboveBelowPattern.test(slug)) {
            // 가격 above/below: 가격 숫자 제거 (소수점 포함)
            normalizedSlug = slug.replace(/-(above|below)-[\d]+(?:pt\d+)?k?-on-/, '-$1-on-');
        } else if (priceBetweenPattern.test(slug)) {
            // 가격 between: 전체 구조 변경 (소수점 지원)
            normalizedSlug = slug.replace(/will-the-price-of-([^-]+)-be-between-[\d]+(?:pt\d+)?-[\d]+(?:pt\d+)?-on-(.+)/, '$1-price-on-$2');
        } else if (greaterLessThanPattern.test(slug)) {
            // 🆕 패턴 5: greater/less than 변환
            normalizedSlug = slug.replace(greaterLessThanPattern, '$1-price-on-$2');
        } else if (reachDipPattern.test(slug)) {
            // 🆕 패턴 6: reach/dip → 검색 페이지로 리다이렉트
            const match = slug.match(reachDipPattern);
            const subject = match[1]; // ethereum, bitcoin 등
            const period = match[2]; // february-9-15, in-february-2026 등

            // 검색어 생성: "Ethereum February 9-15"
            const searchQuery = `${subject} ${period.replace(/-/g, ' ')}`;
            window.open(`https://polymarket.com/markets?_q=${encodeURIComponent(searchQuery)}`, '_blank');
            return; // 검색 페이지로 이동했으므로 더 이상 처리 안 함
        } else if (trumpSayThisWeekPattern.test(slug)) {
            // 패턴 7: Trump say "this week" → 그룹 페이지로 직접 이동
            normalizedSlug = slug.replace(trumpSayThisWeekPattern, 'what-will-trump-say-this-week-$1');
            // 정규화된 slug로 계속 진행 (아래 단일 마켓 링크 생성)
        } else if (robotDancersPattern.test(slug)) {
            // 패턴 8: Robot dancers → 검색 페이지
            const match = slug.match(robotDancersPattern);
            const event = match[1]; // 2026-spring-festival-gala 등
            const searchQuery = `robot dancers ${event.replace(/-/g, ' ')}`;
            window.open(`https://polymarket.com/markets?_q=${encodeURIComponent(searchQuery)}`, '_blank');
            return;
        } else if (stockClosePattern.test(slug)) {
            // 패턴 9: Stock close → 검색 페이지
            const match = slug.match(stockClosePattern);
            const ticker = match[1]; // amzn, tsla 등
            const period = match[2]; // february-13-2026 등
            const searchQuery = `${ticker} close ${period.replace(/-/g, ' ')}`;
            window.open(`https://polymarket.com/markets?_q=${encodeURIComponent(searchQuery)}`, '_blank');
            return;
        } else if (exactlyNumberPattern.test(slug)) {
            // 패턴 10: Exactly N → 검색 페이지
            const match = slug.match(exactlyNumberPattern);
            const event = match[1]; // earthquakes-of-magnitude-6pt5-or-higher-worldwide-by-february-15 등
            const searchQuery = event.replace(/-/g, ' ').replace(/pt/g, '.');
            window.open(`https://polymarket.com/markets?_q=${encodeURIComponent(searchQuery)}`, '_blank');
            return;
        } else if (plusPattern.test(slug)) {
            // 플러스 패턴 제거 (예: -580plus → '')
            normalizedSlug = slug.replace(plusPattern, '');
        } else if (numericRangePattern.test(slug)) {
            // 숫자 범위 부분 제거 (트윗 수 등)
            // 단, 타임스탬프 패턴은 제외 (updown-15m-숫자)
            if (!/-15m-\d+$/.test(slug)) {
                normalizedSlug = slug.replace(numericRangePattern, '');
            }
        }

        // 단일 마켓은 직접 링크
        window.open(`https://polymarket.com/event/${normalizedSlug}`, '_blank');
    }
}

function showDayEvents(dateKey) {
    const filtered = getFilteredEvents(document.getElementById('searchInput').value);
    // KST 기준으로 해당 날짜의 이벤트 필터링
    const dayEvents = filtered.filter(e => toKSTDateString(e.end_date) === dateKey);

    const date = new Date(dateKey + 'T00:00:00');
    const dateStr = date.toLocaleDateString(getLocale(), {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        timeZone: 'Asia/Seoul'
    });

    document.getElementById('modalDate').textContent = `${dateStr} 만료 예정`;

    const modalBody = document.getElementById('modalBody');
    modalBody.innerHTML = '';

    dayEvents.forEach(event => {
        renderModalEventItem(modalBody, event);
    });

    document.getElementById('modalOverlay').classList.add('active');
}

// 모달 개별 이벤트 아이템
function renderModalEventItem(container, event) {
    const imageUrl = event.image_url || '';
    const prob = getMainProb(event);
    const probClass = prob < 30 ? 'low' : prob < 70 ? 'mid' : '';
    const slugSafe = escapeHtml(event.slug || '');
    const eventSlugSafe = escapeHtml(event.event_slug || '');
    const hasLink = slugSafe || eventSlugSafe;

    const eventEl = document.createElement('div');
    eventEl.className = `modal-event-item${!hasLink ? ' disabled' : ''}`;
    if (hasLink) {
        eventEl.onclick = () => openEventLink(slugSafe, '', eventSlugSafe);
    }
    eventEl.innerHTML = `
        <img class="modal-event-image" alt="">
        <div class="modal-event-content">
            <div class="modal-event-title">${escapeHtml(getTitle(event))}</div>
            <div class="modal-event-category">${escapeHtml(event.category || 'Uncategorized')}</div>
        </div>
        <span class="modal-event-prob ${probClass}">${prob}%</span>
    `;
    const eventImg = eventEl.querySelector('.modal-event-image');
    if (eventImg) applySafeImage(eventImg, imageUrl);
    container.appendChild(eventEl);
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('active');
}

// 모든 이벤트 핸들러는 addEventListener로 바인딩됨

// ============================================================================
// Language Toggle (한국어/English)
// ============================================================================

const translations = {
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

let currentLang = localStorage.getItem('language') || 'ko';

// 🌐 제목 언어 선택 헬퍼 함수
function getTitle(event) {
    // 한국어 선택 시: title_ko가 있으면 한글, 없으면 영어
    // 영어 선택 시: 항상 영어
    if (currentLang === 'ko' && event.title_ko) {
        return event.title_ko;
    }
    return event.title;
}

function translatePage() {
    const t = translations[currentLang];

    // Search placeholder
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.placeholder = t.search;
    }

    // Data range info banner
    const dataRangeInfo = document.getElementById('dataRangeInfo');
    if (dataRangeInfo) {
        dataRangeInfo.textContent = t.dataRangeInfo;
    }

    // Refresh button tooltip
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.setAttribute('title', t.refreshTooltip);
    }

    // Filter label
    const filterLabels = document.querySelectorAll('.filter-label');
    filterLabels.forEach(label => {
        if (label.textContent.trim().includes('Filter')) {
            const svg = label.querySelector('svg');
            label.textContent = t.filters;
            if (svg) label.prepend(svg);
        }
    });

    // Filter placeholder
    const filterPlaceholder = document.querySelector('.filter-placeholder');
    if (filterPlaceholder) {
        filterPlaceholder.textContent = t.clickToAdd;
    }

    // Update category names in calendar
    document.querySelectorAll('.category-label').forEach(el => {
        const originalCategory = el.getAttribute('data-category');
        if (originalCategory && t.categories[originalCategory]) {
            el.textContent = t.categories[originalCategory];
        }
    });

    // Update language toggle button
    const langToggle = document.getElementById('langToggle');
    if (langToggle) {
        langToggle.querySelector('.lang-text').textContent = currentLang.toUpperCase();
    }

    // Filter modal labels
    const filterModalTitle = document.getElementById('filterModalTitle');
    if (filterModalTitle) filterModalTitle.textContent = t.filters;

    const filterTagsLabel = document.getElementById('filterTagsLabel');
    if (filterTagsLabel) filterTagsLabel.textContent = t.tagsLabel;

    const tagSearchInput = document.getElementById('tagSearchInput');
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

    // Time remaining filter options
    document.querySelectorAll('#timeRemainingOptions .filter-option').forEach(btn => {
        const val = btn.dataset.value;
        if (val === 'all') {
            btn.textContent = t.all;
        } else {
            btn.textContent = `< ${val}${t.days}`;
        }
    });

    // Volume/Liquidity "All" button
    document.querySelectorAll('#minVolumeOptions .filter-option, #minLiquidityOptions .filter-option').forEach(btn => {
        if (btn.dataset.value === '0') btn.textContent = t.all;
    });

    // Note: Quick filter chips are intentionally kept in English only
    // They are not translated to maintain consistency across languages

    // Re-render calendar to update translated categories
    if (typeof renderCalendar === 'function') {
        renderCalendar();
    }
}

function getLocale() {
    return currentLang === 'ko' ? 'ko-KR' : 'en-US';
}

function toggleLanguage() {
    currentLang = currentLang === 'ko' ? 'en' : 'ko';
    localStorage.setItem('language', currentLang);
    translatePage();
}

// Initialize language
function initLanguage() {
    translatePage();

    const langToggle = document.getElementById('langToggle');
    if (langToggle) {
        langToggle.addEventListener('click', toggleLanguage);
    }
}

// Helper function to get translated category name
function getTranslatedCategory(category) {
    const t = translations[currentLang];
    return t.categories[category] || category;
}

// Export for use in rendering functions
window.getCurrentLang = () => currentLang;
window.getTranslation = (key) => translations[currentLang][key] || key;
window.getTranslatedCategory = getTranslatedCategory;
// showDayEvents는 data-date-key 이벤트 위임으로 호출됨


// ═══════════════════════════════════════════════════════
// ─── V2 Admin Inline Mode ───
// ═══════════════════════════════════════════════════════

let isAdminMode = false;
let v2EditingEventId = null;

// 초기화: DOMContentLoaded에서 supabaseClient 준비 후 호출됨
async function initV2Admin() {
    // admin-auth.js가 로드되지 않았으면 건너뜀
    if (typeof getAdminSession === 'undefined') return;

    const adminToggle = document.getElementById('adminToggle');
    if (!adminToggle) return;

    // 기존 세션 확인
    try {
        const session = await getAdminSession();
        if (session) v2EnterAdminMode();
    } catch (e) {
        // 무시 — 로그인 안 된 상태
    }

    // 관리자 버튼 클릭
    adminToggle.addEventListener('click', () => {
        if (isAdminMode) {
            v2ShowSignOutConfirm();
        } else {
            v2ShowLoginModal();
        }
    });

    // 로그인 모달
    const loginOverlay = document.getElementById('adminLoginOverlay');
    if (loginOverlay) {
        document.getElementById('adminLoginClose').addEventListener('click', v2CloseLoginModal);
        document.getElementById('v2LoginCancel').addEventListener('click', v2CloseLoginModal);
        loginOverlay.addEventListener('click', (e) => {
            if (e.target === loginOverlay) v2CloseLoginModal();
        });
        document.getElementById('v2LoginSubmit').addEventListener('click', v2HandleLogin);
        // Enter key
        document.getElementById('v2AdminPassword').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') v2HandleLogin();
        });
    }

    // 편집 모달
    const editOverlay = document.getElementById('v2EditOverlay');
    if (editOverlay) {
        document.getElementById('v2EditClose').addEventListener('click', v2CloseEditModal);
        document.getElementById('v2EditCancel').addEventListener('click', v2CloseEditModal);
        editOverlay.addEventListener('click', (e) => {
            if (e.target === editOverlay) v2CloseEditModal();
        });
        document.getElementById('v2EditSave').addEventListener('click', v2SaveEdit);
    }

    // 로그아웃
    const signOutBtn = document.getElementById('v2SignOut');
    if (signOutBtn) {
        signOutBtn.addEventListener('click', v2HandleSignOut);
    }

    // Auth state 변화 감지
    onAdminAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN') v2EnterAdminMode();
        if (event === 'SIGNED_OUT') v2ExitAdminMode();
    });

    // ESC 키로 모달 닫기
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('v2EditOverlay')?.classList.contains('active')) {
                v2CloseEditModal();
            } else if (document.getElementById('adminLoginOverlay')?.classList.contains('active')) {
                v2CloseLoginModal();
            }
        }
    });
}

function v2ShowLoginModal() {
    document.getElementById('adminLoginOverlay').classList.add('active');
    document.getElementById('v2AdminEmail').focus();
}

function v2CloseLoginModal() {
    document.getElementById('adminLoginOverlay').classList.remove('active');
    document.getElementById('v2LoginError').textContent = '';
    document.getElementById('v2AdminEmail').value = '';
    document.getElementById('v2AdminPassword').value = '';
}

async function v2HandleLogin() {
    const errorEl = document.getElementById('v2LoginError');
    errorEl.textContent = '';
    try {
        await adminSignIn(
            document.getElementById('v2AdminEmail').value,
            document.getElementById('v2AdminPassword').value
        );
        v2CloseLoginModal();
    } catch (err) {
        errorEl.textContent = err.message;
    }
}

async function v2EnterAdminMode() {
    isAdminMode = true;
    document.body.classList.add('admin-mode');

    // 통계 배너 표시
    document.getElementById('adminStatsBanner').style.display = 'block';
    await v2LoadStats();

    // hidden 이벤트 포함해서 데이터 리로드
    await v2ReloadWithHidden();
}

function v2ExitAdminMode() {
    isAdminMode = false;
    document.body.classList.remove('admin-mode');
    document.getElementById('adminStatsBanner').style.display = 'none';

    // hidden 필터 복원하여 리로드
    localStorage.removeItem('polymarket_events_cache');
    localStorage.removeItem('polymarket_cache_time');
    loadData().then(() => renderCalendar());
}

function v2ShowSignOutConfirm() {
    if (confirm('관리자 모드를 종료하시겠습니까?')) {
        v2HandleSignOut();
    }
}

async function v2HandleSignOut() {
    await adminSignOut();
}

async function v2LoadStats() {
    try {
        const now = new Date().toISOString();
        const [totalRes, translatedRes, hiddenRes] = await Promise.all([
            supabaseClient.from('poly_events')
                .select('id', { count: 'exact', head: true })
                .gte('end_date', now).eq('closed', false),
            supabaseClient.from('poly_events')
                .select('id', { count: 'exact', head: true })
                .gte('end_date', now).eq('closed', false)
                .not('title_ko', 'is', null),
            supabaseClient.from('poly_events')
                .select('id', { count: 'exact', head: true })
                .gte('end_date', now).eq('hidden', true),
        ]);
        const total = totalRes.count || 0;
        const translated = translatedRes.count || 0;
        const hidden = hiddenRes.count || 0;
        document.getElementById('v2StatInfo').textContent =
            `전체 ${total.toLocaleString()} | 번역 ${translated.toLocaleString()} | 미번역 ${(total - translated).toLocaleString()} | 숨김 ${hidden.toLocaleString()}`;
    } catch (e) {
        console.error('Admin stats error:', e);
    }
}

async function v2ReloadWithHidden() {
    // hidden 포함 전체 데이터 로드 (캐시 무시)
    if (!supabaseClient) return;
    try {
        const now = new Date().toISOString();
        const upcomingWeeks = new Date();
        upcomingWeeks.setDate(upcomingWeeks.getDate() + 5 + 21);
        const maxDate = upcomingWeeks.toISOString();

        let allData = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await supabaseClient
                .from('poly_events')
                .select('id, title, title_ko, slug, event_slug, end_date, volume, volume_24hr, probs, category, closed, image_url, tags, hidden, description, description_ko')
                .gte('end_date', now)
                .lte('end_date', maxDate)
                .gte('volume', 1000)
                // hidden 필터 제거 — admin은 전부 봄
                .order('end_date', { ascending: true })
                .range(offset, offset + 999);

            if (error) throw error;
            if (data && data.length > 0) {
                allData = allData.concat(data);
                offset += 1000;
                hasMore = data.length === 1000;
            } else {
                hasMore = false;
            }
        }

        allEvents = groupSimilarMarkets(allData);
        extractTags();
        extractCategories();
        renderCalendar();
    } catch (e) {
        console.error('Admin reload error:', e);
    }
}

// 편집 모달
function v2OpenEditModal(eventId) {
    // allEvents에서 또는 그룹된 이벤트에서 찾기
    const event = allEvents.find(e => e.id === eventId);
    if (!event) return;

    v2EditingEventId = eventId;
    document.getElementById('v2EditTitleEn').textContent = event.title || '';
    document.getElementById('v2EditTitleKo').value = event.title_ko || '';
    document.getElementById('v2EditCategory').value = event.category || 'Uncategorized';
    document.getElementById('v2EditDescription').textContent = event.description || '(설명 없음)';
    document.getElementById('v2EditDescriptionKo').value = event.description_ko || '';

    // Polymarket 링크 설정
    const linkEl = document.getElementById('v2EditPolyLink');
    if (linkEl) {
        const slug = event.event_slug || event.slug || '';
        if (slug) {
            linkEl.href = `https://polymarket.com/event/${slug}`;
            linkEl.style.display = 'inline-flex';
        } else {
            linkEl.style.display = 'none';
        }
    }

    document.getElementById('v2EditOverlay').classList.add('active');
}

function v2CloseEditModal() {
    v2EditingEventId = null;
    document.getElementById('v2EditOverlay').classList.remove('active');
}

async function v2SaveEdit() {
    if (!v2EditingEventId) return;
    const saveBtn = document.getElementById('v2EditSave');
    saveBtn.disabled = true;
    saveBtn.textContent = '저장 중...';

    try {
        const updates = {
            title_ko: document.getElementById('v2EditTitleKo').value.trim() || null,
            category: document.getElementById('v2EditCategory').value,
            description_ko: document.getElementById('v2EditDescriptionKo').value.trim() || null,
        };

        const { error } = await supabaseClient
            .from('poly_events')
            .update(updates)
            .eq('id', v2EditingEventId);

        if (error) throw error;

        // 로컬 업데이트
        const event = allEvents.find(e => e.id === v2EditingEventId);
        if (event) Object.assign(event, updates);

        renderCalendar();
        v2CloseEditModal();
        v2ShowToast('저장 완료', 'success');
        v2LoadStats();

        // 캐시 무효화 (로컬 + 서버)
        localStorage.removeItem('polymarket_events_cache');
        localStorage.removeItem('polymarket_cache_time');
        bumpCacheVersion();
    } catch (err) {
        v2ShowToast('저장 실패: ' + err.message, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = '저장';
    }
}

async function v2ToggleHidden(eventId) {
    const event = allEvents.find(e => e.id === eventId);
    if (!event) return;

    const newHidden = !event.hidden;
    try {
        const { error } = await supabaseClient
            .from('poly_events')
            .update({ hidden: newHidden })
            .eq('id', eventId);

        if (error) throw error;

        event.hidden = newHidden;
        renderCalendar();
        v2ShowToast(newHidden ? '숨김 처리됨' : '노출됨', 'success');
        v2LoadStats();

        // 캐시 무효화 (로컬 + 서버)
        localStorage.removeItem('polymarket_events_cache');
        localStorage.removeItem('polymarket_cache_time');
        bumpCacheVersion();
    } catch (err) {
        v2ShowToast('오류: ' + err.message, 'error');
    }
}

// 서버 캐시 버전 갱신 (다른 유저의 캐시 무효화)
async function bumpCacheVersion() {
    try {
        await supabaseClient
            .from('cache_meta')
            .update({ last_updated: new Date().toISOString() })
            .eq('id', 1);
    } catch (e) {
        console.warn('cache_meta 업데이트 실패:', e);
    }
}

function v2ShowToast(message, type = 'success') {
    const toast = document.getElementById('v2Toast');
    if (!toast) return;
    toast.textContent = message;
    toast.className = `v2-toast ${type} show`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// v2 admin 컨트롤은 data-admin-action 이벤트 위임으로 호출됨
