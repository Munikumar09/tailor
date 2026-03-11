import requests
import os
import time
import sys
from utils.logger import get_logger

logger = get_logger(__name__)

# Ensure backend is in path
sys.path.append(os.path.join(os.getcwd(), "backend"))

BASE_URL = "http://localhost:8000"


def test_tailoring():
    logger.info("--- 1. Set up profile and job manually in DB ---")
    with open("sample_jd.md", "r") as f:
        jd_text = f.read()

    # Need to be in backend/ for the DB file if using relative path
    original_cwd = os.getcwd()
    os.chdir("backend")

    from sqlmodel import Session, create_engine, select
    from models import Job, JobStatus, UserProfile, ResumeVersion

    engine = create_engine("sqlite:///jobs.db")
    with Session(engine) as session:
        # 1. Profile
        profile = session.exec(select(UserProfile)).first()
        if not profile:
            profile = UserProfile(
                full_name="Muni Kumar Mannasamudram",
                current_title="Senior AI Engineer",
                years_of_experience="6",
                resume_path="uploads/test_resume.docx",
                skill_whitelist=[
                    "Python",
                    "Machine Learning",
                    "Large Language Models",
                    "React",
                    "Node.js",
                    "Docker",
                    "AWS",
                    "NLP",
                    "PyTorch",
                    "TensorFlow",
                    "FastAPI",
                    "PostgreSQL",
                    "Next.js",
                    "TypeScript",
                    "Vite",
                ],
                min_ai_score=75,
            )
            session.add(profile)
        else:
            profile.resume_path = "uploads/test_resume.docx"
            profile.skill_whitelist = [
                "Python",
                "Machine Learning",
                "Large Language Models",
                "React",
                "Node.js",
                "Docker",
                "AWS",
                "NLP",
                "PyTorch",
                "TensorFlow",
                "FastAPI",
                "PostgreSQL",
                "Next.js",
                "TypeScript",
                "Vite",
            ]
            session.add(profile)

        # 2. Resume Version (needed for some logic)
        rv = session.exec(
            select(ResumeVersion).where(
                ResumeVersion.file_path == "uploads/test_resume.docx"
            )
        ).first()
        if not rv:
            rv = ResumeVersion(
                version_label="Test Resume",
                content="Mock content",
                file_path="uploads/test_resume.docx",
                is_current=True,
            )
            session.add(rv)

        # 3. Create a new job for this test
        # Use a unique composite key each time
        ckey = f"genai_test_{int(time.time())}"
        job = Job(
            company_name="GenAI Solutions",
            job_title="Senior AI Engineer",
            job_description=jd_text,
            status=JobStatus.PENDING,
            composite_key=ckey,
            match_score=85,
            match_reason="Good skill alignment.",
        )
        session.add(job)
        session.commit()
        session.refresh(job)
        job_id = job.id
        print(f"Created job with ID: {job_id}")

    os.chdir(original_cwd)

    print(f"\n--- 2. Run Tailoring for Job {job_id} ---")
    # Increase timeout for AI call
    try:
        r = requests.post(f"{BASE_URL}/tailor/{job_id}", timeout=60)
        if r.status_code == 200:
            print("Tailoring successful!")
            data = r.json()
            # print(f"Keywords found: {data.get('keywords')}")
            bullets = data.get("bullets", [])
            print(f"Tailored {len(bullets)} bullets.")
            for b in bullets[:3]:
                print(f"\n--- Bullet ---")
                print(f"OLD: {b['old'][:120]}...")
                print(f"NEW: {b['new'][:120]}...")
                print(f"ADDED: {b['keywordsAdded']}")
                print(f"REASON: {b['reason']}")
            print(f"\nFinal Resume Path: {data.get('doc_path')}")
        else:
            print(f"Tailoring failed: {r.status_code}")
            print(r.text)
    except requests.exceptions.Timeout:
        print("Tailoring timed out (Gemini might be slow)")
    except Exception as e:
        print(f"Error: {e}")


if __name__ == "__main__":
    test_tailoring()
