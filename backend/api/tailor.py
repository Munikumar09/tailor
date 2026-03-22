from utils.logger import get_logger
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks

logger = get_logger(__name__)
from sqlmodel import Session, select, desc
from database import get_session, create_engine
from models import Job, UserProfile, JobStatus, ResumeVersion
from agent.graph import tailoring_app
from agent.nodes import update_job_sub_status
from api.ingest import extract_text_from_docx
from utils.xml_ast import parse_docx_to_block_ast, export_mutated_docx
import os
import time
from datetime import datetime

router = APIRouter(prefix="/tailor", tags=["Tailoring"])


def run_tailoring_task(job_id: int):
    """Background task to run the tailoring agent."""
    # Create fresh engine for background thread
    engine = create_engine("sqlite:///jobs.db")

    # 1. Update initial status and get data
    with Session(engine) as session:
        job = session.get(Job, job_id)
        profile = session.exec(select(UserProfile)).first()

        if not job or not profile or not profile.resume_path:
            return

        job.status = JobStatus.TAILORING
        job.logs = []  # Clear history for fresh run
        session.add(job)
        session.commit()

        # Log first stage
        update_job_sub_status(job_id, "System 1 — Block AST extracted")

        # Resolve the resume path: use the most recently saved ResumeVersion
        # that has a valid .docx file. This is more reliable than trusting
        # profile.resume_path alone, which only reflects the original upload
        # and is not updated when edits are saved via resume-save-ast/resume-save.
        latest_version = session.exec(
            select(ResumeVersion)
            .where(ResumeVersion.file_path != None)
            .order_by(desc(ResumeVersion.created_at))
        ).first()

        if latest_version and latest_version.file_path and os.path.exists(latest_version.file_path):
            resume_path = latest_version.file_path
        else:
            resume_path = profile.resume_path

        logger.info("Tailoring job %d using resume: %s", job_id, resume_path)

        # Prepare state while session is open
        resume_text = extract_text_from_docx(resume_path)
        initial_state = {
            "job_id": job.id,
            "job_description": job.job_description,
            "master_resume_text": resume_text,
            "master_resume_path": resume_path,
            "skill_whitelist": profile.skill_whitelist or [],
            "extracted_keywords": [],
            "keyword_analysis": {},
            "tailored_bullets": [],
            "modifications": {},
            "status": "Starting",
        }

    # Session is now closed. Run AI Agent (can take minutes)
    try:
        final_state = tailoring_app.invoke(initial_state)

        # 3. Success mapping - Open fresh session for result update
        with Session(engine) as session:
            job = session.get(Job, job_id)
            if not job:
                return

            doc_path = (
                final_state.get("final_resume_path")
                or f"tailored_resumes/tailored_{job_id}.docx"
            )
            job.tailored_resume_path = doc_path

            ast = parse_docx_to_block_ast(resume_path)
            block_map = {b["id"]: b["fullText"] for b in ast["blocks"]}

            ui_bullets = []
            for b in final_state.get("tailored_bullets", []):
                ui_bullets.append(
                    {
                        "old": block_map.get(b["id"], "Original text not found"),
                        "new": b["newText"],
                        "keywordsAdded": b.get("keywordsAdded", []),
                        "reason": b.get("reason", ""),
                    }
                )

            job.tailored_bullets = ui_bullets
            job.extracted_keywords = final_state.get("extracted_keywords") or []

            # Use deterministic ATS scores from the analytics report.
            # These are based on exact keyword matching, not LLM non-determinism.
            analytics = final_state.get("analytics")
            if analytics:
                job.analytics = analytics
                score_delta = analytics.get("scoreDelta", {})
                ats_after = score_delta.get("atsAfter")
                improvement = score_delta.get("atsImprovement", 0)
                pass_label = (
                    analytics.get("passBand", {})
                    .get("after", {})
                    .get("label", "")
                )
                if ats_after is not None:
                    job.tailored_match_score = round(ats_after)
                    job.tailored_match_reason = (
                        f"{pass_label}. "
                        f"ATS {ats_after:.1f}/100"
                        + (f" (+{improvement:.1f} pts)" if improvement > 0 else "")
                    )

            # Set status + sub_status atomically so the frontend never sees
            # sub_status="Pipeline complete" while status is still "Tailoring"
            job.status = JobStatus.TAILORED
            job.sub_status = "Pipeline complete"
            job.logs = list(job.logs or []) + [
                {
                    "msg": "Pipeline complete",
                    "type": "success",
                    "t": datetime.now().strftime("%H:%M:%S"),
                }
            ]

            session.add(job)
            session.commit()
    except Exception as e:
        with Session(engine) as session:
            job = session.get(Job, job_id)
            if job:
                job.status = JobStatus.PENDING
                update_job_sub_status(job_id, f"Error: {str(e)}", type="error")
                session.add(job)
                session.commit()


@router.post("/{job_id}")
async def tailor_resume(
    job_id: int,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    # 1. Fetch job and profile
    job = session.get(Job, job_id)
    profile = session.exec(select(UserProfile)).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not profile or not profile.resume_path:
        raise HTTPException(status_code=400, detail="User profile or resume missing")

    # Update initial status synchronously
    job.status = JobStatus.TAILORING
    job.sub_status = "System 1 — Initializing Pipeline..."
    job.logs = [
        {
            "msg": "System 1 — Initializing Pipeline...",
            "type": "info",
            "t": datetime.now().strftime("%H:%M:%S"),
        }
    ]
    session.add(job)
    session.commit()
    session.refresh(job)

    # Start background task
    background_tasks.add_task(run_tailoring_task, job_id)

    return {"message": "Tailoring process started in background"}
