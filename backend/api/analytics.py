from fastapi import APIRouter, Depends
from sqlmodel import Session, select
from database import get_session
from models import Job, JobStatus
from datetime import datetime, timedelta
from collections import Counter, defaultdict

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/summary")
def get_analytics_summary(session: Session = Depends(get_session)):
    """
    Single endpoint that returns everything the analytics page needs.
    Computed on-the-fly from the live database — no caching.
    """
    jobs = session.exec(select(Job)).all()

    total = len(jobs)

    # ── Top-level stats ───────────────────────────────────────────────────────
    tailored_jobs = [j for j in jobs if j.status == JobStatus.TAILORED]
    applied_jobs  = [j for j in jobs if j.status == JobStatus.APPLIED]
    skipped_jobs  = [j for j in jobs if j.status == JobStatus.SKIPPED]

    scored_jobs   = [j for j in jobs if j.match_score is not None and j.match_score > 0]
    avg_score     = round(sum(j.match_score for j in scored_jobs) / len(scored_jobs)) if scored_jobs else 0

    # ── Timeline: jobs ingested per day, last 30 days ────────────────────────
    today            = datetime.utcnow().date()
    thirty_days_ago  = today - timedelta(days=29)

    daily_counts: dict = defaultdict(int)
    for job in jobs:
        job_date = job.created_at.date() if isinstance(job.created_at, datetime) else today
        if job_date >= thirty_days_ago:
            daily_counts[str(job_date)] += 1

    timeline = [
        {
            "date":  str(thirty_days_ago + timedelta(days=i)),
            "count": daily_counts.get(str(thirty_days_ago + timedelta(days=i)), 0),
        }
        for i in range(30)
    ]

    # ── Score distribution ────────────────────────────────────────────────────
    buckets = {"90–100": 0, "80–89": 0, "70–79": 0, "60–69": 0, "<60": 0}
    for job in jobs:
        s = job.match_score or 0
        if   s >= 90: buckets["90–100"] += 1
        elif s >= 80: buckets["80–89"]  += 1
        elif s >= 70: buckets["70–79"]  += 1
        elif s >= 60: buckets["60–69"]  += 1
        else:         buckets["<60"]    += 1

    max_bucket = max(buckets.values(), default=1) or 1
    score_distribution = [
        {"range": k, "count": v, "pct": round(v / max_bucket * 100)}
        for k, v in buckets.items()
    ]

    # ── Top companies ─────────────────────────────────────────────────────────
    company_counts = Counter(j.company_name for j in jobs if j.company_name)
    top_companies  = [
        {"company": c, "count": n}
        for c, n in company_counts.most_common(8)
    ]

    # ── Keyword analysis (from extracted_keywords on tailored jobs) ───────────
    kw_stats: dict = defaultdict(lambda: {"present": 0, "missing": 0})
    for job in jobs:
        if not job.extracted_keywords:
            continue
        for kw in job.extracted_keywords:
            name = kw.get("kw", "").strip()
            if not name:
                continue
            if kw.get("present"):
                kw_stats[name]["present"] += 1
            else:
                kw_stats[name]["missing"] += 1

    top_keywords = sorted(
        [
            {
                "keyword": k,
                "present": v["present"],
                "missing": v["missing"],
                "total":   v["present"] + v["missing"],
            }
            for k, v in kw_stats.items()
        ],
        key=lambda x: x["total"],
        reverse=True,
    )[:10]

    # ── Status breakdown + pipeline conversion ────────────────────────────────
    status_counts = Counter(str(j.status.value) for j in jobs)

    def pct(num: int, denom: int) -> int:
        return round(num / denom * 100) if denom else 0

    non_skipped = total - len(skipped_jobs)

    pipeline = [
        {
            "label": "Ingested → Tailored",
            "value": pct(len(tailored_jobs) + len(applied_jobs), total),
        },
        {
            "label": "Tailored → Applied",
            "value": pct(len(applied_jobs), len(tailored_jobs) + len(applied_jobs)),
        },
        {
            "label": "Applied rate (all jobs)",
            "value": pct(len(applied_jobs), total),
        },
        {
            "label": "Skip rate",
            "value": pct(len(skipped_jobs), total),
        },
    ]

    return {
        "stats": {
            "total_jobs":       total,
            "avg_match_score":  avg_score,
            "resumes_tailored": len(tailored_jobs) + len(applied_jobs),
            "applications_sent": len(applied_jobs),
        },
        "timeline":           timeline,
        "score_distribution": score_distribution,
        "top_companies":      top_companies,
        "top_keywords":       top_keywords,
        "status_breakdown": {
            "pending":  status_counts.get("Pending", 0),
            "tailored": status_counts.get("Tailored", 0),
            "applied":  status_counts.get("Applied", 0),
            "skipped":  status_counts.get("Skipped", 0),
        },
        "pipeline": pipeline,
    }
