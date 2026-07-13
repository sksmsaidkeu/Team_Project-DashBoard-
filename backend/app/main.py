"""기업(Tab1) 백엔드 FastAPI 앱 진입점.

PRD 6장 Tab1(기업용): 인재 검색, 공고 관리, 지원자 관리 기능의 백엔드 API를 제공한다.
Supabase Postgres에는 supabase-py(app.supabase_client)를 통해서만 접근한다.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import applicants, company_profile, job_postings, market_analysis, talent_search

settings = get_settings()

app = FastAPI(title="채용 플랫폼 - 기업(Tab1) 백엔드 API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(company_profile.router)
app.include_router(job_postings.router)
app.include_router(talent_search.router)
app.include_router(applicants.router)
app.include_router(market_analysis.router)


@app.get("/health")
def health_check():
    return {"status": "ok"}
