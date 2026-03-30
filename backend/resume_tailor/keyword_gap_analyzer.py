"""
keyword_gap_analyzer_v5.py  (v5.1 — phrase extraction overhaul)
===========================
Layer 2 of the gap analysis pipeline.

Fixes applied in this version:
  [FIX-1]  Dropped raw n-gram sweep entirely. Phrase extraction now uses
           spaCy noun chunks + protected tech token extraction only.
           Noun chunks are sentence-boundary-aware so fragments like
           ". solid understanding of" and "and safety alignment" are
           impossible by construction.

  [FIX-2]  Single-token unigram allowlist. A bare single word is only kept
           if it is a protected tech token (NLP, AWS, RAG, LangChain) or
           explicitly in _UNIGRAM_ALLOWLIST. Generic nouns like "like",
           "role", "fine", "cross", "degree" are no longer keyword candidates.

  [FIX-3]  Removed per-phrase _has_noun() calls. POS tags are already
           computed in the single spaCy pass over the full text. The noun
           check is now done inline from the noun_chunks iterator — zero
           extra spaCy pipeline runs.

  [FIX-4]  build_weighted_terms now extracts per-section and tags phrases
           at extraction time instead of doing substring membership checks
           on concatenated section text after the fact. This eliminates the
           double-multiplier bug where a phrase in both required and preferred
           got both boosts silently (2.0 × 1.3 = 2.6).

  [FIX-5]  _infer_experience_years now accepts experience_text (experience
           section only) instead of full resume_text, preventing education
           date ranges from inflating YOE. analyze_gap passes experience
           section text explicitly when available.

  [FIX-6]  Removed unused imports: defaultdict.
           Removed dead logger import that was never called anywhere.

  [FIX-7]  two_stage_semantic_match now returns embedding_calls as a third
           return value. analyze_gap no longer runs a second BM25 pass just
           to count calls — BM25 was running twice per request.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Set, Tuple

import numpy as np
import spacy
from sklearn.metrics.pairwise import cosine_similarity
from sentence_transformers import SentenceTransformer


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
    """Call once at application startup."""
    global _NLP, _EMBED_MODEL
    if _NLP is None:
        _NLP = spacy.load("en_core_web_sm", disable=["ner"])
    if _EMBED_MODEL is None:
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
        _EMBED_MODEL = SentenceTransformer("all-MiniLM-L6-v2")
    return _EMBED_MODEL


# ═══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class AnalyzerConfig:
    """All tuneable parameters for the gap-analysis pipeline.

    Section weights
    ---------------
    Multiplicative boosts applied to a phrase's base weight of 1.0.
    The structurer guarantees we KNOW which section a phrase came from.

    Phrase extraction
    -----------------
    max_noun_chunk_words: longest spaCy noun chunk to keep.
                          Replaces the old max_ngram — noun chunks only now.
    min_phrase_chars:     discard very short tokens.
    Unigram tech tokens are governed by _UNIGRAM_ALLOWLIST, not this config.

    Semantic matching
    -----------------
    semantic_threshold: minimum cosine similarity. 0.72 is strict to avoid
    false positives like "Python" matching "Jython".
    Required terms always get 0.0 credit — a semantic near-miss is still a gap.
    """
    # Section weights
    required_weight: float = 2.0
    preferred_weight: float = 1.3
    title_weight: float = 2.5

    # Frequency boost
    freq_boost_threshold: int = 2
    freq_boost_factor: float = 1.4
    freq_boost_cap: float = 3.0

    # Semantic matching
    semantic_threshold: float = 0.72
    semantic_credit_preferred: float = 0.65
    semantic_credit_general: float = 0.55

    # Two-stage retrieval
    bm25_top_k: int = 10
    max_embed_pairs: int = 500
    embed_batch_size: int = 64

    # Phrase extraction — [FIX-1] max_ngram replaced by max_noun_chunk_words
    max_noun_chunk_words: int = 6   # noun chunks only; no n-gram sweep
    min_phrase_chars: int = 4

    # Critical missing
    critical_freq_threshold: int = 3

    # YOE
    yoe_partial_threshold: float = 0.7


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
#  PHRASE EXTRACTION  [FIX-1, FIX-2, FIX-3]
#
#  Previous design problems:
#    - n-gram sweep had no sentence boundary awareness → produced fragments:
#      ". solid understanding of", "and safety alignment", "s or master"
#    - keep-filter (_has_noun) ran a full spaCy pipeline per candidate phrase —
#      400+ extra pipeline runs for a single JD
#    - frequency condition kept common connecting words: "like", "role", "fine",
#      "cross", "degree" that happened to appear 2+ times in JD text
#
#  New design:
#    1. Protected tech tokens extracted directly via regex from original text.
#       CamelCase, ALL-CAPS, hyphenated, dotted compounds → preserved intact.
#    2. spaCy noun chunks from a single full-text parse.
#       Noun chunks are sentence-boundary-aware by construction.
#    3. Single-word unigrams: only kept if protected tech token OR in allowlist.
#
#  Zero additional spaCy calls. [FIX-3]
# ═══════════════════════════════════════════════════════════════════════════════

# Allowlist for single-word unigram keywords.
# Only real skills, technologies, and domain concepts belong here.
# Generic connecting words (like, role, fine, cross, degree, tools, field,
# similar, strong, solid, excellent, knowledge, understanding) are NOT here.
#
# Rule: if you wouldn't put it as a standalone item on your resume Skills
# section, it doesn't belong in this list.
_UNIGRAM_ALLOWLIST: Set[str] = {
    # Languages
    "python", "java", "javascript", "typescript", "golang", "rust", "scala",
    "kotlin", "swift", "ruby", "php", "sql", "bash", "r",

    # ML / AI
    "pytorch", "tensorflow", "keras", "transformers", "bert",
    "gpt", "llama", "claude", "mistral", "gemini", "embeddings",
    "backpropagation", "autoencoder",

    # Data
    "pandas", "numpy", "matplotlib", "seaborn", "spark", "kafka", "airflow",
    "dbt", "superset", "tableau", "powerbi",

    # Infrastructure
    "docker", "kubernetes", "terraform", "ansible", "nginx", "redis",
    "rabbitmq", "celery", "elasticsearch", "opensearch", "grafana", "prometheus",

    # Databases
    "postgresql", "mysql", "mongodb", "cassandra", "dynamodb",
    "pinecone", "weaviate", "chroma", "faiss", "qdrant",

    # Cloud
    "aws", "gcp", "azure", "s3", "ec2", "lambda",

    # Practices
    "microservices", "serverless", "devops", "mlops", "llmops",
    "agile", "scrum", "cicd", "debugging", "profiling",

    # Soft-skill keywords used as standalone JD signals
    "leadership", "mentoring", "collaboration",
}
3088297

def extract_phrases(
    text: str,
    config: AnalyzerConfig = DEFAULT_CONFIG,
) -> List[str]:
    """Extract keyword phrases using two strategies, no n-gram sweep.  [FIX-1]

    Strategy 1 — Protected tech tokens (regex on original cased text):
      Extracts CamelCase, ALL-CAPS, hyphenated and dotted tech terms intact.
      Results are lowercased. Examples:
        LangChain → "langchain"   CI/CD → "ci/cd"   fine-tuning → "fine-tuning"

    Strategy 2 — spaCy noun chunks (single parse, sentence-aware):
      Noun phrases produced by spaCy's dependency parser. These respect
      sentence and clause boundaries — a chunk NEVER spans a comma or period.
      Chunks longer than max_noun_chunk_words are discarded.

    Unigram filtering [FIX-2]:
      Single-word candidates only kept if protected tech token OR in
      _UNIGRAM_ALLOWLIST. Eliminates: "like", "role", "fine", "cross",
      "degree", "tools", "field", "similar", "strong", "solid", etc.

    No per-phrase _has_noun() calls [FIX-3]:
      POS tagging done once in the full-text parse. Noun chunks are
      inherently noun-containing. Zero extra spaCy pipeline runs.
    """
    candidates: Set[str] = set()

    # ── Strategy 1: Protected tech tokens ────────────────────────────────────
    # Run on original (un-lowercased) text to preserve CamelCase identification.
    for m in _PROTECT_RE.finditer(text):
        tok = m.group(0).lower().strip()
        if len(tok) >= config.min_phrase_chars:
            candidates.add(tok)

    # ── Strategy 2: spaCy noun chunks ────────────────────────────────────────
    # Replace tech tokens with placeholders before spaCy to prevent splitting.
    # Single spaCy parse — no additional calls anywhere in this function.
    protected, mapping = _protect_tech(text.lower())
    doc = _nlp()(protected)

    for chunk in doc.noun_chunks:
        chunk_text = chunk.text.strip()
        # Restore any protected tokens that appeared inside this chunk
        for k, v in mapping.items():
            chunk_text = chunk_text.replace(k.lower(), v)
        chunk_text = re.sub(r"\s+", " ", chunk_text).strip()

        if len(chunk_text) < config.min_phrase_chars:
            continue
        if len(chunk_text.split()) > config.max_noun_chunk_words:
            continue
        candidates.add(chunk_text)

    # ── Unigram filter [FIX-2] ────────────────────────────────────────────────
    # Multi-word phrases (noun chunks) are always kept — sentence-safe.
    # Single-word candidates must be a protected tech token or in the allowlist.
    filtered: List[str] = []
    for phrase in candidates:
        if " " in phrase:
            filtered.append(phrase)
        elif bool(_PROTECT_RE.search(phrase)) or phrase in _UNIGRAM_ALLOWLIST:
            filtered.append(phrase)
        # else: generic single word → silently discard

    return filtered


def deduplicate_subphrases(phrases: List[str]) -> List[str]:
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
                suppressed.add(" ".join(words[i: i + n]))
    return kept


# ═══════════════════════════════════════════════════════════════════════════════
#  WEIGHTED TERM BUILDER  [FIX-4]
#
#  Previous design: extract phrases from full_jd_text once, then check
#  section membership via `if phrase in required_text_lower` after the fact.
#  Bug: a phrase appearing in both required AND preferred got both multipliers
#  simultaneously — 2.0 × 1.3 = 2.6 — with no documentation or control.
#
#  New design: extract phrases per-section, tag each phrase with its highest-
#  priority section at extraction time. Weight is applied exactly once.
#  Priority: required > preferred > other (required beats preferred when both).
# ═══════════════════════════════════════════════════════════════════════════════

def build_weighted_terms(
    structured: StructuredJD,
    config: AnalyzerConfig = DEFAULT_CONFIG,
) -> Tuple[Dict[str, float], Set[str]]:
    """Assign importance weights to every phrase extracted from the JD.

    Per-section extraction [FIX-4]:
      Phrases extracted separately from required, preferred, and other sections.
      Each phrase tagged with its originating section at extraction time.
      Weight applied exactly once — no double-multiplier.

    Weight formula (multiplicative, base 1.0):
      × freq_boost      if phrase appears ≥ freq_boost_threshold times in full JD
      × section_weight  exactly one of: required_weight / preferred_weight / 1.0
      × title_weight    additionally if phrase appears in the job title

    Returns:
      weights:        {phrase → float importance weight}
      required_terms: phrases from required section → get 0.0 semantic credit.
    """
    title_lower     = structured.title.lower()
    full_text_lower = structured.full_jd_text.lower()

    # tagged: phrase → highest-priority section label
    # Required beats preferred beats other — set only if not already tagged
    # at equal or higher priority.
    tagged: Dict[str, str] = {}

    def _extract_and_tag(section_text: str, label: str) -> None:
        phrases = deduplicate_subphrases(extract_phrases(section_text, config))
        for phrase in phrases:
            existing = tagged.get(phrase)
            # Priority order: required(0) > preferred(1) > other(2)
            priority = {"required": 0, "preferred": 1, "other": 2}
            if existing is None or priority[label] < priority[existing]:
                tagged[phrase] = label

    _extract_and_tag(structured.required_text,         "required")
    _extract_and_tag(structured.preferred_text,        "preferred")
    _extract_and_tag(structured.responsibilities_text, "other")
    for item in structured.about + structured.other:
        _extract_and_tag(item, "other")

    weights: Dict[str, float] = {}
    required_terms: Set[str] = set()

    for phrase, section_label in tagged.items():
        if len(phrase) < config.min_phrase_chars:
            continue

        weight = 1.0

        # Frequency boost — importance scales with how often JD mentions this
        count = len(re.findall(re.escape(phrase), full_text_lower))
        if count >= config.freq_boost_threshold:
            extra    = min(count - config.freq_boost_threshold, 5)
            freq_mult = min(
                1.0 + extra * (config.freq_boost_factor - 1.0),
                config.freq_boost_cap,
            )
            weight *= freq_mult

        # Section weight — applied exactly once [FIX-4]
        if section_label == "required":
            weight *= config.required_weight
            required_terms.add(phrase)
        elif section_label == "preferred":
            weight *= config.preferred_weight
        # "other" → no section multiplier

        # Title boost — independent of section
        if phrase in title_lower:
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
) -> Tuple[List[SemanticMatch], List[str], int]:   # [FIX-7] added int
    """Find semantic matches for JD terms not found verbatim in the resume.

    Stage 1 (BM25): shortlist resume candidates per JD term.
    Stage 2 (embeddings): cosine similarity on shortlisted pairs only.

    Returns:
      (matched, still_unmatched, embedding_calls)  [FIX-7]
      embedding_calls = number of unique texts encoded. Returned here so
      analyze_gap doesn't need a second BM25 pass to count them.
    """
    if not unmatched or not resume_phrases:
        return [], unmatched, 0

    candidates = bm25_candidates(unmatched, resume_phrases, top_k=config.bm25_top_k)

    unique_jd = set(candidates.keys())
    unique_resume: Set[str] = set()
    for phrases in candidates.values():
        unique_resume.update(phrases)

    if not unique_jd:
        return [], unmatched, 0

    # Hard cap on embedding pairs to bound latency
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

    jd_list  = list(unique_jd)
    res_list = list(unique_resume)
    # Single batch call — concatenate so encoder batches most efficiently
    all_vecs = embed(jd_list + res_list)
    jd_vecs  = {t: all_vecs[i]               for i, t in enumerate(jd_list)}
    res_vecs = {p: all_vecs[len(jd_list) + i] for i, p in enumerate(res_list)}

    embedding_calls = len(jd_list) + len(res_list)  # [FIX-7] count here

    matched: List[SemanticMatch] = []
    matched_set: Set[str] = set()

    for term, cands in candidates.items():
        t_vec  = jd_vecs[term].reshape(1, -1)
        c_vecs = np.array([res_vecs[p] for p in cands])
        sims   = cosine_similarity(t_vec, c_vecs)[0]
        best_idx = int(np.argmax(sims))
        best_sim = float(sims[best_idx])

        if best_sim >= config.semantic_threshold:
            is_req = term in required_terms
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

    still_missing = [t for t in unmatched if t not in matched_set]
    return matched, still_missing, embedding_calls  # [FIX-7]


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
    """True if the YOE context is too vague for specific skill matching.

    Either it's in the known vague-phrase set OR it's very short (≤ 2 words).
    The set catches known phrases; the length check catches novel vague phrasings.
    """
    return ctx.lower().strip() in _GENERIC_YOE_CONTEXTS or len(ctx.split()) <= 2


_CURRENT_YEAR = 2025


def _infer_experience_years(experience_text: str) -> int:   # [FIX-5]
    """Estimate work experience span from experience section text ONLY.

    [FIX-5] Takes experience_text, NOT full resume_text.
    Passing full resume text caused education date ranges (e.g. B.Tech 2019-2023)
    to inflate the inferred career span — same bug fixed in extraction.py.

    Handles "Present"/"Current" by substituting _CURRENT_YEAR as end year.
    Returns 0 if fewer than two distinct year mentions are found.
    """
    text_lower = experience_text.lower()
    has_present = any(
        w in text_lower for w in ("present", "current", "ongoing")
    )
    years = [int(y) for y in re.findall(r"\b(19[89]\d|20[012]\d)\b", experience_text)]
    if not years:
        return 0
    max_year = _CURRENT_YEAR if has_present else max(years)
    return max_year - min(years)


def analyze_yoe(
    structured: StructuredJD,
    resume_text: str,
    config: AnalyzerConfig = DEFAULT_CONFIG,
    experience_text: Optional[str] = None,   # [FIX-5]
) -> YOEResult:
    """Compare JD YOE requirements against the resume.

    Args:
        structured:       Parsed JD.
        resume_text:      Full resume text (for explicit YOE claim scanning).
        config:           Scoring configuration.
        experience_text:  Work experience section text only [FIX-5].
                          If provided, used for date-span inference instead of
                          full resume text. Pass sectioned_resume.section_text(
                          ResumeSection.EXPERIENCE) when available.
                          Falls back to full resume text if not provided.
    """
    # Extract JD requirements (required section first, then full JD for completeness)
    yoe_source = structured.required_text + " " + structured.full_jd_text
    reqs: List[YOERequirement] = []
    seen: Set[str] = set()

    for m in _YOE_JD_RE.finditer(yoe_source):
        years = int(m.group(1))
        ctx   = (m.group(2) or "").strip().lower()
        raw   = m.group(0).strip()
        key   = f"{years}:{ctx}"
        if years > 0 and key not in seen:
            seen.add(key)
            reqs.append(YOERequirement(
                years=years, context=ctx, raw_text=raw,
                is_generic=_is_generic_context(ctx),
            ))

    # Build map of explicit YOE claims from full resume text
    resume_lower = resume_text.lower()
    resume_claims: Dict[str, int] = {}
    for m in _YOE_RESUME_RE.finditer(resume_lower):
        years = int(m.group(1))
        ctx   = (m.group(2) or "").strip().lower()
        if ctx:
            resume_claims[ctx] = max(resume_claims.get(ctx, 0), years)

    # [FIX-5] Use experience section text for date-span inference if provided
    infer_text = experience_text if experience_text else resume_text
    date_years = _infer_experience_years(infer_text)

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

        best = max(
            (v for k, v in resume_claims.items()
             if req.context in k or k in req.context),
            default=0,
        )
        ctx_present = req.context.split()[0] in resume_lower if req.context else False

        if best >= req.years:
            satisfied.append(req)
        elif best >= req.years * config.yoe_partial_threshold:
            partial.append((req, best))
        elif ctx_present and date_years >= req.years:
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
    experience_text: Optional[str] = None,   # [FIX-5]
) -> GapAnalysisResult:
    """Core gap analysis. Accepts a pre-parsed StructuredJD, not raw text.

    Format-agnostic — all section detection and JD parsing happened upstream
    in jd_structurer.py. This function only cares about what is required/preferred.

    Args:
        structured:       Output of jd_structurer.structure_jd().
        resume_text:      Raw resume text.
        config:           Scoring thresholds and weights.
        embed_fn:         Optional custom embedding function (for testing).
        use_semantic:     Set False to skip embedding (faster bulk screening).
        experience_text:  Work experience section text for YOE inference [FIX-5].
                          Pass sectioned_resume.section_text(ResumeSection.EXPERIENCE)
                          from ats_scorer when available. Prevents education dates
                          inflating YOE. Falls back to full resume if None.
    """
    # When the pipeline ran LLM skill extraction, structured.skills contains
    # pre-classified {"name", "required", "gap"} entries. Use those directly —
    # they are clean skill entities with no noise words. Fall back to NLP
    # extraction (stages 1-4) only when skills are not available.
    if structured.skills:
        jd_weights: Dict[str, float] = {}
        required_terms: Set[str] = set()
        exact_matches: List[str] = []
        semantic_matches: List[SemanticMatch] = []
        still_missing: List[str] = []

        for skill in structured.skills:
            name     = skill["name"]
            name_lc  = name.lower()
            is_req   = skill["required"]
            gap      = skill.get("gap", "missing")

            weight = config.required_weight if is_req else config.preferred_weight
            jd_weights[name_lc] = weight
            if is_req:
                required_terms.add(name_lc)

            if gap == "demonstrated":
                exact_matches.append(name_lc)
            elif gap == "partial":
                semantic_matches.append(SemanticMatch(
                    jd_term=name_lc,
                    resume_phrase=name_lc,
                    similarity=0.5,
                    credit_fraction=config.semantic_credit_preferred,
                ))
            else:
                still_missing.append(name)  # keep original case for display

        embedding_calls = 0  # no embedding calls made — LLM handled matching

    else:
        # Stage 1: Build weighted term map — per-section extraction [FIX-4]
        jd_weights, required_terms = build_weighted_terms(structured, config)
        jd_terms = list(jd_weights.keys())

        # Stage 2: Extract resume phrases
        resume_phrases = deduplicate_subphrases(extract_phrases(resume_text, config))
        resume_lower   = resume_text.lower()

        # Stage 3: Exact matching (lazy import avoids circular dependency with ats_scorer)
        from .ats_scorer import _get_all_variants, ATSConfig  # noqa: PLC0415
        _ats_cfg = ATSConfig()
        exact_matches: List[str] = []
        unmatched: List[str] = []
        for term in jd_terms:
            variants = _get_all_variants(term, _ats_cfg)
            if any(v in resume_lower for v in variants):
                exact_matches.append(term)
            else:
                unmatched.append(term)

        # Stage 4: Two-stage semantic matching — embedding_calls returned directly [FIX-7]
        embedding_calls = 0
        semantic_matches: List[SemanticMatch] = []
        still_missing = unmatched

        if use_semantic and unmatched:
            # [FIX-7] Unpack three values — no second BM25 pass needed
            semantic_matches, still_missing, embedding_calls = two_stage_semantic_match(
                unmatched, resume_phrases, required_terms, config, embed_fn
            )

    # Stage 5: Weighted coverage score
    total_weight   = sum(jd_weights.values())
    matched_weight = sum(jd_weights[t] for t in exact_matches)
    for sm in semantic_matches:
        matched_weight += jd_weights.get(sm.jd_term, 1.0) * sm.credit_fraction
    coverage = round(
        (matched_weight / total_weight) * 100, 2
    ) if total_weight > 0 else 100.0

    # Stage 6: Classify missing terms
    full_text_lower      = structured.full_jd_text.lower()
    required_text_lower  = structured.required_text.lower()
    preferred_text_lower = structured.preferred_text.lower()
    title_lower          = structured.title.lower()

    if structured.skills:
        # LLM path: use required/preferred flags from the skill dict directly
        skill_req_set  = {s["name"].lower() for s in structured.skills if s["required"]}
        skill_pref_set = {s["name"].lower() for s in structured.skills if not s["required"]}
        required_missing  = [t for t in still_missing if t.lower() in skill_req_set]
        preferred_missing = [t for t in still_missing if t.lower() in skill_pref_set]
        critical_missing  = required_missing  # all required gaps are critical by definition
    else:
        required_missing  = [t for t in still_missing if t in required_text_lower]
        preferred_missing = [
            t for t in still_missing
            if t in preferred_text_lower and t not in required_text_lower
        ]

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
                t not in required_terms,
                -len(re.findall(re.escape(t), full_text_lower)),
            ),
        )

    # Stage 7: YOE analysis — passes experience_text for accurate inference [FIX-5]
    yoe = analyze_yoe(structured, resume_text, config, experience_text)

    return GapAnalysisResult(
        coverage_score=coverage,
        total_concepts=len(jd_weights),
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
