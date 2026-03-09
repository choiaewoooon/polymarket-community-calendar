# CLAUDE.md — 프로젝트 마스터 설정

이 파일은 Claude Code가 이 프로젝트에서 작업할 때 참조하는 핵심 설정입니다.

---

## 프로젝트 개요

**폴리마켓 커뮤니티 캘린더** — Polymarket 예측 시장 데이터를 캘린더/타임라인 형식으로 시각화하는 웹 앱

### 기술 스택

| 분류 | 기술 |
|------|------|
| **Frontend** | TypeScript + Vite (Vanilla, 프레임워크 없음) |
| **Database** | Supabase (PostgreSQL) |
| **ETL** | Python (Polymarket API → Supabase) |
| **Translation** | OpenAI gpt-4o-mini + 후처리 파이프라인 |
| **Hosting** | Vercel |
| **CI/CD** | GitHub Actions |

### 핵심 디렉토리

```
src/            # TypeScript 소스 (main.ts, data.ts, filters.ts, render/ 등)
admin/          # V1 관리자 대시보드
etl/            # Python ETL + 번역 파이프라인
.claude/        # Claude Code 에이전트, 커맨드, 스킬
.github/        # GitHub Actions 워크플로우
```

---

## 작업 규칙

### 1. 언어

- 사용자와의 대화, 코드 주석, 문서: **한국어**
- 코드 변수명/함수명: **영어**

### 2. 문서 업데이트

| 문서 | 업데이트 시점 |
|------|-------------|
| `SYSTEM_OVERVIEW.md` | 아키텍처 변경, 주요 버그 수정, 새 기능 구현 시 |
| `AGENT_GUIDELINES.md` | 에이전트 행동 수칙 변경 시 |
| `CHANGELOG.md` | 모든 의미 있는 변경 시 |

### 3. 보안

- `.env`, API 키, 개인키는 절대 하드코딩 금지
- 모든 비밀 값은 환경 변수로만 접근
- 커밋 전 민감 정보 포함 여부 반드시 확인

### 4. 데이터 규칙

- 모든 시간은 **KST (Asia/Seoul)** 기준 표시
- Polymarket 데이터: `poly_events` 테이블
- 캐시: localStorage 5분 TTL + `cache_meta` 무효화

### 5. 브랜치 전략

- `master`: 프로덕션 (직접 푸시 금지)
- `feature/*`: 새 기능
- `fix/*`: 버그 수정
- `content/*`: 콘텐츠/문서 변경

### 6. 배포 (필수 — 반드시 수행)

> **⚠️ MANDATORY: 코드 변경 후 사용자가 배포/업데이트를 요청하면 아래 두 단계를 반드시 모두 실행할 것. Vercel은 git push를 자동 감지하지 못하므로 수동 트리거가 필수.**

```bash
# Step 1: Git 푸시
git push origin master

# Step 2: Vercel 수동 프로덕션 배포 (반드시 실행)
vercel --prod
```

- `vercel --prod`를 빠뜨리면 **배포가 되지 않는다**
- 배포 완료 후 출력되는 `Aliased:` URL을 사용자에게 전달할 것
- 프로덕션 URL: https://polymarket-calender.vercel.app

---

## 에이전트 시스템

### 서브 에이전트 (.claude/agents/)

| 에이전트 | 역할 |
|----------|------|
| `translator` | 번역 품질 관리 + 피드백 학습 |
| `etl-runner` | ETL 파이프라인 실행 및 모니터링 |
| `web-manager` | 프론트엔드 개발 및 유지보수 |

### 슬래시 커맨드 (.claude/commands/)

| 커맨드 | 기능 |
|--------|------|
| `/translate` | 번역 파이프라인 실행 |
| `/etl` | ETL 데이터 수집 실행 |
| `/finish-work` | 커밋 전 보안 스캔 + PR 생성 |

---

## 참조 문서

- `SYSTEM_OVERVIEW.md` — 상세 아키텍처 및 수정 내역
- `AGENT_GUIDELINES.md` — AI 에이전트 행동 수칙
- `etl/translation_prompt.md` — 번역 프롬프트 규칙
- `etl/README.md` — ETL 파이프라인 문서
