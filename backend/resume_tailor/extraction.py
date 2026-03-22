"""
extraction.py
=============
LLM-primary extraction engine for resume facts and JD requirements.

Architecture (four layers):

  Layer A — Extractor (Groq / primary model)
    Fast, cheap. Extracts all fields with per-field confidence signals.
    Each field returns: value + source_text + confidence enum + reasoning.
    Confidence enum: "explicit" | "inferred" | "not_found"

  Layer B — Deterministic Validator (pure Python, no LLM)
    Three checks per critical field:
      1. Internal consistency  — cross-field contradictions
      2. Coverage              — did extraction account for all input?
      3. Schema completeness   — no nulls on required fields
    Produces FieldValidation per field with failure_reason written
    specifically to be injected into the escalation prompt.

  Layer C — Escalation (Groq / stronger model)
    Triggered only when critical fields fail validation.
    Surgical: corrects failed fields only, not full re-extraction.
    Injects exact failure_reason from validator into prompt.
    Maximum one escalation. If escalation also fails validator,
    accepts result and logs — no further iterations.

  Layer D — Fallback (pure Python regex, no LLM)
    Triggered only on complete LLM unavailability:
      - No GROQ_API_KEY in environment
      - HTTP 429 after one retry
      - Timeout after one retry
    Section-aware regex: experience blocks only for YOE,
    education blocks only for degree.
    Takes min() of degree levels found (handles OR conservatively).
    Always returns extraction_method containing "fallback".

Groq model selection:
    Primary extractor:  llama-3.1-8b-instant  (fast, cheap, good at structured extraction)
    Escalation:         llama-3.3-70b-versatile (stronger, used surgically)

    Model selection rationale:
    - llama-3.1-8b-instant: 131k context, ~200 tok/s on Groq, handles JSON well,
      sufficient for well-defined extraction tasks with clear schema.
    - llama-3.3-70b-versatile: Groq's strongest available model, used only when
      the 8b model produced something the validator rejected on a critical field.
    Both are open-source weights running on Groq's inference infrastructure.

Public API:
    from extraction import extract_candidate_facts, extract_jd_requirements
    from extraction import CandidateFacts, JDRequirements

    facts = extract_candidate_facts(sectioned_resume)
    reqs  = extract_jd_requirements(structured_jd)

Both functions are drop-in replacements for the old Anthropic-based versions
in ats_scorer.py. The output dataclasses are backwards-compatible with an
additional `provenance` field for transparency.
"""

from __future__ import annotations

import json
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from .types import ResumeSection

import httpx

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
#  GROQ CLIENT CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

# Primary: fast 8B model — sufficient for well-defined structured extraction
_GROQ_PRIMARY_MODEL   = "llama-3.1-8b-instant"

# Escalation: 70B model — used only when primary fails validation on critical fields
_GROQ_ESCALATION_MODEL = "llama-3.3-70b-versatile"

_GROQ_API_BASE    = "https://api.groq.com/openai/v1"
_GROQ_TIMEOUT     = 12.0   # seconds — tight enough to fail fast
_GROQ_MAX_TOKENS  = 512    # extraction responses are short; cap prevents verbose drift

# HTTP status codes worth retrying once before failing over to fallback
_RETRYABLE_STATUS  = {429, 500, 502, 503, 504}


# ═══════════════════════════════════════════════════════════════════════════════
#  DEGREE REFERENCE DATA
# ═══════════════════════════════════════════════════════════════════════════════

DEGREE_LEVELS: Dict[str, int] = {
    "phd": 5, "doctorate": 5,
    "masters": 4, "master": 4, "msc": 4, "ms": 4, "mba": 4,
    "bachelors": 3, "bachelor": 3, "bsc": 3, "bs": 3,
    "be": 3, "btech": 3,
    "associate": 2, "diploma": 2,
    "any": 1, "graduate": 1,
    "none": 0,
}

DEGREE_LEVEL_NAMES: Dict[int, str] = {
    0: "None", 1: "Any Graduate", 2: "Diploma/Associate",
    3: "Bachelor's", 4: "Master's", 5: "PhD",
}

_CURRENT_YEAR = 2025


# ═══════════════════════════════════════════════════════════════════════════════
#  OUTPUT DATACLASSES
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ExtractionProvenance:
    """
    Full audit trail for a single extraction result.
    Surfaced in knockout check output so users can see how confident
    the system is in each decision.
    """
    extraction_method: str              # see _METHOD_* constants below
    primary_model: str                  # model used for primary extraction
    escalation_model: Optional[str]     # model used for escalation (if triggered)
    fields_escalated: List[str]         # fields corrected by escalation
    fields_from_fallback: List[str]     # fields that came from regex fallback
    confidence_by_field: Dict[str, str] # "explicit" | "inferred" | "not_found"
    validator_failures: List[str]       # what the validator caught (even if resolved)
    latency_ms: int

    def to_dict(self) -> dict:
        return {
            "extractionMethod": self.extraction_method,
            "primaryModel": self.primary_model,
            "escalationModel": self.escalation_model,
            "fieldsEscalated": self.fields_escalated,
            "fieldsFromFallback": self.fields_from_fallback,
            "confidenceByField": self.confidence_by_field,
            "validatorFailures": self.validator_failures,
            "latencyMs": self.latency_ms,
        }


# Extraction method constants — appear in check output and logs
_METHOD_LLM_PRIMARY    = "llm-primary"
_METHOD_LLM_ESCALATED  = "llm-primary+escalation"
_METHOD_FALLBACK       = "fallback-regex"
_METHOD_PARTIAL        = "llm-primary+partial-fallback"


@dataclass
class CandidateFacts:
    """
    Structured facts extracted from resume.
    Drop-in replacement for the old version — provenance field is additive.
    """
    work_experience_years: int
    highest_degree_level: int
    highest_degree_name: str
    current_role_title: str
    career_gap_months: int              # 0 if no gap detected
    total_companies: int

    # Extraction metadata
    extraction_method: str              # backwards-compat alias for provenance.extraction_method
    provenance: ExtractionProvenance
    raw_llm_output: Optional[str]       # primary model raw output, for debugging


