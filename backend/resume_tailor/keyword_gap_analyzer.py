"""
keyword_gap_analyzer_v5.py
===========================
Layer 2 of the gap analysis pipeline.

What changed from v4:
  - NO section detection logic. None. That complexity moved to jd_structurer.py.
  - Consumes StructuredJD dataclass instead of raw text.
  - Section-aware scoring is now trivial: required[] vs preferred[] vs other[].
  - All the messy format handling (metadata stripping, section key variants,
    title extraction heuristics) is completely gone from this file.
  - This file is now purely about analysis: phrase extraction, BM25,
    embeddings, scoring, YOE. No format concerns at all.

The gap analyzer is now format-agnostic by construction —
it never sees raw JD text, only clean structured data.
"""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Set, Tuple

import numpy as np
import spacy
from sklearn.metrics.pairwise import cosine_similarity

try:
    from rank_bm25 import BM25Okapi
    _HAS_BM25 = True
except ImportError:
    _HAS_BM25 = False

import logging
from utils.logger import get_logger

logger = get_logger(__name__)

from .jd_structurer import StructuredJD



# ═══════════════════════════════════════════════════════════════════════════════
#  MODEL SINGLETONS
# ═══════════════════════════════════════════════════════════════════════════════

_NLP: Optional[spacy.language.Language] = None
_EMBED_MODEL = None


def preload_models() -> None:
    """Pre-initialize NLP and embedding models at application startup.

    Call this once (e.g., in FastAPI's startup event) to avoid cold-start
    latency on the first real request. Both models are stored as module-level
    singletons so subsequent calls are no-ops.

    Models loaded:
        - spaCy ``en_core_web_sm``: tokenization, POS tagging, noun chunking.
          NER is disabled since we don't need named-entity labels here.
        - ``all-MiniLM-L6-v2`` (SentenceTransformer): 384-dim sentence embeddings
          used for semantic similarity scoring.
    """
    global _NLP, _EMBED_MODEL
    if _NLP is None:
        # NER disabled — we only need tokenizer + tagger + parser for noun chunks
        _NLP = spacy.load("en_core_web_sm", disable=["ner"])
    if _EMBED_MODEL is None:
        from sentence_transformers import SentenceTransformer
        _EMBED_MODEL = SentenceTransformer("all-MiniLM-L6-v2")


def _nlp() -> spacy.language.Language:
    """Lazy-load and return the spaCy pipeline singleton.

    Uses a module-level cache so the model is only loaded once per process.
    Subsequent calls return the already-loaded instance with no overhead.
    """
    global _NLP
    if _NLP is None:
        _NLP = spacy.load("en_core_web_sm", disable=["ner"])
    return _NLP


def _embed_model():
    """Lazy-load and return the SentenceTransformer singleton.

    ``all-MiniLM-L6-v2`` is a lightweight but high-quality model that produces
    384-dimensional embeddings. It's fast enough for batched inference on CPU
    and accurate enough for tech-term similarity at the 0.72 threshold used here.
    """
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
    """All tuneable knobs for the gap-analysis pipeline.

    Centralising every threshold and weight here makes A/B testing trivial —
    just instantiate with different values and pass to ``analyze_gap()``.

    Section weights
    ---------------
    These are multiplicative boosts applied to a phrase's base weight of 1.0.
    The structurer guarantees we *know* which section a phrase came from, so
    no heuristics are needed here.

    Frequency boost
    ---------------
    A term that appears many times in the JD is genuinely more important.
    The boost is linear up to ``freq_boost_cap`` to avoid runaway scores
    for very common filler words that somehow sneak through.

    Semantic matching
    -----------------
    ``semantic_threshold``: minimum cosine similarity to count a resume phrase
    as a semantic match for a JD term.  0.72 is relatively strict — tuned to
    avoid false positives like matching "Python" with "Jython".

    ``semantic_credit_preferred`` / ``semantic_credit_general``: fraction of
    the JD term's weight credited when matched semantically rather than exactly.
    Required terms always get 0.0 — a semantic near-miss is still an ATS gap.

    Two-stage retrieval
    -------------------
    ``bm25_top_k``: how many resume candidates BM25 shortlists per JD term
    before the more expensive embedding step.
    ``max_embed_pairs``: hard cap on total (jd_term, resume_phrase) pairs sent
    to the encoder to keep latency predictable.
    """

    # ── Section weights ──────────────────────────────────────────────────────
    # Structurer already separated required/preferred — no guessing needed here
    required_weight: float = 2.0    # "Must have" terms are twice as important
    preferred_weight: float = 1.3   # "Nice to have" gets a moderate boost
    title_weight: float = 2.5       # Job title terms are the strongest signal

    # ── Frequency boost ──────────────────────────────────────────────────────
    freq_boost_threshold: int = 2   # Start boosting after 2nd occurrence
    freq_boost_factor: float = 1.4  # Each extra occurrence adds 40% weight
    freq_boost_cap: float = 3.0     # Never exceed 3× regardless of frequency

    # ── Semantic matching ────────────────────────────────────────────────────
    semantic_threshold: float = 0.72          # Min cosine sim for a valid match
    # Required terms get 0.0 credit even when semantically similar —
    # ATS systems do exact-string matching, so the gap is real.
    semantic_credit_preferred: float = 0.65   # Max credit for preferred matches
    semantic_credit_general: float = 0.55     # Max credit for general matches

    # ── Two-stage retrieval ──────────────────────────────────────────────────
    bm25_top_k: int = 10          # BM25 shortlist size per JD term
    max_embed_pairs: int = 500    # Hard cap: prevents OOM on large resumes
    embed_batch_size: int = 64    # SentenceTransformer encode() batch size

    # ── Phrase extraction ────────────────────────────────────────────────────
    max_ngram: int = 4            # Longest n-gram to consider as a phrase
    min_phrase_chars: int = 4     # Discard single-char or very short tokens
    min_phrase_doc_freq: int = 2  # Rare phrases need noun/tech signal to keep

    # ── Critical missing ─────────────────────────────────────────────────────
    critical_freq_threshold: int = 3  # ≥3 JD occurrences → term is critical

    # ── YOE ──────────────────────────────────────────────────────────────────
    yoe_partial_threshold: float = 0.7  # 70% of required years → partial match


