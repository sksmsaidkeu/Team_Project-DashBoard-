"""인재 검색 API (PRD 5장 1단계 하드 필터, jobseeker_profiles 기준).

DB.md 3.5절 jobseeker_profiles를 직무(desired_position_category_id)/지역(region_category_id)/
희망근무형태(desired_employment_type)/희망연봉(desired_salary)/스킬(jobseeker_profile_skills)
기준으로 하드 필터링한다. 비공개(is_region_public=false 또는 is_salary_public=false) 인재는
검색 결과 자체에서 제외한다 — js/tab-company.js에 이미 구현된 프런트엔드 하드 필터와 동일한 정책이다.

sort=score 파라미터를 주면 PRD 5장 소프트 스코어링 가중치(스킬 40%/직무 25%/지역·연봉 15%/활동성 10%/
최신성 10%)를 반영한 근사 점수를 함께 계산한다. 직무·지역은 이미 하드 필터로 일치가 보장되므로
해당 항목은 고정 배점으로 처리하는 단순화된 구현이다.
"""

from datetime import datetime
from typing import Dict, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.categories import validate_category_id
from app.deps import get_current_company_profile
from app.models import EmploymentType, TalentCandidateResponse
from app.supabase_client import get_service_client

router = APIRouter(prefix="/company/talent-search", tags=["talent-search"])

WEIGHT_SKILL = 40
WEIGHT_POSITION = 25
WEIGHT_REGION_SALARY = 15
WEIGHT_ACTIVITY = 10
WEIGHT_RECENCY = 10


def _parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _parse_uuid_list(raw: Optional[str]) -> Optional[List[UUID]]:
    if raw is None:
        return None
    items = [item.strip() for item in raw.split(",") if item.strip()]
    try:
        return [UUID(item) for item in items]
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="skill_category_ids 형식이 올바르지 않습니다(UUID 콤마 구분 목록이어야 함).",
        )


@router.get("", response_model=List[TalentCandidateResponse])
def search_talents(
    position_category_id: Optional[UUID] = Query(None, description="미지정 시 자사 등록 직무로 필터링"),
    region_category_id: Optional[UUID] = Query(None, description="미지정 시 자사 등록 지역으로 필터링"),
    employment_type: Optional[EmploymentType] = Query(None),
    skill_category_ids: Optional[str] = Query(
        None, description="콤마로 구분된 SKILL category_id 목록. 미지정 시 자사 등록 필요 스킬 사용"
    ),
    min_career_years: Optional[int] = Query(None, ge=0),
    max_career_years: Optional[int] = Query(None, ge=0),
    max_desired_salary: Optional[int] = Query(None, ge=0),
    sort: Optional[str] = Query(None, pattern="^(score)$"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    company_profile: dict = Depends(get_current_company_profile),
):
    service = get_service_client()

    if position_category_id is not None:
        validate_category_id(position_category_id, "JOB", "position_category_id")
    if region_category_id is not None:
        validate_category_id(region_category_id, "REGION", "region_category_id")

    effective_position_id = position_category_id or UUID(company_profile["position_category_id"])
    effective_region_id = region_category_id or UUID(company_profile["region_category_id"])

    parsed_skill_ids = _parse_uuid_list(skill_category_ids)
    if parsed_skill_ids is None:
        skill_resp = (
            service.table("company_profile_skills")
            .select("skill_category_id")
            .eq("company_profile_id", company_profile["id"])
            .execute()
        )
        required_skill_ids = [row["skill_category_id"] for row in (skill_resp.data or [])]
    else:
        required_skill_ids = [str(sid) for sid in parsed_skill_ids]

    query = (
        service.table("jobseeker_profiles")
        .select(
            "id, career_years, desired_salary, desired_employment_type, "
            "desired_position_category_id, region_category_id, updated_at"
        )
        .eq("is_region_public", True)
        .eq("is_salary_public", True)
        .eq("desired_position_category_id", str(effective_position_id))
        .eq("region_category_id", str(effective_region_id))
    )
    if employment_type:
        query = query.eq("desired_employment_type", employment_type)
    if min_career_years is not None:
        query = query.gte("career_years", min_career_years)
    if max_career_years is not None:
        query = query.lte("career_years", max_career_years)
    if max_desired_salary is not None:
        query = query.lte("desired_salary", max_desired_salary)

    resp = query.execute()
    candidates = resp.data or []
    if not candidates:
        return []

    candidate_ids = [c["id"] for c in candidates]
    skills_by_candidate: Dict[str, List[str]] = {}
    skill_rows_resp = (
        service.table("jobseeker_profile_skills")
        .select("jobseeker_profile_id, skill_category_id")
        .in_("jobseeker_profile_id", candidate_ids)
        .execute()
    )
    for row in skill_rows_resp.data or []:
        skills_by_candidate.setdefault(row["jobseeker_profile_id"], []).append(row["skill_category_id"])

    required_set = set(required_skill_ids)
    filtered = []
    for c in candidates:
        owned_skills = skills_by_candidate.get(c["id"], [])
        matched = [sid for sid in owned_skills if sid in required_set]
        if required_set and not matched:
            continue
        c["matched_skill_category_ids"] = matched
        filtered.append(c)

    if not filtered:
        return []

    activity_counts: Dict[str, int] = {}
    if sort == "score":
        log_resp = (
            service.table("interaction_logs")
            .select("target_jobseeker_profile_id")
            .in_("target_jobseeker_profile_id", [c["id"] for c in filtered])
            .execute()
        )
        for row in log_resp.data or []:
            tid = row["target_jobseeker_profile_id"]
            activity_counts[tid] = activity_counts.get(tid, 0) + 1

    updated_ats = [_parse_ts(c["updated_at"]) for c in filtered]
    newest = max(updated_ats)
    oldest = min(updated_ats)
    max_activity = max(activity_counts.values()) if activity_counts else 0

    results: List[TalentCandidateResponse] = []
    for c in filtered:
        score = None
        if sort == "score":
            skill_score = (
                (len(c["matched_skill_category_ids"]) / len(required_set)) * WEIGHT_SKILL
                if required_set
                else float(WEIGHT_SKILL)
            )
            position_score = WEIGHT_POSITION  # 하드 필터로 이미 직무 일치가 보장됨
            region_salary_score = WEIGHT_REGION_SALARY  # 하드 필터로 이미 지역 일치가 보장됨
            activity_score = (activity_counts.get(c["id"], 0) / max_activity) * WEIGHT_ACTIVITY if max_activity else 0.0
            if newest != oldest:
                recency_score = ((_parse_ts(c["updated_at"]) - oldest) / (newest - oldest)) * WEIGHT_RECENCY
            else:
                recency_score = float(WEIGHT_RECENCY)
            score = round(skill_score + position_score + region_salary_score + activity_score + recency_score, 2)

        results.append(
            TalentCandidateResponse(
                jobseeker_profile_id=c["id"],
                desired_position_category_id=c["desired_position_category_id"],
                career_years=c["career_years"],
                region_category_id=c["region_category_id"],
                desired_salary=c["desired_salary"],
                desired_employment_type=c["desired_employment_type"],
                matched_skill_category_ids=c["matched_skill_category_ids"],
                score=score,
            )
        )

    if sort == "score":
        results.sort(key=lambda r: (r.score or 0), reverse=True)

    return results[offset : offset + limit]
