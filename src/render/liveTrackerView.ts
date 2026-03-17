import { supabaseClient, liveSelectedCity, liveWeatherEvents, setLiveSelectedCity, setLiveWeatherEvents } from '../state.ts';
import type { PolyEvent, WeatherMarket, CityWeatherGroup } from '../types.ts';
import { currentLang } from '../i18n.ts';
import { escapeHtml } from '../utils.ts';

// ─── 도시 → 관측소 매핑 (Resolution Source 기반) ───

interface CityStation {
    code: string;
    locationId: string;  // Weather.com API location ID
    unit: 'C' | 'F';
    flag: string;
    nameKo: string;
    lat: number;
    lon: number;
    tz: string;
}

const CITY_STATIONS: Record<string, CityStation> = {
    'Seoul': { code: 'RKSI', locationId: 'RKSI:9:KR', unit: 'C', flag: '🇰🇷', nameKo: '서울', lat: 37.46, lon: 126.44, tz: 'Asia/Seoul' },
    'London': { code: 'EGLL', locationId: 'EGLL:9:GB', unit: 'C', flag: '🇬🇧', nameKo: '런던', lat: 51.47, lon: -0.46, tz: 'Europe/London' },
    'Wellington': { code: 'NZWN', locationId: 'NZWN:9:NZ', unit: 'C', flag: '🇳🇿', nameKo: '웰링턴', lat: -41.33, lon: 174.81, tz: 'Pacific/Auckland' },
    'Ankara': { code: 'LTAC', locationId: 'LTAC:9:TR', unit: 'C', flag: '🇹🇷', nameKo: '앙카라', lat: 40.13, lon: 32.99, tz: 'Europe/Istanbul' },
    'Paris': { code: 'LFPG', locationId: 'LFPG:9:FR', unit: 'C', flag: '🇫🇷', nameKo: '파리', lat: 49.01, lon: 2.55, tz: 'Europe/Paris' },
    'Buenos Aires': { code: 'SAEZ', locationId: 'SAEZ:9:AR', unit: 'C', flag: '🇦🇷', nameKo: '부에노스아이레스', lat: -34.82, lon: -58.54, tz: 'America/Argentina/Buenos_Aires' },
    'Toronto': { code: 'CYYZ', locationId: 'CYYZ:9:CA', unit: 'C', flag: '🇨🇦', nameKo: '토론토', lat: 43.68, lon: -79.63, tz: 'America/Toronto' },
    'New York City': { code: 'KLGA', locationId: 'KLGA:9:US', unit: 'F', flag: '🇺🇸', nameKo: '뉴욕', lat: 40.77, lon: -73.87, tz: 'America/New_York' },
    'Chicago': { code: 'KORD', locationId: 'KORD:9:US', unit: 'F', flag: '🇺🇸', nameKo: '시카고', lat: 41.98, lon: -87.91, tz: 'America/Chicago' },
    'Miami': { code: 'KMIA', locationId: 'KMIA:9:US', unit: 'F', flag: '🇺🇸', nameKo: '마이애미', lat: 25.79, lon: -80.29, tz: 'America/New_York' },
    'Atlanta': { code: 'KATL', locationId: 'KATL:9:US', unit: 'F', flag: '🇺🇸', nameKo: '애틀랜타', lat: 33.64, lon: -84.43, tz: 'America/New_York' },
};

const CITY_ORDER = ['Seoul', 'London', 'Paris', 'Ankara', 'Wellington', 'Buenos Aires', 'Toronto', 'New York City', 'Chicago', 'Miami', 'Atlanta'];

// 과거 결과 저장 (city → date → markets)
let pastDayResults: Map<string, Map<string, WeatherMarket[]>> = new Map();

// 선택된 날짜 탭 (city → dateLabel)
let selectedDateTab: Map<string, string> = new Map();

// 실제 기온 데이터 캐시 (city → { hours, temps, currentHigh })
interface HourlyWeather {
    hours: string[];   // "00:00", "01:00", ...
    temps: number[];   // 각 시간대 기온 (°C)
    currentHigh: number;
    currentTemp: number;
    unit: 'C' | 'F';
    isForecast?: boolean;  // 예보 데이터 여부
}
let weatherDataCache: Map<string, HourlyWeather> = new Map();
let forecastDataCache: Map<string, HourlyWeather> = new Map();

// ─── Weather Underground 실측 URL 생성 ───

function getWundergroundUrl(city: string): string {
    const station = CITY_STATIONS[city];
    if (!station) return 'https://www.wunderground.com';
    // 도시별 URL 경로 매핑
    const urlMap: Record<string, string> = {
        'Seoul': 'kr/incheon/RKSI',
        'London': 'gb/london/EGLL',
        'Wellington': 'nz/wellington/NZWN',
        'Ankara': 'tr/ankara/LTAC',
        'Paris': 'fr/paris/LFPG',
        'Buenos Aires': 'ar/buenos-aires/SAEZ',
        'Toronto': 'ca/toronto/CYYZ',
        'New York City': 'us/ny/new-york-city/KLGA',
        'Chicago': 'us/il/chicago/KORD',
        'Miami': 'us/fl/miami/KMIA',
        'Atlanta': 'us/ga/atlanta/KATL',
    };
    const path = urlMap[city] || `RKSI`;
    const today = new Date();
    const dateStr = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
    return `https://www.wunderground.com/history/daily/${path}/date/${dateStr}`;
}

// ─── Weather.com API (WU Resolution Source와 동일) ───

const WU_API_KEY = 'e1f10a1e78da46f5b10a1e78da96f525';