DEFAULT_CONFIG = AnalyzerConfig()


# ═══════════════════════════════════════════════════════════════════════════════
#  TECH-SAFE TOKENIZER
# ═══════════════════════════════════════════════════════════════════════════════

_PROTECT_PATTERNS = [
    r"\b[A-Za-z][A-Za-z0-9]*(?:\s+&\s+[A-Za-z][A-Za-z0-9]*)+\b",  # Weights & Biases
    r"\b[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+\b",        # Next.js
    r"\b[A-Za-z][A-Za-z0-9]*(?:/[A-Za-z][A-Za-z0-9]*)+\b",         # CI/CD
    r"\bend[-\s]to[-\s]end\b",
    r"\bfull[-\s]stack\b",
    r"\bopen[-\s]source\b",
    r"\b[A-Za-z][A-Za-z0-9]*[-\s]\d+(?:\.\d+)*\b",                 # Python 3.11
    r"\b[A-Z]{1,4}[a-z][A-Za-z0-9]*\b",                            # LangChain, GenAI, LoRA
    r"\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b",                           # LlamaIndex, PromptLayer
    r"\b[A-Z]{2,}(?:\+\+|#)?\b",                                    # NLP, AWS, C++
]
_PROTECT_RE = re.compile("|".join(_PROTECT_PATTERNS), re.IGNORECASE)


def _protect_tech(text: str) -> Tuple[str, Dict[str, str]]:
    """Temporarily replace tech tokens with opaque placeholders before NLP.

    The problem: spaCy's tokenizer splits on punctuation and hyphens, so
    ``Next.js`` becomes ``Next`` + ``.`` + ``js`` and ``CI/CD`` becomes
    ``CI`` + ``/`` + ``CD``. Those fragments are useless for matching.

    The solution: run a regex that recognises common tech patterns first,
    swap each match with a unique key like ``__TECH0__``, run spaCy, then
    restore the originals from the mapping dict.

    Args:
        text: Raw text that may contain tech terms.

    Returns:
        A tuple of (protected_text, mapping) where mapping maps each
        placeholder key back to the original lowercased tech term.
    """
    mapping: Dict[str, str] = {}
    ctr = [0]  # Mutable list so the inner closure can mutate it (PEP 3104)

    def sub(m: re.Match) -> str:
        k = f"__TECH{ctr[0]}__"
        # Store the lowercased form so downstream comparisons are case-insensitive
        mapping[k] = m.group(0).lower().strip()
        ctr[0] += 1
        return k

    return _PROTECT_RE.sub(sub, text), mapping


def tokenize(text: str) -> List[str]:
    """Convert raw text to a list of normalised tokens, preserving tech terms.

    Pipeline:
      1. Protect tech tokens (e.g. ``AWS``, ``Next.js``) with placeholders.
      2. Run spaCy on the lowercased protected text.
      3. For each token:
         - If it's a placeholder → restore the original tech term.
         - If it's a stop word / punctuation / whitespace → skip.
         - Otherwise → use spaCy's lemma (``running`` → ``run``).

    Args:
        text: Any free-form text (JD snippet or resume paragraph).

    Returns:
        List of normalised tokens ready for BM25 indexing or stem comparison.
    """
    protected, mapping = _protect_tech(text)
    doc = _nlp()(protected.lower())
    out: List[str] = []
    for tok in doc:
        raw = tok.text.strip()
        if raw in mapping:
            # Restore the protected tech term verbatim (already lowercased)
            out.append(mapping[raw])
        elif tok.is_stop or tok.is_punct or tok.is_space:
            # Skip noise — stop words and punctuation add no signal
            continue
        elif tok.lemma_.strip():
            out.append(tok.lemma_.strip())
    return out


def stem_set(tokens: List[str]) -> Set[str]:
    """Return a set of crude stems for a list of tokens.

    Intuition: a simple rule-based stemmer is fast and good enough for
    overlap detection. We don't need the sophistication of Porter/Snowball
    because we're only using stems to *pre-filter* candidates, not for
    final scoring. Better to have a fast false-positive than a slow miss.

    The suffixes are tried in order; only the first match is stripped.
    A minimum stem length of 3 prevents over-stemming short words.

    Args:
        tokens: Already-lowercased tokens.

    Returns:
        Set of stems (may be smaller than ``tokens`` if some share a stem).
    """
    stems: Set[str] = set()
    for t in tokens:
        s = t
        for suffix in ("ing", "tion", "ed", "er", "es", "s"):
            if t.endswith(suffix) and len(t) - len(suffix) >= 3:
                s = t[: -len(suffix)]
                break  # Only strip one suffix per token
        stems.add(s)
    return stems


# ═══════════════════════════════════════════════════════════════════════════════
#  PHRASE EXTRACTION
# ═══════════════════════════════════════════════════════════════════════════════

def _has_noun(phrase: str) -> bool:
    """Return True if the phrase contains at least one noun or proper noun.

    Intuition: bare adjective phrases (e.g. "analytical") or verb phrases are
    rarely meaningful keywords on their own. Requiring a noun keeps the phrase
    list focused on entities, skills, and concepts rather than descriptors.
    """
    doc = _nlp()(phrase)
    return any(t.pos_ in ("NOUN", "PROPN") for t in doc)


