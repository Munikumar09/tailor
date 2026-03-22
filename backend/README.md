# Backend — AI Job Application Commander

FastAPI service that orchestrates job ingestion, semantic fit scoring, and a five-node LangGraph resume-tailoring agent.

---

## Directory Structure

```
backend/
├── main.py                    # FastAPI app, startup events, router mounts
├── models.py                  # SQLModel table definitions
├── database.py                # SQLite engine & session factory
├── requirements.txt           # Python dependencies
├── .env.example               # Environment variable template
│
├── agent/                     # LangGraph agent
│   ├── graph.py               # Workflow DAG definition
│   ├── nodes.py               # Node implementations
│   └── state.py               # AgentState TypedDict
│
├── api/                       # FastAPI route handlers
│   ├── jobs.py                # /jobs — listing, sync, status patch
│   ├── tailor.py              # /tailor — trigger tailoring pipeline
│   ├── profile.py             # /profile — resume & user profile
│   └── ingest.py              # /ingest — fetch jobs from JSearch
│
├── ingestion/
│   ├── jsearch.py             # JSearch (RapidAPI) client
│   └── filter.py              # Semantic fit scoring & LLM reason
│
├── resume_tailor/             # Multi-system tailoring pipeline
│   ├── pipeline.py            # Public entry point — analyze()
│   ├── jd_structurer.py       # LLM-based JD section parser
│   ├── keyword_gap_analyzer.py# NLP phrase extraction + semantic matching
│   ├── ats_scorer.py          # ATS keyword scoring & variant matching
│   ├── skill_extractor.py     # LLM-based skill gap classification
│   ├── extraction.py          # Resume section extraction helpers
│   └── types.py               # Shared dataclasses
│
├── utils/
│   ├── xml_ast.py             # .docx XML parser & exporter (format-safe)
│   ├── doc_processor.py       # Plain-text extraction & docx creation
│   ├── keyword_analyzer.py    # Tokenisation helpers
│   └── logger.py              # Structured logging config
│
├── uploads/                   # Master resume uploads
├── tailored_resumes/          # Generated tailored .docx files
└── jobs.db                    # SQLite database (WAL mode)
```

---

## Setup

```bash
cd backend
python3 -m venv venv
source venv/bin/activate        # Windows: .\venv\Scripts\activate

pip install -r requirements.txt

cp .env.example .env            # fill in your API keys
uvicorn main:app --reload       # http://localhost:8000
```

Swagger UI: `http://localhost:8000/docs`

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini Flash 2.5 — primary LLM |
| `GROQ_API_KEY` | Yes | Groq Llama-3.3-70b — automatic LLM fallback |
| `RAPIDAPI_KEY` | Yes | RapidAPI key for the JSearch job listings API |
| `DATABASE_URL` | No | SQLite path (default: `sqlite:///jobs.db`) |

---

## Database Models

### `Job`

| Column | Type | Description |
|--------|------|-------------|
| `id` | int PK | Auto-increment primary key |
| `company_name` | str | Employer name |
| `job_title` | str | Role title |
| `job_description` | str | Full JD text |
| `match_score` | int? | Semantic similarity score 0–100 |
| `match_reason` | str? | LLM skill-alignment summary (2 sentences) |
| `tailored_match_score` | int? | ATS score after tailoring |
| `tailored_match_reason` | str? | ATS pass-band label + score delta |
| `status` | enum | `PENDING` `TAILORING` `TAILORED` `APPLIED` `SKIPPED` |
| `sub_status` | str? | Fine-grained progress label shown in UI |
| `job_url` | str? | Original listing URL |
| `location` | str? | Job location |
| `salary` | str? | Salary string from listing |
| `tailored_resume_path` | str? | Path to generated `.docx` |
| `tailored_bullets` | JSON? | `[{id, old, new, keywordsAdded, reason}]` |
| `extracted_keywords` | JSON? | `[{kw, present, weight}]` from gap analysis |
| `analytics` | JSON? | Full `TailoringAnalyticsReport` |
| `logs` | JSON? | `[{msg, type, t}]` real-time progress entries |
| `composite_key` | str unique | Deduplication key (company + title + url hash) |
| `created_at` | datetime | Ingestion timestamp |

