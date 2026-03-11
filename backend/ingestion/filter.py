import os
import json
from typing import Optional, Tuple
from pydantic_settings import BaseSettings
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

from utils.logger import get_logger
logger = get_logger(__name__)


class Settings(BaseSettings):
    gemini_api_key: str = ""
    groq_api_key: str = ""

    class Config:
        env_file = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".env")
        extra = "ignore"


settings = Settings()

_GEMINI_MODEL = "gemini-2.5-flash"
_GROQ_MODEL = "llama-3.3-70b-versatile"


def _call_llm(system: str, user: str) -> str:
    """
    Call Gemini 2.0 Flash with automatic Groq/Kimi K2 fallback.
    LangChain handles retries internally for transient errors.
    """
    messages = [SystemMessage(content=system), HumanMessage(content=user)]

    try:
        llm = ChatGoogleGenerativeAI(
            model=_GEMINI_MODEL,
            google_api_key=settings.gemini_api_key,
            max_retries=2,
            timeout=30,
        )
        return llm.invoke(messages).content
    except Exception as e:
        logger.warning("Gemini failed (%s) — falling back to Groq Kimi K2", e)

    llm = ChatGroq(
        model=_GROQ_MODEL,
        groq_api_key=settings.groq_api_key,
        max_retries=2,
    )
    return llm.invoke(messages).content


def score_job_fit(
    job_description: str, resume_text: str
) -> Tuple[Optional[int], Optional[str]]:
    """
    Score the job match using Gemini 2.0 Flash (Groq/Kimi K2 as fallback).
    Returns: (score, reason) or (None, None) on total failure.
    """
    system = "You are an expert technical recruiter. Return ONLY a valid JSON object, no prose."
    user = f"""Score the match between this Job Description and Resume.

Resume:
{resume_text}

Job Description:
{job_description}

Return JSON: {{ "score": <integer 0-100>, "reason": "<2-sentence explanation focusing on skill alignment>" }}"""

    try:
        raw = _call_llm(system, user)
        if raw.startswith("```json"):
            raw = raw.replace("```json", "").replace("```", "").strip()
        result = json.loads(raw)
        return int(result.get("score", 0)), result.get("reason", "No reason provided.")
    except Exception as e:
        logger.error("Scoring failed entirely", exc_info=True)
        return None, None
