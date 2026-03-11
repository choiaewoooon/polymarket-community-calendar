#!/usr/bin/env python3
"""
Polymarket 시장 제목 한글 번역 (통합 스크립트)

사용법:
    # 기본: 앞으로 2개월, 미번역만
    python translate.py

    # Sports 제외, 6개월, 5워커
    python translate.py --exclude-sports --months 6 --workers 5

    # 덮어쓰기 모드 (이미 번역된 것도 재번역)
    python translate.py --overwrite

    # 특정 날짜 범위
    python translate.py --from 2026-02-11 --to 2026-04-11

    # 테스트 (1배치만)
    python translate.py --test
"""

import os
import re
import sys
import time
import queue
import threading
import argparse
from typing import List, Dict, Optional
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
TRANSLATE_BATCH_SIZE = 100   # OpenAI API 배치 크기
UPSERT_BATCH_SIZE = 500      # DB upsert 배치 크기
CACHE_QUERY_SIZE = 200       # 캐시 조회 청크 크기
MAX_RETRIES = 3


# ============================================================
# 템플릿 번역 (API 불필요 - 패턴 기반 즉시 번역)
# ============================================================

COIN_NAME_MAP = {
    'Bitcoin': '비트코인',
    'Ethereum': '이더리움',
    'Solana': '솔라나',
    'XRP': 'XRP',
    'Dogecoin': '도지코인',
    'DOGE': '도지코인',
    'BNB': 'BNB',
    'Cardano': '카르다노',
    'Avalanche': '아발란체',
    'Polkadot': '폴카닷',
    'Chainlink': '체인링크',
    'Litecoin': '라이트코인',
    'SUI': 'SUI',
    'SOL': 'SOL',
}

MONTH_MAP = {
    'January': '1월', 'February': '2월', 'March': '3월',
    'April': '4월', 'May': '5월', 'June': '6월',
    'July': '7월', 'August': '8월', 'September': '9월',
    'October': '10월', 'November': '11월', 'December': '12월',
}

# "Up or Down" 패턴 정규식
# 예: "Bitcoin Up or Down - February 24, 12AM ET"
# 예: "Bitcoin Up or Down - February 24, 1:30AM-1:45AM ET"
_UP_DOWN_PATTERN = re.compile(
    r'^(.+?)\s+Up or Down\s*-\s*'          # 코인명
    r'(\w+)\s+(\d{1,2}),\s*'               # 월 일
    r'(.+?)\s+ET$'                          # 시간 부분 + ET
)

# 단일 시간: "12AM", "1PM", "10AM"
_SINGLE_TIME = re.compile(r'^(\d{1,2})(AM|PM)$')

# 분 포함 단일 시간: "1:30AM"
_SINGLE_TIME_MIN = re.compile(r'^(\d{1,2}):(\d{2})(AM|PM)$')

# 시간 범위: "12:00AM-12:05AM", "1:30PM-1:45PM"
_TIME_RANGE = re.compile(r'^(\d{1,2}):(\d{2})(AM|PM)-(\d{1,2}):(\d{2})(AM|PM)$')

# 단순 시간 범위: "1AM-2AM"
_SIMPLE_RANGE = re.compile(r'^(\d{1,2})(AM|PM)-(\d{1,2})(AM|PM)$')


def _convert_ampm(hour_str: str, ampm: str) -> str:
    """AM/PM을 오전/오후로 변환"""
    hour = int(hour_str)
    prefix = '오전' if ampm == 'AM' else '오후'
    return f'{prefix} {hour}시'


def _convert_time_part(time_str: str) -> Optional[str]:
    """시간 문자열을 한글로 변환"""
    time_str = time_str.strip()

    # 단일 시간: "12AM" → "오전 12시"
    m = _SINGLE_TIME.match(time_str)
    if m:
        return _convert_ampm(m.group(1), m.group(2))

    # 분 포함 단일: "1:30AM" → "오전 1:30"
    m = _SINGLE_TIME_MIN.match(time_str)
    if m:
        prefix = '오전' if m.group(3) == 'AM' else '오후'
        return f'{prefix} {m.group(1)}:{m.group(2)}'

    # 시간 범위: "12:00AM-12:05AM" → "오전 12:00~12:05"
    m = _TIME_RANGE.match(time_str)
    if m:
        prefix = '오전' if m.group(3) == 'AM' else '오후'
        return f'{prefix} {m.group(1)}:{m.group(2)}~{m.group(4)}:{m.group(5)}'

    # 단순 범위: "1AM-2AM" → "오전 1시~2시"
    m = _SIMPLE_RANGE.match(time_str)
    if m:
        prefix = '오전' if m.group(2) == 'AM' else '오후'
        return f'{prefix} {m.group(1)}시~{m.group(3)}시'

    return None


