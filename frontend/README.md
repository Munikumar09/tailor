# Frontend — AI Job Application Commander

Next.js 16 application (App Router, TypeScript) that provides the full UI for job browsing, resume management, tailoring, and analytics.

---

## Setup

```bash
cd frontend
npm install
npm run dev       # http://localhost:3000
```

| Script | Description |
|--------|-------------|
| `npm run dev` | Development server with hot reload |
| `npm run build` | Production build |
| `npm run start` | Serve production build |
| `npm run lint` | ESLint check |

### Environment

Create `frontend/.env.local` if the backend runs on a non-default port:

```
NEXT_PUBLIC_API_URL=http://localhost:8000
```

The Axios client at `src/lib/api.ts` reads this variable and defaults to `http://localhost:8000`.

---

## Tech Stack

| Layer | Library |
|-------|---------|
| Framework | Next.js 16, React 19 |
| Language | TypeScript 5 (strict mode) |
| Styling | Tailwind CSS 4 |
| Icons | Lucide React |
| Server state | TanStack React Query 5 |
| HTTP | Axios |
| Path alias | `@/*` → `src/*` |

---

## Directory Structure

```
frontend/
├── next.config.ts
├── tsconfig.json
├── package.json
│
└── src/
    ├── app/                      # Next.js App Router
    │   ├── layout.tsx            # Root layout (fonts, providers)
    │   ├── client-layout.tsx     # Client-side shell (sidebar nav)
    │   ├── providers.tsx         # TanStack Query provider
    │   ├── globals.css
    │   ├── page.tsx              # Dashboard / home (redirects to /jobs)
    │   │
    │   ├── jobs/
    │   │   ├── page.tsx          # Job list with filters & match scores
    │   │   └── [id]/
    │   │       ├── page.tsx      # Job detail + tailoring UI
    │   │       └── analytics/
    │   │           └── page.tsx  # Detailed ATS analytics for a tailored job
    │   │
    │   ├── resume/
    │   │   └── page.tsx          # Master resume viewer / editor
    │   │
    │   ├── tailor/
    │   │   └── page.tsx          # Tailoring queue overview
    │   │
    │   ├── ingestion/
    │   │   └── page.tsx          # Job ingestion configuration & trigger
    │   │
    │   ├── profile/
    │   │   └── page.tsx          # User profile editor
    │   │
    │   ├── analytics/
    │   │   └── page.tsx          # Cross-job analytics dashboard
    │   │
    │   ├── settings/
    │   │   └── page.tsx
    │   ├── billing/
    │   │   └── page.tsx
    │   └── notifications/
    │       └── page.tsx
    │
    ├── hooks/                    # TanStack Query hooks
    │   ├── useJobs.ts
    │   ├── useProfile.ts
    │   ├── useTailor.ts
    │   └── useIngest.ts
    │
    └── lib/
        ├── api.ts                # Axios instance
        └── utils.ts             # cn() and other helpers
```

---

## Pages

### `/jobs` — Job List

Shows all ingested jobs as cards. Each card displays:
- Company, title, location, salary
- AI match score (semantic similarity, 0–100) with colour coding
- Status badge (`PENDING` / `TAILORING` / `TAILORED` / `APPLIED` / `SKIPPED`)
- Quick-action buttons (tailor, skip, mark applied)

Filter by status via tab pills at the top.

### `/jobs/[id]` — Job Detail

The main workflow page for a single job:

- **AI Match Score** — circular gauge with the semantic similarity score and LLM-generated reason text
- **Job Description** — full formatted JD
- **Extracted Keywords (by LLM)** — keyword cards showing each term, its priority weight (`Critical` / `High` / `Medium` / `Low`), and whether it is present in the resume (green check) or missing (amber warning)
- **Tailored Bullets** — before/after comparison of rewritten resume bullets with the keywords that were injected
- **Tailoring controls** — trigger tailoring, poll progress via sub-status, download the finished `.docx`

### `/jobs/[id]/analytics` — Tailoring Analytics

Deep-dive into the tailoring result:
- ATS score before vs. after (delta and pass-band label)
- Keyword coverage chart
- Per-keyword classification (exact match / semantic match / missing)
- Bullet-level change log with reasons

### `/resume` — Master Resume

Paper-like document viewer that renders the uploaded `.docx` with full fidelity:
- Headings rendered at the correct font size (read from the docx XML)
- Bold, italic, underline applied per-run
- Bullet points with proper indentation
- Inline editing (click any text span, blur to save the block)
- Version history sidebar — click any version to preview it
- Export any version as `.docx`
- Replace the master file with a new upload

### `/ingestion` — Job Ingestion

Configure and trigger job searches:
- Job title, location, remote preference
- Number of results to fetch
- Manual trigger button
- Shows last-run timestamp and how many new jobs were found