def _has_tech_token(phrase: str) -> bool:
    """Return True if the phrase contains a protected tech-term pattern.

    Used as an alternative keep-condition for extract_phrases: even if a
    phrase has no noun (e.g. a bare acronym like ``NLP``), it should be
    retained because the protect-pattern regex already validated it as a
    meaningful technical token.
    """
    return bool(_PROTECT_RE.search(phrase))


def extract_phrases(text: str, config: AnalyzerConfig = DEFAULT_CONFIG) -> List[str]:
    """Extract candidate keyword phrases from a block of text.

    Two complementary extraction strategies are combined:

    1. **Noun chunks** (spaCy): linguistically motivated multi-word NPs like
       ``"machine learning pipeline"`` or ``"distributed training framework"``.
       These tend to be high-precision but may miss abbreviations and
       single-word technical terms.

    2. **N-grams** (1 to ``config.max_ngram`` words): exhaustive sliding-window
       over raw tokens. High recall but noisy — the keep-filter below prunes
       the noise.

    Keep filter (a candidate survives if ANY of these is true):
      - Contains a noun/proper noun (broad linguistic signal).
      - Matches a tech-term pattern (e.g. ``AWS``, ``CI/CD``).
      - Appears at least ``min_phrase_doc_freq`` times in the text
        (frequency signals importance even without a noun).

    Args:
        text:   Raw text to extract phrases from (JD or resume).
        config: Controls n-gram size and minimum phrase length/frequency.

    Returns:
        Deduplicated list of candidate phrases (not yet sub-phrase-deduplicated).
    """
    text_lower = text.lower()
    doc = _nlp()(text_lower)
    candidates: Set[str] = set()

    # Strategy 1: spaCy noun chunks — already well-formed NPs
    for chunk in doc.noun_chunks:
        c = re.sub(r"\s+", " ", chunk.text.strip())
        if len(c) >= config.min_phrase_chars:
            candidates.add(c)

    # Strategy 2: exhaustive n-grams for coverage of abbreviations and
    # multi-word tech terms that spaCy may not parse as a single NP
    raw_tokens = [t.text for t in doc if not t.is_space]
    for n in range(1, config.max_ngram + 1):
        for i in range(len(raw_tokens) - n + 1):
            gram = " ".join(raw_tokens[i: i + n]).strip()
            if len(gram) >= config.min_phrase_chars:
                candidates.add(gram)

    # Apply keep-filter: discard low-signal candidates
    return [
        p for p in candidates
        if _has_noun(p)
        or _has_tech_token(p)
        or len(re.findall(re.escape(p), text_lower)) >= config.min_phrase_doc_freq
    ]


def deduplicate_subphrases(phrases: List[str]) -> List[str]:
    """Remove shorter phrases that are already subsumed by longer ones.

    Intuition: if we keep both ``"machine learning"`` and
    ``"machine learning models"``, the shorter one is redundant — it adds
    no extra information and bloats the term list, increasing the chance of
    spurious matches.

    Algorithm (greedy, longest-first):
      1. Sort phrases by length (descending) so the most specific phrases
         are processed first.
      2. For each phrase not yet suppressed:
         a. Add it to the kept list.
         b. Enumerate every sub-window of its words and add them to
            the suppressed set.
      3. Any phrase that appears in the suppressed set is skipped.

    This is O(n × k²) where k is the max phrase word count (small in practice).

    Args:
        phrases: Raw candidate phrase list from ``extract_phrases``.

    Returns:
        Pruned list containing only the most specific, non-redundant phrases.
    """
    # Sort longest-first so broader phrases absorb their sub-phrases
    phrases_sorted = sorted(set(phrases), key=len, reverse=True)
    kept: List[str] = []
    suppressed: Set[str] = set()
    for phrase in phrases_sorted:
        if phrase in suppressed:
            continue
        kept.append(phrase)
        words = phrase.split()
        # Mark all contiguous sub-windows of this phrase as suppressed
        for n in range(1, len(words)):
            for i in range(len(words) - n + 1):
                suppressed.add(" ".join(words[i: i + n]))
    return kept


# ═══════════════════════════════════════════════════════════════════════════════
#  WEIGHTED TERM BUILDER
#
#  Now trivially section-aware because StructuredJD already separated the sections.
#  No heuristics needed. We know with certainty what is required vs preferred.
# ═══════════════════════════════════════════════════════════════════════════════