@dataclass
class JDRequirements:
    """
    Structured requirements extracted from JD.
    Drop-in replacement for the old version — provenance field is additive.
    """
    min_yoe: Optional[int]
    min_degree_level: int
    min_degree_name: str
    degree_is_strict: bool              # False = "preferred", True = "required"
    location_requirement: str           # "remote" | "onsite" | "hybrid" | "not_specified"
    authorization_requirement: str      # raw text if found, else ""

    # Extraction metadata
    extraction_method: str
    provenance: ExtractionProvenance
    raw_llm_output: Optional[str]


# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER A — EXTRACTOR
#  Prompts designed for Llama 3.1/3.3 on Groq.
#  Key design decisions:
#    - Schema documented inline in system prompt (Llama follows inline schemas well)
#    - Confidence enum is required per field — drives validator
#    - source_text required per field — validator checks it against input
#    - reasoning field required — validator can detect reasoning/value contradictions
#    - Single JSON object response — no streaming, no prose
# ═══════════════════════════════════════════════════════════════════════════════

_RESUME_EXTRACTION_SYSTEM = """\
You are a precise resume parser. Extract structured information from the resume.
Return ONLY a valid JSON object. No markdown, no prose, no explanation outside JSON.

For EVERY field, return an object with:
  "value":       the extracted value (type varies per field)
  "source_text": the exact phrase(s) from the resume you used (empty string if not found)
  "confidence":  one of "explicit" (directly stated), "inferred" (calculated/concluded), "not_found"
  "reasoning":   one sentence explaining how you determined the value

SCHEMA:
{
  "work_experience_years": {
    "value": <integer: total WORK years only — sum employment durations, exclude education>,
    "source_text": "<exact date ranges from job entries>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  },
  "highest_degree": {
    "value": <one of: "none","diploma","associate","bachelors","masters","phd">,
    "source_text": "<exact degree text from resume>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  },
  "highest_degree_name": {
    "value": "<exact degree name as written, e.g. 'Bachelor of Technology'>",
    "source_text": "<same as above>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  },
  "current_role_title": {
    "value": "<most recent job title as written in resume>",
    "source_text": "<exact title text>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  },
  "career_gap_months": {
    "value": <integer: months between last role end and present, 0 if currently employed>,
    "source_text": "<date evidence>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  },
  "total_companies": {
    "value": <integer: count of distinct employers>,
    "source_text": "<employer names found>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  }
}

CRITICAL RULES:
- work_experience_years: count WORK/EMPLOYMENT only. Education years (e.g. B.Tech 2019-2023) must NOT be included.
  If a role end date is "Present" or "Current", use 2025 as end year.
  Sum all role durations independently then add them up — do not do max(year) - min(year).
- highest_degree: use the exact enum values listed above.
- career_gap_months: 0 if currently employed (role end = Present/Current).
- If a value cannot be determined, set confidence to "not_found" and value to 0 or "" or "none" as appropriate.\
"""

_RESUME_EXTRACTION_USER = """\
Extract structured information from this resume:

{resume_text}\
"""

_JD_EXTRACTION_SYSTEM = """\
You are a precise job description parser. Extract hiring requirements.
Return ONLY a valid JSON object. No markdown, no prose, no explanation outside JSON.

For EVERY field, return an object with:
  "value":       the extracted value
  "source_text": exact phrase(s) from the JD you used
  "confidence":  one of "explicit" (directly stated), "inferred" (concluded from context), "not_found"
  "reasoning":   one sentence

SCHEMA:
{
  "min_yoe": {
    "value": <integer or null: MINIMUM years required. null if not specified>,
    "source_text": "<exact phrase>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  },
  "min_degree": {
    "value": <one of: "none","diploma","associate","bachelors","masters","phd"
              — the MINIMUM ACCEPTABLE degree. If "Bachelor's OR Master's" → "bachelors".
              If "Master's preferred" (not required) → "none".
              If "Master's required" → "masters">,
    "source_text": "<exact phrase>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  },
  "min_degree_name": {
    "value": "<human-readable minimum, e.g. 'Bachelor\\'s' or 'Not specified'>",
    "source_text": "<exact phrase>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  },
  "degree_is_strict": {
    "value": <true if degree is a hard requirement, false if preferred/nice-to-have>,
    "source_text": "<evidence phrase>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  },
  "location_requirement": {
    "value": <one of: "remote","onsite","hybrid","not_specified">,
    "source_text": "<evidence phrase or empty>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  },
  "authorization_requirement": {
    "value": "<raw text of any citizenship/sponsorship/authorization requirement, or empty string>",
    "source_text": "<exact phrase>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence>"
  }
}

CRITICAL RULES:
- min_yoe: extract the MINIMUM. "3-5 years" → 3. "5+ years" → 5. "at least 3 years" → 3.
  If the requirement uses "preferred" or "nice to have", set to null (not a hard requirement).
- min_degree: OR conditions → take the LOWER degree.
  "Bachelor's or Master's" → "bachelors". Always the minimum bar, never the ideal.
- degree_is_strict: true only if language is "required", "must have", "minimum".
  "preferred", "plus", "nice to have" → false.\
"""

_JD_EXTRACTION_USER = """\
Extract hiring requirements from this job description.

REQUIRED SECTION:
{required_text}

FULL JD (for context — do not extract from preferred/about sections unless required section is empty):
{full_jd_text}\
"""

# Escalation prompt — injected with specific field failures from the validator
_ESCALATION_SYSTEM = """\
You are a precise data extractor correcting specific errors in a previous extraction.
Return ONLY a valid JSON object containing ONLY the fields listed below.
No markdown, no prose, no extra fields.\
"""

