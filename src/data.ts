import { supabaseClient, allEvents, isAdminMode, setAllEvents, setIsLoadingMore, setAllTags, setAllCategories, setKoreaEvents, setSureBetEvents, setSureBetLastUpdate, setSureBetIsRefreshing, setSureBetRefreshInterval, sureBetRefreshInterval, sureBetIsRefreshing } from './state.ts';
import { CACHE_KEY, CACHE_TIME_KEY, CACHE_DURATION } from './constants.ts';
import { toKSTDateString, addDays, inferCategory } from './utils.ts';
import type { PolyEvent } from './types.ts';

// ─── 그룹화 ───

export function groupSimilarMarkets(events: PolyEvent[]): PolyEvent[] {
    const groups = new Map<string, PolyEvent[]>();

    events.forEach(event => {
        let groupKey: string;
        if (event.image_url) {
            groupKey = `${event.image_url}|${event.end_date}`;
        } else {
            groupKey = `no-image-${event.id}`;
        }

        if (!groups.has(groupKey)) {
            groups.set(groupKey, []);
        }
        groups.get(groupKey)!.push(event);
    });

    const deduplicated: PolyEvent[] = [];
    let groupedCount = 0;

    groups.forEach(group => {
        if (group.length === 1) {
            deduplicated.push(group[0]);
        } else {
            groupedCount++;
            const totalVolume = group.reduce((sum, e) => sum + parseFloat(String(e.volume || 0)), 0);
            const best = group.reduce((best, curr) => {
                const bestYesProb = parseFloat(String(best.probs[0]));
                const currYesProb = parseFloat(String(curr.probs[0]));
                return currYesProb > bestYesProb ? curr : best;
            });
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

// ─── 태그/카테고리 추출 ───

export function extractTags(): void {
    const tags: Record<string, number> = {};
    allEvents.forEach(event => {
        if (event.tags && Array.isArray(event.tags)) {
            event.tags.forEach(tag => {
                if (tag) tags[tag] = (tags[tag] || 0) + 1;
            });
        }
    });

    const sortedTags = Object.entries(tags)
        .sort((a, b) => b[1] - a[1])
        .reduce((obj: Record<string, number>, [key, value]) => { obj[key] = value; return obj; }, {});

    setAllTags(sortedTags);
    const tagCountEl = document.getElementById('tagCount');
    if (tagCountEl) tagCountEl.textContent = `(${Object.keys(sortedTags).length})`;
}

export function extractCategories(): void {
    const cats: Record<string, number> = {};
    allEvents.forEach(event => {
        const category = inferCategory(event);
        cats[category] = (cats[category] || 0) + 1;
    });

    const sortedCategories = Object.entries(cats)
        .sort((a, b) => b[1] - a[1])
        .reduce((obj: Record<string, number>, [key, value]) => { obj[key] = value; return obj; }, {});

    setAllCategories(sortedCategories);
}

// ─── 데이터 로드 ───

// SWR: 캐시 최대 허용 시간 (30분 이내면 stale 캐시라도 즉시 표시)
const STALE_CACHE_MAX = 30 * 60 * 1000;

// 서버에서 데이터를 가져오는 핵심 함수 (재사용)
async function fetchFromServer(): Promise<PolyEvent[] | null> {
    if (!supabaseClient) return null;

    const PAGE_SIZE = 1000;
    const now = new Date().toISOString();
    const upcomingWeeks = new Date();
    upcomingWeeks.setDate(upcomingWeeks.getDate() + 5 + 21);
    const maxDate = upcomingWeeks.toISOString();

    // 캘린더에 필요한 최소 컬럼만 select (네트워크 페이로드 축소)
    const CALENDAR_COLUMNS = 'id,title,title_ko,slug,event_slug,end_date,volume,volume_24hr,probs,category,closed,image_url,tags';
    const CONCURRENT = 3; // 병렬 페이지 수 증가 (2→3)
    let allData: PolyEvent[] = [];
    let offset = 0;
    let hasMore = true;

    const fetchPage = (off: number) => supabaseClient!
        .from('poly_events')
        .select(CALENDAR_COLUMNS)
        .gte('end_date', now)
        .lte('end_date', maxDate)
        .gte('volume', 1000)
        .eq('hidden', false)
        .order('end_date', { ascending: true })
        .range(off, off + PAGE_SIZE - 1);

    while (hasMore) {
        const batch = [];
        for (let i = 0; i < CONCURRENT; i++) {
            batch.push(fetchPage(offset + i * PAGE_SIZE));
        }

        const results = await Promise.all(batch);
        let batchCount = 0;

        for (const result of results) {
            if (result.error) throw result.error;
            if (result.data && result.data.length > 0) {
                allData = allData.concat(result.data as PolyEvent[]);
                batchCount += result.data.length;
            }
        }

        console.log(`📦 ${allData.length}건 로드됨...`);
        offset += CONCURRENT * PAGE_SIZE;
        hasMore = batchCount >= CONCURRENT * PAGE_SIZE;
    }

    return allData;
}

// 캐시 저장 헬퍼
function saveToCache(data: PolyEvent[]): void {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(data));
        localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
        console.log('💾 캐시에 저장 완료');
    } catch (e) {
        console.warn('⚠️ 캐시 저장 실패 (용량 초과 가능성):', e);
    }
}

// 데이터를 상태에 적용하는 헬퍼
function applyData(data: PolyEvent[]): void {
    setAllEvents(groupSimilarMarkets(data));
    extractTags();
    extractCategories();
}

// 백그라운드 리밸리데이션 (SWR 핵심)
function revalidateInBackground(onUpdate: (() => void) | null): void {
    if (!supabaseClient) return;

    const cacheTime = localStorage.getItem(CACHE_TIME_KEY);
    const cacheTimestamp = cacheTime ? parseInt(cacheTime) : 0;
    const age = Date.now() - cacheTimestamp;

    // 캐시가 5분 이내이면 cache_meta만 확인 (가벼운 체크)
    if (age < CACHE_DURATION) {
        Promise.resolve(
            supabaseClient
                .from('cache_meta')
                .select('last_updated')
                .eq('id', 1)
                .single()
        )
            .then(({ data: meta }) => {
                if (meta && new Date(meta.last_updated).getTime() > cacheTimestamp) {
                    console.log('⚠️ 관리자 수정 감지, 백그라운드 갱신 시작');
                    fetchAndUpdate(onUpdate);
                } else {
                    console.log('✅ 캐시 유효 (cache_meta 확인 완료)');
                }
            })
            .catch(() => {
                // cache_meta 조회 실패 시 무시
            });
    } else {
        // 캐시 만료 → 서버에서 새로 가져오기
        console.log('🔄 캐시 만료, 백그라운드 갱신 시작');
        fetchAndUpdate(onUpdate);
    }
}

// 서버에서 데이터를 가져와 업데이트하는 함수
async function fetchAndUpdate(onUpdate: (() => void) | null): Promise<void> {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const freshData = await fetchFromServer();
            if (freshData) {
                console.log('✅ 백그라운드 갱신 완료:', freshData.length, '건');
                applyData(freshData);
                saveToCache(freshData);
                if (onUpdate) onUpdate();
            }
            return;
        } catch (error) {
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAYS[attempt];
                console.warn(`⚠️ 백그라운드 갱신 실패 (${attempt + 1}/${MAX_RETRIES}), ${delay / 1000}초 후 재시도...`, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error('❌ 백그라운드 갱신 최종 실패:', error);
            }
        }
    }
}

