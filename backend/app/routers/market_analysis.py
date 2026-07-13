"""채용 시장 분석 집계 API (PRD 7.1절 · P1/v1.1, DB.md 5장).

job_postings.position_category_id/company_profiles.industry_category_id 기준으로
company_profiles.average_salary/hired_salary, job_postings.annual_from/annual_to를 집계하고
posted_at(월별) 기준 게시 건수를 집계한다.

주의: 전체 대상 로우를 읽어와 파이썬에서 집계하는 간이 구현이다. 데이터가 커지면 SQL 집계
(RPC 함수 또는 materialized view)로 전환이 필요하다(DB.md 5장 참고). 이번 범위에서는
'여유가 되면' 구현하는 보너스 기능이라 부트캠프 규모에 맞는 단순한 형태로 작성했다.
"""

from collections import defaultdict
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query

from app.categories import validate_category_id
from app.deps import get_current_company_profile
from app.models import MarketAnalysisResponse
from app.supabase_client import get_service_client

router = APIRouter(prefix="/company/market-analysis", tags=["market-analysis"])


def _avg(values):
    return round(sum(values) / len(values), 2) if values else None


@router.get("", response_model=MarketAnalysisResponse)
def get_market_analysis(
    position_category_id: Optional[UUID] = Query(None, description="미지정 시 자사 등록 직무 기준"),
    industry_category_id: Optional[UUID] = Query(None, description="미지정 시 자사 등록 업종 기준"),
    company_profile: dict = Depends(get_current_company_profile),
):
    service = get_service_client()

    if position_category_id is not None:
        validate_category_id(position_category_id, "JOB", "position_category_id")
    if industry_category_id is not None:
        validate_category_id(industry_category_id, "INDUSTRY", "industry_category_id")

    effective_position_id = position_category_id or UUID(company_profile["position_category_id"])
    effective_industry_id = industry_category_id or UUID(company_profile["industry_category_id"])

    companies_resp = (
        service.table("company_profiles")
        .select("id, average_salary, hired_salary")
        .eq("industry_category_id", str(effective_industry_id))
        .execute()
    )
    companies = companies_resp.data or []
    salary_by_company = {c["id"]: c for c in companies}
    company_ids = list(salary_by_company.keys())

    if not company_ids:
        return MarketAnalysisResponse(
            position_category_id=effective_position_id,
            industry_category_id=effective_industry_id,
            job_posting_count=0,
            average_salary_avg=None,
            hired_salary_avg=None,
            annual_from_avg=None,
            annual_to_avg=None,
            monthly_posting_counts={},
        )

    postings_resp = (
        service.table("job_postings")
        .select("id, company_profile_id, annual_from, annual_to, posted_at, status")
        .eq("position_category_id", str(effective_position_id))
        .in_("company_profile_id", company_ids)
        .execute()
    )
    postings = postings_resp.data or []

    average_salaries = [
        salary_by_company[p["company_profile_id"]]["average_salary"]
        for p in postings
        if salary_by_company[p["company_profile_id"]]["average_salary"] is not None
    ]
    hired_salaries = [
        salary_by_company[p["company_profile_id"]]["hired_salary"]
        for p in postings
        if salary_by_company[p["company_profile_id"]]["hired_salary"] is not None
    ]
    annual_froms = [p["annual_from"] for p in postings if p["annual_from"] is not None]
    annual_tos = [p["annual_to"] for p in postings if p["annual_to"] is not None]

    monthly_counts: dict = defaultdict(int)
    for p in postings:
        if p["status"] == "active" and p["posted_at"]:
            month_key = p["posted_at"][:7]  # "YYYY-MM"
            monthly_counts[month_key] += 1

    return MarketAnalysisResponse(
        position_category_id=effective_position_id,
        industry_category_id=effective_industry_id,
        job_posting_count=len(postings),
        average_salary_avg=_avg(average_salaries),
        hired_salary_avg=_avg(hired_salaries),
        annual_from_avg=_avg(annual_froms),
        annual_to_avg=_avg(annual_tos),
        monthly_posting_counts=dict(monthly_counts),
    )