def template_translate(title: str) -> Optional[str]:
    """패턴 기반 즉시 번역. 매칭 안 되면 None 반환."""
    m = _UP_DOWN_PATTERN.match(title)
    if not m:
        return None

    coin_en = m.group(1).strip()
    month_en = m.group(2)
    day = m.group(3)
    time_part = m.group(4).strip()

    # 코인명 변환
    coin_ko = COIN_NAME_MAP.get(coin_en, coin_en)

    # 월 변환
    month_ko = MONTH_MAP.get(month_en)
    if not month_ko:
        return None

    # 시간 변환
    time_ko = _convert_time_part(time_part)
    if not time_ko:
        return None

    return f'{coin_ko} - {month_ko} {day}일, {time_ko} ET에 오를까 내릴까?'


def load_translation_prompt() -> str:
    """translation_prompt.md에서 프롬프트 로드"""
    prompt_file = Path(__file__).parent / 'translation_prompt.md'
    try:
        content = prompt_file.read_text(encoding='utf-8')
        start = content.find('```\n당신은') + 4
        end = content.find('\n```', start)
        if start > 3 and end > start:
            return content[start:end].strip()
    except Exception as e:
        print(f"⚠️  프롬프트 로드 실패: {e}")

    return """당신은 Polymarket 예측 시장 제목을 한국어로 번역하는 전문가입니다.
반말로 번역하세요 (~할까?, ~될까?). 날짜는 한글로 (February 11 → 2월 11일).
시간대는 반드시 유지 (4AM ET → 오전 4시 ET). 번호와 함께 출력하세요."""


TRANSLATION_PROMPT = load_translation_prompt()


def calculate_date_range(months: int, from_date: str = None, to_date: str = None):
    """날짜 범위 계산 (KST 기준)"""
    if from_date and to_date:
        return from_date, to_date

    now_utc = datetime.now(timezone.utc)
    # KST 오늘 시작 = UTC 전날 15:00
    today_start = now_utc.replace(hour=15, minute=0, second=0, microsecond=0) - timedelta(days=1)
    if now_utc.hour >= 15:
        today_start = now_utc.replace(hour=15, minute=0, second=0, microsecond=0)

    start = today_start.strftime('%Y-%m-%d %H:%M:%S+00')
    end = (today_start + timedelta(days=months * 30)).strftime('%Y-%m-%d %H:%M:%S+00')
    return start, end


