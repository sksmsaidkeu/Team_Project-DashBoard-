import { API_BASE_URL } from './config.js';
import { supabase } from './supabaseClient.js';

/**
 * 새 Python 백엔드(backend/app, FastAPI) 호출 공통 래퍼.
 *
 * - 인증: backend/app/deps.py의 `Authorization: Bearer <supabase access_token>` 방식을 그대로 따른다.
 *   토큰은 매 요청마다 Supabase JS 세션에서 꺼내 자동 첨부한다(가입/로그인/카테고리 조회는 기존처럼
 *   Supabase 클라이언트를 직접 쓰고, 공고/인재검색/지원자/시장분석만 이 래퍼로 호출한다).
 * - 계획 초안과의 차이: 계획 3장 API 계약 초안에는 필드명이 일부 다르게 적혀 있었으나(예: job_category_id),
 *   실제 backend/app/models.py 기준으로 position_category_id 등 원티드 API 통일 명명을 그대로 따랐다.
 */

class ApiError extends Error {
  constructor(status, detail) {
    super(detail || DEFAULT_ERROR_MESSAGES[status] || '요청 처리 중 오류가 발생했습니다.');
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

const DEFAULT_ERROR_MESSAGES = {
  0: '서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인해주세요.',
  400: '요청 값을 확인해주세요.',
  401: '로그인이 필요합니다. 다시 로그인해주세요.',
  403: '접근 권한이 없습니다.',
  404: '요청한 정보를 찾을 수 없습니다.',
  409: '이미 존재하는 데이터입니다.',
  422: '입력값이 올바르지 않습니다.',
  500: '서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
};

async function getAccessToken() {
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    console.error('getAccessToken error', error);
    return null;
  }
  return data.session?.access_token || null;
}

function buildUrl(path, query) {
  let url = `${API_BASE_URL}${path}`;
  if (!query) return url;

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    params.set(key, String(value));
  });
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

function extractDetailMessage(payload) {
  if (!payload) return null;
  const { detail } = payload;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    // FastAPI/Pydantic 422 검증 오류 형식: [{ loc, msg, type }, ...]
    return detail.map((d) => d.msg || JSON.stringify(d)).join(', ');
  }
  return null;
}

async function request(path, { method = 'GET', body, query } = {}) {
  const token = await getAccessToken();
  if (!token) {
    throw new ApiError(401, '로그인이 필요합니다. 다시 로그인해주세요.');
  }

  const url = buildUrl(path, query);
  const headers = { Authorization: `Bearer ${token}` };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    console.error('api-client network error', err);
    throw new ApiError(0);
  }

  if (res.status === 204) return null;

  let payload = null;
  const text = await res.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, extractDetailMessage(payload));
  }

  return payload;
}

export const apiClient = {
  get: (path, query) => request(path, { method: 'GET', query }),
  post: (path, body) => request(path, { method: 'POST', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  delete: (path) => request(path, { method: 'DELETE' }),
};

export { ApiError };
