"""
skill_extractor.py
==================
Two-stage LLM skill extraction and gap analysis.

Stage 1 — extract_jd_skills():
    Asks the LLM to extract a clean, deduplicated list of specific skills,
    technologies, tools, and methodologies from the structured JD.
    Output: [{"name": str, "required": bool}, ...]

Stage 2 — analyze_skill_gap():
    Asks the LLM to classify each extracted skill against the resume.
    Output: {"demonstrated": [...], "partial": [...], "missing": [...]}

Both stages use the same LangChain providers (Gemini → Groq fallback) as
jd_structurer.py. LLM failures return None — pipeline.py falls back to
the NLP-based approach in keyword_gap_analyzer.py.
"""

from __future__ import annotations

import json
import re
from typing import Dict, List, Optional

from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage

from utils.logger import get_logger
from .jd_structurer import LLMConfig, StructuredJD

logger = get_logger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
#  GENERIC LLM CALLER
# ═══════════════════════════════════════════════════════════════════════════════

def _call_llm(system_prompt: str, user_prompt: str, config: LLMConfig) -> str:
    """Call the configured LLM and return raw text. Raises on failure."""
    api_key = config.get_api_key()
    messages = [SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)]

    if config.provider == "gemini":
        llm = ChatGoogleGenerativeAI(
            model=config.model,
            google_api_key=api_key,
            max_retries=0,
            timeout=config.timeout_seconds,
        )
        return llm.invoke(messages).content
    elif config.provider == "groq":
        llm = ChatGroq(
            model=config.model,
            groq_api_key=api_key,
            max_retries=0,
            timeout=config.timeout_seconds,
        )
        return llm.invoke(messages).content
    else:
        raise ValueError(f"Unsupported provider: {config.provider}")


def _try_call_with_fallback(
    system_prompt: str,
    user_prompt: str,
    config: LLMConfig,
) -> Optional[str]:
    """Call LLM with Groq fallback. Returns None if all providers fail."""
    try:
        return _call_llm(system_prompt, user_prompt, config)
    except Exception as e:
        logger.warning("skill_extractor: primary LLM (%s) failed: %s", config.provider, e)

    if config.provider != "groq":
        from .jd_structurer import _GROQ_FALLBACK_CONFIG
        try:
            return _call_llm(system_prompt, user_prompt, _GROQ_FALLBACK_CONFIG)
        except Exception as e:
            logger.warning("skill_extractor: Groq fallback failed: %s", e)

    return None


def _extract_json(raw: str) -> dict:
    """Extract first JSON object from LLM response, stripping markdown fences."""
    text = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text.strip(), flags=re.MULTILINE)
    brace_match = re.search(r"\{[\s\S]*\}", text)
    if not brace_match:
        raise ValueError("No JSON object in LLM output")
    return json.loads(brace_match.group(0))


# ═══════════════════════════════════════════════════════════════════════════════
#  STAGE 1 — JD SKILL EXTRACTION
# ═══════════════════════════════════════════════════════════════════════════════

_SKILL_EXTRACTION_SYSTEM = """You are a technical skill extractor. Read a job description and extract a clean, deduplicated list of specific skills.

INCLUDE:
- Programming languages (Python, Java, Go, SQL, etc.)
- Frameworks and libraries (LangChain, PyTorch, React, FastAPI, LlamaIndex, Haystack, etc.)
- Tools and platforms (Docker, Kubernetes, AWS, GCP, Azure, Databricks, MLflow, etc.)
- ML/AI techniques (RAG, fine-tuning, LoRA, PEFT, RLHF, transformer, embedding, vector search, etc.)
- Methodologies (CI/CD, REST APIs, microservices, Agile, LLMOps, MLOps, etc.)
- Domain concepts that are specific and testable (NLP, computer vision, GenAI, LLM, etc.)
- Acronyms exactly as written (RAG stays RAG, LoRA stays LoRA, PEFT stays PEFT)

EXCLUDE:
- Soft skills (communication, collaboration, teamwork, problem-solving, leadership, etc.)
- Vague qualifiers used as standalone terms (strong understanding of, experience with, familiarity)
- Generic nouns (role, degree, field, team, product, system, solution, background, environment)
- Education requirements (bachelor's degree, master's degree, PhD, related field)
- Years-of-experience statements (3+ years, 5 years experience)
- Company culture and values

OUTPUT SCHEMA (strict JSON only, no markdown fences, no explanation):
{
  "required": ["skill1", "skill2", ...],
  "preferred": ["skill3", "skill4", ...]
}

Rules:
- Preserve exact capitalisation from the JD (LangChain not langchain, PyTorch not pytorch)
- Deduplicate — if the same skill appears in both sections, put it in required only
- List each skill exactly once"""

_SKILL_EXTRACTION_USER = """Extract skills from this job description.

REQUIRED QUALIFICATIONS:
{req_text}

PREFERRED QUALIFICATIONS:
{pref_text}

KEY RESPONSIBILITIES (for context — skills mentioned here are effectively required):
{resp_text}

Return JSON only."""