_ESCALATION_USER = """\
A previous extraction produced errors on specific fields. Correct only those fields.

ORIGINAL TEXT:
{source_text}

PREVIOUS EXTRACTION RESULT (for context):
{previous_result}

FIELDS TO CORRECT AND WHY:
{field_corrections}

Return a JSON object with ONLY the corrected fields, each in the same schema format:
{{
  "field_name": {{
    "value": <corrected value>,
    "source_text": "<exact phrase you used>",
    "confidence": "explicit" | "inferred" | "not_found",
    "reasoning": "<one sentence explaining the correction>"
  }}
}}\
"""


# ═══════════════════════════════════════════════════════════════════════════════
#  GROQ HTTP CLIENT
# ═══════════════════════════════════════════════════════════════════════════════

class GroqUnavailableError(Exception):
    """Raised when Groq is completely unavailable — triggers fallback."""
    pass


class GroqRetryableError(Exception):
    """Raised on transient errors — one retry attempted before fallback."""
    pass


def _get_groq_key() -> Optional[str]:
    return os.environ.get("GROQ_API_KEY", "").strip() or None


def _call_groq(
    system: str,
    user: str,
    model: str,
    timeout: float = _GROQ_TIMEOUT,
) -> str:
    """
    Single Groq API call. Returns raw response text.
    Raises GroqUnavailableError or GroqRetryableError on failure.

    One retry on retryable status codes (429, 5xx) with 2s backoff.
    After one retry, raises to trigger fallback.
    """
    api_key = _get_groq_key()
    if not api_key:
        raise GroqUnavailableError("GROQ_API_KEY not set")

    payload = {
        "model": model,
        "max_tokens": _GROQ_MAX_TOKENS,
        "temperature": 0.0,             # zero temperature for deterministic extraction
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user},
        ],
    }

    last_exc: Optional[Exception] = None

    for attempt in range(2):   # attempt 0 = primary, attempt 1 = one retry
        if attempt > 0:
            time.sleep(2.0)    # brief backoff before retry

        try:
            with httpx.Client(timeout=timeout) as client:
                resp = client.post(
                    f"{_GROQ_API_BASE}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type":  "application/json",
                    },
                    json=payload,
                )

                if resp.status_code in _RETRYABLE_STATUS:
                    last_exc = GroqRetryableError(
                        f"Groq HTTP {resp.status_code}: {resp.text[:200]}"
                    )
                    continue   # retry once

                if resp.status_code == 401:
                    raise GroqUnavailableError(
                        f"Groq authentication failed — check GROQ_API_KEY"
                    )

                resp.raise_for_status()
                return resp.json()["choices"][0]["message"]["content"]

        except httpx.TimeoutException as e:
            last_exc = GroqRetryableError(f"Groq timeout: {e}")
            continue
        except GroqUnavailableError:
            raise
        except Exception as e:
            raise GroqUnavailableError(f"Groq call failed: {type(e).__name__}: {e}") from e

    # Both attempts exhausted
    raise GroqUnavailableError(
        f"Groq unavailable after 2 attempts: {last_exc}"
    ) from last_exc


def _parse_json_response(raw: str) -> Optional[dict]:
    """
    Parse JSON from LLM output.
    Handles markdown fences, leading prose, trailing text.
    Returns None if unparseable.
    """
    if not raw:
        return None

    text = re.sub(r"^```[a-zA-Z]*\s*", "", raw.strip(), flags=re.MULTILINE)
    text = re.sub(r"```\s*$", "", text.strip(), flags=re.MULTILINE)
    text = text.strip()

    # Find the outermost { ... } block
    brace_match = re.search(r"\{[\s\S]*\}", text)
    if not brace_match:
        return None

    try:
        return json.loads(brace_match.group(0))
    except json.JSONDecodeError:
        # Try to repair truncated JSON by finding the last complete field
        # This handles cases where max_tokens was hit mid-response
        partial = brace_match.group(0)
        last_comma = partial.rfind(",")
        if last_comma > 0:
            try:
                return json.loads(partial[:last_comma] + "}")
            except json.JSONDecodeError:
                pass
        return None


def _extract_field_value(parsed: dict, field: str, default: Any = None) -> Any:
    """Extract value from nested {value, source_text, confidence, reasoning} schema."""
    field_data = parsed.get(field)
    if isinstance(field_data, dict):
        return field_data.get("value", default)
    # Flat value (escalation response may return flat)
    return field_data if field_data is not None else default


def _extract_field_confidence(parsed: dict, field: str) -> str:
    field_data = parsed.get(field)
    if isinstance(field_data, dict):
        return field_data.get("confidence", "not_found")
    return "explicit" if field_data is not None else "not_found"


def _extract_field_source(parsed: dict, field: str) -> str:
    field_data = parsed.get(field)
    if isinstance(field_data, dict):
        return field_data.get("source_text", "")
    return ""


def _extract_field_reasoning(parsed: dict, field: str) -> str:
    field_data = parsed.get(field)
    if isinstance(field_data, dict):
        return field_data.get("reasoning", "")
    return ""


# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER B — DETERMINISTIC VALIDATOR
#  Pure Python. Three checks per critical field.
#  failure_reason is written here — designed to be injected verbatim
#  into the escalation prompt.
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class FieldValidation:
    field: str
    passes: bool
    failure_reason: str        # injected into escalation prompt verbatim
    check_type: str            # "consistency" | "coverage" | "completeness"
    is_critical: bool          # if True and fails → triggers escalation


@dataclass
class ValidationReport:
    all_pass: bool
    failed_fields: List[FieldValidation]
    passed_fields: List[str]
    has_critical_failure: bool


# Fields that trigger escalation if they fail
_CRITICAL_RESUME_FIELDS  = {"work_experience_years", "highest_degree"}
_CRITICAL_JD_FIELDS      = {"min_yoe", "min_degree"}

