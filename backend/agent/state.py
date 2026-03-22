from typing import Any, TypedDict, List, Dict, Optional
from utils.logger import get_logger

logger = get_logger(__name__)


class AgentState(TypedDict):
    job_id: int
    job_description: str
    master_resume_text: str
    master_resume_path: str
    extracted_keywords: List[Dict]  # { kw, present, weight }
    skill_whitelist: List[str]
    keyword_analysis: Dict  # { present[], missing[], coverage% }
    tailored_bullets: List[Dict]  # { id, old, new, keywordsAdded, reason }
    modifications: Dict[str, str]  # { block_id: newText }
    final_resume_path: Optional[str]
    status: str
    # Set by analyze_gap; reused by rewrite_bullets, validate_changes + generate_analytics
    block_ast: Optional[Dict]
    # Set by analyze_gap; consumed by generate_analytics for ATS scoring
    structured_jd: Optional[Any]
    # Set by generate_analytics; stored in Job.analytics
    analytics: Optional[Dict]
