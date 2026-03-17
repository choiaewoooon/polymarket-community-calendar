# 개발자 핸드오프 문서

> 작성일: 2026-03-13
> 프로덕션: https://polymarket-calender.vercel.app
> 목적: 아래 3개 기능을 기존 커뮤니티에 통합하기 위한 참고 자료

---

## 프로젝트 개요

Polymarket 예측 시장 데이터를 캘린더/타임라인 형식으로 시각화하는 웹 앱.
**Vanilla TypeScript + Vite** (프레임워크 없음), **Supabase** DB, **Vercel** 배포.

---

## 전달 대상 기능 3가지

### 1. 캘린더 뷰 (`/`)

| 항목 | 내용 |
|------|------|
| **핵심 파일** | `src/render/weekView.ts`, `src/render/calendarView.ts` |
| **URL** | `/` (루트) |
| **설명** | 5일 주간 타임라인 + 3주 캘린더 오버뷰 |

**주요 특징:**
- 5일 주간 뷰: 새벽(00-06), 낮(06-18), 밤(18-24) 시간대별 그룹핑
- 3주 캘린더 오버뷰: 일별 Top 3 이벤트 (거래량순) + "+N more" 표시
- 모든 시간 KST (Asia/Seoul) 기준
- `image_url` 기반 마켓 그룹핑으로 79% 중복 제거
- Lazy loading: "다음 주" 버튼으로 추가 데이터 로드

**데이터 흐름:**
```
Supabase poly_events → localStorage 캐시 (5분 TTL) → groupSimilarMarkets() → 렌더링
```

---

### 2. 99% 마켓 (`/99market`)

| 항목 | 내용 |
|------|------|
| **핵심 파일** | `src/render/sureBetView.ts` |
| **URL** | `/99market` |
| **설명** | 90%+ 확률 마켓의 수익률 계산 + 실시간 카운트다운 |

**주요 특징:**
- 수익률 계산: `단순수익률 = ((1 - prob) / prob) * 100`, `연환산(APY) = 단순수익률 * (365 / 남은일수)`
- 안전도 3단계: 높음(거래량≥$1M+유동성≥$50K), 보통, 낮음
- Bid/Ask 스프레드 표시 (tight/mid/wide 색상 구분)
- 실시간 카운트다운 (1초마다 업데이트)
- **10초마다 Gamma API 자동 갱신** (탭 활성 시)
- 정렬: APY(기본) / 단순수익률 / 마감일 / 거래량
- 필터: 90%+ / 95%+ / 99%+

**데이터 소스:**
```
Gamma API (/api/gamma/markets) → Vercel CORS 프록시 → 클라이언트 필터링
```
- Vercel 프록시: `vercel.json`의 rewrite로 `gamma-api.polymarket.com` 우회
- 폴백: Supabase (API 실패 시)

---

### 3. 한국 예측 모아보기 (`/komarket`)

| 항목 | 내용 |
|------|------|
| **핵심 파일** | `src/render/koreaView.ts`, `src/data.ts` (372-552행) |
| **URL** | `/komarket` |
| **설명** | 한국 관련 마켓 큐레이션 뷰 |

**주요 특징:**
- 서버사이드 필터: `is_korea = true` (ETL에서 플래그 설정)
- 클라이언트 폴백: 키워드 매칭 (지역/정치인/기업/K-POP/스포츠 등)
- 한국어 제목 우선 표시 (`title_ko` → `title` 폴백)
- 카테고리 칩 필터 (빈도순 정렬)
- 정렬: 마감일(기본) / 거래량 / 확률
- Sports 카테고리 기본 제외

**한국 키워드 목록 (일부):**
- 지명: Korea, Seoul, Busan, Jeju, Incheon...
- 인물: Yoon Suk-yeol, Lee Jae-myung, Kim Jong-un...
- 기업: Samsung, Hyundai, SK, Kakao, Naver, KOSPI, KRW...
- 문화: BTS, BLACKPINK, NewJeans, AESPA, Squid Game, K-drama...
- 기타: KBO, K League, Kimchi premium...

---

## 공통 아키텍처

### 라우팅 (`src/main.ts`)
```typescript
const ROUTE_MAP = {
  '/99market': 'surebet',
  '/komarket': 'korea',
  '/live': 'live',
  // default: 'calendar'
};
```
- `history.pushState` 기반 SPA 라우팅
- `popstate` 이벤트로 뒤로가기/앞으로가기 지원
- Vercel rewrite로 직접 URL 접근 지원

### 상태 관리 (`src/state.ts`)
- 전역 변수 + setter 함수 패턴 (프레임워크 없음)
- 각 탭별 독립 상태: `allEvents[]`, `sureBetEvents[]`, `koreaEvents[]`
- 정렬/필터 상태도 개별 관리

### 데이터 타입 (`src/types.ts`)
```typescript
interface PolyEvent {
  id: string;
  title: string;
  title_ko?: string;       // 한국어 번역
  slug: string;
  event_slug: string;       // 그룹 이벤트 URL (우선)
  end_date: string;          // UTC ISO
  volume: number;
  volume_24hr?: number;
  probs: number[];           // [yesProb, noProb]
  category: string;
  closed?: boolean;
  image_url?: string;
  tags?: string[];
  hidden?: boolean;
  liquidity?: number;
  _totalVolume?: number;     // 그룹 합산
  _groupSize?: number;       // 그룹 내 마켓 수
}
```