# Simple date pattern for coverage check
_DATE_PATTERN = re.compile(r"\b(20[0-2]\d|19[89]\d)\b")
_EMPLOYER_PATTERN = re.compile(
    r"(?:^|\n)\s*([A-Z][A-Za-z\s&,\.]+(?:Inc|LLC|Ltd|Corp|Global|Services|Solutions)?)"
    r"\s*[—\-–|]\s*",
    re.MULTILINE,
)


def validate_resume_extraction(
    parsed: dict,
    resume_text: str,
) -> ValidationReport:
    """
    Layer B for resume extraction.
    Runs consistency, coverage, and completeness checks.
    """
    failures: List[FieldValidation] = []
    passed:   List[str] = []

    yoe_value      = _extract_field_value(parsed, "work_experience_years", 0)
    yoe_source     = _extract_field_source(parsed, "work_experience_years")
    yoe_confidence = _extract_field_confidence(parsed, "work_experience_years")
    yoe_reasoning  = _extract_field_reasoning(parsed, "work_experience_years")
    degree_value   = _extract_field_value(parsed, "highest_degree", "none")
    degree_conf    = _extract_field_confidence(parsed, "highest_degree")
    title_value    = _extract_field_value(parsed, "current_role_title", "")
    companies      = _extract_field_value(parsed, "total_companies", 0)
    gap_value      = _extract_field_value(parsed, "career_gap_months", 0)
    gap_conf       = _extract_field_confidence(parsed, "career_gap_months")

    # ── Completeness checks ───────────────────────────────────────────────────

    if yoe_value is None:
        failures.append(FieldValidation(
            field="work_experience_years",
            passes=False,
            failure_reason=(
                "work_experience_years is null. "
                "Please determine if the resume contains any work history "
                "and extract the total duration in years. "
                "If no work history is present, return 0."
            ),
            check_type="completeness",
            is_critical=True,
        ))
    else:
        passed.append("work_experience_years:completeness")

    if degree_value is None:
        failures.append(FieldValidation(
            field="highest_degree",
            passes=False,
            failure_reason=(
                "highest_degree is null. "
                "Please find the highest academic qualification in the resume. "
                "If none found, return 'none'."
            ),
            check_type="completeness",
            is_critical=True,
        ))
    else:
        passed.append("highest_degree:completeness")

    # ── Consistency checks ────────────────────────────────────────────────────

    # Check 1: YOE vs date range span in source text
    if yoe_value and yoe_source:
        years_in_source = [int(m) for m in _DATE_PATTERN.findall(yoe_source)]
        if years_in_source:
            span = max(years_in_source) - min(years_in_source)
            # YOE should not exceed the full span by more than 1 year
            # (parallel roles can make YOE slightly exceed span)
            if yoe_value > span + 1:
                failures.append(FieldValidation(
                    field="work_experience_years",
                    passes=False,
                    failure_reason=(
                        f"Extracted work_experience_years={yoe_value} but the source text "
                        f"'{yoe_source}' only spans {span} years (from {min(years_in_source)} "
                        f"to {max(years_in_source)}). "
                        f"This usually means education dates were included in the calculation. "
                        f"Please re-extract using ONLY employment/work entries, "
                        f"ignoring any education date ranges."
                    ),
                    check_type="consistency",
                    is_critical=True,
                ))
            else:
                passed.append("work_experience_years:consistency")
        else:
            passed.append("work_experience_years:consistency")
    else:
        passed.append("work_experience_years:consistency")

    # Check 2: confidence="explicit" requires non-empty source_text
    if yoe_confidence == "explicit" and not yoe_source.strip():
        failures.append(FieldValidation(
            field="work_experience_years",
            passes=False,
            failure_reason=(
                "work_experience_years has confidence='explicit' but source_text is empty. "
                "If explicitly stated, provide the exact phrase from the resume. "
                "If calculated from date ranges, set confidence='inferred'."
            ),
            check_type="consistency",
            is_critical=False,  # non-critical: value might still be correct
        ))
    else:
        passed.append("work_experience_years:source_consistency")

    # Check 3: current_role_title must appear in resume text
    if title_value and len(title_value) > 3:
        if title_value.lower() not in resume_text.lower():
            failures.append(FieldValidation(
                field="current_role_title",
                passes=False,
                failure_reason=(
                    f"current_role_title='{title_value}' does not appear verbatim "
                    f"in the resume text. The title must be copied exactly as written "
                    f"in the resume — do not paraphrase or infer a title."
                ),
                check_type="consistency",
                is_critical=False,
            ))
        else:
            passed.append("current_role_title:consistency")

    # Check 4: career_gap_months consistency
    # If confidence is explicit and value > 0, check "Present"/"Current" isn't in resume
    if gap_value > 0 and gap_conf == "explicit":
        present_signals = ["present", "current", "ongoing"]
        has_present = any(sig in resume_text.lower() for sig in present_signals)
        if has_present:
            failures.append(FieldValidation(
                field="career_gap_months",
                passes=False,
                failure_reason=(
                    f"career_gap_months={gap_value} but the resume contains a "
                    f"'Present'/'Current' role — the candidate is currently employed "
                    f"so the gap should be 0. Please re-check."
                ),
                check_type="consistency",
                is_critical=False,
            ))
        else:
            passed.append("career_gap_months:consistency")

    # ── Coverage checks ───────────────────────────────────────────────────────

    # Check 5: YOE coverage — did extraction account for all employment entries?
    # Count approximate employer entries in resume text
    all_years = [int(m) for m in _DATE_PATTERN.findall(resume_text)]
    # Each employment entry typically has 2 years (start + end)
    # If there are N*2 date-like patterns in experience context, there are ~N roles
    # This is a rough heuristic — false positives possible but trigger is conservative
    emp_year_pairs = len(all_years) // 2
    companies_val = int(companies) if companies else 0

    if emp_year_pairs > companies_val + 2:
        # More date pairs than reported companies — possible missed entries
        failures.append(FieldValidation(
            field="work_experience_years",
            passes=False,
            failure_reason=(
                f"The resume text contains approximately {emp_year_pairs} year-pairs "
                f"but only {companies_val} companies were reported. "
                f"Some employment entries may have been missed. "
                f"Please re-count all WORK entries (not education) and re-sum the durations."
            ),
            check_type="coverage",
            is_critical=False,  # coverage issue — may inflate but not false-fail
        ))
    else:
        passed.append("work_experience_years:coverage")

    all_pass = len([f for f in failures if f.is_critical]) == 0
    has_critical = not all_pass

    return ValidationReport(
        all_pass=all_pass,
        failed_fields=failures,
        passed_fields=passed,
        has_critical_failure=has_critical,
    )


