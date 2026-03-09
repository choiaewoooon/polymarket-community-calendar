"""
Polymarket ETL Pipeline
- Polymarket API에서 모든 이벤트 데이터를 가져와 Supabase에 저장
- 페이지네이션으로 전체 시장 수집
- 캘린더 기능용 데이터 수집 (필터 없이 전체 아카이빙)
"""

import os
import json
import requests
from datetime import datetime, timezone, timedelta
from typing import Optional
from dotenv import load_dotenv
from supabase import create_client, Client

# 설정값
BATCH_SIZE = 500  # API 최대 limit
REQUEST_TIMEOUT = 60


def load_env() -> tuple[str, str]:
    """환경 변수 로드"""
    load_dotenv()

    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_KEY")

    if not supabase_url or not supabase_key:
        raise ValueError("SUPABASE_URL과 SUPABASE_KEY가 .env 파일에 설정되어야 합니다.")

    return supabase_url, supabase_key


def fetch_polymarket_data() -> list[dict]:
    """Polymarket API에서 모든 진행 중인 이벤트 데이터 가져오기 (페이지네이션)"""
    url = "https://gamma-api.polymarket.com/markets"
    all_data = []
    offset = 0

    print(f"  데이터 수집 중", end="", flush=True)

    while True:
        params = {
            "limit": BATCH_SIZE,
            "offset": offset,
            "closed": "false"  # 정산 완료된 시장 제외 (평소 운영)
        }

        response = requests.get(url, params=params, timeout=REQUEST_TIMEOUT)
        response.raise_for_status()

        batch = response.json()
        if not batch:
            break

        all_data.extend(batch)
        print(".", end="", flush=True)

        if len(batch) < BATCH_SIZE:
            break

        offset += BATCH_SIZE

    print()  # 줄바꿈
    return all_data


def safe_json_parse(value):
    """문자열이면 JSON 파싱, 아니면 그대로 반환"""
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return None
    return value


def safe_float(value) -> float:
    """안전하게 float으로 변환"""
    if value is None:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except (ValueError, TypeError):
            return 0.0
    return 0.0


