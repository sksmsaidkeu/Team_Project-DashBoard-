# 구직자 대시보드 레이아웃 설계 (JobPing 스타일)

## 📐 전체 구조

```
┌────────────────────────────────────────────────────────────────┐
│ [탑 네비게이션] 고정 (h=56px)                                  │
│ 로고 | 메뉴 | 프로필                                           │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│ [히어로 배너] (h=120px)                                        │
│ 핑크 그라디언트 | 인사말 | 통계 3개                            │
└────────────────────────────────────────────────────────────────┘

┌──────────────────────────────┬────────────────────────────────┐
│ [칸반 보드] (좌측 ~70%)     │ [우측 사이드바] (~30%)         │
│                              │                                │
│ 4 columns (flex)             │ 4 sections (stack)             │
│ • 지원완료 (27)             │ • 인사이트                     │
│ • 서류심사 (14)             │ • 핫 스킬                      │
│ • 면접 (6)                  │ • 맞춤 공고                    │
│ • 최종결과 (3)              │ • 뉴스                         │
│                              │                                │
└──────────────────────────────┴────────────────────────────────┘
```

---

## 🎯 상세 영역별 설계

### **[1] 탑 네비게이션**

```
Height: 56px
Background: #FFFFFF
Border-bottom: 2px solid #FF6B9D
Position: sticky (scroll 시 고정)
Padding: 0 40px

Layout: flex, space-between

┌─────────────────────────────────────────────────────────────┐
│ [좌측]                          [우측]                      │
│ ┌──────────────────────┐        ┌──────┐                   │
│ │ 로고 | 메뉴          │        │ 프로필│                   │
│ │ 💼 JobPing          │        │ 김석  │ (40px 원형)       │
│ │                     │        │       │                   │
│ │ 대시보드 채용공고   │        │       │                   │
│ │ 커뮤니티 동료       │        │       │                   │
│ └──────────────────────┘        └──────┘                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘

컴포넌트:
  - 로고: 18px / 800 weight / var(--primary) 색상
  - 로고-메뉴 gap: 60px
  - 메뉴 gap: 40px 사이 (4개 링크)
  - 메뉴 링크: 13px / 500 / gray, hover → primary
  - 프로필 아바타: 40px 원형, primary 배경, white 텍스트
```

---

### **[2] 히어로 배너**

```
Height: 120px
Background: linear-gradient(135deg, #FF6B9D 0%, #FF9EC4 100%)
Margin: 28px 40px
Padding: 28px 40px
Border-radius: 18px
Color: white

Layout: flex, space-between, align-center, gap: 40px

┌───────────────────────────────────────────────────────────┐
│ [좌측 텍스트] 70%        [우측 통계] 30%                 │
│                                                           │
│ 제목: "김석준님,          ┌───────────────────────────┐ │
│ 이번 주도 응원해요! 💪"  │ 통계 3개 (나열)           │ │
│ (22px / 800)              │                           │ │
│                           │ ┌─────────┬─────────┬──┐ │ │
│ 부문:                     │ │52%      │42%      │18%│ │
│ "지난주 새로운            │ │서류     │면접     │최종 │ │
│ 추천공고 12개 올라왔어요" │ │합격률   │진행중   │대기 │ │
│ (13px / 400)              │ │         │         │    │ │ │
│                           │ └─────────┴─────────┴──┘ │ │
│                           │                           │ │
│                           └───────────────────────────┘ │
│                                                           │
└───────────────────────────────────────────────────────────┘

텍스트:
  - 제목: 22px / 800 weight / white
  - 부문: 13px / 400 weight / white (opacity 0.93)

통계 박스:
  - 배경: rgba(255, 255, 255, 0.18)
  - Padding: 12px 20px
  - Border-radius: 10px
  - 텍스트 정렬: center
  - 숫자: 20px / 800 weight
  - 라벨: 11px / 400 weight
```

---

### **[3] 메인 컨테이너**

```
Padding: 28px 40px
Gap: 24px
Display: flex

Max-width: 1500px
Margin: 0 auto
```

---

### **[3-L] 칸반 보드 (좌측, ~70%)**