/**
 * SWR 기반 데이터 로드
 * - 캐시 있으면: 즉시 표시 → 백그라운드 갱신
 * - 캐시 없으면: 서버에서 직접 로드
 * @param onBackgroundUpdate 백그라운드 갱신 완료 시 호출할 콜백 (re-render용)
 */
export async function loadData(onBackgroundUpdate: (() => void) | null = null): Promise<void> {
    console.log('📥 데이터 로드 시작');

    if (!supabaseClient) {
        console.log('⚠️ Supabase 없음 - 데모 데이터 사용');
        applyData(generateDemoData());
        return;
    }

    // Phase 1: 캐시에서 즉시 로드 시도
    try {
        const cachedData = localStorage.getItem(CACHE_KEY);
        const cacheTime = localStorage.getItem(CACHE_TIME_KEY);

        if (cachedData && cacheTime) {
            const age = Date.now() - parseInt(cacheTime);

            if (age < STALE_CACHE_MAX) {
                console.log(`⚡ 캐시에서 즉시 로드 (${Math.round(age / 1000)}초 전)`);
                applyData(JSON.parse(cachedData));

                // Phase 2: 백그라운드에서 최신 데이터 확인/갱신
                revalidateInBackground(onBackgroundUpdate);
                return;
            } else {
                console.log('⚠️ 캐시 너무 오래됨 (30분+), 새로 로드');
            }
        }
    } catch (e) {
        console.log('⚠️ 캐시 로드 실패, 새로 로드');
    }

    // Phase 3: 캐시 없음 - 서버에서 직접 로드 (로딩 표시)
    showCalendarLoading();

    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const freshData = await fetchFromServer();
            if (freshData) {
                console.log('✅ 데이터 로드 성공:', freshData.length, '건');
                applyData(freshData);
                saveToCache(freshData);
            }
            return;
        } catch (error) {
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAYS[attempt];
                console.warn(`⚠️ 데이터 로드 실패 (${attempt + 1}/${MAX_RETRIES}), ${delay / 1000}초 후 재시도...`, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error('❌ 데이터 로드 최종 실패 (재시도 모두 소진):', error);
                applyData(generateDemoData());
            }
        }
    }
}

