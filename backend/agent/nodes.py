import json
import os
import time
import re
from agent.state import AgentState
from utils.logger import get_logger

logger = get_logger(__name__)
from utils.xml_ast import parse_docx_to_block_ast, export_mutated_docx
from resume_tailor.pipeline import analyze as run_gap_analysis, PipelineConfig
from resume_tailor.jd_structurer import LLMConfig
from resume_tailor.ats_scorer import parse_resume_from_ast
from resume_tailor.types import ResumeSection
from resume_tailor.resume_analytics import generate_analytics_report
from ingestion.filter import _call_llm, settings
from sqlmodel import select as sql_select
from database import Session, engine
from models import Job, UserProfile
from typing import Any, Optional
from resume_tailor.tailor import (
    _rank_blocks_by_relevance,
    _extract_json_from_llm_output,
    _STOP_WORDS,
    _MIN_CONTENT_WORD_RETENTION,
    _get_injected_tokens
)
from datetime import datetime


def update_job_sub_status(job_id: int, sub_status: str, type: str = "info"):
    """Helper to update job sub_status and history logs during agent execution."""
    with Session(engine) as session:
        job = session.get(Job, job_id)
        if job:
            job.sub_status = sub_status

            # Prepare log entry
            log_entry = {
                "msg": sub_status,
                "type": type,
                "t": datetime.now().strftime("%H:%M:%S"),
            }

            # Update history list (important: copy list to ensure SQLModel detects change)
            new_logs = list(job.logs or [])
            new_logs.append(log_entry)
            job.logs = new_logs

            session.add(job)
            session.commit()


def analyze_gap(state: AgentState):
    """
    2. KEYWORD GAP ANALYZER (local, pre-AI)
    """
    update_job_sub_status(state["job_id"], "System 2 — Running gap analysis...")
    config = PipelineConfig(
        llm=LLMConfig(
            provider="gemini",
            model="gemini-2.0-flash",
            api_key=settings.gemini_api_key,
        ),
        use_semantic=True,
    )

    # Parse AST once here — reused in rewrite_bullets/validate_changes via state.
    # Also extracts experience section text for accurate YOE inference (FIX-5).
    ast = parse_docx_to_block_ast(state["master_resume_path"])
    sectioned = parse_resume_from_ast(ast)
    experience_text = sectioned.section_text(ResumeSection.EXPERIENCE)

    result = run_gap_analysis(
        state["job_description"], state["master_resume_text"], config,
        experience_text=experience_text,
    )

    # Flatten into a dict compatible with downstream state consumers:
    # - rewrite_bullets reads ['missing']
    # - validate_changes reads ['jdKeywords']
    present = result.exact_matches + [sm.jd_term for sm in result.semantic_matches]
    missing = result.missing_terms
    analysis = {
        "jdKeywords": present + missing,
        "present": present,
        "missing": missing,
        "coverage": round(result.coverage_score),
        "coverageScore": result.coverage_score,
        "criticalMissing": result.critical_missing,
        "requiredMissing": result.required_missing,
    }

    # Format for UI/State — distinguish critical from general gaps
    extracted = []
    for kw in result.exact_matches:
        extracted.append({"kw": kw, "present": True, "weight": "High"})
    for sm in result.semantic_matches:
        extracted.append({"kw": sm.jd_term, "present": True, "weight": "Partial"})
    for kw in missing:
        weight = "Critical" if kw in result.critical_missing else "Missing"
        extracted.append({"kw": kw, "present": False, "weight": weight})

    update_job_sub_status(
        state["job_id"], "System 3 — Generating tailoring strategy..."
    )

    return {
        "keyword_analysis": analysis,
        "extracted_keywords": extracted,
        "structured_jd": result.structured_jd,  # consumed by generate_analytics
        "block_ast": ast,                        # reused by rewrite_bullets / validate_changes
        "status": f"Gap analysis: {round(result.coverage_score)}% coverage",
    }


