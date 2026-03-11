#!/usr/bin/env python3
"""
Polymarket 시장 통합 번역 (제목 + 규칙 + 결과 옵션)

시장 단위로 title, description, outcomes를 한 번에 번역합니다.
기존 translate.py(제목만)와 달리, 모든 텍스트를 한 API 호출로 처리하여
문맥 이해도와 비용 효율성을 극대화합니다.

사용법:
    # 기본: 앞으로 2개월, 미번역만
    python translate_full.py

    # Sports 제외, 6개월, 5워커
    python translate_full.py --exclude-sports -m 6 -w 5

    # 전체 재번역
    python translate_full.py --overwrite -m 2

    # 특정 날짜 범위
    python translate_full.py --from 2026-02-11 --to 2026-04-11

    # 테스트 (1배치만)
    python translate_full.py --test
"""

import os
import re
import sys
import json
import time
import queue
import threading
import argparse
from typing import List, Dict, Optional, Any
from pathlib import Path
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client, Client
from postprocess import postprocess_translation

# .env 로드
env_path = Path(__file__).parent.parent / '.env'
load_dotenv(dotenv_path=env_path)

# 설정값
BATCH_SIZE = 10          # 시장 단위 배치 (description이 길어서 10개씩)
UPSERT_BATCH_SIZE = 200  # DB upsert 배치
MAX_RETRIES = 3


# ============================================================
# 시스템 프롬프트
# ============================================================

SYSTEM_PROMPT = """당신은 Polymarket 예측 시장의 모든 텍스트를 한국어로 번역하는 전문가입니다.

각 시장은 3가지 요소로 구성됩니다:
1. **title** — 시장 제목 (짧은 질문)
2. **description** — 시장 규칙/정산 조건 (긴 설명문)
3. **outcomes** — 결과 옵션 (Yes/No 또는 구체적 선택지)

## 번역 원칙

### 공통
- 반말 사용 (~할까?, ~된다, ~한다)
- 날짜 한글화: February 11 → 2월 11일
- 시간대 유지: 2AM ET → 오전 2시 ET
- 숫자/금액 원문 유지: $76,000, 50+ bps
- 전문 용어: Fed → 연준, interest rates → 금리, airdrop → 에어드랍

### title (제목)
- 반말 질문형으로 번역 (~할까?, ~될까?, ~인가?)
- 간결하게, 원문 뉘앙스 유지

### description (규칙)
- 서술형 반말로 번역 (~된다, ~한다, ~않는다)
- "resolve to Yes/No" → "Yes/No로 정산된다"
- "resolution source" → "정산 기준"
- URL은 원문 그대로 유지
- 법적/규칙적 뉘앙스를 정확히 전달

### outcomes (결과 옵션)
- Yes → Yes (그대로 유지)
- No → No (그대로 유지)
- 구체적 선택지는 번역: "Up" → "상승", "Down" → "하락"
- 인명/팀명 등 고유명사는 한글화

## 용어집 (반드시 준수)

### 인물명
- Elon Musk → 일론 머스크 (❌ 엘론)
- JD Vance → 밴스 (❌ 반스)
- Zelensky → 젤렌스키
- Sam Altman → 샘 올트먼 (❌ 알트만)
- Netanyahu → 네타냐후
- Macron → 마크롱

### 정산 관련 표현
- "resolve to Yes" → "Yes로 정산된다"
- "resolve to No" → "No로 정산된다"
- "resolution source" → "정산 기준"
- "primary resolution source" → "주요 정산 기준"
- "credible reporting" → "신뢰할 수 있는 보도"
- "governing body" → "주관 기관"

### 금융/암호화폐
- Fed → 연준, interest rates → 금리
- market cap → 시가총액, FDV → FDV
- airdrop → 에어드랍 (❌ 에어드롭)

## 출력 형식

반드시 JSON 배열로 출력하세요. 다른 텍스트 없이 JSON만 출력합니다.

입력:
[
  {"idx": 1, "title": "...", "description": "...", "outcomes": ["Yes", "No"]}
]

출력:
[
  {"idx": 1, "title_ko": "...", "description_ko": "...", "outcomes_ko": ["Yes", "No"]}
]

description이 없는 경우 description_ko는 null로 출력합니다."""


# ============================================================
# 템플릿 번역 (Up or Down 패턴 - API 불필요)
# ============================================================

