// scripts/generate-config.mjs
//
// scripts/generate_config.py의 Node.js 버전. Vercel 등 Node 기반 빌드 환경에서
// 빌드 커맨드(예: `node scripts/generate-config.mjs`)로 실행해 js/config.js를 생성한다.
// 파이썬 스크립트는 로컬 개발자용, 이 스크립트는 배포 파이프라인용 — 둘 다 같은
// js/config.js를 만들며, 템플릿 내용이 바뀌면 두 파일을 함께 고쳐야 한다.
//
// 로컬 .env 파일이 있으면 그 값도 읽어 병합한다(로컬에서 이 스크립트를 직접 테스트할 때 편의를
// 위함). 이미 process.env에 설정된 값(Vercel 대시보드 환경변수 등)이 항상 우선한다.
//
// Vercel 빌드처럼 매번 새로 체크아웃된 환경에서는 기존 js/config.js가 없으므로, 파이썬 스크립트와
// 달리 필수값(SUPABASE_URL/SUPABASE_ANON_KEY)이 비어 있으면 경고만 하고 넘어가지 않고 빌드를
// 실패시킨다 — 값이 없는 채로 조용히 배포되어 빈 config.js/깨진 사이트가 나가는 것을 막기 위함.
//
// 실행:
//   node scripts/generate-config.mjs

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function loadDotEnv(filePath) {
  if (!existsSync(filePath)) return {};
  const env = {};
  for (const rawLine of readFileSync(filePath, 'utf-8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    env[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return env;
}

const dotEnv = loadDotEnv(path.join(repoRoot, '.env'));
function getEnv(key) {
  const value = process.env[key];
  if (value !== undefined && value !== '') return value;
  return dotEnv[key] || '';
}

const CONFIG_TEMPLATE = `// Supabase 프로젝트 연결 정보.
// 이 파일은 scripts/generate_config.py(로컬) 또는 scripts/generate-config.mjs(배포 빌드)가
// 환경변수(SUPABASE_URL/SUPABASE_ANON_KEY/NEWS_API_KEY/API_BASE_URL)로부터 자동 생성합니다.
// 직접 수정하지 마세요 — 다음 빌드/생성 시 덮어써집니다.
//
// anon/public key는 RLS 정책으로 보호되는 것을 전제로 클라이언트에 노출되어도 되는 공개 키입니다.
export const SUPABASE_URL = '{{supabaseUrl}}';
export const SUPABASE_ANON_KEY = '{{supabaseAnonKey}}';

// 채용 뉴스(js/news.js)용 무료 뉴스 API 키. 비어 있으면 js/news.js가 정적 폴백 뉴스로 대체합니다.
export const NEWS_API_KEY = '{{newsApiKey}}';

// Tab1(기업) FastAPI 백엔드(backend/app) 주소. js/api-client.js가 이 값으로 백엔드를 호출합니다.
export const API_BASE_URL = '{{apiBaseUrl}}';
`;

function main() {
  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
  const newsApiKey = getEnv('NEWS_API_KEY');
  const apiBaseUrl = getEnv('API_BASE_URL') || 'http://127.0.0.1:8000';

  if (!supabaseUrl || !supabaseAnonKey) {
    console.error('[ERROR] SUPABASE_URL/SUPABASE_ANON_KEY 환경변수가 비어 있습니다.');
    console.error('        Vercel 프로젝트 설정 > Environment Variables 에서 값을 등록한 뒤 다시 빌드하세요.');
    process.exit(1);
  }

  const content = CONFIG_TEMPLATE
    .replace('{{supabaseUrl}}', supabaseUrl)
    .replace('{{supabaseAnonKey}}', supabaseAnonKey)
    .replace('{{newsApiKey}}', newsApiKey)
    .replace('{{apiBaseUrl}}', apiBaseUrl);

  const configPath = path.join(repoRoot, 'js', 'config.js');
  writeFileSync(configPath, content, { encoding: 'utf-8' });

  console.log('[INFO] js/config.js를 생성했습니다 (SUPABASE_URL/SUPABASE_ANON_KEY 반영).');
  console.log(`[INFO] NEWS_API_KEY: ${newsApiKey ? '반영됨' : '비어 있음 (js/news.js가 폴백 처리)'}`);
  console.log(`[INFO] API_BASE_URL: ${apiBaseUrl}`);
}

main();