### `UserProfile`

| Column | Type | Description |
|--------|------|-------------|
| `full_name` | str | Candidate name |
| `current_title` | str | Current job title |
| `years_of_experience` | str | Self-reported YOE |
| `resume_path` | str? | Path to active master resume `.docx` |
| `skill_whitelist` | JSON? | Tokens extracted from master resume — used in tailoring prompt to prevent hallucination |
| `linkedin_url` | str? | LinkedIn profile URL |
| `preferred_work_mode` | str? | Remote / hybrid / on-site preference |
| `min_salary` | int? | Minimum acceptable salary |
| `min_ai_score` | int | Filter threshold (default 75) — jobs below this are skipped during ingestion |
| `ingestion_frequency` | str | Display label e.g. "Every 6h" |

### `ResumeVersion`

| Column | Type | Description |
|--------|------|-------------|
| `id` | int PK | |
| `version_label` | str | E.g. "Upload Mar 22", "Edit Mar 22, 14:30" |
| `content` | str | Extracted plain text (used for search / fallback rendering) |
| `file_path` | str? | Path to the `.docx` file for this version |
| `is_current` | bool | Only one version is current at a time |
| `created_at` | datetime | |

---

## API Endpoints

### Jobs — `/jobs`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/jobs/` | List all jobs; optional `?status=PENDING` filter |
| `GET` | `/jobs/{id}` | Single job with all fields |
| `PATCH` | `/jobs/{id}/status` | Update job status |
| `POST` | `/jobs/sync-with-master` | Recalculate `match_score` for **all** jobs (background task) |

### Tailoring — `/tailor`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/tailor/{job_id}` | Run the five-node tailoring pipeline |
| `GET` | `/tailor/{job_id}/status` | Poll real-time progress logs |

### Profile — `/profile`

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/profile/` | Get user profile |
| `POST` | `/profile/` | Update profile fields |
| `POST` | `/profile/resume` | Upload master `.docx` (creates initial version) |
| `GET` | `/profile/resume-text` | Plain text of current resume |
| `GET` | `/profile/resume-ast` | Structured paragraph + run AST for the resume viewer |
| `GET` | `/profile/resume-versions` | All versions ordered newest first |
| `POST` | `/profile/resume-save` | Save edited plain text as new version |
| `POST` | `/profile/resume-save-ast` | Save structured run edits as new version |
| `DELETE` | `/profile/resume-version/{id}` | Delete a version |
| `GET` | `/profile/resume-export/{id}` | Download version as `.docx` |

### Ingestion — `/ingest`

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/ingest/search` | Fetch jobs from JSearch, score, and save new ones |

### Files

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/download/{filename}` | Serve a generated `.docx` by relative path |

---

## Fit Scoring (`ingestion/filter.py`)

`match_score` is **pure semantic similarity** — no keyword matching, no penalties for years-of-experience or other hard requirements.

### Score calculation

1. Resume and JD are each encoded with `all-MiniLM-L6-v2` (same model used throughout the pipeline, loaded once at startup)
2. Cosine similarity is computed on the normalised embeddings
3. Linearly remapped to 0–100:

```
cos_sim ≤ 0.15  →   0   (unrelated fields)
cos_sim = 0.425 →  50   (moderate domain overlap)
cos_sim ≥ 0.70  → 100   (strong match)
```

### Reason text

A separate Gemini Flash call produces the `match_reason`. The prompt instructs the model to:
- Focus **only** on technical skills, tools, and domain knowledge overlap
- Explicitly **not** mention years of experience, education, or hard eligibility criteria
- Return exactly two sentences

### `sync-with-master`

Calling `POST /jobs/sync-with-master` recalculates `match_score` and `match_reason` for **every** job in the database (not just pending ones), so stale or zero scores are corrected after updating the master resume.

---

## LangGraph Tailoring Agent (`agent/`)

A linear five-node DAG compiled into a singleton `tailoring_app`.

```
START
  │
  ▼
