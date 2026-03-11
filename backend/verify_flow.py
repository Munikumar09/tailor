import requests
import json
import os
import sys
from utils.logger import get_logger

logger = get_logger(__name__)

# Add current dir to path for imports
sys.path.append(os.getcwd())

BASE_URL = "http://localhost:8000"


def test_flow():
    logger.info("--- 1. Checking Backend Health ---")
    try:
        r = requests.get(f"{BASE_URL}/")
        logger.info(f"Health check: {r.status_code} - {r.json()}")
    except Exception as e:
        logger.error(f"FAILED: {e}")
        return

    print("\n--- 2. Setting Up User Profile ---")
    profile_data = {
        "full_name": "Alex Chen",
        "current_title": "Senior Frontend Engineer",
        "years_of_experience": "7",
        "min_ai_score": 75,
        "ingestion_frequency": "Every 6h",
        "resume_path": "uploads/test_resume.docx",
        "preferred_work_mode": "Remote",
    }
    r = requests.post(f"{BASE_URL}/profile/", json=profile_data)
    print(f"Profile: {r.status_code} - {r.json().get('full_name')}")

    print("\n--- 3. Injecting a Mock Job ---")
    from sqlmodel import Session, create_engine
    from models import Job, JobStatus

    engine = create_engine("sqlite:///jobs.db")
    with Session(engine) as session:
        from sqlalchemy import text

        session.execute(
            text("DELETE FROM job WHERE composite_key = 'vercel_senior_fe_test'")
        )

        mock_job = Job(
            company_name="Vercel",
            job_title="Senior Frontend Engineer",
            job_description="We need a React expert with Next.js and Edge Runtime experience.",
            status=JobStatus.PENDING,
            composite_key="vercel_senior_fe_test",
            match_score=94,
            match_reason="Strong React alignment.",
        )
        session.add(mock_job)
        session.commit()
        session.refresh(mock_job)
        job_id = mock_job.id
        print(f"Mock Job Created: ID {job_id}")

    print("\n--- 4. Testing Tailoring Agent (LangGraph) ---")
    # This might fail with 500 if the GEMINI_API_KEY is dummy,
    # but it verifies the endpoint and logic flow.
    r = requests.post(f"{BASE_URL}/tailor/{job_id}")
    print(f"Tailoring Status: {r.status_code}")
    if r.status_code == 200:
        print("SUCCESS: Resume tailored.")
        print(f"Bullets: {json.dumps(r.json().get('bullets'), indent=2)}")
    else:
        print(f"Tailoring response: {r.json()}")


if __name__ == "__main__":
    test_flow()