def infer_category_from_title(title: str, category: Optional[str], tags: list = None) -> str:
    """제목 + 태그 기반으로 카테고리 추론"""
    if category and category != "Uncategorized":
        return category

    # 제목과 태그를 모두 검사 대상에 포함
    search_text = title.lower() if title else ""
    if tags:
        tag_text = " ".join([tag.lower() for tag in tags if tag and isinstance(tag, str)])
        search_text += " " + tag_text

    if not search_text:
        return 'Uncategorized'

    title_lower = search_text

    # Sports 키워드 (대폭 확장)
    sports_keywords = [
        # 기존 키워드
        'nba', 'nfl', 'nhl', 'mlb', 'soccer', 'basketball', 'football', 'baseball',
        'hockey', 'ncaa', 'fifa', 'champion', 'playoff', 'finals', 'game',
        'vs', 'vs.', ' v ', ' v. ', 'versus', 'team', 'player', 'score', 'win', 'match', 'tennis',
        'cricket', 'golf', 'racing', 'boxing', 'ufc', 'mma', 'esports', 'league', 'tournament',
        'bowl', 'spread', 'finish', 'standings', 'ligue', 'halftime', 'points',
        # 새로 추가된 키워드
        'rebounds', 'assists', 'over/under', 'o/u', 'rushing yards', 'receiving yards',
        'passing yards', 'touchdowns', 'interceptions', 'field goal', 'dvalishvili',
        'yan', 'fight', 'promoted', 'epl', 'premier league', 'wrestle', 'athletic',
        # 2차 추가
        'traded to', 'sign with', 'manager of', 'rookie card', 'advance to', 'qualify to',
        'manchester united', 'real madrid', 'juventus', 'antetokounmpo', 'jokic', 'cs2',
        'masters santiago', 'valorant', 'red bull', 'scream 7',
        # 3차 추가 (F1, e스포츠, 기타 스포츠)
        'f1', 'grand prix', 'pole position', 'fastest lap', 'verstappen', 'hamilton',
        'leclerc', 'norris', 'mclaren', 'mercedes', 'ferrari', 'ucl', 'esl', 'lcs'
    ]

    # Crypto 키워드 (주요 암호화폐 추가)
    crypto_keywords = [
        # 기존 키워드
        'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'blockchain', 'defi',
        'nft', 'solana', 'xrp', 'ripple', 'cardano', 'ada', 'doge', 'coin',
        'token', 'wallet', 'mining', 'exchange', 'binance', 'coinbase',
        'base', 'fdv', 'market cap', 'mcap',
        # 새로 추가된 암호화폐
        'hyperliquid', 'pump.fun', 'zcash', 'plasma', 'pyusd', 'gho', 'usr',
        'bnb', 'doppler', 'lighter', 'usdc', 'usdt', 'stablecoin', 'depeg',
        'web3', 'dao', 'consensys',
        # 2차 추가
        'uni', 'uniswap', 'fabric', 'vitalik buterin', 'sbf', 'arthur hayes',
        'ansem', 'anatoly yakovenko', 'saylor',
        # 3차 추가 (암호화폐/블록체인 관련 용어)
        'cex', 'insolvent', 'rwa', 'satoshi'
    ]

    # Politics 키워드 (국제 정치, 법률 추가)
    politics_keywords = [
        # 기존 키워드
        'trump', 'biden', 'president', 'election', 'congress', 'senate',
        'democrat', 'republican', 'vote', 'poll', 'campaign', 'governor',
        'mayor', 'minister', 'parliament', 'government', 'political',
        'israel', 'palestine', 'military', 'guilty', 'sentenced', 'trial',
        'court', 'lawsuit', 'verdict', 'justice',
        # 새로 추가된 키워드
        'nuclear', 'strike', 'iran', 'russia', 'trade deal', 'trade agreement',
        'modi', 'netanyahu', 'erdogan', 'xi jinping', 'macron', 'leader out',
        'scotus', 'supreme court', 'conviction', 'indictment', 'war', 'peace',
        'sanctions', 'diplomatic', 'united nations', 'secretary general',
        'yoon', 'custody', 'venezuela', 'china', 'taiwan',
        # 2차 추가
        'zelenskyy', 'putin', 'bernie endorse', 'arrested', 'exiled', 'maduro',
        'nato', 'abraham accords', 'saudi arabia', 'oman', 'rsf', 'khartoum',
        'ilhan omar', 'convicted', 'charged with', 'epstein', 'aguiar',
        # 3차 추가 (국제정치, 정치인 관련 용어)
        'hamas', 'damascus', 'deport', 'brics', 'starmer', 'trudeau', 'gaza'
    ]

    # Finance 키워드 (주식, 원자재, 경제지표 추가)
    finance_keywords = [
        # 기존 키워드
        'stock', 'market', 'economy', 'gdp', 'inflation', 'fed', 'federal reserve',
        'dow', 'nasdaq', 's&p', 'trading', 'price', 'dollar', 'euro', 'bank',
        'earnings', 'quarterly', 'revenue', 'profit',
        # 새로 추가된 키워드
        'silver', 'gold', 'oil', 'crude', 'commodity', 'treasury', 'yield',
        'debt', 'trillion', 'nvidia', 'nvda', 'amazon', 'amzn', 'meta',
        'palantir', 'pltr', 'opendoor', 'ipo', 'magnificent 7', 'ecb',
        'interest rate', 'bps', 'unemployment', 'home value', 'median',
        'eggs cost', 'tsa passengers', 'kospi', 'nikkei',
        # 2차 추가
        'ceo of', 'mortgage rate', 'recession', 'net worth', 'richest person',
        'doordash', 'lululemon', 'glencore', 'rio tinto', 'merger', 'bezos',
        'ellison', 'jensen huang', 'larry page', 'elon musk\'s net worth',
        # 3차 추가 (외환, 경제 지표 관련 용어)
        'eur/usd', 'fomc', 'mortgage', 'forex'
    ]

    # Pop Culture 키워드 (소셜미디어, 엔터테인먼트 추가)
    culture_keywords = [
        # 기존 키워드
        'movie', 'film', 'album', 'song', 'artist', 'celebrity', 'award',
        'oscar', 'grammy', 'emmy', 'netflix', 'spotify', 'box office',
        'euphoria', 'season', 'episode', 'show', 'series', 'die',
        # 새로 추가된 키워드
        'elon musk tweet', 'elon musk post', 'james bond', 'avatar', 'star wars',
        'taylor swift', 'wedding', 'mrbeast', 'mindshare', 'views',
        'streaming', 'concert', 'babymonster', 'kpop', 'anime', 'manga',
        'tom holland', 'jack lowdon', 'marvel', 'disney', 'hbo',
        # 2차 추가
        'billboard', 'debut no.1', 'podcast', 'divorce', 'bill clinton',
        'creative director', 'versace', 'opening weekend', 'domestically',
        'marty supreme', 'greenland', 'anaconda', 'bully', 'drake maye',
        'boy names', 'girl names', 'ssa', 'baby names',
        # 3차 추가 (유명인, 게임, 소셜미디어 관련 용어)
        'pregnant', 'perform at', 'world tour', 'bts', 'half-life 3', 'kylie jenner', 'beyoncé'
    ]

    # Science/Tech 키워드 (날씨, 자연재해, AI 추가)
    science_keywords = [
        # 기존 키워드
        'ai', 'artificial intelligence', 'robot', 'space', 'nasa', 'spacex',
        'climate', 'vaccine', 'drug', 'technology', 'apple', 'google',
        'microsoft', 'tesla', 'research', 'scientific',
        'artemis', 'rocket', 'launch', 'temperature', 'weather', 'celsius',
        'fahrenheit', 'forecast',
        # 새로 추가된 키워드
        '°c', '°f', 'hottest year', 'tornado', 'earthquake', 'megaquake',
        'natural disaster', 'magnitude', 'measles', 'epidemic', 'pandemic',
        'grok', 'gpt', 'released', 'anthropic', 'openai', 'chatbot',
        'llm', 'machine learning', 'cerebras', 'chipmaker', 'semiconductor',
        'highest temperature', 'lowest temperature', 'ankara', 'seattle',
        # 2차 추가
        'volcanic eruptions', 'vei', 'cloudflare incident', 'waymo', 'autonomous',
        'self-driving', 'valve', 'cache', 'map pool',
        # 3차 추가 (기후, 자연재해, 기술 서비스 관련 용어)
        'hurricane', 'typhoon', 'hottest on record', 'aws', 'disrupted'
    ]

    # 키워드 매칭 (순서 중요: 더 구체적인 것부터 체크)
    if any(keyword in title_lower for keyword in sports_keywords):
        return 'Sports'
    if any(keyword in title_lower for keyword in crypto_keywords):
        return 'Crypto'
    if any(keyword in title_lower for keyword in politics_keywords):
        return 'Politics'
    if any(keyword in title_lower for keyword in finance_keywords):
        return 'Finance'
    if any(keyword in title_lower for keyword in culture_keywords):
        return 'Pop Culture'
    if any(keyword in title_lower for keyword in science_keywords):
        return 'Science'

    return 'Uncategorized'


