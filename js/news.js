import { NEWS_API_KEY } from './config.js';

/**
 * js/news.js — 채용 뉴스 실제 API 연동 (graceful degradation 설계).
 *
 * 배경 (improvement.md 5번, PRD.md 6장/8장):
 * js/tab-main.js의 renderJobNews()는 현재 정적 배열(JOB_NEWS_ITEMS)만 렌더링한다.
 * 이 프로젝트는 빌드 도구/배포된 백엔드 서버가 없는 정적 SPA이므로, 뉴스 API를 호출하려면
 * 브라우저에서 직접 fetch해야 한다.
 *
 * 2026-07-16: NEWS_API_KEY는 NewsAPI.org 키를 쓴다(실제 발급받은 키로 검증 완료).
 * 실제 검증 결과 (공식 pricing FAQ 및 실제 HTTP 응답 기준):
 * - NewsAPI.org 무료 "Developer" 플랜: 브라우저 직접 호출이 localhost로만 허용된다.
 *   공식 pricing FAQ에 명시된 에러 메시지: "Requests from the browser are not allowed on the
 *   Developer plan, except from localhost." 즉 프로덕션 도메인에서는 호출 자체가 차단된다
 *   (로컬 개발/테스트에서는 정상 동작 — 실제로 curl로 확인함).
 *
 * 결론: 이 프로젝트(배포된 백엔드 서버 없음 — scripts/*.py는 로컬 1회성 스크립트일 뿐 상시
 * 프록시 서버가 아님)는 프로덕션에서 안전하게 뉴스 API를 직접 호출할 방법이 없다. 따라서
 * "연동 완료"라고 단정하지 않고, 아래 fetchJobNews()는 API 호출을 시도하되 키가 없거나
 * 호출이 실패(CORS 차단/네트워크 오류/키 없음 등 사유 불문)하면 항상 정적 폴백 뉴스로
 * 자동 대체한다. 실제 서비스로 배포할 때는 Supabase Edge Function 등 서버리스 프록시를 두고
 * 그 프록시를 통해 호출하는 구조로 바꿔야 한다 (PRD.md 8장 참고).
 */

const NEWSAPI_ENDPOINT = 'https://newsapi.org/v2/everything';
const NEWS_QUERY = '채용 OR 이직 OR 구직'; // 국내 채용 시장 관련 키워드
const FETCH_TIMEOUT_MS = 5000;

// fallbackItems 인자가 주어지지 않았을 때 사용하는 최소 안내용 폴백(모듈 단독 사용 대비).
// 실제 서비스에서는 js/tab-main.js의 JOB_NEWS_ITEMS를 fetchJobNews(JOB_NEWS_ITEMS)처럼
// 인자로 전달하는 것을 권장한다 (이 파일은 js/tab-main.js를 import하지 않는다 — 파일 경계 유지).
const DEFAULT_FALLBACK_NEWS = [
  {
    title: '채용 뉴스를 불러오지 못했습니다',
    date: new Date().toISOString().slice(0, 10),
    summary: '외부 뉴스 API 연동이 설정되어 있지 않거나 호출에 실패했습니다. 잠시 후 다시 시도해주세요.',
  },
];

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('news fetch timeout')), ms)),
  ]);
}

function mapNewsApiArticle(article) {
  return {
    title: article.title || '(제목 없음)',
    date: (article.publishedAt || '').slice(0, 10) || '-',
    summary: article.description || '',
    url: article.url || null,
  };
}

/**
 * 채용 뉴스를 가져온다.
 *
 * 동작:
 * 1. NEWS_API_KEY(js/config.js, .env의 NEWS_API_KEY로부터 생성)가 비어 있으면 즉시 fallbackItems 반환.
 * 2. 키가 있으면 NewsAPI.org 검색 API 호출을 시도한다.
 * 3. 네트워크 오류/CORS 차단/타임아웃/API 에러 응답 등 어떤 이유로든 실패하면 예외를 던지지 않고
 *    fallbackItems로 대체한다 (graceful degradation) — 호출부는 항상 렌더링 가능한 배열을 받는다.
 *
 * @param {Array<{title: string, date: string, summary: string}>} [fallbackItems] - 실패 시 대체할 정적 뉴스 배열
 *   (예: js/tab-main.js의 JOB_NEWS_ITEMS를 그대로 전달)
 * @returns {Promise<Array<{title: string, date: string, summary: string, url?: string}>>}
 */
export async function fetchJobNews(fallbackItems = DEFAULT_FALLBACK_NEWS) {
  if (!NEWS_API_KEY) {
    return fallbackItems;
  }

  try {
    const url = `${NEWSAPI_ENDPOINT}?q=${encodeURIComponent(NEWS_QUERY)}&language=ko&pageSize=5&sortBy=publishedAt&apiKey=${encodeURIComponent(NEWS_API_KEY)}`;
    const response = await withTimeout(fetch(url), FETCH_TIMEOUT_MS);
    if (!response.ok) {
      throw new Error(`news api HTTP ${response.status}`);
    }
    const payload = await response.json();
    const articles = Array.isArray(payload.articles) ? payload.articles : [];
    if (articles.length === 0) {
      return fallbackItems;
    }
    return articles.map(mapNewsApiArticle);
  } catch (err) {
    // CORS 차단, 네트워크 오류, 타임아웃, 쿼터 초과 등 사유 불문 폴백.
    console.warn('[news] 외부 뉴스 API 호출 실패, 정적 폴백 뉴스로 대체합니다:', err);
    return fallbackItems;
  }
}
