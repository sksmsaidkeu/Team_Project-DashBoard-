"""카테고리 ID 유효성 검증.

PRD 2장/DB.md 1장: 업종/직무/스킬/지역 입력은 자유 텍스트가 아닌 categories 테이블의 실제 존재하는
행(id)만 허용하며, category_type이 기대하는 값과 일치해야 한다.
"""

from typing import Iterable
from uuid import UUID

from fastapi import HTTPException, status

from app.supabase_client import get_service_client, maybe_single_data


def validate_category_id(category_id: UUID, expected_type: str, field_name: str) -> dict:
    service = get_service_client()
    row = maybe_single_data(
        service.table("categories")
        .select("id, category_type")
        .eq("id", str(category_id))
        .maybe_single()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name}: 존재하지 않는 카테고리입니다.",
        )
    if row["category_type"] != expected_type:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name}: category_type이 '{expected_type}'이어야 합니다.",
        )
    return row


def validate_category_ids(category_ids: Iterable[UUID], expected_type: str, field_name: str) -> None:
    ids = list(dict.fromkeys(str(cid) for cid in category_ids))  # 중복 제거, 순서 유지
    if not ids:
        return

    service = get_service_client()
    resp = service.table("categories").select("id, category_type").in_("id", ids).execute()
    rows = resp.data or []

    found_ids = {row["id"] for row in rows}
    missing = [cid for cid in ids if cid not in found_ids]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name}: 존재하지 않는 카테고리 ID가 있습니다: {missing}",
        )

    wrong_type = [row["id"] for row in rows if row["category_type"] != expected_type]
    if wrong_type:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{field_name}: category_type이 '{expected_type}'이 아닌 항목이 있습니다: {wrong_type}",
        )