```
Layout: flex (horizontal)
Gap: 16px
Overflow-x: auto (수평 스크롤 가능)
Padding-bottom: 8px

타이틀:
  "지원 현황 트래커"
  Font: 16px / 800
  Margin-bottom: 18px
  Color: var(--text-main)

각 컬럼 구조:
┌──────────────────────┐
│ [컬럼 헤더]          │ (h=40px, 약간 둥근 상단)
│ 지원완료  27         │
├──────────────────────┤
│ [카드들 스택]        │
│                      │
│ ┌──────────────────┐ │
│ │ 컬팅팬            │ (카드)
│ │ 프론트엔드 개발자  │
│ │ 07.10             │
│ │ [React][TS]      │
│ └──────────────────┘ │
│                      │
│ ┌──────────────────┐ │
│ │ 원티드랩          │
│ │ 웹 개발자         │
│ │ 07.08             │
│ │ [Next]           │
│ └──────────────────┘ │
│                      │
└──────────────────────┘

컬럼 속성:
  - Flex: 0 0 270px (고정 너비)
  - Display: flex flex-direction column

컬럼 헤더:
  - Padding: 11px 14px
  - Border-radius: 10px (상단만)
  - Color: white / Font: 13px / 800
  - Margin-bottom: 12px
  - Display: flex space-between
  
  색상 (4단계 그라디언트):
    1️⃣ 지원완료: #FF6B9D (기본)
    2️⃣ 서류심사: #FF8FB3 (연한)
    3️⃣ 면접진행: #FFB3CB (더 연한)
    4️⃣ 최종결과: #D6467F (진한)

카운트 배지:
  - 배경: rgba(255, 255, 255, 0.35)
  - Padding: 2px 8px
  - Border-radius: 6px
  - Font: 12px / 700

카드 상세:
┌───────────────────────────┐
│ [회사명]                  │ 13px / 800 / #2B2230
│ 컬팅팬                     │ margin-bottom: 3px
│                           │
│ [직무]                    │ 11px / gray
│ 프론트엔드 개발자          │ margin-bottom: 6px
│                           │
│ [날짜]                    │ 10px / muted
│ 07.10                     │ margin-bottom: 6px
│                           │
│ [스킬 태그들]             │
│ [React] [TS]              │ 9px / 700
│                           │ 배경: #FFE3ED
│ margin-bottom: 6px        │
│                           │
│ [푸터]                    │ 10px
│ 5.5~7M     ⭐⭐⭐         │
│                           │
└───────────────────────────┘

카드 스타일:
  - Background: #FFFFFF
  - Border: 1px solid #FBDCE7
  - Border-radius: 10px
  - Padding: 12px
  - Margin-bottom: 12px
  - Transition: all 150ms
  - Hover: 
    • border-color → var(--primary)
    • box-shadow: 0 2px 6px rgba(255, 107, 157, 0.12)
    • transform: translateY(-1px)

최종결과 카드 (합격/불합격 구분):
  - 합격: background #F0F9F5, border-color var(--success) #4CAF7D
  - 불합격: background #FFF5F5, border-color var(--error) #E85C5C
```

---

### **[3-R] 우측 사이드바 (~30%)**

```
Flex: 0 0 300px (고정 너비)
Display: flex flex-direction column
Gap: 16px
Max-height: calc(100vh - 200px)
Overflow-y: auto (수직 스크롤)

[섹션 1] 인사이트
┌─────────────────────────┐
│ 인사이트                 │ (14px / 800)
├─────────────────────────┤
│                         │
│ 서류 통과자 수: 12명     │
│                 ⬆ 25%  │ (green)
│                         │
│ 면접 진행중: 3명         │
│                         │
│ 거절 메일: 2건          │
│                         │
└─────────────────────────┘

레이아웃:
  - Stat item (flex space-between)
  - Label: 12px / gray (좌측)
  - Value: 16px / 800 / main (우측)
  - Change: 10px / green / bold

[섹션 2] 🔥 이달 핫 스킬
┌─────────────────────────┐
│ 이달 핫 스킬             │ (14px / 800)
├─────────────────────────┤
│ 1️⃣ React                │
│    📈 +15%              │ (green)
│                         │
│ 2️⃣ TypeScript           │
│    📈 +12%              │
│                         │
│ 3️⃣ Node.js              │
│    📈 +8%               │
│                         │
└─────────────────────────┘

트렌드 아이템:
  - Layout: flex gap 10px
  - Rank: 18px / 800 / primary (min-width 20px)
  - Name: 12px / 700 / main
  - Meta: 10px / gray (change는 green bold)
  - Margin-bottom: 12px
  - Padding-bottom: 12px
  - Border-bottom: 1px solid var(--border)

[섹션 3] 당신을 위한 공고
┌─────────────────────────┐
│ 당신을 위한 공고         │ (14px / 800)
├─────────────────────────┤
│ 92%                     │ (배지: #FFE3ED)
│ 프론트엔드 개발자        │ (12px / 700)
│ 그린트팀                 │ (10px / gray)
│ 5.5~7M · 서울          │
│ [지원하기] →             │ (outline btn)
│                         │
│ 87%                     │
│ UI/UX 디자이너          │
│ 스타트업A               │
│ 4.5~6M · 강남          │
│ [지원하기] →             │
│                         │
│ 82%                     │
│ 데이터 분석가            │
│ 테크스타트               │
│ 5.5~8M · 서초          │
│ [지원하기] →             │
│                         │
└─────────────────────────┘

추천 아이템:
  - Badge: 11px / 800 / #FFE3ED bg / primary color
    padding: 3px 7px / radius 5px
  - Title: 12px / 700 / main
  - Meta: 10px / gray (line-height 1.4)
  - Button: outline / primary border / transparent bg
    size: 10px / 700 / padding 4px 10px
    hover: bg #FFF0F5

[섹션 4] 📰 뉴스
┌─────────────────────────┐
│ 뉴스                     │ (14px / 800)
├─────────────────────────┤
│ "AI 개발자 급여 인상"    │ (11px / 700)
│ Wanted · 2시간 전       │ (9px / muted)
│                         │
│ "TypeScript 5.0 릴리스" │
│ Dev.to · 5시간 전       │
│                         │
│ "2026 웹 개발 트렌드"    │
│ TechBlog · 1일 전       │
│                         │
└─────────────────────────┘

뉴스 아이템:
  - Title: 11px / 700 / main (line-height 1.3)
  - Source: 9px / muted
  - Margin-bottom: 10px
  - Padding-bottom: 10px
  - Border-bottom: 1px solid var(--border)
```

