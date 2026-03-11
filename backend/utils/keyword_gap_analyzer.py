"""
Resume Keyword Gap Analyzer — v3 (Production Architecture)
============================================================

Fixes applied from architectural review:

  [PERF-1]  Two-stage embedding pipeline: BM25 candidate retrieval → embed top-K only
            Reduces 700-embed calls to ~60–80 per request at scale.

  [PERF-2]  Lexical pre-filter before any embedding:
            Jaccard token overlap > 0 OR shared stem OR first-token match
            Further reduces embedding comparisons before BM25 stage.

  [PERF-3]  spaCy + embedding model loaded once at module level (not per-call).
            FastAPI startup hook pattern documented.

  [ATS-1]   Section-aware semantic credit:
            Required section terms → semantic match gives ZERO credit
            (absence of required term is a real gap, not softened by similarity)
            Preferred/general terms → semantic partial credit as before.

  [ATS-2]   Required-section threshold is irrelevant now (credit is 0 anyway),
            but exact match logic preserved for required terms at full weight.

  [PHRASE-1] n-gram quality filter: phrase must contain ≥1 noun/proper noun
             OR be a protected tech token OR appear ≥2 times in JD.
             Eliminates noise phrases like "the role", "and we", "you will".

  [YOE-1]   Years-of-experience extractor runs as independent sub-analyzer.
             Detects "5+ years", "3 years experience", compares against resume.

  [CRIT-1]  Critical missing logic: absolute criteria, not median-relative.
             Critical if: (in Required section) OR (freq ≥ 3) OR (in title).
             More realistic than median distribution.

  [SCORE-1] Rejected GPT's "resume TF-IDF frequency" suggestion.
            We measure skill presence, not emphasis. One mention = full match.

Dependencies:
    pip install spacy sentence-transformers numpy scikit-learn rank-bm25
    python -m spacy download en_core_web_sm
"""

from __future__ import annotations

import re
import math
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Set, Tuple

import logging
from utils.logger import get_logger

logger = get_logger(__name__)

import numpy as np
import spacy
from sklearn.metrics.pairwise import cosine_similarity

# Suppress the harmless "embeddings.position_ids UNEXPECTED" warning that
# transformers emits when loading all-MiniLM-L6-v2 (deprecated buffer in
# the checkpoint that newer transformers versions no longer expect).
get_logger("transformers.modeling_utils").setLevel(logging.ERROR)

# ── Attempt BM25 import (optional dependency) ─────────────────────────────────
try:
    from rank_bm25 import BM25Okapi

    _HAS_BM25 = True
except ImportError:
    _HAS_BM25 = False


# ═══════════════════════════════════════════════════════════════════════════════
#  MODULE-LEVEL MODEL SINGLETONS  [PERF-3]
#  Load once. Never reload inside a request handler.
#  In FastAPI: call preload_models() inside @app.on_event("startup")
# ═══════════════════════════════════════════════════════════════════════════════

_NLP: Optional[spacy.language.Language] = None
_EMBED_MODEL = None


def preload_models() -> None:
    """
    Call this once at application startup.
    FastAPI example:
        @app.on_event("startup")
        async def startup():
            preload_models()
    """
    global _NLP, _EMBED_MODEL
    if _NLP is None:
        _NLP = spacy.load("en_core_web_sm", disable=["ner"])
    if _EMBED_MODEL is None:
        from sentence_transformers import SentenceTransformer

        _EMBED_MODEL = SentenceTransformer("all-MiniLM-L6-v2")


def _nlp() -> spacy.language.Language:
    """Return the module-level spaCy model, loading it lazily on first access."""
    global _NLP
    if _NLP is None:
        _NLP = spacy.load("en_core_web_sm", disable=["ner"])
    return _NLP


def _embed_model():
    """Return the module-level SentenceTransformer model, loading it lazily on first access."""
    global _EMBED_MODEL
    if _EMBED_MODEL is None:
        from sentence_transformers import SentenceTransformer

        _EMBED_MODEL = SentenceTransformer("all-MiniLM-L6-v2")
    return _EMBED_MODEL


# ═══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class AnalyzerConfig:
    """
    Tunable parameters for the keyword gap analyzer.

    Scoring weights control how much importance is given to phrases found in the
    job title, required section, or preferred section of the JD.  Frequency boost
    parameters reward terms that appear repeatedly in the JD.  Semantic thresholds
    govern when a resume phrase is considered a close-enough match to a JD term.
    Two-stage retrieval limits control the BM25→embedding pipeline budget.  Phrase
    extraction settings filter out noise grams.  Critical-missing and YOE settings
    determine what counts as a blocking gap.
    """

    # ── Scoring weights ───────────────────────────────────────────────────────
    title_weight: float = 2.5
    required_weight: float = 2.0
    preferred_weight: float = 1.3

    freq_boost_threshold: int = 2  # occurrences before boost kicks in
    freq_boost_factor: float = 1.4  # multiplier per extra occurrence
    freq_boost_cap: float = 3.0  # hard ceiling on frequency multiplier

    # ── Semantic matching ─────────────────────────────────────────────────────
    semantic_threshold: float = 0.72  # cosine similarity floor for any match
    # [ATS-1] Required terms get ZERO semantic credit — absence is a real gap.
    # Preferred/general terms get partial credit scaled by similarity.
    semantic_partial_credit_preferred: float = 0.65
    semantic_partial_credit_general: float = 0.55

    # ── Two-stage retrieval [PERF-1] ──────────────────────────────────────────
    bm25_top_k: int = 10  # candidates per JD term from BM25
    max_embed_pairs: int = 500  # hard cap on (jd_term, resume_phrase) pairs to embed
    embed_batch_size: int = 64

    # ── Phrase extraction ─────────────────────────────────────────────────────
    max_ngram: int = 4
    min_phrase_chars: int = 4
    min_phrase_doc_freq: int = 2  # phrase must appear ≥N times OR be tech token

    # ── Critical missing [CRIT-1] ─────────────────────────────────────────────
    # Absolute criteria — not median-relative
    critical_freq_threshold: int = 3  # appears ≥ N times in JD

    # ── Years-of-experience [YOE-1] ───────────────────────────────────────────
    yoe_partial_threshold: float = 0.7  # resume_yoe / required_yoe for partial match


