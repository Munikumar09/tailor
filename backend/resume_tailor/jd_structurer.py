"""
jd_structurer.py
================
Layer 1 of the gap analysis pipeline.

Responsibility: Convert ANY raw JD text → clean StructuredJD dataclass.

Strategy:
  PRIMARY   — LLM structuring (Claude Haiku / any OpenAI-compatible model)
              Handles any format variation without rules.
  FALLBACK  — Rule-based structuring (v4 section detector)
              Used when LLM API is unavailable or returns malformed output.

Critical contract with the LLM:
  - Copy text VERBATIM. No paraphrasing, no summarising, no adding words.
  - Only reorganise into sections.
  - Preserve exact tech terms: LangChain stays LangChain, not "LangChain framework".
  - Return strict JSON only.

Why verbatim matters:
  The gap analyzer downstream does exact string matching against resume text.
  If the LLM paraphrases "5+ years of Python" into "extensive Python experience",
  the YOE extractor misses it and the phrase "5 years" is lost from the concept map.
"""

from __future__ import annotations

import json
import os
import re
import time
import logging
from utils.logger import get_logger
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
)
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage


logger = get_logger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
#  OUTPUT SCHEMA
#  This is what the rest of the pipeline consumes.
#  The LLM and the fallback both produce this same type.
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class StructuredJD:
    title: str                          # job title extracted from JD
    responsibilities: List[str]         # what the person will do
    required: List[str]                 # hard requirements
    preferred: List[str]                # nice-to-have / bonus
    about: List[str]                    # company/team description
    other: List[str]                    # anything that doesn't fit above
    raw_text: str                       # original unmodified input
    structuring_method: str             # "llm" | "fallback" | "passthrough"
    structuring_latency_ms: int         # how long structuring took

    @property
    def required_text(self) -> str:
        return " ".join(self.required)

    @property
    def preferred_text(self) -> str:
        return " ".join(self.preferred)

    @property
    def responsibilities_text(self) -> str:
        return " ".join(self.responsibilities)

    @property
    def full_jd_text(self) -> str:
        """All sections concatenated — used for phrase extraction."""
        parts = (
            self.responsibilities
            + self.required
            + self.preferred
            + self.about
            + self.other
        )
        return " ".join(parts)

    def to_dict(self) -> dict:
        return {
            "title": self.title,
            "responsibilities": self.responsibilities,
            "required": self.required,
            "preferred": self.preferred,
            "about": self.about,
            "other": self.other,
            "structuringMethod": self.structuring_method,
            "structuringLatencyMs": self.structuring_latency_ms,
        }


# ═══════════════════════════════════════════════════════════════════════════════
#  LLM STRUCTURER CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class LLMConfig:
    provider: str = "gemini"                     # "gemini" | "groq" | "openai" | "custom"
    model: str = "gemini-2.0-flash"
    api_key: Optional[str] = None                # falls back to env var
    base_url: Optional[str] = None               # for custom OpenAI-compatible endpoints
    timeout_seconds: float = 15.0
    max_retries: int = 2

    def get_api_key(self) -> str:
        if self.api_key:
            return self.api_key
        env_map = {
            "gemini": "GEMINI_API_KEY",
            "groq": "GROQ_API_KEY",
            "openai": "OPENAI_API_KEY",
        }
        env_var = env_map.get(self.provider, "LLM_API_KEY")
        key = os.environ.get(env_var, "")
        if not key:
            raise ValueError(
                f"No API key found. Set {env_var} environment variable "
                f"or pass api_key to LLMConfig."
            )
        return key


DEFAULT_LLM_CONFIG = LLMConfig()


def _read_env_key(key_name: str) -> Optional[str]:
    """Read a key from os.environ first, then directly from the .env file."""
    val = os.environ.get(key_name, "")
    if val:
        return val
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    if os.path.exists(env_path):
        with open(env_path) as _f:
            for line in _f:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, _, v = line.partition("=")
                    if k.strip() == key_name:
                        return v.strip().strip('"').strip("'")
    return None


# Groq is used as automatic fallback when the primary LLM fails
_GROQ_FALLBACK_CONFIG = LLMConfig(
    provider="groq",
    model="llama-3.3-70b-versatile",
    api_key=_read_env_key("GROQ_API_KEY"),
)


