from utils.logger import get_logger
from fastapi import APIRouter, BackgroundTasks, Depends
from sqlmodel import Session, select
from database import get_session
from models import Job, UserProfile, JobStatus
from ingestion.jsearch import fetch_jobs, transform_job
from ingestion.filter import score_job_fit
import docx
import os

logger = get_logger(__name__)

router = APIRouter(prefix="/ingest", tags=["Ingestion"])


def extract_text_from_docx(file_path: str) -> str:
    """Helper to read resume text."""
    if not os.path.exists(file_path):
        return ""
    doc = docx.Document(file_path)
    return "\n".join([p.text for p in doc.paragraphs])


def run_ingestion_sync(session: Session):
    """Sync version of ingestion loop."""
    # 1. Get User Profile and Resume
    profile = session.exec(select(UserProfile)).first()
    if not profile or not profile.resume_path:
        logger.warning("Incomplete profile or missing resume — skipping ingestion")
        return

    resume_text = extract_text_from_docx(profile.resume_path)
    if not resume_text:
        logger.warning("Could not read resume text from %s", profile.resume_path)
        return

    # 2. Fetch Jobs
    query = f"{profile.current_title} in {profile.preferred_work_mode or ''}"
    raw_jobs = fetch_jobs(query, num_pages=1)

    from sqlalchemy.exc import IntegrityError

    for raw_job in raw_jobs:
        transformed = transform_job(raw_job)

        # Check if already exists in DB
        existing = session.exec(
            select(Job).where(Job.composite_key == transformed["composite_key"])
        ).first()
        if existing:
            continue

        # 3. Fast Filter (LLM-as-a-Judge)
        score, reason = score_job_fit(transformed["job_description"], resume_text)

        # 4. Filter ruthlessly (≥ 75) — skip if scoring failed
        if score is not None and score >= profile.min_ai_score:
            try:
                new_job = Job(
                    **transformed,
                    match_score=score,
                    match_reason=reason,
                    status=JobStatus.PENDING,
                )
                session.add(new_job)
                session.commit()  # Commit each to avoid session state issues in check
            except IntegrityError:
                session.rollback()
                continue

    logger.info("Ingestion complete for query: %s", query)


@router.post("/")
def trigger_ingestion(
    background_tasks: BackgroundTasks, session: Session = Depends(get_session)
):
    """Async endpoint to start ingestion."""
    background_tasks.add_task(run_ingestion_sync, session)
    return {"message": "Ingestion process started in background."}