COIN_NAME_MAP = {
    'Bitcoin': '비트코인', 'Ethereum': '이더리움', 'Solana': '솔라나',
    'XRP': 'XRP', 'Dogecoin': '도지코인', 'DOGE': '도지코인',
    'BNB': 'BNB', 'Cardano': '카르다노', 'Avalanche': '아발란체',
    'Polkadot': '폴카닷', 'Chainlink': '체인링크', 'Litecoin': '라이트코인',
    'SUI': 'SUI', 'SOL': 'SOL',
}

MONTH_MAP = {
    'January': '1월', 'February': '2월', 'March': '3월',
    'April': '4월', 'May': '5월', 'June': '6월',
    'July': '7월', 'August': '8월', 'September': '9월',
    'October': '10월', 'November': '11월', 'December': '12월',
}

_UP_DOWN_PATTERN = re.compile(
    r'^(.+?)\s+Up or Down\s*-\s*'
    r'(\w+)\s+(\d{1,2}),\s*'
    r'(.+?)\s+ET$'
)

_SINGLE_TIME = re.compile(r'^(\d{1,2})(AM|PM)$')
_SINGLE_TIME_MIN = re.compile(r'^(\d{1,2}):(\d{2})(AM|PM)$')
_TIME_RANGE = re.compile(r'^(\d{1,2}):(\d{2})(AM|PM)-(\d{1,2}):(\d{2})(AM|PM)$')
_SIMPLE_RANGE = re.compile(r'^(\d{1,2})(AM|PM)-(\d{1,2})(AM|PM)$')


def _convert_ampm(hour_str: str, ampm: str) -> str:
    hour = int(hour_str)
    prefix = '오전' if ampm == 'AM' else '오후'
    return f'{prefix} {hour}시'


def _convert_time_part(time_str: str) -> Optional[str]:
    time_str = time_str.strip()
    m = _SINGLE_TIME.match(time_str)
    if m:
        return _convert_ampm(m.group(1), m.group(2))
    m = _SINGLE_TIME_MIN.match(time_str)
    if m:
        prefix = '오전' if m.group(3) == 'AM' else '오후'
        return f'{prefix} {m.group(1)}:{m.group(2)}'
    m = _TIME_RANGE.match(time_str)
    if m:
        prefix = '오전' if m.group(3) == 'AM' else '오후'
        return f'{prefix} {m.group(1)}:{m.group(2)}~{m.group(4)}:{m.group(5)}'
    m = _SIMPLE_RANGE.match(time_str)
    if m:
        prefix = '오전' if m.group(2) == 'AM' else '오후'
        return f'{prefix} {m.group(1)}시~{m.group(3)}시'
    return None


# Up or Down 시장의 description 템플릿 번역
_UP_DOWN_DESC_TEMPLATES = {
    'BTC/USD': '비트코인(BTC/USD)',
    'ETH/USD': '이더리움(ETH/USD)',
    'SOL/USD': '솔라나(SOL/USD)',
    'XRP/USD': 'XRP(XRP/USD)',
    'DOGE/USD': '도지코인(DOGE/USD)',
}


def template_translate_market(market: Dict) -> Optional[Dict]:
    """Up or Down 패턴 시장을 템플릿으로 즉시 번역 (title + description + outcomes)"""
    title = market.get('title', '')
    m = _UP_DOWN_PATTERN.match(title)
    if not m:
        return None

    coin_en = m.group(1).strip()
    month_en = m.group(2)
    day = m.group(3)
    time_part = m.group(4).strip()

    coin_ko = COIN_NAME_MAP.get(coin_en, coin_en)
    month_ko = MONTH_MAP.get(month_en)
    if not month_ko:
        return None
    time_ko = _convert_time_part(time_part)
    if not time_ko:
        return None

    title_ko = f'{coin_ko} - {month_ko} {day}일, {time_ko} ET에 오를까 내릴까?'

    # description 템플릿 번역
    description = market.get('description') or ''
    description_ko = None
    if description:
        # Chainlink 기반 Up/Down 시장은 description이 거의 동일
        for ticker, ticker_ko in _UP_DOWN_DESC_TEMPLATES.items():
            if ticker in description:
                description_ko = (
                    f'이 시장은 제목에 명시된 시간 범위의 종료 시점에서 {ticker_ko} 가격이 '
                    f'시작 시점의 가격보다 크거나 같으면 "상승"으로 정산된다. '
                    f'그 외에는 "하락"으로 정산된다.\n'
                    f'이 시장의 정산 기준은 Chainlink의 {ticker} 데이터 스트림이다.\n'
                    f'이 시장은 Chainlink {ticker} 데이터 스트림 기준이며, '
                    f'다른 소스나 현물 시장 기준이 아니다.'
                )
                break

    return {
        'title_ko': title_ko,
        'description_ko': description_ko,
        'outcomes_ko': ['상승', '하락'],
    }