def validate_jd_extraction(
    parsed: dict,
    jd_required_text: str,
) -> ValidationReport:
    """
    Layer B for JD requirements extraction.
    """
    failures: List[FieldValidation] = []
    passed:   List[str] = []

    yoe_value      = _extract_field_value(parsed, "min_yoe", None)
    yoe_source     = _extract_field_source(parsed, "min_yoe")
    yoe_reasoning  = _extract_field_reasoning(parsed, "min_yoe")
    degree_value   = _extract_field_value(parsed, "min_degree", "none")
    degree_source  = _extract_field_source(parsed, "min_degree")
    degree_strict  = _extract_field_value(parsed, "degree_is_strict", False)
    degree_conf    = _extract_field_confidence(parsed, "min_degree")

    # ── Completeness ──────────────────────────────────────────────────────────

    if degree_value is None:
        failures.append(FieldValidation(
            field="min_degree",
            passes=False,
            failure_reason=(
                "min_degree is null. Return 'none' if no degree requirement found."
            ),
            check_type="completeness",
            is_critical=True,
        ))
    else:
        passed.append("min_degree:completeness")

    # ── Consistency ───────────────────────────────────────────────────────────

    # Check 1: YOE sanity range
    if yoe_value is not None:
        try:
            yoe_int = int(yoe_value)
            if yoe_int > 25:
                failures.append(FieldValidation(
                    field="min_yoe",
                    passes=False,
                    failure_reason=(
                        f"min_yoe={yoe_int} is implausibly high. "
                        f"JDs rarely require more than 15 years. "
                        f"Please re-read the requirement — you may have extracted "
                        f"a year (e.g. 2019) instead of a duration."
                    ),
                    check_type="consistency",
                    is_critical=True,
                ))
            elif yoe_int == 0:
                failures.append(FieldValidation(
                    field="min_yoe",
                    passes=False,
                    failure_reason=(
                        f"min_yoe=0 but source_text='{yoe_source}' suggests "
                        f"a requirement was found. If 0 years is genuinely the minimum, "
                        f"set min_yoe to null instead (no minimum)."
                    ),
                    check_type="consistency",
                    is_critical=False,
                ))
            else:
                passed.append("min_yoe:consistency")
        except (TypeError, ValueError):
            failures.append(FieldValidation(
                field="min_yoe",
                passes=False,
                failure_reason=f"min_yoe='{yoe_value}' is not an integer. Return an integer or null.",
                check_type="consistency",
                is_critical=True,
            ))
    else:
        passed.append("min_yoe:consistency")   # null is valid

    # Check 2: degree OR condition detection
    # If the required text contains both "bachelor" and "master" near "or",
    # the degree should be "bachelors" (the minimum)
    req_lower = jd_required_text.lower()
    has_or_condition = (
        "or" in req_lower
        and any(b in req_lower for b in ["bachelor", "bsc", "btech", "be"])
        and any(m in req_lower for m in ["master", "msc", "mba"])
    )
    if has_or_condition and degree_value in ("masters", "phd", "msc"):
        failures.append(FieldValidation(
            field="min_degree",
            passes=False,
            failure_reason=(
                f"The JD required section contains an OR condition between Bachelor's and "
                f"Master's degrees, but min_degree='{degree_value}' was extracted. "
                f"When degrees are listed with OR, the minimum acceptable is the LOWER degree. "
                f"'Bachelor\\'s or Master\\'s degree' → return 'bachelors'."
            ),
            check_type="consistency",
            is_critical=True,
        ))
    elif degree_value is not None:
        passed.append("min_degree:or_condition")

    # Check 3: degree_is_strict vs language
    preferred_signals = ["preferred", "nice to have", "is a plus", "ideally", "desired"]
    has_preferred_language = any(sig in req_lower for sig in preferred_signals)
    if degree_strict and has_preferred_language and degree_source:
        source_lower = degree_source.lower()
        if any(sig in source_lower for sig in preferred_signals):
            failures.append(FieldValidation(
                field="degree_is_strict",
                passes=False,
                failure_reason=(
                    f"degree_is_strict=True but source_text='{degree_source}' "
                    f"contains preferred/optional language. "
                    f"degree_is_strict should be False when degree is not a hard requirement."
                ),
                check_type="consistency",
                is_critical=False,
            ))
        else:
            passed.append("degree_is_strict:consistency")
    else:
        passed.append("degree_is_strict:consistency")

    all_pass = len([f for f in failures if f.is_critical]) == 0
    return ValidationReport(
        all_pass=all_pass,
        failed_fields=failures,
        passed_fields=passed,
        has_critical_failure=not all_pass,
    )


# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER C — ESCALATION EXTRACTOR
#  Surgical: corrects only the failed fields, not full re-extraction.
#  Uses stronger model. Maximum one escalation per request.
# ═══════════════════════════════════════════════════════════════════════════════

