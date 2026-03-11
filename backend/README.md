# AI Job Application Commander - Backend

The backend for the AI Job Application Commander is a high-performance FastAPI service powered by a sophisticated **7-System Agent Architecture** using **LangGraph** and **Gemini Flash**. It handles job ingestion, resume parsing (preserving XML/formatting), and surgical keyword injection.

## 🚀 Core Features

-   **7-System Agent Pipeline:** A modular multi-agent workflow for resume tailoring.
    1.  **Document Parsing:** Extracts XML nodes from `.docx` while maintaining formatting.
    2.  **Keyword Gap Analysis:** Local NLP analysis to identify missing tech terms.
    3.  **Tailoring Strategy:** Generates a prioritized plan for keyword injection.
    4.  **AI Rewriter (Gemini):** Surgically rewrites bullet points to align with JDs.
    5.  **Schema Validator:** Ensures AI outputs strictly follow structural rules.
    6.  **Style Refiner:** Verifies tone consistency and formatting integrity.
    7.  **XML Exporter:** Re-injects modified text into the original `.docx` structure.
-   **Preservation Engine:** Uses `python-docx` and low-level XML manipulation (`lxml`) to ensure the generated resume looks identical to the master resume (fonts, margins, spacing).
-   **Smart Ingestion:** Fetches jobs via JSearch API and filters them based on a personalized AI match score.
-   **Database:** Uses **SQLModel** (SQLAlchemy + Pydantic) with SQLite for job tracking and profile management.

## 🛠️ Tech Stack

-   **Framework:** FastAPI
-   **Orchestration:** LangGraph (Stateful Multi-Agent Workflows)
-   **LLM:** Google Gemini Flash 1.5
-   **Database:** SQLModel / SQLite
-   **Doc Processing:** `python-docx` + `lxml`
-   **Validation:** Pydantic v2

## 📦 Installation

1.  **Navigate to the backend directory:**
    ```bash
    cd backend
    ```

2.  **Create and activate a virtual environment:**
    ```bash
    python -m venv venv
    source venv/bin/bin/activate  # Linux/macOS
    # or
    .\venv\Scripts\activate      # Windows
    ```

3.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Set up environment variables:**
    Create a `.env` file in the `backend/` directory:
    ```env
    GEMINI_API_KEY=your_gemini_api_key_here
    RAPIDAPI_KEY=your_rapidapi_key_here (for JSearch)
    ```

## 🏃 Running the Server

Start the FastAPI server with Uvicorn:

```bash
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`. You can access the interactive Swagger documentation at `http://localhost:8000/docs`.

## 📂 Project Structure

-   `api/`: Route handlers for jobs, ingestion, profile, and tailoring.
-   `agent/`: The LangGraph state machine and node definitions.
-   `ingestion/`: Logic for external job search and filtering.
-   `models.py`: Database schema definitions using SQLModel.
-   `database.py`: SQLAlchemy engine and session configuration.
-   `utils/`: Core utilities for `.docx` XML manipulation and keyword analysis.
-   `uploads/`: Storage for master resumes.
-   `tailored_resumes/`: Storage for generated tailored documents.

## 📡 Key Endpoints

-   `GET /jobs/`: Fetch all ingested jobs with match scores.
-   `POST /tailor/{job_id}`: Trigger the 7-system tailoring pipeline.
-   `GET /profile/`: Manage user skills and master resume.
-   `POST /ingest/search`: Trigger manual job ingestion from JSearch.
-   `GET /download/{filename}`: Securely serve generated `.docx` files.

## 🧪 Development & Testing

Run individual component tests:
```bash
python test_agent_direct.py  # Test the LangGraph flow
python verify_flow.py        # Verify the full end-to-end integration
```
