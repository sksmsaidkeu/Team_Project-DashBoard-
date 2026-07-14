# 팀 셋업 가이드 (common 브랜치)

이 문서는 `common` 브랜치(공통 셸 + 메인 탭)를 로컬에서 실제로 동작시키기 위해 필요한 절차를 정리한 것입니다. 코드는 이미 완성되어 있고, **Supabase 프로젝트에 실제 데이터가 채워져야** 화면에 값이 보입니다.

## 0. 왜 이 절차가 필요한가

이 앱은 브라우저에서 항상 **Supabase만** 조회합니다(원티드 API는 로컬 스크립트가 미리 가져와 Supabase에 옮겨두는 용도). 즉:
- Supabase 프로젝트에 테이블(스키마)이 없으면 → 화면에 "데이터 없음" 안내만 뜸
- 테이블은 있어도 데이터가 안 채워져 있으면 → 역시 "데이터 없음" 안내만 뜸

아래 절차를 **Supabase 프로젝트 대시보드에 접근 권한이 있는 사람**이 한 번 진행해야 합니다.

## 1. Supabase 프로젝트 준비 (프로젝트 소유자만 가능)

### 1-1. 마이그레이션 3개를 순서대로 적용

Supabase 대시보드 → SQL Editor에서, `supabase/migrations/` 폴더의 아래 파일들을 **이 순서 그대로** 열어 내용을 전체 복사 → 붙여넣기 → 실행합니다.

1. `20260713120000_initial_schema.sql` — 테이블 전체 (DB.md 3장)
2. `20260713130000_rls_policies.sql` — RLS 보안 정책
3. `20260714000000_wanted_job_trend_snapshot.sql` — 원티드 실시간 트렌드 테이블

(Supabase CLI가 연결되어 있다면 `supabase db push`로도 동일하게 적용 가능합니다.)

### 1-2. 이메일 컨펌(Email Confirmations) 끄기 — 필수

Supabase 대시보드 → Authentication → Providers → Email → **"Confirm email" 옵션을 끕니다.**

> PRD 2장: "이메일 인증을 요구하지 않는다 — 가입 완료 즉시 계정이 활성화된다." 이 옵션이 켜져 있으면 `supabase.auth.signUp()` 직후 세션이 발급되지 않아, 회원가입 후 바로 로그인되지 않고 화면이 멈춘 것처럼 보입니다(코드 문제가 아니라 이 설정 문제입니다).

### 1-3. `service_role` 키 확보

Supabase 대시보드 → Project Settings → API → **service_role** 키를 복사해둡니다.

> ⚠️ **이 키는 RLS를 완전히 우회하는 관리자 키입니다.** 절대 커밋하거나 브라우저 코드(`js/config.js`)에 넣지 마세요. 로컬 `.env`에만 두고, 아래 시드 스크립트를 실행하는 사람의 컴퓨터에만 존재해야 합니다.

## 2. 로컬 환경 설정 (모든 팀원 공통)

### 2-1. `.env` 채우기

프로젝트 루트에 `.env.example`을 참고해 `.env` 파일을 만들고 아래 값을 채웁니다.

| 변수 | 용도 | 어디서 구하나 |
|---|---|---|
| `client_id` / `client_secret` | 원티드 OpenAPI 인증 | 원티드 API 계약 담당자 또는 발급 콘솔 |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | 브라우저에서 쓰는 공개 연결 정보 | Supabase 대시보드 > Project Settings > API |
| `SUPABASE_SERVICE_ROLE_KEY` | **로컬 시드 스크립트 전용** (선택 — 데이터를 직접 채울 사람만) | 위 1-2 참고 |
| `NEWS_API_KEY` | 채용 뉴스 실 API 연동(선택, 없으면 정적 뉴스로 폴백) | GNews.io 등 |

`.env`는 `.gitignore`에 등록되어 있어 커밋되지 않습니다 — 각자 로컬에 개별로 채워야 합니다.

### 2-2. `js/config.js` 생성

```bash
python scripts/generate_config.py
```

`.env`의 `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`NEWS_API_KEY`를 읽어 브라우저가 실제로 쓰는 `js/config.js`를 만들어줍니다(이 파일도 `.gitignore` 대상 — 저장소가 public이라 실제 키를 커밋 이력에 남기지 않기 위함). `.env` 값이 비어 있으면 기존 플레이스홀더를 그대로 두고 경고만 출력합니다.

## 3. 데이터 채우기 (service_role 키가 있는 사람만)

```bash
python scripts/seed_categories.py       # 원티드 /tags/categories -> categories 테이블 (직군/직무)
python scripts/fetch_wanted_trend.py    # 원티드 /jobs 실공고 1000건 집계 -> wanted_job_trend_snapshot 테이블
```

`SUPABASE_SERVICE_ROLE_KEY`가 `.env`에 없으면 두 스크립트 모두 **dry-run**(콘솔에 미리보기만 출력, Supabase에 실제로 쓰지 않음)으로 안전하게 동작합니다. 채워져 있으면 실제로 Supabase에 upsert합니다.

## 4. 로컬에서 실행/확인

**`index.html`을 더블클릭해서 열지 마세요.** `type="module"` 스크립트가 `file://`에서는 브라우저 CORS 정책으로 차단되어 아무 기능도 동작하지 않습니다(열면 빨간 경고 배너가 뜹니다).

```bash
python -m http.server 8000
# 브라우저에서 http://localhost:8000/index.html 접속
```

## 5. 체크리스트

- [ ] Supabase 대시보드 SQL Editor에서 마이그레이션 3개 순서대로 적용
- [ ] Supabase 대시보드에서 이메일 컨펌(Confirm email) 끄기
- [ ] `.env`에 원티드/Supabase 값 채우기
- [ ] `python scripts/generate_config.py` 실행 → `js/config.js` 생성 확인
- [ ] (데이터 채울 사람만) `SUPABASE_SERVICE_ROLE_KEY` 채우고 시드 스크립트 2개 실행
- [ ] 로컬 서버로 `index.html` 접속해 메인 탭에 실제 데이터가 보이는지 확인