class Translator:
    def __init__(self, workers: int, overwrite: bool, exclude_sports: bool,
                 start_date: str, end_date: str):
        # 환경 변수
        self.openai_key = os.getenv('OPENAI_API_KEY')
        self.supabase_url = os.getenv('SUPABASE_URL')
        self.supabase_key = os.getenv('SUPABASE_KEY')

        if not all([self.openai_key, self.supabase_url, self.supabase_key]):
            print("❌ 환경 변수를 설정해주세요:")
            print("   OPENAI_API_KEY, SUPABASE_URL, SUPABASE_KEY")
            sys.exit(1)

        # 클라이언트
        self.openai_client = OpenAI(api_key=self.openai_key)
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)

        # 옵션
        self.workers = workers
        self.overwrite = overwrite
        self.exclude_sports = exclude_sports
        self.start_date = start_date
        self.end_date = end_date

        # Supabase 클라이언트 풀 (워커용)
        self.client_pool = queue.Queue()
        for _ in range(workers):
            self.client_pool.put(create_client(self.supabase_url, self.supabase_key))

        # system 메시지에 TRANSLATION_PROMPT 통합 (토큰 비용 절감)
        self.system_message = f"""{TRANSLATION_PROMPT}

---
추가 규칙:
1. 반드시 반말로 번역 (~할까, ~될까, ~인가)
2. 절대 존댓말 사용 금지 (~할까요, ~될까요 ❌)
3. 시간대 표기 필수: ET, PT 등은 반드시 유지 (4AM ET → 오전 4시 ET ✅)
4. "have"를 "가지다"로 직역 금지. 문맥에 맞게 "차지할까/선보일까/기록할까" 사용
5. 모든 제목에서 일관성 유지"""

        # 통계 (Thread-safe)
        self.lock = threading.Lock()
        self.total_translated = 0
        self.total_api_calls = 0
        self.failed_batches = 0
        self.cache_hits = 0

    def _get_client(self) -> Client:
        """풀에서 Supabase 클라이언트 가져오기"""
        return self.client_pool.get()

    def _return_client(self, client: Client):
        """풀에 Supabase 클라이언트 반환"""
        self.client_pool.put(client)

    def translate_batch(self, titles: List[str]) -> Dict[str, str]:
        """OpenAI API로 배치 번역, title→title_ko 매핑 반환"""
        if not titles:
            return {}

        titles_text = "\n".join([f"{i+1}. {t}" for i, t in enumerate(titles)])

        for attempt in range(MAX_RETRIES):
            try:
                completion = self.openai_client.chat.completions.create(
                    model="gpt-4o-mini",
                    max_tokens=5000,
                    temperature=0.3,
                    messages=[
                        {"role": "system", "content": self.system_message},
                        {"role": "user", "content": f"번역할 제목들:\n{titles_text}"}
                    ]
                )

                response_text = completion.choices[0].message.content.strip()

                # 번호 기반 파싱
                translations_dict = {}
                for line in response_text.split('\n'):
                    line = line.strip()
                    if not line:
                        continue
                    if '. ' in line and line[0].isdigit():
                        parts = line.split('. ', 1)
                        try:
                            num = int(parts[0])
                            translations_dict[num] = parts[1]
                        except (ValueError, IndexError):
                            continue

                # 후처리 + title→title_ko 매핑 생성
                result = {}
                for i, title in enumerate(titles):
                    translation = translations_dict.get(i + 1, title)
                    translation = postprocess_translation(title, translation)
                    result[title] = translation

                if len(result) != len(titles):
                    print(f"  ⚠️  번역 개수 불일치: {len(result)} != {len(titles)}")

                return result

            except Exception as e:
                if attempt < MAX_RETRIES - 1:
                    print(f"  ⚠️  재시도 {attempt + 1}/{MAX_RETRIES}")
                    time.sleep(2 ** attempt)
                else:
                    print(f"  ❌ API 호출 실패: {e}")
                    return {}

        return {}

    def _preload_cache(self, titles: List[str]) -> Dict[str, str]:
        """전체 대상 title에 대해 기존 번역 캐시를 한번에 조회"""
        cache = {}
        unique_titles = list(set(titles))

        print(f"  캐시 조회 중... ({len(unique_titles):,}개 고유 제목)")

        for i in range(0, len(unique_titles), CACHE_QUERY_SIZE):
            chunk = unique_titles[i:i + CACHE_QUERY_SIZE]
            try:
                response = self.supabase.table('poly_events') \
                    .select('title, title_ko') \
                    .in_('title', chunk) \
                    .not_.is_('title_ko', 'null') \
                    .execute()
                for row in response.data:
                    if row['title'] not in cache:
                        cache[row['title']] = row['title_ko']
            except Exception as e:
                print(f"  ⚠️  캐시 조회 실패 (청크 {i//CACHE_QUERY_SIZE + 1}): {e}")

        print(f"  캐시 적중  : {len(cache):,}개")
        return cache

    def _bulk_update(self, events: List[Dict], title_map: Dict[str, str]) -> int:
        """title_map을 기반으로 전체 이벤트에 title_ko를 벌크 upsert"""
        upsert_data = []
        for event in events:
            title_ko = title_map.get(event['title'])
            if title_ko:
                # title 포함해야 NOT NULL 제약조건 통과
                upsert_data.append({
                    'id': event['id'],
                    'title': event['title'],
                    'title_ko': title_ko
                })

        if not upsert_data:
            return 0

        success = 0
        total_chunks = (len(upsert_data) + UPSERT_BATCH_SIZE - 1) // UPSERT_BATCH_SIZE

        for i in range(0, len(upsert_data), UPSERT_BATCH_SIZE):
            chunk = upsert_data[i:i + UPSERT_BATCH_SIZE]
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

    def _translate_batch_worker(self, batch_num: int, titles: List[str],
                                total_batches: int) -> Dict[str, str]:
        """워커 스레드에서 배치 번역 실행"""
        try:
            result = self.translate_batch(titles)

            with self.lock:
                self.total_api_calls += 1
                translated_count = len(result)

            progress = (self.total_api_calls / total_batches) * 100
            print(f"  🔤 번역 {batch_num:3d}/{total_batches} | "
                  f"{translated_count:3d}개 완료 ({progress:.1f}%)")

            return result

        except Exception as e:
            with self.lock:
                self.failed_batches += 1
            print(f"  ❌ 번역 배치 {batch_num} 실패: {e}")
            return {}

    def fetch_all_target_ids(self) -> List[Dict]:
        """번역 대상 이벤트의 id, title을 한번에 모두 조회"""
        all_events = []
        offset = 0
        page_size = 1000

        while True:
            query = self.supabase.table('poly_events') \
                .select('id, title') \
                .gte('end_date', self.start_date) \
                .lt('end_date', self.end_date)

            if not self.overwrite:
                query = query.is_('title_ko', 'null')

            if self.exclude_sports:
                query = query.neq('category', 'Sports')

            response = query.order('end_date').limit(page_size).offset(offset).execute()

            if not response.data:
                break

            all_events.extend(response.data)
            offset += page_size

            if len(response.data) < page_size:
                break

        return all_events

    def run(self, max_batches: int = None):
        """번역 실행"""
        # 설정 출력
        print(f"\n{'='*55}")
        print(f"  Polymarket 제목 번역")
        print(f"{'='*55}")
        print(f"  기간       : {self.start_date[:10]} ~ {self.end_date[:10]}")
        print(f"  워커       : {self.workers}개")
        print(f"  모드       : {'덮어쓰기' if self.overwrite else '미번역만'}")
        if self.exclude_sports:
            print(f"  제외       : Sports")
        print()

        # 1. 대상 이벤트 전체 조회
        print("  이벤트 조회 중...")
        all_events = self.fetch_all_target_ids()
        total_events = len(all_events)

        if total_events == 0:
            print("  ✅ 번역할 이벤트가 없습니다.\n")
            return

        # 2. 고유 제목 추출 (중복 제거)
        all_titles = [e['title'] for e in all_events]
        unique_titles = list(set(all_titles))
        dedup_saved = total_events - len(unique_titles)

        # 3. 캐시 선로딩 (덮어쓰기 모드가 아닐 때만)
        cache = {}
        if not self.overwrite:
            cache = self._preload_cache(unique_titles)
            self.cache_hits = len(cache)

        # 4. 템플릿 번역 (API 불필요 - 패턴 매칭으로 즉시 처리)
        remaining = [t for t in unique_titles if t not in cache]
        template_map = {}
        for title in remaining:
            result = template_translate(title)
            if result:
                template_map[title] = result

        template_count = len(template_map)
        if template_count > 0:
            print(f"  템플릿 번역 : {template_count:,}개 (API 미사용)")

        # 5. API 번역 필요한 제목만 필터
        titles_to_translate = [t for t in remaining if t not in template_map]

        # 6. 번역 배치 분할
        translate_batches = [
            titles_to_translate[i:i + TRANSLATE_BATCH_SIZE]
            for i in range(0, len(titles_to_translate), TRANSLATE_BATCH_SIZE)
        ]
        total_translate_batches = len(translate_batches)

        if max_batches and total_translate_batches > max_batches:
            translate_batches = translate_batches[:max_batches]
            total_translate_batches = len(translate_batches)

        print(f"\n  대상 이벤트 : {total_events:,}개")
        print(f"  고유 제목   : {len(unique_titles):,}개 (중복 {dedup_saved:,}개 제거)")
        if not self.overwrite:
            print(f"  캐시 적중   : {len(cache):,}개")
        if template_count > 0:
            print(f"  템플릿 번역 : {template_count:,}개 (무료)")
        print(f"  API 번역    : {len(titles_to_translate):,}개")
        print(f"  번역 배치   : {total_translate_batches}개")
        if total_translate_batches > 0:
            print(f"  예상 시간   : ~{(total_translate_batches * 1.5 / self.workers / 60):.1f}분")
        print(f"{'='*55}\n")

        start_time = time.time()

        # 7. 병렬 번역 (unique title 기준)
        title_map = dict(cache)  # 캐시 결과를 먼저 포함
        title_map.update(template_map)  # 템플릿 번역 결과 포함

        if translate_batches:
            print("  [번역 단계]")
            with ThreadPoolExecutor(max_workers=self.workers) as executor:
                futures = {
                    executor.submit(
                        self._translate_batch_worker, i + 1, batch, total_translate_batches
                    ): i + 1
                    for i, batch in enumerate(translate_batches)
                }
                for future in as_completed(futures):
                    batch_result = future.result()
                    title_map.update(batch_result)

        # 8. 벌크 DB 업데이트 (max_batches 적용 시 번역된 제목만 필터)
        if max_batches:
            translated_titles = set(title_map.keys())
            events_to_update = [e for e in all_events if e['title'] in translated_titles]
        else:
            events_to_update = all_events

        print(f"\n  [DB 저장 단계]")
        self.total_translated = self._bulk_update(events_to_update, title_map)

        # 9. 결과 출력
        elapsed = time.time() - start_time
        print(f"\n{'='*55}")
        print(f"  번역 완료!")
        print(f"  이벤트 업데이트 : {self.total_translated:,}개")
        print(f"  고유 번역       : {len(title_map):,}개")
        if self.cache_hits > 0:
            print(f"  캐시 재사용     : {self.cache_hits:,}개")
        if template_count > 0:
            print(f"  템플릿 번역     : {template_count:,}개 (무료)")
        if dedup_saved > 0:
            print(f"  중복 절감       : {dedup_saved:,}개 (API 호출 절약)")
        print(f"  실패 배치       : {self.failed_batches}개")
        print(f"  시간            : {elapsed/60:.1f}분")
        if self.total_translated > 0:
            print(f"  속도            : {self.total_translated/(elapsed/60):.0f}개/분")
        print(f"{'='*55}\n")