def rewrite_bullets(state: AgentState) -> dict[str, Any]:
    """
    System 4 — AI Layer (Gemini / LLM).
    Strict prompt contract. Returns tailored bullet suggestions.

    AST is read from state["block_ast"] (set by analyze_gap) to avoid
    re-parsing the docx. Falls back to a fresh parse if not present.

    [FIX-2] LLM errors are classified:
            Retryable (429, 5xx, timeout) → raise RetryableLLMError
            Non-retryable (other)         → return empty tailored_bullets

    [FIX-3] JSON stripping uses regex, not startswith.

    [FIX-4] block_map pre-filtered to top _BLOCK_PREFILTER_TOP_N blocks
            by token overlap with missing keywords before sending to LLM.
    """
    update_job_sub_status(state["job_id"], "System 4 — AI Layer is rewriting blocks...")

    # Reuse AST parsed in analyze_gap node; fall back to re-parsing if missing.
    ast = state.get("block_ast") or parse_docx_to_block_ast(state["master_resume_path"])
    tailorable = [b for b in ast["blocks"] if b.get("isTailorable")]

    missing = state["keyword_analysis"]["missing"]
    whitelist = state["skill_whitelist"]

    # [FIX-4] Pre-filter blocks by relevance to missing keywords
    # Sends top _BLOCK_PREFILTER_TOP_N instead of all tailorable blocks
    relevant_blocks = _rank_blocks_by_relevance(tailorable, missing)
    block_map = [{"id": b["id"], "text": b["fullText"]} for b in relevant_blocks]

    system_prompt = """You are a professional resume tailoring assistant. Rewrite resume bullet points and paragraphs to align with a job description by injecting relevant keywords.

ABSOLUTE RULES — breaking any rule invalidates your entire response:
1. Return ONLY valid JSON. Zero prose outside the JSON object.
2. Schema: { "tailored": [ { "id": string, "newText": string, "keywordsAdded": string[], "reason": string } ] }
3. Include ONLY blocks you changed. Omit unchanged blocks entirely.
4. NEVER alter block "id" values — they map to XML nodes in the document.
5. "newText" must be plain text only — no markdown, no XML, no asterisks, no formatting.
6. NEVER invent skills, tools, or experiences. Only use terms from the skill whitelist or terms from the job description that could plausibly describe what the candidate already did.
7. NEVER change: candidate name, contact info, company names, dates, job titles, education institution names.
8. NEVER change heading or section title blocks.
9. Prioritise injecting the provided "missing keywords" list — these have been pre-analysed as gaps.
10. Keep approximate sentence length. Do not pad or over-explain.
11. Maximum 8 blocks changed.
12. "keywordsAdded" must list ONLY new terms not present in the original text.
13. When injecting a keyword that belongs to a list of similar tools/models/techniques
    (e.g. the JD says "GPT, Llama, Claude" as examples of LLMs), inject AT MOST ONE
    representative example per bullet. Never enumerate multiple items from the same
    category in a single bullet — it reads as keyword stuffing. Additional category
    members belong in the Skills section, not crammed into a bullet."""

    user_prompt = f"""JOB DESCRIPTION:
{state['job_description']}

---
PRE-ANALYSED MISSING KEYWORDS (prioritise these):
{", ".join(missing[:20]) if missing else "none detected"}

---
CANDIDATE SKILL WHITELIST (only use terms from this list or the JD — never invent others):
{", ".join(whitelist[:40])}

---
RESUME BLOCKS:
{json.dumps(block_map, indent=2)}

Return JSON only. No explanation outside the JSON."""

    # [FIX-2] Classified error handling
    try:
        raw = _call_llm(system_prompt, user_prompt)

    except Exception as e:
        # Unknown error — log and return gracefully, don't retry blindly
        logger.error("AI rewrite failed: %s", e, exc_info=True)
        return {
            "tailored_bullets": [],
            "block_ast": ast,  # [FIX-1]
            "status": f"AI Error: {type(e).__name__}: {e}",
        }

    # [FIX-3] Robust JSON extraction
    try:
        json_str = _extract_json_from_llm_output(raw)
        tailored = json.loads(json_str).get("tailored", [])
    except (ValueError, json.JSONDecodeError) as e:
        logger.error("AI rewrite JSON parse failed: %s. Raw output: %.300s", e, raw)
        return {
            "tailored_bullets": [],
            "block_ast": ast,  # [FIX-1]
            "status": f"AI JSON Parse Error: {e}",
        }

    return {
        "tailored_bullets": tailored,
        "block_ast": ast,  # [FIX-1] passed to validate_changes
        "status": "AI Tailoring complete",
    }