[1] analyze_gap
    - Parses master resume to block AST (xml_ast.py)
    - Calls resume_tailor.pipeline.analyze():
        jd_structurer  → sections (LLM or rule-based fallback)
        keyword_gap_analyzer → exact + semantic keyword matching
        skill_extractor → LLM skill gap classification
    - Writes: extracted_keywords, keyword_analysis, structured_jd
  │
  ▼
[2] rewrite_bullets
    - Pre-filters blocks by relevance to missing keywords
    - Sends top blocks + missing keywords + skill whitelist to Gemini Flash
    - 13-rule prompt enforces: no fabrication, ≤1 example per tool
      category per bullet, no heading changes, max 8 blocks
    - Writes: tailored_bullets, modifications
  │
  ▼
[3] validate_changes
    - Schema-validates LLM output
    - Drops invalid or empty modifications
  │
  ▼
[4] generate_doc
    - Calls xml_ast.export_mutated_docx()
    - Replaces paragraph text at XML level
    - All original fonts, styles, and margins are preserved
    - Writes: final_resume_path
  │
  ▼
[5] generate_analytics
    - Runs ATS scorer on before/after resume texts
    - Computes score delta, keyword coverage, pass-band classification
    - Writes: analytics (saved to Job.analytics)
  │
  ▼
END
```

### `AgentState` schema (`agent/state.py`)

```python
job_id: int
job_description: str
master_resume_text: str
master_resume_path: str
extracted_keywords: List[Dict]     # [{kw, present, weight}]
skill_whitelist: List[str]         # from UserProfile.skill_whitelist
keyword_analysis: Dict             # {present[], missing[], coverage_pct}
tailored_bullets: List[Dict]       # [{id, old, new, keywordsAdded, reason}]
modifications: Dict[str, str]      # {block_id: new_paragraph_text}
final_resume_path: Optional[str]
status: str
block_ast: Optional[Dict]          # parsed resume XML structure
structured_jd: Optional[Dict]      # parsed JD sections
analytics: Optional[Dict]          # TailoringAnalyticsReport
```

---

## Resume Tailoring Pipeline (`resume_tailor/`)

### `pipeline.py` — public entry point

```python
from resume_tailor.pipeline import analyze, PipelineConfig

result = analyze(jd_text="...", resume_text="...")
# result.present     → list of matched keywords
# result.missing     → list of gap keywords
# result.coverage    → float 0–1
# result.summary()   → human-readable string
```

Can also run as a standalone FastAPI app or CLI — see the module docstring.

### Keyword matching — variant expansion

Before checking whether a JD keyword is present in the resume, a full set of equivalent variants is generated:

| Variant type | Example |
|-------------|---------|
| Hyphen | `full-stack` ↔ `full stack` |
| Abbreviation | `ML` ↔ `machine learning` |
| Plural/singular | `database` ↔ `databases` |
| Verb inflection | `fine-tune` ↔ `fine-tuning` ↔ `fine-tuned` |

### ATS scoring (`ats_scorer.py`)

- Weighted keyword scoring with section-aware bonuses
- Skills-section mentions score higher than body mentions
- Used for before/after analytics delta — not used for `match_score`

---

## Document Parsing & Export (`utils/xml_ast.py`)

The `.docx` file is a ZIP archive containing `word/document.xml`. The parser:

1. Reads the XML directly with `lxml`
2. Classifies each paragraph as `h1 / h2 / h3 / bullet / paragraph` based on style name and list properties
3. Extracts per-run properties: bold, italic, underline, font size (half-points → pt)
4. Assigns stable IDs: `b{paragraph_idx}` for blocks, `b{p_idx}_r{r_idx}` for runs

The exporter (`export_mutated_docx`) writes a new ZIP, replacing only the modified paragraphs' runs while copying all other XML parts (styles, fonts, images, relationships) byte-for-byte.

---

## Startup Events (`main.py`)

On every server start:

1. **Create tables** — `SQLModel.metadata.create_all()`
2. **Migrate** — adds missing columns to existing databases without dropping data
3. **Reset stuck jobs** — jobs in `TAILORING` state (server crashed mid-run) are reset to `PENDING`
4. **Preload NLP models** — spaCy `en_core_web_sm` and `all-MiniLM-L6-v2` load once at startup to avoid cold-start latency on the first tailoring request