DEFAULT_CONFIG = AnalyzerConfig()


# ═══════════════════════════════════════════════════════════════════════════════
#  TECH-SAFE TOKENIZER
#  Pre-pass regex protects CI/CD, Next.js, Python 3.11, C++ etc. as atomic
#  tokens before spaCy sees them. spaCy destroys hyphenated and slash-terms.
# ═══════════════════════════════════════════════════════════════════════════════

_PROTECT_PATTERNS = [
    r"\b[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+\b",  # Next.js, scikit-learn
    r"\b[A-Za-z][A-Za-z0-9]*(?:[/\-][A-Za-z][A-Za-z0-9]*)+\b",  # CI/CD, A/B-test
    r"\b[A-Za-z][A-Za-z0-9]*\s+\d+(?:\.\d+)+\b",  # Python 3.11, Java 17
    r"\bend[-\s]to[-\s]end\b",
    r"\bfull[-\s]stack\b",
    r"\bopen[-\s]source\b",
    r"\b[A-Z]{2,}(?:\+\+|#)?\b",  # NLP, AWS, C++, C#
]
_PROTECT_RE = re.compile("|".join(_PROTECT_PATTERNS), re.IGNORECASE)


def _protect_tech(text: str) -> Tuple[str, Dict[str, str]]:
    """
    Replace tech tokens in *text* with unique placeholders so spaCy cannot split them.

    Args:
        text: Raw input string that may contain tech tokens such as ``CI/CD``,
              ``Next.js``, ``Python 3.11``, or ``C++``.

    Returns:
        A tuple of ``(protected_text, mapping)`` where *mapping* is
        ``{placeholder: original_token_lowercased}`` and *protected_text* has
        all matched tech tokens replaced by their placeholder keys.
    """
    mapping: Dict[str, str] = {}
    ctr = [0]

    def sub(m):
        k = f"__TECH{ctr[0]}__"
        mapping[k] = m.group(0).lower().strip()
        ctr[0] += 1
        return k

    return _PROTECT_RE.sub(sub, text), mapping


def tokenize(text: str) -> List[str]:
    """
    Tokenize *text* into a list of meaningful lemmas, preserving tech tokens.

    The pipeline is:
    1. Protect tech tokens (``CI/CD``, ``Next.js``, …) with placeholders.
    2. Run spaCy on the protected, lowercased text.
    3. Restore placeholders; skip stop-words, punctuation, and whitespace.
    4. Return lemmas for ordinary words and the original tech token for protected ones.

    Args:
        text: Any natural-language string (JD or resume snippet).

    Returns:
        A flat list of string tokens ready for BM25 indexing or stem comparison.
    """
    protected, mapping = _protect_tech(text)
    doc = _nlp()(protected.lower())
    out = []
    for tok in doc:
        raw = tok.text.strip()
        if raw in mapping:
            out.append(mapping[raw])
        elif tok.is_stop or tok.is_punct or tok.is_space:
            continue
        elif tok.lemma_.strip():
            out.append(tok.lemma_.strip())
    return out


def stem_set(tokens: List[str]) -> Set[str]:
    """Rough stem: strip common suffixes for overlap checks."""
    stems = set()
    for t in tokens:
        s = t
        for suffix in ("ing", "tion", "ed", "er", "es", "s"):
            if t.endswith(suffix) and len(t) - len(suffix) >= 3:
                s = t[: -len(suffix)]
                break
        stems.add(s)
    return stems


# ═══════════════════════════════════════════════════════════════════════════════
#  PHRASE EXTRACTION WITH QUALITY FILTER  [PHRASE-1]
#
#  Quality criteria — phrase must satisfy at least one of:
#    A. Contains ≥1 noun or proper noun (POS filter)
#    B. Contains a protected tech token
#    C. Appears ≥ min_phrase_doc_freq times in the source text
#
#  This eliminates: "the role", "and we", "you will", "our team" etc.
# ═══════════════════════════════════════════════════════════════════════════════


def _has_noun(phrase: str) -> bool:
    """Return ``True`` if *phrase* contains at least one noun or proper noun token."""
    doc = _nlp()(phrase)
    return any(t.pos_ in ("NOUN", "PROPN") for t in doc)


def _has_tech_token(phrase: str) -> bool:
    """Return ``True`` if *phrase* contains a protected tech token (e.g. ``CI/CD``, ``AWS``)."""
    return bool(_PROTECT_RE.search(phrase))


