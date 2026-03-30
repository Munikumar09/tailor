from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlmodel import Session, select, desc
from database import get_session
from models import UserProfile, ResumeVersion
from utils.doc_processor import extract_text_from_docx, save_text_to_docx
from utils.xml_ast import parse_docx_to_block_ast, export_mutated_docx
from utils.keyword_analyzer import tokenize
from utils.resume_builder import (
    extract_text_from_pdf,
    extract_resume_sections_llm,
    build_resume_docx_classic,
    build_resume_docx_modern,
    build_resume_docx_elegant,
    build_resume_docx_minimal,
    build_resume_docx_slate,
    build_resume_docx_executive,
)
from utils.logger import get_logger
import os
import shutil
import tempfile
import time
from datetime import datetime

logger = get_logger(__name__)

router = APIRouter(prefix="/profile", tags=["Profile"])

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.get("/", response_model=UserProfile)
def get_profile(session: Session = Depends(get_session)):
    profile = session.exec(select(UserProfile)).first()
    if not profile:
        return UserProfile(full_name="", current_title="", years_of_experience="")
    return profile


def _blocks_to_paragraphs(blocks: list) -> list:
    """Transform internal block AST to the frontend paragraph/runs shape."""
    paragraphs = []
    for block in blocks:
        runs = []
        for run in block["runs"]:
            runs.append({
                "id": run["id"],
                "text": run["text"],
                "bold": run["bold"],
                "italic": run["italic"],
                "underline": run.get("underline", False),
                "fontSize": run.get("fontSize"),
            })
        paragraphs.append({
            "id": block["id"],
            "style": block["type"],   # "h1" | "h2" | "h3" | "bullet" | "paragraph"
            "ilvl": block.get("ilvl", 0),
            "runs": runs,
        })
    return paragraphs


@router.get("/resume-ast")
def get_resume_ast(version_id: int = None, session: Session = Depends(get_session)):
    if version_id:
        version = session.get(ResumeVersion, version_id)
    else:
        version = session.exec(
            select(ResumeVersion).where(ResumeVersion.is_current == True)
        ).first()

    if version and version.file_path and os.path.exists(version.file_path):
        ast = parse_docx_to_block_ast(version.file_path)
        return {"paragraphs": _blocks_to_paragraphs(ast["blocks"])}
    return {"paragraphs": []}


@router.post("/resume-save-ast")
def save_resume_ast(data: dict, session: Session = Depends(get_session)):
    modifications = data.get("modifications")
    if not modifications:
        raise HTTPException(status_code=400, detail="Modifications are required")

    current_version = session.exec(
        select(ResumeVersion).where(ResumeVersion.is_current == True)
    ).first()
    if not current_version or not current_version.file_path:
        raise HTTPException(status_code=400, detail="No current resume file to update")

    # De-current old ones
    old_versions = session.exec(
        select(ResumeVersion).where(ResumeVersion.is_current == True)
    ).all()
    for v in old_versions:
        v.is_current = False
        session.add(v)

    # Create new file path
    timestamp = datetime.now().strftime("%b %d, %H:%M")
    new_filename = f"master_resume_v_{int(time.time())}.docx"
    output_path = os.path.join(UPLOAD_DIR, new_filename)

    export_mutated_docx(current_version.file_path, output_path, modifications)

    # Generate new plain text for fallback/search
    new_text = extract_text_from_docx(output_path)

    new_v = ResumeVersion(
        version_label=f"Edit {timestamp}",
        content=new_text,
        file_path=output_path,
        is_current=True,
    )
    session.add(new_v)

    # Keep profile.resume_path in sync so tailoring always picks up the latest file
    profile = session.exec(select(UserProfile)).first()
    if profile:
        profile.resume_path = output_path
        profile.skill_whitelist = list(tokenize(new_text))
        session.add(profile)

    session.commit()
    session.refresh(new_v)
    return new_v


@router.get("/resume-text")
def get_resume_text(session: Session = Depends(get_session)):
    # Try current version first
    current_version = session.exec(
        select(ResumeVersion).where(ResumeVersion.is_current == True)
    ).first()
    if current_version:
        return {"text": current_version.content}

    profile = session.exec(select(UserProfile)).first()
    if not profile or not profile.resume_path:
        return {"text": ""}

    paths = [profile.resume_path, os.path.join("backend", profile.resume_path)]
    for p in paths:
        if os.path.exists(p):
            text = extract_text_from_docx(p)
            return {"text": text}

    return {"text": "", "error": f"File not found at {profile.resume_path}"}


@router.get("/resume-versions")
def get_resume_versions(session: Session = Depends(get_session)):
    versions = session.exec(
        select(ResumeVersion).order_by(desc(ResumeVersion.created_at))
    ).all()
    return versions


@router.post("/resume-save")
def save_resume_version(data: dict, session: Session = Depends(get_session)):
    content = data.get("content")
    if not content:
        raise HTTPException(status_code=400, detail="Content is required")

    # 1. De-current old ones
    old_versions = session.exec(
        select(ResumeVersion).where(ResumeVersion.is_current == True)
    ).all()
    for v in old_versions:
        v.is_current = False
        session.add(v)

    # 2. Write a .docx file so the tailoring pipeline has a file to parse.
    #    Without this, file_path stays None and tailoring always falls back to
    #    the original upload, ignoring any text edits the user made.
    timestamp = datetime.now().strftime("%b %d, %H:%M")
    new_filename = f"master_resume_v_{int(time.time())}.docx"
    output_path = os.path.join(UPLOAD_DIR, new_filename)
    save_text_to_docx(content, output_path)

    new_v = ResumeVersion(
        version_label=f"Edit {timestamp}",
        content=content,
        file_path=output_path,
        is_current=True,
    )
    session.add(new_v)

    # 3. Keep profile.resume_path in sync
    profile = session.exec(select(UserProfile)).first()
    if profile:
        profile.resume_path = output_path
        profile.skill_whitelist = list(tokenize(content))
        session.add(profile)

    session.commit()
    session.refresh(new_v)
    return new_v