async function fetchHourlyWeather(city: string): Promise<HourlyWeather | null> {
    if (weatherDataCache.has(city)) return weatherDataCache.get(city)!;

    const station = CITY_STATIONS[city];
    if (!station) return null;

    try {
        // Weather.com historical observations API (WU 백엔드와 동일)
        const today = new Date();
        const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
        const units = station.unit === 'F' ? 'e' : 'm';  // e=imperial, m=metric
        const url = `https://api.weather.com/v1/location/${station.locationId}/observations/historical.json?apiKey=${WU_API_KEY}&startDate=${dateStr}&endDate=${dateStr}&units=${units}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        const observations: { valid_time_gmt: number; temp: number }[] = json.observations || [];
        if (observations.length === 0) return null;

        // 30분 간격 관측을 시간별로 정리 (가장 가까운 관측값 사용)
        const hourlyMap = new Map<number, number>();
        for (const obs of observations) {
            const d = new Date(obs.valid_time_gmt * 1000);
            const localHour = parseInt(d.toLocaleString('sv-SE', { timeZone: station.tz }).split(' ')[1]?.split(':')[0] || '0');
            // 각 시간대의 마지막 관측값 사용
            hourlyMap.set(localHour, obs.temp);
        }

        const hours: string[] = [];
        const temps: number[] = [];
        for (let h = 0; h <= 23; h++) {
            if (hourlyMap.has(h)) {
                hours.push(`${h}:00`);
                temps.push(hourlyMap.get(h)!);
            }
        }

        if (temps.length === 0) return null;

        const currentHigh = Math.max(...temps);
        const currentTemp = temps[temps.length - 1];

        const result: HourlyWeather = {
            hours,
            temps,
            currentHigh,
            currentTemp,
            unit: station.unit,
        };

        weatherDataCache.set(city, result);
        return result;
    } catch (e) {
        console.error(`❌ ${city} WU 기온 데이터 fetch 실패:`, e);
        return null;
    }
}

// ─── 기상청(KMA) 단기예보 API (서울/인천공항) ───

const KMA_AUTH_KEY = '16tey01xR-irXstNcTfo0w';

function getKmaBaseTime(): { base_date: string; base_time: string } {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const hours = now.getHours();
    // KMA 발표시각: 02,05,08,11,14,17,20,23 (각 +10분 후 API 제공)
    const baseTimes = [23, 20, 17, 14, 11, 8, 5, 2];
    let selectedHour = 2; // fallback
    for (const bt of baseTimes) {
        if (hours >= bt) { selectedHour = bt; break; }
    }
    // 자정~2시면 전날 23시 발표 사용
    let dateObj = new Date(now);
    if (hours < 2) {
        selectedHour = 23;
        dateObj.setDate(dateObj.getDate() - 1);
    }
    const base_date = `${dateObj.getFullYear()}${String(dateObj.getMonth() + 1).padStart(2, '0')}${String(dateObj.getDate()).padStart(2, '0')}`;
    const base_time = String(selectedHour).padStart(2, '0') + '00';
    return { base_date, base_time };
}

// 오늘 차트 오버레이용: 항상 당일 05시 발표 고정 (TMX 포함되는 첫 발표)
// 05시 이전이면 전날 23시 발표 fallback
function getKmaFixedBaseTime(): { base_date: string; base_time: string } {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
    const todayYmd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    if (now.getHours() >= 5) {
        return { base_date: todayYmd, base_time: '0500' };
    }
    // 05시 이전: 전날 23시 발표 사용
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yYmd = `${yesterday.getFullYear()}${String(yesterday.getMonth() + 1).padStart(2, '0')}${String(yesterday.getDate()).padStart(2, '0')}`;
    return { base_date: yYmd, base_time: '2300' };
}

async function fetchKmaForecast(targetDate: string): Promise<HourlyWeather | null> {
    const cacheKey = `KMA_Seoul_${targetDate}`;
    if (forecastDataCache.has(cacheKey)) return forecastDataCache.get(cacheKey)!;

    try {
        const { base_date, base_time } = getKmaBaseTime();
        const url = `/api/kma/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst?pageNo=1&numOfRows=1000&dataType=JSON&base_date=${base_date}&base_time=${base_time}&nx=51&ny=124&authKey=${KMA_AUTH_KEY}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`KMA HTTP ${res.status}`);
        const json = await res.json();

        const items = json?.response?.body?.items?.item;
        if (!items || items.length === 0) throw new Error('KMA 응답 데이터 없음');

        // targetDate 파싱 ("March 14" → "20260314")
        const targetDateObj = new Date(targetDate + ', 2026');
        const targetYmd = `${targetDateObj.getFullYear()}${String(targetDateObj.getMonth() + 1).padStart(2, '0')}${String(targetDateObj.getDate()).padStart(2, '0')}`;

        // TMP(시간별 기온) + TMX(공식 최고기온) 추출
        const hours: string[] = [];
        const temps: number[] = [];
        let tmxHigh: number | null = null;
        for (const item of items) {
            if (item.fcstDate !== targetYmd) continue;
            if (item.category === 'TMP') {
                const h = item.fcstTime.substring(0, 2);
                const m = item.fcstTime.substring(2, 4);
                hours.push(`${h}:${m}`);
                temps.push(Number(item.fcstValue));
            } else if (item.category === 'TMX') {
                tmxHigh = Number(item.fcstValue);
            }
        }

        if (temps.length === 0) return null;

        // TMX(공식 최고기온 예보) 우선, 없으면 TMP max
        const forecastHigh = tmxHigh !== null ? tmxHigh : Math.max(...temps);
        const result: HourlyWeather = {
            hours,
            temps,
            currentHigh: forecastHigh,
            currentTemp: temps[temps.length - 1],
            unit: 'C',
            isForecast: true,
        };

        forecastDataCache.set(cacheKey, result);
        return result;
    } catch (e) {
        console.error('❌ 기상청 예보 fetch 실패:', e);
        return null;
    }
}

// ─── 오늘 차트용 KMA 05시 고정 예보 (예보 최고 비교용) ───

async function fetchKmaForecastFixed(targetDate: string): Promise<HourlyWeather | null> {
    const cacheKey = `KMA_Seoul_FIXED_${targetDate}`;
    if (forecastDataCache.has(cacheKey)) return forecastDataCache.get(cacheKey)!;

    try {
        const { base_date, base_time } = getKmaFixedBaseTime();
        const url = `/api/kma/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst?pageNo=1&numOfRows=1000&dataType=JSON&base_date=${base_date}&base_time=${base_time}&nx=51&ny=124&authKey=${KMA_AUTH_KEY}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`KMA HTTP ${res.status}`);
        const json = await res.json();

        const items = json?.response?.body?.items?.item;
        if (!items || items.length === 0) throw new Error('KMA 응답 데이터 없음');

        // targetDate 파싱 ("March 14" → "20260314")
        const targetDateObj = new Date(targetDate + ', 2026');
        const targetYmd = `${targetDateObj.getFullYear()}${String(targetDateObj.getMonth() + 1).padStart(2, '0')}${String(targetDateObj.getDate()).padStart(2, '0')}`;

        const hours: string[] = [];
        const temps: number[] = [];
        let tmxHigh: number | null = null;
        for (const item of items) {
            if (item.fcstDate !== targetYmd) continue;
            if (item.category === 'TMP') {
                const h = item.fcstTime.substring(0, 2);
                const m = item.fcstTime.substring(2, 4);
                hours.push(`${h}:${m}`);
                temps.push(Number(item.fcstValue));
            } else if (item.category === 'TMX') {
                tmxHigh = Number(item.fcstValue);
            }
        }

        if (temps.length === 0) return null;

        const forecastHigh = tmxHigh !== null ? tmxHigh : Math.max(...temps);
        const result: HourlyWeather = {
            hours,
            temps,
            currentHigh: forecastHigh,
            currentTemp: temps[temps.length - 1],
            unit: 'C',
            isForecast: true,
        };

        forecastDataCache.set(cacheKey, result);
        return result;
    } catch (e) {
        console.error('❌ 기상청 05시 고정 예보 fetch 실패:', e);
        return null;
    }
}

// ─── Weather.com 48시간 예보 API (서울 외 도시 fallback) ───

async function fetchWeatherComForecast(city: string, targetDate: string): Promise<HourlyWeather | null> {
    const cacheKey = `WC_${city}_${targetDate}`;
    if (forecastDataCache.has(cacheKey)) return forecastDataCache.get(cacheKey)!;

    const station = CITY_STATIONS[city];
    if (!station) return null;

    try {
        const units = station.unit === 'F' ? 'e' : 'm';
        const url = `https://api.weather.com/v3/wx/forecast/hourly/2day?geocode=${station.lat},${station.lon}&format=json&units=${units}&language=en-US&apiKey=${WU_API_KEY}`;

        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        const allTemps: number[] = json.temperature || [];
        const allTimes: string[] = json.validTimeLocal || [];
        if (allTemps.length === 0) return null;

        const targetDateObj = new Date(targetDate + ', 2026');
        const targetISO = `${targetDateObj.getFullYear()}-${String(targetDateObj.getMonth() + 1).padStart(2, '0')}-${String(targetDateObj.getDate()).padStart(2, '0')}`;

        const hours: string[] = [];
        const temps: number[] = [];
        for (let i = 0; i < allTimes.length; i++) {
            if (allTimes[i].startsWith(targetISO)) {
                const hour = allTimes[i].substring(11, 16).replace(/^0/, '');
                hours.push(hour);
                temps.push(allTemps[i]);
            }
        }

        if (temps.length === 0) return null;

        const forecastHigh = Math.max(...temps);
        const result: HourlyWeather = {
            hours,
            temps,
            currentHigh: forecastHigh,
            currentTemp: temps[temps.length - 1],
            unit: station.unit,
            isForecast: true,
        };

        forecastDataCache.set(cacheKey, result);
        return result;
    } catch (e) {
        console.error(`❌ ${city} 예보 데이터 fetch 실패:`, e);
        return null;
    }
}

// ─── 통합 예보 라우터: 서울=기상청, 나머지=Weather.com ───

async function fetchForecastWeather(city: string, targetDate: string): Promise<HourlyWeather | null> {
    if (city === 'Seoul') {
        // KMA 우선, 실패 시 Weather.com fallback
        const kma = await fetchKmaForecast(targetDate);
        if (kma) return kma;
        console.warn('⚠️ KMA 실패, Weather.com fallback');
        return fetchWeatherComForecast(city, targetDate);
    }
    return fetchWeatherComForecast(city, targetDate);
}