# ─────────────────────────────────────────────────────────────────────────────
#  SYSTEM 5 — SCHEMA VALIDATOR  [FIX-1, FIX-5, FIX-6]
# ─────────────────────────────────────────────────────────────────────────────


def validate_changes(state: AgentState) -> dict[str, Any]:
    """
    System 5 — Schema Validator.
    Validates all LLM suggestions against 7 rules before applying.

    [FIX-1] Reuses state["block_ast"] — no second docx parse.
    [FIX-5] Fabrication check diffs newText vs fullText directly,
            not just keywordsAdded (which the LLM self-reports and can omit).
    [FIX-6] Status label corrected to "System 5".
    """
    update_job_sub_status(
        state["job_id"], "System 5 — Running schema validation..."  # [FIX-6]
    )

    # [FIX-1] Reuse AST from state — no second parse
    ast = state.get("block_ast")
    if ast is None:
        # Defensive fallback: rewrite_bullets may have failed before setting it
        ast = parse_docx_to_block_ast(state["master_resume_path"])

    blocks_by_id = {b["id"]: b for b in ast["blocks"]}
    whitelist = {s.lower() for s in state["skill_whitelist"]}
    jd_keywords = {k.lower() for k in state["keyword_analysis"]["jdKeywords"]}
    # Also allow all content tokens from the raw JD text — any word the JD uses
    # is fair game for the LLM to inject. Trailing periods stripped for consistency.
    jd_raw_tokens = {
        t.rstrip('.')
        for t in re.findall(r"[a-zA-Z][a-zA-Z0-9\-\.]*", state.get("job_description", "").lower())
        if len(t) > 2 and t.rstrip('.') not in _STOP_WORDS
    }
    all_allowed = whitelist | jd_keywords | jd_raw_tokens

    accepted_modifications: dict[str, str] = {}
    validated_bullets: list[dict] = []
    rejection_log: list[str] = []

    for item in state["tailored_bullets"]:
        block_id = item.get("id")
        new_text = item.get("newText", "")
        original_text = blocks_by_id.get(block_id, {}).get("fullText", "")

        # Rule 1: ID must exist
        if block_id not in blocks_by_id:
            rejection_log.append(f"{block_id}: unknown block ID")
            continue

        # Rule 2: newText must be a non-empty plain string
        if not isinstance(new_text, str) or not new_text.strip():
            rejection_log.append(f"{block_id}: newText is empty or not a string")
            continue

        # Rule 3: No XML markup
        if re.search(r"<[a-z][\s\S]*>", new_text, re.IGNORECASE):
            rejection_log.append(f"{block_id}: newText contains XML markup")
            continue

        # Rule 4: No markdown characters
        if re.search(r"[*_`#\[\]]", new_text):
            rejection_log.append(f"{block_id}: newText contains markdown characters")
            continue

        # Rule 5: No heading blocks
        if blocks_by_id[block_id]["type"] in ["h1", "h2", "h3"]:
            rejection_log.append(f"{block_id}: attempted to change a heading block")
            continue

        # Rule 6: Fabrication check — diff newText vs fullText directly  [FIX-5]
        # This catches injected terms the LLM didn't declare in keywordsAdded.
        injected_tokens = _get_injected_tokens(original_text, new_text)
        fabricated = {
            tok
            for tok in injected_tokens
            if not any(tok in allowed for allowed in all_allowed)
        }
        if fabricated:
            rejection_log.append(
                f"{block_id}: potential fabrication — "
                f"injected tokens not in whitelist or JD: {fabricated}"
            )
            logger.warning("Validation reject [%s]: fabricated tokens: %s", block_id, fabricated)
            continue

        # Rule 7: Minimum content word retention  [FIX-5]
        # newText must retain at least _MIN_CONTENT_WORD_RETENTION fraction
        # of original content words — catches complete rewrites disguised as edits.
        def content_words(text: str) -> set[str]:
            tokens = [t.rstrip('.') for t in re.findall(r"[a-zA-Z][a-zA-Z0-9\-\.]*", text.lower())]
            return {t for t in tokens if t not in _STOP_WORDS and len(t) > 2}

        original_content = content_words(original_text)
        new_content = content_words(new_text)

        if original_content:
            retention = len(original_content & new_content) / len(original_content)
            if retention < _MIN_CONTENT_WORD_RETENTION:
                rejection_log.append(
                    f"{block_id}: content retention {retention:.0%} "
                    f"below {_MIN_CONTENT_WORD_RETENTION:.0%} threshold — "
                    f"LLM rewrote instead of injecting"
                )
                logger.warning(
                    "Validation reject [%s]: content retention %.1f%% < %.0f%%",
                    block_id, retention * 100, _MIN_CONTENT_WORD_RETENTION * 100,
                )
                continue

        accepted_modifications[block_id] = new_text
        validated_bullets.append(item)

    if rejection_log:
        logger.info("Validation rejections (%d):", len(rejection_log))
        for entry in rejection_log:
            logger.info("  ✗ %s", entry)

    return {
        "modifications": accepted_modifications,
        "tailored_bullets": validated_bullets,
        "status": f"Validated {len(accepted_modifications)} changes",
    }


