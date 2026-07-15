"""Vercel Python 서버리스 함수 진입점.

backend/를 Vercel 프로젝트 루트로 배포할 때, Vercel의 Python 런타임이
`app` 이름의 ASGI 콜러블을 찾는 규칙을 그대로 이용한다 — 실제 앱 정의는
그대로 backend/app/main.py에 두고 여기서는 재수출만 한다.
"""

from app.main import app  # noqa: F401