@router.delete("/resume-version/{version_id}")
def delete_resume_version(version_id: int, session: Session = Depends(get_session)):
    version = session.get(ResumeVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    session.delete(version)
    session.commit()
    return {"message": "Version deleted"}


@router.get("/resume-export/{version_id}")
def export_resume_version(version_id: int, session: Session = Depends(get_session)):
    version = session.get(ResumeVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    if version.file_path and os.path.exists(version.file_path):
        return FileResponse(
            version.file_path,
            filename=os.path.basename(version.file_path),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
    else:
        # Save to a temporary file
        temp_dir = "tailored_resumes"
        os.makedirs(temp_dir, exist_ok=True)
        safe_label = (
            version.version_label.replace(" ", "_").replace(":", "-").replace(",", "")
        )
        filename = f"Export_{safe_label}.docx"
        file_path = os.path.join(temp_dir, filename)

        save_text_to_docx(version.content, file_path)

        return FileResponse(
            file_path,
            filename=filename,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )


@router.post("/resume-extract-sections")
async def resume_extract_sections(file: UploadFile = File(...)):
    """Accept a PDF or DOCX, extract text, use LLM to parse into structured sections."""
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("pdf", "docx"):
        raise HTTPException(status_code=400, detail="Only PDF and DOCX files are supported")

    content = await file.read()
    with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        if ext == "pdf":
            text = extract_text_from_pdf(tmp_path)
        else:
            text = extract_text_from_docx(tmp_path)

        if not text.strip():
            raise HTTPException(status_code=422, detail="Could not extract text from file")

        sections = extract_resume_sections_llm(text)
        return sections
    finally:
        os.unlink(tmp_path)


@router.post("/resume-build")
async def build_resume(data: dict, session: Session = Depends(get_session)):
    """Build a .docx resume from structured form data and a chosen template.
    Returns the new ResumeVersion (not set as current yet)."""
    form_data = data.get("form_data", {})
    template = data.get("template", "classic")

    timestamp = datetime.now().strftime("%b %d, %H:%M")
    new_filename = f"master_resume_built_{int(time.time())}.docx"
    output_path = os.path.join(UPLOAD_DIR, new_filename)

    _BUILDERS = {
        "modern":    build_resume_docx_modern,
        "elegant":   build_resume_docx_elegant,
        "minimal":   build_resume_docx_minimal,
        "slate":     build_resume_docx_slate,
        "executive": build_resume_docx_executive,
    }
    builder = _BUILDERS.get(template, build_resume_docx_classic)
    builder(form_data, output_path)

    text = extract_text_from_docx(output_path)

    new_v = ResumeVersion(
        version_label=f"Built ({template.capitalize()}) {timestamp}",
        content=text,
        file_path=output_path,
        is_current=False,
    )
    session.add(new_v)
    session.commit()
    session.refresh(new_v)
    return new_v


@router.post("/resume-set-current/{version_id}")
async def set_current_resume(version_id: int, session: Session = Depends(get_session)):
    """Mark a ResumeVersion as current master resume and sync UserProfile."""
    old_versions = session.exec(
        select(ResumeVersion).where(ResumeVersion.is_current == True)
    ).all()
    for v in old_versions:
        v.is_current = False
        session.add(v)

    version = session.get(ResumeVersion, version_id)
    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    version.is_current = True
    session.add(version)

    profile = session.exec(select(UserProfile)).first()
    if profile:
        profile.resume_path = version.file_path
        profile.skill_whitelist = list(tokenize(version.content))
        session.add(profile)

    session.commit()
    session.refresh(version)
    return version


@router.post("/resume")
async def upload_resume(
    file: UploadFile = File(...), session: Session = Depends(get_session)
):
    if not file.filename.endswith(".docx"):
        raise HTTPException(status_code=400, detail="Only .docx files are supported")

    file_path = os.path.join(
        UPLOAD_DIR, f"master_resume_{int(time.time())}_{file.filename}"
    )
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Extract text immediately for initial version
    text = extract_text_from_docx(file_path)

    # 3. SKILL WHITELIST ENFORCER
    skill_whitelist = list(tokenize(text))

    # 1. Update Profile
    profile = session.exec(select(UserProfile)).first()
    if not profile:
        profile = UserProfile(
            full_name="Default User",
            current_title="Engineer",
            years_of_experience="0",
            resume_path=file_path,
            skill_whitelist=skill_whitelist,
        )
    else:
        profile.resume_path = file_path
        profile.skill_whitelist = skill_whitelist
    session.add(profile)

    # 2. Create initial version
    # Set others to not current
    old_versions = session.exec(
        select(ResumeVersion).where(ResumeVersion.is_current == True)
    ).all()
    for v in old_versions:
        v.is_current = False
        session.add(v)

    initial_v = ResumeVersion(
        version_label=f"Upload {datetime.now().strftime('%b %d')}",
        content=text,
        file_path=file_path,
        is_current=True,
    )
    session.add(initial_v)

    session.commit()
    session.refresh(profile)

    return {"message": "Resume uploaded and versioned successfully", "path": file_path}