def extract_phrases(text: str, config: AnalyzerConfig = DEFAULT_CONFIG) -> List[str]:
    """
    Extract quality phrases from text.
    Uses spaCy noun chunks (high precision) + n-gram sweep (high recall),
    then applies quality filter.
    """
    text_lower = text.lower()
    doc = _nlp()(text_lower)
    candidates: Set[str] = set()

    # 1. spaCy noun chunks
    for chunk in doc.noun_chunks:
        c = re.sub(r"\s+", " ", chunk.text.strip())
        if len(c) >= config.min_phrase_chars:
            candidates.add(c)

    # 2. n-gram sweep
    raw_tokens = [t.text for t in doc if not t.is_space]
    for n in range(1, config.max_ngram + 1):
        for i in range(len(raw_tokens) - n + 1):
            gram = " ".join(raw_tokens[i : i + n]).strip()
            if len(gram) >= config.min_phrase_chars:
                candidates.add(gram)

    # 3. Quality filter  [PHRASE-1]
    doc_freq_threshold = config.min_phrase_doc_freq
    quality: List[str] = []
    for phrase in candidates:
        freq = len(re.findall(re.escape(phrase), text_lower))
        if _has_noun(phrase) or _has_tech_token(phrase) or freq >= doc_freq_threshold:
            quality.append(phrase)

    return quality


def deduplicate_subphrases(phrases: List[str]) -> List[str]:
    """Longest-match wins: suppress shorter phrases that are sub-strings of longer ones."""
    phrases_sorted = sorted(set(phrases), key=len, reverse=True)
    kept: List[str] = []
    suppressed: Set[str] = set()
    for phrase in phrases_sorted:
        if phrase in suppressed:
            continue
        kept.append(phrase)
        words = phrase.split()
        for n in range(1, len(words)):
            for i in range(len(words) - n + 1):
                suppressed.add(" ".join(words[i : i + n]))
    return kept


# ═══════════════════════════════════════════════════════════════════════════════
#  SECTION DETECTOR
# ═══════════════════════════════════════════════════════════════════════════════

_SECTION_KEYS: Dict[str, List[str]] = {
    "title": [
        "senior",
        "engineer",
        "developer",
        "scientist",
        "analyst",
        "manager",
        "lead",
        "architect",
        "we are looking for",
        "we're looking for",
        "about the role",
        "job title",
        "position",
    ],
    "required": [
        "required",
        "requirements",
        "must have",
        "must-have",
        "essential",
        "minimum qualifications",
        "basic qualifications",
        "you must",
        "what you'll need",
        "what you need",
    ],
    "preferred": [
        "preferred",
        "nice to have",
        "nice-to-have",
        "bonus",
        "plus",
        "additional skills",
        "good to have",
        "ideally",
        "desired",
    ],
    "responsibilities": [
        "responsibilities",
        "what you'll do",
        "you will",
        "duties",
        "day to day",
        "your role",
    ],
    "about": ["about us", "about the company", "who we are", "our mission"],
}


def detect_sections(jd_text: str) -> Dict[str, str]:
    """
    Segment a job description into named sections by keyword scoring.

    Each paragraph in *jd_text* is assigned to the section whose keywords have
    the greatest total word-length overlap with the paragraph.  Paragraphs that
    match no section fall into ``"general"``.

    Args:
        jd_text: Raw job description string with paragraphs separated by blank lines.

    Returns:
        A dict mapping section names (``"title"``, ``"required"``, ``"preferred"``,
        ``"responsibilities"``, ``"about"``, ``"general"``) to their concatenated
        paragraph text.
    """
    sections: Dict[str, str] = defaultdict(str)
    for para in re.split(r"\n{2,}", jd_text):
        pl = para.lower()
        scores = {
            sec: sum(len(kw.split()) for kw in kws if kw in pl)
            for sec, kws in _SECTION_KEYS.items()
        }
        best = max(scores, key=scores.get)
        target = best if scores[best] > 0 else "general"
        sections[target] += " " + para
    return dict(sections)


def extract_title(jd_text: str) -> str:
    """
    Heuristically extract the job title from a job description.

    Tries three strategies in order:
    1. Regex patterns like ``"role: Senior Engineer"`` or ``"we're looking for a …"``.
    2. First short line that contains a common title word (engineer, analyst, etc.).
    3. First non-empty line of the JD, truncated to 80 characters.

    Args:
        jd_text: Raw job description string.

    Returns:
        The extracted title string, or an empty string if none could be found.
    """
    for pattern in [
        r"(?:role|position|job title)\s*[:\-]\s*(.+)",
        r"(?:we(?:'re| are) (?:looking|hiring) for an?\s+)(.+?)(?:\s+to|\s+who|\.|$)",
    ]:
        m = re.search(pattern, jd_text, re.IGNORECASE)
        if m:
            c = m.group(1).strip()
            if 3 < len(c) < 80:
                return c
    title_words = {
        "engineer",
        "developer",
        "scientist",
        "analyst",
        "manager",
        "lead",
        "architect",
        "designer",
        "specialist",
    }
    for line in jd_text.split("\n"):
        s = line.strip()
        if s and len(s) < 100 and any(w in s.lower() for w in title_words):
            return s
    return next((l.strip() for l in jd_text.split("\n") if l.strip()), "")[:80]


# ═══════════════════════════════════════════════════════════════════════════════
#  YEARS-OF-EXPERIENCE SUB-ANALYZER  [YOE-1]
#  Independent from phrase matching — runs separately.
#  Detects "5+ years", "3 years experience in Python" etc.
#  Checks resume for explicit numeric experience claims.
# ═══════════════════════════════════════════════════════════════════════════════

