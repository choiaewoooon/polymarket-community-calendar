/**
 * Vercel Cron Job: 기상청 예보 캡처 + 실측 결과 반영
 * - 매일 06:00 KST: 예보 캡처 (capture)
 * - 매일 22:30 KST: 실측 반영 (resolve)
 *
 * Vercel Cron은 cron expression으로 스케줄링됨 (vercel.json에서 설정)
 */

const KMA_AUTH_KEY = '16tey01xR-irXstNcTfo0w';
const WU_API_KEY = 'e1f10a1e78da46f5b10a1e78da96f525';
const WU_STATION = 'RKSI:9:KR';
const KMA_NX = 51;
const KMA_NY = 124;

function kstNow() {
    return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
}

function formatYmd(d) {
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function formatIso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function getSupabase() {
    const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Supabase 환경변수 없음');

    const { createClient } = await import('@supabase/supabase-js');
    return createClient(url, key);
}

async function fetchKmaForecastHigh(targetDate) {
    const now = kstNow();
    const hour = now.getHours();
    const baseTimes = [23, 20, 17, 14, 11, 8, 5, 2];
    let selected = 2;
    for (const bt of baseTimes) {
        if (hour >= bt) { selected = bt; break; }
    }

    let baseDate = new Date(now);
    if (hour < 2) {
        selected = 23;
        baseDate.setDate(baseDate.getDate() - 1);
    }

    const baseDateStr = formatYmd(baseDate);
    const baseTime = String(selected).padStart(2, '0') + '00';
    const targetYmd = formatYmd(targetDate);

    const url = `https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst?pageNo=1&numOfRows=1000&dataType=JSON&base_date=${baseDateStr}&base_time=${baseTime}&nx=${KMA_NX}&ny=${KMA_NY}&authKey=${KMA_AUTH_KEY}`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`KMA HTTP ${res.status}`);
    const data = await res.json();

    const items = data?.response?.body?.items?.item;
    if (!items || items.length === 0) return null;

    let tmxHigh = null;
    const temps = [];
    for (const item of items) {
        if (item.fcstDate !== targetYmd) continue;
        if (item.category === 'TMX') tmxHigh = Number(item.fcstValue);
        else if (item.category === 'TMP') temps.push(Number(item.fcstValue));
    }

    if (tmxHigh === null && temps.length === 0) return null;
    return tmxHigh !== null ? tmxHigh : Math.max(...temps);
}

async function fetchWuActualHigh(targetDate) {
    const dateStr = formatYmd(targetDate);
    const url = `https://api.weather.com/v1/location/${WU_STATION}/observations/historical.json?apiKey=${WU_API_KEY}&startDate=${dateStr}&endDate=${dateStr}&units=m`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`WU HTTP ${res.status}`);
    const data = await res.json();

    const observations = data?.observations;
    if (!observations || observations.length === 0) return null;

    const temps = observations.filter(o => o.temp !== null).map(o => o.temp);
    return temps.length > 0 ? Math.max(...temps) : null;
}

async function captureForecasts(sb) {
    const now = kstNow();
    const results = [];

    // 과거 5일 ~ 미래 4일 범위 (누락분 백필 포함)
    for (let offset = -5; offset < 5; offset++) {
        const target = new Date(now);
        target.setDate(target.getDate() + offset);
        const isoDate = formatIso(target);

        const { data: existing } = await sb
            .from('weather_forecast_accuracy')
            .select('id, forecast_high')
            .eq('city', 'Seoul')
            .eq('market_date', isoDate)
            .maybeSingle();

        if (existing?.forecast_high !== null && existing?.forecast_high !== undefined) {
            results.push({ date: isoDate, status: 'skip', value: existing.forecast_high });
            continue;
        }

        try {
            const forecastHigh = await fetchKmaForecastHigh(target);
            if (forecastHigh === null) {
                results.push({ date: isoDate, status: 'no_data' });
                continue;
            }

            await sb.from('weather_forecast_accuracy').upsert({
                city: 'Seoul',
                market_date: isoDate,
                forecast_high: forecastHigh,
                unit: 'C',
                forecast_source: 'KMA',
            }, { onConflict: 'city,market_date' });

            results.push({ date: isoDate, status: offset < 0 ? 'backfilled' : 'captured', value: forecastHigh });
        } catch (e) {
            results.push({ date: isoDate, status: 'error', error: e.message });
        }
    }

    return results;
}

async function resolveActuals(sb) {
    const today = formatIso(kstNow());
    const results = [];

    const { data: pending } = await sb
        .from('weather_forecast_accuracy')
        .select('*')
        .eq('city', 'Seoul')
        .is('actual_high', null)
        .lt('market_date', today);

    if (!pending || pending.length === 0) {
        return [{ status: 'all_resolved' }];
    }

    for (const row of pending) {
        const targetDate = new Date(row.market_date + 'T12:00:00');

        try {
            const actualHigh = await fetchWuActualHigh(targetDate);
            if (actualHigh === null) {
                results.push({ date: row.market_date, status: 'no_wu_data' });
                continue;
            }

            const error = Math.round((row.forecast_high - actualHigh) * 10) / 10;
            const absError = Math.abs(error);

            await sb.from('weather_forecast_accuracy')
                .update({
                    actual_high: actualHigh,
                    error,
                    abs_error: absError,
                    actual_source: 'WU_RKSI',
                })
                .eq('id', row.id);

            results.push({ date: row.market_date, status: 'resolved', forecast: row.forecast_high, actual: actualHigh, error });
        } catch (e) {
            results.push({ date: row.market_date, status: 'error', error: e.message });
        }
    }

    return results;
}

export default async function handler(req, res) {
    // Vercel Cron 인증 확인
    const authHeader = req.headers['authorization'];
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const sb = await getSupabase();

        const [captureResults, resolveResults] = await Promise.all([
            captureForecasts(sb),
            resolveActuals(sb),
        ]);

        return res.status(200).json({
            ok: true,
            timestamp: kstNow().toISOString(),
            capture: captureResults,
            resolve: resolveResults,
        });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