def build_weighted_terms(
    structured: StructuredJD,
    config: AnalyzerConfig = DEFAULT_CONFIG,
) -> Tuple[Dict[str, float], Set[str]]:
    """Assign importance weights to every phrase extracted from the JD.

    This is the bridge between the structured JD and the gap scorer. Because
    ``StructuredJD`` already knows which text belongs to which section, we can
    apply section weights deterministically — no heuristics needed.

    Weight formula (all factors are multiplicative, starting from 1.0)::

        weight = 1.0
            × freq_boost          (if phrase appears ≥2 times in full JD)
            × required_weight     (if phrase is in the required section)
            × preferred_weight    (if phrase is in the preferred section)
            × title_weight        (if phrase is in the job title)

    A phrase can accumulate multiple multipliers, e.g. a required phrase that
    also appears in the title gets 2.0 × 2.5 = 5.0 weight.

    The ``required_terms`` set is returned separately so the semantic matcher
    can apply zero credit to those terms even when semantically covered —
    ATS systems require exact string matches for must-have qualifications.

    Args:
        structured: Output of ``jd_structurer.structure_jd()``.
        config:     Scoring configuration.

    Returns:
        A tuple of:
          - ``weights``: mapping from phrase to its computed importance weight.
          - ``required_terms``: subset of phrases originating from the required
            section (used to deny semantic credit downstream).
    """
    # Pull lowercased views of each section for fast substring membership tests
    full_text = structured.full_jd_text
    full_text_lower = full_text.lower()
    required_text_lower = structured.required_text.lower()
    preferred_text_lower = structured.preferred_text.lower()
    title_lower = structured.title.lower()

    # Extract all phrases from the full JD, then deduplicate sub-phrases
    phrases = extract_phrases(full_text, config)
    phrases = deduplicate_subphrases(phrases)

    weights: Dict[str, float] = {}
    required_terms: Set[str] = set()

    for phrase in phrases:
        if len(phrase) < config.min_phrase_chars:
            continue

        weight = 1.0
        count = len(re.findall(re.escape(phrase), full_text_lower))

        # Frequency boost: the more a term appears in the JD, the more the
        # employer cares about it. Boost grows linearly with extra occurrences
        # but is capped to avoid inflating common filler words.
        if count >= config.freq_boost_threshold:
            # extra = occurrences beyond the threshold (capped at 5 to limit impact)
            extra = min(count - config.freq_boost_threshold, 5)
            freq_mult = min(
                1.0 + extra * (config.freq_boost_factor - 1.0),
                config.freq_boost_cap,
            )
            weight *= freq_mult

        # Section boosts — deterministic because StructuredJD did the parsing
        if phrase in required_text_lower:
            weight *= config.required_weight
            # Tag this phrase so semantic matching later gives it zero credit
            required_terms.add(phrase)
        if phrase in preferred_text_lower:
            weight *= config.preferred_weight
        if phrase in title_lower:
            # Title terms represent the core competency the role is built around
            weight *= config.title_weight

        weights[phrase] = round(weight, 3)

    return weights, required_terms


# ═══════════════════════════════════════════════════════════════════════════════
#  LEXICAL PRE-FILTER + BM25 CANDIDATE RETRIEVAL
# ═══════════════════════════════════════════════════════════════════════════════

def lexical_prefilter(
    jd_terms: List[str],
    resume_phrases: List[str],
) -> Dict[str, List[str]]:
    """Return resume phrases that share at least one token with each JD term.

    This is the fallback pre-filter used when ``rank_bm25`` is not installed.
    It's cheaper than BM25 but less ranked: any overlap (exact token, first
    token, or shared stem) counts as a candidate.

    Intuition: we want to pass only *plausible* candidates to the expensive
    embedding step. A resume phrase like ``"REST API design"`` shares the token
    ``"api"`` with the JD term ``"api development"``, so it's worth embedding
    even though the phrases aren't identical.

    Three overlap criteria (any one is sufficient):
      1. **Token intersection**: the sets of words overlap directly.
      2. **First-token match**: the JD term's first word appears anywhere in
         the resume phrase (catches e.g. ``"Python"`` matching
         ``"Python scripting"``).
      3. **Stem intersection**: after light stemming, the token sets overlap
         (catches ``"deploy"`` matching ``"deployment"``).

    Args:
        jd_terms:      List of JD phrases to match against.
        resume_phrases: All phrases extracted from the candidate's resume.

    Returns:
        Dict mapping each matched JD term to a list of plausible resume phrases.
        JD terms with zero candidates are omitted.
    """
    # Pre-compute token and stem sets for all resume phrases once — O(n) not O(n×m)
    resume_tokens = [set(p.split()) for p in resume_phrases]
    resume_stems = [stem_set(p.split()) for p in resume_phrases]
    candidates: Dict[str, List[str]] = {}

    for jd_term in jd_terms:
        jd_tok = set(jd_term.split())
        jd_stem = stem_set(list(jd_tok))
        first = jd_term.split()[0] if jd_term.split() else ""
        matched = []
        for i, phrase in enumerate(resume_phrases):
            if (
                jd_tok & resume_tokens[i]           # exact token overlap
                or (first and first in resume_tokens[i])  # first-word heuristic
                or jd_stem & resume_stems[i]        # stem overlap
            ):
                matched.append(phrase)
        if matched:
            candidates[jd_term] = matched

    return candidates


def bm25_candidates(
    jd_terms: List[str],
    resume_phrases: List[str],
    top_k: int = 10,
) -> Dict[str, List[str]]:
    """Retrieve the top-k most lexically relevant resume phrases per JD term.

    Uses BM25Okapi (Okapi BM25) as a lightweight ranked retrieval step to
    shortlist resume phrases before the expensive embedding step.

    Intuition: BM25 rewards term frequency in the "document" (resume phrase)
    while penalising terms that appear in many documents (IDF). This surfaces
    resume phrases that are specifically about the JD term rather than
    incidentally sharing a common word.

    Falls back to ``lexical_prefilter`` if ``rank_bm25`` is not installed,
    ensuring the pipeline degrades gracefully without the optional dependency.

    Args:
        jd_terms:       JD phrases to query against the resume index.
        resume_phrases: All resume phrases (treated as BM25 "documents").
        top_k:          Maximum candidates to return per JD term.

    Returns:
        Dict mapping each JD term to its top-k resume phrase candidates
        (only terms with at least one candidate are included).
    """
    if not _HAS_BM25 or not resume_phrases:
        # Graceful degradation: token-overlap filter is faster but unranked
        return lexical_prefilter(jd_terms, resume_phrases)

    # Build BM25 index treating each resume phrase as a "document"
    bm25 = BM25Okapi([p.split() for p in resume_phrases])
    result: Dict[str, List[str]] = {}
    for term in jd_terms:
        scores = bm25.get_scores(term.split())
        # argsort descending, then filter to non-zero scores only
        top_idx = [i for i in np.argsort(scores)[::-1][:top_k] if scores[i] > 0]
        if top_idx:
            result[term] = [resume_phrases[i] for i in top_idx]
    return result