# ============================================================
# 메인 번역기
# ============================================================

def calculate_date_range(months: int, from_date: str = None, to_date: str = None):
    if from_date and to_date:
        return from_date, to_date
    now_utc = datetime.now(timezone.utc)
    today_start = now_utc.replace(hour=15, minute=0, second=0, microsecond=0) - timedelta(days=1)
    if now_utc.hour >= 15:
        today_start = now_utc.replace(hour=15, minute=0, second=0, microsecond=0)
    start = today_start.strftime('%Y-%m-%d %H:%M:%S+00')
    end = (today_start + timedelta(days=months * 30)).strftime('%Y-%m-%d %H:%M:%S+00')
    return start, end


class FullTranslator:
    def __init__(self, workers: int, overwrite: bool, exclude_sports: bool,
                 start_date: str, end_date: str):
        self.openai_key = os.getenv('OPENAI_API_KEY')
        self.supabase_url = os.getenv('SUPABASE_URL')
        self.supabase_key = os.getenv('SUPABASE_KEY')

        if not all([self.openai_key, self.supabase_url, self.supabase_key]):
            print("❌ 환경 변수를 설정해주세요: OPENAI_API_KEY, SUPABASE_URL, SUPABASE_KEY")
            sys.exit(1)

        self.openai_client = OpenAI(api_key=self.openai_key)
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)

        self.workers = workers
        self.overwrite = overwrite
        self.exclude_sports = exclude_sports
        self.start_date = start_date
        self.end_date = end_date

        # 통계 (Thread-safe)
        self.lock = threading.Lock()
        self.total_api_calls = 0
        self.total_translated = 0
        self.template_count = 0
        self.failed_batches = 0

    def translate_batch(self, markets: List[Dict]) -> List[Dict]:
        """시장 배치를 GPT-4o-mini로 번역. 시장별 title+description+outcomes 통합."""
        if not markets:
            return []

        # API 입력 구성
        input_data = []
        for i, m in enumerate(markets):
            entry = {
                'idx': i + 1,
                'title': m['title'],
                'description': m.get('description') or None,
                'outcomes': m.get('outcomes') or ['Yes', 'No'],
            }
            input_data.append(entry)

        input_json = json.dumps(input_data, ensure_ascii=False, indent=None)

        for attempt in range(MAX_RETRIES):
            try:
                completion = self.openai_client.chat.completions.create(
                    model='gpt-4o-mini',
                    max_tokens=16000,
                    temperature=0.3,
                    response_format={"type": "json_object"},
                    messages=[
                        {'role': 'system', 'content': SYSTEM_PROMPT},
                        {'role': 'user', 'content': f'번역할 시장들:\n{input_json}'}
                    ]
                )

                response_text = completion.choices[0].message.content.strip()
                parsed = json.loads(response_text)

                # JSON 구조 처리: {"results": [...]} 또는 직접 [...]
                if isinstance(parsed, dict):
                    results = parsed.get('results') or parsed.get('data') or []
                    if not results:
                        # 단일 키 dict일 수 있음
                        for v in parsed.values():
                            if isinstance(v, list):
                                results = v
                                break
                elif isinstance(parsed, list):
                    results = parsed
                else:
                    results = []

                # idx 기반 매핑
                result_map = {}
                for item in results:
                    idx = item.get('idx', 0)
                    result_map[idx] = item

                # 후처리 + 결과 조립
                translated = []
                for i, m in enumerate(markets):
                    r = result_map.get(i + 1, {})
                    title_ko = r.get('title_ko', m['title'])
                    title_ko = postprocess_translation(m['title'], title_ko)

                    description_ko = r.get('description_ko')
                    if description_ko:
                        # description에도 용어 교정 + 월명 한글화 적용
                        description_ko = postprocess_translation(
                            m.get('description', ''), description_ko
                        )

                    outcomes_ko = r.get('outcomes_ko', m.get('outcomes'))

                    translated.append({
                        'id': m['id'],
                        'title': m['title'],
                        'title_ko': title_ko,
                        'description_ko': description_ko,
                        'outcomes_ko': json.dumps(outcomes_ko, ensure_ascii=False) if outcomes_ko else None,
                    })

                return translated

            except json.JSONDecodeError as e:
                if attempt < MAX_RETRIES - 1:
                    print(f"  ⚠️  JSON 파싱 실패, 재시도 {attempt + 1}/{MAX_RETRIES}")
                    time.sleep(2 ** attempt)
                else:
                    print(f"  ❌ JSON 파싱 최종 실패: {e}")
                    return []
            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    print(f"  ⚠️  재시도 {attempt + 1}/{MAX_RETRIES}: {e}")
                    time.sleep(2 ** attempt)
                else:
                    print(f"  ❌ API 호출 실패: {e}")
                    return []

        return []

    def _translate_batch_worker(self, batch_num: int, markets: List[Dict],
                                total_batches: int) -> List[Dict]:
        """워커 스레드에서 배치 번역"""
        try:
            result = self.translate_batch(markets)
            with self.lock:
                self.total_api_calls += 1
            progress = (self.total_api_calls / total_batches) * 100
            print(f"  🔤 번역 {batch_num:3d}/{total_batches} | "
                  f"{len(result):2d}개 시장 ({progress:.1f}%)")
            return result
        except Exception as e:
            with self.lock:
                self.failed_batches += 1
            print(f"  ❌ 배치 {batch_num} 실패: {e}")
            return []

    def fetch_target_markets(self) -> List[Dict]:
        """번역 대상 시장 조회 (title, description, outcomes 포함)"""
        all_markets = []
        offset = 0
        page_size = 1000

        while True:
            query = self.supabase.table('poly_events') \
                .select('id, title, description, outcomes') \
                .gte('end_date', self.start_date) \
                .lt('end_date', self.end_date)

            if not self.overwrite:
                # title_ko 또는 description_ko가 없는 시장
                query = query.or_('title_ko.is.null,description_ko.is.null')

            if self.exclude_sports:
                query = query.neq('category', 'Sports')

            response = query.order('end_date').limit(page_size).offset(offset).execute()

            if not response.data:
                break

            all_markets.extend(response.data)
            offset += page_size

            if len(response.data) < page_size:
                break

        return all_markets

    def _bulk_update(self, results: List[Dict]) -> int:
        """번역 결과를 DB에 벌크 upsert"""
        if not results:
            return 0

        success = 0
        total_chunks = (len(results) + UPSERT_BATCH_SIZE - 1) // UPSERT_BATCH_SIZE

        for i in range(0, len(results), UPSERT_BATCH_SIZE):
            chunk = results[i:i + UPSERT_BATCH_SIZE]
            chunk_num = i // UPSERT_BATCH_SIZE + 1

            for attempt in range(MAX_RETRIES):
                try:
                    result = self.supabase.table('poly_events') \
                        .upsert(chunk, on_conflict='id') \
                        .execute()
                    success += len(result.data)
                    print(f"  💾 DB 저장 {chunk_num}/{total_chunks} | {len(result.data)}개")
                    break
                except Exception as e:
                    if attempt < MAX_RETRIES - 1:
                        time.sleep(1 * (attempt + 1))
                    else:
                        print(f"  ❌ DB 저장 실패 (청크 {chunk_num}): {e}")

        return success

    def run(self, max_batches: int = None):
        """통합 번역 실행"""
        print(f"\n{'='*60}")
        print(f"  Polymarket 통합 번역 (제목 + 규칙 + 결과 옵션)")
        print(f"{'='*60}")
        print(f"  기간       : {self.start_date[:10]} ~ {self.end_date[:10]}")
        print(f"  워커       : {self.workers}개")
        print(f"  배치 크기  : {BATCH_SIZE}개 시장/배치")
        print(f"  모드       : {'덮어쓰기' if self.overwrite else '미번역만'}")
        if self.exclude_sports:
            print(f"  제외       : Sports")
        print()

        # 1. 대상 시장 조회
        print("  시장 조회 중...")
        all_markets = self.fetch_target_markets()
        total = len(all_markets)

        if total == 0:
            print("  ✅ 번역할 시장이 없습니다.\n")
            return

        # 2. 템플릿 번역 (Up or Down 패턴)
        template_results = []
        api_markets = []

        for market in all_markets:
            tmpl = template_translate_market(market)
            if tmpl:
                template_results.append({
                    'id': market['id'],
                    'title': market['title'],
                    'title_ko': tmpl['title_ko'],
                    'description_ko': tmpl['description_ko'],
                    'outcomes_ko': json.dumps(tmpl['outcomes_ko'], ensure_ascii=False),
                })
            else:
                api_markets.append(market)

        self.template_count = len(template_results)

        # 3. API 번역 배치 분할
        batches = [
            api_markets[i:i + BATCH_SIZE]
            for i in range(0, len(api_markets), BATCH_SIZE)
        ]
        total_batches = len(batches)

        if max_batches and total_batches > max_batches:
            batches = batches[:max_batches]
            total_batches = len(batches)

        # 통계 출력
        has_desc = sum(1 for m in all_markets if m.get('description'))
        print(f"  대상 시장     : {total:,}개")
        print(f"  description有 : {has_desc:,}개")
        print(f"  템플릿 번역   : {self.template_count:,}개 (무료)")
        print(f"  API 번역      : {len(api_markets):,}개")
        print(f"  API 배치      : {total_batches}개 ({BATCH_SIZE}개/배치)")
        if total_batches > 0:
            print(f"  예상 시간     : ~{(total_batches * 3 / self.workers / 60):.1f}분")
        print(f"{'='*60}\n")

        start_time = time.time()

        # 4. 병렬 API 번역
        api_results = []
        if batches:
            print("  [번역 단계]")
            with ThreadPoolExecutor(max_workers=self.workers) as executor:
                futures = {
                    executor.submit(
                        self._translate_batch_worker, i + 1, batch, total_batches
                    ): i + 1
                    for i, batch in enumerate(batches)
                }
                for future in as_completed(futures):
                    batch_result = future.result()
                    api_results.extend(batch_result)

        # 5. DB 저장 (템플릿 + API 결과 합침)
        all_results = template_results + api_results
        print(f"\n  [DB 저장 단계]")
        self.total_translated = self._bulk_update(all_results)

        # 6. 결과
        elapsed = time.time() - start_time
        print(f"\n{'='*60}")
        print(f"  번역 완료!")
        print(f"  총 업데이트   : {self.total_translated:,}개 시장")
        print(f"  템플릿 번역   : {self.template_count:,}개 (무료)")
        print(f"  API 번역      : {len(api_results):,}개")
        print(f"  실패 배치     : {self.failed_batches}개")
        print(f"  시간          : {elapsed/60:.1f}분")
        if self.total_translated > 0:
            print(f"  속도          : {self.total_translated/(elapsed/60):.0f}개/분")
        print(f"{'='*60}\n")