def main():
    parser = argparse.ArgumentParser(
        description='Polymarket 제목 한글 번역',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
예시:
  python translate.py                              # 기본 (2개월, 미번역만)
  python translate.py --exclude-sports -m 6 -w 5   # Sports 제외, 6개월, 5워커
  python translate.py --overwrite -m 2             # 2개월 전체 재번역
  python translate.py --from 2026-02-11 --to 2026-04-11  # 날짜 지정
  python translate.py --test                       # 테스트 (1배치)
        """)

    parser.add_argument('-w', '--workers', type=int, default=4,
                        help='워커 수 (기본: 4, 권장: 3-5)')
    parser.add_argument('-m', '--months', type=int, default=2,
                        help='번역 기간 - 오늘부터 N개월 (기본: 2)')
    parser.add_argument('--from', dest='from_date', type=str, default=None,
                        help='시작 날짜 (YYYY-MM-DD)')
    parser.add_argument('--to', dest='to_date', type=str, default=None,
                        help='종료 날짜 (YYYY-MM-DD)')
    parser.add_argument('--overwrite', action='store_true',
                        help='이미 번역된 것도 재번역')
    parser.add_argument('--exclude-sports', action='store_true',
                        help='Sports 카테고리 제외')
    parser.add_argument('--max-batches', type=int, default=None,
                        help='최대 배치 수 (테스트용)')
    parser.add_argument('--test', action='store_true',
                        help='테스트 모드 (1배치만)')

    args = parser.parse_args()

    if args.test:
        args.max_batches = 1

    if args.workers > 10:
        print("⚠️  워커가 너무 많으면 API Rate Limit에 걸릴 수 있습니다 (권장: 3-5)")
        if input("   계속? (y/N): ").lower() != 'y':
            sys.exit(0)

    start_date, end_date = calculate_date_range(
        args.months, args.from_date, args.to_date
    )

    translator = Translator(
        workers=args.workers,
        overwrite=args.overwrite,
        exclude_sports=args.exclude_sports,
        start_date=start_date,
        end_date=end_date,
    )
    translator.run(max_batches=args.max_batches)


if __name__ == '__main__':
    main()
