"""인증/인가 의존성.

FastAPI 라우터는 아래 순서를 따른다: 입력 검증(Pydantic) -> 인증/인가(이 모듈의 Depends) ->
비즈니스 로직(라우터 함수 본문) -> 응답.
"""

from dataclasses import dataclass
from typing import Optional

from fastapi import Depends, Header, HTTPException, status

from app.supabase_client import get_anon_client, get_service_client, maybe_single_data


@dataclass
class CurrentUser:
    id: str
    user_type: Optional[str]  # DB.md 3.1절 users.user_type: 'COMPANY' | 'JOBSEEKER' | None(아직 users 행 없음)


def _extract_bearer_token(authorization: Optional[str] = Header(None)) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authorization: Bearer <access_token> 헤더가 필요합니다.",
        )
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않은 토큰입니다.")
    return token


def get_current_user(token: str = Depends(_extract_bearer_token)) -> CurrentUser:
    """Supabase Auth가 발급한 access token을 검증하고, users 테이블의 user_type을 조회한다."""
    anon = get_anon_client()
    try:
        auth_result = anon.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않거나 만료된 토큰입니다.")

    auth_user = getattr(auth_result, "user", None)
    if not auth_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="유효하지 않거나 만료된 토큰입니다.")

    service = get_service_client()
    data = maybe_single_data(
        service.table("users").select("id, user_type").eq("id", auth_user.id).maybe_single()
    )
    if not data:
        # auth.users에는 있으나 아직 public.users 확장 행이 없는 상태(가입 직후 등)
        return CurrentUser(id=auth_user.id, user_type=None)
    return CurrentUser(id=data["id"], user_type=data["user_type"])


def require_company_user(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current_user.user_type != "COMPANY":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="기업 회원만 접근할 수 있습니다.")
    return current_user


def get_current_company_profile(current_user: CurrentUser = Depends(require_company_user)) -> dict:
    """로그인한 기업 회원의 company_profiles 행을 반환한다. 없으면 404."""
    service = get_service_client()
    profile = maybe_single_data(
        service.table("company_profiles").select("*").eq("user_id", current_user.id).maybe_single()
    )
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="기업 프로필이 존재하지 않습니다. 먼저 기업 프로필을 생성하세요.",
        )
    return profile
