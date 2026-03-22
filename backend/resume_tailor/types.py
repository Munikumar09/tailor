from enum import Enum

# ═══════════════════════════════════════════════════════════════════════════════
#  RESUME SECTION ENUM
# ═══════════════════════════════════════════════════════════════════════════════

class ResumeSection(Enum):
    SKILLS       = "skills"
    SUMMARY      = "summary"
    EXPERIENCE   = "experience"
    EDUCATION    = "education"
    PROJECTS     = "projects"
    CERTIFICATIONS = "certifications"
    OTHER        = "other"