# ═══════════════════════════════════════════════════════════════════════════════
#  TWO-STAGE SEMANTIC MATCHER
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class SemanticMatch:
    """A JD term that was not found verbatim but is semantically covered by the resume.

    Attributes:
        jd_term:         The original phrase from the job description.
        resume_phrase:   The closest matching phrase found in the resume.
        similarity:      Cosine similarity (0-1) between their sentence embeddings.
        credit_fraction: Fraction of the JD term's weight credited toward the
                         coverage score. 0.0 for required terms (ATS needs exact
                         string matches); up to 0.65 for preferred/general terms.
    """
    jd_term: str
    resume_phrase: str
    similarity: float
    credit_fraction: float   # 0.0 for required terms (exact match needed)


def two_stage_semantic_match(
    unmatched: List[str],
    resume_phrases: List[str],
    required_terms: Set[str],
    config: AnalyzerConfig = DEFAULT_CONFIG,
    embed_fn: Optional[Callable] = None,
) -> Tuple[List[SemanticMatch], List[str]]:
    """Find semantic matches for JD terms not found verbatim in the resume.

    Two-stage design trades accuracy for efficiency:

    **Stage 1 - BM25 shortlisting** (cheap lexical retrieval):
      For each unmatched JD term, BM25 scores all resume phrases and returns
      the top-k most lexically relevant ones. This cuts the number of pairs
      that need the expensive embedding step.

    **Stage 2 - Embedding similarity** (high-quality but costly):
      Only shortlisted pairs are encoded with SentenceTransformer. JD terms
      and all unique resume candidates are embedded in a single batch call
      to minimise encoder round-trips. Cosine similarity selects the best match.

    A match is accepted when cosine sim >= semantic_threshold (default 0.72).
    Required terms receive 0.0 credit even on a semantic match; preferred/general
    terms receive up to semantic_credit_preferred x similarity as partial credit.

    Pair cap (max_embed_pairs): if total candidate pairs exceed the cap, each
    term's candidate list is trimmed proportionally to prevent OOM issues.

    Args:
        unmatched:      JD terms with no exact match in the resume.
        resume_phrases: All phrases extracted from the resume.
        required_terms: Must-have JD phrases that receive zero semantic credit.
        config:         Scoring and retrieval configuration.
        embed_fn:       Optional custom embedding function (useful for testing).

    Returns:
        Tuple of (list of SemanticMatch objects, list of still-unmatched JD terms).
    """
    if not unmatched or not resume_phrases:
        return [], unmatched

    candidates = bm25_candidates(unmatched, resume_phrases, top_k=config.bm25_top_k)

    unique_jd = set(candidates.keys())
    unique_resume: Set[str] = set()
    for phrases in candidates.values():
        unique_resume.update(phrases)

    if not unique_jd:
        return [], unmatched

    # Hard cap to bound embedding cost - trim candidate lists proportionally
    total_pairs = sum(len(v) for v in candidates.values())
    if total_pairs > config.max_embed_pairs:
        ratio = config.max_embed_pairs / total_pairs
        candidates = {k: v[: max(1, int(len(v) * ratio))] for k, v in candidates.items()}
        unique_resume = {p for ps in candidates.values() for p in ps}

    embed = embed_fn or (
        lambda texts: _embed_model().encode(
            texts, batch_size=config.embed_batch_size, show_progress_bar=False
        )
    )

    jd_list = list(unique_jd)
    res_list = list(unique_resume)
    # Embed all texts in ONE batch - concatenating avoids two separate encode()
    # calls; the model batches most efficiently when all texts go in together.
    all_vecs = embed(jd_list + res_list)
    # Split the result array back into per-term dicts for easy lookup
    jd_vecs = {t: all_vecs[i] for i, t in enumerate(jd_list)}
    res_vecs = {p: all_vecs[len(jd_list) + i] for i, p in enumerate(res_list)}

    matched: List[SemanticMatch] = []
    matched_set: Set[str] = set()

    for term, cands in candidates.items():
        t_vec = jd_vecs[term].reshape(1, -1)
        c_vecs = np.array([res_vecs[p] for p in cands])
        sims = cosine_similarity(t_vec, c_vecs)[0]  # shape: (len(cands),)
        best_idx = int(np.argmax(sims))
        best_sim = float(sims[best_idx])

        if best_sim >= config.semantic_threshold:
            is_req = term in required_terms
            # Required terms flagged with 0.0 credit - semantic overlap is not
            # enough; the actual keyword must appear on the resume for ATS.
            credit = 0.0 if is_req else min(
                config.semantic_credit_preferred * best_sim,
                config.semantic_credit_preferred,
            )
            matched.append(SemanticMatch(
                jd_term=term,
                resume_phrase=cands[best_idx],
                similarity=round(best_sim, 3),
                credit_fraction=round(credit, 3),
            ))
            matched_set.add(term)

    # Return only terms that still have no match after both stages
    return matched, [t for t in unmatched if t not in matched_set]


# ═══════════════════════════════════════════════════════════════════════════════
#  YOE SUB-ANALYZER
# ═══════════════════════════════════════════════════════════════════════════════

_YOE_JD_RE = re.compile(
    r"(\d+)\+?\s*(?:to\s*\d+\s*)?(?:years?|yrs?)"
    r"(?:\s+(?:of\s+)?(?:experience|exp|work))?"
    r"(?:\s+(?:in|with|using|of)\s+([^\n,;.]{3,40}))?",
    re.IGNORECASE,
)
_YOE_RESUME_RE = re.compile(
    r"(\d+)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|exp)\s+(?:in|with)?\s*([^\n,;.]{3,40})",
    re.IGNORECASE,
)
_GENERIC_YOE_CONTEXTS: Set[str] = {
    "a similar role", "similar role", "this role", "the field",
    "related field", "similar position", "the industry",
    "relevant experience", "relevant field", "a related field",
}


