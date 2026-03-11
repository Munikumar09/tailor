import os
import json
import sys
from utils.logger import get_logger

logger = get_logger(__name__)

# Ensure backend is in path
sys.path.append(os.path.join(os.getcwd(), "backend"))

from agent.graph import tailoring_app
from agent.state import AgentState
from sqlmodel import Session, create_engine, select
from models import Job, UserProfile


def test_direct():
    print("--- Testing Agent Directly ---")

    # Need to be in backend/ for the DB file if using relative path
    os.chdir("backend")

    engine = create_engine("sqlite:///jobs.db")
    with Session(engine) as session:
        job = session.exec(
            select(Job).where(Job.composite_key.like("genai_test_%"))
        ).first()
        profile = session.exec(select(UserProfile)).first()

        if not job or not profile:
            print("Missing job or profile in DB")
            return

        print(f"Using Job ID {job.id}: {job.job_title}")
        print(f"Using Profile: {profile.full_name}, Resume: {profile.resume_path}")

        initial_state = {
            "job_id": job.id,
            "job_description": job.job_description,
            "master_resume_text": "Built fast React components for e-commerce. Worked on performance improvements.",  # Mock text
            "master_resume_path": profile.resume_path,
            "skill_whitelist": profile.skill_whitelist or [],
            "extracted_keywords": [],
            "keyword_analysis": {},
            "tailored_bullets": [],
            "modifications": {},
            "status": "Starting",
        }

        try:
            final_state = tailoring_app.invoke(initial_state)
            print("\nFinal Status: " + str(final_state.get("status")))
            print(
                "Tailored Bullets Count: "
                + str(len(final_state.get("tailored_bullets", [])))
            )

            for b in final_state.get("tailored_bullets", []):
                print("--- Bullet ---")
                print("ID: " + str(b["id"]))
                print("NEW: " + str(b["newText"]))
                print("ADDED: " + str(b["keywordsAdded"]))
                print("REASON: " + str(b["reason"]))

            print("\nFinal Resume Path: " + str(final_state.get("final_resume_path")))
        except Exception as e:
            print("Agent failed: " + str(e))


if __name__ == "__main__":
    test_direct()
