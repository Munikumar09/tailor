# 🚀 Project Master Document: AI Job Application Commander (Phase 1: HITL MVP)

## 1. Project Overview

**Goal:** Build a highly effective, Human-in-the-Loop (HITL) job application pipeline that automates job discovery, ATS-compatibility filtering, and resume tailoring, while leaving the final "Apply" action to the user to bypass complex CAPTCHAs and bot protections.

**Core Philosophy:**

1. **Ingest smartly:** Use APIs, not brittle custom scrapers.
2. **Filter ruthlessly:** Use cheap LLMs to score job fit before wasting tokens on tailoring.
3. **Tailor perfectly:** Use a LangGraph agent to inject exact Job Description (JD) keywords into a Master Resume without hallucinating skills.
4. **Command centrally:** Manage the entire flow via a snappy Next.js dashboard.

---

## 2. Technology Stack

### Frontend (User Interface)

- **Framework:** Next.js 14+ (App Router)
- **Language:** TypeScript (Strict Mode)
- **Styling:** Tailwind CSS
- **Components:** shadcn/ui (Radix UI primitives)
- **Icons:** `lucide-react`
- **State / Data Fetching:** `@tanstack/react-query` (React Query)

### Backend (API & Orchestration)

- **Framework:** FastAPI (Python 3.11+)
- **Database:** SQLite (using `SQLModel` or `SQLAlchemy` ORM)
- **Data Validation:** Pydantic v2
- **Agentic Orchestration:** LangGraph (for the Resume Tailoring pipeline)
- **Document Generation:** `python-docx` (for native ATS-friendly Word docs) or `WeasyPrint` (for PDFs)

### External Services

- **Job Data Ingestion:** JSearch API (via RapidAPI) or Apify Actors.
- **LLM (Filtering):** Gemini 1.5 Flash / Claude 3.5 Haiku / GPT-4o-mini (Low cost, high speed).
- **LLM (Tailoring):** Claude 3.7 Sonnet / Gemini 2.0 Pro / GPT-4o (High reasoning capabilities).

---

## 3. System Architecture & Data Flow

1. **The Ingestion Cron:** A Python background script runs every X hours. It calls the JSearch/Apify API, fetches jobs matching specific titles in the last 24h, and creates a deduplicated composite key (`Company_Name` + `Job_Title`).
2. **The Fast Filter (LLM-as-a-Judge):** The script passes the fetched JD and the user's Master Resume to a fast/cheap LLM. It returns a strict JSON object: `{"score": 85, "reason": "..."}`. Jobs scoring `< 75` are discarded.
3. **Database Storage:** Passing jobs are saved to the local SQLite database with status `Pending`.
4. **UI Review:** The user opens the Next.js Dashboard. They see the passing jobs, read the `match_reason`, and click **"Tailor Resume"**.
5. **Agentic Tailoring (LangGraph):** FastAPI triggers LangGraph. The LLM extracts required keywords from the JD, rewrites the master resume bullets to reflect these keywords (without hallucinating), and generates a downloadable `.docx`/`.pdf`.
6. **Action:** The user downloads the generated file, clicks the JD link, applies manually, and updates the status to `Applied` in the UI.