// ─── 마켓 제목 파싱 ───

function parseWeatherMarket(event: PolyEvent): WeatherMarket | null {
    const title = event.title;

    // 패턴 1: "be X°C or higher" / "be XF or higher"
    let match = title.match(/temperature in (.+?) be (\d+)°?([CF])\s+or higher/i);
    if (match) {
        return {
            city: match[1], targetTemp: parseInt(match[2]), unit: match[3] as 'C' | 'F',
            comparison: 'above', prob: parseFloat(String(event.probs?.[0] || 0)),
            slug: event.slug || '', event,
        };
    }

    // 패턴 2: "be XC or below"
    match = title.match(/temperature in (.+?) be (\d+)°?([CF])\s+or below/i);
    if (match) {
        return {
            city: match[1], targetTemp: parseInt(match[2]), unit: match[3] as 'C' | 'F',
            comparison: 'below', prob: parseFloat(String(event.probs?.[0] || 0)),
            slug: event.slug || '', event,
        };
    }

    // 패턴 3: "between X-YF"
    match = title.match(/temperature in (.+?) be between (\d+)-(\d+)°?([CF])/i);
    if (match) {
        return {
            city: match[1], targetTemp: Math.round((parseInt(match[2]) + parseInt(match[3])) / 2),
            unit: match[4] as 'C' | 'F', comparison: 'between',
            prob: parseFloat(String(event.probs?.[0] || 0)),
            slug: event.slug || '', event,
        };
    }

    // 패턴 4: "be X°C on" (정확한 온도)
    match = title.match(/temperature in (.+?) be (\d+)°?([CF])\s+on/i);
    if (match) {
        return {
            city: match[1], targetTemp: parseInt(match[2]), unit: match[3] as 'C' | 'F',
            comparison: 'exact', prob: parseFloat(String(event.probs?.[0] || 0)),
            slug: event.slug || '', event,
        };
    }

    return null;
}

// ─── 도시별 그룹핑 ───

function groupByCity(events: PolyEvent[]): CityWeatherGroup[] {
    const cityMap = new Map<string, WeatherMarket[]>();

    for (const event of events) {
        const parsed = parseWeatherMarket(event);
        if (!parsed) continue;
        if (!cityMap.has(parsed.city)) cityMap.set(parsed.city, []);
        cityMap.get(parsed.city)!.push(parsed);
    }

    const groups: CityWeatherGroup[] = [];

    for (const cityName of CITY_ORDER) {
        const markets = cityMap.get(cityName);
        if (!markets || markets.length === 0) continue;
        const station = CITY_STATIONS[cityName];
        groups.push({
            city: cityName, stationCode: station?.code || '',
            unit: station?.unit || 'C',
            markets: markets.sort((a, b) => a.targetTemp - b.targetTemp),
        });
    }

    for (const [cityName, markets] of cityMap) {
        if (!CITY_ORDER.includes(cityName)) {
            groups.push({
                city: cityName, stationCode: '', unit: markets[0].unit,
                markets: markets.sort((a, b) => a.targetTemp - b.targetTemp),
            });
        }
    }

    return groups;
}

// ─── 오늘 마켓만 필터 ───