def main():
    parser = argparse.ArgumentParser(
        description='Polymarket 통합 번역 (제목 + 규칙 + 결과 옵션)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  python translate_full.py                              # 기본 (2개월, 미번역만)
  python translate_full.py --exclude-sports -m 6 -w 5   # Sports 제외, 6개월
  python translate_full.py --overwrite -m 2             # 전체 재번역
  python translate_full.py --from 2026-02-11 --to 2026-04-11
  python translate_full.py --test                       # 테스트 (1배치)
        """)

    parser.add_argument('-w', '--workers', type=int, default=4)
    parser.add_argument('-m', '--months', type=int, default=2)
    parser.add_argument('--from', dest='from_date', type=str, default=None)
    parser.add_argument('--to', dest='to_date', type=str, default=None)
    parser.add_argument('--overwrite', action='store_true')
    parser.add_argument('--exclude-sports', action='store_true')
    parser.add_argument('--max-batches', type=int, default=None)
    parser.add_argument('--test', action='store_true')

    args = parser.parse_args()

    if args.test:
        args.max_batches = 1

    start_date, end_date = calculate_date_range(
        args.months, args.from_date, args.to_date
    )

    translator = FullTranslator(
        workers=args.workers,
        overwrite=args.overwrite,
        exclude_sports=args.exclude_sports,
        start_date=start_date,
        end_date=end_date,
    )
    translator.run(max_batches=args.max_batches)


if __name__ == '__main__':
    main()
