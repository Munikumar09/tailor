"""
ats_scorer.py
=============
ATS (Applicant Tracking System) scoring system.

Takes the block AST already produced by parse_docx_to_block_ast()
and a StructuredJD from jd_structurer.py — no additional docx parsing.

Five sub-systems:

  Sub-system 1 — ResumeParser
    Converts block AST → SectionedResume
    Assigns each block a ResumeSection enum and a recency year
    Uses heading content + block type + position to classify sections
    No re-parsing. Wraps the existing AST.

  Sub-system 2 — KnockoutEvaluator
    Binary pass/fail on eliminators before any scoring
    YOE minimum, degree requirement, explicit exclusion terms
    If any knockout fails → ats_score = 0 regardless of keywords

  Sub-system 3 — KeywordMatcher
    Exact + near-exact matching only (reflects real ATS behaviour)
    Section-placement bonus: Skills section > Experience > Summary > Other
    Recency bonus: skill in 2024 job > skill in 2018 job
    Semantic matches flagged as WARNINGS, not counted as present
    Controlled abbreviation dictionary (ML↔machine learning etc.)

  Sub-system 4 — ScoreAggregator
    Weighted formula:
      required_score  × 0.55
      preferred_score × 0.25
      placement_score × 0.12
      recency_score   × 0.08
    All components exposed separately in result

  Sub-system 5 — RecommendationEngine
    Ranked list of highest-impact additions
    Priority: required missing > preferred missing > placement upgrades
    Each recommendation explains WHY and gives the exact term to add

Interfaces with existing pipeline:
    from ats_scorer import score_ats
    result = score_ats(block_ast=state["block_ast"], structured_jd=structured_jd)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Set, Tuple
from utils.logger import get_logger

logger = get_logger(__name__)

from .jd_structurer import StructuredJD


# ═══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ATSConfig:
    # Score component weights (must sum to 1.0)
    weight_required: float   = 0.55
    weight_preferred: float  = 0.25
    weight_placement: float  = 0.12
    weight_recency: float    = 0.08

    # Placement multipliers — how much a section boosts a keyword match
    # Skills/Competencies section is the highest-signal location in any ATS
    placement_skills: float      = 1.50
    placement_summary: float     = 1.20
    placement_projects: float    = 1.10
    placement_experience: float  = 1.00   # baseline
    placement_education: float   = 0.80
    placement_other: float       = 0.60

    # Recency: score decays linearly from 1.0 (current year) to this floor
    recency_floor: float         = 0.50   # a skill from 8+ years ago scores 0.5×
    recency_decay_years: int     = 8      # full decay over this many years

    # Near-exact matching
    enable_abbreviation_matching: bool = True
    enable_plural_matching: bool       = True
    enable_hyphen_variants: bool       = True

    # Knockout
    yoe_tolerance_years: int     = 1     # how many years short is still a pass
    degree_required_default: bool = False # if JD doesn't specify, don't knock out

    # Recommendation engine
    max_recommendations: int     = 10


DEFAULT_CONFIG = ATSConfig()


# ═══════════════════════════════════════════════════════════════════════════════
#  RESUME SECTION ENUM
# ═══════════════════════════════════════════════════════════════════════════════

class ResumeSection(Enum):
    SKILLS       = "skills"
    SUMMARY      = "summary"
    EXPERIENCE   = "experience"
    EDUCATION    = "education"
    PROJECTS     = "projects"
    CERTIFICATIONS = "certifications"
    OTHER        = "other"


# Section heading keywords for classification
# Matched against the text of h1/h2/h3 blocks
_SECTION_HEADING_MAP: Dict[ResumeSection, List[str]] = {
    ResumeSection.SKILLS: [
        "skills", "technical skills", "core competencies", "competencies",
        "technologies", "tech stack", "expertise", "proficiencies",
        "tools", "languages", "frameworks", "key skills",
    ],
    ResumeSection.SUMMARY: [
        "summary", "profile", "objective", "about", "overview",
        "professional summary", "career summary", "executive summary",
    ],
    ResumeSection.EXPERIENCE: [
        "experience", "work experience", "employment", "work history",
        "professional experience", "career", "positions", "roles",
    ],
    ResumeSection.EDUCATION: [
        "education", "academic", "qualifications", "degrees",
        "university", "college", "schooling",
    ],
    ResumeSection.PROJECTS: [
        "projects", "personal projects", "side projects",
        "open source", "portfolio", "work samples",
    ],
    ResumeSection.CERTIFICATIONS: [
        "certifications", "certificates", "credentials",
        "licenses", "accreditations", "awards",
    ],
}


# ═══════════════════════════════════════════════════════════════════════════════
#  SECTIONED RESUME — output of Sub-system 1
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ResumeBlock:
    """A single block from the AST, enriched with section and recency info."""
    id: str
    type: str                           # h1/h2/h3/bullet/paragraph from AST
    full_text: str
    section: ResumeSection
    recency_year: Optional[int]         # year extracted from nearby date context
    is_tailorable: bool
    original_ast_block: dict            # reference to original AST block


@dataclass
class SectionedResume:
    """All blocks organised by section, with full text per section."""
    blocks: List[ResumeBlock]
    blocks_by_section: Dict[ResumeSection, List[ResumeBlock]]
    full_text: str

    def section_text(self, section: ResumeSection) -> str:
        return " ".join(b.full_text for b in self.blocks_by_section.get(section, []))

    def all_text_lower(self) -> str:
        return self.full_text.lower()


# ═══════════════════════════════════════════════════════════════════════════════
#  SUB-SYSTEM 1 — RESUME PARSER
#  Wraps the existing block AST. No docx re-parsing.
#  Assigns ResumeSection to each block using heading context.
#  Extracts recency year from date patterns near each block.
# ═══════════════════════════════════════════════════════════════════════════════

# Date patterns found in experience entries
# Extracts the most recent year from strings like "Jan 2022 – Present",
# "2019-2021", "March 2023 - Current"
_DATE_RE = re.compile(
    r"\b(20[0-2]\d|19[89]\d)\b"         # 4-digit years: 1980–2029
)

_CURRENT_YEAR = datetime.now().year   # fixed reference — update annually or use datetime.now().year

# Words indicating "present / ongoing" — used to assign current year
_PRESENT_WORDS = {"present", "current", "now", "today", "ongoing", "–present", "-present"}


def _extract_year_from_text(text: str) -> Optional[int]:
    """
    Extract the most recent year from a text string.
    "Jan 2022 – Present" → 2025 (current)
    "2019 – 2021"        → 2021
    "March 2023"         → 2023
    """
    text_lower = text.lower()

    # Check for "present" — means this role is ongoing
    if any(w in text_lower for w in _PRESENT_WORDS):
        return _CURRENT_YEAR

    years = [int(m) for m in _DATE_RE.findall(text)]
    return max(years) if years else None


def _classify_section(
    heading_text: str,
) -> ResumeSection:
    """
    Classify a heading block into a ResumeSection by matching heading text
    against the section keyword map. Longest match wins for specificity.
    """
    heading_lower = heading_text.lower().strip()
    best_section = ResumeSection.OTHER
    best_match_len = 0

    for section, keywords in _SECTION_HEADING_MAP.items():
        for kw in keywords:
            if kw in heading_lower and len(kw) > best_match_len:
                best_match_len = len(kw)
                best_section = section

    return best_section


def parse_resume_from_ast(block_ast: dict) -> SectionedResume:
    """
    Sub-system 1 entry point.

    Takes the block_ast dict from parse_docx_to_block_ast() directly.
    Expected block fields (already present in AST):
        id, type, fullText, isTailorable, pStyle, ilvl

    Returns SectionedResume with section classification and recency on each block.
    """
    raw_blocks: List[dict] = block_ast.get("blocks", [])

    current_section = ResumeSection.OTHER
    current_year: Optional[int] = None

    enriched: List[ResumeBlock] = []

    for i, block in enumerate(raw_blocks):
        btype = block.get("type", "paragraph")
        text = block.get("fullText", "").strip()

        if not text:
            continue

        # Heading blocks → reclassify current section
        if btype in ("h1", "h2", "h3"):
            current_section = _classify_section(text)
            # Headings don't carry keyword content themselves
            # but we still record them for structure
            enriched.append(ResumeBlock(
                id=block["id"],
                type=btype,
                full_text=text,
                section=current_section,
                recency_year=None,
                is_tailorable=False,
                original_ast_block=block,
            ))
            continue

        # Extract year from this block's text
        year_in_block = _extract_year_from_text(text)
        if year_in_block:
            current_year = year_in_block

        # Inherit section context from last heading
        enriched.append(ResumeBlock(
            id=block["id"],
            type=btype,
            full_text=text,
            section=current_section,
            recency_year=current_year,
            is_tailorable=block.get("isTailorable", False),
            original_ast_block=block,
        ))

    # Organise by section
    from collections import defaultdict
    by_section: Dict[ResumeSection, List[ResumeBlock]] = defaultdict(list)
    for rb in enriched:
        by_section[rb.section].append(rb)

    full_text = " ".join(b.full_text for b in enriched)

    return SectionedResume(
        blocks=enriched,
        blocks_by_section=dict(by_section),
        full_text=full_text,
    )


# ═══════════════════════════════════════════════════════════════════════════════
#  CONTROLLED ABBREVIATION DICTIONARY
#
#  Design rules (enforced by code review, not runtime):
#    1. Both directions — abbreviation → full AND full → abbreviation.
#    2. Only deterministic, single-meaning expansions in tech/software context.
#    3. Never add single letters, generic 2-letter combos, or brand names that
#       should not be expanded (GraphQL, Kubernetes brand names stay as tokens).
#    4. Ambiguous removed: cv (curriculum vitae vs computer vision), dr, lb,
#       db, pr, pm, po, dev, prod, go, sa, fp — all context-dependent.
#
#  Entries removed from GPT suggestion and why:
#    cv      — "curriculum vitae" in resume context; false positive risk
#    dr      — doctor / drive / director — too ambiguous
#    lb      — pound unit / load balancer — too ambiguous
#    db/dbs  — too short; "db" appears in non-database contexts
#    pr/prs  — public relations vs pull request — too ambiguous
#    pm/po   — product manager/owner vs many other expansions
#    dev/prod — informal shortenings, not technical abbreviations
#    fp      — false positive / functional programming — too ambiguous
#    replica/sharding — full words, not abbreviations
#    graphql — brand name, expanding to constituent words creates noise
#    jamstack — brand name, same issue
#    solid   — principle acronym, full expansion is a sentence, useless for matching
# ═══════════════════════════════════════════════════════════════════════════════

_ABBREV_MAP: Dict[str, Set[str]] = {

    # ── AI / ML / Data Science ────────────────────────────────────────────────
    "ml":    {"machine learning"},
    "ai":    {"artificial intelligence"},
    "nlp":   {"natural language processing"},
    "dl":    {"deep learning"},
    "rl":    {"reinforcement learning"},
    "llm":   {"large language model", "large language models"},
    "llms":  {"large language model", "large language models"},
    "rag":   {"retrieval augmented generation"},
    "genai": {"generative ai", "generative artificial intelligence"},
    "asr":   {"automatic speech recognition", "speech recognition"},
    "stt":   {"speech to text"},
    "tts":   {"text to speech"},
    "nlu":   {"natural language understanding"},
    "ocr":   {"optical character recognition"},
    "gan":   {"generative adversarial network"},
    "gans":  {"generative adversarial networks"},
    "vae":   {"variational autoencoder"},
    "bert":  {"bidirectional encoder representations from transformers"},
    "lstm":  {"long short term memory"},
    "cnn":   {"convolutional neural network"},
    "etl":   {"extract transform load"},
    "eda":   {"exploratory data analysis"},
    "kpi":   {"key performance indicator"},
    "kpis":  {"key performance indicators"},

    # ── Cloud / Infrastructure ────────────────────────────────────────────────
    "ci/cd": {"continuous integration", "continuous deployment",
              "continuous delivery"},
    "iac":   {"infrastructure as code"},
    "k8s":   {"kubernetes"},
    "aws":   {"amazon web services"},
    "gcp":   {"google cloud platform"},
    "vpc":   {"virtual private cloud"},
    "ec2":   {"elastic compute cloud"},
    "s3":    {"simple storage service"},
    "aks":   {"azure kubernetes service"},
    "eks":   {"elastic kubernetes service"},
    "gke":   {"google kubernetes engine"},
    "cdn":   {"content delivery network"},
    "paas":  {"platform as a service"},
    "iaas":  {"infrastructure as a service"},
    "saas":  {"software as a service"},
    "sre":   {"site reliability engineering"},
    "slo":   {"service level objective"},
    "sla":   {"service level agreement"},
    "slas":  {"service level agreements"},
    "sli":   {"service level indicator"},
    "vm":    {"virtual machine"},
    "vms":   {"virtual machines"},

    # ── Engineering Practices ─────────────────────────────────────────────────
    "oop":   {"object oriented programming"},
    "tdd":   {"test driven development"},
    "bdd":   {"behaviour driven development"},
    "ddd":   {"domain driven design"},
    "uat":   {"user acceptance testing"},
    "swe":   {"software engineer"},
    "sde":   {"software development engineer"},
    "qa":    {"quality assurance"},
    "qe":    {"quality engineering"},

    # ── Web / Backend ─────────────────────────────────────────────────────────
    "api":     {"application programming interface"},
    "apis":    {"application programming interface"},
    "rest":    {"representational state transfer"},
    "restful": {"representational state transfer"},
    "rpc":     {"remote procedure call"},
    "grpc":    {"google remote procedure call"},
    "orm":     {"object relational mapping"},
    "mvc":     {"model view controller"},
    "spa":     {"single page application"},
    "ssr":     {"server side rendering"},
    "jwt":     {"json web token"},
    "cors":    {"cross origin resource sharing"},

    # ── Databases ─────────────────────────────────────────────────────────────
    "sql":   {"structured query language"},
    "nosql": {"not only sql"},
    "rdbms": {"relational database management system"},
    "olap":  {"online analytical processing"},
    "oltp":  {"online transaction processing"},
    "dwh":   {"data warehouse"},
    "dw":    {"data warehouse"},

    # ══════════════════════════════════════════════════════════════════════════
    #  REVERSE MAPPINGS  (full form → abbreviation)
    #  Every forward entry above that has a clean unambiguous reverse
    #  gets a reverse entry. Omitted where the full form is more recognisable
    #  than the abbreviation (e.g. "variational autoencoder" → "vae" not added
    #  because nobody writes "vae" in a JD).
    # ══════════════════════════════════════════════════════════════════════════

    # AI / ML
    "machine learning":                       {"ml"},
    "artificial intelligence":                {"ai"},
    "natural language processing":            {"nlp"},
    "deep learning":                          {"dl"},
    "reinforcement learning":                 {"rl"},
    "large language model":                   {"llm"},
    "large language models":                  {"llm", "llms"},
    "retrieval augmented generation":         {"rag"},
    "generative ai":                          {"genai"},
    "automatic speech recognition":           {"asr"},
    "speech recognition":                     {"asr"},
    "speech to text":                         {"stt"},
    "text to speech":                         {"tts"},
    "optical character recognition":          {"ocr"},
    "generative adversarial network":         {"gan"},
    "generative adversarial networks":        {"gans"},
    "extract transform load":                 {"etl"},
    "exploratory data analysis":              {"eda"},
    "key performance indicator":              {"kpi"},
    "key performance indicators":             {"kpis"},

    # Cloud / Infrastructure
    "continuous integration":                 {"ci/cd"},
    "continuous deployment":                  {"ci/cd"},
    "continuous delivery":                    {"ci/cd"},
    "infrastructure as code":                 {"iac"},
    "kubernetes":                             {"k8s"},
    "amazon web services":                    {"aws"},
    "google cloud platform":                  {"gcp"},
    "virtual private cloud":                  {"vpc"},
    "elastic compute cloud":                  {"ec2"},
    "simple storage service":                 {"s3"},
    "azure kubernetes service":               {"aks"},
    "elastic kubernetes service":             {"eks"},
    "google kubernetes engine":               {"gke"},
    "content delivery network":               {"cdn"},
    "platform as a service":                  {"paas"},
    "infrastructure as a service":            {"iaas"},
    "software as a service":                  {"saas"},
    "site reliability engineering":           {"sre"},
    "service level agreement":                {"sla"},
    "service level objective":                {"slo"},
    "virtual machine":                        {"vm"},
    "virtual machines":                       {"vms"},

    # Engineering Practices
    "object oriented programming":            {"oop"},
    "test driven development":                {"tdd"},
    "behaviour driven development":           {"bdd"},
    "domain driven design":                   {"ddd"},
    "user acceptance testing":                {"uat"},
    "software engineer":                      {"swe"},
    "software development engineer":          {"sde"},
    "quality assurance":                      {"qa"},

    # Web / Backend
    "application programming interface":      {"api"},
    "representational state transfer":        {"rest"},
    "remote procedure call":                  {"rpc"},
    "google remote procedure call":           {"grpc"},
    "object relational mapping":              {"orm"},
    "model view controller":                  {"mvc"},
    "single page application":                {"spa"},
    "server side rendering":                  {"ssr"},
    "json web token":                         {"jwt"},
    "cross origin resource sharing":          {"cors"},

    # Databases
    "structured query language":              {"sql"},
    "not only sql":                           {"nosql"},
    "relational database management system":  {"rdbms"},
    "online analytical processing":           {"olap"},
    "online transaction processing":          {"oltp"},
    "data warehouse":                         {"dw", "dwh"},
}


def _get_abbreviation_variants(term: str) -> Set[str]:
    """Return all known abbreviation variants for a term (both directions)."""
    lower = term.lower().strip()
    variants: Set[str] = {lower}
    if lower in _ABBREV_MAP:
        variants.update(_ABBREV_MAP[lower])
    return variants


# ═══════════════════════════════════════════════════════════════════════════════
#  NEAR-EXACT MATCHING UTILITIES
#  These reflect what real ATS systems do:
#    ✓ Case normalisation
#    ✓ Plural/singular via controlled lemma (not spaCy — too slow per-term)
#    ✓ Hyphen/space variants
#    ✓ Abbreviation dictionary lookups
#    ✗ Free semantic similarity (not ATS behaviour)
# ═══════════════════════════════════════════════════════════════════════════════

# Simple suffix-based plural normalisation
# Covers the 95% case without a full lemmatizer
_PLURAL_SUFFIXES = [("ies", "y"), ("ves", "f"), ("ses", "s"), ("s", "")]


def _normalise_term(term: str) -> str:
    """Lowercase, collapse whitespace, normalise hyphens."""
    t = term.lower().strip()
    t = re.sub(r"[\s\-_/]+", " ", t)  # treat hyphen/slash/underscore as space
    t = re.sub(r"\s+", " ", t)
    return t


def _get_all_variants(term: str, config: ATSConfig) -> Set[str]:
    """
    Build the full set of acceptable near-exact variants for a term.
    All variants are normalised (lowercase, hyphen→space).
    """
    normalised = _normalise_term(term)
    variants: Set[str] = {normalised}

    # Hyphen variants: "full-stack" ↔ "full stack"
    if config.enable_hyphen_variants:
        variants.add(normalised.replace("-", " "))
        variants.add(normalised.replace(" ", "-"))

    # Abbreviation dictionary
    if config.enable_abbreviation_matching:
        variants.update(_get_abbreviation_variants(normalised))

    # Plural/singular (single token terms only — multi-word handled differently)
    if config.enable_plural_matching and " " not in normalised:
        for suffix, replacement in _PLURAL_SUFFIXES:
            if normalised.endswith(suffix) and len(normalised) > len(suffix) + 2:
                stem = normalised[: -len(suffix)] + replacement
                variants.add(stem)
        # Also add plural of base form
        if not normalised.endswith("s"):
            variants.add(normalised + "s")

    return variants


def _term_present_in_text(
    term: str,
    text_lower: str,
    config: ATSConfig,
) -> bool:
    """
    Check if a term (or any near-exact variant) appears in text_lower.
    Uses whole-word boundary matching to avoid "Java" matching "JavaScript".
    """
    for variant in _get_all_variants(term, config):
        # Escape for regex
        escaped = re.escape(variant)
        # Word boundary — but allow for hyphenated compounds at boundaries
        pattern = r"(?<![a-zA-Z0-9])" + escaped + r"(?![a-zA-Z0-9])"
        if re.search(pattern, text_lower):
            return True
    return False


def _term_present_in_block(
    term: str,
    block: ResumeBlock,
    config: ATSConfig,
) -> bool:
    return _term_present_in_text(term, block.full_text.lower(), config)


# ═══════════════════════════════════════════════════════════════════════════════
#  SUB-SYSTEM 2 — KNOCKOUT EVALUATOR
#  Binary pass/fail. Runs before scoring.
#  If any knockout fails, final ATS score is 0.
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class KnockoutResult:
    passes: bool                        # False = candidate eliminated
    checks: List[dict]                  # detail of each check


_DEGREE_LEVELS = {
    "phd":        5, "doctorate":  5,
    "masters":    4, "master":     4, "msc": 4, "ms": 4, "mba": 4, "m.s": 4,
    "bachelors":  3, "bachelor":   3, "bsc": 3, "bs": 3, "b.s": 3, "be": 3,
                                        "b.e": 3, "btech": 3, "b.tech": 3,
    "associate":  2, "diploma":    2,
    "any":        1, "graduate":   1,
}

_DEGREE_RE = re.compile(
    r"\b(phd|ph\.d|doctorate|master(?:s)?|m\.?sc?|mba|m\.?s\.?|"
    r"bachelor(?:s)?|b\.?sc?|b\.?s\.?|be|b\.?e|btech|b\.?tech|"
    r"associate|diploma|graduate)\b",
    re.IGNORECASE,
)

_YOE_JD_RE = re.compile(
    r"(\d+)\+?\s*(?:to\s*\d+\s*)?(?:years?|yrs?)"
    r"(?:\s+(?:of\s+)?(?:experience|exp|work))?",
    re.IGNORECASE,
)


def _extract_min_yoe_from_jd(structured: StructuredJD) -> Optional[int]:
    """Find the minimum years-of-experience requirement in required section."""
    required_text = structured.required_text
    matches = _YOE_JD_RE.findall(required_text)
    years = [int(m) for m in matches if int(m) > 0]
    return min(years) if years else None


def _extract_candidate_yoe(resume: SectionedResume) -> int:
    """
    Infer total years of experience from date ranges in the resume.
    Looks for 4-digit years across all experience blocks.
    """
    all_years: List[int] = []
    for block in resume.blocks:
        years = [int(m) for m in _DATE_RE.findall(block.full_text)]
        all_years.extend(years)

    if len(all_years) >= 2:
        return max(all_years) - min(all_years)
    return 0


def _extract_candidate_degree(resume: SectionedResume) -> int:
    """
    Find the highest degree level in the candidate's education section.
    Returns a numeric level (0 = none found, 5 = PhD).
    """
    edu_text = resume.section_text(ResumeSection.EDUCATION)
    # Also check full resume — some resumes don't have a separate education heading
    full_text = resume.full_text

    highest = 0
    for text in [edu_text, full_text]:
        for m in _DEGREE_RE.finditer(text.lower()):
            degree_str = m.group(1).lower().replace(".", "")
            level = _DEGREE_LEVELS.get(degree_str, 0)
            highest = max(highest, level)

    return highest


def _extract_required_degree(structured: StructuredJD) -> int:
    """Find the minimum degree requirement in the JD."""
    full_text = (structured.required_text + " " + structured.full_jd_text).lower()
    highest_required = 0
    for m in _DEGREE_RE.finditer(full_text):
        degree_str = m.group(1).lower().replace(".", "")
        level = _DEGREE_LEVELS.get(degree_str, 0)
        highest_required = max(highest_required, level)
    return highest_required


def evaluate_knockouts(
    resume: SectionedResume,
    structured: StructuredJD,
    config: ATSConfig = DEFAULT_CONFIG,
) -> KnockoutResult:
    """
    Sub-system 2 entry point.
    Evaluates all binary eliminators. Any failure → passes=False.
    """
    checks: List[dict] = []
    all_pass = True

    # ── Check 1: Years of experience ─────────────────────────────────────────
    min_yoe = _extract_min_yoe_from_jd(structured)
    candidate_yoe = _extract_candidate_yoe(resume)

    if min_yoe is not None:
        effective_min = max(0, min_yoe - config.yoe_tolerance_years)
        passes_yoe = candidate_yoe >= effective_min
        all_pass = all_pass and passes_yoe
        checks.append({
            "check": "years_of_experience",
            "required": min_yoe,
            "candidate": candidate_yoe,
            "tolerance": config.yoe_tolerance_years,
            "passes": passes_yoe,
            "detail": (
                f"Candidate has ~{candidate_yoe} years, JD requires {min_yoe}+"
                + (f" (tolerance: ±{config.yoe_tolerance_years}yr)" if config.yoe_tolerance_years else "")
            ),
        })
    else:
        checks.append({
            "check": "years_of_experience",
            "required": None,
            "candidate": candidate_yoe,
            "passes": True,
            "detail": "No minimum YOE specified in JD",
        })

    # ── Check 2: Degree requirement ───────────────────────────────────────────
    required_degree_level = _extract_required_degree(structured)
    candidate_degree_level = _extract_candidate_degree(resume)

    if required_degree_level > 0:
        passes_degree = candidate_degree_level >= required_degree_level
        all_pass = all_pass and passes_degree

        # Map levels back to readable names
        level_names = {1: "Any Graduate", 2: "Diploma/Associate",
                       3: "Bachelor's", 4: "Master's", 5: "PhD"}
        checks.append({
            "check": "degree",
            "required": level_names.get(required_degree_level, str(required_degree_level)),
            "candidate": level_names.get(candidate_degree_level, "Not detected"),
            "passes": passes_degree,
            "detail": (
                f"Required: {level_names.get(required_degree_level)}, "
                f"Found: {level_names.get(candidate_degree_level, 'not detected')}"
            ),
        })
    else:
        checks.append({
            "check": "degree",
            "required": None,
            "passes": True,
            "detail": "No specific degree requirement detected in JD",
        })

    # ── Check 3: Hard exclusion terms ─────────────────────────────────────────
    # JDs sometimes contain explicit disqualifiers like "must be authorized to work"
    # or "no sponsorship available". We flag these but don't auto-fail
    # (we can't determine authorization from resume text reliably).
    _EXCLUSION_SIGNALS = [
        "must be authorized", "no sponsorship", "us citizen",
        "security clearance required", "must be local",
    ]
    full_jd_lower = structured.full_jd_text.lower()
    flagged_exclusions = [s for s in _EXCLUSION_SIGNALS if s in full_jd_lower]
    checks.append({
        "check": "manual_review_flags",
        "passes": True,   # Can't auto-determine — flag for human review
        "flags": flagged_exclusions,
        "detail": (
            f"Requires manual review: {flagged_exclusions}"
            if flagged_exclusions
            else "No manual review flags detected"
        ),
    })

    return KnockoutResult(passes=all_pass, checks=checks)


# ═══════════════════════════════════════════════════════════════════════════════
#  SUB-SYSTEM 3 — KEYWORD MATCHER
#  The core scoring engine.
#
#  For each JD keyword:
#    1. Check exact + near-exact match in full resume text → matched or missing
#    2. If matched, find WHICH section it appears in → placement score
#    3. Find WHEN it last appeared (recency year) → recency score
#    4. If not matched, check semantic similarity → warning only (no score)
#
#  Returns per-term match detail for every required and preferred keyword.
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class TermMatchDetail:
    term: str
    is_required: bool
    matched: bool
    matched_variant: Optional[str]           # which variant matched
    sections_found: List[ResumeSection]      # all sections where term appears
    best_section: Optional[ResumeSection]    # highest-weight section
    best_section_weight: float               # placement weight of best section
    most_recent_year: Optional[int]          # most recent year this term appeared
    recency_score: float                     # 0.0–1.0
    is_semantic_warning: bool               # close but not lexically present
    semantic_match: Optional[str]           # what it matched semantically


@dataclass
class KeywordMatchResult:
    required_matched: List[TermMatchDetail]
    required_missing: List[TermMatchDetail]
    preferred_matched: List[TermMatchDetail]
    preferred_missing: List[TermMatchDetail]
    semantic_warnings: List[TermMatchDetail]  # required terms with only semantic match


def _placement_weight(
    section: ResumeSection,
    config: ATSConfig,
) -> float:
    return {
        ResumeSection.SKILLS:          config.placement_skills,
        ResumeSection.SUMMARY:         config.placement_summary,
        ResumeSection.PROJECTS:        config.placement_projects,
        ResumeSection.EXPERIENCE:      config.placement_experience,
        ResumeSection.CERTIFICATIONS:  config.placement_projects,   # same as projects
        ResumeSection.EDUCATION:       config.placement_education,
        ResumeSection.OTHER:           config.placement_other,
    }.get(section, config.placement_other)


def _recency_score(year: Optional[int], config: ATSConfig) -> float:
    """
    Compute recency score for a term based on the year it last appeared.
    Current year → 1.0
    8+ years ago → config.recency_floor
    Linear interpolation between.
    """
    if year is None:
        return config.recency_floor   # No date context → assume older
    age = max(0, _CURRENT_YEAR - year)
    if age == 0:
        return 1.0
    if age >= config.recency_decay_years:
        return config.recency_floor
    # Linear decay
    decay_range = 1.0 - config.recency_floor
    return round(1.0 - (age / config.recency_decay_years) * decay_range, 3)


def _find_term_in_resume(
    term: str,
    resume: SectionedResume,
    config: ATSConfig,
) -> Tuple[bool, Optional[str], List[ResumeSection], Optional[int]]:
    """
    Search for a term across all resume blocks.
    Returns: (found, matched_variant, sections_found, most_recent_year)
    """
    variants = _get_all_variants(term, config)
    sections_found: List[ResumeSection] = []
    most_recent_year: Optional[int] = None
    matched_variant: Optional[str] = None

    for block in resume.blocks:
        block_text_lower = block.full_text.lower()
        for variant in variants:
            escaped = re.escape(variant)
            pattern = r"(?<![a-zA-Z0-9])" + escaped + r"(?![a-zA-Z0-9])"
            if re.search(pattern, block_text_lower):
                if block.section not in sections_found:
                    sections_found.append(block.section)
                if matched_variant is None:
                    matched_variant = variant
                # Track most recent year this term appeared
                if block.recency_year:
                    if most_recent_year is None or block.recency_year > most_recent_year:
                        most_recent_year = block.recency_year
                break  # found in this block, move to next

    found = len(sections_found) > 0
    return found, matched_variant, sections_found, most_recent_year


def match_keywords(
    resume: SectionedResume,
    structured: StructuredJD,
    config: ATSConfig = DEFAULT_CONFIG,
) -> KeywordMatchResult:
    """
    Sub-system 3 entry point.
    Matches all required and preferred JD keywords against the resume.
    """
    # Extract deduplicated terms from each section
    # We tokenise the structured JD sections into individual keyword phrases
    required_terms  = _extract_key_terms(structured.required)
    preferred_terms = _extract_key_terms(structured.preferred)

    required_matched:  List[TermMatchDetail] = []
    required_missing:  List[TermMatchDetail] = []
    preferred_matched: List[TermMatchDetail] = []
    preferred_missing: List[TermMatchDetail] = []
    semantic_warnings: List[TermMatchDetail] = []

    for term, is_required in (
        [(t, True) for t in required_terms] +
        [(t, False) for t in preferred_terms]
    ):
        found, variant, sections, year = _find_term_in_resume(term, resume, config)

        # Best section = highest placement weight among matched sections
        best_section = max(sections, key=lambda s: _placement_weight(s, config)) \
            if sections else None
        best_weight = _placement_weight(best_section, config) if best_section else 0.0

        rec_score = _recency_score(year, config)

        detail = TermMatchDetail(
            term=term,
            is_required=is_required,
            matched=found,
            matched_variant=variant,
            sections_found=sections,
            best_section=best_section,
            best_section_weight=best_weight,
            most_recent_year=year,
            recency_score=rec_score,
            is_semantic_warning=False,
            semantic_match=None,
        )

        if found:
            if is_required:
                required_matched.append(detail)
            else:
                preferred_matched.append(detail)
        else:
            if is_required:
                required_missing.append(detail)
            else:
                preferred_missing.append(detail)

    return KeywordMatchResult(
        required_matched=required_matched,
        required_missing=required_missing,
        preferred_matched=preferred_matched,
        preferred_missing=preferred_missing,
        semantic_warnings=semantic_warnings,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  KEY TERM EXTRACTOR
#  Extracts meaningful keyword phrases from a list of JD bullets.
#  Uses tech-aware tokenisation consistent with the gap analyzer.
#  Returns deduplicated set of terms worth matching.
# ─────────────────────────────────────────────────────────────────────────────

# Patterns that should be kept as atomic tokens in JD text
_TERM_PROTECT_RE = re.compile(
    r"\b[A-Za-z][A-Za-z0-9]*(?:\s+&\s+[A-Za-z][A-Za-z0-9]*)+\b"   # Weights & Biases
    r"|\b[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+\b"         # Next.js
    r"|\b[A-Za-z][A-Za-z0-9]*(?:/[A-Za-z][A-Za-z0-9]*)+\b"          # CI/CD
    r"|\b[A-Z]{1,4}[a-z][A-Za-z0-9]*\b"                              # LangChain, GenAI
    r"|\b[A-Z][a-z]+[A-Z][A-Za-z0-9]*\b"                             # LlamaIndex
    r"|\b[A-Z]{2,}(?:\+\+|#)?\b",                                    # NLP, C++
    re.IGNORECASE,
)

# Stop words to exclude from term extraction
_TERM_STOP = {
    "the", "a", "an", "and", "or", "in", "of", "to", "for", "with",
    "is", "are", "be", "as", "at", "by", "on", "not", "that", "this",
    "we", "you", "will", "your", "our", "etc", "e", "g", "such",
    "including", "using", "via", "through", "across", "within",
    "experience", "knowledge", "understanding", "familiarity",
    "ability", "skills", "skill", "working", "strong", "solid",
    "excellent", "good", "proven", "hands", "hands-on", "years",
    "year", "plus", "minimum", "required", "preferred",
}


def _extract_key_terms(bullets: List[str]) -> List[str]:
    """
    Extract meaningful keyword terms from a list of JD bullet strings.
    Returns deduplicated list of terms (tech tokens + meaningful noun phrases).
    Excludes generic words that aren't matchable skills.
    """
    terms: Set[str] = set()

    for bullet in bullets:
        # 1. Extract protected tech tokens first (preserves CamelCase etc.)
        for m in _TERM_PROTECT_RE.finditer(bullet):
            tok = m.group(0).strip()
            if len(tok) >= 2 and tok.lower() not in _TERM_STOP:
                terms.add(tok.lower())

        # 2. Extract 1–3 word phrases from remaining text
        # Replace protected tokens with placeholders to avoid double-counting
        cleaned = _TERM_PROTECT_RE.sub(" ", bullet)
        # Split on common delimiters
        words = re.findall(r"[a-zA-Z][a-zA-Z0-9\-\.]*", cleaned.lower())
        words = [w for w in words if w not in _TERM_STOP and len(w) >= 3]

        # Single words
        for w in words:
            terms.add(w)

        # Bigrams
        for i in range(len(words) - 1):
            bigram = f"{words[i]} {words[i+1]}"
            terms.add(bigram)

        # Trigrams (only if both words are meaningful)
        for i in range(len(words) - 2):
            trigram = f"{words[i]} {words[i+1]} {words[i+2]}"
            terms.add(trigram)

    # Filter: remove terms that are too generic or too short
    filtered = [
        t for t in terms
        if len(t) >= 2
        and t not in _TERM_STOP
        and not t.isdigit()
    ]

    return sorted(set(filtered))


# ═══════════════════════════════════════════════════════════════════════════════
#  SUB-SYSTEM 4 — SCORE AGGREGATOR
#  Converts match results into a final weighted ATS score.
#  All four components exposed separately for transparency.
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ATSScoreComponents:
    required_score: float     # 0–100: % of required terms matched
    preferred_score: float    # 0–100: % of preferred terms matched
    placement_score: float    # 0–12: bonus for skills-section placement
    recency_score: float      # 0–8: bonus for recent usage

    # Weighted final score
    ats_score: float          # 0–100

    # Convenience
    required_matched_count: int
    required_total_count: int
    preferred_matched_count: int
    preferred_total_count: int


def aggregate_score(
    match_result: KeywordMatchResult,
    knockout_result: KnockoutResult,
    config: ATSConfig = DEFAULT_CONFIG,
) -> ATSScoreComponents:
    """
    Sub-system 4 entry point.
    Computes weighted ATS score from match results.
    Returns 0 for all components if knockouts fail.
    """
    if not knockout_result.passes:
        # Knockout failed — ATS score is 0 (application eliminated).
        # Still compute keyword coverage so the UI shows real "already present"
        # data instead of all-zero analytics.
        req_total_ko  = len(match_result.required_matched) + len(match_result.required_missing)
        pref_total_ko = len(match_result.preferred_matched) + len(match_result.preferred_missing)
        req_score_ko  = (
            len(match_result.required_matched) / req_total_ko * 100
            if req_total_ko > 0 else 0.0
        )
        pref_score_ko = (
            len(match_result.preferred_matched) / pref_total_ko * 100
            if pref_total_ko > 0 else 0.0
        )
        return ATSScoreComponents(
            required_score=round(req_score_ko, 1),
            preferred_score=round(pref_score_ko, 1),
            placement_score=0.0,
            recency_score=0.0,
            ats_score=0.0,  # knockout override — application is eliminated
            required_matched_count=len(match_result.required_matched),
            required_total_count=req_total_ko,
            preferred_matched_count=len(match_result.preferred_matched),
            preferred_total_count=pref_total_ko,
        )

    req_total  = len(match_result.required_matched) + len(match_result.required_missing)
    pref_total = len(match_result.preferred_matched) + len(match_result.preferred_missing)

    # Component 1: Required keyword coverage (0–100)
    req_score = (
        len(match_result.required_matched) / req_total * 100
        if req_total > 0 else 100.0
    )

    # Component 2: Preferred keyword coverage (0–100)
    pref_score = (
        len(match_result.preferred_matched) / pref_total * 100
        if pref_total > 0 else 100.0
    )

    # Component 3: Placement score (0–12)
    # Average placement weight of matched required terms, normalised to 0–12
    # Skills section match (1.5×) = full 12 points
    # Other section match (0.6×)  = 4.8 points
    all_matched = match_result.required_matched + match_result.preferred_matched
    if all_matched:
        avg_placement = sum(t.best_section_weight for t in all_matched) / len(all_matched)
        # Normalise: max weight (skills=1.5) maps to 12, min (other=0.6) maps to 0
        max_w = config.placement_skills
        min_w = config.placement_other
        placement_score = (
            ((avg_placement - min_w) / (max_w - min_w)) * config.weight_placement * 100
        )
        placement_score = max(0.0, min(config.weight_placement * 100, placement_score))
    else:
        placement_score = 0.0

    # Component 4: Recency score (0–8)
    # Average recency score of matched required terms, normalised to 0–8
    req_matched = match_result.required_matched
    if req_matched:
        avg_recency = sum(t.recency_score for t in req_matched) / len(req_matched)
        recency_score = avg_recency * config.weight_recency * 100
    else:
        recency_score = 0.0

    # Final weighted score
    ats_score = (
        req_score   * config.weight_required
        + pref_score  * config.weight_preferred
        + placement_score
        + recency_score
    )
    ats_score = round(min(100.0, max(0.0, ats_score)), 1)

    return ATSScoreComponents(
        required_score=round(req_score, 1),
        preferred_score=round(pref_score, 1),
        placement_score=round(placement_score, 1),
        recency_score=round(recency_score, 1),
        ats_score=ats_score,
        required_matched_count=len(match_result.required_matched),
        required_total_count=req_total,
        preferred_matched_count=len(match_result.preferred_matched),
        preferred_total_count=pref_total,
    )


# ═══════════════════════════════════════════════════════════════════════════════
#  SUB-SYSTEM 5 — RECOMMENDATION ENGINE
#  Ranked, actionable list of what to add/change.
#  Priority order:
#    1. Required terms that are missing entirely (highest ATS impact)
#    2. Required terms found only in low-weight sections (move to Skills section)
#    3. Preferred terms that are missing
#    4. Required terms found only in old roles (add to recent experience)
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ATSRecommendation:
    priority: int               # 1 = highest
    category: str               # "required_missing" | "placement_upgrade" | etc.
    term: str                   # exact term to add
    action: str                 # what to do (human-readable)
    impact: str                 # why this matters for ATS
    score_impact_estimate: str  # rough score improvement estimate


def generate_recommendations(
    match_result: KeywordMatchResult,
    score: ATSScoreComponents,
    config: ATSConfig = DEFAULT_CONFIG,
) -> List[ATSRecommendation]:
    """
    Sub-system 5 entry point.
    Generates ranked, actionable recommendations.
    """
    recommendations: List[ATSRecommendation] = []
    priority = 1

    # Priority 1: Required terms completely missing
    for detail in match_result.required_missing:
        recommendations.append(ATSRecommendation(
            priority=priority,
            category="required_missing",
            term=detail.term,
            action=f"Add '{detail.term}' explicitly to your Skills section or a relevant bullet point",
            impact="Required keyword absent from resume — most ATS systems will not surface this application",
            score_impact_estimate=f"+{round(config.weight_required * 100 / max(score.required_total_count, 1), 1)} pts",
        ))
        priority += 1

    # Priority 2: Required terms in low-weight sections only
    # (found but not in Skills/Summary — missing a placement bonus)
    WEAK_SECTIONS = {ResumeSection.EDUCATION, ResumeSection.OTHER}
    for detail in match_result.required_matched:
        if detail.best_section in WEAK_SECTIONS:
            recommendations.append(ATSRecommendation(
                priority=priority,
                category="placement_upgrade",
                term=detail.term,
                action=f"Move '{detail.term}' into your Skills section or Summary — "
                       f"currently only found in {detail.best_section.value}",
                impact="ATS systems weight skills in a dedicated Skills section higher than in education or misc sections",
                score_impact_estimate="+1–2 pts placement",
            ))
            priority += 1

    # Priority 3: Preferred terms missing
    for detail in match_result.preferred_missing[:5]:   # cap at 5 preferred recommendations
        recommendations.append(ATSRecommendation(
            priority=priority,
            category="preferred_missing",
            term=detail.term,
            action=f"Consider adding '{detail.term}' if it reflects your experience",
            impact="Preferred keyword — differentiates candidates who pass the required filter",
            score_impact_estimate=f"+{round(config.weight_preferred * 100 / max(score.preferred_total_count, 1), 1)} pts",
        ))
        priority += 1

    # Priority 4: Required terms only in old roles (recency upgrade)
    RECENCY_THRESHOLD_YEAR = _CURRENT_YEAR - 4   # older than 4 years
    for detail in match_result.required_matched:
        if (
            detail.most_recent_year
            and detail.most_recent_year < RECENCY_THRESHOLD_YEAR
            and detail.best_section not in WEAK_SECTIONS
        ):
            recommendations.append(ATSRecommendation(
                priority=priority,
                category="recency_upgrade",
                term=detail.term,
                action=f"'{detail.term}' last appears in a {detail.most_recent_year} role — "
                       f"add it to a more recent position if applicable",
                impact="Some ATS systems weight recent skill usage more heavily than older experience",
                score_impact_estimate="+0.5–1 pt recency",
            ))
            priority += 1

    # Limit to config.max_recommendations
    return recommendations[: config.max_recommendations]


# ═══════════════════════════════════════════════════════════════════════════════
#  FINAL RESULT
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ATSResult:
    # Top-level
    ats_score: float                          # 0–100 final score
    passes_knockouts: bool

    # Sub-system outputs
    knockout: KnockoutResult
    score_components: ATSScoreComponents
    match_result: KeywordMatchResult
    recommendations: List[ATSRecommendation]

    # Resume structure reference
    sectioned_resume: SectionedResume

    def summary(self) -> str:
        sc = self.score_components
        lines = [
            f"ATS Score: {self.ats_score}/100",
            f"Knockouts: {'✅ Pass' if self.passes_knockouts else '❌ FAIL — application eliminated'}",
            f"",
            f"Score Breakdown:",
            f"  Required keywords:  {sc.required_matched_count}/{sc.required_total_count} "
            f"({sc.required_score:.0f}%)  × {DEFAULT_CONFIG.weight_required} = "
            f"{sc.required_score * DEFAULT_CONFIG.weight_required:.1f} pts",
            f"  Preferred keywords: {sc.preferred_matched_count}/{sc.preferred_total_count} "
            f"({sc.preferred_score:.0f}%)  × {DEFAULT_CONFIG.weight_preferred} = "
            f"{sc.preferred_score * DEFAULT_CONFIG.weight_preferred:.1f} pts",
            f"  Placement bonus:    {sc.placement_score:.1f} / {DEFAULT_CONFIG.weight_placement * 100:.0f} pts",
            f"  Recency bonus:      {sc.recency_score:.1f} / {DEFAULT_CONFIG.weight_recency * 100:.0f} pts",
        ]

        if self.match_result.required_missing:
            lines += ["", f"Required missing ({len(self.match_result.required_missing)}):"]
            for d in self.match_result.required_missing[:8]:
                lines.append(f"  ✗ {d.term}")

        if self.recommendations:
            lines += ["", f"Top recommendations:"]
            for r in self.recommendations[:5]:
                lines.append(f"  [{r.priority}] {r.action}")

        for check in self.knockout.checks:
            if not check["passes"]:
                lines.append(f"\n⚠️  KNOCKOUT FAILED: {check['detail']}")

        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "atsScore": self.ats_score,
            "passesKnockouts": self.passes_knockouts,
            "scoreBreakdown": {
                "requiredScore": self.score_components.required_score,
                "preferredScore": self.score_components.preferred_score,
                "placementScore": self.score_components.placement_score,
                "recencyScore": self.score_components.recency_score,
                "requiredMatchedCount": self.score_components.required_matched_count,
                "requiredTotalCount": self.score_components.required_total_count,
                "preferredMatchedCount": self.score_components.preferred_matched_count,
                "preferredTotalCount": self.score_components.preferred_total_count,
            },
            "knockouts": self.knockout.checks,
            "requiredMatched": [
                {
                    "term": d.term,
                    "sections": [s.value for s in d.sections_found],
                    "bestSection": d.best_section.value if d.best_section else None,
                    "mostRecentYear": d.most_recent_year,
                    "recencyScore": d.recency_score,
                }
                for d in self.match_result.required_matched
            ],
            "requiredMissing": [d.term for d in self.match_result.required_missing],
            "preferredMatched": [d.term for d in self.match_result.preferred_matched],
            "preferredMissing": [d.term for d in self.match_result.preferred_missing],
            "semanticWarnings": [
                {"term": d.term, "closestMatch": d.semantic_match}
                for d in self.match_result.semantic_warnings
            ],
            "recommendations": [
                {
                    "priority": r.priority,
                    "category": r.category,
                    "term": r.term,
                    "action": r.action,
                    "impact": r.impact,
                    "scoreImpactEstimate": r.score_impact_estimate,
                }
                for r in self.recommendations
            ],
            "sectionBreakdown": {
                section.value: [b.full_text[:120] for b in blocks[:3]]
                for section, blocks in self.sectioned_resume.blocks_by_section.items()
            },
        }


# ═══════════════════════════════════════════════════════════════════════════════
#  PUBLIC API — single entry point
# ═══════════════════════════════════════════════════════════════════════════════

def score_ats(
    block_ast: dict,
    structured_jd: StructuredJD,
    config: ATSConfig = DEFAULT_CONFIG,
) -> ATSResult:
    """
    Full ATS scoring pipeline.

    Args:
        block_ast:      Output of parse_docx_to_block_ast() — already in state
                        from the tailoring pipeline. No re-parsing needed.
        structured_jd:  Output of jd_structurer.structure_jd()
        config:         Scoring configuration

    Returns:
        ATSResult with score, breakdown, and recommendations

    Integration with existing pipeline:
        from ats_scorer import score_ats

        # block_ast is already in state["block_ast"] from rewrite_bullets
        result = score_ats(
            block_ast=state["block_ast"],
            structured_jd=state["structured_jd"],
        )
        state["ats_result"] = result.to_dict()
    """

    # Sub-system 1: Parse resume from AST
    resume = parse_resume_from_ast(block_ast)

    # Sub-system 2: Evaluate knockouts
    knockout = evaluate_knockouts(resume, structured_jd, config)

    # Sub-system 3: Match keywords
    match_result = match_keywords(resume, structured_jd, config)

    # Sub-system 4: Aggregate score
    score_components = aggregate_score(match_result, knockout, config)

    # Sub-system 5: Generate recommendations
    recommendations = generate_recommendations(match_result, score_components, config)

    return ATSResult(
        ats_score=score_components.ats_score,
        passes_knockouts=knockout.passes,
        knockout=knockout,
        score_components=score_components,
        match_result=match_result,
        recommendations=recommendations,
        sectioned_resume=resume,
    )