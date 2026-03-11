# Import first — initialises the singleton logging service before anything else logs.
from utils.logger import get_logger

logger = get_logger(__name__)

import os

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlmodel import Session
from database import create_db_and_tables, get_session
import models
from api import jobs, ingest, profile, tailor

app = FastAPI(title="AI Job Application Commander API")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    create_db_and_tables()


app.include_router(jobs.router)
app.include_router(ingest.router)
app.include_router(profile.router)
app.include_router(tailor.router)


@app.get("/download/{filename:path}")
async def download_file(filename: str):
    # Security note: In a real app, validate path/filename strictly
    paths = [
        "tailored_resumes",
        "uploads",
        "backend/tailored_resumes",
        "backend/uploads",
    ]
    logger.debug("Downloading %s — CWD: %s", filename, os.getcwd())
    for p in paths:
        full_path = os.path.join(p, filename)
        logger.debug("Checking path: %s", full_path)
        if os.path.exists(full_path):
            return FileResponse(full_path, filename=filename)

    raise HTTPException(status_code=404, detail=f"File not found: {filename}")


@app.get("/")
def read_root():
    return {"message": "AI Job Application Commander API is running"}