@dataclass
class YOERequirement:
    """A single years-of-experience requirement parsed from the JD.

    Attributes:
        years:      Minimum number of years required.
        context:    Domain or technology the experience should be in
                    (e.g. 'python'). Empty string for generic requirements.
        raw_text:   The original matched text from the JD, used for display.
        is_generic: True if the context is too vague for specific matching
                    (e.g. 'a similar role'). Generic requirements fall back
                    to comparing against total inferred career span.
    """
    years: int
    context: str
    raw_text: str
    is_generic: bool


@dataclass
class YOEResult:
    """Aggregated output of the YOE sub-analyzer.

    Attributes:
        requirements:  All YOE requirements extracted from the JD.
        satisfied:     Requirements the resume clearly meets.
        unsatisfied:   Requirements the resume clearly does not meet.
        partial:       Requirements where resume years fall between
                       yoe_partial_threshold and the full requirement.
                       Each entry is a (YOERequirement, resume_years) tuple.
    """
    requirements: List[YOERequirement]
    satisfied: List[YOERequirement]
    unsatisfied: List[YOERequirement]
    partial: List[Tuple[YOERequirement, int]]


def _is_generic_context(ctx: str) -> bool:
    """Return True if the YOE context string is too vague to match specifically.

    A context is generic if it appears in the known vague-phrase set OR if it
    is very short (<= 2 words). Short contexts like 'in software' provide little
    matching signal and are safer to evaluate against total career span.
    """
    return ctx.lower().strip() in _GENERIC_YOE_CONTEXTS or len(ctx.split()) <= 2


def _infer_experience_years(resume_text: str) -> int:
    """Estimate total career span by scanning for 4-digit year mentions.

    Intuition: most resumes list employment years (e.g. '2018 - 2023'). The
    spread between the earliest and latest year is a reasonable proxy for total
    professional experience when no explicit claim is made. Returns 0 if fewer
    than two distinct year mentions are found.

    Only years in range 1980-2029 are considered (regex: 19[89]d or 20[012]d)
    to avoid matching version numbers like '2.0' or far-future dates.
    """
    years = [int(y) for y in re.findall(r"\b(19[89]\d|20[012]\d)\b", resume_text)]
    return max(years) - min(years) if len(years) >= 2 else 0


def analyze_yoe(
    structured: StructuredJD,
    resume_text: str,
    config: AnalyzerConfig = DEFAULT_CONFIG,
) -> YOEResult:
    """Compare JD years-of-experience requirements against the resume.

    Extraction (JD side):
      Scans the required section first (where YOE usually lives), then deduplicates
      requirements by a (years, context) key.

    Matching (resume side):
      - Specific contexts (e.g. 'in Python'): looks for explicit claims like
        '4 years of experience in Python' in the resume and compares directly.
      - Generic contexts (e.g. 'in a similar role'): falls back to total career
        span inferred from the earliest/latest year mentions.

    Partial match: if resume years are between yoe_partial_threshold x required
    and the full requirement, the entry is marked partial rather than unsatisfied.

    Fallback for specific contexts with no explicit claim:
      If the context keyword appears in the resume and career span meets the
      requirement, it's marked partial (candidate has exposure but didn't quantify).

    Args:
        structured:  Parsed JD containing separated required text.
        resume_text: Raw resume text (not pre-parsed).
        config:      Threshold configuration for partial-match classification.

    Returns:
        YOEResult with all requirements bucketed into satisfied/partial/unsatisfied.
    """
    # Scan required section first (highest signal), then full JD for completeness
    yoe_source = structured.required_text + " " + structured.full_jd_text
    reqs: List[YOERequirement] = []
    seen: Set[str] = set()  # Dedup key: "years:context"

    for m in _YOE_JD_RE.finditer(yoe_source):
        years = int(m.group(1))
        ctx = (m.group(2) or "").strip().lower()
        raw = m.group(0).strip()
        key = f"{years}:{ctx}"
        if years > 0 and key not in seen:
            seen.add(key)
            reqs.append(YOERequirement(
                years=years, context=ctx, raw_text=raw,
                is_generic=_is_generic_context(ctx),
            ))

    # Build a map of explicitly claimed years per context from the resume
    resume_lower = resume_text.lower()
    resume_claims: Dict[str, int] = {}  # {context_string: max_claimed_years}
    for m in _YOE_RESUME_RE.finditer(resume_lower):
        years = int(m.group(1))
        ctx = (m.group(2) or "").strip().lower()
        if ctx:
            # Keep the highest claim if the same context appears multiple times
            resume_claims[ctx] = max(resume_claims.get(ctx, 0), years)

    # Infer overall career span as a fallback for generic / unclaimed requirements
    date_years = _infer_experience_years(resume_text)
    satisfied, unsatisfied, partial = [], [], []

    for req in reqs:
        if req.is_generic or not req.context:
            if date_years >= req.years:
                satisfied.append(req)
            elif date_years >= req.years * config.yoe_partial_threshold:
                partial.append((req, date_years))
            else:
                unsatisfied.append(req)
            continue

        # Specific context: find the best explicit claim with overlapping context
        # (substring match in both directions handles minor wording variations)
        best = max(
            (v for k, v in resume_claims.items()
             if req.context in k or k in req.context),
            default=0,
        )
        # Check if the context keyword even appears anywhere in the resume text
        ctx_present = req.context.split()[0] in resume_lower if req.context else False

        if best >= req.years:
            satisfied.append(req)
        elif best >= req.years * config.yoe_partial_threshold:
            # Resume claims years explicitly but falls slightly short
            partial.append((req, best))
        elif ctx_present and date_years >= req.years:
            # Context mentioned, no explicit years, but overall career span qualifies
            partial.append((req, date_years))
        else:
            unsatisfied.append(req)

    return YOEResult(requirements=reqs, satisfied=satisfied,
                     unsatisfied=unsatisfied, partial=partial)


