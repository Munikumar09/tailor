# AI Job Application Commander - Backend Flow Diagrams

This document outlines the request-to-response flow for the primary endpoints in the backend.

---

## 1. Jobs API

### `GET /jobs/`
Fetches a list of ingested jobs.

```mermaid
graph TD
    A[Request: GET /jobs/] --> B{Query Params: status?}
    B --> C[SQLModel: select Job]
    C --> D[SQLAlchemy: Execute SELECT FROM job]
    D --> E[FastAPI: Serialize List of Job models]
    E --> F[Response: 200 OK + JSON Array]
```

### `POST /jobs/sync-with-master`
Triggers background recalculation of match scores.

```mermaid
graph TD
    A[Request: POST /sync-with-master] --> B[BackgroundTasks: add_task run_sync_with_master]
    B --> C[Response: 200 OK + Sync Started Message]
    
    subgraph Background Task
    D[Fetch UserProfile & Master Resume] --> E[Extract Text from .docx]
    E --> F[Fetch all PENDING Jobs]
    F --> G[Loop: For each Job]
    G --> H[LLM: score_job_fit JD vs Resume]
    H --> I[Update Job match_score & reason]
    I --> J[SQLModel: session.commit]
    end
```

---

## 2. Profile API

### `POST /profile/resume`
Uploads a master resume and extracts initial data.

```mermaid
graph TD
    A[Request: POST /profile/resume] --> B[Save .docx to uploads/]
    B --> C[doc_processor: extract_text_from_docx]
    C --> D[keyword_analyzer: tokenize skills]
    D --> E[Update UserProfile resume_path & skill_whitelist]
    E --> F[SQLModel: Create ResumeVersion v1]
    F --> G[SQLModel: session.commit]
    G --> H[Response: 200 OK + Success Message]
```

---

## 3. Ingestion API

### `POST /ingest/`
Triggers an automated job search and filtering loop.

```mermaid
graph TD
    A[Request: POST /ingest/] --> B[BackgroundTasks: add_task run_ingestion_sync]
    B --> C[Response: 202 Accepted + Process Started]

    subgraph Background Ingestion
    D[JSearch: fetch_jobs based on profile] --> E[Loop: For each raw job]
    E --> F{Duplicate Check?}
    F -- No --> G[LLM: score_job_fit]
    G --> H{Score >= min_ai_score?}
    H -- Yes --> I[SQLModel: Create Job PENDING]
    I --> J[SQLModel: session.commit]
    F -- Yes --> E
    H -- No --> E
    end
```

---

## 4. Tailoring API (The 7-System Pipeline)

### `POST /tailor/{job_id}`
Triggers the full AI tailoring workflow.

```mermaid
graph TD
    A[Request: POST /tailor/job_id] --> B[SQLModel: Update Job status to TAILORING]
    B --> C[BackgroundTasks: add_task run_tailoring_task]
    C --> D[Response: 200 OK + Process Started]

    subgraph 7-System Agent Pipeline
    E[System 1: Extract XML AST from Resume] --> F[System 2: Analyze Keyword Gap JD vs Resume]
    F --> G[System 3: Generate Tailoring Strategy]
    G --> H[System 4: AI Rewriter Gemini-driven injection]
    H --> I[System 5: Schema & Fabrication Validator]
    I --> J[System 6: Style & Tone Consistency Refiner]
    J --> K[System 7: XML Exporter Generate .docx]
    end

    subgraph Post-Pipeline
    L[LLM: Recalculate match score for Tailored doc] --> M[SQLModel: Update Job TAILORED + Bullets]
    M --> N[SQLModel: session.commit]
    end
    
    K --> L
```

---

## 5. File Download

### `GET /download/{filename}`
Serves tailored or uploaded documents.

```mermaid
graph TD
    A[Request: GET /download/filename] --> B{File exists in /tailored_resumes or /uploads?}
    B -- Yes --> C[FastAPI: FileResponse]
    B -- No --> D[Response: 404 Not Found]
```
