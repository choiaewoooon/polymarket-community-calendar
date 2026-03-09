import { supabaseClient, allEvents, isAdminMode, setAllEvents, setIsLoadingMore, setAllTags, setAllCategories, setKoreaEvents } from './state.ts';
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

export async function loadData(): Promise<void> {
    console.log('📥 데이터 로드 시작');

    if (!supabaseClient) {
        console.log('⚠️ Supabase 없음 - 데모 데이터 사용');
        setAllEvents(groupSimilarMarkets(generateDemoData()));
        extractTags();
        extractCategories();
        return;
    }

    try {
        const cachedData = localStorage.getItem(CACHE_KEY);
        const cacheTime = localStorage.getItem(CACHE_TIME_KEY);

        if (cachedData && cacheTime) {
            const age = Date.now() - parseInt(cacheTime);
            if (age < CACHE_DURATION) {
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
                    setAllEvents(groupSimilarMarkets(JSON.parse(cachedData)));
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
    const RETRY_DELAYS = [1000, 2000, 4000];

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const PAGE_SIZE = 1000;
            const now = new Date().toISOString();
            const upcomingWeeks = new Date();
            upcomingWeeks.setDate(upcomingWeeks.getDate() + 5 + 21);
            const maxDate = upcomingWeeks.toISOString();

            const CONCURRENT = 2;
            let allData: PolyEvent[] = [];
            let offset = 0;
            let hasMore = true;

            const fetchPage = (off: number) => supabaseClient!
                .from('poly_events')
                .select('id, title, title_ko, slug, event_slug, end_date, volume, volume_24hr, probs, category, closed, image_url, tags, hidden')
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

            console.log('✅ 데이터 로드 성공:', allData.length, '건');
            setAllEvents(groupSimilarMarkets(allData));

            try {
                localStorage.setItem(CACHE_KEY, JSON.stringify(allEvents));
                localStorage.setItem(CACHE_TIME_KEY, Date.now().toString());
                console.log('💾 캐시에 저장 완료');
            } catch (e) {
                console.warn('⚠️ 캐시 저장 실패 (용량 초과 가능성):', e);
            }

            extractTags();
            extractCategories();
            return;
        } catch (error) {
            if (attempt < MAX_RETRIES) {
                const delay = RETRY_DELAYS[attempt];
                console.warn(`⚠️ 데이터 로드 실패 (${attempt + 1}/${MAX_RETRIES}), ${delay / 1000}초 후 재시도...`, error);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error('❌ 데이터 로드 최종 실패 (재시도 모두 소진):', error);
                setAllEvents(groupSimilarMarkets(generateDemoData()));
                extractTags();
            }
        }
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
    'pyongyang', 'seoul', 'busan', 'jeju',
    // 정치 - 인물 (한국 관련만)
    'yoon suk', 'yoon suk-yeol', 'yoon suk yeol',
    'lee jae-myung', 'lee jae myung', 'lee jaemyung',
    'han dong-hoon', 'han donghoon',
    'kim jong', 'kim jong un', 'kim jong-un',
    'people power party', 'democratic party of korea',
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
    // 스포츠 (한국 팀/리그)
    'korean baseball', 'kbo', 'k league',
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

const KOREA_CACHE_KEY = 'polymarket_korea_cache';
const KOREA_CACHE_TIME_KEY = 'polymarket_korea_cache_time';

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
    return KOREA_KEYWORDS_EN.some(keyword => titleLower.includes(keyword));
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

    try {
        const now = new Date().toISOString();
        const PAGE_SIZE = 1000;
        let allData: PolyEvent[] = [];
        let offset = 0;
        let hasMore = true;

        // 한국 관련 데이터를 넓게 가져오기 (종료일 제한 없이, volume 최소 100, closed 제외)
        while (hasMore) {
            const { data, error } = await supabaseClient
                .from('poly_events')
                .select('id, title, title_ko, slug, event_slug, end_date, volume, volume_24hr, probs, category, closed, image_url, tags, hidden')
                .gte('volume', 100)
                .eq('hidden', false)
                .eq('closed', false)
                .order('volume', { ascending: false })
                .range(offset, offset + PAGE_SIZE - 1);

            if (error) throw error;

            if (data && data.length > 0) {
                allData = allData.concat(data as PolyEvent[]);
                offset += PAGE_SIZE;
                hasMore = data.length === PAGE_SIZE;
            } else {
                hasMore = false;
            }
        }

        // 한국 관련 필터링
        const koreaData = allData.filter(isKoreaRelated);
        console.log(`✅ 한국 관련 데이터: ${koreaData.length}건 (전체 ${allData.length}건 중)`);

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
        // 에러 시 캐시 클리어
        localStorage.removeItem(KOREA_CACHE_KEY);
        localStorage.removeItem(KOREA_CACHE_TIME_KEY);
        // 폴백: 기존 allEvents에서 필터링
        setKoreaEvents(groupSimilarMarkets(allEvents.filter(isKoreaRelated)));
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
