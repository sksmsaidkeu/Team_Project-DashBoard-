"""Pydantic 요청/응답 모델.

컬럼명은 모두 DB.md에 정의된 실제 테이블 컬럼명을 그대로 사용한다(원티드 API 변수명 통일 원칙,
DB.md 1.1절). 새 필드를 임의로 추가하지 않는다.
"""

from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, model_validator

EmploymentType = Literal["regular", "contract", "intern"]
JobPostingStatus = Literal["draft", "active", "close"]


# ---------- company_profiles (DB.md 3.3절) ----------


class CompanyProfileCreate(BaseModel):
    industry_category_id: UUID
    company_size: str = Field(..., min_length=1, max_length=100)
    region_category_id: UUID
    position_category_id: UUID
    employment_type: EmploymentType
    average_salary: Optional[int] = Field(None, ge=0)
    hired_salary: Optional[int] = Field(None, ge=0)
    skill_category_ids: List[UUID] = Field(default_factory=list)


class CompanyProfileUpdate(BaseModel):
    """부분 수정. 요청 JSON에 포함되지 않은 필드는 변경하지 않는다(exclude_unset 기준)."""

    industry_category_id: Optional[UUID] = None
    company_size: Optional[str] = Field(None, min_length=1, max_length=100)
    region_category_id: Optional[UUID] = None
    position_category_id: Optional[UUID] = None
    employment_type: Optional[EmploymentType] = None
    average_salary: Optional[int] = Field(None, ge=0)
    hired_salary: Optional[int] = Field(None, ge=0)
    # None(필드 자체를 생략) = 스킬 목록 유지, [] = 전체 삭제, [id, ...] = 해당 목록으로 교체
    skill_category_ids: Optional[List[UUID]] = None


class CompanyProfileResponse(BaseModel):
    id: UUID
    user_id: UUID
    industry_category_id: UUID
    company_size: str
    region_category_id: UUID
    position_category_id: UUID
    employment_type: EmploymentType
    average_salary: Optional[int]
    hired_salary: Optional[int]
    skill_category_ids: List[UUID]
    created_at: datetime
    updated_at: datetime


# ---------- job_postings (DB.md 3.8/3.8.1절) ----------


class JobPostingCreate(BaseModel):
    position_category_id: UUID
    employment_type: EmploymentType
    annual_from: int = Field(0, ge=0)
    annual_to: Optional[int] = Field(None, ge=0)
    status: JobPostingStatus = "draft"
    position_detail_category_ids: List[UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_annual_range(self):
        if self.annual_to is not None and self.annual_to < self.annual_from:
            raise ValueError("annual_to는 annual_from보다 크거나 같아야 합니다.")
        return self


class JobPostingUpdate(BaseModel):
    position_category_id: Optional[UUID] = None
    employment_type: Optional[EmploymentType] = None
    annual_from: Optional[int] = Field(None, ge=0)
    annual_to: Optional[int] = Field(None, ge=0)
    status: Optional[JobPostingStatus] = None
    position_detail_category_ids: Optional[List[UUID]] = None

    @model_validator(mode="after")
    def check_annual_range(self):
        # 둘 다 이번 요청에 포함된 경우에만 앱 레벨에서 우선 검증한다.
        # 한쪽만 바뀌는 경우의 최종 정합성은 DB CHECK 제약(job_postings)이 최후 방어선 역할을 한다.
        if self.annual_from is not None and self.annual_to is not None and self.annual_to < self.annual_from:
            raise ValueError("annual_to는 annual_from보다 크거나 같아야 합니다.")
        return self


class JobPostingResponse(BaseModel):
    id: UUID
    company_profile_id: UUID
    position_category_id: UUID
    employment_type: EmploymentType
    annual_from: int
    annual_to: Optional[int]
    status: JobPostingStatus
    posted_at: Optional[datetime]
    closed_at: Optional[datetime]
    position_detail_category_ids: List[UUID]
    applicant_count: int  # interaction_logs(action_type='APPLY', target_job_posting_id=이 공고)의 행 수
    created_at: datetime
    updated_at: datetime


# ---------- 인재 검색 (PRD 5장 하드 필터, jobseeker_profiles 기준) ----------


class TalentCandidateResponse(BaseModel):
    jobseeker_profile_id: UUID
    desired_position_category_id: UUID
    career_years: int
    region_category_id: Optional[UUID]
    desired_salary: Optional[int]
    desired_employment_type: EmploymentType
    matched_skill_category_ids: List[UUID]
    score: Optional[float] = None  # sort=score 요청 시에만 채워지는 PRD 5장 소프트 스코어링 근사치


# ---------- 지원자 관리 (interaction_logs APPLY/VIEW 기준) ----------


class ApplicantResponse(BaseModel):
    jobseeker_profile_id: UUID
    applied_at: datetime
    viewed: bool
    career_years: int
    desired_position_category_id: UUID
    region_category_id: Optional[UUID]  # is_region_public=false면 비공개 처리(None)
    desired_salary: Optional[int]  # is_salary_public=false면 비공개 처리(None)
    desired_employment_type: EmploymentType
    skill_category_ids: List[UUID]


# ---------- 채용 시장 분석 (PRD 7.1절, 여유 시 구현) ----------


class MarketAnalysisResponse(BaseModel):
    position_category_id: UUID
    industry_category_id: UUID
    job_posting_count: int
    average_salary_avg: Optional[float]
    hired_salary_avg: Optional[float]
    annual_from_avg: Optional[float]
    annual_to_avg: Optional[float]
    monthly_posting_counts: dict
