from datetime import datetime
from enum import Enum
from typing import List, Optional
from sqlmodel import Field, Relationship, SQLModel, JSON
from utils.logger import get_logger

logger = get_logger(__name__)


class JobStatus(str, Enum):
    PENDING = "Pending"
    TAILORING = "Tailoring"
    TAILORED = "Tailored"
    APPLIED = "Applied"
    SKIPPED = "Skipped"


class Job(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    company_name: str
    job_title: str
    job_description: str
    match_score: Optional[int] = None
    match_reason: Optional[str] = None
    tailored_match_score: Optional[int] = None
    tailored_match_reason: Optional[str] = None
    status: JobStatus = Field(default=JobStatus.PENDING)
    sub_status: Optional[str] = None
    job_url: Optional[str] = None
    location: Optional[str] = None
    salary: Optional[str] = None
    tailored_resume_path: Optional[str] = None
    tailored_bullets: Optional[List[dict]] = Field(default=[], sa_type=JSON)
    logs: Optional[List[dict]] = Field(default=[], sa_type=JSON)  # History of events
    analytics: Optional[dict] = Field(default=None, sa_type=JSON)  # TailoringAnalyticsReport
    extracted_keywords: Optional[List[dict]] = Field(default=None, sa_type=JSON)  # [{kw, present, weight}]
    created_at: datetime = Field(default_factory=datetime.utcnow)
    composite_key: str = Field(unique=True)  # Company_Name + Job_Title
    external_job_id: Optional[str] = None


class UserProfile(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    full_name: str
    current_title: str
    years_of_experience: str
    skills: List[str] = Field(default=[], sa_type=JSON)
    skill_whitelist: List[str] = Field(
        default=[], sa_type=JSON
    )  # Extracted from master resume
    resume_path: Optional[str] = None  # Path to the latest Master Resume .docx
    linkedin_url: Optional[str] = None
    preferred_work_mode: Optional[str] = None
    min_salary: Optional[int] = None
    min_ai_score: int = Field(default=75)
    ingestion_frequency: str = Field(default="Every 6h")


class ResumeVersion(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    version_label: str  # e.g., "v1", "Initial Upload"
    content: str  # The extracted/edited text (legacy/fallback)
    file_path: Optional[str] = None  # Path to the actual .docx file
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_current: bool = Field(default=False)
