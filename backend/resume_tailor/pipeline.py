"""
pipeline.py
===========
Layer 3 — the single public entry point for the gap analysis system.

Wires jd_structurer → keyword_gap_analyzer_v5 together.
Exposes three interfaces:
  1. analyze()          — simple Python function call
  2. FastAPI app        — run with: uvicorn pipeline:app --reload
  3. CLI               — run with: python pipeline.py --jd jd.txt --resume resume.txt

Usage (Python):
    from pipeline import analyze

    result = analyze(jd_text=open("jd.txt").read(), resume_text=open("resume.txt").read())
    print(result.summary())

Usage (FastAPI):
    uvicorn pipeline:app --host 0.0.0.0 --port 8000

    POST /analyze
    {
      "jd_text": "...",
      "resume_text": "...",
      "use_semantic": true
    }

Usage (CLI):
    python pipeline.py --jd jd.txt --resume resume.txt
    python pipeline.py --jd jd.txt --resume resume.txt --no-semantic  # fast mode
    python pipeline.py --jd jd.txt --resume resume.txt --force-fallback  # skip LLM structurer
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from typing import Optional
from utils.logger import get_logger

logger = get_logger(__name__)

from .jd_structurer import LLMConfig, StructuredJD, structure_jd, structure_jd_async
from .keyword_gap_analyzer import (
    AnalyzerConfig,
    GapAnalysisResult,
    analyze_gap,
    preload_models,
)


# ═══════════════════════════════════════════════════════════════════════════════
#  PIPELINE CONFIG
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class PipelineConfig:
    llm: LLMConfig = None
    analyzer: AnalyzerConfig = None
    use_semantic: bool = True
    force_fallback: bool = False    # force rule-based structurer (skip LLM)

    def __post_init__(self):
        if self.llm is None:
            self.llm = LLMConfig()
        if self.analyzer is None:
            self.analyzer = AnalyzerConfig()


DEFAULT_PIPELINE_CONFIG = PipelineConfig()


# ═══════════════════════════════════════════════════════════════════════════════
#  INTERFACE 1 — PYTHON FUNCTION
# ═══════════════════════════════════════════════════════════════════════════════

def analyze(
    jd_text: str,
    resume_text: str,
    config: PipelineConfig = DEFAULT_PIPELINE_CONFIG,
) -> GapAnalysisResult:
    """
    Full pipeline: raw JD + raw resume → GapAnalysisResult.

    Step 1: LLM structures the JD into clean sections (with rule-based fallback)
    Step 2: Gap analyzer runs on the clean structured data

    Args:
        jd_text:      Raw job description text (any format)
        resume_text:  Raw resume text
        config:       Pipeline configuration

    Returns:
        GapAnalysisResult with full analysis + reference to StructuredJD
    """
    t_start = time.perf_counter()

    # Step 1: Structure the JD
    logger.info("Step 1: Structuring JD...")
    structured = structure_jd(
        jd_text,
        llm_config=config.llm,
        force_fallback=config.force_fallback,
    )
    logger.info(
        f"JD structured via '{structured.structuring_method}' "
        f"in {structured.structuring_latency_ms}ms. "
        f"Title: '{structured.title}' | "
        f"Required: {len(structured.required)} items | "
        f"Preferred: {len(structured.preferred)} items"
    )

    # Step 2: Analyze gap
    logger.info("Step 2: Analyzing keyword gap...")
    result = analyze_gap(
        structured=structured,
        resume_text=resume_text,
        config=config.analyzer,
        use_semantic=config.use_semantic,
    )

    total_ms = int((time.perf_counter() - t_start) * 1000)
    logger.info(
        f"Analysis complete in {total_ms}ms. "
        f"Coverage: {result.coverage_score:.1f}% | "
        f"Critical missing: {len(result.critical_missing)}"
    )

    return result