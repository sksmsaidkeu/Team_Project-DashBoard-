# DESIGN.md — 디자인 시스템 가이드

> 이 문서는 [`PRD.md`](./PRD.md)(요구사항), [`README.md`](./README.md)(기술 개요), [`DB.md`](./DB.md)(데이터 모델)를 기반으로 작성된 프론트엔드 디자인 가이드다. 구현은 프레임워크 없이 순수 HTML/CSS/JavaScript SPA로 이루어지며, 모든 DB 접근은 `@supabase/supabase-js` 클라이언트를 통해서만 이루어진다(README 참고). 이 문서는 화면(마크업)이 아니라 **디자인 토큰과 컴포넌트 스타일 규칙**을 정의하는 문서다.

## 0. 서비스 구조 요약 (PRD 6장 IA 기준)

| 화면 | 대상 | 핵심 기능 |
|---|---|---|
| 메인 | 통합(기업+구직자) | 통합 검색, 추천 하이라이트 |
| Tab1 | 기업(`COMPANY`) | 인재 검색, 공고 관리, 지원자 관리 |
| Tab2 | 구직자(`JOBSEEKER`) | 공고 열람, 기업 정보, 지원 현황 |

모든 화면은 PRD 3장의 카테고리 체계(`INDUSTRY`/`JOB`/`SKILL`/`REGION`/`EMPLOYMENT_TYPE`)와 5장의 매칭 스코어링(스킬 40%·직무 25%·지역·연봉 15%·활동성 10%·최신성 10%)을 공통 기반으로 사용한다. 이 디자인 시스템은 이 매칭 스코어를 화면 전반에서 **시각적으로 일관되게 표현하는 것**을 최우선 목표로 둔다(6장 시그니처 요소 참고).

---

## 1. 디자인 원칙