def _build_escalation_prompt_user(
    source_text: str,
    previous_parsed: dict,
    failed_validations: List[FieldValidation],
) -> str:
    """Build the escalation user prompt from validator failures."""
    # Format field corrections block
    corrections_lines = []
    for fv in failed_validations:
        corrections_lines.append(
            f"Field: {fv.field}\n"
            f"Check type: {fv.check_type}\n"
            f"Problem: {fv.failure_reason}"
        )
    field_corrections = "\n\n".join(corrections_lines)

    # Sanitize previous result for context (remove raw LLM output noise)
    prev_clean = {}
    for key, val in previous_parsed.items():
        if isinstance(val, dict):
            prev_clean[key] = {
                "value": val.get("value"),
                "confidence": val.get("confidence"),
            }
        else:
            prev_clean[key] = val

    return _ESCALATION_USER.format(
        source_text=source_text[:3000],  # cap to avoid token overflow
        previous_result=json.dumps(prev_clean, indent=2),
        field_corrections=field_corrections,
    )


def _escalate_extraction(
    source_text: str,
    previous_parsed: dict,
    failed_validations: List[FieldValidation],
) -> Tuple[dict, str]:
    """
    Layer C: call stronger model to correct specific failed fields.
    Returns (corrected_fields_dict, raw_response).
    Raises GroqUnavailableError if escalation model is unavailable.
    """
    critical_failures = [f for f in failed_validations if f.is_critical]
    if not critical_failures:
        return {}, ""

    user_prompt = _build_escalation_prompt_user(
        source_text, previous_parsed, critical_failures
    )

    raw = _call_groq(
        system=_ESCALATION_SYSTEM,
        user=user_prompt,
        model=_GROQ_ESCALATION_MODEL,
    )

    corrected = _parse_json_response(raw) or {}
    return corrected, raw


def _merge_extractions(primary: dict, corrections: dict) -> dict:
    """
    Merge corrected fields into primary extraction result.
    Corrections override primary for the specific fields they address.
    """
    merged = dict(primary)
    for field, corrected_val in corrections.items():
        if field in merged:
            if isinstance(corrected_val, dict) and isinstance(merged[field], dict):
                # Update in place, keeping any fields the correction didn't touch
                merged[field] = {**merged[field], **corrected_val}
            else:
                merged[field] = corrected_val
    return merged


# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER D — FALLBACK
#  Section-aware regex. Triggered only on complete LLM unavailability.
# ═══════════════════════════════════════════════════════════════════════════════

_FALLBACK_DATE_RE = re.compile(r"\b(20[0-2]\d|19[89]\d)\b")
_FALLBACK_DEGREE_RE = re.compile(
    r"\b(phd|ph\.d|doctorate|master(?:s)?|m\.?sc?|mba|"
    r"bachelor(?:s)?|b\.?sc?|be|b\.?e|btech|b\.?tech|"
    r"associate|diploma|graduate)\b",
    re.IGNORECASE,
)
_FALLBACK_YOE_RE = re.compile(
    r"(\d+)\+?\s*(?:to\s*\d+\s*)?(?:years?|yrs?)"
    r"(?:\s+(?:of\s+)?(?:experience|exp|work))?",
    re.IGNORECASE,
)


def _fallback_candidate_facts(
    resume_blocks_by_section: dict,
    full_text: str,
) -> Tuple[int, int, str]:
    """
    Returns (work_experience_years, degree_level, degree_name).
    Section-aware: experience blocks only for YOE, education blocks only for degree.
    """

    # YOE: experience section blocks only
    exp_blocks = resume_blocks_by_section.get(ResumeSection.EXPERIENCE, [])
    exp_years: List[int] = []
    has_present = False
    for block in exp_blocks:
        exp_years.extend(int(m) for m in _FALLBACK_DATE_RE.findall(block.full_text))
        if any(w in block.full_text.lower() for w in ("present", "current", "ongoing")):
            has_present = True

    fallback_yoe = 0
    if len(exp_years) >= 2:
        max_year = _CURRENT_YEAR if has_present else max(exp_years)
        fallback_yoe = max_year - min(exp_years)

    # Degree: education section only
    edu_blocks = resume_blocks_by_section.get(ResumeSection.EDUCATION, [])
    edu_text = " ".join(b.full_text for b in edu_blocks)
    fallback_deg = 0
    fallback_deg_name = ""
    for m_obj in _FALLBACK_DEGREE_RE.finditer(edu_text.lower()):
        level = DEGREE_LEVELS.get(m_obj.group(1).lower().replace(".", ""), 0)
        if level > fallback_deg:
            fallback_deg = level
            fallback_deg_name = m_obj.group(1)

    if fallback_deg == 0:
        fallback_deg = 3  # conservative: bachelor's avoids false-failing most candidates

    return fallback_yoe, fallback_deg, fallback_deg_name


def _fallback_jd_requirements(required_text: str) -> Tuple[Optional[int], int, str]:
    """
    Returns (min_yoe, min_degree_level, min_degree_name).
    Takes min() of degree levels — handles OR conditions conservatively.
    """
    yoe_matches = [
        int(m) for m in _FALLBACK_YOE_RE.findall(required_text) if int(m) > 0
    ]
    fallback_yoe = min(yoe_matches) if yoe_matches else None

    deg_levels: List[int] = []
    for m_obj in _FALLBACK_DEGREE_RE.finditer(required_text.lower()):
        level = DEGREE_LEVELS.get(m_obj.group(1).lower().replace(".", ""), 0)
        if level > 0:
            deg_levels.append(level)
    # min() handles "Bachelor's or Master's" → returns 3 (bachelor's)
    fallback_deg = min(deg_levels) if deg_levels else 0

    return fallback_yoe, fallback_deg, DEGREE_LEVEL_NAMES.get(fallback_deg, "Not specified")


# ═══════════════════════════════════════════════════════════════════════════════
#  ORCHESTRATOR — wires all four layers together
# ═══════════════════════════════════════════════════════════════════════════════