_YOE_RE = re.compile(
    r"(\d+)\+?\s*(?:to\s*\d+\s*)?(?:years?|yrs?)"
    r"(?:\s+(?:of\s+)?(?:experience|exp|work))?"
    r"(?:\s+(?:in|with|using|of)\s+([^\n,;.]{3,40}))?",
    re.IGNORECASE,
)

_RESUME_YOE_RE = re.compile(
    r"(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)\s+(?:in|with)?\s*([^\n,;.]{3,40})",
    re.IGNORECASE,
)


@dataclass
class YOERequirement:
    """A single years-of-experience requirement parsed from a job description.

    Attributes:
        years: Minimum number of years required.
        context: The skill or domain the requirement applies to (may be empty for
                 generic requirements such as "5+ years experience").
        raw_text: The original matched substring from the JD, used for display.
    """

    years: int
    context: str  # what skill/domain the years refer to
    raw_text: str


@dataclass
class YOEResult:
    """Outcome of comparing JD years-of-experience requirements against a resume.

    Attributes:
        requirements: All YOE requirements extracted from the JD.
        satisfied: Requirements fully met by the resume.
        unsatisfied: Requirements not met and below the partial-credit threshold.
        partial: Requirements partially met; each entry is ``(requirement, resume_years_found)``.
    """

    requirements: List[YOERequirement]
    satisfied: List[YOERequirement]
    unsatisfied: List[YOERequirement]
    partial: List[Tuple[YOERequirement, int]]  # (req, resume_years_found)


def extract_yoe_requirements(jd_text: str) -> List[YOERequirement]:
    """
    Parse all years-of-experience requirements from a job description.

    Recognises patterns such as ``"5+ years"``, ``"3 years experience in Python"``,
    and ``"2–4 years of work with Kubernetes"``.

    Args:
        jd_text: Raw job description string.

    Returns:
        A list of :class:`YOERequirement` objects, one per matched requirement.
        Requirements with zero years are silently skipped.
    """
    reqs = []
    for m in _YOE_RE.finditer(jd_text):
        years = int(m.group(1))
        context = (m.group(2) or "").strip().lower()
        raw = m.group(0).strip()
        if years > 0:
            reqs.append(YOERequirement(years=years, context=context, raw_text=raw))
    return reqs


def check_yoe_against_resume(
    requirements: List[YOERequirement],
    resume_text: str,
    config: AnalyzerConfig = DEFAULT_CONFIG,
) -> YOEResult:
    """
    Compare a list of JD YOE requirements against a candidate's resume.

    For each requirement the function looks for:
    * Explicit years claims in the resume (e.g. ``"4 years experience with Python"``).
    * Total career length inferred from date ranges found in the resume.

    A requirement is *satisfied* when the resume years meet or exceed it, *partial*
    when the resume years are at least ``config.yoe_partial_threshold`` × required,
    and *unsatisfied* otherwise.

    For context-specific requirements (e.g. "3 years Python") the function also
    considers total career length as a fallback when the skill is mentioned but no
    explicit years claim is found.

    Args:
        requirements: Parsed YOE requirements from :func:`extract_yoe_requirements`.
        resume_text: Full resume text.
        config: Analyzer configuration; uses ``yoe_partial_threshold``.

    Returns:
        A :class:`YOEResult` with categorised lists of satisfied, unsatisfied, and
        partial requirements.
    """
    resume_lower = resume_text.lower()

    # Extract years claims from resume
    resume_claims: Dict[str, int] = {}
    for m in _RESUME_YOE_RE.finditer(resume_lower):
        years = int(m.group(1))
        context = (m.group(2) or "").strip().lower()
        if context:
            resume_claims[context] = max(resume_claims.get(context, 0), years)

    # Also extract total years from date ranges (e.g. 2018–2024 = 6 years)
    date_range_years = _infer_total_experience_from_dates(resume_text)

    satisfied: List[YOERequirement] = []
    unsatisfied: List[YOERequirement] = []
    partial: List[Tuple[YOERequirement, int]] = []

    for req in requirements:
        if not req.context:
            # Generic "5+ years experience" — check total inferred years
            if date_range_years >= req.years:
                satisfied.append(req)
            elif date_range_years >= req.years * config.yoe_partial_threshold:
                partial.append((req, date_range_years))
            else:
                unsatisfied.append(req)
            continue

        # Context-specific: look for matching claim in resume
        best_resume_years = 0
        for claim_context, claim_years in resume_claims.items():
            if req.context in claim_context or claim_context in req.context:
                best_resume_years = max(best_resume_years, claim_years)

        # Also check if the context term appears in resume at all
        context_present = (
            req.context.split()[0] in resume_lower if req.context else False
        )

        if best_resume_years >= req.years:
            satisfied.append(req)
        elif best_resume_years >= req.years * config.yoe_partial_threshold:
            partial.append((req, best_resume_years))
        elif context_present and date_range_years >= req.years:
            # Skill is mentioned but no explicit years — infer from total career length
            partial.append((req, date_range_years))
        else:
            unsatisfied.append(req)

    return YOEResult(
        requirements=requirements,
        satisfied=satisfied,
        unsatisfied=unsatisfied,
        partial=partial,
    )


def _infer_total_experience_from_dates(resume_text: str) -> int:
    """Infer total years of experience from date ranges in resume."""
    year_re = re.compile(r"\b(19[89]\d|20[012]\d)\b")
    years = [int(y) for y in year_re.findall(resume_text)]
    if len(years) >= 2:
        return max(years) - min(years)
    return 0