# ═══════════════════════════════════════════════════════════════════════════════
#  RESULT
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class GapAnalysisResult:
    """The complete output of a single analyze_gap() call.

    Attributes:
        coverage_score:    Weighted percentage of JD concepts covered by the resume.
                           Formula: (matched_weight / total_weight) * 100.
        total_concepts:    Total number of unique phrases extracted from the JD.
        matched_weight:    Sum of weights for exact matches plus fractional credit
                           from semantic matches.
        total_weight:      Sum of all JD phrase weights (denominator of coverage).
        exact_matches:     JD phrases found verbatim (substring) in the resume.
        semantic_matches:  JD phrases matched by semantic similarity (not exact).
        missing_terms:     JD phrases with no exact or semantic match at all.
        critical_missing:  Subset of missing_terms that are especially important:
                           in the required section, appear >= 3 times, or in title.
                           Sorted: required-section terms first, then by frequency.
        required_missing:  Missing terms that originate from the required section.
        preferred_missing: Missing terms from the preferred section only.
        required_terms:    Full set of phrases tagged as required (whether matched
                           or not) - used by to_dict() to annotate semantic matches.
        yoe:               Years-of-experience analysis result.
        embedding_calls:   Count of unique texts sent to the encoder (for telemetry).
        structured_jd:     The structured JD passed in; included for transparency.
    """
    coverage_score: float
    total_concepts: int
    matched_weight: float
    total_weight: float
    exact_matches: List[str]
    semantic_matches: List[SemanticMatch]
    missing_terms: List[str]
    critical_missing: List[str]
    required_missing: List[str]
    preferred_missing: List[str]
    required_terms: Set[str]
    yoe: YOEResult
    embedding_calls: int
    structured_jd: StructuredJD     # included for transparency / debugging

    def summary(self) -> str:
        """Return a compact human-readable summary string for logging or display.

        Shows coverage score, match counts, prominent required/critical gaps,
        YOE gaps, and embedding call count. Truncates long lists at 6 items.
        """
        lines = [
            f"JD Title: {self.structured_jd.title or '(not detected)'}",
            f"Structured via: {self.structured_jd.structuring_method} "
            f"({self.structured_jd.structuring_latency_ms}ms)",
            f"Coverage: {self.coverage_score:.1f}%  "
            f"[{len(self.exact_matches)} exact · "
            f"{len(self.semantic_matches)} semantic · "
            f"{len(self.missing_terms)} missing]",
        ]
        if self.required_missing:
            lines.append(
                f"Required gaps ({len(self.required_missing)}): "
                + ", ".join(self.required_missing[:6])
                + ("..." if len(self.required_missing) > 6 else "")
            )
        if self.critical_missing:
            lines.append(
                f"Critical missing ({len(self.critical_missing)}): "
                + ", ".join(self.critical_missing[:6])
                + ("..." if len(self.critical_missing) > 6 else "")
            )
        if self.yoe.unsatisfied:
            lines.append(
                "YOE gaps: " + ", ".join(r.raw_text for r in self.yoe.unsatisfied[:3])
            )
        if self.yoe.partial:
            lines.append(
                "YOE partial: " + ", ".join(
                    f"{r.raw_text} (resume: {y}yr)" for r, y in self.yoe.partial[:3]
                )
            )
        lines.append(f"Embedding calls: {self.embedding_calls}")
        return "\n".join(lines)

    def to_dict(self) -> dict:
        """Serialise the result to a JSON-compatible dict for API responses.

        Semantic matches include an 'isRequiredTerm' flag and a human-readable
        'note' string so downstream consumers (e.g. the resume tailor) can
        distinguish required gaps from preferred gaps without re-querying.
        """
        return {
            "coverageScore": self.coverage_score,
            "totalConcepts": self.total_concepts,
            "exactMatches": self.exact_matches,
            "semanticMatches": [
                {
                    "jdTerm": m.jd_term,
                    "resumePhrase": m.resume_phrase,
                    "similarity": m.similarity,
                    "creditFraction": m.credit_fraction,
                    "isRequiredTerm": m.jd_term in self.required_terms,
                    "note": "Required — exact match needed for ATS"
                            if m.jd_term in self.required_terms else None,
                }
                for m in self.semantic_matches
            ],
            "missingTerms": self.missing_terms,
            "criticalMissing": self.critical_missing,
            "requiredMissing": self.required_missing,
            "preferredMissing": self.preferred_missing,
            "matchedWeight": self.matched_weight,
            "totalWeight": self.total_weight,
            "embeddingCalls": self.embedding_calls,
            "structuredJD": self.structured_jd.to_dict(),
            "yoe": {
                "requirements": [
                    {"years": r.years, "context": r.context,
                     "raw": r.raw_text, "isGeneric": r.is_generic}
                    for r in self.yoe.requirements
                ],
                "satisfied": [r.raw_text for r in self.yoe.satisfied],
                "unsatisfied": [r.raw_text for r in self.yoe.unsatisfied],
                "partial": [
                    {"requirement": req.raw_text, "resumeYears": yrs}
                    for req, yrs in self.yoe.partial
                ],
            },
        }