# ═══════════════════════════════════════════════════════════════════════════════
#  THE PROMPT CONTRACT
#
#  Design decisions:
#  1. Ask for JSON only — no markdown, no prose around it
#  2. "verbatim" repeated 3 times — LLMs tend to paraphrase unless told firmly
#  3. Explicit schema with field descriptions
#  4. Explicit "do not" list — LLMs follow negative constraints well
#  5. Short example to anchor the output format
# ═══════════════════════════════════════════════════════════════════════════════

_SYSTEM_PROMPT = """You are a job description parser. Your only job is to reorganise raw JD text into structured JSON sections.

CRITICAL RULES — violating any rule makes your output unusable:
1. Copy all text VERBATIM. Do not paraphrase, summarise, reword, or add any words.
2. Every word from the input must appear in exactly one output field.
3. Do NOT infer, expand, or interpret. If something is ambiguous, put it in "other".
4. Return ONLY valid JSON. No markdown code fences, no explanation, no preamble.
5. Preserve exact capitalisation and spelling of all terms (LangChain, GenAI, LoRA, etc).

OUTPUT SCHEMA:
{
  "title": "string — the job title only (e.g. 'Senior ML Engineer'). Empty string if not found.",
  "responsibilities": ["array of strings — what the person will do, verbatim from JD"],
  "required": ["array of strings — hard requirements, must-have qualifications, verbatim"],
  "preferred": ["array of strings — nice-to-have, bonus, 'is a plus', verbatim"],
  "about": ["array of strings — company/team description, verbatim"],
  "other": ["array of strings — anything that doesn't fit above, including metadata fields like Role:, Department:, Education:, Key Skills: etc"]
}

DO NOT:
- Combine multiple bullet points into one string
- Split one bullet point into multiple strings
- Add words like "Experience with" before a term that didn't have them
- Move a term between sections if it's clearly in one section in the original
- Omit any content from the input
"""

_USER_PROMPT_TEMPLATE = """Parse this job description into the JSON schema. Remember: verbatim text only, strict JSON output.

JD TEXT:
{jd_text}"""


# ═══════════════════════════════════════════════════════════════════════════════
#  LLM CLIENT — provider-agnostic
# ═══════════════════════════════════════════════════════════════════════════════

class LLMStructuringError(Exception):
    """Raised when LLM call fails and fallback should be used."""
    pass


class LLMQuotaError(Exception):
    """Raised on HTTP 429 quota exceeded — retrying the same provider won't help."""
    pass


@retry(
    retry=retry_if_exception_type(LLMStructuringError),
    stop=stop_after_attempt(2),
    wait=wait_exponential(multiplier=1, min=1, max=4),
    reraise=True,
)
def _call_llm(jd_text: str, config: LLMConfig) -> str:
    """
    Call the configured LLM and return raw response text.
    Raises LLMQuotaError on 429 (skip retry, go straight to fallback).
    Raises LLMStructuringError on other failures (triggers tenacity retry).
    """
    api_key = config.get_api_key()
    user_prompt = _USER_PROMPT_TEMPLATE.format(jd_text=jd_text.strip())
    messages = [SystemMessage(content=_SYSTEM_PROMPT), HumanMessage(content=user_prompt)]

    try:
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
        elif config.provider in ("openai", "custom"):
            return _call_openai_compatible(user_prompt, api_key, config)
        else:
            raise LLMStructuringError(f"Unknown provider: {config.provider}")
    except (LLMStructuringError, LLMQuotaError):
        raise
    except Exception as e:
        err_str = str(e).lower()
        if "429" in err_str or "quota" in err_str or "rate limit" in err_str or "resourceexhausted" in err_str:
            raise LLMQuotaError(f"LLM HTTP 429: {str(e)[:200]}") from e
        if "timeout" in err_str or "timed out" in err_str or "deadline" in err_str:
            raise LLMStructuringError(f"LLM timeout after {config.timeout_seconds}s: {e}") from e
        raise LLMStructuringError(f"LLM call failed: {type(e).__name__}: {e}") from e


def _call_openai_compatible(user_prompt: str, api_key: str, config: LLMConfig) -> str:
    """Used only for openai/custom providers — Gemini and Groq use their SDK clients above."""
    base_url = config.base_url or "https://api.openai.com"
    with httpx.Client(timeout=config.timeout_seconds) as client:
        resp = client.post(
            f"{base_url}/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": config.model,
                "max_tokens": 2048,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            },
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]