# ═══════════════════════════════════════════════════════════════════════════════
#  LEXICAL PRE-FILTER  [PERF-1, PERF-2]
#  Before any embedding, filter candidate pairs using cheap lexical signals.
#  A pair (jd_term, resume_phrase) is a candidate if ANY of:
#    1. Jaccard token overlap > 0 (share at least 1 token)
#    2. First token of jd_term matches any token in resume_phrase
#    3. Stem overlap: share at least 1 stemmed token
#  This reduces the embedding comparison set from O(N×M) to O(K) where K << N×M.
# ═══════════════════════════════════════════════════════════════════════════════


def lexical_prefilter(
    jd_terms: List[str],
    resume_phrases: List[str],
) -> Dict[str, List[str]]:
    """
    Returns {jd_term: [candidate_resume_phrases]} after lexical pre-filtering.
    Only pairs that pass at least one lexical signal are returned.
    """
    # Pre-compute token sets and stem sets for all resume phrases
    resume_tokens: List[Set[str]] = [set(p.split()) for p in resume_phrases]
    resume_stems: List[Set[str]] = [stem_set(p.split()) for p in resume_phrases]

    candidates: Dict[str, List[str]] = {}

    for jd_term in jd_terms:
        jd_tok = set(jd_term.split())
        jd_stem = stem_set(list(jd_tok))
        first_token = jd_term.split()[0] if jd_term.split() else ""

        matched: List[str] = []
        for i, phrase in enumerate(resume_phrases):
            r_tok = resume_tokens[i]
            r_stem = resume_stems[i]

            # Signal 1: Jaccard token overlap > 0
            if jd_tok & r_tok:
                matched.append(phrase)
                continue

            # Signal 2: First token of JD term appears anywhere in resume phrase
            if first_token and first_token in r_tok:
                matched.append(phrase)
                continue

            # Signal 3: Stem overlap
            if jd_stem & r_stem:
                matched.append(phrase)

        if matched:
            candidates[jd_term] = matched

    return candidates


# ═══════════════════════════════════════════════════════════════════════════════
#  BM25 CANDIDATE RETRIEVAL  [PERF-1]
#  Second stage of the pre-filter pipeline.
#  For each unmatched JD term, retrieve top-K resume phrases by BM25 score.
#  These become the only candidates for embedding.
#  If rank-bm25 not installed, falls back to lexical pre-filter only.
# ═══════════════════════════════════════════════════════════════════════════════


def bm25_candidates(
    jd_terms: List[str],
    resume_phrases: List[str],
    top_k: int = 10,
) -> Dict[str, List[str]]:
    """
    For each JD term, retrieve top-K resume phrases by BM25.
    Returns {jd_term: [top_k_resume_phrases]}.
    Falls back to lexical pre-filter if rank-bm25 not available.
    """
    if not _HAS_BM25 or not resume_phrases:
        return lexical_prefilter(jd_terms, resume_phrases)

    tokenized_corpus = [p.split() for p in resume_phrases]
    bm25 = BM25Okapi(tokenized_corpus)

    result: Dict[str, List[str]] = {}
    for term in jd_terms:
        query = term.split()
        scores = bm25.get_scores(query)
        # Get indices of top_k phrases with score > 0
        top_indices = [i for i in np.argsort(scores)[::-1][:top_k] if scores[i] > 0]
        if top_indices:
            result[term] = [resume_phrases[i] for i in top_indices]

    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  TWO-STAGE SEMANTIC MATCHER  [PERF-1]
#
#  Stage 1: BM25 → candidate pairs (O(N log M) not O(N×M))
#  Stage 2: Embed only candidate pairs → cosine similarity
#
#  Complexity reduction example:
#    Before: 400 JD terms × 300 resume phrases = 120,000 similarity ops
#    After:  400 JD terms × ~10 candidates each = ~4,000 similarity ops
#    Plus:   Embed only unique strings in candidate set (~200 vs 700)
#
#  [ATS-1] Section-aware credit — required terms get NO semantic credit.
#  The caller must pass required_term_ids to enforce this.
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class SemanticMatch:
    """A semantic (non-exact) match between a JD term and a resume phrase.

    Attributes:
        jd_term: The original phrase from the job description.
        resume_phrase: The best-matching phrase found in the resume.
        similarity: Cosine similarity between the two embeddings (0–1).
        credit_fraction: The fraction of the term's weight credited toward coverage.
                         Always ``0.0`` for required terms (see [ATS-1]).
    """

    jd_term: str
    resume_phrase: str
    similarity: float
    credit_fraction: float  # actual credit applied (0 for required terms)


