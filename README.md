# Polymarket Community Calendar

Polymarket 예측 시장 데이터를 캘린더/타임라인 형식으로 시각화하는 웹 앱입니다.

> **프로덕션**: https://polymarket-calender.vercel.app

---

## 페이지 구성 및 URL

| 페이지 | URL | 설명 |
|--------|-----|------|
| 캘린더 (메인) | [`/`](https://polymarket-calender.vercel.app) | 주간 타임라인 + 월간 캘린더 |
| 99% 마켓 | [`/99market`](https://polymarket-calender.vercel.app/99market) | 확률 90%+ 단기 확정 수익 기회 |
| 한국 시장 | [`/komarket`](https://polymarket-calender.vercel.app/komarket) | 한국 관련 예측 시장 모아보기 |
| 관리자 (V1) | [`/admin/`](https://polymarket-calender.vercel.app/admin/) | 테이블 형태 시장 관리 대시보드 |

- SPA 클라이언트 라우팅 (`history.pushState`) 지원
- 각 URL로 직접 접속 가능, 브라우저 뒤로/앞으로 버튼 동작

---

## 기능 명세

### 1. 캘린더 (`/`)

메인 페이지. Polymarket 예측 시장의 종료일을 기준으로 캘린더에 배치합니다.

**Week View (주간 타임라인)**
- 현재 주 5일간 이벤트를 시간대별(새벽/낮/밤) 표시
- KST (한국 표준시) 기준 타임라인
- 이벤트 클릭 시 Polymarket 시장 페이지로 이동

**Calendar Overview (월간 개요)**
- 향후 3주간 주요 이벤트 미리보기
- 날짜별 상위 3개 이벤트 표시
- 무한 스크롤 지원 (lazy loading)

**필터링 시스템**
- 카테고리: Politics, Crypto, Sports, Pop Culture 등
- 태그: 세부 주제별 필터링 (검색 가능)
- 거래량: 최소 $1K ~ $1M
- 유동성: 최소 유동성 기준
- 시간 범위: 1일 / 7일 / 30일 / 전체

**기술 구현**
- 점진적 로딩: 초기 5일치만 로드 → 스크롤 시 추가 로드
- localStorage 캐싱: 5분 TTL + `cache_meta` 테이블 기반 무효화
- 필드 최적화: 필요한 9개 필드만 전송 (전송량 60% 감소)
- `image_url` 기반 자동 그룹핑 (중복 시장 79% 감소)

### 2. 99% 마켓 (`/99market`)

확률 90% 이상인 시장을 모아 단기 확정 수익 기회를 보여줍니다.

**주요 기능**
- 최소 확률 필터: 90%+ / 95%+ / 99%+
- 정렬: 연환산 수익률순 / 수익률순 / 마감순 / 거래량순
- 카테고리별 필터링
- 10초 간격 자동 갱신 (LIVE)

**카드 정보 표시**
- 현재 확률 (YES/NO)
- 예상 수익률 및 연환산 수익률
- 마감까지 남은 시간
- 거래량 및 유동성

**기술 구현**
- Gamma API (Polymarket CLOB) 실시간 데이터 조회
- 자동 갱신 간격: 10초 (탭 전환 시 자동 시작/중지)
- Vercel rewrites를 통한 CORS 프록시 (`/api/gamma/`)

### 3. 한국 시장 (`/komarket`)

한국 관련 키워드가 포함된 예측 시장만 필터링하여 보여줍니다.

**주요 기능**
- 정렬: 종료일순 / 거래량순 / 확률순
- 카테고리별 필터링
- 한국어 번역된 제목 우선 표시

**기술 구현**
- 서버 사이드 필터링: Supabase `or()` 쿼리로 키워드 매칭
- 키워드: Korea, Korean, South Korea, Seoul, Busan, Samsung, Hyundai 등
- 짧은 키워드 오탐 방지 로직 포함

### 4. 공통 기능

**사용자 설정**
- 테마: Dark / Light 모드
- 밀도: Comfortable / Compact / Spacious
- 언어: 한국어 / English 토글

**관리자 기능**
- V1 (별도 페이지 `/admin/`): 테이블 + 필터 + 페이지네이션
- V2 (캘린더 통합): 우측 상단 자물쇠 아이콘 → 인라인 편집
- 시장 숨김/노출 토글 (soft delete)
- 번역 수동 편집 (title_ko, description_ko)
- 카테고리 재분류
- 수정 시 전체 유저 캐시 자동 무효화

---

## 기술 스택

| 분류 | 기술 |
|------|------|
| Frontend | TypeScript + Vite (Vanilla, 프레임워크 없음) |
| Database | Supabase (PostgreSQL) |
| ETL | Python (Polymarket API → Supabase) |
| Translation | OpenAI gpt-4o-mini + 후처리 파이프라인 |
| Hosting | Vercel |
| CI/CD | GitHub Actions (4시간마다 ETL 자동 실행) |

---

## 프로젝트 구조

```
├── index.html              # 메인 HTML (SPA)
├── style.css               # 전체 스타일
├── vite.config.ts          # Vite 빌드 설정
├── vercel.json             # Vercel 배포 + rewrites (SPA 라우팅, CORS 프록시)
├── tsconfig.json           # TypeScript 설정
├── package.json            # 의존성 (Vite, Supabase SDK, TypeScript)
│
├── src/                    # TypeScript 소스
│   ├── main.ts             # 앱 진입점 + URL 라우팅 + 탭 전환
│   ├── data.ts             # 데이터 로딩 (Supabase, Gamma API)
│   ├── state.ts            # 중앙 상태 관리
│   ├── types.ts            # 타입 정의
│   ├── filters.ts          # 필터링 로직
│   ├── i18n.ts             # 다국어 (한/영)
│   ├── theme.ts            # 테마 + 밀도 토글
│   ├── utils.ts            # KST 변환, 날짜 유틸
│   ├── config.ts           # Supabase 설정
│   ├── constants.ts        # 상수 (카테고리, 키워드 등)
│   ├── supabase.ts         # Supabase 클라이언트 초기화
│   ├── auth.ts             # 관리자 인증
│   ├── admin.ts            # V2 관리자 기능
│   └── render/             # 렌더링 모듈
│       ├── index.ts        # 캘린더 렌더링 진입점
│       ├── weekView.ts     # 주간 타임라인
│       ├── calendarView.ts # 월간 캘린더 개요
│       ├── sureBetView.ts  # 99% 마켓 뷰
│       ├── koreaView.ts    # 한국 시장 뷰
│       ├── modal.ts        # 이벤트 상세 모달
│       └── tooltip.ts      # 툴팁
│
├── admin/                  # V1 관리자 대시보드 (별도 페이지)
│   ├── index.html
│   ├── admin.js
│   └── admin.css
│
├── etl/                    # ETL + 번역 파이프라인
│   ├── main.py             # Polymarket API → Supabase 동기화
│   ├── translate.py        # 한글 번역 (OpenAI)
│   ├── postprocess.py      # 번역 후처리
│   ├── translation_prompt.md # 번역 규칙
│   ├── requirements.txt    # Python 의존성
│   ├── schema.sql          # DB 스키마
│   └── README.md           # ETL 문서
│
├── .github/workflows/      # GitHub Actions (ETL 자동 실행)
├── .claude/                # Claude Code 에이전트, 커맨드, 스킬
├── CLAUDE.md               # Claude Code 프로젝트 설정
├── SYSTEM_OVERVIEW.md      # 상세 아키텍처 + 수정 내역
├── AGENT_GUIDELINES.md     # AI 에이전트 행동 수칙
└── CHANGELOG.md            # 변경 이력
```

---

## 아키텍처

### 데이터 흐름

```
Polymarket API
  ↓ (4시간마다 자동 - GitHub Actions + etl/main.py)
Supabase: poly_events 테이블
  ↓ (번역 - etl/translate.py + OpenAI)
title_ko, description_ko 컬럼 업데이트
  ↓ (웹 앱 로드)
src/data.ts → Supabase 쿼리 + Gamma API
  ↓ (렌더링)
캘린더 / 99% 마켓 / 한국 시장
```

### URL 라우팅

```
vercel.json rewrites:
  /99market  → /index.html
  /komarket  → /index.html
  /api/gamma → https://gamma-api.polymarket.com (CORS 프록시)

src/main.ts:
  URL path → PageTab 매핑 (history.pushState + popstate)
  /         → calendar 탭
  /99market → surebet 탭
  /komarket → korea 탭
```

### 캐싱 전략

```
localStorage (5분 TTL)
  ↓ 만료 또는 cache_meta.last_updated > 캐시 시간
Supabase 재조회
  ↓ 결과 캐싱
localStorage 갱신
```

---

## 로컬 개발

```bash
# 의존성 설치
npm install

# 개발 서버 (http://localhost:5173)
npm run dev

# 빌드
npm run build

# 빌드 미리보기
npm run preview
```

### 환경 설정

Supabase 연결 정보는 `src/config.ts`에서 관리합니다.

---

## 데이터베이스

### `poly_events` 테이블

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | text | 시장 고유 ID (PK) |
| `title` | text | 시장 제목 (영문) |
| `title_ko` | text | 시장 제목 (한글 번역) |
| `slug` | text | URL slug |
| `event_slug` | text | 이벤트 그룹 slug (URL 생성용) |
| `end_date` | timestamptz | 종료 시간 (UTC) |
| `volume` | numeric | 총 거래량 ($) |
| `volume_24hr` | numeric | 24시간 거래량 ($) |
| `probs` | jsonb | 확률 배열 |
| `outcomes` | jsonb | 결과 옵션 |
| `category` | text | 카테고리 |
| `tags` | text[] | 태그 배열 |
| `image_url` | text | 이미지 URL (그룹핑 키) |
| `hidden` | boolean | 관리자 숨김 (default: false) |
| `description` | text | 시장 규칙 (영문) |
| `description_ko` | text | 시장 규칙 (한글) |

### `cache_meta` 테이블

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | integer | PK (항상 1) |
| `last_updated` | timestamptz | 관리자 최종 수정 시간 |

---

## 배포

```bash
# 1. Git push
git push origin master

# 2. Vercel 수동 프로덕션 배포 (필수 — 자동 감지 안 됨)
vercel --prod
```

---

## 추가 문서

- [SYSTEM_OVERVIEW.md](./SYSTEM_OVERVIEW.md) — 상세 아키텍처 + 수정 내역
- [AGENT_GUIDELINES.md](./AGENT_GUIDELINES.md) — AI 에이전트 행동 수칙
- [CLAUDE.md](./CLAUDE.md) — Claude Code 프로젝트 설정
- [etl/README.md](./etl/README.md) — ETL 파이프라인 문서
- [CHANGELOG.md](./CHANGELOG.md) — 변경 이력

---

**Made by Coblin**
