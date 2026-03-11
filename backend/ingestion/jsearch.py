import requests
import os
from typing import List, Dict
from pydantic_settings import BaseSettings

from utils.logger import get_logger
logger = get_logger(__name__)


class Settings(BaseSettings):
    rapidapi_key: str = ""
    rapidapi_host: str = "jsearch.p.rapidapi.com"

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()


def fetch_jobs(query: str, num_pages: int = 1) -> List[Dict]:
    """
    Fetch jobs from JSearch API.
    Example query: 'Senior Frontend Engineer in San Francisco, CA'
    """
    url = "https://jsearch.p.rapidapi.com/search"

    headers = {
        "x-rapidapi-key": settings.rapidapi_key,
        "x-rapidapi-host": settings.rapidapi_host,
    }

    all_jobs = []
    for page in range(1, num_pages + 1):
        querystring = {
            "query": query,
            "page": str(page),
            "num_pages": "1",
            "date_posted": "all",  # or "today", "3days", "week", "month"
        }

        response = requests.get(url, headers=headers, params=querystring)
        if response.status_code == 200:
            data = response.json()
            all_jobs.extend(data.get("data", []))
        else:
            logger.error("Error fetching jobs: %s — %s", response.status_code, response.text[:200])
            break

    return all_jobs


def transform_job(raw_job: Dict) -> Dict:
    """Transform raw API response to our Job model format."""
    company = raw_job.get("employer_name", "Unknown")
    title = raw_job.get("job_title", "Unknown")
    job_id = raw_job.get("job_id", f"{company}_{title}".replace(" ", "_").lower())

    return {
        "company_name": company,
        "job_title": title,
        "job_description": raw_job.get("job_description", ""),
        "job_url": raw_job.get("job_apply_link", ""),
        "location": f"{raw_job.get('job_city', '')}, {raw_job.get('job_state', '')} {raw_job.get('job_country', '')}".strip(
            ", "
        ),
        "salary": f"{raw_job.get('job_min_salary', '')}-{raw_job.get('job_max_salary', '')} {raw_job.get('job_salary_currency', '')}".strip(
            "- "
        ),
        "composite_key": job_id,
        "external_job_id": job_id,
    }