function filterTodayMarkets(events: PolyEvent[]): PolyEvent[] {
    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

    return events.filter(e => {
        const endStr = new Date(e.end_date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
        return endStr === todayStr || endStr === tomorrowStr;
    });
}

// ─── 데이터 로드 ───

const SELECT_COLS = 'id, title, title_ko, slug, event_slug, end_date, volume, volume_24hr, probs, category, closed, image_url, tags, hidden';
const GAMMA_API = '/api/gamma';

export async function loadLiveWeatherMarkets(): Promise<void> {
    if (!supabaseClient) {
        console.warn('⚠️ Supabase 클라이언트 없음');
        return;
    }
    console.log('🌡️ 날씨 마켓 데이터 로드 시작');

    const nowISO = new Date().toISOString();
    const daysAgoISO = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    try {
        // 현재 + 과거 마켓 병렬 로드
        const [currentResult, pastResult] = await Promise.all([
            supabaseClient
                .from('poly_events').select(SELECT_COLS)
                .eq('category', 'Science')
                .ilike('title', '%highest temperature%')
                .eq('hidden', false).eq('closed', false)
                .gte('end_date', nowISO)
                .order('end_date', { ascending: true }).limit(2000),
            supabaseClient
                .from('poly_events').select(SELECT_COLS)
                .eq('category', 'Science')
                .ilike('title', '%highest temperature%')
                .eq('hidden', false)
                .lt('end_date', nowISO).gte('end_date', daysAgoISO)
                .order('end_date', { ascending: false }).limit(500),
        ]);

        if (currentResult.error) throw currentResult.error;

        if (currentResult.data) {
            let todayMarkets = filterTodayMarkets(currentResult.data as PolyEvent[]);

            // Gamma API에서 실시간 확률 오버레이
            if (todayMarkets.length > 0) {
                todayMarkets = await overlayGammaPrices(todayMarkets);
            }

            setLiveWeatherEvents(todayMarkets.length > 0 ? todayMarkets : []);
            console.log(`✅ 날씨 마켓 ${todayMarkets.length}개 로드 (실시간 확률 적용)`);
        }

        // 과거 마켓 처리
        pastDayResults.clear();
        if (pastResult.data && !pastResult.error) {
            for (const event of pastResult.data as PolyEvent[]) {
                const parsed = parseWeatherMarket(event);
                if (!parsed) continue;
                const dateStr = new Date(event.end_date).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
                if (!pastDayResults.has(parsed.city)) pastDayResults.set(parsed.city, new Map());
                const cityMap = pastDayResults.get(parsed.city)!;
                if (!cityMap.has(dateStr)) cityMap.set(dateStr, []);
                cityMap.get(dateStr)!.push(parsed);
            }
            console.log(`📊 과거 결과 ${pastResult.data.length}개 로드`);
        }
    } catch (e) {
        console.error('❌ 날씨 마켓 로드 실패:', e);
    }
}

// ─── Gamma API 실시간 확률 오버레이 ───

async function overlayGammaPrices(events: PolyEvent[]): Promise<PolyEvent[]> {
    // event_slug 기준으로 고유 이벤트 그룹 추출
    const slugSet = new Set<string>();
    for (const e of events) {
        if (e.event_slug) slugSet.add(e.event_slug);
    }

    if (slugSet.size === 0) return events;

    // 각 event_slug에 대해 Gamma API 병렬 호출
    const gammaResults = await Promise.allSettled(
        [...slugSet].map(slug =>
            fetch(`${GAMMA_API}/events?slug=${encodeURIComponent(slug)}`)
                .then(r => r.ok ? r.json() : [])
                .catch(() => [])
        )
    );

    // slug → { outcomePrices, volume, bestBid, bestAsk, closed } 매핑
    const priceMap = new Map<string, { yes: number; volume: number; closed: boolean; bestBid?: number; bestAsk?: number }>();

    for (const result of gammaResults) {
        if (result.status !== 'fulfilled' || !Array.isArray(result.value)) continue;
        for (const event of result.value) {
            for (const market of event.markets || []) {
                if (!market.slug || !market.outcomePrices) continue;
                try {
                    const prices = typeof market.outcomePrices === 'string'
                        ? JSON.parse(market.outcomePrices)
                        : market.outcomePrices;
                    priceMap.set(market.slug, {
                        yes: parseFloat(prices[0]) || 0,
                        volume: parseFloat(market.volume) || 0,
                        closed: !!market.closed,
                        bestBid: market.bestBid != null ? parseFloat(market.bestBid) : undefined,
                        bestAsk: market.bestAsk != null ? parseFloat(market.bestAsk) : undefined,
                    });
                } catch { /* skip parse errors */ }
            }
        }
    }

    if (priceMap.size === 0) {
        console.warn('⚠️ Gamma API에서 실시간 데이터를 가져오지 못함, Supabase 데이터 사용');
        return events;
    }

    // 이벤트에 실시간 확률 오버레이 (closed 포함 — 탭 UI에서 분리 표시)
    console.log(`📡 Gamma API: ${priceMap.size}개 마켓 실시간 확률 적용`);
    return events.map(e => {
        const gamma = priceMap.get(e.slug || '');
        if (!gamma) return e;
        return {
            ...e,
            probs: [gamma.yes, 1 - gamma.yes],
            volume: gamma.volume,
            closed: gamma.closed,
            bestBid: gamma.bestBid,
            bestAsk: gamma.bestAsk,
        };
    });
}

// ═══════════════════════════════════════
//  렌더링
// ═══════════════════════════════════════

export function renderLiveTrackerView(): void {
    const container = document.getElementById('liveContent');
    if (!container) return;

    const groups = groupByCity(liveWeatherEvents);

    if (groups.length === 0) {
        container.innerHTML = `
            <div class="live-empty">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5">
                    <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path>
                </svg>
                <p>오늘 활성화된 날씨 마켓이 없습니다</p>
            </div>
        `;
        return;
    }

    if (!groups.find(g => g.city === liveSelectedCity)) {
        setLiveSelectedCity(groups[0].city);
    }

    const selectedGroup = groups.find(g => g.city === liveSelectedCity)!;

    container.innerHTML = `
        <div class="city-widgets-row">
            ${groups.map(g => renderCityWidget(g, g.city === liveSelectedCity)).join('')}
        </div>
        <div class="city-detail-panel" id="cityDetailPanel">
            ${renderCityDetail(selectedGroup)}
        </div>
    `;

    // 실제 기온 데이터 비동기 로드 → 차트 영역에 삽입
    loadAndRenderWeatherChart(selectedGroup);

    // 예보 정확도 비동기 로드
    loadAndRenderForecastAccuracy(selectedGroup.city);
}

async function loadAndRenderForecastAccuracy(city: string): Promise<void> {
    const area = document.getElementById('forecastAccuracyArea');
    if (!area) return;

    const rows = await fetchForecastAccuracy(city);
    area.innerHTML = renderForecastAccuracy(rows);
}

// ─── 도시 위젯 ───

// 현재 라이브 트래커가 완전 지원되는 도시
const SUPPORTED_CITIES = new Set(['Seoul']);

function renderCityWidget(group: CityWeatherGroup, isActive: boolean): string {
    const station = CITY_STATIONS[group.city];
    const flag = station?.flag || '🌍';
    const nameKo = station?.nameKo || group.city;
    const displayName = currentLang === 'ko' ? nameKo : group.city;
    const isSupported = SUPPORTED_CITIES.has(group.city);

    if (!isSupported) {
        return `
            <div class="city-widget disabled">
                <div class="city-widget-flag">${flag}</div>
                <div class="city-widget-name">${escapeHtml(displayName)}</div>
                <div class="city-widget-soon">SOON</div>
            </div>
        `;
    }

    const topMarket = group.markets.reduce((best, m) => m.prob > best.prob ? m : best, group.markets[0]);

    return `
        <div class="city-widget ${isActive ? 'active' : ''}" data-city="${escapeHtml(group.city)}">
            <div class="city-widget-flag">${flag}</div>
            <div class="city-widget-name">${escapeHtml(displayName)}</div>
            <div class="city-widget-temp">${topMarket.targetTemp}°${group.unit}</div>
            <div class="city-widget-meta">
                <span class="city-widget-live-dot"></span>
                <span>${group.markets.length}건</span>
            </div>
        </div>
    `;
}

// ─── 마켓 타이틀에서 날짜 추출 ───

function extractMarketDate(title: string): string {
    // "on March 13" → "March 13"
    const match = title.match(/on\s+((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2})/i);
    return match ? match[1] : '';
}

// ─── 마감 시간 정보 생성 ───

function getDeadlineInfo(markets: WeatherMarket[]): string {
    // end_date에서 마감 시각 추출
    const endDate = markets[0]?.event?.end_date;
    if (!endDate) return '';

    const deadline = new Date(endDate);
    const now = new Date();
    const diffMs = deadline.getTime() - now.getTime();

    // KST 마감 시각
    const kstTime = deadline.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    // ET 마감 시각
    const etTime = deadline.toLocaleString('en-US', {
        timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: true,
    });

    // 마감 여부 체크
    const isClosed = markets.every(m => m.event.closed);

    let countdown = '';
    if (isClosed) {
        // 마감된 마켓: 최고 확률 마켓으로 최종 결과 표시
        const topMarket = [...markets].sort((a, b) => b.prob - a.prob)[0];
        const pct = (topMarket.prob * 100).toFixed(1);
        countdown = `최종: ${topMarket.targetTemp}°${topMarket.unit}+ → ${pct}% YES`;
    } else if (diffMs > 0) {
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        if (hours > 24) {
            countdown = `${Math.floor(hours / 24)}일 ${hours % 24}시간 후`;
        } else if (hours > 0) {
            countdown = `${hours}시간 ${mins}분 후 마감`;
        } else {
            countdown = `${mins}분 후 마감`;
        }
    } else {
        countdown = '결과 대기 중';
    }

    // 측정 기간: 마감일 전날 KST 14:00 ~ 마감일 KST 21:00
    const openDate = new Date(deadline);
    openDate.setDate(openDate.getDate() - 1);
    // ET 자정 = KST 14:00 (서머타임 시 13:00)
    const openKst = openDate.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const closeKst = deadline.toLocaleString('ko-KR', {
        timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    });

    return `
        <div class="wt-deadline">
            <span class="wt-deadline-icon">⏱</span>
            <span class="wt-deadline-time">마감 ${kstTime} KST (${etTime} ET)</span>
            <span class="wt-deadline-countdown ${diffMs > 0 && diffMs < 3 * 60 * 60 * 1000 ? 'urgent' : ''}">${countdown}</span>
        </div>
        <div class="wt-measurement-period">
            <span class="wt-period-label">측정 기간</span>
            <span class="wt-period-range">${openKst} → ${closeKst} KST</span>
        </div>
    `;
}

// ─── 날짜 탭 상태 텍스트 계산 ───

function getTabStatusText(markets: WeatherMarket[]): string {
    const endDate = markets[0]?.event?.end_date;
    if (!endDate) return '';

    const deadline = new Date(endDate);
    const now = new Date();
    const diffMs = deadline.getTime() - now.getTime();

    if (diffMs <= 0) return '마감됨';
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    if (hours < 3) return `마감 D-${hours}h`;
    return '활성';
}

// ─── KST 기준 자동 탭 선택 ───

function getAutoSelectedDate(sortedDates: [string, WeatherMarket[]][]): string {
    if (sortedDates.length <= 1) return sortedDates[0]?.[0] || '';

    // KST 현재 시각
    const nowKST = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).replace(' ', 'T');
    const kstHour = parseInt(nowKST.split('T')[1]?.split(':')[0] || '0');

    // KST 21:00 이후면 다음 날짜 탭 선택
    if (kstHour >= 21) {
        return sortedDates.length > 1 ? sortedDates[1][0] : sortedDates[0][0];
    }
    return sortedDates[0][0];
}

// ─── 도시 상세 패널 ───

