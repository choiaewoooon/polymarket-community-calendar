# Polymarket 한글 번역 파이프라인

Polymarket 예측 시장의 영문 콘텐츠를 한국어로 자동 번역하는 시스템입니다.

---

## 구조

```
translation/
  translate.py              # 제목(title) 전용 번역
  translate_full.py          # 통합 번역 (제목 + 규칙 + 결과 옵션)
  postprocess.py             # 번역 후처리 (5단계 보정)
  translation_prompt.md      # GPT 번역 프롬프트 규칙
  translation-feedback.md    # 품질 피드백 로그
  translation-architecture.md # 전체 아키텍처 문서
```

---

## 번역 대상

| 필드 | DB 컬럼 | 설명 | 담당 스크립트 |
|------|---------|------|-------------|
| 제목 | `title_ko` | 마켓 제목 | translate.py |
| 규칙 | `description_ko` | 마켓 규칙(Rules) | translate_full.py |
| 결과 옵션 | `outcomes_ko` | 베팅 선택지 (jsonb) | translate_full.py |

---

## 데이터 흐름

```
Polymarket 영문 마켓 (poly_events 테이블)
        ↓
  [1] 중복 제거 — 같은 제목은 한 번만 번역
  [2] 캐시 히트 — DB에 이미 번역된 건 재사용
  [3] 템플릿 매칭 — 정규식 패턴으로 즉시 변환 (API 불필요)
  [4] API 번역 — GPT-4o-mini 배치 호출 (유료)
        ↓
  후처리 5단계 (postprocess.py)
        ↓
  Supabase upsert (title_ko, description_ko, outcomes_ko)
```

비용 최적화 결과: **전체 마켓의 ~80%는 API 호출 없이 처리**, 유료 API는 나머지 ~20%만 사용

---

## 두 스크립트 비교

| | translate.py | translate_full.py |
|---|---|---|
| **번역 범위** | 제목만 | 제목 + 규칙 + 결과 옵션 |
| **배치 크기** | 100개 제목/배치 | 10개 마켓/배치 |
| **API 응답** | 텍스트 (번호 매칭) | JSON (`response_format`) |
| **max_tokens** | 5,000 | 16,000 |
| **용도** | 기존 운영용 | 신규 DB 구축 / 전체 번역용 |

---

## 후처리 파이프라인 (postprocess.py)

API 번역 결과를 5단계로 보정합니다:

1. **용어 교정** — 엘론→일론, 행정 명령→행정명령, 이자율→금리
2. **시간대 유지** — 원문에 ET가 있으면 번역에도 ET 추가
3. **"가질까" 보정** — 순위를 가질까→차지할까, 조회수를 가질까→기록할까
4. **문화적 표현** — 봄 축제 갈라→CCTV 춘완, 첫 번째 피→퍼스트 블러드
5. **월명 한글화** — February→2월, March→3월

---

## 실행 방법

### 환경 설정

```bash
pip install requests supabase python-dotenv openai
```

`.env` 파일:
```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...
```

### 제목만 번역 (translate.py)

```bash
# 기본 실행 (최근 2개월, 미번역만)
python translate.py

# Sports 제외
python translate.py --exclude-sports

# 테스트 (1배치만)
python translate.py --test
```

### 통합 번역 (translate_full.py)

```bash
# 기본 실행
python translate_full.py

# 전체 재번역
python translate_full.py --overwrite

# 날짜 범위 지정
python translate_full.py --from 2026-02-11 --to 2026-04-11

# 테스트
python translate_full.py --test
```

### CLI 옵션 (공통)

| 옵션 | 설명 | 기본값 |
|------|------|--------|
| `--test` | 1배치만 실행 | off |
| `--overwrite` | 기존 번역 덮어쓰기 | off |
| `--exclude-sports` | Sports 카테고리 제외 | off |
| `--from` / `--to` | 날짜 범위 지정 | 최근 2개월 |
| `-w` / `--workers` | 병렬 워커 수 | 4 |
| `-m` / `--months` | 기간 (개월) | 2 |

---

## DB 스키마 (번역 관련 컬럼)

테이블: `poly_events`

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `title` | text | 영문 제목 |
| `title_ko` | text | 한글 제목 |
| `description` | text | 영문 규칙 |
| `description_ko` | text | 한글 규칙 |
| `outcomes` | jsonb | 영문 결과 옵션 |
| `outcomes_ko` | jsonb | 한글 결과 옵션 |

---

## 비용 참고

- **모델**: GPT-4o-mini ($0.15/1M input, $0.60/1M output)
- **제목만 (165K 마켓)**: ~$1.5
- **제목+규칙+옵션 (165K 마켓)**: ~$12
- 퍼널 최적화 적용 시 실제 비용은 위 수치의 ~20%