# ═══════════════════════════════════════════════════════════════════════════════
#  JSON PARSER + VALIDATOR
#  LLMs sometimes wrap JSON in ```json ... ``` or add a leading sentence.
#  Strip that before parsing. Validate the schema — if invalid, use fallback.
# ═══════════════════════════════════════════════════════════════════════════════

def _parse_llm_json(raw: str) -> dict:
    """
    Parse LLM output to dict. Handles common LLM formatting quirks.
    Raises ValueError if output cannot be parsed or fails schema check.
    """
    # Strip markdown code fences
    text = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text.strip(), flags=re.MULTILINE)
    text = text.strip()

    # Find the first { ... } block if there's preamble text
    brace_match = re.search(r"\{[\s\S]*\}", text)
    if not brace_match:
        raise ValueError("No JSON object found in LLM output")
    text = brace_match.group(0)

    parsed = json.loads(text)

    # Schema validation
    required_keys = {"title", "responsibilities", "required", "preferred", "about", "other"}
    missing = required_keys - set(parsed.keys())
    if missing:
        raise ValueError(f"LLM output missing keys: {missing}")

    # All list fields must actually be lists
    list_fields = {"responsibilities", "required", "preferred", "about", "other"}
    for f in list_fields:
        if not isinstance(parsed[f], list):
            raise ValueError(f"Field '{f}' is not a list in LLM output")

    # Flatten any nested lists (LLMs sometimes nest bullets)
    for f in list_fields:
        flat = []
        for item in parsed[f]:
            if isinstance(item, list):
                flat.extend(str(x) for x in item)
            else:
                flat.append(str(item))
        parsed[f] = [s.strip() for s in flat if s.strip()]

    return parsed


def _llm_output_to_structured(parsed: dict, raw_text: str, latency_ms: int) -> StructuredJD:
    return StructuredJD(
        title=str(parsed.get("title", "")).strip(),
        responsibilities=parsed.get("responsibilities", []),
        required=parsed.get("required", []),
        preferred=parsed.get("preferred", []),
        about=parsed.get("about", []),
        other=parsed.get("other", []),
        raw_text=raw_text,
        structuring_method="llm",
        structuring_latency_ms=latency_ms,
    )


# ═══════════════════════════════════════════════════════════════════════════════
#  VERBATIM COVERAGE CHECK
#  After LLM structuring, verify that all meaningful content from the input
#  appears somewhere in the output. This catches silent hallucination/omission.
#
#  Method: tokenise both input and output, check that ≥ 90% of input tokens
#  appear in output tokens. Cheap and reliable enough for production.
# ═══════════════════════════════════════════════════════════════════════════════

def _check_verbatim_coverage(original: str, structured: StructuredJD, threshold: float = 0.85) -> bool:
    """
    Returns True if the structured output covers ≥ threshold of input tokens.
    Logs a warning if below threshold but does NOT raise — fallback decision
    is made by the caller.
    """
    def tokenise_simple(text: str):
        return set(re.findall(r"[a-zA-Z0-9]+", text.lower()))

    input_tokens = tokenise_simple(original)
    output_tokens = tokenise_simple(structured.full_jd_text + " " + structured.title)

    # Ignore common stop words for this check — we care about content words
    stop = {"the", "a", "an", "and", "or", "in", "of", "to", "for", "with",
            "is", "are", "be", "as", "at", "by", "on", "not", "that", "this",
            "we", "you", "will", "your", "our", "etc", "e", "g", "eg"}
    content_tokens = input_tokens - stop

    if not content_tokens:
        return True

    covered = content_tokens & output_tokens
    coverage = len(covered) / len(content_tokens)

    if coverage < threshold:
        missing_sample = list(content_tokens - output_tokens)[:10]
        logger.warning(
            f"LLM structuring coverage {coverage:.1%} < {threshold:.0%}. "
            f"Sample missing tokens: {missing_sample}"
        )
        return False

    return True


# ═══════════════════════════════════════════════════════════════════════════════
#  RULE-BASED FALLBACK
#  Same logic as v4, but now it only runs when LLM fails.
#  Returns a StructuredJD with structuring_method="fallback".
# ═══════════════════════════════════════════════════════════════════════════════