function renderCityDetail(group: CityWeatherGroup): string {
    const station = CITY_STATIONS[group.city];
    const nameKo = station?.nameKo || group.city;
    const displayName = currentLang === 'ko' ? nameKo : group.city;
    const stationCode = station?.code || '—';

    // 마켓을 날짜별로 분류
    const dateGroups = new Map<string, WeatherMarket[]>();
    for (const m of group.markets) {
        const dateLabel = extractMarketDate(m.event.title) || 'Unknown';
        if (!dateGroups.has(dateLabel)) dateGroups.set(dateLabel, []);
        dateGroups.get(dateLabel)!.push(m);
    }

    // 날짜 정렬 (가까운 날짜 먼저)
    const sortedDates = [...dateGroups.entries()].sort((a, b) => {
        const da = new Date(a[0] + ', 2026');
        const db = new Date(b[0] + ', 2026');
        return da.getTime() - db.getTime();
    });

    // 현재 선택된 탭 결정 (수동 선택 > 자동 선택)
    let activeDate = selectedDateTab.get(group.city);
    if (!activeDate || !sortedDates.find(([d]) => d === activeDate)) {
        activeDate = getAutoSelectedDate(sortedDates);
        selectedDateTab.set(group.city, activeDate);
    }

    const activeMarkets = dateGroups.get(activeDate) || [];
    const sorted = [...activeMarkets].sort((a, b) => b.prob - a.prob);
    const maxP = sorted[0]?.prob || 0;

    // 마감된 날짜인지 판단
    const isClosed = activeMarkets.length > 0 && activeMarkets.every(m => m.event.closed);

    // 탭 바 렌더링
    const tabBar = sortedDates.length > 1 ? `
        <div class="wt-date-tabs">
            ${sortedDates.map(([dateLabel, markets]) => {
                const isActive = dateLabel === activeDate;
                const status = getTabStatusText(markets);
                const statusClass = status === '마감됨' ? 'closed' : status.startsWith('마감 D') ? 'urgent' : 'active';
                return `
                    <button class="wt-date-tab ${isActive ? 'selected' : ''} ${statusClass}"
                            data-date="${escapeHtml(dateLabel)}" data-city="${escapeHtml(group.city)}">
                        <span class="wt-date-tab-label">${escapeHtml(dateLabel)}</span>
                        <span class="wt-date-tab-status">(${status})</span>
                    </button>
                `;
            }).join('')}
        </div>
    ` : '';

    return `
        <div class="wt-header">
            <div class="wt-header-left">
                <span class="wt-header-flag">${station?.flag || '🌍'}</span>
                <div class="wt-header-info">
                    <div class="wt-header-city">${escapeHtml(displayName)}</div>
                    <div class="wt-header-date">${escapeHtml(activeDate)}</div>
                </div>
            </div>
            <div class="wt-header-source">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                </svg>
                Weather Underground (${stationCode})
            </div>
        </div>

        ${tabBar}

        ${renderTempChartPlaceholder()}

        <div class="wt-section ${isClosed ? 'wt-section-closed' : ''}">
            ${isClosed ? '<div class="wt-closed-badge">마감됨</div>' : ''}
            <div class="wt-section-header">
                <span class="wt-section-title">${escapeHtml(activeDate)}</span>
                <span class="wt-section-badge">${sorted.length}건</span>
            </div>
            ${getDeadlineInfo(sorted)}
            <div class="wt-prob-list">
                ${sorted.map(m => renderProbRow(m, group.unit, maxP)).join('')}
            </div>
        </div>

        ${renderPastTimeline(group.city, group.unit)}

        <div id="forecastAccuracyArea"></div>
    `;
}

// ─── 실측 기온 차트 (Weather.com → SVG) ───

function renderTempChartPlaceholder(): string {
    return `
        <div class="wt-chart-container" id="wtChartArea">
            <div class="wt-chart-loading">
                <div class="live-loading-spinner"></div>
                <span>기온 데이터 로드 중...</span>
            </div>
        </div>
    `;
}

async function loadAndRenderWeatherChart(group: CityWeatherGroup): Promise<void> {
    const chartArea = document.getElementById('wtChartArea');
    if (!chartArea) return;

    // 선택된 날짜 탭 확인
    const activeDate = selectedDateTab.get(group.city) || '';

    // 오늘 날짜인지 판별 (마켓 제목의 날짜 vs 현재 날짜)
    const todayStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    const isToday = activeDate === todayStr || activeDate === '';

    // 활성 탭의 마켓만 필터
    const activeMarkets = group.markets.filter(m => {
        const date = extractMarketDate(m.event.title);
        return date === activeDate;
    });
    const aboveMarkets = activeMarkets
        .filter(m => m.comparison === 'above')
        .sort((a, b) => a.targetTemp - b.targetTemp);

    let weather: HourlyWeather | null = null;
    let forecastOverlay: HourlyWeather | null = null;
    let dbForecastHigh: number | null = null; // DB에 저장된 05시 기준 예보 최고
    try {
        if (isToday) {
            weather = await fetchHourlyWeather(group.city);
            // 오늘 차트에 기상청 예보 오버레이 (05시 고정, 비교용)
            try {
                // DB에서 오늘 날짜의 고정된 예보 최고값 조회
                if (group.city === 'Seoul') {
                    const accRows = await fetchForecastAccuracy('Seoul');
                    const todayIso = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
                    const todayRow = accRows.find(r => r.market_date === todayIso);
                    if (todayRow && todayRow.forecast_high !== null) {
                        dbForecastHigh = todayRow.forecast_high;
                    }
                    // 05시 고정 API로 시간별 예보 라인 가져오기
                    forecastOverlay = await fetchKmaForecastFixed(activeDate);
                } else {
                    forecastOverlay = await fetchForecastWeather(group.city, activeDate);
                }
                console.log('📊 기상청 예보 오버레이:', forecastOverlay ? `${forecastOverlay.temps.length}시간 로드` : 'null', dbForecastHigh ? `DB 예보 최고: ${dbForecastHigh}°` : '');
            } catch (e) {
                console.warn('⚠️ 기상청 예보 오버레이 실패:', e);
            }
        } else {
            weather = await fetchForecastWeather(group.city, activeDate);
        }
    } catch (e) {
        console.error('❌ 기온 데이터 fetch 실패:', e);
    }

    if (!weather) {
        chartArea.innerHTML = `<div class="wt-chart-empty">기온 데이터를 불러올 수 없습니다</div>`;
        return;
    }

    try {
        chartArea.innerHTML = renderSVGChart(weather, group.city, forecastOverlay, dbForecastHigh);
    } catch (e) {
        console.error('❌ 차트 렌더링 실패:', e);
        chartArea.innerHTML = `<div class="wt-chart-empty">차트 렌더링 오류</div>`;
    }
}

