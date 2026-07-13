"""채용공고(JobPosting) CRUD API (PRD 4.5절, DB.md 3.8/3.8.1절)."""

from datetime import datetime, timezone
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.categories import validate_category_id, validate_category_ids
from app.deps import get_current_company_profile
from app.models import JobPostingCreate, JobPostingResponse, JobPostingStatus, JobPostingUpdate
from app.supabase_client import get_service_client, maybe_single_data

router = APIRouter(prefix="/company/job-postings", tags=["job-postings"])


def _load_position_detail_ids(service, job_posting_id: str) -> List[str]:
    resp = (
        service.table("job_posting_position_details")
        .select("position_detail_category_id")
        .eq("job_posting_id", job_posting_id)
        .execute()
    )
    return [row["position_detail_category_id"] for row in (resp.data or [])]


def _to_response(posting: dict, detail_ids: List[str]) -> JobPostingResponse:
    return JobPostingResponse(**posting, position_detail_category_ids=detail_ids)


def _get_owned_posting(service, job_posting_id: str, company_profile_id: str) -> dict:
    posting = maybe_single_data(
        service.table("job_postings").select("*").eq("id", job_posting_id).maybe_single()
    )
    if not posting or posting["company_profile_id"] != company_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="채용공고를 찾을 수 없습니다.")
    return posting


@router.post("", response_model=JobPostingResponse, status_code=status.HTTP_201_CREATED)
def create_job_posting(
    body: JobPostingCreate,
    company_profile: dict = Depends(get_current_company_profile),
):
    service = get_service_client()

    validate_category_id(body.position_category_id, "JOB", "position_category_id")
    validate_category_ids(body.position_detail_category_ids, "JOB", "position_detail_category_ids")

    now = datetime.now(timezone.utc).isoformat()
    insert_payload = {
        "company_profile_id": company_profile["id"],
        "position_category_id": str(body.position_category_id),
        "employment_type": body.employment_type,
        "annual_from": body.annual_from,
        "annual_to": body.annual_to,
        "status": body.status,
    }
    if body.status == "active":
        insert_payload["posted_at"] = now
    elif body.status == "close":
        insert_payload["closed_at"] = now

    try:
        resp = service.table("job_postings").insert(insert_payload).execute()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="채용공고 생성에 실패했습니다. 입력값을 확인해주세요.")

    posting = resp.data[0]

    if body.position_detail_category_ids:
        detail_rows = [
            {"job_posting_id": posting["id"], "position_detail_category_id": str(did)}
            for did in body.position_detail_category_ids
        ]
        try:
            service.table("job_posting_position_details").insert(detail_rows).execute()
        except Exception:
            service.table("job_postings").delete().eq("id", posting["id"]).execute()
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="직무 상세 저장에 실패했습니다.")

    if body.status in ("active", "close"):
        action_type = "POSTED" if body.status == "active" else "CLOSED"
        service.table("interaction_logs").insert(
            {
                "actor_user_id": company_profile["user_id"],
                "action_type": action_type,
                "target_job_posting_id": posting["id"],
            }
        ).execute()

    return _to_response(posting, [str(did) for did in body.position_detail_category_ids])


@router.get("", response_model=List[JobPostingResponse])
def list_job_postings(
    status_filter: Optional[JobPostingStatus] = Query(None, alias="status"),
    company_profile: dict = Depends(get_current_company_profile),
):
    service = get_service_client()
    query = (
        service.table("job_postings")
        .select("*")
        .eq("company_profile_id", company_profile["id"])
        .order("created_at", desc=True)
    )
    if status_filter:
        query = query.eq("status", status_filter)
    resp = query.execute()
    postings = resp.data or []

    if not postings:
        return []

    posting_ids = [p["id"] for p in postings]
    detail_resp = (
        service.table("job_posting_position_details")
        .select("job_posting_id, position_detail_category_id")
        .in_("job_posting_id", posting_ids)
        .execute()
    )
    details_by_posting: dict = {}
    for row in detail_resp.data or []:
        details_by_posting.setdefault(row["job_posting_id"], []).append(row["position_detail_category_id"])

    return [_to_response(p, details_by_posting.get(p["id"], [])) for p in postings]


@router.get("/{job_posting_id}", response_model=JobPostingResponse)
def get_job_posting(
    job_posting_id: str,
    company_profile: dict = Depends(get_current_company_profile),
):
    service = get_service_client()
    posting = _get_owned_posting(service, job_posting_id, company_profile["id"])
    detail_ids = _load_position_detail_ids(service, job_posting_id)
    return _to_response(posting, detail_ids)


@router.put("/{job_posting_id}", response_model=JobPostingResponse)
def update_job_posting(
    job_posting_id: str,
    body: JobPostingUpdate,
    company_profile: dict = Depends(get_current_company_profile),
):
    service = get_service_client()
    posting = _get_owned_posting(service, job_posting_id, company_profile["id"])

    fields = body.model_dump(exclude_unset=True, exclude={"position_detail_category_ids", "status"})

    if "position_category_id" in fields and fields["position_category_id"] is not None:
        validate_category_id(fields["position_category_id"], "JOB", "position_category_id")

    update_payload = {k: (str(v) if isinstance(v, UUID) else v) for k, v in fields.items()}

    now = datetime.now(timezone.utc).isoformat()
    log_action_type = None

    if body.status is not None and body.status != posting["status"]:
        update_payload["status"] = body.status
        if body.status == "active":
            if posting.get("posted_at") is None:
                update_payload["posted_at"] = now
            log_action_type = "POSTED"
        elif body.status == "close":
            update_payload["closed_at"] = now
            log_action_type = "CLOSED"

    if not update_payload:
        detail_ids = _load_position_detail_ids(service, job_posting_id)
        return _to_response(posting, detail_ids)

    update_payload["updated_at"] = now
    try:
        service.table("job_postings").update(update_payload).eq("id", job_posting_id).execute()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="채용공고 수정에 실패했습니다. 입력값을 확인해주세요.")

    if body.position_detail_category_ids is not None:
        validate_category_ids(body.position_detail_category_ids, "JOB", "position_detail_category_ids")
        try:
            service.table("job_posting_position_details").delete().eq("job_posting_id", job_posting_id).execute()
            if body.position_detail_category_ids:
                detail_rows = [
                    {"job_posting_id": job_posting_id, "position_detail_category_id": str(did)}
                    for did in body.position_detail_category_ids
                ]
                service.table("job_posting_position_details").insert(detail_rows).execute()
        except Exception:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="직무 상세 수정에 실패했습니다.")

    if log_action_type:
        service.table("interaction_logs").insert(
            {
                "actor_user_id": company_profile["user_id"],
                "action_type": log_action_type,
                "target_job_posting_id": job_posting_id,
            }
        ).execute()

    updated_posting = maybe_single_data(
        service.table("job_postings").select("*").eq("id", job_posting_id).maybe_single()
    )
    if not updated_posting:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="채용공고 조회에 실패했습니다.")
    detail_ids = _load_position_detail_ids(service, job_posting_id)
    return _to_response(updated_posting, detail_ids)


@router.delete("/{job_posting_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_job_posting(
    job_posting_id: str,
    company_profile: dict = Depends(get_current_company_profile),
):
    service = get_service_client()
    _get_owned_posting(service, job_posting_id, company_profile["id"])
    try:
        service.table("job_postings").delete().eq("id", job_posting_id).execute()
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="채용공고 삭제에 실패했습니다.")
    return None
