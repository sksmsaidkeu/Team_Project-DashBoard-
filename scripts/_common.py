"""
scripts/_common.py

네 스크립트(fetch_wanted_trend.py / seed_categories.py / import_wanted_data.py / generate_config.py)가
공통으로 쓰던 .env 로더와 Supabase REST upsert 헬퍼를 한 곳에 모은 모듈.
(common 브랜치 REFACT.md P1-6과 동일한 리팩터를 이 브랜치에도 적용) 각 스크립트는
이 파일을 `from _common import ...`로 가져다 쓴다. 스크립트가 `python scripts/xxx.py`로
직접 실행되면 Python이 scripts/ 디렉터리를 sys.path에 자동으로 추가하므로 별도
패키지 설정 없이 임포트된다.
"""

import json
import os
import urllib.request
import urllib.error


def find_repo_root(start):
    """.env 파일을 담고 있는 디렉터리를 상위로 탐색해 찾는다."""
    d = start
    while True:
        if os.path.isfile(os.path.join(d, ".env")):
            return d
        parent = os.path.dirname(d)
        if parent == d:
            return start
        d = parent


def load_env(path):
    """외부 dotenv 패키지 없이 KEY=VALUE 형식의 .env를 직접 파싱한다."""
    env = {}
    if not os.path.isfile(path):
        return env
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip()
    return env


def supabase_upsert(supabase_url, service_role_key, table, rows, on_conflict):
    """Supabase REST(PostgREST)로 upsert한다. return=representation으로 반영된 행을 그대로 받는다."""
    if not rows:
        return []
    url = "{}/rest/v1/{}?on_conflict={}".format(supabase_url.rstrip("/"), table, on_conflict)
    body = json.dumps(rows).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "apikey": service_role_key,
            "Authorization": "Bearer {}".format(service_role_key),
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", errors="replace")
        raise RuntimeError("Supabase upsert HTTPError {} ({}): {}".format(e.code, table, detail)) from e
    except urllib.error.URLError as e:
        raise RuntimeError("Supabase 연결 실패({}): {}".format(table, e)) from e


def is_placeholder(value):
    return not value or "YOUR_" in value.upper() or "YOUR-" in value.upper()
