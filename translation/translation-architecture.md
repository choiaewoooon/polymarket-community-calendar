# 번역 아키텍처 문서

**프로젝트**: 폴리마켓 커뮤니티 캘린더
**최종 수정**: 2026-03-10
**대상 독자**: 개발팀

---

## 1. 개요

Polymarket의 영문 예측 시장 제목을 한국어로 자동 번역하는 시스템입니다.
**비용 최소화 + 품질 보정 + 자동 학습**을 목표로 3단계 필터링 + 5단계 후처리 구조로 설계되었습니다.

---

## 2. 전체 아키텍처

```
1. 캐시 (무료) → 2. 템플릿 (무료) → 3. API 번역 (GPT-4o-mini)
                                            ↓
                                     후처리 (5단계)
                                            ↓
                                     Supabase 저장 (title_ko)
```

---

## 3. 데이터 흐름

```
Polymarket API (영문 마켓)
       ↓
ETL (main.py) → Supabase poly_events 테이블
       ↓
translate.py 실행 ← 미번역 이벤트 조회
       ↓
  [1단계] 캐시 히트 → 기존 번역 재사용
  [2단계] 템플릿 매칭 → 정규식 즉시 번역
  [3단계] API 호출 → GPT-4o-mini 배치 번역
       ↓
후처리 (postprocess.py)
       ↓
Supabase upsert (title_ko 저장)
       ↓
프론트엔드 (i18n.ts → getTitle())
```

---

## 4. 3단계 번역 필터링

### Stage 1: 캐시 (비용 0)

- **파일**: `etl/translate.py` → `_preload_cache()`
- **동작**: Supabase에서 `title_ko IS NOT NULL`인 기존 번역을 조회하여 재사용
- **청크 크기**: 200개 단위
- **효과**: 이미 번역된 제목은 API 호출 없이 즉시 매핑

### Stage 2: 템플릿 번역 (비용 0)

- **파일**: `etl/translate.py` → `template_translate()`
- **동작**: 정규식으로 반복 패턴을 즉시 변환
- **대상 패턴**: `[코인명] Up or Down - [월] [일], [시간] ET`
- **예시**: `Bitcoin Up or Down - February 24, 12AM ET` → `비트코인 - 2월 24일, 오전 12시 ET에 오를까 내릴까?`

변환 딕셔너리:

- `COIN_NAME_MAP`: Bitcoin → 비트코인, Ethereum → 이더리움 등
- `MONTH_MAP`: January → 1월, February → 2월 등
- `_convert_time_part()`: 12AM → 오전 12시, 3PM → 오후 3시

### Stage 3: API 번역 (비용 발생)

- **파일**: `etl/translate.py` → `translate_batch()`
- **모델**: `gpt-4o-mini`
- **설정**: temperature=0.3, max_tokens=5000
- **배치 크기**: 100개 제목/배치
- **병렬 처리**: ThreadPoolExecutor (기본 4 워커)
- **재시도**: 3회, 지수 백오프 (1s → 2s → 4s)

API 요청 형식:

```json
{
  "model": "gpt-4o-mini",
  "messages": [
    {"role": "system", "content": "[번역 프롬프트 규칙]"},
    {"role": "user", "content": "번역할 제목들:\n1. Will Bitcoin reach $150,000?\n2. US recession in 2025?"}
  ]
}
```

응답 파싱: 번호 기반 매칭 (`1. 비트코인이...`, `2. 미국...`)

---

## 5. 5단계 후처리 파이프라인

**파일**: `etl/postprocess.py`

1. **용어/인명 교정** (`apply_glossary_corrections`)
    - 엘론 → 일론, 행정 명령 → 행정명령
2. **시간대 유지 보정** (`fix_timezone_consistency`)
    - 원문에 ET가 있으면 번역문에도 ET 추가
3. **"가질까" 문맥 보정** (`fix_have_translations`)
    - 순위를 가질까 → 차지할까, 조회수를 가질까 → 기록할까
4. **문화적 표현 변환** (`apply_cultural_context`)
    - 봄 축제 갈라 → CCTV 춘완, 첫 번째 피 → 퍼스트 블러드
5. **월명 한글화** (`fix_english_months`)
    - February → 2월, March → 3월

핵심 함수:

```python
def postprocess_translation(original: str, translated: str) -> str:
    result = apply_glossary_corrections(translated)
    result = fix_timezone_consistency(original, result)
    result = fix_have_translations(result)
    result = apply_cultural_context(result)
    result = fix_english_months(result)
    return result
```

---

## 6. 번역 프롬프트 규칙

**파일**: `etl/translation_prompt.md`

### 핵심 원칙

- **반말**: ~할까?, ~될까?, ~인가? (존댓말 금지)
- **날짜 한글화**: February 11 → 2월 11일
- **시간대 유지**: 2AM ET → 오전 2시 ET
- **간결성**: 자연스러운 한국어, 불필요한 부연 없이

### 번역 패턴 예시