function renderSVGChart(weather: HourlyWeather, city: string, forecastOverlay?: HourlyWeather | null, dbForecastHigh?: number | null): string {
    const { hours, temps, currentHigh, currentTemp, unit, isForecast } = weather;
    const station = CITY_STATIONS[city];

    // SVG 영역
    const W = 600, H = 200;
    const padL = 40, padR = 16, padT = 24, padB = 28;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;

    // 온도 범위 (오버레이 포함)
    const overlayTemps = forecastOverlay ? forecastOverlay.temps : [];
    const allTemps = [...temps, ...overlayTemps];
    const minT = Math.floor(Math.min(...allTemps) - 2);
    const maxT = Math.ceil(Math.max(...allTemps) + 2);
    const rangeT = maxT - minT || 1;

    // 좌표 변환 — X축은 0~21시 (마켓 마감 KST 21:00 기준)
    const MARKET_CLOSE_HOUR = 21;
    const xOfHour = (h: number) => padL + (Math.min(h, MARKET_CLOSE_HOUR) / MARKET_CLOSE_HOUR) * plotW;
    const xOf = (i: number) => {
        if (i < 0 || i >= hours.length) return padL;
        const h = parseInt(hours[i].split(':')[0]);
        return xOfHour(h);
    };
    const yOf = (t: number) => padT + plotH - ((t - minT) / rangeT) * plotH;

    // Y축 눈금 (5단위)
    const yTicks: number[] = [];
    for (let t = Math.ceil(minT / 5) * 5; t <= maxT; t += 5) {
        yTicks.push(t);
    }
    if (yTicks.length === 0) {
        for (let t = minT; t <= maxT; t += 2) yTicks.push(t);
    }

    // X축 눈금 — 마켓 마감(21:00) 기준
    const xTickHours = [0, 6, 12, 18, 21];

    // 마켓 임계값 수평선 — 제거됨 (혼란 유발)

    const wuUrl = getWundergroundUrl(city);
    const stationCode = station?.code || '';

    // ── 예보 vs 실측 분기 ──
    if (isForecast) {
        // 예보: 전체 라인을 점선으로, 최고예상기온 마커
        const allPoints = temps.map((t, i) => `${xOf(i).toFixed(1)},${yOf(t).toFixed(1)}`);
        const fullPath = allPoints.length > 1 ? `M${allPoints.join(' L')}` : '';
        const highIdx = temps.indexOf(Math.max(...temps));

        // 채움 영역 (연한 오렌지)
        const fillPath = allPoints.length > 1
            ? `M${xOf(0).toFixed(1)},${yOf(minT).toFixed(1)} L${allPoints.join(' L')} L${xOf(temps.length - 1).toFixed(1)},${yOf(minT).toFixed(1)} Z`
            : '';

        return `
            <div class="wt-chart-wrap wt-chart-forecast">
                <div class="wt-chart-header">
                    <div class="wt-chart-current">
                        <span class="wt-chart-now-temp">${Math.round(currentHigh)}°${unit}</span>
                        <span class="wt-chart-now-label">예상 최고 (예보)</span>
                    </div>
                    <div class="wt-chart-high">
                        <span class="wt-chart-forecast-badge">FORECAST</span>
                    </div>
                    <a class="wt-chart-wu-link" href="${city === 'Seoul' ? 'https://www.weather.go.kr/w/weather/forecast/short-term.do' : wuUrl}" target="_blank" rel="noopener">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15 3 21 3 21 9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                        ${city === 'Seoul' ? '기상청 예보 (RKSI)' : `Weather.com (${stationCode})`}
                    </a>
                </div>
                <div class="wt-chart-disclaimer">${city === 'Seoul' ? '기상청(KMA) 단기예보 — 인천공항(RKSI) 기준' : 'Weather.com 48시간 예보 데이터'} — 실제 결과와 다를 수 있음</div>
                <svg viewBox="0 0 ${W} ${H}" class="wt-chart-svg">
                    ${yTicks.map(t => `
                        <line x1="${padL}" y1="${yOf(t).toFixed(1)}" x2="${W - padR}" y2="${yOf(t).toFixed(1)}" stroke="var(--border-color)" stroke-width="0.5"/>
                        <text x="${padL - 6}" y="${(yOf(t) + 3).toFixed(1)}" fill="var(--text-muted)" font-size="9" font-family="var(--font-mono)" text-anchor="end">${t}°</text>
                    `).join('')}
                    ${xTickHours.map(h => `
                        <text x="${xOfHour(h).toFixed(1)}" y="${H - 6}" fill="var(--text-muted)" font-size="9" font-family="var(--font-mono)" text-anchor="middle">${h}:00</text>
                    `).join('')}



                    <!-- 예보 채움 영역 (오렌지) -->
                    ${fillPath ? `<path d="${fillPath}" fill="url(#forecastGrad)" opacity="0.2"/>` : ''}

                    <!-- 예보 라인 (점선) -->
                    ${fullPath ? `<path d="${fullPath}" fill="none" stroke="var(--accent-orange, #f59e0b)" stroke-width="2" stroke-dasharray="6,3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}

                    <!-- 예상 최고기온 마커 -->
                    ${highIdx >= 0 ? `
                        <circle cx="${xOf(highIdx).toFixed(1)}" cy="${yOf(temps[highIdx]).toFixed(1)}" r="4" fill="var(--accent-orange, #f59e0b)" stroke="var(--bg-primary)" stroke-width="2"/>
                        <text x="${xOf(highIdx).toFixed(1)}" y="${(yOf(temps[highIdx]) - 8).toFixed(1)}" fill="var(--accent-orange, #f59e0b)" font-size="10" font-family="var(--font-mono)" font-weight="700" text-anchor="middle">${Math.round(temps[highIdx])}°</text>
                    ` : ''}

                    <defs>
                        <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stop-color="var(--accent-orange, #f59e0b)" stop-opacity="0.4"/>
                            <stop offset="100%" stop-color="var(--accent-orange, #f59e0b)" stop-opacity="0"/>
                        </linearGradient>
                    </defs>
                </svg>
            </div>
        `;
    }

    // ── 실측 차트 (기존 로직) ──
    // 마감(21시) 이후 데이터 제외
    const maxDataIdx = hours.findIndex(h => parseInt(h.split(':')[0]) > MARKET_CLOSE_HOUR);
    const effectiveLen = maxDataIdx === -1 ? hours.length : maxDataIdx;

    const nowLocal = new Date().toLocaleString('sv-SE', { timeZone: station?.tz || 'UTC' }).replace(' ', 'T');
    const nowHour = parseInt(nowLocal.split('T')[1]?.split(':')[0] || '23');
    // hours 배열에서 현재 시각 이하의 마지막 인덱스 찾기
    let nowIdx = 0;
    for (let i = 0; i < effectiveLen; i++) {
        const h = parseInt(hours[i].split(':')[0]);
        if (h <= nowHour) nowIdx = i;
    }

    // effectiveLen 범위 내에서만 포인트 생성
    const safeNowIdx = Math.min(nowIdx, effectiveLen - 1);

    const observedPoints = temps.slice(0, safeNowIdx + 1).map((t, i) => `${xOf(i).toFixed(1)},${yOf(t).toFixed(1)}`);
    const observedPath = observedPoints.length > 1 ? `M${observedPoints.join(' L')}` : '';

    const remainingTemps = temps.slice(safeNowIdx, effectiveLen);
    const forecastPoints = remainingTemps.map((t, i) => `${xOf(safeNowIdx + i).toFixed(1)},${yOf(t).toFixed(1)}`);
    const forecastPath = forecastPoints.length > 1 ? `M${forecastPoints.join(' L')}` : '';

    const fillPath = observedPoints.length > 1
        ? `M${xOf(0).toFixed(1)},${yOf(minT).toFixed(1)} L${observedPoints.join(' L')} L${xOf(safeNowIdx).toFixed(1)},${yOf(minT).toFixed(1)} Z`
        : '';

    const observedTemps = temps.slice(0, safeNowIdx + 1);
    const highIdx = observedTemps.length > 0 ? observedTemps.indexOf(Math.max(...observedTemps)) : -1;

    // ── 기상청 예보 오버레이 (오늘 차트에만) ──
    let forecastOverlayPath = '';
    let forecastOverlayHighLabel = '';
    if (forecastOverlay && forecastOverlay.temps.length > 0) {
        const fHours = forecastOverlay.hours;
        const fTemps = forecastOverlay.temps;
        const fPoints: string[] = [];
        for (let fi = 0; fi < fHours.length; fi++) {
            const hourNum = parseInt(fHours[fi].split(':')[0]);
            if (hourNum > MARKET_CLOSE_HOUR) continue;
            fPoints.push(`${xOfHour(hourNum).toFixed(1)},${yOf(fTemps[fi]).toFixed(1)}`);
        }
        if (fPoints.length > 1) {
            forecastOverlayPath = `M${fPoints.join(' L')}`;
        }
        // DB에 저장된 05시 고정 예보 최고값 우선, 없으면 05시 API의 TMX/TMP max 사용
        let fHigh: number;
        if (dbForecastHigh !== null && dbForecastHigh !== undefined) {
            fHigh = dbForecastHigh;
        } else {
            const fTempsInRange = fTemps.filter((_, i) => parseInt(fHours[i].split(':')[0]) <= MARKET_CLOSE_HOUR);
            fHigh = fTempsInRange.length > 0 ? Math.max(...fTempsInRange) : Math.max(...fTemps);
        }
        forecastOverlayHighLabel = `예보 최고 ${Math.round(fHigh)}°`;
    }

    const hasOverlay = forecastOverlayPath.length > 0;

    return `
        <div class="wt-chart-wrap">
            <div class="wt-chart-header">
                <div class="wt-chart-high wt-chart-high-primary">
                    <span class="wt-chart-high-temp" style="color: var(--accent-green, #22c55e); font-size: 1.6rem; font-weight: 800">${Math.round(currentHigh)}°${unit}</span>
                    <span class="wt-chart-high-label">오늘 최고 (실측)</span>
                </div>
                <div class="wt-chart-current">
                    <span class="wt-chart-now-temp">${Math.round(currentTemp)}°${unit}</span>
                    <span class="wt-chart-now-label">현재 (실측)</span>
                </div>
                ${hasOverlay ? `
                <div class="wt-chart-high">
                    <span class="wt-chart-high-temp" style="color: var(--accent-orange, #f59e0b); font-size: 0.95rem">${forecastOverlayHighLabel}</span>
                    <span class="wt-chart-high-label">기상청 예보 (05시)</span>
                </div>` : ''}
                <a class="wt-chart-wu-link" href="${wuUrl}" target="_blank" rel="noopener">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                        <polyline points="15 3 21 3 21 9"></polyline>
                        <line x1="10" y1="14" x2="21" y2="3"></line>
                    </svg>
                    실측 보기 (${stationCode})
                </a>
            </div>
            <div class="wt-chart-disclaimer">
                Weather Underground (${stationCode}) 관측 데이터 — <a href="${wuUrl}" target="_blank" rel="noopener">Resolution Source 보기</a>
                ${hasOverlay ? '<br><span style="color: var(--accent-orange, #f59e0b)">── ──</span> 기상청 예보' : ''}
            </div>
            <svg viewBox="0 0 ${W} ${H}" class="wt-chart-svg">
                ${yTicks.map(t => `
                    <line x1="${padL}" y1="${yOf(t).toFixed(1)}" x2="${W - padR}" y2="${yOf(t).toFixed(1)}" stroke="var(--border-color)" stroke-width="0.5"/>
                    <text x="${padL - 6}" y="${(yOf(t) + 3).toFixed(1)}" fill="var(--text-muted)" font-size="9" font-family="var(--font-mono)" text-anchor="end">${t}°</text>
                `).join('')}
                ${xTickHours.map(h => `
                    <text x="${xOfHour(h).toFixed(1)}" y="${H - 6}" fill="var(--text-muted)" font-size="9" font-family="var(--font-mono)" text-anchor="middle">${h}:00</text>
                `).join('')}

                <!-- 기상청 예보 오버레이 (주황 점선) -->
                ${forecastOverlayPath ? `<path d="${forecastOverlayPath}" fill="none" stroke="var(--accent-orange, #f59e0b)" stroke-width="2" stroke-dasharray="6,3" stroke-linecap="round" stroke-linejoin="round"/>` : ''}

                ${fillPath ? `<path d="${fillPath}" fill="url(#tempGrad)" opacity="0.3"/>` : ''}
                ${observedPath ? `<path d="${observedPath}" fill="none" stroke="var(--accent-cyan)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` : ''}
                ${forecastPath ? `<path d="${forecastPath}" fill="none" stroke="var(--accent-cyan)" stroke-width="1.5" stroke-dasharray="4,3" opacity="0.4"/>` : ''}

                ${highIdx >= 0 ? `
                    <circle cx="${xOf(highIdx).toFixed(1)}" cy="${yOf(temps[highIdx]).toFixed(1)}" r="4" fill="var(--accent-green)" stroke="var(--bg-primary)" stroke-width="2"/>
                    <text x="${xOf(highIdx).toFixed(1)}" y="${(yOf(temps[highIdx]) - 8).toFixed(1)}" fill="var(--accent-green)" font-size="10" font-family="var(--font-mono)" font-weight="700" text-anchor="middle">${Math.round(temps[highIdx])}°</text>
                ` : ''}

                <circle cx="${xOf(nowIdx).toFixed(1)}" cy="${yOf(temps[nowIdx]).toFixed(1)}" r="3" fill="var(--accent-cyan)" stroke="var(--bg-primary)" stroke-width="2"/>
                <line x1="${xOf(nowIdx).toFixed(1)}" y1="${padT}" x2="${xOf(nowIdx).toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" stroke="var(--accent-cyan)" stroke-width="0.5" stroke-dasharray="2,2" opacity="0.4"/>

                <!-- 마감선 (21:00 KST) -->
                <line x1="${xOfHour(MARKET_CLOSE_HOUR).toFixed(1)}" y1="${padT}" x2="${xOfHour(MARKET_CLOSE_HOUR).toFixed(1)}" y2="${(padT + plotH).toFixed(1)}" stroke="var(--accent-red, #ef4444)" stroke-width="1" stroke-dasharray="4,2" opacity="0.5"/>
                <text x="${xOfHour(MARKET_CLOSE_HOUR).toFixed(1)}" y="${padT - 4}" fill="var(--accent-red, #ef4444)" font-size="8" font-family="var(--font-mono)" text-anchor="middle" opacity="0.7">CLOSE</text>

                <defs>
                    <linearGradient id="tempGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="var(--accent-cyan)" stop-opacity="0.4"/>
                        <stop offset="100%" stop-color="var(--accent-cyan)" stop-opacity="0"/>
                    </linearGradient>
                </defs>
            </svg>
        </div>
    `;
}

// ─── FDV 스타일 확률 행 ───

function renderProbRow(market: WeatherMarket, unit: 'C' | 'F', maxProb: number): string {
    const prob = market.prob;
    const probPct = (prob * 100).toFixed(1);
    const barWidth = maxProb > 0 ? (prob / maxProb) * 100 : 0;
    const volume = parseFloat(String(market.event.volume || 0));
    const volumeStr = volume >= 1000000 ? `$${(volume / 1000000).toFixed(1)}M`
        : volume >= 1000 ? `$${(volume / 1000).toFixed(1)}K`
        : `$${volume.toFixed(0)}`;

    let label = '';
    if (market.comparison === 'above') label = `${market.targetTemp}°${unit}+`;
    else if (market.comparison === 'below') label = `${market.targetTemp}°${unit}↓`;
    else if (market.comparison === 'exact') label = `${market.targetTemp}°${unit}`;
    else label = `~${market.targetTemp}°${unit}`;

    const isHighest = prob === maxProb && prob > 0;
    const colorClass = prob >= 0.15 ? 'high' : prob >= 0.03 ? 'mid' : 'low';

    const polyUrl = market.event.event_slug
        ? `https://polymarket.com/event/${escapeHtml(market.event.event_slug)}`
        : `https://polymarket.com/event/${escapeHtml(market.slug)}`;

    return `
        <a class="wt-prob-row ${isHighest ? 'highlight' : ''}" href="${polyUrl}" target="_blank" rel="noopener">
            ${isHighest ? '<span class="wt-prob-marker"></span>' : '<span class="wt-prob-spacer"></span>'}
            <span class="wt-prob-label ${isHighest ? 'highlight' : ''}">${escapeHtml(label)}</span>
            <div class="wt-prob-bar-track">
                <div class="wt-prob-bar-fill ${colorClass}" style="width:${barWidth}%"></div>
            </div>
            <span class="wt-prob-pct">${probPct}%</span>
            <span class="wt-prob-vol">${volumeStr}</span>
        </a>
    `;
}

// ─── 과거 결과 타임라인 ───

function renderPastTimeline(city: string, unit: 'C' | 'F'): string {
    const cityData = pastDayResults.get(city);
    if (!cityData || cityData.size === 0) return '';

    const sortedDates = [...cityData.entries()].sort((a, b) => b[0].localeCompare(a[0]));

    return `
        <div class="wt-section">
            <div class="wt-section-header">
                <span class="wt-section-title">PAST RESULTS</span>
            </div>
            <div class="wt-past-scroll">
                ${sortedDates.slice(0, 7).map(([dateStr, markets]) => renderPastCard(dateStr, markets, unit)).join('')}
            </div>
        </div>
    `;
}

function renderPastCard(dateStr: string, markets: WeatherMarket[], unit: 'C' | 'F'): string {
    const sorted = [...markets].sort((a, b) => b.prob - a.prob);
    const topMarket = sorted[0];
    const isResolved = topMarket.prob >= 0.9;

    // 결과 온도 추정
    let resultTemp = '';
    if (topMarket.comparison === 'exact' || topMarket.comparison === 'between') {
        resultTemp = `${topMarket.targetTemp}°${unit}`;
    } else if (topMarket.comparison === 'above') {
        resultTemp = `${topMarket.targetTemp}°${unit}+`;
    } else {
        resultTemp = `≤${topMarket.targetTemp}°${unit}`;
    }

    // 날짜 포맷
    const d = new Date(dateStr + 'T12:00:00');
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const displayDate = `${month}/${day}`;

    // 상위 3개 마켓 요약
    const topThree = sorted.slice(0, 3);

    return `
        <div class="wt-past-card">
            <div class="wt-past-top">
                <span class="wt-past-badge ${isResolved ? 'resolved' : 'pending'}">${isResolved ? '종료' : '미확정'}</span>
                <span class="wt-past-date">${displayDate}</span>
            </div>
            <div class="wt-past-result">${resultTemp}</div>
            <div class="wt-past-details">
                ${topThree.map(m => {
                    let l = '';
                    if (m.comparison === 'exact') l = `${m.targetTemp}°`;
                    else if (m.comparison === 'above') l = `${m.targetTemp}°+`;
                    else if (m.comparison === 'below') l = `${m.targetTemp}°↓`;
                    else l = `~${m.targetTemp}°`;
                    const pct = (m.prob * 100).toFixed(0);
                    const icon = m.prob >= 0.9 ? '✓' : m.prob <= 0.1 ? '✗' : '';
                    const cls = m.prob >= 0.9 ? 'yes' : m.prob <= 0.1 ? 'no' : '';
                    return `<div class="wt-past-line ${cls}"><span>${escapeHtml(l)}</span><span>${pct}% ${icon}</span></div>`;
                }).join('')}
            </div>
        </div>
    `;
}

// ─── 예보 정확도 트래커 ───

interface ForecastAccuracyRow {
    city: string;
    market_date: string;
    forecast_high: number | null;
    actual_high: number | null;
    error: number | null;
    abs_error: number | null;
    unit: string;
    forecast_source: string;
    actual_source: string | null;
}

let forecastAccuracyCache: Map<string, ForecastAccuracyRow[]> = new Map();

async function fetchForecastAccuracy(city: string): Promise<ForecastAccuracyRow[]> {
    if (forecastAccuracyCache.has(city)) return forecastAccuracyCache.get(city)!;

    try {
        const { data, error } = await supabaseClient
            .from('weather_forecast_accuracy')
            .select('*')
            .eq('city', city)
            .order('market_date', { ascending: false });

        if (error || !data) return [];
        forecastAccuracyCache.set(city, data);
        return data;
    } catch {
        return [];
    }
}

function renderForecastAccuracy(rows: ForecastAccuracyRow[]): string {
    if (rows.length === 0) return '';

    // 실측이 있는 행만 통계 계산
    const resolved = rows.filter(r => r.actual_high !== null && r.error !== null);
    const pending = rows.filter(r => r.actual_high === null);

    // 통계 계산
    const totalRecords = resolved.length;
    let avgError = 0;
    let hitRate = 0;
    let bias = 0;

    if (totalRecords > 0) {
        avgError = resolved.reduce((sum, r) => sum + (r.abs_error || 0), 0) / totalRecords;
        hitRate = resolved.filter(r => (r.abs_error || 99) <= 1).length / totalRecords * 100;
        bias = resolved.reduce((sum, r) => sum + (r.error || 0), 0) / totalRecords;
    }

    // 카드 렌더링 (최근순)
    const allCards = rows.slice(0, 14);

    const cardsHtml = allCards.map(row => {
        const d = new Date(row.market_date + 'T12:00:00');
        const displayDate = `${d.getMonth() + 1}/${d.getDate()}`;
        const isResolved = row.actual_high !== null;

        if (!isResolved) {
            return `
                <div class="wt-acc-card pending">
                    <div class="wt-acc-card-date">${displayDate}</div>
                    <div class="wt-acc-card-badge pending">대기</div>
                    <div class="wt-acc-card-forecast">
                        <span class="wt-acc-label">예보</span>
                        <span class="wt-acc-value">${row.forecast_high !== null ? Math.round(row.forecast_high) + '°' : '-'}</span>
                    </div>
                    <div class="wt-acc-card-actual">
                        <span class="wt-acc-label">실측</span>
                        <span class="wt-acc-value dim">—</span>
                    </div>
                </div>
            `;
        }

        const err = row.error || 0;
        const absErr = Math.abs(err);
        let errClass = 'exact';
        if (absErr > 2) errClass = 'far';
        else if (absErr > 0) errClass = err > 0 ? 'over' : 'under';

        const errSign = err > 0 ? '+' : '';
        const errLabel = absErr === 0 ? '정확' : `${errSign}${err.toFixed(1)}°`;

        return `
            <div class="wt-acc-card ${errClass}">
                <div class="wt-acc-card-date">${displayDate}</div>
                <div class="wt-acc-card-badge ${errClass}">${errLabel}</div>
                <div class="wt-acc-card-forecast">
                    <span class="wt-acc-label">예보</span>
                    <span class="wt-acc-value">${Math.round(row.forecast_high!)}°</span>
                </div>
                <div class="wt-acc-card-actual">
                    <span class="wt-acc-label">실측</span>
                    <span class="wt-acc-value">${Math.round(row.actual_high!)}°</span>
                </div>
            </div>
        `;
    }).join('');

    // 편향 방향 텍스트
    const biasDir = bias > 0.2 ? '과대 경향' : bias < -0.2 ? '과소 경향' : '중립';
    const biasSign = bias > 0 ? '+' : '';

    return `
        <div class="wt-section wt-accuracy-section">
            <div class="wt-section-header">
                <span class="wt-section-title">FORECAST ACCURACY</span>
                <span class="wt-section-badge">기상청(KMA) 예보 vs 실측</span>
            </div>
            <div class="wt-accuracy-body">
                <div class="wt-acc-cards-wrap">
                    <div class="wt-acc-cards-scroll">
                        ${cardsHtml}
                    </div>
                </div>
                <div class="wt-acc-stats">
                    <div class="wt-acc-stat">
                        <span class="wt-acc-stat-label">평균 오차</span>
                        <span class="wt-acc-stat-value">${totalRecords > 0 ? avgError.toFixed(1) + '°' : '—'}</span>
                    </div>
                    <div class="wt-acc-stat">
                        <span class="wt-acc-stat-label">적중률 (±1°)</span>
                        <span class="wt-acc-stat-value">${totalRecords > 0 ? hitRate.toFixed(0) + '%' : '—'}</span>
                    </div>
                    <div class="wt-acc-stat">
                        <span class="wt-acc-stat-label">편향</span>
                        <span class="wt-acc-stat-value">${totalRecords > 0 ? biasSign + bias.toFixed(1) + '° ' + biasDir : '—'}</span>
                    </div>
                    <div class="wt-acc-stat">
                        <span class="wt-acc-stat-label">총 기록</span>
                        <span class="wt-acc-stat-value">${totalRecords}건${pending.length > 0 ? ` (+${pending.length} 대기)` : ''}</span>
                    </div>
                </div>
            </div>
        </div>
    `;
}

// ─── 이벤트 리스너 ───

export function initLiveTrackerListeners(): void {
    document.addEventListener('click', (e) => {
        const widget = (e.target as HTMLElement).closest('.city-widget');
        if (!widget || widget.classList.contains('disabled')) return;
        const city = (widget as HTMLElement).dataset.city;
        if (!city || city === liveSelectedCity) return;
        setLiveSelectedCity(city);
        renderLiveTrackerView();
    });

    // 날짜 탭 클릭
    document.addEventListener('click', (e) => {
        const tab = (e.target as HTMLElement).closest('.wt-date-tab');
        if (!tab) return;
        const dateLabel = (tab as HTMLElement).dataset.date;
        const city = (tab as HTMLElement).dataset.city;
        if (!dateLabel || !city) return;
        if (selectedDateTab.get(city) === dateLabel) return;
        selectedDateTab.set(city, dateLabel);
        renderLiveTrackerView();
    });
}