// 캘린더 로딩 표시 (첫 방문 시)
function showCalendarLoading(): void {
    const weekTimeline = document.getElementById('weekTimeline');
    if (weekTimeline) {
        weekTimeline.innerHTML = `
            <div class="korea-loading">
                <div class="korea-loading-spinner"></div>
                <div class="korea-loading-text">데이터 로드 중...</div>
            </div>
        `;
    }
    const calendarDays = document.getElementById('calendarOverviewDays');
    if (calendarDays) {
        calendarDays.innerHTML = `
            <div class="korea-loading" style="grid-column: 1 / -1;">
                <div class="korea-loading-spinner"></div>
                <div class="korea-loading-text">캘린더 데이터 로드 중...</div>
            </div>
        `;
    }
}

export async function loadMoreData(targetDate: string): Promise<void> {
    if (!supabaseClient || isAdminMode) return;

    setIsLoadingMore(true);
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
                .gte('volume', 1000)
                .order('end_date', { ascending: true })
                .limit(1000);

            if (!isAdminMode) {
                query = query.eq('hidden', false);
            }

            const { data, error } = await query;
            if (error) throw error;

            if (data && data.length > 0) {
                const existingIds = new Set(allEvents.map(e => e.id));
                const newEvents = (data as PolyEvent[]).filter(e => !existingIds.has(e.id));

                setAllEvents(groupSimilarMarkets(allEvents.concat(newEvents)));
                console.log('✅ 추가 로드:', newEvents.length, '건');

                try {
                    localStorage.setItem(CACHE_KEY, JSON.stringify(allEvents));
                    localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
                } catch (e) {
                    console.warn('⚠️ 캐시 업데이트 실패');
                }

                extractTags();
                extractCategories();
            }
            break;
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

    setIsLoadingMore(false);
}

// ─── 한국 관련 데이터 로드 ───

