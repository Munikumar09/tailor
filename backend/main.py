# Import first — initialises the singleton logging service before anything else logs.
from utils.logger import get_logger

logger = get_logger(__name__)

import os

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlmodel import Session, select
from database import create_db_and_tables, get_session, engine
import models
from models import Job, JobStatus
from api import jobs, ingest, profile, tailor, analytics
from datetime import datetime
from dotenv import load_dotenv
from resume_tailor.keyword_gap_analyzer import preload_models as _preload_nlp_models

load_dotenv()

app = FastAPI(title="AI Job Application Commander API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    create_db_and_tables()
    _migrate_add_columns()
    _reset_stuck_tailoring_jobs()
    _preload_nlp_models()


def _migrate_add_columns():
    """Add new columns to existing tables without dropping data (SQLite-safe)."""
    from sqlalchemy import text
    migrations = [
        "ALTER TABLE job ADD COLUMN extracted_keywords JSON",
    ]
    with Session(engine) as session:
        for stmt in migrations:
            try:
                session.exec(text(stmt))
                session.commit()
                logger.info("Migration applied: %s", stmt)
            except Exception:
                # Column already exists — safe to ignore
                session.rollback()


def _reset_stuck_tailoring_jobs():
    """
    Reset any jobs left in TAILORING status back to PENDING.
    These are orphaned background tasks killed by a server restart.
    """
    with Session(engine) as session:
        stuck_jobs = session.exec(
            select(Job).where(Job.status == JobStatus.TAILORING)
        ).all()

        if not stuck_jobs:
            return

        for job in stuck_jobs:
            job.status = JobStatus.PENDING
            job.sub_status = "Error: Server restarted during tailoring. Re-run to continue."
            new_logs = list(job.logs or [])
            new_logs.append({
                "msg": "Server restarted — tailoring was interrupted. Re-run to continue.",
                "type": "error",
                "t": datetime.now().strftime("%H:%M:%S"),
            })
            job.logs = new_logs
            session.add(job)

        session.commit()
        logger.warning(
            "Reset %d stuck TAILORING job(s) to PENDING on startup", len(stuck_jobs)
        )


app.include_router(jobs.router)
app.include_router(ingest.router)
app.include_router(profile.router)
app.include_router(tailor.router)
app.include_router(analytics.router)


@app.get("/download/{filename:path}")
async def download_file(filename: str):
    # Security note: In a real app, validate path/filename strictly
    paths = [
        "tailored_resumes",
        "uploads",
        "backend/tailored_resumes",
        "backend/uploads",
    ]
    logger.debug("Downloading %s — CWD: %s", filename, os.getcwd())
    for p in paths:
        full_path = os.path.join(p, filename)
        logger.debug("Checking path: %s", full_path)
        if os.path.exists(full_path):
            return FileResponse(full_path, filename=filename)

    raise HTTPException(status_code=404, detail=f"File not found: {filename}")


@app.get("/")
def read_root():
    return {"message": "AI Job Application Commander API is running"}
