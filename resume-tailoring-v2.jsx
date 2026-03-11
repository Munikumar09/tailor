import { useState, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
//  SYSTEM 0 — JSZIP LOADER
// ═══════════════════════════════════════════════════════════════════════════════
const loadJSZip = () => new Promise((resolve, reject) => {
  if (window.JSZip) return resolve(window.JSZip);
  const s = document.createElement("script");
  s.src = "https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js";
  s.onload = () => resolve(window.JSZip);
  s.onerror = () => reject(new Error("Failed to load JSZip"));
  document.head.appendChild(s);
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SYSTEM 1 — PARSER
//  Parses word/document.xml into a Block AST.
//  Each block stores:
//    • pPrXml    — serialized <w:pPr> node (paragraph formatting)
//    • baseRprXml — serialized <w:rPr> of the first run (base run style)
//    • runs[]   — [{text, rPrXml}] for display only
//  The original xmlDoc is returned but treated as DISPOSABLE —
//  the source of truth is always the immutable masterBuffer.
// ═══════════════════════════════════════════════════════════════════════════════
const WNS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const serial = new XMLSerializer();
const domParser = new DOMParser();

function serializeNode(node) {
  return node ? serial.serializeToString(node) : "";
}

function parseDocx(xmlString) {
  const xmlDoc = domParser.parseFromString(xmlString, "application/xml");
  const paragraphs = Array.from(xmlDoc.getElementsByTagNameNS(WNS, "p"));
  const blocks = [];

  paragraphs.forEach((p, i) => {
    // ── Paragraph style ──────────────────────────────────────────────────────
    const pPr = p.getElementsByTagNameNS(WNS, "pPr")[0] || null;
    const pStyle = pPr?.getElementsByTagNameNS(WNS, "pStyle")[0]?.getAttribute("w:val") || "";
    const numPr = pPr?.getElementsByTagNameNS(WNS, "numPr")[0] || null;
    const ilvl = parseInt(numPr?.getElementsByTagNameNS(WNS, "ilvl")[0]?.getAttribute("w:val") ?? "0");

    // ── Classify type ─────────────────────────────────────────────────────────
    const sl = pStyle.toLowerCase();
    let type = "paragraph";
    if (sl.includes("heading1") || sl === "1" || sl === "title") type = "h1";
    else if (sl.includes("heading2") || sl === "2") type = "h2";
    else if (sl.includes("heading3") || sl === "3") type = "h3";
    else if (numPr) type = "bullet";

    // ── Collect runs (skip deleted content) ───────────────────────────────────
    const runs = Array.from(p.getElementsByTagNameNS(WNS, "r"))
      .filter(r => {
        let node = r.parentNode;
        while (node && node !== p) {
          if (node.localName === "del") return false;
          node = node.parentNode;
        }
        return true;
      })
      .map(r => {
        const rPr = r.getElementsByTagNameNS(WNS, "rPr")[0] || null;
        const text = Array.from(r.getElementsByTagNameNS(WNS, "t"))
          .map(t => t.textContent).join("");
        return {
          text,
          bold: !!rPr?.getElementsByTagNameNS(WNS, "b")[0],
          italic: !!rPr?.getElementsByTagNameNS(WNS, "i")[0],
          underline: !!rPr?.getElementsByTagNameNS(WNS, "u")[0],
          rPrXml: serializeNode(rPr),
        };
      });

    const fullText = runs.map(r => r.text).join("");

    // ── Serialise pPr and baseRpr for later use in run rebuilder ─────────────
    const pPrXml = serializeNode(pPr);
    const baseRprXml = runs[0]?.rPrXml || "";

    blocks.push({
      id: `b${i}`,
      type,
      pStyle,
      ilvl,
      fullText,
      runs,
      pPrXml,
      baseRprXml,
      // isTailorable: only bullets and paragraphs with real content
      isTailorable: (type === "bullet" || type === "paragraph") && fullText.trim().length > 15,
    });
  });

  return { blocks };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SYSTEM 2 — KEYWORD GAP ANALYZER (local, pre-AI)
//  Extracts tech keywords from JD, checks coverage against resume.
//  Produces: { present[], missing[], coverage% }
//  The missing[] list is fed directly into the AI prompt so Claude
//  knows exactly what to inject rather than guessing.
// ═══════════════════════════════════════════════════════════════════════════════

// Tech term dictionary — expanded
const TECH_PATTERNS = [
  /\b(TypeScript|JavaScript|ES2\d+|ESNext)\b/gi,
  /\b(React|Vue|Angular|Svelte|Next\.js|Nuxt|Remix|Astro)\b/gi,
  /\b(Node\.js|Deno|Bun|Express|Fastify|NestJS|FastAPI|Django|Flask|Rails)\b/gi,
  /\b(Python|Go|Rust|Java|Kotlin|Swift|C\+\+|C#|Ruby|PHP|Scala|Elixir)\b/gi,
  /\b(PostgreSQL|MySQL|SQLite|MongoDB|Redis|Cassandra|DynamoDB|Supabase|PlanetScale)\b/gi,
  /\b(Docker|Kubernetes|Helm|Terraform|Pulumi|Ansible|ArgoCD)\b/gi,
  /\b(AWS|GCP|Azure|Vercel|Cloudflare|Fly\.io|Railway)\b/gi,
  /\b(GraphQL|REST|gRPC|WebSocket|tRPC|OpenAPI|Swagger)\b/gi,
  /\b(CI\/CD|GitHub Actions|Jenkins|CircleCI|Travis)\b/gi,
  /\b(TailwindCSS|Tailwind|CSS-in-JS|Styled Components|Sass|PostCSS)\b/gi,
  /\b(webpack|Vite|Rollup|Turbopack|esbuild|Parcel)\b/gi,
  /\b(LLM|RAG|fine-?tuning|RLHF|embeddings?|vector\s+search|LangChain|LangGraph|LlamaIndex)\b/gi,
  /\b(Edge Runtime|Web Workers|Service Workers|WebAssembly|WASM)\b/gi,
  /\b(Core Web Vitals|Lighthouse|Web Performance|INP|LCP|CLS|TTFB)\b/gi,
  /\b(microservices|monorepo|monolith|event-driven|serverless|distributed\s+systems?)\b/gi,
  /\b(system design|technical spec|architecture|scalab\w+|high.availability)\b/gi,
  /\b(agile|scrum|kanban|cross-functional|stakeholder|roadmap)\b/gi,
  /\b(A\/B testing?|feature flags?|observability|monitoring|OpenTelemetry|Datadog|Sentry)\b/gi,
  /\b(Git|GitHub|GitLab|Bitbucket|code review|pull request)\b/gi,
  /\b(accessibility|WCAG|a11y|internationaliz\w+|i18n)\b/gi,
];

function extractKeywordsFromText(text) {
  const found = new Set();
  for (const pattern of TECH_PATTERNS) {
    const matches = text.match(new RegExp(pattern.source, "gi")) || [];
    matches.forEach(m => found.add(m.trim()));
  }
  return [...found];
}

function analyzeKeywordGap(resumeBlocks, jdText) {
  const resumeText = resumeBlocks.map(b => b.fullText).join(" ");
  const jdKeywords = extractKeywordsFromText(jdText);

  const present = [];
  const missing = [];

  jdKeywords.forEach(kw => {
    const regex = new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (regex.test(resumeText)) present.push(kw);
    else missing.push(kw);
  });

  const coverage = jdKeywords.length > 0
    ? Math.round((present.length / jdKeywords.length) * 100)
    : 100;

  return { jdKeywords, present, missing, coverage };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SYSTEM 3 — SKILL WHITELIST
//  Auto-extracted from resume on upload.
//  Injected into AI prompt as hard constraint.
//  Post-AI validator uses this to reject hallucinated skills.
// ═══════════════════════════════════════════════════════════════════════════════
function extractSkillWhitelist(blocks) {
  const resumeText = blocks.map(b => b.fullText).join(" ");
  return extractKeywordsFromText(resumeText);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SYSTEM 4 — AI CALL (Claude)
//  Strict prompt contract:
//    INPUT  → plain text blocks + JD + missing keywords + whitelist
//    OUTPUT → JSON { tailored: [{id, newText, keywordsAdded, reason}] }
//  Claude never sees XML.
//  Claude never returns formatting instructions.
// ═══════════════════════════════════════════════════════════════════════════════
async function callClaude(tailorableBlocks, jdText, missingKeywords, skillWhitelist) {
  const blockMap = tailorableBlocks.map(b => ({ id: b.id, text: b.fullText }));

  const systemPrompt = `You are a professional resume tailoring assistant. Rewrite resume bullet points and paragraphs to align with a job description by injecting relevant keywords.

ABSOLUTE RULES — breaking any rule invalidates your entire response:
1. Return ONLY valid JSON. Zero prose outside the JSON object.
2. Schema: { "tailored": [ { "id": string, "newText": string, "keywordsAdded": string[], "reason": string } ] }
3. Include ONLY blocks you changed. Omit unchanged blocks entirely.
4. NEVER alter block "id" values — they map to XML nodes in the document.
5. "newText" must be plain text only — no markdown, no XML, no asterisks, no formatting.
6. NEVER invent skills, tools, or experiences. Only use terms from the skill whitelist or terms from the job description that could plausibly describe what the candidate already did.
7. NEVER change: candidate name, contact info, company names, dates, job titles, education institution names.
8. NEVER change heading or section title blocks.
9. Prioritise injecting the provided "missing keywords" list — these have been pre-analysed as gaps.
10. Keep approximate sentence length. Do not pad or over-explain.
11. Maximum 8 blocks changed.
12. "keywordsAdded" must list ONLY new terms not present in the original text.`;

  const userPrompt = `JOB DESCRIPTION:
${jdText.trim()}

---
PRE-ANALYSED MISSING KEYWORDS (prioritise these):
${missingKeywords.slice(0, 20).join(", ") || "none detected"}

---
CANDIDATE SKILL WHITELIST (only use terms from this list or the JD — never invent others):
${skillWhitelist.slice(0, 40).join(", ")}

---
RESUME BLOCKS:
${JSON.stringify(blockMap, null, 2)}

Return JSON only. No explanation outside the JSON.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2500,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error?.message || `HTTP ${response.status}`);
  }

  const data = await response.json();
  const raw = data.content?.map(c => c.text || "").join("") || "";
  const jsonStr = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  const parsed = JSON.parse(jsonStr);
  if (!Array.isArray(parsed?.tailored)) throw new Error("Unexpected response shape from Claude");
  return parsed.tailored;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SYSTEM 5 — SCHEMA VALIDATOR
//  Runs after Claude returns, before writing to XML.
//  Validates each change item and flags/skips violations.
// ═══════════════════════════════════════════════════════════════════════════════
function validateChanges(changes, blocks, skillWhitelist, jdKeywords) {
  const blockIds = new Set(blocks.map(b => b.id));
  const allAllowed = new Set([
    ...skillWhitelist.map(s => s.toLowerCase()),
    ...jdKeywords.map(k => k.toLowerCase()),
  ]);

  const valid = [];
  const violations = [];

  for (const c of changes) {
    const issues = [];

    // Rule 1: ID must exist
    if (!blockIds.has(c.id)) {
      issues.push(`Unknown block ID: ${c.id}`);
    }

    // Rule 2: newText must be a plain string
    if (typeof c.newText !== "string" || c.newText.trim() === "") {
      issues.push("newText is empty or not a string");
    }

    // Rule 3: newText must not contain XML-like content
    if (/<[a-z][\s\S]*>/i.test(c.newText)) {
      issues.push("newText contains XML/HTML markup");
    }

    // Rule 4: newText must not contain markdown formatting
    if (/[*_`#\[\]]/.test(c.newText)) {
      issues.push("newText contains markdown characters");
    }

    // Rule 5: No fabricated skills — check keywordsAdded against whitelist+JD
    const fabricated = (c.keywordsAdded || []).filter(kw => {
      const kwl = kw.toLowerCase();
      return !allAllowed.has(kwl) && !blocks.find(b => b.id === c.id)?.fullText.toLowerCase().includes(kwl);
    });
    if (fabricated.length > 0) {
      issues.push(`Potential fabrication detected: ${fabricated.join(", ")}`);
    }

    // Rule 6: No identity fields changed
    const block = blocks.find(b => b.id === c.id);
    if (block && ["h1", "h2", "h3"].includes(block.type)) {
      issues.push("Attempted to change a heading block");
    }

    if (issues.length === 0) {
      valid.push(c);
    } else {
      violations.push({ id: c.id, issues });
    }
  }

  return { valid, violations };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SYSTEM 6 — RUN REBUILDER
//  This is the heart of format preservation.
//
//  For each accepted change, applied against a FRESH parse of masterBuffer:
//  1. Find the <w:p> node by its paragraph index (= block.id "b{i}")
//  2. Clone and preserve <w:pPr> exactly
//  3. Delete ALL <w:r> children (and any <w:hyperlink> containing runs)
//  4. Create fresh <w:r> nodes with cloned baseRprXml
//  5. If emphasizeKeywords ON: split text around keywords, create separate runs,
//     inject <w:b/> only on keyword runs (without touching base rPr)
//     If OFF: single <w:r> with baseRpr, full text, no bold injection
//
//  Paragraphs with no accepted change: ZERO modifications.
// ═══════════════════════════════════════════════════════════════════════════════
function rebuildRuns(xmlDoc, blockIndex, newText, baseRprXml, keywords, emphasize) {
  const paragraphs = Array.from(xmlDoc.getElementsByTagNameNS(WNS, "p"));
  const p = paragraphs[blockIndex];
  if (!p) return;

  // Step 1: Find all run-bearing child nodes to remove
  // (direct <w:r>, <w:hyperlink>, <w:ins>, <w:del>)
  const runBearers = Array.from(p.childNodes).filter(child =>
    ["r", "hyperlink", "ins", "del", "bookmarkStart", "bookmarkEnd"].includes(child.localName)
  );
  runBearers.forEach(n => p.removeChild(n));

  // Step 2: Parse baseRprXml back into a node (we'll clone it per run)
  let baseRprNode = null;
  if (baseRprXml) {
    try {
      const parsed = domParser.parseFromString(
        `<root xmlns:w="${WNS}">${baseRprXml}</root>`, "application/xml"
      );
      baseRprNode = parsed.documentElement.firstElementChild;
    } catch (_) { /* ignore parse errors, proceed without rPr */ }
  }

  // Helper: create a single <w:r> with given text and optional bold override
  const makeRun = (text, bold) => {
    const r = xmlDoc.createElementNS(WNS, "w:r");

    // Clone rPr from base
    if (baseRprNode) {
      const clonedRpr = xmlDoc.importNode(baseRprNode, true);

      if (bold) {
        // Inject <w:b/> if not already present
        const alreadyBold = clonedRpr.getElementsByTagNameNS(WNS, "b")[0];
        if (!alreadyBold) {
          const bEl = xmlDoc.createElementNS(WNS, "w:b");
          // Insert at start of rPr (before other children) for schema compliance
          clonedRpr.insertBefore(bEl, clonedRpr.firstChild);
        }
      } else if (!bold && emphasize) {
        // Explicitly remove bold if base had it and we're in a non-keyword segment
        // (keeps non-keyword segments visually consistent with original base)
        const existingBold = clonedRpr.getElementsByTagNameNS(WNS, "b");
        Array.from(existingBold).forEach(b => clonedRpr.removeChild(b));
      }

      r.appendChild(clonedRpr);
    }

    const t = xmlDoc.createElementNS(WNS, "w:t");
    t.textContent = text;
    // Preserve whitespace for segments with leading/trailing spaces
    if (text.startsWith(" ") || text.endsWith(" ")) {
      t.setAttributeNS(
        "http://www.w3.org/XML/1998/namespace", "xml:space", "preserve"
      );
    }
    r.appendChild(t);
    return r;
  };

  if (!emphasize || keywords.length === 0) {
    // Simple path: single run, plain text
    const run = makeRun(newText, false);
    p.appendChild(run);
    return;
  }

  // Emphasize path: split text around keywords, create separate runs per segment
  // Build a regex that matches any of the injected keywords (case-insensitive)
  const escaped = keywords.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const kwRegex = new RegExp(`(${escaped.join("|")})`, "gi");

  const parts = newText.split(kwRegex); // alternates: [plain, kw, plain, kw, ...]

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    // Odd indices in the split result are the captured keyword groups
    const isKeyword = i % 2 === 1;
    p.appendChild(makeRun(part, isKeyword));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SYSTEM 7 — EXPORTER
//  Always re-parses from masterBuffer (immutable).
//  Applies only accepted, validated changes via Run Rebuilder.
//  Repacks ZIP with only document.xml swapped.
// ═══════════════════════════════════════════════════════════════════════════════
async function exportTailoredDocx(masterBuffer, blocks, acceptedChanges, emphasizeKeywords) {
  const JSZip = await loadJSZip();

  // Step 1: Load master ZIP fresh — never mutate the stored masterBuffer
  const zip = await JSZip.loadAsync(masterBuffer);
  const docXmlFile = zip.file("word/document.xml");
  if (!docXmlFile) throw new Error("word/document.xml not found in master");
  const freshXmlStr = await docXmlFile.async("string");

  // Step 2: Parse a fresh, disposable xmlDoc from master
  const freshXmlDoc = domParser.parseFromString(freshXmlStr, "application/xml");

  // Step 3: Apply each accepted change using Run Rebuilder
  for (const change of acceptedChanges) {
    const block = blocks.find(b => b.id === change.id);
    if (!block) continue;
    const blockIndex = parseInt(block.id.slice(1)); // "b14" → 14
    rebuildRuns(
      freshXmlDoc,
      blockIndex,
      change.newText,
      block.baseRprXml,
      change.keywordsAdded || [],
      emphasizeKeywords
    );
  }

  // Step 4: Serialize updated XML
  const updatedXml = serial.serializeToString(freshXmlDoc);

  // Step 5: Rebuild ZIP — only document.xml is different
  const newZip = new JSZip();
  const entries = [];
  zip.forEach((path, file) => entries.push({ path, file }));
  for (const { path, file } of entries) {
    if (path === "word/document.xml") {
      newZip.file(path, updatedXml);
    } else {
      newZip.file(path, await file.async("arraybuffer"));
    }
  }

  return await newZip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  UI — DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════════════════════
const C = {
  bg: "#0B0B0C", surface: "#131315", s2: "#18181B", s3: "#1E1E22",
  border: "#222226", bMid: "#2C2C32",
  accent: "#6366F1", accentDim: "rgba(99,102,241,0.10)", accentBorder: "rgba(99,102,241,0.28)",
  text: "#EDEDED", mid: "#888", dim: "#444",
  green: "#34D399", greenDim: "rgba(52,211,153,0.09)",
  amber: "#FBBF24", amberDim: "rgba(251,191,36,0.09)",
  red: "#F87171", redDim: "rgba(248,113,113,0.08)",
  purple: "#A78BFA", purpleDim: "rgba(167,139,250,0.09)",
  cyan: "#22D3EE",
};

// ── UI primitives ────────────────────────────────────────────────────────────
const Fl = ({ children, gap = 8, align = "center", wrap, style = {} }) => (
  <div style={{ display: "flex", alignItems: align, gap, flexWrap: wrap ? "wrap" : "nowrap", ...style }}>
    {children}
  </div>
);
const Co = ({ children, gap = 8, style = {} }) => (
  <div style={{ display: "flex", flexDirection: "column", gap, ...style }}>{children}</div>
);
const T = ({ c, size = 13, w = 400, mono, style = {}, children }) => (
  <span style={{ fontSize: size, fontWeight: w, color: c || C.text, fontFamily: mono ? "'DM Mono',monospace" : "inherit", lineHeight: 1.5, ...style }}>
    {children}
  </span>
);
const Div = ({ style = {} }) => <div style={{ height: 1, background: C.border, ...style }} />;
const Spin = ({ size = 14, color = "#fff" }) => (
  <div style={{ width: size, height: size, border: `2px solid ${color}33`, borderTopColor: color, borderRadius: "50%", animation: "spin .7s linear infinite", flexShrink: 0 }} />
);
const Chip = ({ label, color = C.mid }) => (
  <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, background: `${color}18`, color, border: `1px solid ${color}28`, fontWeight: 600 }}>
    {label}
  </span>
);
const Tag = ({ label, color = C.mid }) => (
  <span style={{ fontSize: 10.5, padding: "2px 9px", borderRadius: 6, background: `${color}12`, color, border: `1px solid ${color}20`, fontWeight: 500 }}>
    {label}
  </span>
);
function Btn({ label, v = "ghost", sz = "md", icon, disabled, full, onClick, style = {}, children }) {
  const pad = sz === "sm" ? "5px 11px" : sz === "lg" ? "11px 26px" : "7px 15px";
  const fs = sz === "sm" ? 11 : sz === "lg" ? 13.5 : 12.5;
  const [bg, bc, fc] = v === "primary" ? [C.accent, C.accent, "#fff"]
    : v === "success" ? [C.green, C.green, "#111"]
    : v === "danger" ? [`${C.red}1A`, `${C.red}44`, C.red]
    : v === "amber" ? [`${C.amber}1A`, `${C.amber}44`, C.amber]
    : [C.s3, C.bMid, C.mid];
  return (
    <div onClick={disabled ? undefined : onClick}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: pad, borderRadius: 8, fontSize: fs, fontWeight: 600, background: bg, border: `1px solid ${bc}`, color: fc, cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1, width: full ? "100%" : "auto", justifyContent: full ? "center" : "flex-start", flexShrink: 0, userSelect: "none", ...style }}>
      {icon}<span>{label}</span>{children}
    </div>
  );
}
function Card({ children, style = {}, glow }) {
  return (
    <div style={{ background: C.s2, border: `1px solid ${glow ? C.accentBorder : C.border}`, borderRadius: 12, boxShadow: glow ? `0 0 0 1px ${C.accentBorder}` : "none", ...style }}>
      {children}
    </div>
  );
}
function CardH({ children, style = {} }) {
  return <div style={{ padding: "11px 16px", borderBottom: `1px solid ${C.border}`, background: C.s3, borderRadius: "12px 12px 0 0", ...style }}>{children}</div>;
}
function CardB({ children, style = {} }) {
  return <div style={{ padding: "14px 16px", ...style }}>{children}</div>;
}
function Toggle({ on, onToggle, label, sub }) {
  return (
    <Fl gap={10} style={{ padding: "10px 0" }}>
      <div onClick={onToggle} style={{ width: 36, height: 20, borderRadius: 10, background: on ? C.accent : C.s3, border: `1px solid ${on ? C.accent : C.bMid}`, position: "relative", cursor: "pointer", flexShrink: 0, transition: "background 0.2s" }}>
        <div style={{ width: 14, height: 14, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, left: on ? 19 : 3, transition: "left 0.2s", opacity: on ? 1 : 0.7 }} />
      </div>
      <Co gap={2} style={{ flex: 1 }}>
        <T size={12.5} w={600}>{label}</T>
        {sub && <T size={11} c={C.mid}>{sub}</T>}
      </Co>
    </Fl>
  );
}
const MiniBar = ({ value, max, color }) => (
  <div style={{ height: 5, background: C.s3, borderRadius: 3, overflow: "hidden" }}>
    <div style={{ height: 5, width: `${Math.round((value / max) * 100)}%`, background: color, borderRadius: 3, transition: "width 0.5s ease" }} />
  </div>
);

// ── Pipeline stage ────────────────────────────────────────────────────────────
const STAGES = ["upload", "jd", "analyze", "review", "done"];
function Pipeline({ stage }) {
  const idx = STAGES.indexOf(stage);
  const labels = ["Upload", "Job Description", "AI Analysis", "Review", "Export"];
  return (
    <Fl gap={0} style={{ height: 48, padding: "0 20px", borderBottom: `1px solid ${C.border}`, background: C.surface, overflowX: "auto" }}>
      {labels.map((l, i) => {
        const done = i < idx, active = i === idx;
        return (
          <Fl key={l} gap={0}>
            <Fl gap={7} style={{ padding: "0 12px", height: 48, opacity: done ? 0.45 : active ? 1 : 0.25 }}>
              <div style={{ width: 22, height: 22, borderRadius: "50%", background: done ? C.green : active ? C.accent : C.s3, border: `1.5px solid ${done ? C.green : active ? C.accent : C.bMid}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: done ? 11 : 11, color: "#fff", fontWeight: 800, flexShrink: 0 }}>
                {done ? "✓" : i + 1}
              </div>
              <T size={12} w={active ? 600 : 400} c={active ? C.text : C.mid}>{l}</T>
            </Fl>
            {i < labels.length - 1 && <div style={{ width: 28, height: 1, background: i < idx ? C.green : C.border, alignSelf: "center", flexShrink: 0 }} />}
          </Fl>
        );
      })}
    </Fl>
  );
}

// ── Log entry component ───────────────────────────────────────────────────────
function LogEntry({ entry }) {
  const colors = { success: C.green, error: C.red, warn: C.amber, dim: C.dim, info: C.accent };
  return (
    <Fl gap={10} style={{ padding: "5px 10px", borderRadius: 7, background: C.s3, animation: "fadeUp .2s ease" }}>
      <T size={10} c={C.dim} mono style={{ flexShrink: 0 }}>{entry.t}</T>
      <div style={{ width: 6, height: 6, borderRadius: "50%", background: colors[entry.type] || C.mid, flexShrink: 0 }} />
      <T size={11.5} c={colors[entry.type] || C.mid}>{entry.msg}</T>
      {entry.badge && <Chip label={entry.badge} color={colors[entry.type] || C.mid} />}
    </Fl>
  );
}

// ── Diff block ────────────────────────────────────────────────────────────────
function DiffCard({ change, accepted, onToggle, blockType, violationIssues }) {
  const [open, setOpen] = useState(false);
  const isViolation = violationIssues && violationIssues.length > 0;
  return (
    <div style={{ border: `1px solid ${isViolation ? `${C.red}44` : accepted ? C.accentBorder : C.border}`, borderRadius: 10, overflow: "hidden", background: isViolation ? C.redDim : accepted ? C.accentDim : C.s2, transition: "all .15s" }}>
      {isViolation && (
        <Fl gap={8} style={{ padding: "6px 12px", background: `${C.red}12`, borderBottom: `1px solid ${C.red}22` }}>
          <T size={11} c={C.red}>⚠ Skipped — validator rejected this change</T>
          <Chip label={violationIssues[0]} color={C.red} />
        </Fl>
      )}
      <Co gap={0} style={{ padding: "10px 14px 8px" }}>
        <div style={{ padding: "6px 10px", background: C.redDim, border: `1px solid ${C.red}1A`, borderRadius: "7px 7px 0 0" }}>
          <T size={11.5} c={C.red} mono style={{ lineHeight: 1.65, display: "block" }}>− {change.originalText || "(original)"}</T>
        </div>
        <div style={{ padding: "6px 10px", background: C.greenDim, border: `1px solid ${C.green}1A`, borderRadius: "0 0 7px 7px" }}>
          <T size={11.5} c={C.green} mono style={{ lineHeight: 1.65, display: "block" }}>+ {change.newText}</T>
        </div>
      </Co>
      <Fl gap={8} style={{ padding: "6px 14px 8px", flexWrap: "wrap" }}>
        <Fl gap={5} style={{ flex: 1, flexWrap: "wrap" }}>
          {(change.keywordsAdded || []).map(k => <Tag key={k} label={k} color={C.accent} />)}
        </Fl>
        <Chip label={blockType} color={C.mid} />
        <Btn label={open ? "Hide" : "Why?"} sz="sm" onClick={() => setOpen(!open)} />
        {!isViolation && (
          <Btn
            label={accepted ? "✓ Accepted" : "Accept"}
            v={accepted ? "success" : "ghost"}
            sz="sm"
            onClick={onToggle}
          />
        )}
      </Fl>
      {open && (
        <div style={{ padding: "8px 14px 10px", borderTop: `1px solid ${C.border}`, background: C.s3 }}>
          <T size={11.5} c={C.mid} style={{ lineHeight: 1.65, display: "block" }}>{change.reason || "Keyword alignment with job description"}</T>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function ResumeTailoringEngine() {
  const [stage, setStage] = useState("upload");

  // ── Master state (immutable once set) ──────────────────────────────────────
  const masterBufferRef = useRef(null);            // ArrayBuffer — never mutated
  const [fileName, setFileName] = useState("");
  const [blocks, setBlocks] = useState([]);        // parsed from master on upload
  const [skillWhitelist, setSkillWhitelist] = useState([]);

  // ── JD state ───────────────────────────────────────────────────────────────
  const [jdText, setJdText] = useState("");
  const [gapAnalysis, setGapAnalysis] = useState(null);

  // ── AI / pipeline state ────────────────────────────────────────────────────
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState([]);
  const [validChanges, setValidChanges] = useState([]);
  const [violations, setViolations] = useState([]);
  const [accepted, setAccepted] = useState({});

  // ── Export options ─────────────────────────────────────────────────────────
  const [emphasize, setEmphasize] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportDone, setExportDone] = useState(false);

  // ── Misc ───────────────────────────────────────────────────────────────────
  const [uploadErr, setUploadErr] = useState("");
  const fileInputRef = useRef(null);

  const addLog = (msg, type = "info", badge) => {
    const t = new Date().toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(p => [...p, { msg, type, badge, t }]);
  };
  const delay = ms => new Promise(r => setTimeout(r, ms));

  // ── UPLOAD ─────────────────────────────────────────────────────────────────
  const handleUpload = useCallback(async (file) => {
    if (!file?.name.match(/\.docx?$/i)) { setUploadErr("Please upload a .docx file"); return; }
    setUploadErr("");
    try {
      const ab = await file.arrayBuffer();
      const JSZip = await loadJSZip();
      const zip = await JSZip.loadAsync(ab);
      const docXmlFile = zip.file("word/document.xml");
      if (!docXmlFile) throw new Error("Invalid .docx — missing word/document.xml");
      const xmlStr = await docXmlFile.async("string");
      const { blocks: parsed } = parseDocx(xmlStr);

      masterBufferRef.current = ab;     // store immutable master
      setBlocks(parsed);
      setFileName(file.name);

      const wl = extractSkillWhitelist(parsed);
      setSkillWhitelist(wl);

      setStage("jd");
    } catch (e) { setUploadErr(e.message); }
  }, []);

  // ── JD CHANGE → live gap analysis ─────────────────────────────────────────
  const handleJDChange = (text) => {
    setJdText(text);
    if (text.trim().length > 50) {
      setGapAnalysis(analyzeKeywordGap(blocks, text));
    } else {
      setGapAnalysis(null);
    }
  };

  // ── RUN FULL PIPELINE ─────────────────────────────────────────────────────
  const runPipeline = async () => {
    if (!blocks.length || !jdText.trim()) return;
    setRunning(true);
    setLogs([]);
    setValidChanges([]);
    setViolations([]);
    setAccepted({});
    setStage("analyze");

    try {
      await delay(100);
      addLog("System 1 — Block AST ready", "success", `${blocks.length} blocks`);
      await delay(150);

      // System 2: Keyword gap
      addLog("System 2 — Running keyword gap analysis...", "info");
      const gap = analyzeKeywordGap(blocks, jdText);
      setGapAnalysis(gap);
      await delay(200);
      addLog(`Gap analysis: ${gap.present.length} present, ${gap.missing.length} missing`, "success", `${gap.coverage}% coverage`);
      if (gap.missing.length > 0) addLog(`Missing: ${gap.missing.slice(0, 8).join(", ")}`, "dim");
      await delay(150);

      // System 3: Whitelist
      addLog(`System 3 — Skill whitelist: ${skillWhitelist.length} terms`, "success");
      await delay(150);

      // System 4: Claude
      const tailorable = blocks.filter(b => b.isTailorable);
      addLog(`System 4 — Sending ${tailorable.length} tailorable blocks to Claude...`, "info");
      addLog("Prompt contract: text only → JSON map → no XML exposure", "dim");

      const raw = await callClaude(tailorable, jdText, gap.missing, skillWhitelist);
      addLog(`Claude returned ${raw.length} suggested change(s)`, "success");
      await delay(150);

      // Enrich raw changes with originalText for display
      const enriched = raw.map(c => ({
        ...c,
        originalText: blocks.find(b => b.id === c.id)?.fullText || "",
      }));

      // System 5: Schema validator
      addLog("System 5 — Running schema validation...", "info");
      await delay(100);
      const { valid, violations: viols } = validateChanges(enriched, blocks, skillWhitelist, gap.jdKeywords);
      setValidChanges(valid);
      setViolations(viols);

      if (viols.length > 0) {
        viols.forEach(v => addLog(`Rejected id=${v.id}: ${v.issues[0]}`, "warn"));
      }
      addLog(`Validation: ${valid.length} passed, ${viols.length} rejected`, valid.length > 0 ? "success" : "warn");

      // Pre-accept all valid changes
      const initAcc = {};
      valid.forEach(c => { initAcc[c.id] = true; });
      setAccepted(initAcc);

      addLog("Systems 6 & 7 — Ready. Review and export.", "success");
      setStage("review");
    } catch (e) {
      addLog(`Pipeline error: ${e.message}`, "error");
    } finally {
      setRunning(false);
    }
  };

  // ── EXPORT ─────────────────────────────────────────────────────────────────
  const handleExport = async () => {
    setExporting(true);
    try {
      const changesToApply = validChanges.filter(c => accepted[c.id]);
      if (changesToApply.length === 0) { alert("No changes accepted."); setExporting(false); return; }

      const blob = await exportTailoredDocx(
        masterBufferRef.current,
        blocks,
        changesToApply,
        emphasize
      );

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName.replace(/\.docx?$/i, "_tailored.docx");
      a.click();
      URL.revokeObjectURL(url);
      setExportDone(true);
      setStage("done");
    } catch (e) {
      alert("Export failed: " + e.message);
    } finally {
      setExporting(false);
    }
  };

  const acceptedCount = Object.values(accepted).filter(Boolean).length;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'DM Sans', system-ui, sans-serif", color: C.text, display: "flex", flexDirection: "column" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;0,9..40,900&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        textarea { resize: none; outline: none; font-family: inherit; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2A2A2E; border-radius: 3px; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
      `}</style>

      {/* TOP BAR */}
      <div style={{ height: 52, background: C.surface, borderBottom: `1px solid ${C.border}`, padding: "0 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <Fl gap={10}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: `linear-gradient(135deg,${C.accent},${C.purple})`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✨</div>
          <Co gap={1}>
            <T size={13} w={700}>Resume Tailoring Engine</T>
            <T size={10} c={C.dim}>7-system pipeline · XML round-trip · zero format loss</T>
          </Co>
          {fileName && <Chip label={fileName} color={C.mid} />}
        </Fl>
        {stage === "review" && (
          <Fl gap={8}>
            <Chip label={`${acceptedCount}/${validChanges.length} accepted`} color={C.amber} />
            <Btn label={exporting ? "Exporting..." : "⬇ Export .docx"} v="primary" disabled={exporting || acceptedCount === 0} onClick={handleExport} sz="md" />
          </Fl>
        )}
      </div>

      <Pipeline stage={stage} />

      {/* BODY */}
      <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        <div style={{ maxWidth: 1120, margin: "0 auto" }}>

          {/* ═══════ UPLOAD + JD ═══════ */}
          {(stage === "upload" || stage === "jd") && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, animation: "fadeUp .3s ease" }}>

              {/* LEFT — Upload */}
              <Co gap={14}>
                <Card>
                  <CardH>
                    <Fl gap={8}>
                      <Chip label="System 1" color={C.accent} />
                      <T size={13} w={600}>Upload master resume</T>
                    </Fl>
                  </CardH>
                  <CardB>
                    {!blocks.length ? (
                      <div
                        onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files[0]); }}
                        onDragOver={e => e.preventDefault()}
                        onClick={() => fileInputRef.current?.click()}
                        style={{ border: `2px dashed ${C.accentBorder}`, borderRadius: 10, padding: "44px 20px", textAlign: "center", background: C.accentDim, cursor: "pointer" }}
                      >
                        <div style={{ fontSize: 38, marginBottom: 10 }}>📄</div>
                        <T size={14} w={600} style={{ display: "block", marginBottom: 6 }}>Drop your .docx here</T>
                        <T size={12} c={C.mid} style={{ display: "block", marginBottom: 18 }}>Format fully preserved · .docx only</T>
                        <Btn label="Browse Files" />
                        {uploadErr && <T size={11} c={C.red} style={{ display: "block", marginTop: 10 }}>{uploadErr}</T>}
                      </div>
                    ) : (
                      <Co gap={10}>
                        <div style={{ padding: "11px 13px", background: C.greenDim, border: `1px solid ${C.green}22`, borderRadius: 9 }}>
                          <Fl gap={10}>
                            <T size={18}>✅</T>
                            <Co gap={2}>
                              <T size={13} w={600} c={C.green}>Parsed successfully</T>
                              <T size={11} c={C.mid}>{fileName}</T>
                            </Co>
                          </Fl>
                        </div>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          {[
                            { l: "Total blocks", v: blocks.length, c: C.accent },
                            { l: "Tailorable", v: blocks.filter(b => b.isTailorable).length, c: C.green },
                            { l: "Bullets", v: blocks.filter(b => b.type === "bullet").length, c: C.amber },
                            { l: "Skill terms", v: skillWhitelist.length, c: C.purple },
                          ].map(s => (
                            <div key={s.l} style={{ padding: "10px 12px", background: C.s3, borderRadius: 8, border: `1px solid ${C.border}` }}>
                              <T size={22} w={800} c={s.c} style={{ display: "block" }}>{s.v}</T>
                              <T size={10} c={C.dim}>{s.l}</T>
                            </div>
                          ))}
                        </div>
                        {/* Whitelist preview */}
                        <Co gap={4}>
                          <T size={10} w={700} c={C.dim} style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>Skill whitelist (auto-extracted)</T>
                          <Fl gap={5} wrap>
                            {skillWhitelist.slice(0, 18).map(s => <Tag key={s} label={s} color={C.purple} />)}
                            {skillWhitelist.length > 18 && <Tag label={`+${skillWhitelist.length - 18} more`} color={C.dim} />}
                          </Fl>
                          <T size={10} c={C.dim}>Claude can ONLY use these terms + JD keywords. Nothing else.</T>
                        </Co>
                        <Btn label="Replace file" sz="sm" onClick={() => { fileInputRef.current?.click(); }} />
                      </Co>
                    )}
                  </CardB>
                </Card>

                {/* Architecture map */}
                <Card>
                  <CardH><T size={11} w={700} c={C.dim} style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>7-System Architecture</T></CardH>
                  <CardB>
                    <Co gap={8}>
                      {[
                        { n: "1", title: "Parser", body: "Extracts blocks + pPrXml + baseRprXml. XML refs stored, never stringified until export.", c: C.accent },
                        { n: "2", title: "Keyword Gap Analyzer", body: "Local pre-AI scan. Finds missing JD keywords. Fed directly into prompt so Claude knows what to inject.", c: C.cyan },
                        { n: "3", title: "Skill Whitelist", body: "Auto-extracted from your resume. Hard constraint in AI prompt and post-AI validator.", c: C.purple },
                        { n: "4", title: "AI Layer (Claude)", body: "Sees only plain text + IDs. Returns only {id, newText}. Zero XML exposure.", c: "#F97316" },
                        { n: "5", title: "Schema Validator", body: "Checks IDs, rejects XML in output, flags fabricated skills not on whitelist or in JD.", c: C.amber },
                        { n: "6", title: "Run Rebuilder", body: "Deletes all <w:r>. Creates fresh runs. Copies <w:pPr> + baseRpr exactly. Optional keyword emphasis.", c: C.green },
                        { n: "7", title: "Exporter", body: "Always re-parses from immutable masterBuffer. Applies validated changes only. Repacks ZIP.", c: C.red },
                      ].map(s => (
                        <Fl key={s.n} gap={10} align="flex-start">
                          <div style={{ width: 22, height: 22, borderRadius: 6, background: `${s.c}18`, border: `1px solid ${s.c}28`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <T size={10} w={800} c={s.c}>{s.n}</T>
                          </div>
                          <Co gap={2}>
                            <T size={12} w={600}>{s.title}</T>
                            <T size={11} c={C.mid} style={{ lineHeight: 1.6 }}>{s.body}</T>
                          </Co>
                        </Fl>
                      ))}
                    </Co>
                  </CardB>
                </Card>
              </Co>

              {/* RIGHT — Job Description */}
              <Co gap={14}>
                <Card glow={stage === "jd"}>
                  <CardH>
                    <Fl gap={8} style={{ justifyContent: "space-between" }}>
                      <Fl gap={8}><Chip label="System 2" color={C.cyan} /><T size={13} w={600}>Paste job description</T></Fl>
                      {jdText.trim() && <Chip label={`${jdText.trim().split(/\s+/).length} words`} color={C.mid} />}
                    </Fl>
                  </CardH>
                  <CardB>
                    <textarea
                      value={jdText}
                      onChange={e => handleJDChange(e.target.value)}
                      placeholder={`Paste the full job description here...

We're looking for a Senior Frontend Engineer to join our Core DX team. You'll work on the Vercel deployment pipeline, optimize Core Web Vitals tooling, and build Edge Runtime-first UI primitives.

Requirements:
• 5+ years React/TypeScript
• Deep knowledge of Edge Runtime
• Experience with Web Performance APIs
• CI/CD pipeline experience`}
                      style={{ width: "100%", height: 220, padding: "12px 13px", background: C.s3, border: `1px solid ${C.bMid}`, borderRadius: 9, color: C.text, fontSize: 12.5, lineHeight: 1.7 }}
                    />
                  </CardB>
                  {/* Live gap analysis */}
                  {gapAnalysis && (
                    <div style={{ padding: "0 16px 14px" }}>
                      <Fl gap={8} style={{ marginBottom: 8 }}>
                        <T size={11} w={600} c={C.mid}>Keyword Coverage</T>
                        <T size={11} w={700} c={gapAnalysis.coverage >= 60 ? C.green : gapAnalysis.coverage >= 30 ? C.amber : C.red}>{gapAnalysis.coverage}%</T>
                      </Fl>
                      <MiniBar value={gapAnalysis.present.length} max={gapAnalysis.jdKeywords.length || 1} color={gapAnalysis.coverage >= 60 ? C.green : C.amber} />
                      <Fl gap={12} style={{ marginTop: 10 }}>
                        <Co gap={5} style={{ flex: 1 }}>
                          <T size={10} w={700} c={C.green} style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>Present ({gapAnalysis.present.length})</T>
                          <Fl gap={4} wrap>{gapAnalysis.present.slice(0, 8).map(k => <Tag key={k} label={k} color={C.green} />)}</Fl>
                        </Co>
                        <Co gap={5} style={{ flex: 1 }}>
                          <T size={10} w={700} c={C.amber} style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>Missing ({gapAnalysis.missing.length})</T>
                          <Fl gap={4} wrap>{gapAnalysis.missing.slice(0, 8).map(k => <Tag key={k} label={k} color={C.amber} />)}</Fl>
                        </Co>
                      </Fl>
                    </div>
                  )}
                </Card>

                {/* Run button */}
                <Card>
                  <CardB>
                    <Co gap={12}>
                      {/* What Claude will do */}
                      <div style={{ padding: "12px 13px", background: C.accentDim, border: `1px solid ${C.accentBorder}`, borderRadius: 9 }}>
                        <Fl gap={10} align="flex-start">
                          <div style={{ width: 34, height: 34, borderRadius: 9, background: C.accent, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, flexShrink: 0 }}>🤖</div>
                          <Co gap={4}>
                            <T size={12} w={600}>What the pipeline does</T>
                            <Co gap={3}>
                              {[
                                "Pre-scan JD for missing keywords (local, no AI cost)",
                                "Send only plain text blocks + missing list to Claude",
                                "Validate all changes against skill whitelist",
                                "Rebuild runs from scratch — pPr + baseRpr cloned exactly",
                                "Export from immutable master — zero accumulation",
                              ].map(s => <Fl key={s} gap={6}><T size={11} c={C.green}>✓</T><T size={11} c={C.mid}>{s}</T></Fl>)}
                            </Co>
                          </Co>
                        </Fl>
                      </div>

                      <Div />

                      <Btn
                        label={running ? "Running pipeline..." : !blocks.length ? "Upload resume first" : !jdText.trim() ? "Paste job description first" : "🚀 Run 7-System Pipeline"}
                        v={blocks.length && jdText.trim() ? "primary" : "ghost"}
                        disabled={!blocks.length || !jdText.trim() || running}
                        full
                        style={{ padding: "11px", fontSize: 14 }}
                        onClick={runPipeline}
                      />
                    </Co>
                  </CardB>
                </Card>
              </Co>
            </div>
          )}

          {/* ═══════ ANALYZE ═══════ */}
          {stage === "analyze" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 18, animation: "fadeUp .3s ease" }}>
              <Card>
                <CardH>
                  <Fl gap={10}>
                    {running && <Spin color={C.accent} />}
                    <T size={13} w={600}>{running ? "Pipeline running..." : "Pipeline complete"}</T>
                  </Fl>
                </CardH>
                <CardB>
                  <Co gap={5}>
                    {logs.map((l, i) => <LogEntry key={i} entry={l} />)}
                    {running && (
                      <Fl gap={8} style={{ padding: "10px", justifyContent: "center" }}>
                        <Spin color={C.accent} size={13} />
                        <T size={12} c={C.mid}>Waiting for Claude...</T>
                      </Fl>
                    )}
                  </Co>
                </CardB>
              </Card>

              {/* System diagram during analysis */}
              <Co gap={12}>
                <Card>
                  <CardH><T size={11} w={700} c={C.dim} style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>Live System Status</T></CardH>
                  <CardB>
                    <Co gap={8}>
                      {[
                        { n: "1", label: "Parser", done: true },
                        { n: "2", label: "Gap Analyzer", done: logs.some(l => l.msg.includes("Gap analysis")) },
                        { n: "3", label: "Whitelist", done: logs.some(l => l.msg.includes("whitelist")) },
                        { n: "4", label: "Claude API", done: logs.some(l => l.msg.includes("Claude returned")) },
                        { n: "5", label: "Validator", done: logs.some(l => l.msg.includes("Validation")) },
                        { n: "6", label: "Run Rebuilder", done: false },
                        { n: "7", label: "Exporter", done: false },
                      ].map(s => {
                        const active = !s.done && running && logs.some(l => l.msg.toLowerCase().includes(s.label.toLowerCase().split(" ")[0]));
                        return (
                          <Fl key={s.n} gap={10}>
                            <div style={{ width: 22, height: 22, borderRadius: 6, background: s.done ? C.green : active ? C.accentDim : C.s3, border: `1px solid ${s.done ? C.green : active ? C.accent : C.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              {s.done ? <T size={10} w={800} c="#111">✓</T> : active ? <Spin size={10} color={C.accent} /> : <T size={10} w={700} c={C.dim}>{s.n}</T>}
                            </div>
                            <T size={12} w={s.done ? 600 : 400} c={s.done ? C.text : C.dim}>{s.label}</T>
                          </Fl>
                        );
                      })}
                    </Co>
                  </CardB>
                </Card>

                {gapAnalysis && (
                  <Card>
                    <CardH><T size={11} w={700} c={C.dim} style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>Gap Analysis Result</T></CardH>
                    <CardB>
                      <Co gap={8}>
                        <Fl gap={8}>
                          <T size={28} w={900} c={gapAnalysis.coverage >= 60 ? C.green : C.amber}>{gapAnalysis.coverage}%</T>
                          <T size={12} c={C.mid}>keyword coverage</T>
                        </Fl>
                        <MiniBar value={gapAnalysis.present.length} max={gapAnalysis.jdKeywords.length || 1} color={gapAnalysis.coverage >= 60 ? C.green : C.amber} />
                        <Co gap={5}>
                          <T size={10} w={700} c={C.amber} style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>Missing ({gapAnalysis.missing.length})</T>
                          <Fl gap={4} wrap>{gapAnalysis.missing.slice(0, 12).map(k => <Tag key={k} label={k} color={C.amber} />)}</Fl>
                        </Co>
                      </Co>
                    </CardB>
                  </Card>
                )}
              </Co>
            </div>
          )}

          {/* ═══════ REVIEW ═══════ */}
          {stage === "review" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 18, animation: "fadeUp .3s ease" }}>
              <Co gap={14}>
                <Fl gap={10} style={{ justifyContent: "space-between" }}>
                  <Co gap={3}>
                    <T size={18} w={700}>Review Changes</T>
                    <T size={12} c={C.mid}>Accept or reject · System 6 rebuilds runs on export</T>
                  </Co>
                  <Fl gap={8}>
                    <Btn label="Accept All" v="success" sz="sm" onClick={() => { const a = {}; validChanges.forEach(c => { a[c.id] = true; }); setAccepted(a); }} />
                    <Btn label="Reject All" sz="sm" onClick={() => { const a = {}; validChanges.forEach(c => { a[c.id] = false; }); setAccepted(a); }} />
                  </Fl>
                </Fl>

                {validChanges.length === 0 && violations.length === 0 && (
                  <Card><CardB style={{ textAlign: "center", padding: 40 }}>
                    <div style={{ fontSize: 36, marginBottom: 12 }}>🎯</div>
                    <T size={14} w={600} style={{ display: "block" }}>Resume already well-aligned</T>
                  </CardB></Card>
                )}

                <Co gap={9}>
                  {validChanges.map((c, i) => (
                    <div key={c.id} style={{ animation: `fadeUp .25s ease ${i * 0.04}s both` }}>
                      <DiffCard
                        change={c}
                        accepted={accepted[c.id] ?? true}
                        onToggle={() => setAccepted(p => ({ ...p, [c.id]: !p[c.id] }))}
                        blockType={blocks.find(b => b.id === c.id)?.type || "?"}
                      />
                    </div>
                  ))}
                  {violations.map((v, i) => {
                    const fakeChange = { id: v.id, newText: "—", originalText: blocks.find(b => b.id === v.id)?.fullText || "", keywordsAdded: [], reason: "" };
                    return (
                      <div key={v.id} style={{ opacity: 0.5 }}>
                        <DiffCard change={fakeChange} accepted={false} onToggle={() => {}} blockType="rejected" violationIssues={v.issues} />
                      </div>
                    );
                  })}
                </Co>
              </Co>

              {/* Right sidebar */}
              <Co gap={12} style={{ position: "sticky", top: 0, alignSelf: "flex-start" }}>
                {/* Export card */}
                <Card glow>
                  <CardH>
                    <T size={11} w={700} c={C.accent} style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>Export Options</T>
                  </CardH>
                  <CardB>
                    <Co gap={12}>
                      {/* Stats */}
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                        {[
                          { v: validChanges.length, l: "Suggestions", c: C.accent },
                          { v: acceptedCount, l: "Accepted", c: C.green },
                          { v: violations.length, l: "Rejected by validator", c: C.red },
                          { v: blocks.length - acceptedCount, l: "Unchanged", c: C.dim },
                        ].map(s => (
                          <div key={s.l} style={{ padding: "9px 10px", background: C.s3, borderRadius: 8, border: `1px solid ${C.border}` }}>
                            <T size={22} w={800} c={s.c} style={{ display: "block" }}>{s.v}</T>
                            <T size={10} c={C.dim}>{s.l}</T>
                          </div>
                        ))}
                      </div>

                      <Div />

                      {/* Emphasize toggle */}
                      <Toggle
                        on={emphasize}
                        onToggle={() => setEmphasize(!emphasize)}
                        label="Emphasize added keywords"
                        sub="Wraps injected terms in bold runs (System 6). Off by default."
                      />

                      <Div />

                      {/* System 6 explainer */}
                      <Co gap={6}>
                        <T size={11} w={600} c={C.mid}>System 6 — Run Rebuilder</T>
                        {[
                          `Delete all old <w:r> in changed paragraphs`,
                          `Clone <w:pPr> from master (spacing, indent, style)`,
                          `Clone baseRpr from first original run`,
                          emphasize
                            ? `Split text around keywords → separate <w:r> with <w:b/>`
                            : `Single <w:r> per paragraph, plain text, no bold injection`,
                          `Unchanged paragraphs: zero XML modifications`,
                        ].map(f => (
                          <Fl key={f} gap={6}>
                            <T size={10} c={emphasize && f.includes("bold") ? C.amber : C.green}>→</T>
                            <T size={10.5} c={C.mid} mono>{f}</T>
                          </Fl>
                        ))}
                      </Co>

                      <Div />

                      <Co gap={5}>
                        <T size={11} w={600} c={C.mid}>Format guarantee</T>
                        {["Fonts & sizes", "Paragraph spacing", "Bullet styles", "Headers/footers", "Images", "Tables"].map(f => (
                          <Fl key={f} gap={5}><T size={11} c={C.green}>✓</T><T size={11} c={C.mid}>{f}</T></Fl>
                        ))}
                      </Co>

                      <Btn
                        label={exporting ? "Exporting..." : `Export ${acceptedCount} change${acceptedCount !== 1 ? "s" : ""}`}
                        v="primary" full disabled={exporting || acceptedCount === 0}
                        onClick={handleExport}
                        style={{ padding: "10px", fontSize: 13 }}
                      />
                    </Co>
                  </CardB>
                </Card>

                {/* Keyword coverage */}
                {gapAnalysis && (
                  <Card>
                    <CardH><T size={11} w={700} c={C.dim} style={{ textTransform: "uppercase", letterSpacing: "0.07em" }}>Keyword Coverage</T></CardH>
                    <CardB>
                      <Co gap={7}>
                        {gapAnalysis.jdKeywords.slice(0, 14).map(kw => {
                          const wasMissing = gapAnalysis.missing.map(m => m.toLowerCase()).includes(kw.toLowerCase());
                          const nowInjected = validChanges
                            .filter(c => accepted[c.id])
                            .flatMap(c => c.keywordsAdded || [])
                            .map(k => k.toLowerCase())
                            .includes(kw.toLowerCase());
                          const color = !wasMissing ? C.green : nowInjected ? C.accent : C.amber;
                          const status = !wasMissing ? "already present" : nowInjected ? "injected" : "still missing";
                          return (
                            <Fl key={kw} gap={7}>
                              <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
                              <T size={11.5} c={color} style={{ flex: 1 }}>{kw}</T>
                              <Chip label={status} color={color} />
                            </Fl>
                          );
                        })}
                      </Co>
                    </CardB>
                  </Card>
                )}

                <Btn label="← Edit JD" full style={{ justifyContent: "center" }} onClick={() => setStage("jd")} />
              </Co>
            </div>
          )}

          {/* ═══════ DONE ═══════ */}
          {stage === "done" && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 420, animation: "fadeUp .4s ease" }}>
              <Co gap={24} style={{ textAlign: "center", maxWidth: 540 }}>
                <div style={{ fontSize: 60 }}>🎉</div>
                <Co gap={8}>
                  <T size={32} w={900} style={{ display: "block", letterSpacing: "-0.03em" }}>Resume exported.</T>
                  <T size={14} c={C.mid} style={{ display: "block", lineHeight: 1.7 }}>
                    {acceptedCount} change{acceptedCount !== 1 ? "s" : ""} applied via Run Rebuilder.
                    Original formatting preserved — fonts, spacing, bullets, headers all intact.
                  </T>
                </Co>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                  {[
                    { icon: "📦", title: "Master untouched", sub: "Original never mutated" },
                    { icon: "🔬", title: "Runs rebuilt", sub: "pPr + baseRpr cloned exactly" },
                    { icon: "🔒", title: "Zero fabrication", sub: "Whitelist enforced" },
                  ].map(s => (
                    <Card key={s.title}>
                      <CardB style={{ textAlign: "center", padding: "16px 10px" }}>
                        <div style={{ fontSize: 22, marginBottom: 8 }}>{s.icon}</div>
                        <T size={12} w={600} style={{ display: "block", marginBottom: 3 }}>{s.title}</T>
                        <T size={10} c={C.dim}>{s.sub}</T>
                      </CardB>
                    </Card>
                  ))}
                </div>
                <Fl gap={10} style={{ justifyContent: "center" }}>
                  <Btn label="Tailor for another job →" v="primary" style={{ padding: "10px 22px" }}
                    onClick={() => { setStage("jd"); setValidChanges([]); setAccepted({}); setJdText(""); setGapAnalysis(null); setExportDone(false); setLogs([]); }} />
                  <Btn label="Upload new resume"
                    onClick={() => { setStage("upload"); masterBufferRef.current = null; setBlocks([]); setFileName(""); setSkillWhitelist([]); setValidChanges([]); setAccepted({}); setJdText(""); setGapAnalysis(null); setLogs([]); setExportDone(false); }} />
                </Fl>
              </Co>
            </div>
          )}

        </div>
      </div>

      <input ref={fileInputRef} type="file" accept=".docx,.doc" style={{ display: "none" }} onChange={e => { if (e.target.files[0]) handleUpload(e.target.files[0]); e.target.value = ""; }} />
    </div>
  );
}