// 영문 제목(title)에서만 매칭하는 키워드
// title_ko는 모든 이벤트의 한국어 번역이므로 '탄핵', '대통령' 등이 트럼프/젤렌스키에도 들어감
const KOREA_KEYWORDS_EN = [
    // 국가/지역
    'korea', 'korean', 'south korea', 'north korea', 'dprk',
    'pyongyang', 'seoul', 'busan', 'jeju', 'incheon', 'daegu',
    'gwangju', 'daejeon', 'ulsan', 'sejong',
    'gyeonggi', 'gyeongsang', 'jeolla', 'chungcheong', 'gangwon', 'gangnam',
    // 정치 - 인물 (한국 관련만)
    'yoon suk', 'yoon suk-yeol', 'yoon suk yeol',
    'lee jae-myung', 'lee jae myung', 'lee jaemyung',
    'han dong-hoon', 'han donghoon',
    'kim jong', 'kim jong un', 'kim jong-un',
    'kim dong-yeon', 'lee un-ju', 'yoo seong-min',
    'ahn cheol-soo', 'na kyung-won', 'choo mi-ae',
    'yeom tae-yeong', 'won hee-ryong', 'han jun-ho',
    'yoo jeong-bok', 'yoon sang-hyun',
    // 2026 지방선거 후보
    'oh se-hoon', 'cho eun-hee', 'park yong-jin', 'park hong-keun',
    'kang hoon-sik', 'jeon hyun-heui', 'chong won-oh', 'park ju-min',
    'cho kuk', 'seo young-kyo', 'lee jae-sung',
    'hong soon-heon', 'kim young-choon', 'kim do-eup', 'park heong-joon', 'suh byung-soo',
    'park chan-dae', 'park nam-choon', 'chung il-young', 'yoo dong-soo',
    'yang seung-jo', 'kim tae-heum', 'kang seung-kyu', 'park soo-hyun',
    'cho gil-hyeong', 'do jong-hwan', 'shin yong-han', 'lee jong-bae', 'song ki-sub',
    'woo sang-ho', 'kim wan-seop',
    'people power party', 'democratic party of korea', 'reform party',
    'rebuilding korea party', 'progressive party',
    // 정치 - 기관/이슈
    'national assembly of korea', 'korean constitutional court',
    'korean unification', 'korean peninsula', 'dmz', 'denuclearization',
    'korean election', 'korean president',
    // 경제/금융
    'kospi', 'kosdaq', 'krw', 'bank of korea',
    'won dollar', 'won usd', 'korean won', 'usd/krw', 'usd-krw',
    'ks11', 'kq11',
    // 기업
    'samsung', 'hyundai', 'sk hynix', 'sk group', 'lg electronics', 'lg energy',
    'kakao', 'naver', 'coupang', 'celltrion', 'posco',
    'kia', 'hanwha',
    // 문화/엔터
    'kimchi', 'kpop', 'k-pop', 'k-drama', 'kdrama', 'hallyu',
    'bts', 'blackpink', 'squid game', 'netflix korea',
    'korean wave', 'k-beauty',
    // K-POP 그룹 (BTS/BlackPink 외)
    'aespa', 'newjeans', 'new jeans', 'le sserafim', 'ive',
    'ateez', 'babymonster', 'baby monster', 'itzy', 'twice',
    'stray kids', 'enhypen', 'nmixx', 'treasure',
    'zerobaseone', 'riize', 'boynextdoor', 'illit', 'plave',
    'day6', 'nct',
    // 스포츠 (한국 팀/리그/도시)
    'korean baseball', 'kbo', 'k league',
    'gwangju fc', 'daegu pegasus',
    // 군사/안보
    'korean missile', 'korean military', 'thaad korea',
    'korean war', 'armistice',
    // 김치 프리미엄 등
    'kimchi premium',
];

const KOREA_TAGS = [
    'South Korea', 'North Korea', 'Korea', 'Korean', 'KOSPI', 'KRX',
    'Seoul', 'Yoon', 'Lee Jae-myung', 'Korean Won', 'Samsung',
];

const KOREA_CACHE_KEY = 'polymarket_korea_cache_v2';  // v2: is_korea 서버 필터링
const KOREA_CACHE_TIME_KEY = 'polymarket_korea_cache_time_v2';

function isKoreaRelated(event: PolyEvent): boolean {
    // 영문 제목에서만 키워드 매칭 (title_ko는 번역이라 오탐 발생)
    const titleLower = (event.title || '').toLowerCase();

    // 태그 매칭
    if (event.tags && event.tags.some(tag =>
        KOREA_TAGS.some(kt => tag.toLowerCase().includes(kt.toLowerCase()))
    )) {
        return true;
    }

    // 영문 키워드는 영문 제목에서만 검색
    // 짧은 키워드(4글자 이하)는 단어 경계 체크 (kia→Pezeshkian 오탐 방지)
    return KOREA_KEYWORDS_EN.some(keyword => {
        if (keyword.length <= 4) {
            const regex = new RegExp(`\\b${keyword}\\b`, 'i');
            return regex.test(titleLower);
        }
        return titleLower.includes(keyword);
    });
}

function showKoreaLoading(message: string): void {
    const grid = document.getElementById('koreaCardsGrid');
    if (!grid) return;
    grid.innerHTML = `
        <div class="korea-loading">
            <div class="korea-loading-spinner"></div>
            <div class="korea-loading-text">${message}</div>
        </div>
    `;
}

