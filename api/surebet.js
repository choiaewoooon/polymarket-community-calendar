/**
 * /api/surebet — 99% 마켓 데이터를 서버사이드에서 집계하여 반환
 *
 * 클라이언트에서 Gamma API를 20번 호출하는 대신,
 * 서버에서 한번에 수집 + 필터링 후 결과만 전달 (1 request로 축소)
 */

const GAMMA_API = 'https://gamma-api.polymarket.com';
const PAGE_SIZE = 200; // 서버→서버는 큰 페이지 가능
const MAX_OFFSET = 2000;
const BATCH_SIZE = 5; // 서버에서 5개 병렬 요청

// 인메모리 캐시 (Vercel serverless — cold start 사이 유지)
let cachedData = null;
let cachedAt = 0;
const CACHE_TTL = 30 * 1000; // 30초

export default async function handler(req, res) {
    // CORS
    const origin = req.headers.origin || '';
    const ALLOWED_ORIGINS = [
        'https://polymarket-calender.vercel.app',
        'http://localhost:5173',
        'http://localhost:4173',
    ];
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    // 인메모리 캐시 히트
    if (cachedData && (Date.now() - cachedAt) < CACHE_TTL) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
        return res.status(200).json(cachedData);
    }

    try {
        const allMarkets = [];
        let offset = 0;
        let hasMore = true;

        while (hasMore && offset < MAX_OFFSET) {
            // 서버→서버 병렬 배치
            const batchPromises = [];
            for (let i = 0; i < BATCH_SIZE && (offset + i * PAGE_SIZE) < MAX_OFFSET; i++) {
                const batchOffset = offset + i * PAGE_SIZE;
                const url = `${GAMMA_API}/markets?closed=false&active=true&limit=${PAGE_SIZE}&offset=${batchOffset}&order=volume&ascending=false`;
                batchPromises.push(
                    fetch(url).then(r => {
                        if (!r.ok) throw new Error(`Gamma ${r.status}`);
                        return r.json();
                    })
                );
            }

            const results = await Promise.all(batchPromises);

            for (const markets of results) {
                if (!markets || markets.length === 0) {
                    hasMore = false;
                    break;
                }

                for (const m of markets) {
                    const filtered = filterMarket(m);
                    if (filtered) allMarkets.push(filtered);
                }

                if (markets.length < PAGE_SIZE) {
                    hasMore = false;
                    break;
                }
            }

            offset += BATCH_SIZE * PAGE_SIZE;
        }

        // 캐시 저장
        cachedData = allMarkets;
        cachedAt = Date.now();

        res.setHeader('X-Cache', 'MISS');
        res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
        return res.status(200).json(allMarkets);

    } catch (error) {
        console.error('surebet API error:', error);
        return res.status(500).json({ error: 'Failed to fetch market data' });
    }
}

/**
 * 서버사이드 필터링 — 90%+ 확률 마켓만 추출
 * 클라이언트로 전송할 데이터량을 대폭 축소
 */
function filterMarket(m) {
    // 확률 파싱
    let prices;
    try {
        const raw = typeof m.outcomePrices === 'string'
            ? JSON.parse(m.outcomePrices)
            : m.outcomePrices;
        prices = raw.map(p => parseFloat(p));
    } catch {
        return null;
    }

    if (!prices.length || prices.some(isNaN)) return null;

    // 종료/비활성 필터
    const endDate = new Date(m.endDate);
    if (isNaN(endDate.getTime()) || endDate.getTime() <= Date.now()) return null;
    if (m.closed || !m.active) return null;

    // 거래량 최소 $5,000
    const volume = m.volumeNum || parseFloat(m.volume) || 0;
    if (volume < 5000) return null;

    // 유동성 최소 $1,000
    const liquidity = m.liquidityNum || parseFloat(m.liquidity) || 0;
    if (liquidity < 1000) return null;

    // 90%+ 확률 필터
    const maxProb = Math.max(...prices);
    if (maxProb < 0.9) return null;

    // 호가 체크
    const bestBid = m.bestBid || 0;
    const bestAsk = m.bestAsk || 0;
    if (bestBid === 0 && bestAsk === 0) return null;

    const spread = m.spread || (bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0);
    const eventSlug = m.events?.[0]?.slug || '';

    // 필요한 필드만 반환 (페이로드 최소화)
    return {
        id: m.id,
        question: m.question,
        slug: m.slug,
        eventSlug,
        endDate: m.endDate,
        volume,
        volume24hr: m.volume24hr || 0,
        outcomePrices: prices,
        outcomes: typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes,
        image: m.image || null,
        liquidity,
        bestBid,
        bestAsk,
        spread,
        description: m.description || '',
    };
}
