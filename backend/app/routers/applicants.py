"""지원자 관리 API (interaction_logs의 APPLY/VIEW 액션 기준, DB.md 3.9절).

- 특정 채용공고에 지원(action_type='APPLY', target_job_posting_id=공고 id)한 구직자 목록을 조회한다.
- 기업이 지원자 프로필을 열람하면 action_type='VIEW'(target_jobseeker_profile_id=구직자 프로필 id)
  로그를 남겨 "열람 처리" 상태를 기록한다.
"""

from typing import Dict, List, Set

from fastapi import APIRouter, Depends, HTTPException, status

from app.deps import get_current_company_profile
from app.models import ApplicantResponse
from app.supabase_client import get_service_client, maybe_single_data

router = APIRouter(prefix="/company/job-postings/{job_posting_id}/applicants", tags=["applicants"])


def _get_owned_posting_id(service, job_posting_id: str, company_profile_id: str) -> str:
    posting = maybe_single_data(
        service.table("job_postings")
        .select("id, company_profile_id")
        .eq("id", job_posting_id)
        .maybe_single()
    )
    if not posting or posting["company_profile_id"] != company_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="채용공고를 찾을 수 없습니다.")
    return posting["id"]


@router.get("", response_model=List[ApplicantResponse])
def list_applicants(
    job_posting_id: str,
    company_profile: dict = Depends(get_current_company_profile),
):
    service = get_service_client()
    _get_owned_posting_id(service, job_posting_id, company_profile["id"])

    apply_logs_resp = (
        service.table("interaction_logs")
        .select("actor_user_id, created_at")
        .eq("action_type", "APPLY")
        .eq("target_job_posting_id", job_posting_id)
        .order("created_at", desc=True)
        .execute()
    )
    apply_logs = apply_logs_resp.data or []
    if not apply_logs:
        return []

    applied_at_by_user: Dict[str, str] = {}
    for row in apply_logs:
        # 동일 지원자가 같은 공고에 여러 번 APPLY 로그를 남긴 경우 최초 지원 시각을 사용한다.
        uid = row["actor_user_id"]
        if uid not in applied_at_by_user or row["created_at"] < applied_at_by_user[uid]:
            applied_at_by_user[uid] = row["created_at"]

    applicant_user_ids = list(applied_at_by_user.keys())

    profiles_resp = (
        service.table("jobseeker_profiles")
        .select(
            "id, user_id, career_years, desired_position_category_id, region_category_id, "
            "desired_salary, desired_employment_type, is_region_public, is_salary_public"
        )
        .in_("user_id", applicant_user_ids)
        .execute()
    )
    profiles = profiles_resp.data or []
    if not profiles:
        return []

    profile_ids = [p["id"] for p in profiles]

    skills_resp = (
        service.table("jobseeker_profile_skills")
        .select("jobseeker_profile_id, skill_category_id")
        .in_("jobseeker_profile_id", profile_ids)
        .execute()
    )
    skills_by_profile: Dict[str, List[str]] = {}
    for row in skills_resp.data or []:
        skills_by_profile.setdefault(row["jobseeker_profile_id"], []).append(row["skill_category_id"])

    view_logs_resp = (
        service.table("interaction_logs")
        .select("target_jobseeker_profile_id")
        .eq("action_type", "VIEW")
        .eq("actor_user_id", company_profile["user_id"])
        .in_("target_jobseeker_profile_id", profile_ids)
        .execute()
    )
    viewed_profile_ids: Set[str] = {row["target_jobseeker_profile_id"] for row in (view_logs_resp.data or [])}

    results = []
    for p in profiles:
        results.append(
            ApplicantResponse(
                jobseeker_profile_id=p["id"],
                applied_at=applied_at_by_user[p["user_id"]],
                viewed=p["id"] in viewed_profile_ids,
                career_years=p["career_years"],
                desired_position_category_id=p["desired_position_category_id"],
                region_category_id=p["region_category_id"] if p["is_region_public"] else None,
                desired_salary=p["desired_salary"] if p["is_salary_public"] else None,
                desired_employment_type=p["desired_employment_type"],
                skill_category_ids=skills_by_profile.get(p["id"], []),
            )
        )

    results.sort(key=lambda r: r.applied_at, reverse=True)
    return results


@router.post("/{jobseeker_profile_id}/view", status_code=status.HTTP_204_NO_CONTENT)
def mark_applicant_viewed(
    job_posting_id: str,
    jobseeker_profile_id: str,
    company_profile: dict = Depends(get_current_company_profile),
):
    service = get_service_client()
    _get_owned_posting_id(service, job_posting_id, company_profile["id"])

    profile = maybe_single_data(
        service.table("jobseeker_profiles").select("id, user_id").eq("id", jobseeker_profile_id).maybe_single()
    )
    if not profile:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="지원자를 찾을 수 없습니다.")

    apply_check = maybe_single_data(
        service.table("interaction_logs")
        .select("id")
        .eq("action_type", "APPLY")
        .eq("target_job_posting_id", job_posting_id)
        .eq("actor_user_id", profile["user_id"])
        .maybe_single()
    )
    if not apply_check:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="해당 공고에 지원한 이력이 없습니다.")

    try:
        service.table("interaction_logs").insert(
            {
                "actor_user_id": company_profile["user_id"],
                "action_type": "VIEW",
                "target_jobseeker_profile_id": jobseeker_profile_id,
            }
        ).execute()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="열람 처리에 실패했습니다.")
    return None