export async function loadKoreaData(): Promise<void> {
    console.log('🇰🇷 한국 관련 데이터 로드 시작');

    if (!supabaseClient) {
        console.log('⚠️ Supabase 없음 - 기존 데이터에서 한국 필터링');
        setKoreaEvents(groupSimilarMarkets(allEvents.filter(isKoreaRelated)));
        return;
    }

    // 캐시 체크
    try {
        const cachedData = localStorage.getItem(KOREA_CACHE_KEY);
        const cacheTime = localStorage.getItem(KOREA_CACHE_TIME_KEY);

        if (cachedData && cacheTime) {
            const age = Date.now() - parseInt(cacheTime);
            if (age < CACHE_DURATION) {
                console.log('✅ 한국 데이터 캐시에서 로드');
                setKoreaEvents(groupSimilarMarkets(JSON.parse(cachedData)));
                return;
            }
        }
    } catch (e) {
        // 캐시 실패 시 무시
    }

    showKoreaLoading('한국 관련 시장 데이터 로드 중...');

    try {
        // is_korea 플래그로 서버사이드 필터링 (전체 로드 불필요)
        const PAGE_SIZE = 1000;
        let koreaData: PolyEvent[] = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore) {
            showKoreaLoading(`한국 데이터 로드 중... (${koreaData.length.toLocaleString()}건 수신)`);

            const { data, error } = await supabaseClient
                .from('poly_events')
                .select('id, title, title_ko, slug, event_slug, end_date, volume, volume_24hr, probs, category, closed, image_url, tags, hidden')
                .eq('is_korea', true)
                .eq('hidden', false)
                .eq('closed', false)
                .order('volume', { ascending: false })
                .range(offset, offset + PAGE_SIZE - 1);

            if (error) throw error;

            if (data && data.length > 0) {
                koreaData = koreaData.concat(data as PolyEvent[]);
                offset += PAGE_SIZE;
                hasMore = data.length === PAGE_SIZE;
            } else {
                hasMore = false;
            }
        }

        // 서버 필터 후 클라이언트 키워드로 추가 필터 (신규 마켓 대비 fallback)
        const serverCount = koreaData.length;
        console.log(`✅ 한국 관련 데이터: ${serverCount}건 (서버 필터링)`);

        const grouped = groupSimilarMarkets(koreaData);
        setKoreaEvents(grouped);

        try {
            localStorage.setItem(KOREA_CACHE_KEY, JSON.stringify(koreaData));
            localStorage.setItem(KOREA_CACHE_TIME_KEY, Date.now().toString());
        } catch (e) {
            console.warn('⚠️ 한국 데이터 캐시 저장 실패');
        }
    } catch (error) {
        console.error('❌ 한국 데이터 로드 실패:', error);
        localStorage.removeItem(KOREA_CACHE_KEY);
        localStorage.removeItem(KOREA_CACHE_TIME_KEY);
        setKoreaEvents(groupSimilarMarkets(allEvents.filter(isKoreaRelated)));
    }
}

// ─── 99% 마켓 (Sure Bet) — Polymarket Gamma API 실시간 ───

const GAMMA_API_BASE = '/api/gamma';
const SUREBET_REFRESH_INTERVAL = 10_000; // 10초

function showSureBetLoading(message: string): void {
    const grid = document.getElementById('sureBetCardsGrid');
    if (!grid) return;
    grid.innerHTML = `
        <div class="korea-loading">
            <div class="korea-loading-spinner"></div>
            <div class="korea-loading-text">${message}</div>
        </div>
    `;
}

// Gamma API 응답 → PolyEvent 변환
function inferCategoryFromQuestion(question: string): string {
    const q = question.toLowerCase();
    if (/\b(nfl|nba|mlb|nhl|soccer|football|baseball|basketball|tennis|golf|ufc|boxing|f1|formula|premier league|champions league|world cup|olympics|pga|atp|wta|mls|serie a|la liga|bundesliga|ligue 1|kbo|k league|ncaa|ipl|cricket|rugby|grand prix|super bowl|playoff|match|game score|win.*season)\b/.test(q)) return 'Sports';
    if (/\b(bitcoin|btc|ethereum|eth|crypto|solana|sol|token|blockchain|defi|nft|altcoin|memecoin|doge|xrp|cardano|polkadot|avalanche|polygon|arbitrum|base chain|binance)\b/.test(q)) return 'Crypto';
    if (/\b(president|election|congress|senate|vote|party|political|governor|mayor|democrat|republican|trump|biden|parliament|minister|referendum|impeach|primary|caucus|poll)\b/.test(q)) return 'Politics';
    if (/\b(stock|market|s&p|nasdaq|dow|gdp|inflation|fed|interest rate|tariff|trade|treasury|bond|yield|recession|unemployment|cpi|fomc|oil price|gold price|forex)\b/.test(q)) return 'Finance';
    if (/\b(movie|film|tv|show|oscar|grammy|emmy|celebrity|album|song|music|artist|concert|netflix|disney|spotify|billboard|box office|streaming|tikto[kc]|youtube|instagram)\b/.test(q)) return 'Pop Culture';
    if (/\b(ai\b|artificial intelligence|tech|apple|google|microsoft|meta|amazon|startup|software|hardware|chip|semiconductor|robot|openai|chatgpt|tesla)\b/.test(q)) return 'Technology';
    if (/\b(science|nasa|space|spacex|climate|research|study|disease|virus|vaccine|fda|drug|trial|weather|earthquake|hurricane|temperature)\b/.test(q)) return 'Science';
    return 'Uncategorized';
}