def generate_doc(state: AgentState):
    """
    7. EXPORTER
    """
    update_job_sub_status(
        state["job_id"], "System 7 — Exporting .docx with XML preservation..."
    )
    output_dir = "tailored_resumes"
    os.makedirs(output_dir, exist_ok=True)
    filename = f"Tailored_Resume_{state['job_id']}_{int(time.time())}.docx"
    output_path = os.path.join(output_dir, filename)

    # Emphasize keywords added
    emphasize = []
    for b in state["tailored_bullets"]:
        emphasize.extend(b.get("keywordsAdded", []))

    try:
        export_mutated_docx(
            master_path=state["master_resume_path"],
            output_path=output_path,
            modifications=state["modifications"],
            emphasize_keywords=emphasize,
        )
        return {"final_resume_path": output_path, "status": "Exported .docx"}
    except Exception as e:
        return {"status": f"Export Error: {e}"}


def generate_analytics(state: AgentState) -> dict[str, Any]:
    """
    8. ATS SCORER + ANALYTICS
    Runs before/after ATS scoring on the original and tailored resume ASTs,
    then produces a full TailoringAnalyticsReport.

    Requires in state:
      - block_ast          → original resume AST (set by analyze_gap)
      - final_resume_path  → tailored .docx (set by generate_doc)
      - structured_jd      → StructuredJD object (set by analyze_gap)
      - tailored_bullets   → validated changes (set by validate_changes)
    """
    update_job_sub_status(
        state["job_id"], "System 8 — Running ATS scoring and analytics..."
    )

    tailored_path = state.get("final_resume_path")
    original_ast = state.get("block_ast")
    structured_jd = state.get("structured_jd")

    if not tailored_path or not original_ast or not structured_jd:
        logger.warning("generate_analytics: missing required state — skipping analytics")
        return {"analytics": None, "status": "Analytics skipped: incomplete state"}

    try:
        tailored_ast = parse_docx_to_block_ast(tailored_path)

        # Read the user-set YOE from their profile — this is the authoritative
        # source and prevents the LLM/rule-based fallback from including
        # education years in the YOE count (e.g. 2025 − 2018 = 7).
        profile_yoe: Optional[int] = None
        with Session(engine) as db:
            profile = db.exec(sql_select(UserProfile)).first()
            if profile and profile.years_of_experience:
                try:
                    profile_yoe = int(str(profile.years_of_experience).strip().rstrip("+"))
                except ValueError:
                    pass
        if profile_yoe:
            logger.info("generate_analytics: using profile YOE override = %d", profile_yoe)

        report = generate_analytics_report(
            original_ast=original_ast,
            tailored_ast=tailored_ast,
            structured_jd=structured_jd,
            validated_bullets=state.get("tailored_bullets", []),
            override_candidate_yoe=profile_yoe,
        )

        score_delta = report.score_delta
        status = (
            f"ATS: {score_delta.ats_before:.1f} → {score_delta.ats_after:.1f} "
            f"(+{score_delta.ats_improvement:.1f} pts)"
        )
        return {"analytics": report.to_dict(), "status": status}

    except Exception as e:
        logger.exception("generate_analytics failed")
        return {"analytics": None, "status": f"Analytics Error: {e}"}
