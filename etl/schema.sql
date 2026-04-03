-- Supabase Table: poly_events
-- Polymarket 이벤트 데이터 저장용 테이블 (캘린더용)

-- 기존 테이블 삭제 (주의: 데이터도 삭제됨)
-- DROP TABLE IF EXISTS poly_events;

CREATE TABLE IF NOT EXISTS poly_events (
    -- 기본 정보
    id TEXT PRIMARY KEY,                          -- conditionId (고유 식별자)
    title TEXT NOT NULL,                          -- question (이벤트 제목)
    slug TEXT,                                    -- slug (URL용 슬러그)

    -- 시간 정보
    end_date TIMESTAMPTZ,                         -- endDate (마감 일시)
    api_created_at TIMESTAMPTZ,                   -- API에서 가져온 이벤트 생성일 (New 필터용)

    -- 거래 정보
    volume NUMERIC,                               -- volume (총 거래량)
    volume_24hr NUMERIC,                          -- volume24hr (24시간 거래량, Hot 필터용)

    -- 결과/확률 정보
    probs JSONB,                                  -- outcomePrices (결과 확률 JSON)
    outcomes JSONB,                               -- outcomes (결과 옵션명: ["Yes", "No"])

    -- 분류 정보
    category TEXT,                                -- 카테고리 (Sports, Crypto, Politics 등)
    tags TEXT[] DEFAULT '{}',                     -- tags (태그 배열)

    -- 미디어
    image_url TEXT,                               -- image (이미지 URL)

    -- 메타 정보
    created_at TIMESTAMPTZ DEFAULT NOW(),         -- 레코드 생성 시간
    updated_at TIMESTAMPTZ DEFAULT NOW()          -- 레코드 수정 시간
);

-- updated_at 자동 갱신 트리거 함수
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 트리거 생성 (이미 존재하면 삭제 후 재생성)
DROP TRIGGER IF EXISTS trigger_poly_events_updated_at ON poly_events;

CREATE TRIGGER trigger_poly_events_updated_at
    BEFORE UPDATE ON poly_events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 인덱스 생성 (검색/정렬 성능 향상)
CREATE INDEX IF NOT EXISTS idx_poly_events_end_date ON poly_events(end_date);
CREATE INDEX IF NOT EXISTS idx_poly_events_volume ON poly_events(volume DESC);
CREATE INDEX IF NOT EXISTS idx_poly_events_volume_24hr ON poly_events(volume_24hr DESC);
CREATE INDEX IF NOT EXISTS idx_poly_events_category ON poly_events(category);
CREATE INDEX IF NOT EXISTS idx_poly_events_api_created_at ON poly_events(api_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_poly_events_tags ON poly_events USING GIN(tags);

-- ═══════════════════════════════════════════
-- 추가 컬럼 (ETL + 프론트엔드에서 사용)
-- ═══════════════════════════════════════════
-- ALTER TABLE poly_events ADD COLUMN IF NOT EXISTS is_korea BOOLEAN DEFAULT FALSE;
-- ALTER TABLE poly_events ADD COLUMN IF NOT EXISTS hidden BOOLEAN DEFAULT FALSE;
-- ALTER TABLE poly_events ADD COLUMN IF NOT EXISTS closed BOOLEAN DEFAULT FALSE;
-- ALTER TABLE poly_events ADD COLUMN IF NOT EXISTS title_ko TEXT;
-- ALTER TABLE poly_events ADD COLUMN IF NOT EXISTS description_ko TEXT;

-- 추가 인덱스
-- CREATE INDEX IF NOT EXISTS idx_poly_events_is_korea ON poly_events(is_korea) WHERE is_korea = TRUE;
-- CREATE INDEX IF NOT EXISTS idx_poly_events_hidden ON poly_events(hidden) WHERE hidden = FALSE;

-- ═══════════════════════════════════════════
-- 캐시 무효화 테이블
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cache_meta (
    key TEXT PRIMARY KEY,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════
-- 날씨 예보 정확도 추적 테이블
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS weather_forecast_accuracy (
    id SERIAL PRIMARY KEY,
    city TEXT NOT NULL,
    market_date DATE NOT NULL,
    forecast_high NUMERIC,
    actual_high NUMERIC,
    error NUMERIC,
    abs_error NUMERIC,
    unit TEXT DEFAULT 'C',
    forecast_source TEXT,
    actual_source TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(city, market_date)
);

CREATE INDEX IF NOT EXISTS idx_wfa_city_date ON weather_forecast_accuracy(city, market_date DESC);