def transform_data(raw_data: list[dict]) -> list[dict]:
    """API 응답 데이터를 DB 스키마에 맞게 변환 (필터 없이 전체)"""
    transformed = []

    for item in raw_data:
        # outcomePrices 처리
        outcome_prices = safe_json_parse(item.get("outcomePrices"))

        # outcomes 처리
        outcomes = safe_json_parse(item.get("outcomes"))

        # tags 처리: None이면 빈 배열
        tags = item.get("tags")
        if tags is None:
            tags = []
        elif isinstance(tags, str):
            tags = safe_json_parse(tags) or []

        # 카테고리 추론 (API category 우선, 없으면 제목 + 태그에서 추론)
        inferred_cat = infer_category_from_title(
            item.get("question", ""),
            item.get("category"),
            tags  # 태그도 전달
        )

        # event_slug 추출: 그룹 이벤트의 slug (개별 slug와 다를 수 있음)
        # polymarket.com/event/{event_slug}로 접근해야 정상 작동
        events = item.get("events")
        event_slug = None
        if events and isinstance(events, list) and len(events) > 0:
            event_slug = events[0].get("slug")

        record = {
            "id": item.get("conditionId"),
            "title": item.get("question"),
            "slug": item.get("slug"),
            "event_slug": event_slug,
            "end_date": item.get("endDate"),
            "api_created_at": item.get("createdAt"),
            "volume": safe_float(item.get("volume")),
            "volume_24hr": safe_float(item.get("volume24hr")),
            "probs": outcome_prices,
            "outcomes": outcomes,
            "category": inferred_cat,
            "tags": tags,
            "image_url": item.get("image"),
            "closed": item.get("closed", False),  # 정산 여부
            "description": item.get("description"),  # Rules/설명 텍스트
        }

        # id가 없는 레코드는 건너뛰기
        if record["id"]:
            transformed.append(record)

    return transformed