def extract_candidate_facts(resume) -> CandidateFacts:
    """
    Public API. Layer A → B → C → D orchestration for resume extraction.

    Args:
        resume: SectionedResume from ats_scorer.parse_resume_from_ast()

    Returns:
        CandidateFacts with full provenance trail
    """
    t_start = time.perf_counter()
    resume_text = resume.full_text

    fields_escalated: List[str] = []
    fields_from_fallback: List[str] = []
    validator_failures: List[str] = []
    escalation_model_used: Optional[str] = None
    primary_raw: Optional[str] = None
    primary_parsed: Optional[dict] = None
    method = _METHOD_LLM_PRIMARY

    # ── Layer A: Primary extraction ───────────────────────────────────────────
    try:
        primary_raw = _call_groq(
            system=_RESUME_EXTRACTION_SYSTEM,
            user=_RESUME_EXTRACTION_USER.format(resume_text=resume_text),
            model=_GROQ_PRIMARY_MODEL,
        )
        primary_parsed = _parse_json_response(primary_raw)

        if not primary_parsed:
            raise GroqUnavailableError("Primary extraction returned unparseable output")

        # ── Layer B: Validate ─────────────────────────────────────────────────
        validation = validate_resume_extraction(primary_parsed, resume_text)

        for fv in validation.failed_fields:
            validator_failures.append(f"{fv.field}: {fv.failure_reason[:80]}")

        if validation.has_critical_failure:
            logger.warning(
                f"Resume extraction validation failed on critical fields: "
                f"{[f.field for f in validation.failed_fields if f.is_critical]}"
            )

            # ── Layer C: Escalation ───────────────────────────────────────────
            try:
                corrected, _esc_raw = _escalate_extraction(
                    resume_text, primary_parsed, validation.failed_fields
                )
                if corrected:
                    fields_escalated = list(corrected.keys())
                    primary_parsed = _merge_extractions(primary_parsed, corrected)
                    escalation_model_used = _GROQ_ESCALATION_MODEL
                    method = _METHOD_LLM_ESCALATED
                    logger.info(f"Escalation corrected fields: {fields_escalated}")

            except GroqUnavailableError as e:
                logger.warning(f"Escalation unavailable: {e} — using primary result")

    except GroqUnavailableError as e:
        logger.warning(f"Primary extraction unavailable: {e} — using fallback")
        primary_parsed = None

    # ── Layer D: Fallback (partial or full) ───────────────────────────────────
    if primary_parsed is None:
        # Full fallback — LLM completely unavailable
        method = _METHOD_FALLBACK
        yoe, deg_level, deg_name = _fallback_candidate_facts(
            resume.blocks_by_section, resume_text
        )
        fields_from_fallback = [
            "work_experience_years", "highest_degree",
            "current_role_title", "career_gap_months", "total_companies",
        ]
        confidence_by_field = {f: "not_found" for f in fields_from_fallback}
        latency_ms = int((time.perf_counter() - t_start) * 1000)

        return CandidateFacts(
            work_experience_years=yoe,
            highest_degree_level=deg_level,
            highest_degree_name=deg_name or DEGREE_LEVEL_NAMES.get(deg_level, ""),
            current_role_title="",
            career_gap_months=0,
            total_companies=0,
            extraction_method=_METHOD_FALLBACK,
            provenance=ExtractionProvenance(
                extraction_method=_METHOD_FALLBACK,
                primary_model=_GROQ_PRIMARY_MODEL,
                escalation_model=None,
                fields_escalated=[],
                fields_from_fallback=fields_from_fallback,
                confidence_by_field=confidence_by_field,
                validator_failures=validator_failures,
                latency_ms=latency_ms,
            ),
            raw_llm_output=None,
        )

    # Build CandidateFacts from (potentially escalation-corrected) parsed result
    yoe_val    = _extract_field_value(primary_parsed, "work_experience_years", 0)
    deg_val    = _extract_field_value(primary_parsed, "highest_degree", "none")
    deg_name   = _extract_field_value(primary_parsed, "highest_degree_name", "")
    title_val  = _extract_field_value(primary_parsed, "current_role_title", "")
    gap_val    = _extract_field_value(primary_parsed, "career_gap_months", 0)
    comp_val   = _extract_field_value(primary_parsed, "total_companies", 0)

    # Partial fallback: if critical fields still failed after escalation
    deg_level = DEGREE_LEVELS.get(str(deg_val).lower().strip(), 0)
    if deg_level == 0 and str(deg_val).lower() not in ("none", "not_found", ""):
        # Unknown degree string — fallback for this field only
        fields_from_fallback.append("highest_degree")
        _, deg_level, deg_name_fb = _fallback_candidate_facts(
            resume.blocks_by_section, resume_text
        )
        deg_name = deg_name or deg_name_fb
        if method == _METHOD_LLM_PRIMARY:
            method = _METHOD_PARTIAL

    confidence_by_field = {
        f: _extract_field_confidence(primary_parsed, f)
        for f in [
            "work_experience_years", "highest_degree", "highest_degree_name",
            "current_role_title", "career_gap_months", "total_companies",
        ]
    }

    latency_ms = int((time.perf_counter() - t_start) * 1000)
    logger.info(
        f"Candidate facts extracted via {method} in {latency_ms}ms — "
        f"YOE={yoe_val} degree={deg_val}"
    )

    return CandidateFacts(
        work_experience_years=max(0, int(yoe_val or 0)),
        highest_degree_level=deg_level,
        highest_degree_name=str(deg_name or DEGREE_LEVEL_NAMES.get(deg_level, "")),
        current_role_title=str(title_val or ""),
        career_gap_months=max(0, int(gap_val or 0)),
        total_companies=max(0, int(comp_val or 0)),
        extraction_method=method,
        provenance=ExtractionProvenance(
            extraction_method=method,
            primary_model=_GROQ_PRIMARY_MODEL,
            escalation_model=escalation_model_used,
            fields_escalated=fields_escalated,
            fields_from_fallback=fields_from_fallback,
            confidence_by_field=confidence_by_field,
            validator_failures=validator_failures,
            latency_ms=latency_ms,
        ),
        raw_llm_output=primary_raw,
    )


