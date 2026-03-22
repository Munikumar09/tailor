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

# ── Embedding model (lazy singleton — same model as the rest of the pipeline) ──
_st_model = None


def _get_st_model():
    global _st_model
    if _st_model is None:
        from sentence_transformers import SentenceTransformer
        _st_model = SentenceTransformer("all-MiniLM-L6-v2")
    return _st_model


def _semantic_similarity_score(resume_text: str, job_description: str) -> int:
    """
    Compute a 0-100 match score as the cosine similarity between
    the resume and JD sentence embeddings.

    Calibration for all-MiniLM-L6-v2:
      cos_sim ≤ 0.15  →   0  (completely unrelated fields)
      cos_sim = 0.425 →  50  (moderate relevance)
      cos_sim ≥ 0.70  → 100  (very strong match)
    """
    import numpy as np

    model = _get_st_model()
    # Truncate to avoid going over the model's effective token budget
    texts = [resume_text[:3000], job_description[:3000]]
    embs = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    cos_sim = float(np.dot(embs[0], embs[1]))

    # Linear remap [0.15, 0.70] → [0, 100]
    score = (cos_sim - 0.15) / (0.70 - 0.15) * 100
    return max(0, min(100, round(score)))


def _call_llm(system: str, user: str) -> str:
    """
    Call Gemini 2.5 Flash with automatic Groq fallback.
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
        logger.warning("Gemini failed (%s) — falling back to Groq", e)

    llm = ChatGroq(
        model=_GROQ_MODEL,
        groq_api_key=settings.groq_api_key,
        max_retries=2,
    )
    return llm.invoke(messages).content


def _llm_reason(resume_text: str, job_description: str) -> str:
    """
    Ask the LLM for a 2-sentence skill-alignment summary.
    Score is NOT determined here — only the explanation.
    """
    system = "You are an expert technical recruiter. Return ONLY a valid JSON object, no prose."
    user = f"""Summarise the skill alignment between this resume and job description.

Resume:
{resume_text[:3000]}

Job Description:
{job_description[:3000]}

Rules:
- Focus ONLY on technical skills, tools, and domain knowledge overlap.
- Do NOT mention years of experience, educational requirements, or any hard eligibility criteria.
- Write exactly 2 sentences.

Return JSON: {{ "reason": "<2-sentence skill-alignment summary>" }}"""

    try:
        raw = _call_llm(system, user)
        if "```" in raw:
            raw = raw.split("```json")[-1].split("```")[0].strip()
        result = json.loads(raw)
        return result.get("reason", "Skill alignment assessed.")
    except Exception:
        logger.warning("LLM reason call failed — using fallback text")
        return "Skill alignment assessed via semantic similarity."


def score_job_fit(
    job_description: str, resume_text: str
) -> Tuple[Optional[int], Optional[str]]:
    """
    Score the job match:
      - Score (0-100): cosine similarity of resume ↔ JD embeddings.
                       Pure semantic similarity — no keyword or fuzzy matching,
                       no penalty for years-of-experience or hard requirements.
      - Reason: LLM-generated 2-sentence skill-alignment summary.

    Returns (score, reason), or (None, None) on total failure.
    """
    try:
        score = _semantic_similarity_score(resume_text, job_description)
        reason = _llm_reason(resume_text, job_description)
        logger.info("score_job_fit → score=%d", score)
        return score, reason
    except Exception:
        logger.error("score_job_fit failed entirely", exc_info=True)
        return None, None