def upsert_to_supabase(client: Client, data: list[dict], batch_size: int = 500) -> dict:
    """Supabase에 데이터 Upsert (Insert or Update) - 배치 처리"""
    if not data:
        return {"success": 0, "errors": ["저장할 데이터가 없습니다."]}

    total_success = 0
    errors = []

    # 배치 단위로 처리
    total_batches = (len(data) + batch_size - 1) // batch_size
    print(f"  저장 중 ({total_batches}개 배치)", end="", flush=True)

    for i in range(0, len(data), batch_size):
        batch = data[i:i + batch_size]
        try:
            result = client.table("poly_events").upsert(
                batch,
                on_conflict="id"
            ).execute()
            total_success += len(result.data)
            print(".", end="", flush=True)
        except Exception as e:
            errors.append(f"배치 {i // batch_size + 1} 오류: {str(e)}")
            print("x", end="", flush=True)

    print()  # 줄바꿈

    return {
        "success": total_success,
        "errors": errors
    }


def main():
    """메인 실행 함수"""
    print("=" * 50)
    print("Polymarket ETL Pipeline 시작")
    print("=" * 50)

    # 1. 환경 변수 로드
    try:
        supabase_url, supabase_key = load_env()
        print("✓ 환경 변수 로드 완료")
    except ValueError as e:
        print(f"✗ 환경 변수 오류: {e}")
        return

    # 2. Supabase 클라이언트 생성
    try:
        client = create_client(supabase_url, supabase_key)
        print("✓ Supabase 클라이언트 연결 완료")
    except Exception as e:
        print(f"✗ Supabase 연결 실패: {e}")
        return

    # 3. Polymarket API에서 데이터 가져오기
    try:
        raw_data = fetch_polymarket_data()
        print(f"✓ API 데이터 조회 완료: {len(raw_data)}건")
    except requests.RequestException as e:
        print(f"✗ API 요청 실패: {e}")
        return

    # 4. 데이터 변환 (Cleaning)
    transformed_data = transform_data(raw_data)
    print(f"✓ 데이터 변환 완료: {len(transformed_data)}건")

    # 5. Supabase에 Upsert
    result = upsert_to_supabase(client, transformed_data)

    # 6. 결과 출력
    print("-" * 50)
    if result["errors"]:
        print(f"⚠ 일부 오류 발생: {len(result['errors'])}건")
        for err in result["errors"][:3]:  # 최대 3개만 출력
            print(f"  - {err}")

    print(f"✓ 저장 완료: {result['success']}건 Upsert 성공")

    # 7. 오래된 데이터 정리 (2주 이상 지난 과거 이벤트 삭제)
    try:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=14)).isoformat()
        cleanup = client.table("poly_events") \
            .delete() \
            .lt("end_date", cutoff) \
            .execute()
        deleted_count = len(cleanup.data) if cleanup.data else 0
        if deleted_count > 0:
            print(f"✓ 오래된 데이터 정리: {deleted_count}건 삭제 (2주 이상 지난 이벤트)")
        else:
            print("✓ 정리할 오래된 데이터 없음")
    except Exception as e:
        print(f"⚠ 데이터 정리 실패 (무시): {e}")

    print("=" * 50)
    print("ETL Pipeline 완료")
    print("=" * 50)


if __name__ == "__main__":
    main()
