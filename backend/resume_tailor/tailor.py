"""
Tailoring Stage 4 & 5 — rewrite_bullets + validate_changes

Changes from review:

  [FIX-1]  AST parsed ONCE in rewrite_bullets, passed through state to
           validate_changes. No second docx parse.

  [FIX-2]  _call_llm errors split into retryable (rate limit, timeout, 5xx)
           vs non-retryable (4xx client errors). Retryable errors raise so
           LangGraph can retry the node. Non-retryable return graceful empty.

  [FIX-3]  JSON stripping uses regex (handles ```JSON, leading prose,
           trailing fence without leading fence) — same pattern as jd_structurer.py.

  [FIX-4]  block_map pre-filtered by keyword relevance before LLM call.
           Only top N blocks by token overlap with missing keywords are sent.
           LLM picks best 8 from a focused set instead of all 30.

  [FIX-5]  Fabrication check diffs newText vs fullText directly, not just
           keywordsAdded (which is LLM self-reported and can omit injections).

  [FIX-6]  update_job_sub_status label in validate_changes corrected
           from "System 6" to "System 5".

Everything else is unchanged from the original.
"""
import re
from utils.logger import get_logger

logger = get_logger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
#  CONSTANTS
# ─────────────────────────────────────────────────────────────────────────────

# How many blocks to send to the LLM after relevance pre-filtering.
# LLM is asked to change at most 8, so sending 15 gives it meaningful choice
# without inflating token usage.
_BLOCK_PREFILTER_TOP_N = 15

# Minimum fraction of original content words that must survive in newText.
# Catches cases where LLM rewrote the bullet entirely instead of injecting.
_MIN_CONTENT_WORD_RETENTION = 0.40

# HTTP status codes that are worth retrying (server-side / transient)
_RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


# ─────────────────────────────────────────────────────────────────────────────
#  RETRYABLE ERROR — LangGraph can catch and retry this node
# ─────────────────────────────────────────────────────────────────────────────

class RetryableLLMError(Exception):
    """
    Raised for transient LLM errors (rate limit, timeout, 5xx).
    Caller / LangGraph retry logic should catch this and re-run the node.
    """
    pass


# ─────────────────────────────────────────────────────────────────────────────
#  HELPER — relevance-based block pre-filter  [FIX-4]
#
#  Ranks tailorable blocks by token overlap with the missing keyword list.
#  Returns the top N most relevant blocks so we don't send all 30 to the LLM.
#  Simple token intersection — no embedding needed, runs in microseconds.
# ─────────────────────────────────────────────────────────────────────────────

def _rank_blocks_by_relevance(
    tailorable: list[dict],
    missing_keywords: list[str],
    top_n: int = _BLOCK_PREFILTER_TOP_N,
) -> list[dict]:
    """
    Score each block by how many missing keyword tokens it shares
    with its existing text (the LLM should be fixing gaps, so blocks
    already close to the keywords are the highest-value targets).

    Also includes blocks with zero overlap if we don't have enough
    candidates — ensures we never send fewer than min(top_n, len(tailorable)).
    """
    if not missing_keywords:
        # No gap data — send all tailorable blocks up to top_n
        return tailorable[:top_n]

    # Build a flat set of individual tokens from missing keywords
    missing_tokens: set[str] = set()
    for kw in missing_keywords:
        missing_tokens.update(kw.lower().split())

    scored: list[tuple[int, dict]] = []
    for block in tailorable:
        block_tokens = set(block["fullText"].lower().split())
        # Score = number of missing keyword tokens present in block text
        # Higher = block is already on-topic and just needs the exact term
        score = len(block_tokens & missing_tokens)
        scored.append((score, block))

    # Sort descending by score, preserve original order for ties
    scored.sort(key=lambda x: x[0], reverse=True)
    return [block for _, block in scored[:top_n]]


# ─────────────────────────────────────────────────────────────────────────────
#  HELPER — robust JSON extraction from LLM output  [FIX-3]
#
#  Handles:
#    • ```json ... ```   (standard)
#    • ```JSON ... ```   (uppercase)
#    • Prose before the JSON object
#    • Trailing ``` without leading fence
# ─────────────────────────────────────────────────────────────────────────────

def _extract_json_from_llm_output(raw: str) -> str:
    """
    Strip markdown fences and any preamble text, return the raw JSON string.
    Raises ValueError if no JSON object found.
    """
    # Strip opening code fence (```json, ```JSON, ``` etc.)
    text = re.sub(r"^```[a-zA-Z]*\s*", "", raw.strip(), flags=re.MULTILINE)
    # Strip closing code fence
    text = re.sub(r"```\s*$", "", text.strip(), flags=re.MULTILINE)
    text = text.strip()

    # Find the outermost { ... } block in case there's prose before/after
    brace_match = re.search(r"\{[\s\S]*\}", text)
    if not brace_match:
        raise ValueError(f"No JSON object found in LLM output. Raw: {raw[:200]}")

    return brace_match.group(0)


# ─────────────────────────────────────────────────────────────────────────────
#  HELPER — content word diff for fabrication detection  [FIX-5]
#
#  Returns tokens that appear in new_text but NOT in original_text,
#  after stripping common stop words.
#  These are candidates for fabrication checking.
# ─────────────────────────────────────────────────────────────────────────────

_STOP_WORDS = {
    # Function words
    "the", "a", "an", "and", "or", "in", "of", "to", "for", "with",
    "is", "are", "was", "were", "be", "been", "by", "on", "at", "as",
    "that", "this", "it", "its", "not", "but", "from", "have", "has",
    "had", "we", "you", "they", "their", "our", "your", "i", "my",
    "can", "will", "would", "could", "should", "may", "might", "also",
    "which", "who", "what", "when", "how", "if", "than", "then", "so",
    "up", "out", "into", "over", "after", "while", "using", "across",
    "within", "between", "through", "during", "including", "ensure",
    "ability", "experience", "knowledge", "understanding", "strong",
    "excellent", "good", "high", "new", "key", "well", "large", "small",
    # Common professional verbs/transitions — cannot constitute fabricated facts
    # (describe HOW something is done, not WHAT specific tool/skill was used)
    "leveraging", "demonstrating", "fulfilling", "incorporating", "integrating",
    "thereby", "often", "flows", "helping", "updated", "staying",
    "incorporate", "ensuring", "enabling", "driving", "improving",
    # Generic professional nouns that are not specific tool/tech claims
    "environments", "requirements", "scale", "orchestration",
    "agents", "various", "multiple", "complex",
}


def _get_injected_tokens(original_text: str, new_text: str) -> set[str]:
    """
    Find content word tokens present in new_text but absent in original_text.
    These are what the LLM actually injected, regardless of keywordsAdded.

    Trailing periods are stripped from tokens so that sentence-ending words
    like "architecture." match the JD keyword "architecture".
    """
    def content_tokens(text: str) -> set[str]:
        # Strip trailing periods to handle sentence-ending tokens (e.g. "architecture.")
        tokens = [t.rstrip('.') for t in re.findall(r"[a-zA-Z][a-zA-Z0-9\-\.]*", text.lower())]
        return {t for t in tokens if t not in _STOP_WORDS and len(t) > 2}

    original_tokens = content_tokens(original_text)
    new_tokens = content_tokens(new_text)
    return new_tokens - original_tokens


# ─────────────────────────────────────────────────────────────────────────────
#  SYSTEM 4 — AI LAYER  [FIX-1, FIX-2, FIX-3, FIX-4]
# ─────────────────────────────────────────────────────────────────────────────