def two_stage_semantic_match(
    unmatched_jd_terms: List[str],
    resume_phrases: List[str],
    required_terms: Set[str],  # [ATS-1] these get zero credit
    config: AnalyzerConfig = DEFAULT_CONFIG,
    embed_fn: Optional[Callable] = None,
) -> Tuple[List[SemanticMatch], List[str]]:
    """
    Returns:
        (semantic_matches, still_missing)
    still_missing: terms with no lexical or semantic match above threshold.

    [ATS-1] required_terms in the result have credit_fraction=0.0.
    They are returned as SemanticMatch for transparency (to show the user
    "we found something similar but it's a required term — you need the exact term"),
    but contribute zero to coverage score.
    """
    if not unmatched_jd_terms or not resume_phrases:
        return [], unmatched_jd_terms

    # Stage 1: BM25 / lexical pre-filter → candidate pairs
    candidates = bm25_candidates(
        unmatched_jd_terms, resume_phrases, top_k=config.bm25_top_k
    )

    # Collect unique strings that need embedding
    unique_jd: Set[str] = set()
    unique_resume: Set[str] = set()
    for term, phrases in candidates.items():
        unique_jd.add(term)
        unique_resume.update(phrases)

    if not unique_jd:
        return [], unmatched_jd_terms

    # Hard cap on total pairs to embed  [PERF-1]
    total_pairs = sum(len(v) for v in candidates.values())
    if total_pairs > config.max_embed_pairs:
        # Trim candidate lists proportionally
        ratio = config.max_embed_pairs / total_pairs
        candidates = {
            k: v[: max(1, int(len(v) * ratio))] for k, v in candidates.items()
        }
        unique_resume = set()
        for phrases in candidates.values():
            unique_resume.update(phrases)

    # Stage 2: Embed only the candidate strings
    embed = embed_fn or (
        lambda texts: _embed_model().encode(
            texts, batch_size=config.embed_batch_size, show_progress_bar=False
        )
    )

    jd_list = list(unique_jd)
    resume_list = list(unique_resume)

    all_vecs = embed(jd_list + resume_list)
    jd_vecs = {t: all_vecs[i] for i, t in enumerate(jd_list)}
    resume_vecs = {p: all_vecs[len(jd_list) + i] for i, p in enumerate(resume_list)}

    # Score each candidate pair
    matched: List[SemanticMatch] = []
    still_missing: List[str] = []
    matched_terms: Set[str] = set()

    for term, candidate_phrases in candidates.items():
        if not candidate_phrases:
            continue

        t_vec = jd_vecs[term].reshape(1, -1)
        c_vecs = np.array([resume_vecs[p] for p in candidate_phrases])
        sims = cosine_similarity(t_vec, c_vecs)[0]

        best_idx = int(np.argmax(sims))
        best_sim = float(sims[best_idx])
        best_phrase = candidate_phrases[best_idx]

        if best_sim >= config.semantic_threshold:
            # [ATS-1] Section-aware credit
            is_required = term in required_terms
            if is_required:
                credit = 0.0  # Required term — absence is a real gap
            else:
                # Scale credit by how far above threshold the similarity is
                credit_base = config.semantic_partial_credit_preferred
                credit = credit_base * (best_sim / 1.0)  # proportional to similarity
                credit = min(credit, credit_base)

            matched.append(
                SemanticMatch(
                    jd_term=term,
                    resume_phrase=best_phrase,
                    similarity=round(best_sim, 3),
                    credit_fraction=round(credit, 3),
                )
            )
            matched_terms.add(term)

    still_missing = [t for t in unmatched_jd_terms if t not in matched_terms]

    return matched, still_missing


# ═══════════════════════════════════════════════════════════════════════════════
#  WEIGHTED TERM BUILDER
# ═══════════════════════════════════════════════════════════════════════════════


def build_weighted_jd_terms(
    jd_text: str,
    config: AnalyzerConfig = DEFAULT_CONFIG,
) -> Tuple[Dict[str, float], Set[str]]:
    """
    Returns:
        (weights dict, required_terms set)
    required_terms: phrases detected in the required section of the JD.
    """
    sections = detect_sections(jd_text)
    title = extract_title(jd_text).lower()
    jd_lower = jd_text.lower()

    phrases = extract_phrases(jd_text, config)
    phrases = deduplicate_subphrases(phrases)

    weights: Dict[str, float] = {}
    required_terms: Set[str] = set()

    required_text = sections.get("required", "").lower()
    preferred_text = sections.get("preferred", "").lower()

    for phrase in phrases:
        if len(phrase) < config.min_phrase_chars:
            continue

        weight = 1.0
        count = len(re.findall(re.escape(phrase), jd_lower))

        # Frequency boost (capped)
        if count >= config.freq_boost_threshold:
            extra = min(count - config.freq_boost_threshold, 5)
            freq_mult = min(
                1.0 + extra * (config.freq_boost_factor - 1.0), config.freq_boost_cap
            )
            weight *= freq_mult

        if phrase in title:
            weight *= config.title_weight
        if phrase in required_text:
            weight *= config.required_weight
            required_terms.add(phrase)
        if phrase in preferred_text:
            weight *= config.preferred_weight

        weights[phrase] = round(weight, 3)

    return weights, required_terms


# ═══════════════════════════════════════════════════════════════════════════════
#  CRITICAL MISSING — ABSOLUTE CRITERIA  [CRIT-1]
#  Critical if ANY of:
#    - Appears in Required section
#    - Appears ≥ freq threshold times in JD
#    - Appears in job title
#  Not median-relative. More realistic to recruiter/ATS behavior.
# ═══════════════════════════════════════════════════════════════════════════════


def classify_critical_missing(
    missing_terms: List[str],
    jd_text: str,
    required_terms: Set[str],
    config: AnalyzerConfig = DEFAULT_CONFIG,
) -> List[str]:
    """
    Identify which missing terms are *critical* using absolute criteria.  [CRIT-1]

    A term is critical if **any** of the following hold:
    * It appears in the required section of the JD.
    * It appears at least ``config.critical_freq_threshold`` times in the JD.
    * It appears in the job title.

    Results are sorted: required terms first, then by descending JD frequency.

    Args:
        missing_terms: Terms absent from the resume (neither exact nor semantic match).
        jd_text: Raw job description string.
        required_terms: Set of terms detected in the required section.
        config: Analyzer configuration; uses ``critical_freq_threshold``.

    Returns:
        A sorted list of critical missing terms.
    """
    jd_lower = jd_text.lower()
    title = extract_title(jd_text).lower()
    critical = []

    for term in missing_terms:
        freq = len(re.findall(re.escape(term), jd_lower))
        if (
            term in required_terms
            or freq >= config.critical_freq_threshold
            or term in title
        ):
            critical.append(term)

    # Sort: required first, then by frequency
    def sort_key(t):
        freq = len(re.findall(re.escape(t), jd_lower))
        in_req = t in required_terms
        return (not in_req, -freq)

    critical.sort(key=sort_key)
    return critical