_FB_SECTION_KEYS: Dict[str, List[str]] = {
    "required": [
        "required", "requirements", "must have", "must-have", "essential",
        "minimum qualification", "minimum qualifications",
        "minimum requirement", "minimum requirements",
        "basic qualification", "basic qualifications",
        "qualifications", "qualification",
        "mandatory skills", "required skills",
        "you must", "what you'll need", "what you need",
        "key requirements", "core requirements",
    ],
    "preferred": [
        "preferred", "nice to have", "nice-to-have", "bonus",
        "additional skills", "good to have", "ideally", "desired",
        "is a plus", "will be a plus", "would be a plus",
        "preferred qualifications", "preferred skills",
        "familiarity",
    ],
    "responsibilities": [
        "key responsibilities", "responsibilities",
        "what you'll do", "what you will do",
        "you will", "duties", "day to day", "your role",
        "roles and responsibilities", "job responsibilities",
        "what we expect",
    ],
    "about": [
        "about us", "about the company", "who we are",
        "our mission", "about the role", "company overview",
    ],
}

_FB_METADATA_TRIGGERS: set = {
    "role:", "industry type:", "industry:", "department:",
    "employment type:", "role category:", "job category:",
    "education", "ug:", "pg:", "key skills", "skills highlighted",
    "about company", "company profile", "perks and benefits",
    "salary:", "ctc:", "notice period:",
}

_FB_TITLE_WORDS = {
    "engineer", "developer", "scientist", "analyst", "manager",
    "lead", "architect", "designer", "specialist", "director",
    "researcher", "consultant", "intern", "associate",
}

_FB_TITLE_BLOCKLIST = [
    "software development", "software product", "engineering - ",
    "full time", "permanent", "any graduate", "software & qa",
]


def _fallback_strip_metadata(text: str) -> str:
    lines = text.split("\n")
    cleaned, in_meta = [], False
    for line in lines:
        ll = line.strip().lower()
        if not in_meta and any(ll.startswith(t) for t in _FB_METADATA_TRIGGERS) and len(ll) < 60:
            in_meta = True
            continue
        if not in_meta:
            cleaned.append(line)
    result = "\n".join(cleaned).strip()
    return result if len(result) >= len(text) * 0.2 else text


def _fallback_detect_sections(text: str) -> Dict[str, str]:
    from collections import defaultdict
    sections: Dict[str, str] = defaultdict(str)
    for para in re.split(r"\n{2,}", text):
        pl = para.lower()
        scores = {
            sec: sum(len(kw.split()) for kw in kws if kw in pl)
            for sec, kws in _FB_SECTION_KEYS.items()
        }
        best = max(scores, key=scores.get)
        target = best if scores[best] > 0 else "general"
        sections[target] += "\n" + para
    return dict(sections)


def _fallback_extract_title(text: str) -> str:
    for pattern in [
        r"(?:role|position|job title)\s*[:\-]\s*(.+)",
        r"(?:we(?:'re| are) (?:looking|hiring) for an?\s+)(.+?)(?:\s+to|\s+who|\.|$)",
    ]:
        m = re.search(pattern, text, re.IGNORECASE)
        if m:
            c = m.group(1).strip()
            cl = c.lower()
            if 3 < len(c) < 80 and not any(b in cl for b in _FB_TITLE_BLOCKLIST):
                return c
    for line in text.split("\n"):
        s = line.strip()
        sl = s.lower()
        if s and len(s) < 100:
            if any(w in sl for w in _FB_TITLE_WORDS) and not any(b in sl for b in _FB_TITLE_BLOCKLIST):
                return s
    return ""


def _section_to_bullets(section_text: str) -> List[str]:
    """Split a section block into individual bullet/sentence items."""
    lines = [l.strip() for l in section_text.split("\n") if l.strip()]
    bullets = []
    for line in lines:
        # Strip leading bullet characters
        line = re.sub(r"^[-•*·▪▸►‣⁃]\s*", "", line).strip()
        if line:
            bullets.append(line)
    return bullets


