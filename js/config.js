// Supabase 프로젝트 연결 정보.
// Supabase 대시보드 > Project Settings > API 에서 값을 복사해 아래를 채워주세요.
// anon/public key는 RLS 정책으로 보호되는 것을 전제로 클라이언트에 노출되어도 되는 공개 키입니다.
//
// 참고: 가입 즉시 로그인 상태로 전환되려면(PRD 2장, DB.md 1장) Supabase 대시보드
// Authentication > Providers > Email 에서 "Confirm email"을 꺼야 합니다.
// 이 설정은 Supabase 프로젝트 관리 콘솔에서 수동으로 처리해야 하는 부분이며 이번 프런트엔드
// 코드 작업 범위에 포함되지 않습니다.
export const SUPABASE_URL = 'https://cnliejhptnbkwibbjzcx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubGllamhwdG5ia3dpYmJqemN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjIzODcsImV4cCI6MjA5OTQ5ODM4N30.OBNbXFQDxBBcROdKwzD4IniIc_IPwEVSjffF8DZvTa0';

// Tab1(기업) FastAPI 백엔드(backend/app) 주소. 로컬 개발 시 uvicorn 기본 포트(8000) 기준.
// 배포 시 실제 백엔드 주소로 교체한다.
export const API_BASE_URL = 'http://127.0.0.1:8000';
