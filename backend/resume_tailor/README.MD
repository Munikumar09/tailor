# Resume Keyword Gap Analyzer v5

## Architecture

```
Raw JD (any format)
       │
       ▼
┌─────────────────────────────────────────────────┐
│  Layer 1: jd_structurer.py                      │
│                                                  │
│  PRIMARY: LLM (Claude Haiku)                     │
│    • Understands ANY format — Naukri, LinkedIn,  │
│      Greenhouse, Lever, Workday, hand-written    │
│    • Verbatim text → clean JSON sections         │
│    • ~1–2s, ~$0.001/call                        │
│                                                  │
│  FALLBACK: Rule-based (if LLM unavailable)       │
│    • Section keyword detection                   │
│    • Metadata footer stripping                   │
│    • ~50ms, zero cost                           │
│                                                  │
│  OUTPUT: StructuredJD                            │
│    { title, required[], preferred[],             │
│      responsibilities[], about[], other[] }      │
└─────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────┐
│  Layer 2: keyword_gap_analyzer_v5.py            │
│                                                  │
│  • Tech-safe tokenization (CamelCase, CI/CD...) │
│  • Phrase extraction with quality filter         │
│  • Subphrase deduplication                       │
│  • Section-aware weighted scoring                │
│  • BM25 candidate retrieval (reduce embed calls) │
│  • Embedding-based semantic matching             │
│  • ATS-realistic: required terms = zero credit  │
│  • YOE extraction + resume matching              │
│  • Critical missing classification               │
└─────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────┐
│  Layer 3: pipeline.py                           │
│                                                  │
│  Interfaces:                                     │
│    1. Python function: analyze(jd, resume)       │
│    2. FastAPI: POST /analyze                     │
│    3. CLI: python pipeline.py --jd --resume      │
└─────────────────────────────────────────────────┘
```

## Installation

```bash
# 1. CPU-only torch (install BEFORE sentence-transformers)
pip install torch==2.7.0 --index-url https://download.pytorch.org/whl/cpu

# 2. Everything else
pip install -r requirements.txt

# 3. spaCy language model
python -m spacy download en_core_web_sm
```

## Configuration

Set your Anthropic API key (for LLM structuring):
```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Without the key, the system automatically uses the rule-based fallback — it still works, just less robust on unusual formats.

## Usage

### Python

```python
from pipeline import analyze

result = analyze(
    jd_text=open("jd.txt").read(),
    resume_text=open("resume.txt").read()
)

print(result.summary())

# Access structured breakdown
print(result.required_missing)    # hard gaps
print(result.preferred_missing)   # soft gaps
print(result.coverage_score)      # 0–100
print(result.critical_missing)    # highest priority to fix

# YOE
for req in result.yoe.unsatisfied:
    print(f"Missing: {req.raw_text}")

# Full JSON (for APIs/storage)
import json
print(json.dumps(result.to_dict(), indent=2))
```

### CLI

```bash
# Full analysis
python pipeline.py --jd jd.txt --resume resume.txt

# Fast mode (no embeddings)
python pipeline.py --jd jd.txt --resume resume.txt --no-semantic

# Skip LLM structuring (rule-based only)
python pipeline.py --jd jd.txt --resume resume.txt --force-fallback

# JSON output
python pipeline.py --jd jd.txt --resume resume.txt --json > result.json

# Preview JD structure only (before gap analysis)
python pipeline.py --jd jd.txt --resume resume.txt --structure-only
```

### FastAPI Server

```bash
pip install fastapi uvicorn
uvicorn pipeline:app --host 0.0.0.0 --port 8000 --reload
```

Endpoints:
```
POST /analyze          Full pipeline
POST /structure        JD structuring only (preview)
GET  /health           Health check
GET  /docs             Swagger UI
```

Request:
```json
POST /analyze
{
  "jd_text": "...",
  "resume_text": "...",
  "use_semantic": true,
  "force_fallback": false
}
```

## Connecting to the Resume Tailoring Engine

The gap analyzer feeds into the tailoring engine:

```python
from pipeline import analyze
from pipeline import PipelineConfig

result = analyze(jd_text, resume_text)

# Feed into tailoring engine
tailoring_input = {
    "criticalMissing": result.critical_missing,     # inject these
    "requiredMissing": result.required_missing,     # required gaps
    "preferredMissing": result.preferred_missing,   # nice-to-have gaps
    "coverageScore": result.coverage_score,
    "jdTitle": result.structured_jd.title,
    "requiredSection": result.structured_jd.required,  # for context
}
```

## Why LLM Pre-Structuring Beats Rules

| Scenario | Rule-based | LLM-structured |
|---|---|---|
| "Minimum Qualification:" | ❌ Missed (singular) | ✅ |
| "What We're Looking For:" | ❌ Missed | ✅ |
| "The Ideal Candidate Has:" | ❌ Missed | ✅ |
| Naukri metadata footer | Partial ⚠️ | ✅ Stripped |
| "Role:" as category field | ❌ Wrong title | ✅ Correct title |
| Mixed language JDs | ❌ Fails | ✅ |
| Non-standard bullet chars | Partial ⚠️ | ✅ |
| Inline "is a plus" signals | ❌ Missed | ✅ |

## File Structure

```
jd_structurer.py            Layer 1 — LLM + fallback structurer
keyword_gap_analyzer_v5.py  Layer 2 — pure gap analysis
pipeline.py                 Layer 3 — public interface
requirements.txt            Dependencies
README.md                   This file
```