### Supabase 테이블: `poly_events`

| 컬럼 | 타입 | 용도 |
|------|------|------|
| `id` | text PK | 마켓 고유 ID |
| `title` | text | 영문 제목 |
| `title_ko` | text | 한국어 번역 |
| `slug` | text | 개별 마켓 슬러그 |
| `event_slug` | text | 그룹 이벤트 슬러그 (URL용) |
| `end_date` | timestamptz | 마감일 (UTC) |
| `volume` | numeric | 총 거래량 |
| `volume_24hr` | numeric | 24시간 거래량 |
| `probs` | jsonb | 확률 배열 |
| `category` | text | 카테고리 |
| `tags` | text[] | 태그 배열 |
| `closed` | boolean | 마켓 종료 여부 |
| `hidden` | boolean | 관리자 숨김 |
| `image_url` | text | 이벤트 이미지 (그룹핑 키) |
| `is_korea` | boolean | 한국 관련 플래그 |
| `description` | text | 마켓 규칙 (EN) |
| `description_ko` | text | 마켓 규칙 (KO) |
| `liquidity` | numeric | 유동성 |

### 캐싱 전략
- localStorage: 5분 TTL
- `cache_meta` 테이블: 관리자가 마켓 수정 시 `last_updated` 갱신 → 클라이언트 캐시 무효화
- SWR 패턴: 캐시 데이터로 먼저 렌더 → 백그라운드에서 최신 데이터 fetch → 변경 시 리렌더

### 외부 API 의존성

| API | 용도 | 접근 방법 |
|-----|------|-----------|
| Supabase | 메인 DB | `@supabase/supabase-js` |
| Gamma API | 99% 마켓 실시간 데이터 | Vercel rewrite 프록시 |
| Polymarket | 마켓 링크 | `polymarket.com/event/{event_slug}` |

### 디자인 시스템: OBSIDIAN TERMINAL

| 토큰 | 다크 모드 | 라이트 모드 |
|------|-----------|-------------|
| `--bg-primary` | `#09090b` | `#f5f5f7` |
| `--bg-secondary` | `#0f0f12` | `#ffffff` |
| `--text-primary` | `#ededf0` | `#0f0f12` |
| `--accent-blue` | `#6366f1` | `#4f46e5` |
| `--accent-green` | `#22c55e` | `#22c55e` |
| `--accent-red` | `#ef4444` | `#ef4444` |

- 폰트: Outfit (제목), DM Sans (본문), DM Mono (숫자)
- 테마 토글: `<html data-theme="dark|light">`
- 밀도 토글: comfortable / compact / spacious

---

## 파일 구조 (핵심)

```
├── index.html              # SPA HTML (모든 탭 섹션 포함)
├── style.css               # 전체 스타일 (OBSIDIAN TERMINAL 테마)
├── vercel.json             # 배포 설정 + CORS 프록시 + SPA rewrite
├── vite.config.ts          # Vite 빌드 설정
├── package.json            # 의존성
├── tsconfig.json           # TypeScript 설정
├── src/
│   ├── main.ts             # 진입점 + 라우팅 + 이벤트 바인딩
│   ├── data.ts             # 데이터 로딩 + 캐싱 + 그룹핑
│   ├── filters.ts          # 필터 로직
│   ├── state.ts            # 전역 상태 관리
│   ├── types.ts            # TypeScript 타입 정의
│   ├── config.ts           # Supabase 연결 설정
│   ├── supabase.ts         # Supabase 클라이언트 초기화
│   ├── constants.ts        # 상수 정의
│   ├── i18n.ts             # 한/영 전환
│   ├── theme.ts            # 테마/밀도 토글
│   ├── utils.ts            # 유틸리티 함수
│   ├── auth.ts             # 관리자 인증
│   └── render/
│       ├── index.ts        # 렌더 오케스트레이터
│       ├── calendarView.ts # 캘린더 3주 오버뷰
│       ├── weekView.ts     # 5일 주간 타임라인
│       ├── sureBetView.ts  # 99% 마켓 뷰
│       ├── koreaView.ts    # 한국 예측 뷰
│       ├── modal.ts        # 상세 모달 + URL 처리
│       └── tooltip.ts      # 호버 툴팁
└── docs/
    └── market-typology-report.md  # 마켓 유형화 분석 (향후 데이터 연결용)
```

---

## 통합 시 참고사항

1. **환경 변수 필요**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
2. **Vercel rewrite 필수**: Gamma API CORS 프록시 (`/api/gamma/*`)
3. **SPA rewrite 필수**: `/99market`, `/komarket` → `/index.html`
4. **Supabase RLS**: `hidden = false` 필터가 anon role에 적용됨
5. **시간대**: 모든 표시 시간은 KST, 내부 비교는 UTC
6. **마켓 그룹핑**: `image_url + end_date` 조합이 그룹 키
7. **Gamma API 자동 갱신**: 99% 마켓 탭 활성 시 10초 간격, 탭 이탈 시 중지

---

## 향후 확장: 실시간 데이터 연결

`docs/market-typology-report.md` 참조.
- 크립토 Up/Down → Chainlink/Binance 실시간 가격
- 서울 기온 → Weather Underground (RKSI 관측소)
- 주가/원자재 → Yahoo Finance
- Fed 금리 → FRED API

---

*이 문서와 함께 전체 소스코드가 ZIP으로 포함되어 있습니다.*