def _normalize_text(text: str) -> str:
    text = text.replace("\u2018", "'").replace("\u2019", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2013", "-").replace("\u2014", "-")
    text = re.sub(r"[\u00a0\u202f\u2009\u200b]", " ", text)
    text = text.replace("\ufb01", "fi").replace("\ufb02", "fl")
    text = re.sub(r"[ \t]{2,}", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _rule_based_structure(jd_text: str, latency_ms: int = 0) -> StructuredJD:
    """
    Rule-based fallback structurer.
    Less accurate than LLM but zero external dependencies.
    """
    normalized = _normalize_text(jd_text)
    stripped = _fallback_strip_metadata(normalized)
    sections = _fallback_detect_sections(stripped)
    title = _fallback_extract_title(stripped)

    return StructuredJD(
        title=title,
        responsibilities=_section_to_bullets(sections.get("responsibilities", "")),
        required=_section_to_bullets(sections.get("required", "")),
        preferred=_section_to_bullets(sections.get("preferred", "")),
        about=_section_to_bullets(sections.get("about", "")),
        other=_section_to_bullets(sections.get("general", "")),
        raw_text=jd_text,
        structuring_method="fallback",
        structuring_latency_ms=latency_ms,
    )


# ═══════════════════════════════════════════════════════════════════════════════
#  PUBLIC API
# ═══════════════════════════════════════════════════════════════════════════════

def _try_llm_structure(jd_text: str, config: LLMConfig) -> Optional[StructuredJD]:
    """
    Attempt LLM structuring with a given config.
    Returns StructuredJD on success, None on any failure.
    """
    t0 = time.perf_counter()
    try:
        raw = _call_llm(jd_text, config)
        latency_ms = int((time.perf_counter() - t0) * 1000)
        parsed = _parse_llm_json(raw)
        structured = _llm_output_to_structured(parsed, jd_text, latency_ms)
        if not _check_verbatim_coverage(jd_text, structured):
            logger.warning("LLM coverage check failed")
            return None
        logger.info(f"LLM structuring ({config.provider}) succeeded in {latency_ms}ms")
        return structured
    except LLMQuotaError as e:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        logger.warning(f"LLM structuring ({config.provider}) failed after {latency_ms}ms: {e}")
        return None
    except (LLMStructuringError, json.JSONDecodeError, ValueError, KeyError) as e:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        logger.warning(f"LLM structuring ({config.provider}) failed after {latency_ms}ms: {e}")
        return None


def structure_jd(
    jd_text: str,
    llm_config: Optional[LLMConfig] = None,
    force_fallback: bool = False,
) -> StructuredJD:
    """
    Convert raw JD text → StructuredJD.

    Fallback chain: Gemini → Groq → rule-based

    Args:
        jd_text:        Raw job description text (any format)
        llm_config:     LLM configuration. Defaults to Gemini 2.0 Flash.
        force_fallback: Skip LLM entirely and use rule-based. Useful for testing.

    Returns:
        StructuredJD with structuring_method indicating which path was used.
    """
    if not jd_text or not jd_text.strip():
        raise ValueError("jd_text cannot be empty")

    config = llm_config or DEFAULT_LLM_CONFIG

    if force_fallback:
        t0 = time.perf_counter()
        result = _rule_based_structure(jd_text, latency_ms=0)
        result.structuring_latency_ms = int((time.perf_counter() - t0) * 1000)
        return result

    # Try primary LLM (Gemini by default)
    try:
        config.get_api_key()
        result = _try_llm_structure(jd_text, config)
        if result:
            return result
    except ValueError:
        logger.info(f"No API key for {config.provider} — skipping primary LLM")

    # Try Groq fallback (if primary wasn't already Groq)
    if config.provider != "groq":
        try:
            _GROQ_FALLBACK_CONFIG.get_api_key()
            logger.info("Primary LLM failed — trying Groq fallback...")
            result = _try_llm_structure(jd_text, _GROQ_FALLBACK_CONFIG)
            if result:
                result.structuring_method = "llm-groq-fallback"
                return result
        except ValueError:
            logger.debug("GROQ_API_KEY not set — skipping Groq fallback")

    # Rule-based fallback
    logger.warning("All LLM attempts failed — using rule-based fallback")
    t0 = time.perf_counter()
    result = _rule_based_structure(jd_text)
    result.structuring_latency_ms = int((time.perf_counter() - t0) * 1000)
    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  ASYNC VERSION — for FastAPI
# ═══════════════════════════════════════════════════════════════════════════════

async def structure_jd_async(
    jd_text: str,
    llm_config: Optional[LLMConfig] = None,
    force_fallback: bool = False,
) -> StructuredJD:
    """
    Async wrapper around structure_jd for FastAPI endpoints.
    Runs the sync implementation in a thread pool to avoid blocking the event loop.
    """
    import asyncio
    from functools import partial

    fn = partial(structure_jd, jd_text, llm_config, force_fallback)
    return await asyncio.get_event_loop().run_in_executor(None, fn)