---

## 🎨 컬러 & 타이포그래피

### **색상 팔레트**
```
Primary: #FF6B9D
Primary Light: #FF8FB3
Primary Lighter: #FFB3CB
Primary Dark: #D6467F

Background: #FFF9FB
Card: #FFFFFF
Border: #FBDCE7

Text Main: #2B2230 (헤딩)
Text Sub: #9A8790 (본문)
Text Muted: #8A7A82 (보조)

Success: #4CAF7D (합격)
Error: #E85C5C (불합격)
```

### **타이포그래피**
```
Nav 링크: 13px / 500
Section Title: 16px / 800
Card Title: 13px / 800
Card Role: 11px / gray
Card Date: 10px / muted
Stat Value: 16px / 800
Badge: 11px / 800
```

---

## 📱 반응형 설계

### **Desktop (1200px+)**
- 칸반: ~70% / 사이드바: ~30%
- 칸반 컬럼: 270px 고정
- 위의 상세 설계 그대로

### **Tablet (768px ~ 1199px)**
- 칸반: ~65% / 사이드바: ~35%
- 칸반 컬럼: 240px
- Font size: -1px
- Gap: 감소

### **Mobile (< 768px)**
- Layout: 세로 스택
- 칸반: 2 columns (지원완료+서류, 면접+결과)
- 사이드바: 섹션 스택
- 모든 컬럼 width: 100%

---

## ✨ 인터랙션

### **호버 효과**
```
카드 호버:
  - border-color: var(--primary)
  - box-shadow: 0 2px 6px rgba(255, 107, 157, 0.12)
  - transform: translateY(-1px)
  - transition: all 150ms ease

버튼 호버:
  - border-color: var(--primary)
  - background: #FFF0F5
```

### **전환 애니메이션**
```
모든 transition: 150ms ease
- 호버 상태
- 클릭 피드백
- 상태 변경
```

---

## 🔄 로딩 & 에러 상태

### **로딩 중**
- 칸반 카드: skeleton (회색 박스)
- 우측 섹션: skeleton cards

### **에러**
- 칸반: "지원 현황을 불러올 수 없습니다. [재시도]"
- 사이드바: 각 섹션별로 에러 메시지

### **Empty 상태**
```
칸반 컬럼 비었을 때:
  "아직 지원한 공고가 없어요."

추천 공고 없을 때:
  "당신을 위한 공고를 찾는 중입니다."
```

---

## 📊 우선순위 정보 배치

```
1순위: 칸반 트래커 (메인 콘텐츠)
2순위: 인사이트 (격려 메시지)
3순위: 맞춤 공고 (다음 액션)
4순위: 핫 스킬 (학습)
5순위: 뉴스 (부가 정보)
```

---

## 🚀 구현 우선순위

### **Phase 1 (MVP)**
- ✅ 탑 네비게이션
- ✅ 히어로 배너
- ✅ 칸반 보드 (4 columns)
- ✅ 우측 사이드바 (4 sections)

### **Phase 2 (Enhancement)**
- 실시간 업데이트
- 드래그 앤 드롭 (칸반 이동)
- 상세 모달 팝업

### **Phase 3 (Advanced)**
- 필터링
- 정렬 옵션
- 커스터마이징