interface GammaMarket {
    id: string;
    question: string;
    slug: string;
    endDate: string;
    volume: string;
    volumeNum: number;
    volume24hr: number;
    outcomePrices: string[] | string;
    outcomes: string[] | string;
    closed: boolean;
    active: boolean;
    image: string;
    liquidity: string;
    liquidityNum: number;
    bestBid: number;
    bestAsk: number;
    lastTradePrice: number;
    spread: number;
    events: Array<{ slug: string; title: string }>;
    description: string;
}

function gammaToPolyEvent(m: GammaMarket): PolyEvent | null {
    // outcomePrices 파싱 (배열 또는 JSON 문자열)
    let prices: number[];
    try {
        const raw = typeof m.outcomePrices === 'string'
            ? JSON.parse(m.outcomePrices)
            : m.outcomePrices;
        prices = (raw as string[]).map((p: string) => parseFloat(p));
    } catch {
        return null;
    }

    if (!prices.length || prices.some(isNaN)) return null;

    // 종료 여부 확인 (API closed 플래그 + 날짜 체크)
    const endDate = new Date(m.endDate);
    if (isNaN(endDate.getTime())) return null;
    if (endDate.getTime() <= Date.now()) return null;
    if (m.closed || !m.active) return null;

    const volume = m.volumeNum || parseFloat(m.volume) || 0;
    if (volume < 5000) return null;

    // 유동성 최소 $1,000 (호가 없는 마켓 제거)
    const liquidity = m.liquidityNum || parseFloat(m.liquidity) || 0;
    if (liquidity < 1000) return null;

    // 90%+ 확률 필터
    const maxProb = Math.max(...prices);
    if (maxProb < 0.9) return null;

    // 스프레드 계산 (bestBid/bestAsk가 0이면 거래 불가)
    const bestBid = m.bestBid || 0;
    const bestAsk = m.bestAsk || 0;
    const spread = m.spread || (bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0);

    // bestBid와 bestAsk 모두 0이면 호가 없음 → 제거
    if (bestBid === 0 && bestAsk === 0) return null;

    const eventSlug = m.events?.[0]?.slug || '';
    const category = inferCategoryFromQuestion(m.question);

    return {
        id: m.id,
        title: m.question,
        slug: m.slug,
        event_slug: eventSlug,
        end_date: m.endDate,
        volume: volume,
        volume_24hr: m.volume24hr || 0,
        probs: prices,
        category: category,
        closed: false,
        image_url: m.image || null,
        liquidity: liquidity,
        bestBid: bestBid,
        bestAsk: bestAsk,
        spread: spread,
    };
}

// 서버사이드 /api/surebet 엔드포인트 응답 → PolyEvent 변환
interface SureBetAPIMarket {
    id: string;
    question: string;
    slug: string;
    eventSlug: string;
    endDate: string;
    volume: number;
    volume24hr: number;
    outcomePrices: number[];
    outcomes: string[];
    image: string | null;
    liquidity: number;
    bestBid: number;
    bestAsk: number;
    spread: number;
    description: string;
}

function sureBetAPIToPolyEvent(m: SureBetAPIMarket): PolyEvent {
    return {
        id: m.id,
        title: m.question,
        slug: m.slug,
        event_slug: m.eventSlug,
        end_date: m.endDate,
        volume: m.volume,
        volume_24hr: m.volume24hr,
        probs: m.outcomePrices,
        category: inferCategoryFromQuestion(m.question),
        closed: false,
        image_url: m.image,
        liquidity: m.liquidity,
        bestBid: m.bestBid,
        bestAsk: m.bestAsk,
        spread: m.spread,
    };
}