### `/profile` — User Profile

Edit candidate details:
- Name, current title, years of experience
- LinkedIn URL, preferred work mode, minimum salary
- `min_ai_score` threshold — jobs scoring below this are automatically skipped during ingestion (default 75)
- Ingestion frequency label

### `/tailor` — Tailoring Queue

Overview of all jobs in the tailoring pipeline — shows which are pending, currently tailoring, or done.

---

## Hooks (`src/hooks/`)

### `useJobs.ts`

| Hook | Method | Endpoint | Description |
|------|--------|----------|-------------|
| `useJobs(status?)` | GET | `/jobs/` | Fetch all jobs, optional status filter |
| `useJob(id)` | GET | `/jobs/{id}` | Single job |
| `useUpdateJobStatus()` | PATCH | `/jobs/{id}/status` | Change status |
| `useSyncWithMaster()` | POST | `/jobs/sync-with-master` | Recalculate all match scores |

**`Job` TypeScript interface** (key fields):

```typescript
interface Job {
  id: number
  company_name: string
  job_title: string
  job_description: string
  match_score: number               // 0–100 semantic similarity
  match_reason: string              // LLM skill-alignment summary
  tailored_match_score?: number     // ATS score post-tailoring
  tailored_match_reason?: string    // ATS pass-band label
  status: JobStatus                 // PENDING | TAILORING | TAILORED | APPLIED | SKIPPED
  sub_status?: string               // "System 3 — Rewriting bullets..."
  extracted_keywords?: { kw: string; present: boolean; weight: string }[]
  tailored_bullets?: { old: string; new: string }[]
  analytics?: TailoringAnalytics
  logs?: { msg: string; type: string; t: string }[]
  job_url: string
  location: string
  salary: string
  tailored_resume_path: string | null
}
```

### `useProfile.ts`

| Hook | Method | Endpoint | Description |
|------|--------|----------|-------------|
| `useProfile()` | GET | `/profile/` | User profile |
| `useUpdateProfile()` | POST | `/profile/` | Save profile |
| `useUploadResume()` | POST | `/profile/resume` | Upload `.docx` |
| `useResumeText()` | GET | `/profile/resume-text` | Plain text |
| `useResumeAST(versionId?)` | GET | `/profile/resume-ast` | Structured AST |
| `useResumeVersions()` | GET | `/profile/resume-versions` | Version list |
| `useSaveResumeVersion()` | POST | `/profile/resume-save` | Save plain-text edit |
| `useSaveResumeAST()` | POST | `/profile/resume-save-ast` | Save structured edit |
| `useDeleteResumeVersion()` | DELETE | `/profile/resume-version/{id}` | Delete version |

**Resume AST shape** returned by `useResumeAST`:

```typescript
interface ResumeAST {
  paragraphs: ResumeParagraph[]
}

interface ResumeParagraph {
  id: string          // "b14" — stable block ID
  style: string       // "h1" | "h2" | "h3" | "bullet" | "paragraph"
  ilvl: number        // list indent level
  runs: ResumeRun[]
}

interface ResumeRun {
  id: string          // "b14_r0"
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
  fontSize: number | null   // in points, from docx XML
}
```

### `useTailor.ts`

| Hook | Method | Endpoint | Description |
|------|--------|----------|-------------|
| `useTailorJob()` | POST | `/tailor/{job_id}` | Trigger the pipeline |
| `useTailorStatus(id)` | GET | `/tailor/{id}/status` | Poll progress logs |

### `useIngest.ts`

| Hook | Method | Endpoint | Description |
|------|--------|----------|-------------|
| `useIngest()` | POST | `/ingest/search` | Trigger job fetch |

---

## Resume Viewer — Rendering Details

The resume viewer (`/resume`) renders the structured AST into a white paper-like container (`max-w-[816px]`, matching US Letter width at 96 dpi). Style mapping:

| AST `style` | Visual treatment |
|-------------|-----------------|
| `h1` | Bold, top margin, no border |
| `h2` | Bold, top margin, bottom border (section divider) |
| `h3` | Semi-bold, top margin |
| `bullet` | Flex row with `•` glyph, left indent |
| `paragraph` | Default line height, small vertical gap |

Each run's `fontSize` (in pt, from the docx XML) is applied via `style={{ fontSize: "Xpt" }}`, so font sizes match the original document exactly. Editing mode adds an indigo highlight on hover/focus per run; saves are keyed by block ID (paragraph level) since the backend replaces whole paragraphs.

---

## API Client (`src/lib/api.ts`)

Axios instance configured with:
- `baseURL`: `process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"`
- Default `Content-Type: application/json`
- All TanStack Query hooks use this instance

All data fetching uses TanStack Query for caching, background refetch, and optimistic updates. Mutations call `queryClient.invalidateQueries()` on success to keep the UI in sync.
