import re
from typing import List, Dict, Set
from utils.logger import get_logger

logger = get_logger(__name__)

# Tech term dictionary — expanded from reference
TECH_PATTERNS = [
    r"\b(TypeScript|JavaScript|ES2\d+|ESNext)\b",
    r"\b(React|Vue|Angular|Svelte|Next\.js|Nuxt|Remix|Astro)\b",
    r"\b(Node\.js|Deno|Bun|Express|Fastify|NestJS|FastAPI|Django|Flask|Rails)\b",
    r"\b(Python|Go|Rust|Java|Kotlin|Swift|C\+\+|C#|Ruby|PHP|Scala|Elixir)\b",
    r"\b(PostgreSQL|MySQL|SQLite|MongoDB|Redis|Cassandra|DynamoDB|Supabase|PlanetScale)\b",
    r"\b(Docker|Kubernetes|Helm|Terraform|Pulumi|Ansible|ArgoCD)\b",
    r"\b(AWS|GCP|Azure|Vercel|Cloudflare|Fly\.io|Railway)\b",
    r"\b(GraphQL|REST|gRPC|WebSocket|tRPC|OpenAPI|Swagger)\b",
    r"\b(CI\/CD|GitHub Actions|Jenkins|CircleCI|Travis)\b",
    r"\b(TailwindCSS|Tailwind|CSS-in-JS|Styled Components|Sass|PostCSS)\b",
    r"\b(webpack|Vite|Rollup|Turbopack|esbuild|Parcel)\b",
    r"\b(LLM|RAG|fine-?tuning|RLHF|embeddings?|vector\s+search|LangChain|LangGraph|LlamaIndex)\b",
    r"\b(Edge Runtime|Web Workers|Service Workers|WebAssembly|WASM)\b",
    r"\b(Core Web Vitals|Lighthouse|Web Performance|INP|LCP|CLS|TTFB)\b",
    r"\b(microservices|monorepo|monolith|event-driven|serverless|distributed\s+systems?)\b",
    r"\b(system design|technical spec|architecture|scalab\w+|high.availability)\b",
    r"\b(agile|scrum|kanban|cross-functional|stakeholder|roadmap)\b",
    r"\b(A\/B testing?|feature flags?|observability|monitoring|OpenTelemetry|Datadog|Sentry)\b",
    r"\b(Git|GitHub|GitLab|Bitbucket|code review|pull request)\b",
    r"\b(accessibility|WCAG|a11y|internationaliz\w+|i18n)\b",
]


def tokenize(text: str) -> Set[str]:
    """Extract tech keywords using patterns."""
    found = set()
    for pattern in TECH_PATTERNS:
        matches = re.findall(pattern, text, flags=re.IGNORECASE)
        for m in matches:
            if isinstance(m, tuple):
                for part in m:
                    if part:
                        found.add(part.strip())
            else:
                found.add(m.strip())
    return found


def analyze_keyword_gap(jd_text: str, resume_text: str) -> Dict:
    """
    2. KEYWORD GAP ANALYZER (local, pre-AI)
    Extracts tech keywords from JD, checks coverage against resume.
    """
    jd_keywords = list(tokenize(jd_text))
    resume_keywords = tokenize(resume_text)

    present = []
    missing = []

    for kw in jd_keywords:
        # Simple case-insensitive check
        if any(kw.lower() == rk.lower() for rk in resume_keywords):
            present.append(kw)
        else:
            missing.append(kw)

    total = len(jd_keywords)
    coverage = Math.round((len(present) / total * 100)) if total > 0 else 100

    return {
        "jdKeywords": jd_keywords,
        "present": present,
        "missing": missing,
        "coverage": coverage,
    }


class Math:
    @staticmethod
    def round(n):
        return int(n + 0.5) if n >= 0 else int(n - 0.5)