// 서버사이드 API로 한번에 가져오기 (20번 → 1번 요청)
async function fetchFromSureBetAPI(): Promise<PolyEvent[]> {
    const response = await fetch('/api/surebet');
    if (!response.ok) throw new Error(`SureBet API ${response.status}`);
    const markets: SureBetAPIMarket[] = await response.json();
    return markets.map(sureBetAPIToPolyEvent);
}

// Fallback: 클라이언트에서 직접 Gamma API 호출 (서버 API 실패 시)
async function fetchFromGammaAPIDirect(): Promise<PolyEvent[]> {
    const PAGE_SIZE = 100;
    const BATCH_SIZE = 4;
    const MAX_OFFSET = 2000;
    let allMarkets: PolyEvent[] = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore && offset < MAX_OFFSET) {
        const batchPromises = [];
        for (let i = 0; i < BATCH_SIZE && (offset + i * PAGE_SIZE) < MAX_OFFSET; i++) {
            const batchOffset = offset + i * PAGE_SIZE;
            const url = `${GAMMA_API_BASE}/markets?closed=false&active=true&limit=${PAGE_SIZE}&offset=${batchOffset}&order=volume&ascending=false`;
            batchPromises.push(
                fetch(url).then(async (res) => {
                    if (!res.ok) throw new Error(`Gamma API ${res.status}: ${res.statusText}`);
                    return res.json() as Promise<GammaMarket[]>;
                })
            );
        }

        const batchResults = await Promise.all(batchPromises);
        let batchTotalRaw = 0;

        for (const markets of batchResults) {
            if (!markets || markets.length === 0) { hasMore = false; break; }
            batchTotalRaw += markets.length;
            for (const m of markets) {
                const event = gammaToPolyEvent(m);
                if (event) allMarkets.push(event);
            }
            if (markets.length < PAGE_SIZE) { hasMore = false; break; }
        }

        offset += BATCH_SIZE * PAGE_SIZE;
        if (batchTotalRaw === 0) hasMore = false;
    }

    return allMarkets;
}

// 통합 fetch: 서버 API 우선 → 실패 시 클라이언트 직접 호출
async function fetchFromGammaAPI(): Promise<PolyEvent[]> {
    try {
        console.log('⚡ /api/surebet 서버사이드 API 호출');
        return await fetchFromSureBetAPI();
    } catch (err) {
        console.warn('⚠️ 서버 API 실패, 클라이언트 직접 호출로 전환:', err);
        return await fetchFromGammaAPIDirect();
    }
}

// 99% 마켓 캐시 (탭 재진입 시 즉시 표시)
const SUREBET_CACHE_KEY = 'polymarket_surebet_cache_v1';
const SUREBET_CACHE_TIME_KEY = 'polymarket_surebet_cache_time_v1';
const SUREBET_CACHE_DURATION = 60 * 1000; // 1분 (실시간 특성상 짧게)

export async function loadSureBetData(): Promise<void> {
    console.log('💰 99% 마켓 데이터 로드 시작 (Gamma API)');

    // SWR: 캐시가 있으면 즉시 표시 후 백그라운드 갱신
    try {
        const cached = localStorage.getItem(SUREBET_CACHE_KEY);
        const cacheTime = localStorage.getItem(SUREBET_CACHE_TIME_KEY);
        if (cached && cacheTime) {
            const age = Date.now() - parseInt(cacheTime);
            if (age < SUREBET_CACHE_DURATION) {
                console.log(`⚡ 99% 마켓 캐시에서 즉시 로드 (${Math.round(age / 1000)}초 전)`);
                setSureBetEvents(JSON.parse(cached));
                setSureBetLastUpdate(parseInt(cacheTime));
                // 백그라운드에서 최신 데이터 갱신
                fetchFromGammaAPI().then(markets => {
                    setSureBetEvents(markets);
                    setSureBetLastUpdate(Date.now());
                    try {
                        localStorage.setItem(SUREBET_CACHE_KEY, JSON.stringify(markets));
                        localStorage.setItem(SUREBET_CACHE_TIME_KEY, Date.now().toString());
                    } catch { /* 용량 초과 무시 */ }
                }).catch(() => { /* 백그라운드 실패 무시 */ });
                return;
            }
        }
    } catch { /* 캐시 읽기 실패 무시 */ }

    showSureBetLoading('Polymarket 실시간 데이터 로드 중...');

    try {
        const markets = await fetchFromGammaAPI();
        console.log(`✅ 99% 마켓: ${markets.length}건 로드 (Gamma API)`);
        setSureBetEvents(markets);
        setSureBetLastUpdate(Date.now());
        try {
            localStorage.setItem(SUREBET_CACHE_KEY, JSON.stringify(markets));
            localStorage.setItem(SUREBET_CACHE_TIME_KEY, Date.now().toString());
        } catch { /* 용량 초과 무시 */ }
    } catch (error) {
        console.error('❌ Gamma API 실패, Supabase fallback:', error);
        await loadSureBetFromSupabase();
    }
}

