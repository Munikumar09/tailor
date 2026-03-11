# AI Job Application Commander (Phase 1: HITL MVP)

This project is a Human-in-the-Loop job application pipeline.

## Structure

- `/backend`: FastAPI + SQLite + LangGraph
- `/frontend`: Next.js 14 + Tailwind CSS + TanStack Query

## Getting Started

### Backend

1. Navigate to `backend/`
2. Create virtual environment: `python3 -m venv venv`
3. Activate: `source venv/bin/activate`
4. Install dependencies: `pip install -r requirements.txt`
5. Run server: `uvicorn main:app --reload`

### Frontend

1. Navigate to `frontend/`
2. Install dependencies: `npm install`
3. Run development server: `npm run dev`

## Core Features (Phase 1)

- [x] Backend API Scaffolding
- [x] Database Models (Jobs, User Profile)
- [x] Frontend Dashboard Layout
- [ ] Job Ingestion Logic (JSearch API)
- [ ] LLM-based Fit Scoring
- [ ] Resume Tailoring Agent (LangGraph)
- [ ] Master Resume Management