채용 플랫폼은 본질적으로 "신뢰"를 파는 서비스다 — 기업은 검증되지 않은 후보를 걸러야 하고, 구직자는 이력서와 커리어라는 개인적 자산을 맡긴다. 그러나 기존 채용 플랫폼 다수가 신뢰를 딱딱한 네이비/그레이 톤으로만 표현해 온 결과, 채용이라는 행위 자체가 가진 설렘(새로운 기회, 합격 소식, 좋은 인연)은 잘 드러나지 않았다. 이 프로젝트는 `#FF6B9D`를 배경·버튼·강조 요소 전반에 적극적으로 사용해 "생동감"을 브랜드 정체성의 축으로 삼되, 신뢰는 색상이 아니라 **구조**로 확보한다 — 즉 본문 텍스트·데이터·카테고리 정보는 항상 `--ink`(#1A1523)의 고대비 조합으로 고정하고, 핑크는 배경 면적·버튼·매칭 시각화 등 "감정을 전달하는 레이어"에 집중 배치한다. 아래 2장의 대비(contrast) 계산에서 드러나듯 흰 텍스트를 `--pink-primary` 위에 그대로 올리면 WCAG AA 기준을 만족하지 못하므로(2.68:1), 이 원칙에 따라 핑크는 "면"으로 넓게 쓰고 그 위의 글자는 항상 `--ink` 또는 검증된 진한 파생색을 쓴다. 이렇게 하면 핑크를 아끼지 않고도 가독성과 신뢰감을 잃지 않는다.

### 1.1 톤 & 콘텐츠 원칙 (공통 / 기업 / 구직자 분리)

톤은 화면이 속한 영역(0장 IA)에 따라 분리한다. 색·라운딩·카드/배지 패턴 같은 시각 언어는 세 영역이 하나의 시스템을 공유하지만, 문장 말투는 기업 사용자(업무 도구를 쓰는 사람)와 구직자(개인적 여정을 겪는 사람)의 맥락이 다르므로 같은 톤을 강요하지 않는다.

- **공통 콘텐츠 원칙** (메인, 그리고 기업/구직자 화면 모두에 적용)
  - 통계·수치는 값만 던지지 않고 항상 비교/맥락 문구를 함께 준다. 예: "지원자 32명 · 전월 대비 +8%p", "매칭 스코어 평균 76점 · 지난주 대비 +4". 5.6절 통계 카드가 이 원칙을 구조화한 컴포넌트다.
  - 합격/불합격, 공고 마감처럼 결과가 갈리는 정보는 색상 단독으로 과하게 강조하지 않는다. 배경색(2.1절 `--accent-cool`/`--negative`)에 반드시 텍스트 라벨 또는 아이콘을 병기한다(7.2절 접근성 체크리스트와 동일한 원칙의 콘텐츠 버전).
  - 목업/예시 데이터는 실제 서비스처럼 보이는 현실적인 값(회사명, 직무명, 날짜, 연봉 범위)을 쓴다. "Lorem ipsum" 류의 플레이스홀더 텍스트는 지양한다.
  - 메인 페이지는 기업/구직자 어느 쪽 톤에도 치우치지 않는 중립적 안내 문구를 쓴다(예: "카테고리 기반으로, 꼭 맞는 채용을 찾다").
- **구직자(Tab2) 전용 톤**: 존칭체(-요/-님)와 짧은 격려 문구를 대시보드·알림류 카피에 사용한다. 예: "OO님, 이번 주도 응원해요", "서류 통과 3건 — 좋은 흐름이에요". 단, 지원 현황 같은 사실 정보 자체를 왜곡하거나 과장하지 않는 선에서만 격려를 덧붙인다.
  - 이 톤은 5.4절 "대시보드 인사 배너" 컴포넌트의 기본 카피 스타일이다.
- **기업(Tab1) 전용 톤**: 인재 검색·공고 관리·지원자 관리는 업무 도구이므로 격려체 대신 담백한 사무 존댓말을 쓴다. 예: "OO님, 이번 주 지원자 현황입니다" (구직자 톤인 "이번 주도 화이팅이에요!" 같은 감탄사·이모지는 쓰지 않는다). 수치와 상태를 명료하게 전달하는 데 집중한다.

---

## 2. 컬러 시스템

### 2.1 베이스 토큰

| 변수명 | HEX | 용도 | 사용 강도 |
|---|---|---|---|
| `--pink-primary` | `#FF6B9D` | 핵심 브랜드 컬러. Primary 버튼 배경, 탭 활성 인디케이터, 링크 언더라인, 매칭 스코어 링, 히어로 배경 그라데이션 | 매우 높음 (전면 사용) |
| `--ink` | `#1A1523` | 본문 텍스트, 헤딩, 아이콘 기본색, 다크 표면(footer 등) | 높음 |
| `--paper` | `#FFF9FA` | 기본 배경(페이지/카드 바탕) | 매우 높음 (기본값) |
| `--muted` | `#8C8494` | 보조 텍스트(placeholder, 큰 사이즈 캡션, 비활성 라벨) | 중간 |
| `--accent-cool` | `#4ECDC4` | 매칭 성사·합격·지원 완료 등 긍정 아웃컴 신호 전용. 버튼/배지 배경에는 쓰지 않고 상태 표시에만 한정(부정 아웃컴은 `--negative` 참고) | 낮음 (의도적으로 희소하게) |
| `--negative` | `#E85C5C` | 불합격·지원 마감(반려)·에러 등 부정 아웃컴 신호 전용. `--accent-cool`과 대칭을 이루는 색으로, 배경 채움 + `--ink` 텍스트 조합으로만 사용(2.3절 참고). 공고 상태(DRAFT/POSTED/CLOSED) 같은 일반 콘텐츠 상태에는 쓰지 않는다 — 그런 상태는 무채색 계열 뱃지로 표현해 이 색의 희소성을 지킨다 | 낮음 (accent-cool과 대칭, 의도적으로 희소하게) |
| `--line` | `#F0DCE3` | 카드 테두리, 구분선(장식용) | 중간 |

### 2.2 파생 컬러(팔레트 확장)

파생색은 두 가지 방식으로만 만든다: **tint = 원색과 흰색(#FFFFFF)을 섞음**, **shade = 원색과 검정(#000000)을 섞음**. 혼합 비율은 `new = base × (1 − ratio) + target × ratio`(흰색 혼합) 또는 `new = base × (1 − ratio)`(검정 혼합, 검정 채널이 0이므로)로 계산했다. 모든 값은 실제 RGB 채널 연산 후 반올림한 HEX다.

```css
:root {
  /* Pink — brand core */
  --pink-primary:   #FF6B9D; /* base(500) */
  --pink-hover:      #D95B85; /* -15% black, hover(600) */
  --pink-active:     #B34B6E; /* -30% black, active/pressed(700). AA-safe 텍스트 컬러로도 재사용 */
  --pink-tint-50:    #FFE9F0; /* +85% white, 섹션 배경 wash(50) */
  --pink-tint-100:   #FF89B1; /* +20% white, ghost 버튼 hover 배경(200) */
  --pink-tint-200:   #FFA6C4; /* +40% white, 배지/비활성 배경(100) */

  /* Ink — text & dark surfaces */
  --ink:            #1A1523; /* base(900) */
  --ink-soft:       #6E6777; /* +30% white, 보조 헤딩/아이콘(700) */

  /* Paper — surfaces */
  --paper:          #FFF9FA; /* base */
  --paper-dim:      #FDEFF2; /* -1% paper, +핑크 wash 3% 혼합, 섹션 alt 배경 */

  /* Muted — secondary text */
  --muted:          #8C8494; /* base. 큰 텍스트/아이콘/placeholder 전용 (2.2.1 대비 표 참고) */
  --muted-strong:   #706A76; /* -20% black. 본문 크기 캡션 등 AA 필요한 자리에 사용 */

  /* Accent-cool — positive outcome signal only */
  --accent-cool:        #4ECDC4; /* base */
  --accent-cool-strong: #3EA49D; /* -20% black, hover/눌림 상태 */
  --accent-cool-tint-50: #E4F8F6; /* +85% white, 성공 배지 연한 배경(합격 등) */

  /* Negative — failure/rejection outcome signal only (accent-cool과 대칭) */
  --negative:        #E85C5C; /* base. 텍스트로 직접 쓰지 말 것(2.3절 참고) */
  --negative-strong: #A24040; /* -30% black, 본문 텍스트/아이콘/폼 에러 텍스트 전용 */
  --negative-tint-50: #FCE7E7; /* +85% white, 실패 배지 연한 배경 */

  /* Line — dividers & borders */
  --line:        #F0DCE3; /* base, 장식용 구분선/카드 테두리 전용 */
  --line-strong: #84797D; /* -45% black, 입력창 등 "기능적" 테두리(3:1 이상 필요한 자리) 전용 */

  /* Pipeline stage aliases — 신규 색상 없이 기존 pink 계열을 단계별로 재사용(5.7절 참고) */
  --stage-applied:   var(--pink-tint-200); /* 1단계: 지원완료 */
  --stage-review:    var(--pink-primary);  /* 2단계: 서류심사 */
  --stage-interview: var(--pink-hover);    /* 3단계: 면접 */
  --stage-result:    var(--pink-active);   /* 4단계: 최종결과(아웃컴 미확정 상태) */

  /* Disabled (semantic alias, 대비 요건 면제 대상) */
  --disabled-bg:   var(--pink-tint-200);
  --disabled-text: color-mix(in srgb, var(--ink) 55%, transparent);
}
```

> `--disabled-bg/--disabled-text`는 WCAG 1.4.3/1.4.11 예외 대상(비활성 컴포넌트)이라 대비 기준 검증 대상이 아니지만, 최소한의 시인성을 위해 `--ink`를 55% 불투명도로 낮춰 사용한다(순수 `--muted` 대비 살짝 더 진함).

### 2.3 접근성 대비(Contrast) 체크

아래 표는 실제 sRGB → 상대 휘도(relative luminance) → 대비비 공식(WCAG 2.x)으로 계산한 값이다. 기준: 일반 텍스트 **4.5:1**, 큰 텍스트(24px 이상 또는 19px 이상 Bold)·UI 컴포넌트 경계 **3:1**.

| 텍스트 색 | 배경 색 | 대비비 | 일반 텍스트 AA | 큰 텍스트/UI AA | 비고 |
|---|---|---|---|---|---|
| `--ink` (#1A1523) | `--paper` (#FFF9FA) | **17.17 : 1** | 통과 | 통과 | 기본 본문 조합, AAA도 충족 |
| `--ink` | `--pink-primary` (#FF6B9D) | **6.68 : 1** | 통과 | 통과 | **Primary 버튼 텍스트는 흰색이 아닌 `--ink` 사용** |
| `#FFFFFF`(흰색) | `--pink-primary` | 2.68 : 1 | **탈락** | **탈락** | 흰 텍스트를 그대로 올리면 큰 텍스트 기준(3:1)도 못 넘김 → 사용 금지 |
| `--pink-primary` (텍스트로) | `--paper` | 2.57 : 1 | **탈락** | **탈락** | 핑크 텍스트를 밝은 배경 위에 직접 쓰지 말 것(링크/강조 텍스트 등) |
| `--pink-active` (#B34B6E, 텍스트로) | `--paper` | **4.86 : 1** | 통과 | 통과 | 밝은 배경 위 "AA-safe 핑크 텍스트"는 이 색만 사용 |
| `--paper`(#FFF9FA, 텍스트로) | `--pink-active` | **4.86 : 1** | 통과 | 통과 | 버튼 active/pressed 상태: 배경이 어두워지므로 텍스트를 `--ink`→`--paper`로 전환 |
| `--ink` | `--pink-hover` (#D95B85) | 4.92 : 1 | 통과 | 통과 | hover 상태는 `--ink` 텍스트 유지 가능 |
| `--ink` | `--pink-active` (#B34B6E) | 3.53 : 1 | 탈락 | 통과 | active 상태에서 `--ink` 텍스트는 **큰 텍스트/아이콘 전용**, 본문 크기 라벨엔 `--paper`로 전환 |
| `--muted` (#8C8494) | `--paper` | 3.45 : 1 | 탈락 | 통과 | 캡션 등 작은 텍스트엔 부적합 → `--muted-strong` 사용 |
| `--muted-strong` (#706A76) | `--paper` | **5.03 : 1** | 통과 | 통과 | 캡션/보조 텍스트 기본값으로 승격 |
| `--ink` | `--accent-cool` (#4ECDC4) | **9.23 : 1** | 통과 | 통과 | 매칭 성사 배지 등은 항상 `--ink` 텍스트 |
| `#FFFFFF` | `--accent-cool` | 1.94 : 1 | 탈락 | 탈락 | accent-cool 위 흰 텍스트 금지 |
| `--ink` | `--accent-cool-tint-50` (#E4F8F6) | 16.21 : 1 | 통과 | 통과 | 합격 등 긍정 아웃컴을 "연한 배경 + 텍스트"로 표현할 때(1.1절 콘텐츠 원칙) 사용 |
| `--ink` | `--negative` (#E85C5C) | **5.20 : 1** | 통과 | 통과 | 불합격/실패 배지는 배경 `--negative` + `--ink` 텍스트 조합만 사용 |
| `--negative` (텍스트로) | `--paper` | 3.30 : 1 | **탈락** | 통과 | negative를 텍스트 색으로 직접 쓰지 말 것 → 본문 텍스트엔 `--negative-strong` 사용 |
| `--negative-strong` (#A24040, 텍스트로) | `--paper` | **6.04 : 1** | 통과 | 통과 | 폼 에러 메시지, 실패 상태 서술 텍스트, 실패 아이콘 색상은 이 색 사용(7.4절 참고) |
| `--negative-strong` (텍스트로) | `--negative-tint-50` (#FCE7E7) | **5.30 : 1** | 통과 | 통과 | 실패 배지를 "연한 배경 + 진한 텍스트"로 표현할 때(DESIGN_2 콘텐츠 원칙 반영) |
| `--ink` | `--pink-tint-200` (#FFA6C4) | **9.79 : 1** | 통과 | 통과 | 파이프라인 1단계(`--stage-applied`) 배경, 아바타 배경(5.5절) 등에 사용 |
| `--ink` | 반투명 흰색 22% over `--pink-primary` (합성 ≈ #FF8CB3) | **8.21 : 1** | 통과 | 통과 | 대시보드 인사 배너(5.4절)의 반투명 통계 칩 — DESIGN_2 원안의 흰 텍스트(2.68:1 탈락)는 금지, `--ink`로 대체 |
| `--line` (경계선) | `--paper` | 1.26 : 1 | — | 탈락(3:1 미달) | 장식용 구분선 전용으로 한정. 입력창 등 "이해에 필수적인" 경계에는 사용 금지 |
| `--line-strong` (#84797D) | `--paper` | **4.03 : 1** | — | 통과 | input, select 등 기능적 테두리에 사용 |

**대안 정리**
- 모든 Primary 버튼/필 배지(pink-primary 배경)는 텍스트를 `--ink`로 강제한다. 흰 텍스트가 필요한 디자인 요청이 오면 배경을 `--pink-active`(#B34B6E) 이상으로 어둡게 하고 그때만 흰색/`--paper` 텍스트를 허용한다.
- 핑크를 텍스트 색으로 쓰고 싶을 때(링크, 강조 문구)는 `--pink-primary`가 아니라 `--pink-active`만 사용한다.
- 캡션·메타 정보 등 작은 텍스트는 `--muted`가 아니라 `--muted-strong`을 기본값으로 쓴다. `--muted`는 18px 이상 큰 텍스트, 아이콘, placeholder에만 허용한다.
- `--line`은 카드 테두리 같은 장식 요소로만 쓰고, 폼 입력창·포커스가 필요한 UI 경계에는 `--line-strong`을 쓴다.
- `--negative`도 `--pink-primary`와 동일한 규칙을 따른다: 배경 채움 + `--ink` 텍스트로만 쓰고, 텍스트 색으로 직접 쓸 때는 `--negative-strong`만 사용한다.
- 그라데이션/반투명 레이어(대시보드 인사 배너 등) 위에 글자를 올릴 때는 흰 텍스트를 기본값으로 가정하지 말고, 실제 합성 색 기준으로 `--ink` 대비를 확인한 뒤 사용한다(2.3절 합성 chip 행 참고).

---

## 3. 타이포그래피

### 3.1 폰트 로딩

```html
<link rel="stylesheet" as="style" crossorigin
  href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@latest/dist/web/variable/pretendardvariable.css" />
```

```css
:root {
  --font-sans: 'Pretendard Variable', Pretendard, -apple-system, BlinkMacSystemFont,
    system-ui, Roboto, 'Helvetica Neue', 'Segoe UI', 'Apple SD Gothic Neo',
    'Noto Sans KR', 'Malgun Gothic', sans-serif;
}
body { font-family: var(--font-sans); }
```

### 3.2 역할별 웨이트 구분

| 역할 | Pretendard 웨이트 | 적용 대상 | 근거 |
|---|---|---|---|
| Display | 800 (ExtraBold) | 히어로 헤드라인(메인 페이지 1개소만) | 브랜드 임팩트가 필요한 유일한 지점이라 최고 굵기를 예산처럼 아껴 씀 |
| Heading | 700 (Bold) → 600 (SemiBold) | h1/h2는 700, h3~h6·카드 타이틀은 600 | 위계가 내려갈수록 굵기를 낮춰 시각적 소음을 줄임 |
| Body | 400 (Regular), 강조 시 500 (Medium) | 본문 문단, 설명 텍스트 | 긴 텍스트 가독성 우선, 강조 단어만 500 |
| Utility | 600 (SemiBold), 라벨/배지는 600 유지, 캡션은 400 | 버튼 라벨, 폼 라벨, 뱃지·태그, 탭 인디케이터 텍스트 | 작은 크기에서도 인식되려면 최소 600 필요(400은 12~14px에서 흐릿해짐), 단 캡션류는 400으로 본문과 구분 |

### 3.3 타입 스케일

기준 root font-size: `16px`.

| 토큰 | 크기 (px / rem) | line-height | weight | 용도 |
|---|---|---|---|---|
| `--text-display` | 48px / 3rem | 1.15 | 800 | 메인 히어로 헤드라인 |
| `--text-h1` | 36px / 2.25rem | 1.2 | 700 | 페이지 타이틀 |
| `--text-h2` | 28px / 1.75rem | 1.25 | 700 | 섹션 타이틀 |
| `--text-h3` | 22px / 1.375rem | 1.3 | 600 | 카드 그룹/서브섹션 타이틀 |
| `--text-h4` | 18px / 1.125rem | 1.4 | 600 | 카드 타이틀(인재/공고 카드) |
| `--text-h5` | 16px / 1rem | 1.4 | 600 | 위젯 타이틀 |
| `--text-h6` | 15px / 0.9375rem | 1.4 | 600 | 폼 그룹 라벨 |
| `--text-body-lg` | 17px / 1.0625rem | 1.6 | 400 | 리드 문단 |
| `--text-body` | 16px / 1rem | 1.6 | 400 | 기본 본문 |
| `--text-body-sm` | 14px / 0.875rem | 1.55 | 400 | 보조 설명 |
| `--text-caption` | 13px / 0.8125rem | 1.4 | 400 (색상은 `--muted-strong`) | 메타 정보, 타임스탬프 |
| `--text-label` | 15px / 0.9375rem | 1.2 | 600 | 버튼/폼 라벨 |
| `--text-tag` | 12px / 0.75rem | 1.2 | 600 | 배지, 칩, 스코어 뱃지 숫자 |

---

## 4. 레이아웃 원칙

### 4.1 메인 페이지 — "통합 허브"

메인은 기업/구직자 어느 쪽으로도 치우치지 않는 중립 진입점이므로, 상단 탭(메인/Tab1/Tab2)을 페이지 최상단에 고정 노출해 사용자가 즉시 자신의 유형에 맞는 화면으로 이동할 수 있게 한다. 히어로 영역은 `--pink-tint-50`(#FFE9F0) wash 배경 위에 통합 검색창을 크게 배치해 "검색 한 번으로 카테고리 기반 매칭이 시작된다"는 서비스의 핵심 가치를 시각적으로 각인시키고, 그 아래 추천 하이라이트(매칭 스코어 카드)를 가로 스크롤 캐러셀로 배치해 개인화가 이미 작동 중임을 보여준다. 이 히어로는 로그인 여부와 무관한 마케팅성 진입점이므로 5.4절 "대시보드 인사 배너"(로그인 사용자 개인화 요약)와는 별개의 컴포넌트다 — 인사 배너는 Tab1/Tab2 콘텐츠 상단에서만 쓴다.

```
+--------------------------------------------------------+
| [로고]     메인 | 기업(Tab1) | 구직자(Tab2)     [로그인] |
+--------------------------------------------------------+
|                 HERO (pink-tint-50 배경)                |
|        "카테고리 기반으로, 꼭 맞는 채용을 찾다"           |
|   [ 직무 / 지역 / 스킬 통합 검색 ................ ][검색]|
+--------------------------------------------------------+
|  추천 하이라이트 (매칭 스코어 카드, 가로 스크롤) →        |
|  [카드][카드][카드][카드][카드] ...                      |
+--------------------------------------------------------+
|  최근 공고               |  최근 인재(로그인 유형별 분기) |
|  [공고카드][공고카드]     |  [인재카드][인재카드]         |
+--------------------------------------------------------+
```

### 4.2 Tab1 (기업용) — "관리 콘솔"

기업 사용자는 탐색보다 운영(인재 검색 → 공고 관리 → 지원자 관리)을 반복하므로 좌측 고정 필터 사이드바 + 우측 콘텐츠의 대시보드형 레이아웃을 쓴다. 카테고리 필터(업종/직무/스킬/지역/고용형태)는 항상 좌측에 고정해 "필터를 조정하며 인재를 좁혀나가는" 흐름을 방해하지 않는다. 공고 관리와 지원자 관리는 상태(DRAFT/POSTED/CLOSED, 지원~합격 단계)를 뱃지 색으로 구분해 리스트/칸반 형태로 노출한다. 콘텐츠 최상단에는 5.4절 대시보드 인사 배너를 배치해 이번 주 지원자·공고 현황을 사무적인 톤(1.1절)으로 요약한다. 지원자 관리 칸반의 4단계 컬럼은 5.7절 파이프라인 단계 컬러를 사용한다.

```
+----------------+-----------------------------------------+
| 필터 사이드바   |  인사 배너: "OO님, 이번 주 지원자 현황입니다" |
| □ 업종         |  [신규 지원 12건 · 전주 대비 +3][면접 예정 4건]|
| □ 직무         +-----------------------------------------+
| □ 스킬(다중)   |  인재 검색 결과 (카드 그리드, 2~3열)       |
| □ 지역         |  [인재카드: 스코어링 | 매칭점수 배지]      |
| □ 연차/연봉    |  [인재카드][인재카드][인재카드]            |
+----------------+-----------------------------------------+
|  공고 관리 (테이블: 상태 뱃지 DRAFT/POSTED/CLOSED)          |
+------------------------------------------------------------+
|  지원자 관리 (칸반: 지원 → 서류검토 → 면접 → 결과, 5.7절 색상) |
+------------------------------------------------------------+
```

### 4.3 Tab2 (구직자용) — "피드형 탐색"

구직자는 콘솔형이 아니라 소비형(둘러보고 저장하고 지원) UX가 맞으므로, 세로 스크롤 공고 피드를 중심으로 하고 각 카드에 매칭 스코어 링을 노출해 "내게 얼마나 맞는 공고인지"를 즉시 보여준다. 기업 정보는 카드 클릭 시 우측 슬라이드 패널(또는 모바일에서는 풀스크린 모달)로 열어 피드 흐름을 끊지 않는다. 지원 현황은 하단에 가로형 단계 트래커(지원→서류→면접→결과)로 상시 노출한다. 피드 최상단에는 5.4절 대시보드 인사 배너를 배치해 격려 톤(1.1절)으로 이번 주 지원 현황을 요약한다. 트래커의 4단계는 5.7절 파이프라인 단계 컬러를 사용하고, 최종 결과가 확정되면 합격(`--accent-cool`)/불합격(`--negative`)으로 분기한다.

```
+----------------+-----------------------------------------+
| 필터(접이식)    |  인사 배너: "OO님, 이번 주도 응원해요"        |
| □ 직무/지역/   |  [지원 5건 · 지난주 대비 +2][서류 통과 2건]  |
|   스킬/근무형태 +-----------------------------------------+
|                |  공고 피드 (세로 카드 리스트)              |
|                |  [공고카드 + 매칭스코어 링]                |
|                |  [공고카드 + 매칭스코어 링] ← 클릭 시      |
|                |                          우측 기업정보 패널|
+----------------+-----------------------------------------+
|  지원 현황 트래커: 지원 ● → 서류 ○ → 면접 ○ → 결과 ○      |
|  (5.7절 색상, 결과 확정 시 합격/불합격 색으로 분기)          |
+------------------------------------------------------------+
```

### 4.4 그리드 · 간격(spacing) 시스템

```css
:root {
  /* 8px 기준 spacing scale (4px 보정 단위 포함) */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-6: 24px;
  --space-8: 32px;
  --space-12: 48px;
  --space-16: 64px;
  --space-24: 96px;

  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
  --radius-pill: 999px;

  --container-max: 1200px;
  --grid-columns: 12;
  --grid-gutter: 24px; /* 데스크톱 */
  --grid-gutter-mobile: 16px;
}
```

| 브레이크포인트 | 범위 | 컬럼/거터 |
|---|---|---|
| Mobile | ~480px | 4컬럼, 거터 16px, 사이드바는 하단 시트/아코디언으로 전환 |
| Tablet | 481~768px | 8컬럼, 거터 16px |
| Desktop | 769~1200px | 12컬럼, 거터 24px |
| Wide | 1201px~ | 12컬럼, `--container-max`로 중앙 정렬, 거터 24px |

---

## 5. 컴포넌트 스타일 가이드

### 5.1 버튼 (Primary / Secondary / Ghost)

버튼 상태 전이는 2.3절 대비 계산 결과를 그대로 반영한다 — 배경이 어두워질수록(active) 텍스트를 `--ink`에서 `--paper`로 전환한다.

```css
.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-3) var(--space-6);
  border-radius: var(--radius-pill);
  font: 600 var(--text-label)/1.2 var(--font-sans);
  border: 2px solid transparent;
  cursor: pointer;
  transition: background-color .15s ease, color .15s ease, border-color .15s ease;
}
.btn:focus-visible {
  outline: 2px solid var(--ink);
  outline-offset: 2px;
}

/* Primary: 브랜드 핑크를 면으로 크게 사용 */
.btn-primary {
  background: var(--pink-primary);
  color: var(--ink); /* 6.68:1, 흰색(2.68:1) 사용 금지 */
}
.btn-primary:hover  { background: var(--pink-hover); color: var(--ink); } /* 4.92:1 */
.btn-primary:active { background: var(--pink-active); color: var(--paper); } /* 4.86:1 */
.btn-primary:disabled {
  background: var(--disabled-bg);
  color: var(--disabled-text);
  cursor: not-allowed;
}

/* Secondary: 테두리만 핑크, 텍스트는 AA-safe 핑크(pink-active)만 사용 */
.btn-secondary {
  background: transparent;
  border-color: var(--pink-active);
  color: var(--pink-active); /* 4.86:1 */
}
.btn-secondary:hover  { background: var(--pink-tint-50); }
.btn-secondary:active { background: var(--pink-tint-100); }

/* Ghost: 배경 없는 저강도 액션(카드 내부 보조 버튼 등) */
.btn-ghost {
  background: transparent;
  color: var(--ink);
}
.btn-ghost:hover { background: var(--pink-tint-50); color: var(--pink-active); }
```

### 5.2 카드 (인재 카드 / 공고 카드)

```css
.card {
  background: var(--paper);
  border: 1px solid var(--line); /* 장식용 — 5.3절 스코어 링이 시각적 경계를 보강 */
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  box-shadow: 0 1px 2px rgba(26, 21, 35, 0.04);
  transition: transform .18s ease, border-color .18s ease, box-shadow .18s ease;
}
.card:hover,
.card:focus-within {
  transform: translateY(-4px);
  border-color: var(--pink-primary);
  box-shadow: 0 12px 24px rgba(255, 107, 157, 0.18); /* pink-primary 18% */
}
.card__title { font: 600 var(--text-h4)/1.4 var(--font-sans); color: var(--ink); }
.card__meta  { font: 400 var(--text-caption)/1.4 var(--font-sans); color: var(--muted-strong); }
```

### 5.3 뱃지 — 매칭 스코어

배경에 핑크를 그대로 채우는 필(pill) 뱃지가 아니라, 5장 매칭 스코어링(PRD 5장) 값을 **원형 진행 링**으로 시각화하는 것이 이 서비스의 시그니처(6장 참고)다.

```css
.match-score {
  --score: 82; /* 0~100, 서버(JS)에서 값 주입 */
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: conic-gradient(
    var(--pink-primary) calc(var(--score) * 1%),
    var(--line) 0
  );
}
.match-score::before {
  content: '';
  position: absolute;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--paper);
}
.match-score__value {
  position: relative;
  font: 700 var(--text-tag)/1 var(--font-sans);
  color: var(--ink); /* 링 위가 아닌 paper 배경 위 텍스트라 17.17:1 */
}
/* 매칭 성사/지원 완료 등 긍정 상태는 accent-cool로 색상 자체를 교체 */
.match-score--matched {
  background: conic-gradient(var(--accent-cool) 100%, var(--line) 0);
}
.match-score--matched .match-score__value { color: var(--ink); } /* 9.23:1 */
```

일반 카테고리 태그(스킬/직무 칩)는 저강도 필 뱃지로 별도 정의한다.

```css
.tag {
  display: inline-flex;
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-pill);
  background: var(--pink-tint-200); /* #FFA6C4 */
  color: var(--ink);
  font: 600 var(--text-tag)/1.2 var(--font-sans);
}
```

### 5.4 대시보드 인사 배너 (Greeting Banner)

Tab1(기업)·Tab2(구직자) 콘텐츠 최상단에서 로그인한 사용자에게 개인화 요약을 보여주는 배너. 배경은 `--pink-primary` → `--pink-tint-100`(#FF89B1) 그라데이션이고, 두 끝점 모두 `--ink` 텍스트 기준 6.68:1 / 8.05:1로 AA를 넉넉히 만족하므로(2.3절) 텍스트는 항상 `--ink`를 쓴다. 통계 칩은 반투명 흰색(`rgba(255,255,255,.22)`)을 올리되, 흰 텍스트가 아니라 `--ink` 텍스트를 쓴다(합성 대비 8.21:1, 2.3절 참고 — DESIGN_2 원안의 흰 텍스트 사용은 채택하지 않음).

```css
.greeting-banner {
  background: linear-gradient(135deg, var(--pink-primary), var(--pink-tint-100));
  border-radius: var(--radius-lg);
  padding: var(--space-8) var(--space-6);
  color: var(--ink);
}
.greeting-banner__chip {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-pill);
  background: rgba(255, 255, 255, .22);
  color: var(--ink); /* 흰 텍스트 금지 — 8.21:1 확보를 위해 ink 고정 */
  font: 600 var(--text-label)/1.2 var(--font-sans);
}
```

카피는 1.1절 톤 원칙을 따른다 — 구직자는 격려 톤("OO님, 이번 주도 응원해요"), 기업은 사무 톤("OO님, 이번 주 지원자 현황입니다")을 쓰고 통계 칩에는 항상 비교 문구(전주/전월 대비)를 포함한다.

### 5.5 아바타

```css
.avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: var(--pink-tint-200); /* #FFA6C4, ink 대비 9.79:1 */
  color: var(--ink);
  font: 600 var(--text-body-sm)/1 var(--font-sans);
}
```

기업 담당자, 구직자 프로필 등 사용자를 대표하는 곳(탑 내비게이션, 카드 작성자 표시)에 공통으로 쓴다. 이니셜 텍스트는 항상 `--ink`.

### 5.6 통계 카드 (Stat Card)

라벨 → 값 → 비교 코멘트 3단 구조로, 1.1절 "수치는 항상 비교 문구와 함께" 원칙을 컴포넌트화한 것이다. 기업 Tab1(공고/지원자 현황, PRD 7.1 채용 시장 분석)과 구직자 Tab2(지원 현황 요약) 양쪽에서 공통으로 쓴다.

```css
.stat-card__label   { font: 500 var(--text-body-sm)/1.4 var(--font-sans); color: var(--muted-strong); }
.stat-card__value   { font: 700 var(--text-h2)/1.2 var(--font-sans); color: var(--ink); }
.stat-card__comment { font: 600 var(--text-caption)/1.4 var(--font-sans); }
.stat-card__comment--up   { color: var(--accent-cool-strong); } /* 9.23:1 계열, 증가/긍정 */
.stat-card__comment--down { color: var(--negative-strong); }    /* 6.04:1, 감소/부정 */
```

증감 코멘트는 색상만으로 방향을 전달하지 않고 "▲ 전월 대비 +8%p" 처럼 기호·텍스트를 함께 표기한다(1.1절, 7.2절 원칙).

### 5.7 파이프라인 단계 컬러 — 칸반 컬럼 / 트래커 스텝

기업의 지원자 관리 칸반(4.2절)과 구직자의 지원 현황 트래커(4.3절)는 같은 4단계(지원완료→서류심사→면접→최종결과)를 표시 형태만 다르게(칸반 컬럼 vs 가로 트래커) 쓰는 동일한 데이터다. 진행도를 색으로 표현하되, DESIGN_2 초안의 임의 핑크 값(`#FF8FB3`, `#FFB3CB`, `#D6467F`, `#FF4E8C`) 대신 이미 대비 검증이 끝난 2.2절 pink 계열을 그대로 재사용해 새 색상 없이 단계별 명도만 진행시킨다(밝음→어두움이 실제로 단조 진행하도록 재구성).

| 단계 | 토큰 | 배경 | 텍스트 | 대비 |
|---|---|---|---|---|
| 1. 지원완료 | `--stage-applied` | `--pink-tint-200` (#FFA6C4) | `--ink` | 9.79 : 1 |
| 2. 서류심사 | `--stage-review` | `--pink-primary` (#FF6B9D) | `--ink` | 6.68 : 1 |
| 3. 면접 | `--stage-interview` | `--pink-hover` (#D95B85) | `--ink` | 4.92 : 1 |
| 4. 최종결과(미확정) | `--stage-result` | `--pink-active` (#B34B6E) | `--paper` | 4.86 : 1 |

4단계에서 실제 결과가 확정되면(합격/불합격) 색이 분기한다 — 이는 6장 매칭 스코어 링의 "핑크(가능성) → 민트(성사)" 전이와 같은 원칙이다.

```css
.pipeline-stage {
  border-radius: var(--radius-sm);
  padding: var(--space-1) var(--space-3);
  font: 600 var(--text-tag)/1.2 var(--font-sans);
  color: var(--ink);
}
.pipeline-stage--applied   { background: var(--stage-applied); }
.pipeline-stage--review    { background: var(--stage-review); }
.pipeline-stage--interview { background: var(--stage-interview); }
.pipeline-stage--result    { background: var(--stage-result); color: var(--paper); }

/* 결과 확정 후 분기 */
.pipeline-stage--passed   { background: var(--accent-cool); color: var(--ink); } /* 9.23:1 */
.pipeline-stage--rejected { background: var(--negative);    color: var(--ink); } /* 5.20:1 */
```

`DRAFT`/`POSTED`/`CLOSED` 같은 공고 게시 상태는 이 팔레트도, `--accent-cool`/`--negative`도 쓰지 않는다 — 아웃컴이 아니라 일반 콘텐츠 상태이므로 `--muted-strong` 텍스트 + `--line` 계열 배경의 무채색 뱃지로 별도 표현한다(2.1절 `--negative` 설명 참고).

---

## 6. 시그니처 요소 — 매칭 스코어 링 (Match Score Ring)

이 서비스의 차별점은 PRD 5장에 명시된 3단계 매칭 로직(하드 필터 → 소프트 스코어링 → 정렬)이다. 대부분의 채용 플랫폼은 이 계산 결과를 텍스트("적합도 82%")로만 노출하는데, 이 프로젝트는 5.3절의 원형 진행 링(conic-gradient 기반)을 인재 카드, 공고 카드, 추천 하이라이트 등 매칭이 등장하는 모든 지점에 동일한 컴포넌트로 반복 노출해 "이 서비스는 항상 나에게 맞춰 순위를 매긴다"는 인상을 축적시킨다. 링의 진행 색은 기본적으로 `--pink-primary`이고, 매칭이 실제로 성사(지원 완료, 서류 통과 등 `interaction_logs.action_type`이 긍정적으로 전환되는 시점)되면 `--accent-cool`로 색이 전환되어 "핑크(가능성) → 민트(성사)"라는 상태 전이를 색으로 학습시킨다. 이는 `--accent-cool`을 "낮은 사용 빈도"로 못 박은 2.1절 원칙과도 맞아떨어진다 — 링이 민트색으로 바뀌는 순간을 희소하게, 그래서 특별하게 만든다. 같은 "핑크(진행 중) → 민트(성사)" 전이 규칙은 5.7절 파이프라인 단계 컬러에서 불합격이라는 반대 극단이 추가되며 "핑크 → 민트/레드"라는 3색 상태 언어로 완성된다 — 매칭 스코어 링과 파이프라인 컬러는 이 프로젝트의 두 시그니처 상태 시각화이자 하나의 색 언어를 공유한다.

카드 hover 시 링은 `stroke`가 아닌 `background`(conic-gradient) 속성을 애니메이션하므로 GPU 가속 대상은 아니지만, 요소 수가 카드 그리드당 수십 개 수준으로 제한되어 성능 이슈는 없다. 진행 애니메이션(0%→목표 점수까지 0.6s ease-out)은 `prefers-reduced-motion` 대응 대상이다(7장 참고).

---

## 7. 반응형 / 접근성 체크리스트

### 7.1 반응형

- [ ] 모바일(~480px)에서 Tab1의 좌측 필터 사이드바는 상단 "필터" 버튼 + 하단 시트(bottom sheet)로 전환한다.
- [ ] 매칭 스코어 카드 캐러셀(4.1절)은 모바일에서 스와이프 가능한 가로 스크롤을 유지하되 `scroll-snap-type: x mandatory`로 스냅 처리한다.
- [ ] 버튼/탭 등 터치 타깃은 최소 44×44px을 확보한다(`--space-3` 패딩 기준 실측 확인).
- [ ] 카드 그리드는 데스크톱 3열 → 태블릿 2열 → 모바일 1열로 축소한다.

### 7.2 키보드 · 스크린리더

- [ ] 모든 인터랙티브 요소는 `:focus-visible`에서 `--ink` 2px 아웃라인 + 2px offset을 갖는다(5.1절 `.btn:focus-visible` 참고). `--pink-primary` 배경 위 요소는 아웃라인 색을 `--paper`로 바꿔 배경과의 대비를 확보한다(파생: paper vs pink-primary = 2.57:1로 낮으므로, 아웃라인은 `--ink` 1px + `--paper` 1px 이중 링 방식을 권장).
- [ ] 탭(메인/Tab1/Tab2) 네비게이션은 `role="tablist"`/`role="tab"`/`aria-selected`를 사용한다.
- [ ] 매칭 스코어 링은 시각 전용 요소이므로 `aria-hidden="true"` 처리하고, 동일 정보를 스크린리더용 텍스트(`<span class="sr-only">매칭 점수 82점</span>`)로 병행 제공한다.
- [ ] 지원 현황 트래커, 공고 상태(DRAFT/POSTED/CLOSED), 5.7절 파이프라인 단계·합격/불합격 배지 등 색으로만 구분되는 상태는 아이콘 또는 텍스트 라벨을 항상 함께 표기한다(색맹 사용자 대응, WCAG 1.4.1).
- [ ] 폼 입력(카테고리 다중 선택, 연봉 범위 등)은 `<label for>` 연결을 필수로 하고, 에러 메시지는 `aria-describedby`로 연결한다.

### 7.3 모션

```css
@media (prefers-reduced-motion: reduce) {
  .match-score {
    transition: none;
  }
  .card {
    transition: border-color .01s, box-shadow .01s;
    transform: none !important;
  }
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] 매칭 스코어 링의 진행 애니메이션은 `prefers-reduced-motion: reduce`에서 즉시 최종 상태로 렌더링한다(0%→N% 애니메이션 생략).
- [ ] 카드 hover의 `translateY` 이동 효과도 reduce 모드에서는 제거하고 색상 변화만 유지한다.

### 7.4 미해결/추후 확인 필요 항목

- 상태 배지/아웃컴 표시(불합격, 실패 등) 수준의 부정 신호 색상은 이번 개정에서 `--negative`/`--negative-strong`으로 추가해 해소했다(2장 참고). 다만 폼 인풋 자체의 에러 테두리·에러 아이콘 배치 등 "폼 검증 UI 패턴"은 여전히 이 문서 범위 밖이며, 실제 폼 검증 요구사항이 정의되는 시점에 `--negative-strong`을 기준값으로 삼아 별도 확정한다.