// Supabase fallback (API 실패 시)
async function loadSureBetFromSupabase(): Promise<void> {
    if (!supabaseClient) {
        const filtered = allEvents.filter(e => {
            const maxProb = Math.max(...(e.probs || []).map(p => parseFloat(String(p))));
            return maxProb >= 0.9 && !e.closed && new Date(e.end_date) > new Date();
        });
        setSureBetEvents(filtered);
        return;
    }

    try {
        const now = new Date().toISOString();
        const maxDate = new Date();
        maxDate.setDate(maxDate.getDate() + 90);

        const { data, error } = await supabaseClient
            .from('poly_events')
            .select('id, title, title_ko, slug, event_slug, end_date, volume, volume_24hr, probs, category, closed, image_url, tags, hidden')
            .eq('hidden', false)
            .eq('closed', false)
            .gte('end_date', now)
            .lte('end_date', maxDate.toISOString())
            .gte('volume', 5000)
            .order('end_date', { ascending: true })
            .limit(1000);

        if (error) throw error;

        const filtered = ((data || []) as PolyEvent[]).filter(e => {
            if (!e.probs || !Array.isArray(e.probs)) return false;
            const maxProb = Math.max(...e.probs.map(p => parseFloat(String(p))));
            return maxProb >= 0.9;
        });

        setSureBetEvents(filtered);
        setSureBetLastUpdate(Date.now());
    } catch (err) {
        console.error('❌ Supabase fallback도 실패:', err);
        setSureBetEvents([]);
    }
}

// 자동 갱신 (10초 간격)
export async function refreshSureBetData(onUpdate: () => void): Promise<void> {
    if (sureBetIsRefreshing) return;
    setSureBetIsRefreshing(true);

    try {
        const markets = await fetchFromGammaAPI();
        setSureBetEvents(markets);
        setSureBetLastUpdate(Date.now());
        onUpdate();
        console.log(`🔄 99% 마켓 갱신: ${markets.length}건`);
    } catch (error) {
        console.warn('⚠️ 99% 마켓 갱신 실패:', error);
    } finally {
        setSureBetIsRefreshing(false);
    }
}

export function startSureBetRefresh(onUpdate: () => void): void {
    stopSureBetRefresh();
    const id = setInterval(() => refreshSureBetData(onUpdate), SUREBET_REFRESH_INTERVAL);
    setSureBetRefreshInterval(id);
    console.log('▶️ 99% 마켓 자동 갱신 시작 (10초 간격)');
}

export function stopSureBetRefresh(): void {
    if (sureBetRefreshInterval) {
        clearInterval(sureBetRefreshInterval);
        setSureBetRefreshInterval(null);
        console.log('⏹️ 99% 마켓 자동 갱신 중지');
    }
}

function generateDemoData(): PolyEvent[] {
    const categories = ['Sports', 'Crypto', 'Politics', 'Pop Culture', 'Science', 'Business'];
    const demoTags = ['Sports', 'Games', 'Soccer', 'Politics', 'Basketball', 'Crypto', 'NCAA', 'Trump', 'Elections'];
    const demoEvents: PolyEvent[] = [];
    const now = new Date();

    for (let i = 0; i < 500; i++) {
        const endDate = new Date(now);
        endDate.setDate(endDate.getDate() + Math.floor(Math.random() * 60) - 10);
        const prob = Math.random();
        const eventTags: string[] = [];
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
            probs: [parseFloat(prob.toFixed(2)), parseFloat((1 - prob).toFixed(2))],
            outcomes: ['Yes', 'No'],
            category: categories[Math.floor(Math.random() * categories.length)],
            tags: eventTags
        });
    }

    return demoEvents;
}
