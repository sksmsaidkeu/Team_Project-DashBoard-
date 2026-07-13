"""기업 프로필(CompanyProfile) 조회/생성/수정 API (PRD 4.1절, DB.md 3.3/3.4절)."""

from datetime import datetime, timezone
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status

from app.categories import validate_category_id, validate_category_ids
from app.deps import CurrentUser, require_company_user
from app.models import CompanyProfileCreate, CompanyProfileResponse, CompanyProfileUpdate
from app.supabase_client import get_service_client, maybe_single_data

router = APIRouter(prefix="/company/profile", tags=["company-profile"])


def _load_skill_ids(service, company_profile_id: str) -> List[str]:
    resp = (
        service.table("company_profile_skills")
        .select("skill_category_id")
        .eq("company_profile_id", company_profile_id)
        .execute()
    )
    return [row["skill_category_id"] for row in (resp.data or [])]


def _to_response(profile: dict, skill_ids: List[str]) -> CompanyProfileResponse:
    return CompanyProfileResponse(**profile, skill_category_ids=skill_ids)


@router.get("", response_model=CompanyProfileResponse)
def get_my_company_profile(current_user: CurrentUser = Depends(require_company_user)):
    service = get_service_client()
    profile = maybe_single_data(
        service.table("company_profiles").select("*").eq("user_id", current_user.id).maybe_single()
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="기업 프로필이 존재하지 않습니다.")
    skill_ids = _load_skill_ids(service, profile["id"])
    return _to_response(profile, skill_ids)


@router.post("", response_model=CompanyProfileResponse, status_code=status.HTTP_201_CREATED)
def create_my_company_profile(
    body: CompanyProfileCreate,
    current_user: CurrentUser = Depends(require_company_user),
):
    service = get_service_client()

    existing = maybe_single_data(
        service.table("company_profiles").select("id").eq("user_id", current_user.id).maybe_single()
    )
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="이미 기업 프로필이 존재합니다.")

    validate_category_id(body.industry_category_id, "INDUSTRY", "industry_category_id")
    validate_category_id(body.region_category_id, "REGION", "region_category_id")
    validate_category_id(body.position_category_id, "JOB", "position_category_id")
    validate_category_ids(body.skill_category_ids, "SKILL", "skill_category_ids")

    insert_payload = {
        "user_id": current_user.id,
        "industry_category_id": str(body.industry_category_id),
        "company_size": body.company_size,
        "region_category_id": str(body.region_category_id),
        "position_category_id": str(body.position_category_id),
        "employment_type": body.employment_type,
        "average_salary": body.average_salary,
        "hired_salary": body.hired_salary,
    }

    try:
        resp = service.table("company_profiles").insert(insert_payload).execute()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="기업 프로필 생성에 실패했습니다.")

    profile = resp.data[0]

    if body.skill_category_ids:
        skill_rows = [
            {"company_profile_id": profile["id"], "skill_category_id": str(sid)}
            for sid in body.skill_category_ids
        ]
        try:
            service.table("company_profile_skills").insert(skill_rows).execute()
        except Exception:
            # 스킬 저장 실패 시 프로필만 남는 것을 막기 위해 롤백 시도(단일 SQL 트랜잭션이 아니므로 최선 노력).
            service.table("company_profiles").delete().eq("id", profile["id"]).execute()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="필요 스킬 저장에 실패했습니다.")

    return _to_response(profile, [str(sid) for sid in body.skill_category_ids])


@router.put("", response_model=CompanyProfileResponse)
def update_my_company_profile(
    body: CompanyProfileUpdate,
    current_user: CurrentUser = Depends(require_company_user),
):
    service = get_service_client()
    existing = maybe_single_data(
        service.table("company_profiles").select("id").eq("user_id", current_user.id).maybe_single()
    )
    if not existing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="기업 프로필이 존재하지 않습니다.")
    profile_id = existing["id"]

    # exclude_unset=True: 요청 JSON에 실제로 포함된 필드만 반영한다(값을 null로 명시한 것과
    # 필드를 아예 보내지 않은 것을 구분하기 위함).
    fields = body.model_dump(exclude_unset=True, exclude={"skill_category_ids"})

    if "industry_category_id" in fields and fields["industry_category_id"] is not None:
        validate_category_id(fields["industry_category_id"], "INDUSTRY", "industry_category_id")
    if "region_category_id" in fields and fields["region_category_id"] is not None:
        validate_category_id(fields["region_category_id"], "REGION", "region_category_id")
    if "position_category_id" in fields and fields["position_category_id"] is not None:
        validate_category_id(fields["position_category_id"], "JOB", "position_category_id")

    update_payload = {k: (str(v) if isinstance(v, UUID) else v) for k, v in fields.items()}

    if update_payload:
        update_payload["updated_at"] = datetime.now(timezone.utc).isoformat()
        try:
            service.table("company_profiles").update(update_payload).eq("id", profile_id).execute()
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="기업 프로필 수정에 실패했습니다. 입력값을 확인해주세요.")

    if body.skill_category_ids is not None:
        validate_category_ids(body.skill_category_ids, "SKILL", "skill_category_ids")
        try:
            service.table("company_profile_skills").delete().eq("company_profile_id", profile_id).execute()
            if body.skill_category_ids:
                skill_rows = [
                    {"company_profile_id": profile_id, "skill_category_id": str(sid)}
                    for sid in body.skill_category_ids
                ]
                service.table("company_profile_skills").insert(skill_rows).execute()
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="필요 스킬 수정에 실패했습니다.")

    profile = maybe_single_data(
        service.table("company_profiles").select("*").eq("id", profile_id).maybe_single()
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="기업 프로필 조회에 실패했습니다.")
    skill_ids = _load_skill_ids(service, profile_id)
    return _to_response(profile, skill_ids)