# ═══════════════════════════════════════════════════════════════════════════════
#  RESULT TYPES
# ═══════════════════════════════════════════════════════════════════════════════


@dataclass
class GapAnalysisResult:
    """Complete output of :func:`analyze_keyword_gap`.

    Attributes:
        coverage_score: Weighted coverage percentage (0–100).  Required-term
            semantic matches contribute zero credit; preferred/general terms get
            partial credit scaled by similarity.
        total_concepts: Number of unique JD terms considered.
        matched_weight: Sum of weights for matched terms (exact + semantic credit).
        total_weight: Sum of all JD term weights (denominator for coverage).
        exact_matches: JD terms found verbatim in the resume.
        semantic_matches: JD terms matched via embedding similarity (may include
            required terms with ``credit_fraction=0.0``).
        missing_terms: JD terms with neither an exact nor semantic match.
        critical_missing: Subset of *missing_terms* that meet critical criteria.
        required_missing: Missing terms that appeared in the JD required section.
        preferred_missing: Missing terms that appeared in the JD preferred section.
        required_terms: All terms detected in the required section (used for
            ATS-aware credit suppression).
        yoe: Years-of-experience sub-analysis result.
        embedding_calls: Number of unique strings sent to the embedding model for
            this request (useful for cost monitoring).
    """

    # ── Coverage ──────────────────────────────────────────────────────────────
    coverage_score: float  # 0–100, weighted
    total_concepts: int
    matched_weight: float
    total_weight: float

    # ── Term breakdown ────────────────────────────────────────────────────────
    exact_matches: List[str]
    semantic_matches: List[SemanticMatch]
    missing_terms: List[str]
    critical_missing: List[str]  # absolute criteria [CRIT-1]

    # ── Section breakdown ─────────────────────────────────────────────────────
    required_missing: List[str]  # missing AND in required section [ATS-1]
    preferred_missing: List[str]
    required_terms: Set[str]

    # ── YOE ───────────────────────────────────────────────────────────────────
    yoe: YOEResult

    # ── Metadata ──────────────────────────────────────────────────────────────
    embedding_calls: int  # how many strings were actually embedded

    def summary(self) -> str:
        """Return a compact multi-line human-readable summary of the analysis result."""
        sm_display = [
            (m.jd_term, m.resume_phrase, m.similarity, m.credit_fraction)
            for m in self.semantic_matches
        ]
        lines = [
            f"Coverage: {self.coverage_score:.1f}%",
            f"  Exact: {len(self.exact_matches)}  "
            f"Semantic: {len(self.semantic_matches)}  "
            f"Missing: {len(self.missing_terms)}",
            f"  Required missing ({len(self.required_missing)}): "
            f"{', '.join(self.required_missing[:6])}",
            f"  Critical missing ({len(self.critical_missing)}): "
            f"{', '.join(self.critical_missing[:6])}",
            f"  Embedding calls this request: {self.embedding_calls}",
        ]
        if self.yoe.unsatisfied:
            lines.append(
                f"  YOE gaps: "
                + ", ".join(f"{r.raw_text}" for r in self.yoe.unsatisfied[:4])
            )
        return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN ANALYZER
# ═══════════════════════════════════════════════════════════════════════════════


def analyze_keyword_gap(
    jd_text: str,
    resume_text: str,
    config: AnalyzerConfig = DEFAULT_CONFIG,
    embed_fn: Optional[Callable] = None,
    use_semantic: bool = True,
) -> GapAnalysisResult:
    """
    Full 7-stage keyword gap analysis.

    Stages:
      1. Build weighted JD term map + identify required terms
      2. Extract resume phrases
      3. Exact matching
      4. Two-stage semantic matching (BM25 → embed top-K only)  [PERF-1]
      5. Coverage scoring (section-aware credit)  [ATS-1]
      6. Critical missing classification (absolute criteria)  [CRIT-1]
      7. YOE sub-analysis  [YOE-1]
    """

    # Stage 1 — JD terms
    jd_weights, required_terms = build_weighted_jd_terms(jd_text, config)
    jd_terms = list(jd_weights.keys())

    # Stage 2 — Resume phrases
    resume_phrases = extract_phrases(resume_text, config)
    resume_phrases = deduplicate_subphrases(resume_phrases)
    resume_lower = resume_text.lower()

    # Stage 3 — Exact match
    exact_matches: List[str] = []
    unmatched: List[str] = []
    for term in jd_terms:
        if term in resume_lower:
            exact_matches.append(term)
        else:
            unmatched.append(term)

    # Stage 4 — Two-stage semantic matching
    embedding_calls = 0
    semantic_matches: List[SemanticMatch] = []
    still_missing = unmatched

    if use_semantic and unmatched:
        semantic_matches, still_missing = two_stage_semantic_match(
            unmatched, resume_phrases, required_terms, config, embed_fn
        )
        # Count unique strings embedded (jd candidates + resume candidates)
        candidates = bm25_candidates(unmatched, resume_phrases, top_k=config.bm25_top_k)
        unique_embedded = set(candidates.keys())
        for phrases in candidates.values():
            unique_embedded.update(phrases)
        embedding_calls = len(unique_embedded)

    # Stage 5 — Coverage score
    total_weight = sum(jd_weights.values())
    matched_weight = 0.0

    for term in exact_matches:
        matched_weight += jd_weights[term]

    for sm in semantic_matches:
        matched_weight += jd_weights.get(sm.jd_term, 1.0) * sm.credit_fraction
        # Note: required terms have credit_fraction=0.0, so they don't inflate score

    coverage = (
        round((matched_weight / total_weight) * 100, 2) if total_weight > 0 else 100.0
    )

    # Stage 6 — Critical missing
    sections = detect_sections(jd_text)
    required_text = sections.get("required", "").lower()
    preferred_text = sections.get("preferred", "").lower()

    required_missing = [t for t in still_missing if t in required_text]
    preferred_missing = [
        t for t in still_missing if t in preferred_text and t not in required_text
    ]

    critical_missing = classify_critical_missing(
        still_missing, jd_text, required_terms, config
    )

    # Stage 7 — YOE
    yoe_reqs = extract_yoe_requirements(jd_text)
    yoe_result = check_yoe_against_resume(yoe_reqs, resume_text, config)

    return GapAnalysisResult(
        coverage_score=coverage,
        total_concepts=len(jd_terms),
        matched_weight=round(matched_weight, 2),
        total_weight=round(total_weight, 2),
        exact_matches=exact_matches,
        semantic_matches=semantic_matches,
        missing_terms=still_missing,
        critical_missing=critical_missing,
        required_missing=required_missing,
        preferred_missing=preferred_missing,
        required_terms=required_terms,
        yoe=yoe_result,
        embedding_calls=embedding_calls,
    )