def extract_jd_skills(
    structured: StructuredJD,
    config: LLMConfig,
) -> Optional[List[Dict]]:
    """
    Stage 1: Extract clean skill entities from a structured JD.

    Returns a list of {"name": str, "required": bool} dicts,
    or None if LLM extraction fails (caller should fall back to NLP).
    """
    req_text  = "\n".join(f"- {s}" for s in structured.required)       or "(none)"
    pref_text = "\n".join(f"- {s}" for s in structured.preferred)      or "(none)"
    resp_text = "\n".join(f"- {s}" for s in structured.responsibilities) or "(none)"

    user_prompt = _SKILL_EXTRACTION_USER.format(
        req_text=req_text,
        pref_text=pref_text,
        resp_text=resp_text,
    )

    raw = _try_call_with_fallback(_SKILL_EXTRACTION_SYSTEM, user_prompt, config)
    if raw is None:
        return None

    try:
        parsed = _extract_json(raw)
        required  = [s for s in parsed.get("required",  []) if isinstance(s, str) and s.strip()]
        preferred = [s for s in parsed.get("preferred", []) if isinstance(s, str) and s.strip()]

        # Deduplicate: if a skill is in both, keep it in required
        required_lower = {s.lower() for s in required}
        preferred = [s for s in preferred if s.lower() not in required_lower]

        skills = (
            [{"name": s, "required": True}  for s in required] +
            [{"name": s, "required": False} for s in preferred]
        )

        if not skills:
            logger.warning("extract_jd_skills: LLM returned empty skill list")
            return None

        logger.info(
            "extract_jd_skills: %d required, %d preferred skills extracted",
            len(required), len(preferred),
        )
        return skills

    except (ValueError, json.JSONDecodeError, KeyError) as e:
        logger.warning("extract_jd_skills: JSON parse failed: %s. Raw: %.200s", e, raw)
        return None


# ═══════════════════════════════════════════════════════════════════════════════
#  STAGE 2 — SKILL GAP ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════

_SKILL_GAP_SYSTEM = """You are a resume skills analyzer. Given a list of skills and a resume, classify each skill into exactly one category.

CATEGORIES:
- demonstrated: The resume clearly shows hands-on use of this skill (built with it, deployed it, used it in a project or job)
- partial: The resume mentions the skill or a closely related concept but does not clearly demonstrate hands-on experience
- missing: The skill is not mentioned or implied anywhere in the resume

OUTPUT SCHEMA (strict JSON only, no markdown fences, no explanation):
{
  "demonstrated": ["skill1", ...],
  "partial": ["skill2", ...],
  "missing": ["skill3", ...]
}

Rules:
- EVERY skill from the input list must appear in exactly one category — no omissions
- Use the EXACT skill name from the input list — do not rephrase or rename
- Be strict: "familiarity with X" in the resume is partial, not demonstrated
- "built X", "deployed X", "X in production", "X (years)" in the resume → demonstrated"""

_SKILL_GAP_USER = """Classify each skill against the resume.

SKILLS TO CLASSIFY:
{skills_list}

RESUME:
{resume_text}

Return JSON only. Every skill must appear in exactly one category."""


def analyze_skill_gap(
    skills: List[Dict],
    resume_text: str,
    config: LLMConfig,
) -> Optional[Dict]:
    """
    Stage 2: Classify extracted skills against the resume.

    Returns {"demonstrated": [...], "partial": [...], "missing": [...]}
    or None if LLM classification fails.
    """
    skill_names = [s["name"] for s in skills]
    skills_list = "\n".join(f"- {name}" for name in skill_names)

    user_prompt = _SKILL_GAP_USER.format(
        skills_list=skills_list,
        resume_text=resume_text[:6000],  # truncate to stay within context limits
    )

    raw = _try_call_with_fallback(_SKILL_GAP_SYSTEM, user_prompt, config)
    if raw is None:
        return None

    try:
        parsed = _extract_json(raw)
        demonstrated = [s for s in parsed.get("demonstrated", []) if isinstance(s, str)]
        partial      = [s for s in parsed.get("partial",      []) if isinstance(s, str)]
        missing      = [s for s in parsed.get("missing",      []) if isinstance(s, str)]

        # Find any skills the LLM forgot to classify and treat them as missing
        classified = {s.lower() for s in demonstrated + partial + missing}
        unclassified = [s["name"] for s in skills if s["name"].lower() not in classified]
        if unclassified:
            logger.warning(
                "analyze_skill_gap: %d skills unclassified, treating as missing: %s",
                len(unclassified), unclassified[:5],
            )
            missing.extend(unclassified)

        logger.info(
            "analyze_skill_gap: %d demonstrated, %d partial, %d missing",
            len(demonstrated), len(partial), len(missing),
        )
        return {"demonstrated": demonstrated, "partial": partial, "missing": missing}

    except (ValueError, json.JSONDecodeError, KeyError) as e:
        logger.warning("analyze_skill_gap: JSON parse failed: %s. Raw: %.200s", e, raw)
        return None
