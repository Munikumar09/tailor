from utils.logger import get_logger
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlmodel import Session, select
from typing import List, Optional
from database import get_session, create_engine
from models import Job, JobStatus, UserProfile
from ingestion.filter import score_job_fit
from api.ingest import extract_text_from_docx
import os

logger = get_logger(__name__)

router = APIRouter(prefix="/jobs", tags=["Jobs"])


def run_sync_with_master():
    """Background task to recalculate match scores for all pending jobs."""
    engine = create_engine("sqlite:///jobs.db")
    with Session(engine) as session:
        profile = session.exec(select(UserProfile)).first()
        if not profile or not profile.resume_path:
            logger.warning("Incomplete profile or missing resume — skipping sync")
            return

        resume_text = extract_text_from_docx(profile.resume_path)
        if not resume_text:
            logger.warning("Could not read resume text from %s", profile.resume_path)
            return

        # Fetch all PENDING jobs
        jobs = session.exec(select(Job).where(Job.status == JobStatus.PENDING)).all()

        for job in jobs:
            score, reason = score_job_fit(job.job_description, resume_text)
            if score is not None:
                job.match_score = score
                job.match_reason = reason
            session.add(job)

        session.commit()
        logger.info("Sync complete for %d jobs", len(jobs))


@router.post("/sync-with-master")
def sync_with_master(
    background_tasks: BackgroundTasks, session: Session = Depends(get_session)
):
    """Async endpoint to sync pending jobs with master resume."""
    background_tasks.add_task(run_sync_with_master)
    return {"message": "Sync process started in background."}


@router.get("/", response_model=List[Job])
def get_jobs(
    status: Optional[JobStatus] = None, session: Session = Depends(get_session)
):
    query = select(Job)
    if status:
        query = query.where(Job.status == status)

    return session.exec(query).all()


@router.delete("/cleanup-duplicates")
def cleanup_duplicates(session: Session = Depends(get_session)):
    """Remove duplicate jobs based on company_name and job_title."""
    all_jobs = session.exec(select(Job).order_by(Job.created_at.desc())).all()

    seen = set()
    to_delete = []

    for job in all_jobs:
        # Use company and title as the unique key for cleanup
        key = f"{job.company_name}|{job.job_title}".lower().strip()
        if key in seen:
            to_delete.append(job)
        else:
            seen.add(key)

    for job in to_delete:
        session.delete(job)

    session.commit()
    return {"message": f"Deleted {len(to_delete)} duplicate jobs"}


@router.get("/{job_id}", response_model=Job)
def get_job(job_id: int, session: Session = Depends(get_session)):
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.patch("/{job_id}/status")
def update_job_status(
    job_id: int, status: JobStatus, session: Session = Depends(get_session)
):
    job = session.get(Job, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job.status = status
    session.add(job)
    session.commit()
    session.refresh(job)
    return job