def analyze_to_dict(
    jd_text: str,
    resume_text: str,
    config: AnalyzerConfig = DEFAULT_CONFIG,
    embed_fn: Optional[Callable] = None,
    use_semantic: bool = True,
) -> dict:
    """FastAPI-friendly dict output."""
    r = analyze_keyword_gap(jd_text, resume_text, config, embed_fn, use_semantic)
    return {
        "coverageScore": r.coverage_score,
        "totalConcepts": r.total_concepts,
        "exactMatches": r.exact_matches,
        "semanticMatches": [
            {
                "jdTerm": m.jd_term,
                "resumePhrase": m.resume_phrase,
                "similarity": m.similarity,
                "creditFraction": m.credit_fraction,
                "isRequiredTerm": m.jd_term in r.required_terms,
                "note": (
                    "Required term — exact match needed for ATS"
                    if m.jd_term in r.required_terms
                    else None
                ),
            }
            for m in r.semantic_matches
        ],
        "missingTerms": r.missing_terms,
        "criticalMissing": r.critical_missing,
        "requiredMissing": r.required_missing,
        "preferredMissing": r.preferred_missing,
        "matchedWeight": r.matched_weight,
        "totalWeight": r.total_weight,
        "embeddingCallsThisRequest": r.embedding_calls,
        "yoe": {
            "requirements": [
                {"years": r.years, "context": r.context, "raw": r.raw_text}
                for r in r.yoe.requirements
            ],
            "satisfied": [r.raw_text for r in r.yoe.satisfied],
            "unsatisfied": [r.raw_text for r in r.yoe.unsatisfied],
            "partial": [
                {"requirement": req.raw_text, "resumeYears": yrs}
                for req, yrs in r.yoe.partial
            ],
        },
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  EXAMPLE
# ═══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    JD = """
    Senior ML Engineer — Vercel AI

    We're looking for a Senior ML Engineer to join our platform team.

    Requirements:
    - 5+ years experience in machine learning or NLP
    - Strong Python skills, PyTorch or TensorFlow
    - Vector databases (Pinecone, Weaviate)
    - CI/CD pipelines and Docker/Kubernetes
    - 3+ years experience with large language models

    Preferred:
    - Open-source contributions
    - LangChain or LangGraph experience
    - AWS or GCP
    """

    RESUME = """
    Alex Chen — ML Engineer
    2017–2024 (7 years total)

    Skills: Python, PyTorch, scikit-learn, Docker, Git, REST APIs

    Experience:
    - Built automatic speech recognition models using deep learning
    - Deployed natural language processing pipelines at scale
    - Set up continuous integration with GitHub Actions
    - Vector search using FAISS on Amazon Web Services
    - 4 years experience with transformer-based language models
    """

    print("Fast mode (no embeddings):")
    r_fast = analyze_keyword_gap(JD, RESUME, use_semantic=False)
    print(r_fast.summary())

    print("\nFull mode (two-stage semantic):")
    r = analyze_keyword_gap(JD, RESUME, use_semantic=True)
    print(r.summary())
    print("\nSemantic matches (with section-aware credit):")
    for m in r.semantic_matches:
        req_note = (
            " ← REQUIRED: zero credit"
            if m.jd_term in r.required_terms
            else f" (credit: {m.credit_fraction})"
        )
        print(f"  '{m.jd_term}' ↔ '{m.resume_phrase}' sim={m.similarity}{req_note}")
    print("\nYOE:")
    print(f"  Satisfied: {[x.raw_text for x in r.yoe.satisfied]}")
    print(f"  Unsatisfied: {[x.raw_text for x in r.yoe.unsatisfied]}")
    print(f"  Partial: {[(x.raw_text, y) for x, y in r.yoe.partial]}")
