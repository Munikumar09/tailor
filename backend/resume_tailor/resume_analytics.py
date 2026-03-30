"""
analytics.py
============
Tailoring analytics engine — before/after comparison report.

Consumes:
    state["block_ast"]          — original resume AST (from rewrite_bullets)
    state["tailored_block_ast"] — tailored resume AST (built after run_rebuilder)
    state["structured_jd"]      — StructuredJD (from jd_structurer)
    state["tailored_bullets"]   — validated changes (from validate_changes)
    state["keyword_analysis"]   — gap analysis output (from gap analyzer)

Produces TailoringAnalyticsReport with 5 layers:

    Layer 1 — ScoreDelta
        ATS score before/after, all component deltas, knockout status change,
        critical gap reduction, YOE status change.

    Layer 2 — KeywordMovementMap
        Every JD keyword classified as:
          NEWLY_ADDED      — injected by tailoring, now matched
          ALREADY_PRESENT  — was matched before tailoring
          STILL_MISSING    — not matched before or after
        Each entry carries impact_level (HIGH / MEDIUM / LOW) derived from
        whether it's required/preferred and how many times it appears in JD.

    Layer 3 — ChangeJustificationCards
        One card per accepted change. Enriched from validated_bullets with:
          — original text / new text
          — injected keywords highlighted
          — which gap each keyword closed (required / preferred)
          — honest per-change score attribution (delta of score components)
          — LLM's own reason field passed through

    Layer 4 — ATSPassBand
        Qualitative filter status before and after.
        Four bands: LIKELY_FILTERED / BORDERLINE / LIKELY_SURFACED / STRONG_PASS
        Derived from required_score thresholds, not fabricated probabilities.
        Also exposes ResumeStrengthSignals — positive signals a recruiter
        would notice (title match, key skill presence, YOE adequacy).

    Layer 5 — ActionQueue
        Ranked list of what the user should do manually after tailoring.
        Priority: required still missing > placement upgrades > preferred missing.
        Each action has: term, exact instruction, impact category, score estimate.

Integration:
    from analytics import generate_analytics_report

    report = generate_analytics_report(
        original_ast   = state["block_ast"],
        tailored_ast   = state["tailored_block_ast"],
        structured_jd  = state["structured_jd"],
        validated_bullets = state["tailored_bullets"],
        keyword_analysis  = state["keyword_analysis"],
    )
    state["analytics"] = report.to_dict()
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Dict, List, Optional, Tuple
from utils.logger import get_logger

logger = get_logger(__name__)

from .ats_scorer import (
    ATSConfig,
    ATSResult,
    DEFAULT_CONFIG,
    ResumeSection,
    TermMatchDetail,
    _CURRENT_YEAR,
    _extract_key_terms,
    score_ats,
)
from .jd_structurer import StructuredJD


# ═══════════════════════════════════════════════════════════════════════════════
#  ENUMS
# ═══════════════════════════════════════════════════════════════════════════════

class KeywordStatus(Enum):
    NEWLY_ADDED     = "newly_added"      # injected by tailoring
    ALREADY_PRESENT = "already_present"  # was there before tailoring
    STILL_MISSING   = "still_missing"    # absent before and after


class ImpactLevel(Enum):
    HIGH   = "high"    # required term, appears ≥2× in JD
    MEDIUM = "medium"  # required term appears 1× OR preferred appears ≥2×
    LOW    = "low"     # preferred term appears 1×


class ATSPassBand(Enum):
    LIKELY_FILTERED  = "likely_filtered"   # required_score < 50
    BORDERLINE       = "borderline"        # required_score 50–69
    LIKELY_SURFACED  = "likely_surfaced"   # required_score 70–84
    STRONG_PASS      = "strong_pass"       # required_score ≥ 85


# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER 1 — SCORE DELTA
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class YOEStatusChange:
    before: str          # "not_satisfied" | "partial" | "satisfied" | "not_required"
    after: str
    required_years: Optional[int]
    candidate_years: int
    changed: bool


@dataclass
class ScoreDelta:
    # Headline
    ats_before: float
    ats_after: float
    ats_improvement: float

    # Component deltas
    required_coverage_before: float    # 0–100
    required_coverage_after: float
    preferred_coverage_before: float
    preferred_coverage_after: float
    placement_score_before: float      # 0–12
    placement_score_after: float
    recency_score_before: float        # 0–8
    recency_score_after: float

    # Critical gap reduction (GPT's suggestion — genuinely useful)
    critical_gaps_before: int
    critical_gaps_after: int
    critical_gaps_reduced: int

    # Knockout status
    knockout_passed_before: bool
    knockout_passed_after: bool
    knockout_status_changed: bool

    # YOE specifically (most common knockout)
    yoe_status: YOEStatusChange

    def required_coverage_delta(self) -> float:
        return round(self.required_coverage_after - self.required_coverage_before, 1)

    def preferred_coverage_delta(self) -> float:
        return round(self.preferred_coverage_after - self.preferred_coverage_before, 1)


# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER 2 — KEYWORD MOVEMENT MAP
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class KeywordMovement:
    term: str
    status: KeywordStatus
    impact_level: ImpactLevel
    is_required: bool
    jd_frequency: int          # how many times term appears in JD
    section_found: Optional[str]   # which resume section it landed in (if added/present)
    note: Optional[str]            # human-readable explanation


@dataclass
class KeywordMovementMap:
    newly_added: List[KeywordMovement]
    already_present: List[KeywordMovement]
    still_missing: List[KeywordMovement]

    # Convenience counts
    @property
    def total_terms(self) -> int:
        return len(self.newly_added) + len(self.already_present) + len(self.still_missing)

    @property
    def coverage_after(self) -> float:
        matched = len(self.newly_added) + len(self.already_present)
        return round(matched / self.total_terms * 100, 1) if self.total_terms else 0.0

    @property
    def required_newly_added(self) -> List[KeywordMovement]:
        return [k for k in self.newly_added if k.is_required]

    @property
    def required_still_missing(self) -> List[KeywordMovement]:
        return [k for k in self.still_missing if k.is_required]


# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER 3 — CHANGE JUSTIFICATION CARDS
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class InjectedKeywordDetail:
    term: str
    is_required: bool           # required or preferred in JD
    gap_closed: bool            # was this term in the missing list before tailoring
    jd_frequency: int           # how important this term is in the JD


@dataclass
class ChangeCard:
    change_number: int
    block_id: str
    original_text: str
    new_text: str
    injected_keywords: List[InjectedKeywordDetail]
    llm_reason: str             # the "reason" field from the LLM output

    # Honest score attribution:
    # Terms injected by this change that moved from missing → matched in ATS scorer
    required_gaps_closed: List[str]
    preferred_gaps_closed: List[str]

    # Score impact: sum of weight contributions of newly-matched required terms
    # computed as: (terms_closed / total_required) * weight_required * 100
    score_impact_pts: float
    impact_label: str           # "High Impact" | "Medium Impact" | "Low Impact"


# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER 4 — ATS PASS BAND + RESUME STRENGTH SIGNALS
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ResumeStrengthSignal:
    signal: str              # human-readable description
    positive: bool           # True = green, False = amber warning
    detail: str


@dataclass
class ATSPassBandResult:
    band_before: ATSPassBand
    band_after: ATSPassBand
    label_before: str        # "Likely filtered out"
    label_after: str         # "Likely surfaced for recruiter review"
    band_changed: bool
    explanation: str         # why the band is what it is

    strength_signals: List[ResumeStrengthSignal]


# ═══════════════════════════════════════════════════════════════════════════════
#  LAYER 5 — ACTION QUEUE
# ═══════════════════════════════════════════════════════════════════════════════

class ActionPriority(Enum):
    HIGH   = "high"
    MEDIUM = "medium"
    LOW    = "low"


@dataclass
class PrioritisedAction:
    priority: ActionPriority
    rank: int                    # 1 = most important
    term: str
    action: str                  # exact instruction
    section_target: str          # "Skills section" | "recent Experience bullet" etc.
    reason: str                  # why this matters for ATS
    score_impact_estimate: str   # "+3.2 pts" etc.
    jd_frequency: int            # how many times in JD — helps user prioritise


# ═══════════════════════════════════════════════════════════════════════════════
#  FINAL REPORT
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class TailoringAnalyticsReport:
    # Metadata
    generated_at: str
    jd_title: str
    structuring_method: str      # "llm" | "fallback"

    # Five layers
    score_delta: ScoreDelta
    keyword_movement: KeywordMovementMap
    change_cards: List[ChangeCard]
    pass_band: ATSPassBandResult
    action_queue: List[PrioritisedAction]

    # Raw ATS results kept for debugging / API consumers
    ats_before: ATSResult
    ats_after: ATSResult

    def to_dict(self) -> dict:
        sd = self.score_delta
        km = self.keyword_movement
        pb = self.pass_band

        return {
            "meta": {
                "generatedAt": self.generated_at,
                "jdTitle": self.jd_title,
                "structuringMethod": self.structuring_method,
            },

            # ── Layer 1 ──────────────────────────────────────────────────────
            "scoreDelta": {
                "atsBefore": sd.ats_before,
                "atsAfter": sd.ats_after,
                "atsImprovement": sd.ats_improvement,
                "requiredCoverage": {
                    "before": sd.required_coverage_before,
                    "after": sd.required_coverage_after,
                    "delta": sd.required_coverage_delta(),
                },
                "preferredCoverage": {
                    "before": sd.preferred_coverage_before,
                    "after": sd.preferred_coverage_after,
                    "delta": sd.preferred_coverage_delta(),
                },
                "placementScore": {
                    "before": sd.placement_score_before,
                    "after": sd.placement_score_after,
                    "delta": round(sd.placement_score_after - sd.placement_score_before, 1),
                },
                "recencyScore": {
                    "before": sd.recency_score_before,
                    "after": sd.recency_score_after,
                    "delta": round(sd.recency_score_after - sd.recency_score_before, 1),
                },
                "criticalGaps": {
                    "before": sd.critical_gaps_before,
                    "after": sd.critical_gaps_after,
                    "reduced": sd.critical_gaps_reduced,
                },
                "knockoutPassed": {
                    "before": sd.knockout_passed_before,
                    "after": sd.knockout_passed_after,
                    "changed": sd.knockout_status_changed,
                },
                "yoeStatus": {
                    "before": sd.yoe_status.before,
                    "after": sd.yoe_status.after,
                    "requiredYears": sd.yoe_status.required_years,
                    "candidateYears": sd.yoe_status.candidate_years,
                    "changed": sd.yoe_status.changed,
                },
            },

            # ── Layer 2 ──────────────────────────────────────────────────────
            "keywordMovement": {
                "newlyAdded": [
                    {
                        "term": k.term,
                        "status": k.status.value,
                        "impactLevel": k.impact_level.value,
                        "isRequired": k.is_required,
                        "jdFrequency": k.jd_frequency,
                        "sectionFound": k.section_found,
                        "note": k.note,
                    }
                    for k in km.newly_added
                ],
                "alreadyPresent": [
                    {
                        "term": k.term,
                        "impactLevel": k.impact_level.value,
                        "isRequired": k.is_required,
                        "sectionFound": k.section_found,
                    }
                    for k in km.already_present
                ],
                "stillMissing": [
                    {
                        "term": k.term,
                        "impactLevel": k.impact_level.value,
                        "isRequired": k.is_required,
                        "jdFrequency": k.jd_frequency,
                        "note": k.note,
                    }
                    for k in km.still_missing
                ],
                "summary": {
                    "totalTerms": km.total_terms,
                    "coverageAfter": km.coverage_after,
                    "requiredNewlyAdded": len(km.required_newly_added),
                    "requiredStillMissing": len(km.required_still_missing),
                },
            },

            # ── Layer 3 ──────────────────────────────────────────────────────
            "changeCards": [
                {
                    "changeNumber": c.change_number,
                    "blockId": c.block_id,
                    "originalText": c.original_text,
                    "newText": c.new_text,
                    "injectedKeywords": [
                        {
                            "term": kw.term,
                            "isRequired": kw.is_required,
                            "gapClosed": kw.gap_closed,
                            "jdFrequency": kw.jd_frequency,
                        }
                        for kw in c.injected_keywords
                    ],
                    "llmReason": c.llm_reason,
                    "requiredGapsClosed": c.required_gaps_closed,
                    "preferredGapsClosed": c.preferred_gaps_closed,
                    "scoreImpactPts": c.score_impact_pts,
                    "impactLabel": c.impact_label,
                }
                for c in self.change_cards
            ],

            # ── Layer 4 ──────────────────────────────────────────────────────
            "passBand": {
                "bandBefore": pb.band_before.value,
                "bandAfter": pb.band_after.value,
                "labelBefore": pb.label_before,
                "labelAfter": pb.label_after,
                "bandChanged": pb.band_changed,
                "explanation": pb.explanation,
                "strengthSignals": [
                    {
                        "signal": s.signal,
                        "positive": s.positive,
                        "detail": s.detail,
                    }
                    for s in pb.strength_signals
                ],
            },

            # ── Layer 5 ──────────────────────────────────────────────────────
            "actionQueue": [
                {
                    "priority": a.priority.value,
                    "rank": a.rank,
                    "term": a.term,
                    "action": a.action,
                    "sectionTarget": a.section_target,
                    "reason": a.reason,
                    "scoreImpactEstimate": a.score_impact_estimate,
                    "jdFrequency": a.jd_frequency,
                }
                for a in self.action_queue
            ],
        }

    def summary(self) -> str:
        """CLI-friendly human-readable summary."""
        sd = self.score_delta
        km = self.keyword_movement
        pb = self.pass_band
        SEP = "─" * 60

        lines = [
            f"\n{'═' * 60}",
            f"  TAILORING ANALYTICS REPORT",
            f"  JD: {self.jd_title}",
            f"{'═' * 60}",
            f"\n📊 SCORE DELTA",
            SEP,
            f"  ATS Score:  {sd.ats_before}  →  {sd.ats_after}  "
            f"({'+'if sd.ats_improvement >= 0 else ''}{sd.ats_improvement:.1f})",
            f"  Required coverage:   {sd.required_coverage_before:.0f}%  →  "
            f"{sd.required_coverage_after:.0f}%  "
            f"({'+' if sd.required_coverage_delta() >= 0 else ''}{sd.required_coverage_delta():.0f}%)",
            f"  Preferred coverage:  {sd.preferred_coverage_before:.0f}%  →  "
            f"{sd.preferred_coverage_after:.0f}%  "
            f"({'+' if sd.preferred_coverage_delta() >= 0 else ''}{sd.preferred_coverage_delta():.0f}%)",
            f"  Critical gaps:       {sd.critical_gaps_before}  →  {sd.critical_gaps_after}  "
            f"(-{sd.critical_gaps_reduced} eliminated)",
            f"  YOE status:          {sd.yoe_status.before}  →  {sd.yoe_status.after}",
        ]

        lines += [
            f"\n🔑 KEYWORD MOVEMENT",
            SEP,
            f"  Newly added ({len(km.newly_added)}):  "
            + ", ".join(k.term for k in km.newly_added[:8])
            + ("..." if len(km.newly_added) > 8 else ""),
            f"  Already present ({len(km.already_present)}):  "
            + ", ".join(k.term for k in km.already_present[:5])
            + ("..." if len(km.already_present) > 5 else ""),
            f"  Still missing ({len(km.still_missing)}):  "
            + ", ".join(k.term for k in km.still_missing[:8])
            + ("..." if len(km.still_missing) > 8 else ""),
        ]

        lines += [
            f"\n📋 CHANGES ({len(self.change_cards)})",
            SEP,
        ]
        for c in self.change_cards:
            lines.append(
                f"  [{c.change_number}] {c.impact_label} (+{c.score_impact_pts:.1f} pts)"
            )
            lines.append(f"       Before: {c.original_text[:80]}...")
            lines.append(f"       After:  {c.new_text[:80]}...")
            if c.required_gaps_closed:
                lines.append(f"       Closed required gaps: {', '.join(c.required_gaps_closed)}")

        lines += [
            f"\n🎯 ATS FILTER STATUS",
            SEP,
            f"  Before: {pb.label_before}",
            f"  After:  {pb.label_after}",
            f"  {pb.explanation}",
        ]

        if pb.strength_signals:
            lines.append(f"\n  Resume signals:")
            for sig in pb.strength_signals:
                icon = "✅" if sig.positive else "⚠️"
                lines.append(f"    {icon} {sig.signal}")

        if self.action_queue:
            lines += [f"\n⚡ TOP ACTIONS (manual steps remaining)", SEP]
            for a in self.action_queue[:5]:
                lines.append(
                    f"  [{a.priority.value.upper()}] Add '{a.term}' to {a.section_target}"
                )
                lines.append(f"          → {a.reason}")
                lines.append(f"          → {a.score_impact_estimate}")

        return "\n".join(lines)


# ═══════════════════════════════════════════════════════════════════════════════
#  BUILDER FUNCTIONS — one per layer
# ═══════════════════════════════════════════════════════════════════════════════

# ─────────────────────────────────────────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _jd_frequency(term: str, structured: StructuredJD) -> int:
    """Count how many times a term appears in the full JD text."""
    return len(re.findall(
        r"(?<![a-zA-Z0-9])" + re.escape(term.lower()) + r"(?![a-zA-Z0-9])",
        structured.full_jd_text.lower(),
    ))


def _classify_impact(term: str, is_required: bool, freq: int) -> ImpactLevel:
    """
    Impact classification:
    HIGH:   required AND freq ≥ 2
    MEDIUM: required AND freq = 1  OR  preferred AND freq ≥ 2
    LOW:    preferred AND freq = 1
    """
    if is_required and freq >= 2:
        return ImpactLevel.HIGH
    if is_required or freq >= 2:
        return ImpactLevel.MEDIUM
    return ImpactLevel.LOW


def _required_term_set(ats: ATSResult) -> set[str]:
    all_terms = (
        ats.match_result.required_matched
        + ats.match_result.required_missing
    )
    return {d.term for d in all_terms}


def _matched_term_set(ats: ATSResult) -> set[str]:
    return (
        {d.term for d in ats.match_result.required_matched}
        | {d.term for d in ats.match_result.preferred_matched}
    )


def _missing_term_set(ats: ATSResult) -> set[str]:
    return (
        {d.term for d in ats.match_result.required_missing}
        | {d.term for d in ats.match_result.preferred_missing}
    )


def _detail_by_term(ats: ATSResult) -> Dict[str, TermMatchDetail]:
    """Build term → TermMatchDetail lookup for quick access."""
    all_details = (
        ats.match_result.required_matched
        + ats.match_result.required_missing
        + ats.match_result.preferred_matched
        + ats.match_result.preferred_missing
    )
    return {d.term: d for d in all_details}


def _count_critical_gaps(ats: ATSResult) -> int:
    """
    Critical gaps = required terms that are missing.
    This is what GPT correctly identified as the most intuitive risk metric.
    """
    return len(ats.match_result.required_missing)


def _yoe_status_string(ats: ATSResult) -> str:
    """Derive YOE status from knockout checks."""
    for check in ats.knockout.checks:
        if check["check"] == "years_of_experience":
            if check.get("required") is None:
                return "not_required"
            candidate = check.get("candidate", 0)
            required = check.get("required", 0)
            if check["passes"]:
                return "satisfied"
            tolerance = check.get("tolerance", 1)
            if candidate >= required * 0.7:
                return "partial"
            return "not_satisfied"
    return "not_required"


# ─────────────────────────────────────────────────────────────────────────────
#  LAYER 1 BUILDER
# ─────────────────────────────────────────────────────────────────────────────

def _build_score_delta(
    ats_before: ATSResult,
    ats_after: ATSResult,
) -> ScoreDelta:
    sb = ats_before.score_components
    sa = ats_after.score_components

    # YOE status
    yoe_before_str = _yoe_status_string(ats_before)
    yoe_after_str  = _yoe_status_string(ats_after)

    yoe_req = None
    yoe_candidate = 0
    for check in ats_before.knockout.checks:
        if check["check"] == "years_of_experience":
            yoe_req = check.get("required")
            yoe_candidate = check.get("candidate", 0)

    yoe_status = YOEStatusChange(
        before=yoe_before_str,
        after=yoe_after_str,
        required_years=yoe_req,
        candidate_years=yoe_candidate,
        changed=yoe_before_str != yoe_after_str,
    )

    critical_before = _count_critical_gaps(ats_before)
    critical_after  = _count_critical_gaps(ats_after)

    return ScoreDelta(
        ats_before=ats_before.ats_score,
        ats_after=ats_after.ats_score,
        ats_improvement=round(ats_after.ats_score - ats_before.ats_score, 1),

        required_coverage_before=sb.required_score,
        required_coverage_after=sa.required_score,
        preferred_coverage_before=sb.preferred_score,
        preferred_coverage_after=sa.preferred_score,
        placement_score_before=sb.placement_score,
        placement_score_after=sa.placement_score,
        recency_score_before=sb.recency_score,
        recency_score_after=sa.recency_score,

        critical_gaps_before=critical_before,
        critical_gaps_after=critical_after,
        critical_gaps_reduced=max(0, critical_before - critical_after),

        knockout_passed_before=ats_before.passes_knockouts,
        knockout_passed_after=ats_after.passes_knockouts,
        knockout_status_changed=(
            ats_before.passes_knockouts != ats_after.passes_knockouts
        ),
        yoe_status=yoe_status,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  LAYER 2 BUILDER
# ─────────────────────────────────────────────────────────────────────────────

def _build_keyword_movement(
    ats_before: ATSResult,
    ats_after: ATSResult,
    structured: StructuredJD,
) -> KeywordMovementMap:
    """
    Classify every JD keyword into one of three states by comparing
    the before and after ATS match results directly.
    """
    matched_before = _matched_term_set(ats_before)
    matched_after  = _matched_term_set(ats_after)
    missing_after  = _missing_term_set(ats_after)
    required_set   = _required_term_set(ats_after)
    detail_after   = _detail_by_term(ats_after)

    # All unique terms across both snapshots
    all_terms = (
        matched_before
        | matched_after
        | {d.term for d in ats_before.match_result.required_missing}
        | {d.term for d in ats_before.match_result.preferred_missing}
    )

    newly_added:     List[KeywordMovement] = []
    already_present: List[KeywordMovement] = []
    still_missing:   List[KeywordMovement] = []

    for term in sorted(all_terms):
        is_required = term in required_set
        freq = _jd_frequency(term, structured)
        impact = _classify_impact(term, is_required, freq)

        # Determine which section it landed in (if matched after)
        section_found = None
        if term in detail_after and detail_after[term].best_section:
            section_found = detail_after[term].best_section.value

        if term not in matched_before and term in matched_after:
            # Was missing before, now present — injected by tailoring
            newly_added.append(KeywordMovement(
                term=term,
                status=KeywordStatus.NEWLY_ADDED,
                impact_level=impact,
                is_required=is_required,
                jd_frequency=freq,
                section_found=section_found,
                note=f"Injected by tailoring — now matched in {section_found or 'resume'}",
            ))

        elif term in matched_before:
            # Was already present before tailoring
            already_present.append(KeywordMovement(
                term=term,
                status=KeywordStatus.ALREADY_PRESENT,
                impact_level=impact,
                is_required=is_required,
                jd_frequency=freq,
                section_found=section_found,
                note=None,
            ))

        else:
            # Still not matched after tailoring
            still_missing.append(KeywordMovement(
                term=term,
                status=KeywordStatus.STILL_MISSING,
                impact_level=impact,
                is_required=is_required,
                jd_frequency=freq,
                section_found=None,
                note=(
                    "Required keyword absent — add manually to Skills section"
                    if is_required
                    else "Preferred keyword — consider adding if applicable"
                ),
            ))

    # Sort each list: high impact first, then by JD frequency
    def sort_key(k: KeywordMovement):
        impact_order = {ImpactLevel.HIGH: 0, ImpactLevel.MEDIUM: 1, ImpactLevel.LOW: 2}
        return (impact_order[k.impact_level], -k.jd_frequency)

    newly_added.sort(key=sort_key)
    still_missing.sort(key=sort_key)
    already_present.sort(key=lambda k: (not k.is_required, -k.jd_frequency))

    return KeywordMovementMap(
        newly_added=newly_added,
        already_present=already_present,
        still_missing=still_missing,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  LAYER 3 BUILDER
# ─────────────────────────────────────────────────────────────────────────────

def _build_change_cards(
    validated_bullets: List[dict],
    ats_before: ATSResult,
    ats_after: ATSResult,
    structured: StructuredJD,
    block_ast: dict,
) -> List[ChangeCard]:
    """
    Build one ChangeCard per accepted validated bullet.

    Score attribution is honest:
    - Find which keywords were injected (from keywordsAdded field)
    - Find which of those moved from missing→matched between before and after
    - Score impact = (newly matched required terms / total required) × weight × 100
    """
    blocks_by_id = {b["id"]: b for b in block_ast.get("blocks", [])}
    matched_before  = _matched_term_set(ats_before)
    matched_after   = _matched_term_set(ats_after)
    required_before = {d.term for d in ats_before.match_result.required_missing}
    preferred_before = {d.term for d in ats_before.match_result.preferred_missing}
    required_set = _required_term_set(ats_after)
    req_total = (
        ats_after.score_components.required_total_count or 1
    )

    cards: List[ChangeCard] = []

    for i, bullet in enumerate(validated_bullets, start=1):
        block_id   = bullet.get("id", "")
        new_text   = bullet.get("newText", "")
        kw_added   = bullet.get("keywordsAdded", [])
        llm_reason = bullet.get("reason", "")

        original_text = blocks_by_id.get(block_id, {}).get("fullText", "")

        # Build injected keyword detail list
        injected: List[InjectedKeywordDetail] = []
        for kw in kw_added:
            kw_lower = kw.lower()
            is_req = kw_lower in required_set
            gap_closed = kw_lower in required_before or kw_lower in preferred_before
            freq = _jd_frequency(kw_lower, structured)
            injected.append(InjectedKeywordDetail(
                term=kw,
                is_required=is_req,
                gap_closed=gap_closed,
                jd_frequency=freq,
            ))

        # Honest score attribution:
        # Which required terms did this change move from missing → matched?
        # We attribute to this card any required term that:
        #   a) appears in keywordsAdded
        #   b) was missing before (in required_before)
        #   c) is matched after (in matched_after)
        required_gaps_closed = [
            kw for kw in kw_added
            if kw.lower() in required_before and kw.lower() in matched_after
        ]
        preferred_gaps_closed = [
            kw for kw in kw_added
            if kw.lower() in preferred_before and kw.lower() in matched_after
        ]

        # Score impact: each required gap closed contributes
        # weight_required / total_required * 100 points
        score_impact = (
            len(required_gaps_closed) / req_total
            * DEFAULT_CONFIG.weight_required * 100
        )
        score_impact = round(score_impact, 1)

        if score_impact >= 3.0:
            impact_label = "High Impact"
        elif score_impact >= 1.0:
            impact_label = "Medium Impact"
        else:
            impact_label = "Low Impact"

        cards.append(ChangeCard(
            change_number=i,
            block_id=block_id,
            original_text=original_text,
            new_text=new_text,
            injected_keywords=injected,
            llm_reason=llm_reason,
            required_gaps_closed=required_gaps_closed,
            preferred_gaps_closed=preferred_gaps_closed,
            score_impact_pts=score_impact,
            impact_label=impact_label,
        ))

    # Sort cards by score impact descending so user sees highest-value changes first
    cards.sort(key=lambda c: c.score_impact_pts, reverse=True)

    # Re-number after sort
    for idx, card in enumerate(cards, start=1):
        card.change_number = idx

    return cards


# ─────────────────────────────────────────────────────────────────────────────
#  LAYER 4 BUILDER
# ─────────────────────────────────────────────────────────────────────────────

_BAND_THRESHOLDS = {
    ATSPassBand.STRONG_PASS:      85.0,
    ATSPassBand.LIKELY_SURFACED:  70.0,
    ATSPassBand.BORDERLINE:       50.0,
    # Below 50 → LIKELY_FILTERED
}

_BAND_LABELS = {
    ATSPassBand.STRONG_PASS:     "Strong pass — likely ranked highly",
    ATSPassBand.LIKELY_SURFACED: "Likely surfaced for recruiter review",
    ATSPassBand.BORDERLINE:      "Borderline — may pass but at risk of filtering",
    ATSPassBand.LIKELY_FILTERED: "Likely filtered out before recruiter review",
}

_BAND_EXPLANATIONS = {
    ATSPassBand.STRONG_PASS:
        "Required keyword coverage is strong. Most ATS systems surface applications "
        "at this level. Recruiter will likely review this resume.",
    ATSPassBand.LIKELY_SURFACED:
        "Required keyword coverage meets the typical ATS threshold (70%+). "
        "Application should surface for recruiter review.",
    ATSPassBand.BORDERLINE:
        "Required keyword coverage is in the 50–70% range. Some ATS systems "
        "will surface this, others won't depending on threshold settings. "
        "Adding more required keywords would significantly improve the outcome.",
    ATSPassBand.LIKELY_FILTERED:
        "Required keyword coverage is below 50%. Most ATS systems will not "
        "surface this application. Critical keywords are missing — "
        "address the action queue before applying.",
}


def _score_to_band(required_score: float, knockout_passes: bool) -> ATSPassBand:
    if not knockout_passes:
        return ATSPassBand.LIKELY_FILTERED
    if required_score >= _BAND_THRESHOLDS[ATSPassBand.STRONG_PASS]:
        return ATSPassBand.STRONG_PASS
    if required_score >= _BAND_THRESHOLDS[ATSPassBand.LIKELY_SURFACED]:
        return ATSPassBand.LIKELY_SURFACED
    if required_score >= _BAND_THRESHOLDS[ATSPassBand.BORDERLINE]:
        return ATSPassBand.BORDERLINE
    return ATSPassBand.LIKELY_FILTERED


def _build_strength_signals(
    ats_after: ATSResult,
    structured: StructuredJD,
) -> List[ResumeStrengthSignal]:
    """
    Resume strength signals — positive and warning signals a recruiter
    would notice when the resume surfaces. Derived from existing scorer output.
    """
    signals: List[ResumeStrengthSignal] = []
    resume = ats_after.sectioned_resume

    # Signal 1: Job title match
    # Compare JD title against the candidate's most recent job title
    # (first non-heading line in Experience section)
    jd_title_lower = structured.title.lower()
    exp_blocks = resume.blocks_by_section.get(ResumeSection.EXPERIENCE, [])
    candidate_title = ""
    for block in exp_blocks:
        if block.type not in ("h1", "h2", "h3") and block.full_text.strip():
            candidate_title = block.full_text.strip()
            break

    if jd_title_lower and candidate_title:
        jd_words = set(jd_title_lower.split())
        cand_words = set(candidate_title.lower().split())
        overlap = jd_words & cand_words - {"and", "or", "the", "a", "an", "of", "in"}
        if len(overlap) >= 2:
            signals.append(ResumeStrengthSignal(
                signal=f"Title match: '{candidate_title[:50]}'",
                positive=True,
                detail=f"Candidate title shares key words with JD title '{structured.title}'",
            ))

    # Signal 2: High-value required skills present
    # Pick the top 3 required terms by JD frequency that are already matched
    matched_required = sorted(
        ats_after.match_result.required_matched,
        key=lambda d: _jd_frequency(d.term, structured),
        reverse=True,
    )
    for detail in matched_required[:3]:
        signals.append(ResumeStrengthSignal(
            signal=f"'{detail.term}' present",
            positive=True,
            detail=f"Required keyword matched in {detail.best_section.value if detail.best_section else 'resume'}",
        ))

    # Signal 3: YOE adequacy
    for check in ats_after.knockout.checks:
        if check["check"] == "years_of_experience" and check.get("required"):
            if check["passes"]:
                signals.append(ResumeStrengthSignal(
                    signal=f"YOE satisfied ({check['candidate']}yr ≥ {check['required']}yr required)",
                    positive=True,
                    detail="Years of experience meets the minimum requirement",
                ))
            else:
                signals.append(ResumeStrengthSignal(
                    signal=f"YOE gap ({check['candidate']}yr vs {check['required']}yr required)",
                    positive=False,
                    detail="Years of experience is below the minimum requirement — knockout risk",
                ))

    # Signal 4: Skills section present
    has_skills_section = bool(
        resume.blocks_by_section.get(ResumeSection.SKILLS)
    )
    if has_skills_section:
        signals.append(ResumeStrengthSignal(
            signal="Dedicated Skills section present",
            positive=True,
            detail="ATS systems weight keywords in a Skills section more heavily",
        ))
    else:
        signals.append(ResumeStrengthSignal(
            signal="No dedicated Skills section detected",
            positive=False,
            detail="Adding a Skills section increases keyword placement weight in ATS scoring",
        ))

    # Signal 5: Recency — most recent role year
    recent_years = [
        b.recency_year for b in exp_blocks
        if b.recency_year is not None
    ]
    if recent_years:
        most_recent = max(recent_years)
        gap = _CURRENT_YEAR - most_recent
        if gap <= 1:
            signals.append(ResumeStrengthSignal(
                signal=f"Recent experience ({most_recent})",
                positive=True,
                detail="Most recent role is current or within the past year",
            ))
        elif gap >= 3:
            signals.append(ResumeStrengthSignal(
                signal=f"Experience gap detected (last role: {most_recent})",
                positive=False,
                detail=f"Most recent role was {gap} years ago — some ATS systems flag career gaps",
            ))

    return signals


def _build_pass_band(
    ats_before: ATSResult,
    ats_after: ATSResult,
    structured: StructuredJD,
) -> ATSPassBandResult:
    band_before = _score_to_band(
        ats_before.score_components.required_score,
        ats_before.passes_knockouts,
    )
    band_after = _score_to_band(
        ats_after.score_components.required_score,
        ats_after.passes_knockouts,
    )

    strength_signals = _build_strength_signals(ats_after, structured)

    return ATSPassBandResult(
        band_before=band_before,
        band_after=band_after,
        label_before=_BAND_LABELS[band_before],
        label_after=_BAND_LABELS[band_after],
        band_changed=band_before != band_after,
        explanation=_BAND_EXPLANATIONS[band_after],
        strength_signals=strength_signals,
    )


# ─────────────────────────────────────────────────────────────────────────────
#  LAYER 5 BUILDER
# ─────────────────────────────────────────────────────────────────────────────

def _build_action_queue(
    ats_after: ATSResult,
    structured: StructuredJD,
    max_actions: int = 10,
) -> List[PrioritisedAction]:
    """
    Ranked manual actions the user should take after tailoring.
    Builds from the after-state — everything still missing or in weak position.
    """
    actions: List[PrioritisedAction] = []
    rank = 1

    # Priority HIGH: Required terms still missing after tailoring
    # These are the most urgent — they're eliminating the application
    for detail in ats_after.match_result.required_missing:
        freq = _jd_frequency(detail.term, structured)
        score_pts = round(
            DEFAULT_CONFIG.weight_required * 100
            / max(ats_after.score_components.required_total_count, 1),
            1,
        )
        actions.append(PrioritisedAction(
            priority=ActionPriority.HIGH,
            rank=rank,
            term=detail.term,
            action=f"Add '{detail.term}' explicitly to your resume",
            section_target="Skills section (highest ATS weight) or a recent Experience bullet",
            reason=(
                f"Required keyword — absent from resume. Appears {freq}× in JD. "
                f"ATS systems filter on required terms — this is an eliminator."
            ),
            score_impact_estimate=f"+{score_pts} pts required coverage",
            jd_frequency=freq,
        ))
        rank += 1

    # Priority MEDIUM: Required terms found only in low-weight sections
    # (placement upgrade — data is free from scorer)
    WEAK_SECTIONS = {ResumeSection.EDUCATION, ResumeSection.OTHER}
    for detail in ats_after.match_result.required_matched:
        if detail.best_section in WEAK_SECTIONS:
            freq = _jd_frequency(detail.term, structured)
            actions.append(PrioritisedAction(
                priority=ActionPriority.MEDIUM,
                rank=rank,
                term=detail.term,
                action=f"Move '{detail.term}' from {detail.best_section.value} to Skills section",
                section_target="Skills section",
                reason=(
                    f"Currently only found in {detail.best_section.value} "
                    f"(low ATS weight). Skills section match is weighted 1.5× higher."
                ),
                score_impact_estimate="+1–2 pts placement score",
                jd_frequency=freq,
            ))
            rank += 1

    # Priority MEDIUM: Preferred terms missing (cap at 5)
    for detail in ats_after.match_result.preferred_missing[:5]:
        freq = _jd_frequency(detail.term, structured)
        score_pts = round(
            DEFAULT_CONFIG.weight_preferred * 100
            / max(ats_after.score_components.preferred_total_count, 1),
            1,
        )
        actions.append(PrioritisedAction(
            priority=ActionPriority.MEDIUM,
            rank=rank,
            term=detail.term,
            action=f"Consider adding '{detail.term}' if it reflects your experience",
            section_target="Skills section or relevant Experience bullet",
            reason=(
                f"Preferred keyword — differentiates candidates who pass the required filter. "
                f"Appears {freq}× in JD."
            ),
            score_impact_estimate=f"+{score_pts} pts preferred coverage",
            jd_frequency=freq,
        ))
        rank += 1

    # Priority LOW: Required terms only in old roles (recency)
    RECENCY_THRESHOLD = _CURRENT_YEAR - 4
    for detail in ats_after.match_result.required_matched:
        if (
            detail.most_recent_year
            and detail.most_recent_year < RECENCY_THRESHOLD
            and detail.best_section not in WEAK_SECTIONS
        ):
            freq = _jd_frequency(detail.term, structured)
            actions.append(PrioritisedAction(
                priority=ActionPriority.LOW,
                rank=rank,
                term=detail.term,
                action=(
                    f"Add '{detail.term}' to a more recent role "
                    f"(currently last seen in {detail.most_recent_year})"
                ),
                section_target=f"Experience bullet from {_CURRENT_YEAR - 2} or later",
                reason="Recency matters — skills in recent roles are weighted higher.",
                score_impact_estimate="+0.5–1 pt recency score",
                jd_frequency=freq,
            ))
            rank += 1

    # Sort within each priority by JD frequency (higher freq = more impactful)
    def sort_key(a: PrioritisedAction):
        priority_order = {ActionPriority.HIGH: 0, ActionPriority.MEDIUM: 1, ActionPriority.LOW: 2}
        return (priority_order[a.priority], -a.jd_frequency)

    actions.sort(key=sort_key)

    # Re-rank after sort
    for i, action in enumerate(actions, start=1):
        action.rank = i

    return actions[:max_actions]


# ═══════════════════════════════════════════════════════════════════════════════
#  PUBLIC API — single entry point
# ═══════════════════════════════════════════════════════════════════════════════

def generate_analytics_report(
    original_ast: dict,
    tailored_ast: dict,
    structured_jd: StructuredJD,
    validated_bullets: List[dict],
    config: ATSConfig = DEFAULT_CONFIG,
    override_candidate_yoe: Optional[int] = None,
) -> TailoringAnalyticsReport:
    """
    Generate the full before/after analytics report.

    Args:
        original_ast:      state["block_ast"] — original resume, already parsed
        tailored_ast:      state["tailored_block_ast"] — tailored resume AST
                           Must be produced by run_rebuilder after validate_changes
        structured_jd:     state["structured_jd"] — from jd_structurer
        validated_bullets: state["tailored_bullets"] — accepted changes from validate_changes
        config:            ATSConfig — shared with ats_scorer for consistency

    Returns:
        TailoringAnalyticsReport with all 5 layers populated

    LangGraph integration:
        from analytics import generate_analytics_report

        def generate_analytics(state: AgentState):
            report = generate_analytics_report(
                original_ast      = state["block_ast"],
                tailored_ast      = state["tailored_block_ast"],
                structured_jd     = state["structured_jd"],
                validated_bullets = state["tailored_bullets"],
            )
            return {
                "analytics": report.to_dict(),
                "status": f"Analytics complete — ATS {report.score_delta.ats_before} → {report.score_delta.ats_after}",
            }
    """

    # Run ATS scorer on both resumes
    # This is the two-snapshot model — the only honest way to measure improvement
    ats_before = score_ats(original_ast, structured_jd, config, override_candidate_yoe=override_candidate_yoe)
    ats_after  = score_ats(tailored_ast, structured_jd, config, override_candidate_yoe=override_candidate_yoe)

    # Build each layer from the two snapshots + pipeline state
    score_delta     = _build_score_delta(ats_before, ats_after)
    keyword_movement = _build_keyword_movement(ats_before, ats_after, structured_jd)
    change_cards    = _build_change_cards(
        validated_bullets, ats_before, ats_after, structured_jd, original_ast
    )
    pass_band       = _build_pass_band(ats_before, ats_after, structured_jd)
    action_queue    = _build_action_queue(ats_after, structured_jd)

    return TailoringAnalyticsReport(
        generated_at=datetime.utcnow().isoformat() + "Z",
        jd_title=structured_jd.title or "Unknown Role",
        structuring_method=structured_jd.structuring_method,
        score_delta=score_delta,
        keyword_movement=keyword_movement,
        change_cards=change_cards,
        pass_band=pass_band,
        action_queue=action_queue,
        ats_before=ats_before,
        ats_after=ats_after,
    )