/**
 * Weather API Proxy — API 키를 서버사이드에서만 사용
 * 클라이언트는 /api/weather-proxy?type=...&params 로 호출
 */

const WU_API_KEY = process.env.WU_API_KEY || 'e1f10a1e78da46f5b10a1e78da96f525';
const KMA_AUTH_KEY = process.env.KMA_AUTH_KEY || '16tey01xR-irXstNcTfo0w';

export default async function handler(req, res) {
    const { type, ...params } = req.query;

    // CORS 허용
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

    try {
        let url;

        switch (type) {
            case 'wu-historical': {
                // Weather.com 실측 데이터
                const { locationId, startDate, endDate, units } = params;
                if (!locationId || !startDate) {
                    return res.status(400).json({ error: 'locationId, startDate 필수' });
                }
                url = `https://api.weather.com/v1/location/${locationId}/observations/historical.json?apiKey=${WU_API_KEY}&startDate=${startDate}&endDate=${endDate || startDate}&units=${units || 'm'}`;
                break;
            }

            case 'wu-forecast': {
                // Weather.com 48시간 예보
                const { geocode, units: fUnits } = params;
                if (!geocode) {
                    return res.status(400).json({ error: 'geocode 필수' });
                }
                url = `https://api.weather.com/v3/wx/forecast/hourly/2day?geocode=${geocode}&format=json&units=${fUnits || 'm'}&language=en-US&apiKey=${WU_API_KEY}`;
                break;
            }

            case 'kma-forecast': {
                // 기상청 단기예보
                const { base_date, base_time, nx, ny } = params;
                if (!base_date || !base_time) {
                    return res.status(400).json({ error: 'base_date, base_time 필수' });
                }
                url = `https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst?pageNo=1&numOfRows=1000&dataType=JSON&base_date=${base_date}&base_time=${base_time}&nx=${nx || 51}&ny=${ny || 124}&authKey=${KMA_AUTH_KEY}`;
                break;
            }

            default:
                return res.status(400).json({ error: `알 수 없는 type: ${type}` });
        }

        const response = await fetch(url);
        if (!response.ok) {
            return res.status(response.status).json({ error: `Upstream HTTP ${response.status}` });
        }

        const data = await response.json();
        return res.status(200).json(data);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