- **Will 질문**: Will Bitcoin reach $150,000? → 비트코인이 $150,000에 도달할까?
- **수치 비교**: Bitcoin above $76,000? → 비트코인이 $76,000보다 높을까?
- **on [date]**: …on Feb 11? → …2월 11일에?
- **by [date]**: …by February 6, 2026? → …2026년 2월 6일까지?
- **승패**: Will Leeds win? → 리즈가 우승할까?

### 필수 용어집

**올바른 표기 → (잘못된 표기)**

- 일론 머스크 (~~엘론 머스크~~)
- 밴스 (~~반스~~)
- 젤렌스키 (~~젤렌스끼~~)
- 연준 (~~연방준비~~)
- 금리 (~~이자율~~)
- 오스카상 (~~아카데미상~~)
- 에어드랍 (~~에어드롭~~)

---

## 7. DB 스키마 (번역 관련)

**테이블**: `poly_events`

- `id` (text, PK) — 마켓 conditionId
- `title` (text) — 영문 제목
- `title_ko` (text, nullable) — **한글 번역** (NULL = 미번역)
- `category` (text) — 카테고리 (ETL에서 추론)
- `is_korea` (boolean) — 한국 관련 마켓 여부
- `end_date` (timestamptz) — 종료 시간
- `volume` (numeric) — 총 거래량

---

## 8. 프론트엔드 통합

- `src/i18n.ts` → `getTitle(event)` : 언어별 제목 선택
- `src/data.ts` → `loadData()` : Supabase에서 title_ko 포함 조회
- `src/render/*` → 모든 뷰에서 `getTitle()` 호출

로직:

```typescript
export function getTitle(event: PolyEvent): string {
    if (currentLang === 'ko' && event.title_ko) {
        return event.title_ko;   // 한글 번역이 있으면 사용
    }
    return event.title;          // 없으면 영문 fallback
}
```

---

## 9. 실행 방법

### CLI 옵션

```bash
# 기본 실행 (최근 2개월, 미번역만, 4워커)
python etl/translate.py

# Sports 제외, 6개월, 5워커
python etl/translate.py --exclude-sports -m 6 -w 5

# 전체 재번역 (기존 번역 덮어쓰기)
python etl/translate.py --overwrite -m 1

# 테스트 (1배치만)
python etl/translate.py --test

# 날짜 범위 지정
python etl/translate.py --from 2026-02-11 --to 2026-04-11
```

### 환경 변수 (.env)

```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...
```

---

## 10. 비용 최적화 전략

```
전체 미번역 제목 (예: 2,000개)
       ↓
중복 제거 → 2,000 → 800 고유 제목
       ↓
캐시 히트 → 800 → 500 (300개 캐시)
       ↓
템플릿 매칭 → 500 → 350 (150개 템플릿)
       ↓
API 호출 (유료) → 350개만 GPT-4o-mini (배치: 4개 x 100)
```

**결과**: 2,000개 중 350개만 유료 API = **82.5% 비용 절감**

---

## 11. 에러 처리

- **API Rate Limit** → 지수 백오프 재시도 (3회)
- **API 응답 파싱 실패** → 번호 매칭 재시도 → 원문 반환
- **배치 수 불일치** → 경고 로그, 계속 진행
- **Supabase 연결 실패** → 재시도 3회 → 실패 기록
- **캐시 조회 실패** → 경고 출력, API 번역으로 진행

---

## 12. 피드백 루프 (자가 학습)

```
번역 실행 → 품질 이슈 발견 → translation-feedback.md에 기록
                                      ↓
                                 10건 누적?
                              No → 계속 수집
                             Yes → 자동 개선
                                  → postprocess.py 규칙 추가
                                  → translation_prompt.md 수정
```

피드백 기록 형식 (`etl/translation-feedback.md`):

```
### 2026-03-10: 인명 오역
- 원문: Will Elon Musk visit Korea?
- 잘못된 번역: 엘론 머스크가 한국을 방문할까?
- 올바른 번역: 일론 머스크가 한국을 방문할까?
- 원인: GPT 기본 번역이 "엘론" 사용
- 조치: postprocess.py glossary에 추가
- 반영 여부: 반영 완료
```

---

## 13. 파일 구조 요약

```
etl/
  translate.py              # 번역 오케스트레이션 (메인)
  postprocess.py            # 5단계 후처리 파이프라인
  translation_prompt.md     # GPT 번역 프롬프트 규칙
  translation-feedback.md   # 품질 피드백 로그
  main.py                   # ETL 데이터 수집 (번역 아님)
  requirements.txt          # Python 의존성

src/
  i18n.ts                   # 다국어 처리 (getTitle)
  data.ts                   # Supabase 데이터 로드
  types.ts                  # PolyEvent 타입 정의
  render/                   # 뷰 렌더링 (getTitle 사용)

.claude/
  agents/translator.md      # 번역 에이전트 설정
  commands/translate.md     # /translate 슬래시 커맨드
```

---

## 14. 기술 스택

- **번역 AI**: OpenAI GPT-4o-mini
- **병렬 처리**: Python ThreadPoolExecutor
- **데이터베이스**: Supabase (PostgreSQL)
- **프론트엔드**: TypeScript + Vite
- **배포**: Vercel (수동 `vercel --prod`)
- **CI**: GitHub Actions (ETL만, 번역은 수동)
