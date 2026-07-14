// Supabase 프로젝트 연결 정보
// anon/public key는 RLS 정책으로 보호되는 것을 전제로 클라이언트에 노출되어도 되는 공개 키입니다.
export const SUPABASE_URL = 'https://cnliejhptnbkwibbjzcx.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNubGllamhwdG5ia3dpYmJqemN4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM5MjIzODcsImV4cCI6MjA5OTQ5ODM4N30.OBNbXFQDxBBcROdKwzD4IniIc_IPwEVSjffF8DZvTa0';

// Supabase Edge Functions (백엔드 API)
export const SUPABASE_FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;