# ═══════════════════════════════════════════════════════════════════════════════
#  MAIN ANALYZER — receives StructuredJD, not raw text
# ═══════════════════════════════════════════════════════════════════════════════

def analyze_gap(
    structured: StructuredJD,
    resume_text: str,
    config: AnalyzerConfig = DEFAULT_CONFIG,
    embed_fn: Optional[Callable] = None,
    use_semantic: bool = True,
) -> GapAnalysisResult:
    """Core gap analysis pipeline. Accepts a pre-parsed StructuredJD, not raw text.

    The function is deliberately format-agnostic: all section detection and JD
    parsing happened upstream in jd_structurer.py. This function only cares
    about *what* is required/preferred, not *how* the JD was formatted.

    The 7-stage pipeline:
      1. Build weighted term map from the JD (phrases + importance weights).
      2. Extract and deduplicate phrases from the resume.
      3. Exact matching - simple substring scan, O(n) per term.
      4. Two-stage semantic matching (BM25 -> embeddings) for unmatched terms.
      5. Compute weighted coverage score.
      6. Classify missing terms: required_missing, preferred_missing, critical.
      7. YOE sub-analysis.

    Args:
        structured:   Output of jd_structurer.structure_jd(). Contains
                      separated required/preferred text and the full JD.
        resume_text:  Raw resume text. Not pre-parsed; extract_phrases handles it.
        config:       All scoring thresholds and weights. Defaults work well;
                      pass a custom AnalyzerConfig for A/B testing.
        embed_fn:     Optional drop-in replacement for the SentenceTransformer
                      encoder. Useful for unit tests or alternative models.
        use_semantic: Set to False to skip embedding (faster; use for batch
                      pre-screening where exact match coverage is sufficient).

    Returns:
        GapAnalysisResult containing the coverage score, match lists, missing
        terms, critical gaps, and YOE analysis.
    """
    # Stage 1: Build weighted term map
    # Each phrase gets a weight reflecting how important it is to the employer.
    # required_terms is the subset that must be exact-matched for ATS compliance.
    jd_weights, required_terms = build_weighted_terms(structured, config)
    jd_terms = list(jd_weights.keys())

    # Stage 2: Extract resume phrases
    # Mirror the JD phrase extraction on the resume so both sides use the
    # same representation before comparison.
    resume_phrases = extract_phrases(resume_text, config)
    resume_phrases = deduplicate_subphrases(resume_phrases)
    resume_lower = resume_text.lower()

    # Stage 3: Exact matching
    # Simple substring check - fast O(n) scan. This catches verbatim keyword
    # matches which ATS systems rely on. No normalisation beyond lowercasing.
    exact_matches: List[str] = []
    unmatched: List[str] = []
    for term in jd_terms:
        if term in resume_lower:
            exact_matches.append(term)
        else:
            unmatched.append(term)

    # Stage 4: Two-stage semantic matching (BM25 -> embeddings)
    # Only run for terms that had no exact match. use_semantic=False bypasses
    # this entirely for speed (e.g. bulk pre-screening).
    embedding_calls = 0
    semantic_matches: List[SemanticMatch] = []
    still_missing = unmatched

    if use_semantic and unmatched:
        semantic_matches, still_missing = two_stage_semantic_match(
            unmatched, resume_phrases, required_terms, config, embed_fn
        )
        # Count unique texts passed to the encoder for telemetry/billing tracking
        cands = bm25_candidates(unmatched, resume_phrases, top_k=config.bm25_top_k)
        embedding_calls = len({t for t in cands} | {p for ps in cands.values() for p in ps})

    # Stage 5: Coverage score
    # Weighted sum: exact matches get full credit; semantic matches get partial
    # credit (credit_fraction, which is 0 for required terms).
    # Formula: coverage = (matched_weight / total_weight) * 100
    total_weight = sum(jd_weights.values())
    matched_weight = sum(jd_weights[t] for t in exact_matches)
    for sm in semantic_matches:
        # Semantic credit is already scaled by similarity inside SemanticMatch
        matched_weight += jd_weights.get(sm.jd_term, 1.0) * sm.credit_fraction
    coverage = round((matched_weight / total_weight) * 100, 2) if total_weight > 0 else 100.0

    # Stage 6: Classify missing terms by importance
    # Using pre-lowercased section views avoids repeated .lower() calls below.
    full_text_lower = structured.full_jd_text.lower()
    required_text_lower = structured.required_text.lower()
    preferred_text_lower = structured.preferred_text.lower()

    # required_missing: terms the employer flagged as non-negotiable for ATS
    required_missing = [t for t in still_missing if t in required_text_lower]
    # preferred_missing: 'nice to have' terms NOT already in the required section
    preferred_missing = [t for t in still_missing
                         if t in preferred_text_lower and t not in required_text_lower]

    # Critical missing: union of three high-signal criteria —
    #   in the required section, appears >= threshold times, or in the job title.
    # Sorted so required-section terms float to the top; within each bucket,
    # higher frequency = more urgency to add to the resume.
    title_lower = structured.title.lower()

    def is_critical(term: str) -> bool:
        freq = len(re.findall(re.escape(term), full_text_lower))
        return (
            term in required_terms
            or freq >= config.critical_freq_threshold
            or term in title_lower
        )

    critical_missing = sorted(
        [t for t in still_missing if is_critical(t)],
        key=lambda t: (
            # False < True, so required terms sort before non-required
            t not in required_terms,
            # Negate so higher-frequency terms sort earlier within the same bucket
            -len(re.findall(re.escape(t), full_text_lower)),
        ),
    )

    # Stage 7: YOE analysis — runs independently of keyword matching
    yoe = analyze_yoe(structured, resume_text, config)

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
        yoe=yoe,
        embedding_calls=embedding_calls,
        structured_jd=structured,
    )