def extract_jd_requirements(structured_jd) -> JDRequirements:
    """
    Public API. Layer A → B → C → D orchestration for JD requirements extraction.

    Args:
        structured_jd: StructuredJD from jd_structurer.structure_jd()

    Returns:
        JDRequirements with full provenance trail
    """
    t_start = time.perf_counter()
    required_text  = structured_jd.required_text
    full_jd_text   = structured_jd.full_jd_text[:3000]

    fields_escalated: List[str] = []
    fields_from_fallback: List[str] = []
    validator_failures: List[str] = []
    escalation_model_used: Optional[str] = None
    primary_raw: Optional[str] = None
    primary_parsed: Optional[dict] = None
    method = _METHOD_LLM_PRIMARY

    # ── Layer A ───────────────────────────────────────────────────────────────
    try:
        primary_raw = _call_groq(
            system=_JD_EXTRACTION_SYSTEM,
            user=_JD_EXTRACTION_USER.format(
                required_text=required_text,
                full_jd_text=full_jd_text,
            ),
            model=_GROQ_PRIMARY_MODEL,
        )
        primary_parsed = _parse_json_response(primary_raw)

        if not primary_parsed:
            raise GroqUnavailableError("JD extraction returned unparseable output")

        # ── Layer B ───────────────────────────────────────────────────────────
        validation = validate_jd_extraction(primary_parsed, required_text)

        for fv in validation.failed_fields:
            validator_failures.append(f"{fv.field}: {fv.failure_reason[:80]}")

        if validation.has_critical_failure:
            logger.warning(
                f"JD extraction validation failed: "
                f"{[f.field for f in validation.failed_fields if f.is_critical]}"
            )

            # ── Layer C ───────────────────────────────────────────────────────
            try:
                corrected, _esc_raw = _escalate_extraction(
                    required_text + "\n\n" + full_jd_text,
                    primary_parsed,
                    validation.failed_fields,
                )
                if corrected:
                    fields_escalated = list(corrected.keys())
                    primary_parsed = _merge_extractions(primary_parsed, corrected)
                    escalation_model_used = _GROQ_ESCALATION_MODEL
                    method = _METHOD_LLM_ESCALATED
                    logger.info(f"JD escalation corrected: {fields_escalated}")

            except GroqUnavailableError as e:
                logger.warning(f"JD escalation unavailable: {e}")

    except GroqUnavailableError as e:
        logger.warning(f"JD primary extraction unavailable: {e} — fallback")
        primary_parsed = None

    # ── Layer D ───────────────────────────────────────────────────────────────
    if primary_parsed is None:
        method = _METHOD_FALLBACK
        fb_yoe, fb_deg, fb_deg_name = _fallback_jd_requirements(required_text)
        fields_from_fallback = ["min_yoe", "min_degree", "min_degree_name", "degree_is_strict"]
        latency_ms = int((time.perf_counter() - t_start) * 1000)

        return JDRequirements(
            min_yoe=fb_yoe,
            min_degree_level=fb_deg,
            min_degree_name=fb_deg_name,
            degree_is_strict=fb_deg > 0,
            location_requirement="not_specified",
            authorization_requirement="",
            extraction_method=_METHOD_FALLBACK,
            provenance=ExtractionProvenance(
                extraction_method=_METHOD_FALLBACK,
                primary_model=_GROQ_PRIMARY_MODEL,
                escalation_model=None,
                fields_escalated=[],
                fields_from_fallback=fields_from_fallback,
                confidence_by_field={f: "not_found" for f in fields_from_fallback},
                validator_failures=validator_failures,
                latency_ms=latency_ms,
            ),
            raw_llm_output=None,
        )

    # Build JDRequirements from parsed result
    yoe_val      = _extract_field_value(primary_parsed, "min_yoe", None)
    deg_val      = _extract_field_value(primary_parsed, "min_degree", "none")
    deg_name_val = _extract_field_value(primary_parsed, "min_degree_name", "")
    strict_val   = _extract_field_value(primary_parsed, "degree_is_strict", False)
    loc_val      = _extract_field_value(primary_parsed, "location_requirement", "not_specified")
    auth_val     = _extract_field_value(primary_parsed, "authorization_requirement", "")

    min_yoe = int(yoe_val) if yoe_val is not None else None
    deg_level = DEGREE_LEVELS.get(str(deg_val).lower().strip(), 0)

    # Partial fallback for degree if LLM returned unknown value
    if deg_level == 0 and str(deg_val).lower() not in ("none", "not_found", ""):
        fields_from_fallback.append("min_degree")
        _, deg_level, deg_name_fb = _fallback_jd_requirements(required_text)
        deg_name_val = deg_name_val or deg_name_fb
        if method == _METHOD_LLM_PRIMARY:
            method = _METHOD_PARTIAL

    confidence_by_field = {
        f: _extract_field_confidence(primary_parsed, f)
        for f in ["min_yoe", "min_degree", "degree_is_strict",
                  "location_requirement", "authorization_requirement"]
    }

    latency_ms = int((time.perf_counter() - t_start) * 1000)
    logger.info(
        f"JD requirements extracted via {method} in {latency_ms}ms — "
        f"min_yoe={min_yoe} min_degree={deg_val}"
    )

    return JDRequirements(
        min_yoe=min_yoe,
        min_degree_level=deg_level,
        min_degree_name=str(deg_name_val or DEGREE_LEVEL_NAMES.get(deg_level, "Not specified")),
        degree_is_strict=bool(strict_val),
        location_requirement=str(loc_val or "not_specified"),
        authorization_requirement=str(auth_val or ""),
        extraction_method=method,
        provenance=ExtractionProvenance(
            extraction_method=method,
            primary_model=_GROQ_PRIMARY_MODEL,
            escalation_model=escalation_model_used,
            fields_escalated=fields_escalated,
            fields_from_fallback=fields_from_fallback,
            confidence_by_field=confidence_by_field,
            validator_failures=validator_failures,
            latency_ms=latency_ms,
        ),
        raw_llm_output=primary_raw,
    )
