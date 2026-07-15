"""
scripts/generate_config.py

.env 파일의 Supabase 자격증명(SUPABASE_URL, SUPABASE_ANON_KEY)과 선택값(NEWS_API_KEY)을 읽어
js/config.js를 재생성하는 스크립트.

배경: 이 프로젝트는 빌드 도구가 없는 정적 SPA라 브라우저가 .env를 직접 읽을 방법이 없다.
js/config.js는 브라우저에 그대로 로드되는 정적 JS 파일이므로, .env의 값을 이 파일에
"구워(bake)" 넣어야 브라우저 코드(js/supabaseClient.js, js/news.js 등)가 값을 사용할 수 있다.

- 외부 패키지 없이 표준 라이브러리만 사용한다 (scripts/seed_categories.py의 .env 로더 패턴 재사용).
- .env에 SUPABASE_URL/SUPABASE_ANON_KEY 값이 비어 있으면(플레이스홀더 상태) js/config.js를
  절대 덮어쓰지 않고 경고만 출력한다 -- 실수로 기존 파일의 플레이스홀더/주석을 지우는 것을
  방지하기 위함이다.
- NEWS_API_KEY(선택값)는 비어 있어도 에러로 취급하지 않는다 -- js/news.js가 값이 없을 때
  정적 폴백 뉴스로 대체하도록 설계되어 있다.
- client_id/client_secret(원티드 API 키) 등 비밀값은 이 스크립트가 다루지 않는다.
  원티드 API 키는 서버 사이드 전용이며 브라우저에 절대 노출하지 않는다 (.env.example 참고).
- 어떤 키 값도 콘솔에 그대로 출력하지 않는다 (값 존재 여부만 로그로 남긴다).

실행:
    python scripts/generate_config.py
    (또는 python3 scripts/generate_config.py)
"""

import os
import sys

from _common import find_repo_root, load_env

# Windows 콘솔(cp949 등)에서 한글 출력이 깨지는 것을 방지 (Python 3.7+)
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8")


CONFIG_TEMPLATE = """\
// Supabase 프로젝트 연결 정보.
// 이 파일은 scripts/generate_config.py가 .env(SUPABASE_URL/SUPABASE_ANON_KEY/NEWS_API_KEY)로부터
// 자동 생성/갱신합니다. .env를 채운 뒤 `python scripts/generate_config.py`를 실행하세요.
// (.env에 값이 비어 있으면 스크립트가 이 파일을 덮어쓰지 않고 경고만 출력하므로, 지금 보이는
// 플레이스홀더는 수동으로 유지되고 있는 상태입니다.)
//
// anon/public key는 RLS 정책으로 보호되는 것을 전제로 클라이언트에 노출되어도 되는 공개 키입니다.
//
// 참고: 가입 즉시 로그인 상태로 전환되려면(PRD 2장, DB.md 1장) Supabase 대시보드
// Authentication > Providers > Email 에서 "Confirm email"을 꺼야 합니다.
// 이 설정은 Supabase 프로젝트 관리 콘솔에서 수동으로 처리해야 하는 부분이며 이번 프런트엔드
// 코드 작업 범위에 포함되지 않습니다.
export const SUPABASE_URL = '{supabase_url}';
export const SUPABASE_ANON_KEY = '{supabase_anon_key}';

// 채용 뉴스(js/news.js)용 무료 뉴스 API 키. 비어 있으면 js/news.js가 정적 폴백 뉴스로 대체합니다.
// 참고: 무료 플랜(NewsAPI.org/GNews.io 등)은 브라우저 직접 호출을 localhost로 제한하거나
// 상업적 이용을 금지하는 경우가 많아, 값이 있어도 프로덕션 도메인에서는 자동 폴백될 수 있습니다.
export const NEWS_API_KEY = '{news_api_key}';
"""


def main():
    repo_root = find_repo_root(os.path.dirname(os.path.abspath(__file__)))
    env = load_env(os.path.join(repo_root, ".env"))

    supabase_url = env.get("SUPABASE_URL", "").strip()
    supabase_anon_key = env.get("SUPABASE_ANON_KEY", "").strip()
    news_api_key = env.get("NEWS_API_KEY", "").strip()

    if not supabase_url or not supabase_anon_key:
        print("[WARN] .env에 SUPABASE_URL/SUPABASE_ANON_KEY 값이 비어 있습니다.", file=sys.stderr)
        print("       js/config.js는 변경하지 않습니다 (기존 플레이스홀더를 그대로 유지합니다).", file=sys.stderr)
        print("       Supabase 대시보드 > Project Settings > API 에서 값을 확인해 .env를 채운 뒤",
              file=sys.stderr)
        print("       다시 실행하세요: python scripts/generate_config.py", file=sys.stderr)
        return

    config_path = os.path.join(repo_root, "js", "config.js")
    content = CONFIG_TEMPLATE.format(
        supabase_url=supabase_url,
        supabase_anon_key=supabase_anon_key,
        news_api_key=news_api_key,
    )
    with open(config_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(content)

    print("[INFO] js/config.js를 갱신했습니다 (SUPABASE_URL/SUPABASE_ANON_KEY 반영).")
    print("[INFO] NEWS_API_KEY: {}".format("반영됨" if news_api_key else "비어 있음 (js/news.js가 폴백 처리)"))


if __name__ == "__main__":
    main()
