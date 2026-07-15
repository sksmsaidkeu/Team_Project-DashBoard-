"""Supabase 클라이언트 모듈.

- anon 클라이언트: 프런트엔드가 보낸 사용자 Access Token(JWT)의 유효성을 Supabase Auth 서버에
  직접 검증(auth.get_user)하는 용도로만 사용한다.
- service 클라이언트: service_role 키를 사용해 RLS를 우회한다. 이 백엔드는 각 라우터에서
  요청자의 user_id/company_profile_id 소유권을 코드로 직접 검증하므로, DB 접근 자체는
  service_role로 수행하고 인가(authorization)는 애플리케이션 레벨에서 책임진다.
"""

from functools import lru_cache
from typing import Optional

from supabase import Client, create_client

from app.config import get_settings


@lru_cache
def get_anon_client() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_anon_key)


@lru_cache
def get_service_client() -> Client:
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_key)


def maybe_single_data(builder) -> Optional[dict]:
    """`.select(...).maybe_single()` 체이닝 뒤 `.execute()`를 대신 호출하는 헬퍼.

    postgrest-py는 조회 결과가 0건이면 `execute()`가 응답 객체가 아니라 `None`을 그대로 반환한다
    (1건이면 `SingleAPIResponse`). 매번 `resp is None` 분기 처리를 반복하지 않도록 이 헬퍼에서
    0건이면 `None`, 1건이면 `.data`(dict)를 반환하도록 통일한다.
    """
    resp = builder.execute()
    return None if resp is None else resp.data
