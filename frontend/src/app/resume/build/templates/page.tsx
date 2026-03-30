"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, CheckCircle2, Star, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBuildResume, useSetCurrentResume } from "@/hooks/useProfile";

// ── sample data for template previews ─────────────────────────────────────

const SAMPLE = {
  full_name: "Alex Johnson",
  email: "alex@example.com",
  phone: "(555) 123-4567",
  location: "San Francisco, CA",
  linkedin: "linkedin.com/in/alexj",
  github: "github.com/alexj",
  summary:
    "Full-stack engineer with 8+ years of experience building scalable web applications and distributed systems. Passionate about clean code and developer experience.",
  skills: [
    {
      category: "Languages",
      skills: [
        { name: "Python", level: 5 },
        { name: "TypeScript", level: 4 },
        { name: "Go", level: 3 },
      ],
    },
    {
      category: "Frameworks",
      skills: [
        { name: "React", level: 4 },
        { name: "FastAPI", level: 5 },
        { name: "PostgreSQL", level: 4 },
      ],
    },
  ],
  experience: [
    {
      company: "TechCorp Inc.",
      title: "Senior Software Engineer",
      start_date: "Jan 2021",
      end_date: "Present",
      location: "San Francisco, CA",
      bullets: [
        "Built microservices architecture serving 50M+ users",
        "Led migration to Kubernetes reducing costs by 40%",
        "Mentored 6 junior engineers across two teams",
      ],
    },
    {
      company: "StartupXYZ",
      title: "Software Engineer",
      start_date: "Jun 2018",
      end_date: "Dec 2020",
      location: "Remote",
      bullets: [
        "Developed real-time analytics dashboard with React + WebSockets",
        "Reduced API response time by 60% via query optimization",
      ],
    },
  ],
  education: [
    {
      institution: "Stanford University",
      degree: "B.S.",
      field: "Computer Science",
      start_date: "Sep 2013",
      end_date: "Jun 2017",
      gpa: "3.9",
    },
  ],
  projects: [
    {
      name: "JobFinder AI",
      link: "github.com/alexj/jobfinder",
      tech_stack: ["Python", "FastAPI", "React"],
      description: "AI-powered job search assistant with LLM-based resume tailoring.",
    },
  ],
  achievements: ["Hackathon winner 2023", "Top 1% LeetCode rating"],
  certifications: [{ name: "AWS Solutions Architect", issuer: "Amazon", date: "Mar 2022" }],
};

// ── helpers ────────────────────────────────────────────────────────────────

const dots = (level: number) => "●".repeat(level) + "○".repeat(5 - level);

type SampleData = typeof SAMPLE;

// ── Classic ───────────────────────────────────────────────────────────────

function ClassicPreview({ d = SAMPLE }: { d?: SampleData }) {
  const contact = [d.email, d.phone, d.location, d.linkedin, d.github]
    .filter(Boolean)
    .join("  |  ");
  return (
    <div
      style={{
        fontFamily: "'Times New Roman', Georgia, serif",
        fontSize: 10,
        color: "#000",
        padding: "72px 96px",
        width: 816,
        minHeight: 1056,
        background: "#fff",
        boxSizing: "border-box",
      }}
    >
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 18, marginBottom: 4 }}>
        {d.full_name}
      </div>
      <div style={{ textAlign: "center", fontSize: 9, color: "#555", marginBottom: 8 }}>{contact}</div>
      {[
        {
          title: "PROFESSIONAL SUMMARY",
          body: <div>{d.summary}</div>,
        },
        {
          title: "EXPERIENCE",
          body: d.experience.map((exp, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div>
                <strong>{exp.company}</strong>
                <span style={{ color: "#666", fontSize: 9 }}>
                  {"  "}
                  {exp.start_date} – {exp.end_date}
                </span>
              </div>
              <div style={{ fontStyle: "italic" }}>
                {exp.title}
                <span style={{ color: "#666", fontSize: 9 }}>{"  "}{exp.location}</span>
              </div>
              {exp.bullets.map((b, j) => (
                <div key={j} style={{ paddingLeft: 14 }}>
                  • {b}
                </div>
              ))}
            </div>
          )),
        },
        {
          title: "EDUCATION",
          body: d.education.map((edu, i) => (
            <div key={i} style={{ marginBottom: 6 }}>
              <div>
                <strong>{edu.institution}</strong>
                <span style={{ color: "#666", fontSize: 9 }}>
                  {"  "}
                  {edu.start_date} – {edu.end_date}
                </span>
              </div>
              <div>
                {edu.degree} in {edu.field}
                {edu.gpa ? ` • GPA: ${edu.gpa}` : ""}
              </div>
            </div>
          )),
        },
        {
          title: "SKILLS",
          body: d.skills.map((cat, i) => (
            <div key={i}>
              <strong>{cat.category}:</strong>{" "}
              {cat.skills.map((s) => `${s.name} ${dots(s.level)}`).join("     ")}
            </div>
          )),
        },
      ].map((s, i) => (
        <div key={i}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 10,
              borderBottom: "1px solid #000",
              marginTop: 12,
              marginBottom: 4,
              paddingBottom: 1,
            }}
          >
            {s.title}
          </div>
          {s.body}
        </div>
      ))}
    </div>
  );
}

// ── Modern ────────────────────────────────────────────────────────────────

function ModernPreview({ d = SAMPLE }: { d?: SampleData }) {
  const accent = "#4F46E5";
  const dark = "#1E1B4B";
  const gray = "#6B7280";
  const contact = [d.email, d.phone, d.location, d.linkedin].filter(Boolean).join("  ·  ");
  return (
    <div
      style={{
        fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 10,
        color: "#111",
        padding: "60px 72px",
        width: 816,
        minHeight: 1056,
        background: "#fff",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontWeight: 800, fontSize: 24, color: dark, marginBottom: 4 }}>{d.full_name}</div>
      <div style={{ fontSize: 9, color: gray, marginBottom: 16 }}>{contact}</div>
      {[
        { label: "Summary", body: <div>{d.summary}</div> },
        {
          label: "Experience",
          body: d.experience.map((exp, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 11 }}>{exp.company}</div>
              <div style={{ fontStyle: "italic", fontSize: 10, color: gray, marginBottom: 4 }}>
                {exp.title} · {exp.start_date} – {exp.end_date}
              </div>
              {exp.bullets.map((b, j) => (
                <div key={j} style={{ paddingLeft: 14 }}>
                  <span style={{ color: accent }}>▸</span>{"  "}{b}
                </div>
              ))}
            </div>
          )),
        },
        {
          label: "Education",
          body: d.education.map((edu, i) => (
            <div key={i}>
              <strong>{edu.institution}</strong>
              <span style={{ color: gray, fontSize: 9 }}>
                {"  "}
                {edu.start_date} – {edu.end_date}
              </span>
              <br />
              <em>
                {edu.degree} in {edu.field}
              </em>
            </div>
          )),
        },
        {
          label: "Skills",
          body: d.skills.map((cat, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 700, color: accent }}>{cat.category}{"  "}</span>
              {cat.skills.map((s, j) => (
                <span key={j} style={{ marginRight: 14 }}>
                  {s.name}{"  "}
                  <span style={{ color: accent, fontSize: 8 }}>{dots(s.level)}</span>
                </span>
              ))}
            </div>
          )),
        },
      ].map((s, i) => (
        <div key={i} style={{ marginTop: 14 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 11,
              color: accent,
              borderLeft: `3px solid ${accent}`,
              paddingLeft: 8,
              marginBottom: 6,
            }}
          >
            {s.label}
          </div>
          {s.body}
        </div>
      ))}
    </div>
  );
}

// ── Elegant ───────────────────────────────────────────────────────────────

function ElegantPreview({ d = SAMPLE }: { d?: SampleData }) {
  const gold = "#B45309";
  const contact = [d.email, d.phone, d.location, d.linkedin].filter(Boolean).join("  •  ");
  return (
    <div
      style={{
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: 10,
        color: "#222",
        padding: "72px 88px",
        width: 816,
        minHeight: 1056,
        background: "#fff",
        boxSizing: "border-box",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 2,
            textTransform: "uppercase",
            marginBottom: 8,
          }}
        >
          {d.full_name}
        </div>
        <div
          style={{
            borderTop: `1px solid ${gold}`,
            borderBottom: `1px solid ${gold}`,
            margin: "0 80px",
            padding: "5px 0",
            fontSize: 9,
            color: "#666",
            letterSpacing: 0.5,
            marginBottom: 4,
          }}
        >
          {contact}
        </div>
      </div>
      {[
        { title: "Profile", body: <div>{d.summary}</div> },
        {
          title: "Experience",
          body: d.experience.map((exp, i) => (
            <div key={i} style={{ marginBottom: 10 }}>
              <div>
                <strong>{exp.company}</strong>
                <span style={{ color: "#888", fontSize: 9 }}>
                  {"  "}
                  {exp.start_date} – {exp.end_date}
                </span>
              </div>
              <div style={{ fontStyle: "italic", color: gold, marginBottom: 3 }}>{exp.title}</div>
              {exp.bullets.map((b, j) => (
                <div key={j} style={{ paddingLeft: 14 }}>
                  – {b}
                </div>
              ))}
            </div>
          )),
        },
        {
          title: "Education",
          body: d.education.map((edu, i) => (
            <div key={i}>
              <strong>{edu.institution}</strong>
              <span style={{ color: "#888", fontSize: 9 }}>
                {"  "}
                {edu.start_date} – {edu.end_date}
              </span>
              <br />
              <em>
                {edu.degree} in {edu.field}
              </em>
            </div>
          )),
        },
        {
          title: "Skills",
          body: d.skills.map((cat, i) => (
            <div key={i}>
              <span style={{ fontWeight: 700, color: gold }}>{cat.category}: </span>
              {cat.skills.map((s) => s.name).join(",  ")}
            </div>
          )),
        },
      ].map((s, i) => (
        <div key={i} style={{ marginTop: 16 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 11,
              color: gold,
              textTransform: "uppercase",
              letterSpacing: 2,
              borderBottom: `1px solid ${gold}`,
              paddingBottom: 3,
              marginBottom: 6,
            }}
          >
            {s.title}
          </div>
          {s.body}
        </div>
      ))}
    </div>
  );
}

// ── Minimal ───────────────────────────────────────────────────────────────

function MinimalPreview({ d = SAMPLE }: { d?: SampleData }) {
  const label = "#9CA3AF";
  const contact = [d.email, d.phone, d.location].filter(Boolean).join("  ·  ");
  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        fontSize: 10,
        color: "#111",
        padding: "56px 80px",
        width: 816,
        minHeight: 1056,
        background: "#fff",
        boxSizing: "border-box",
      }}
    >
      <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 2 }}>{d.full_name}</div>
      <div style={{ fontSize: 9, color: label, marginBottom: 20 }}>{contact}</div>
      {[
        { title: "About", body: <div>{d.summary}</div> },
        {
          title: "Experience",
          body: d.experience.map((exp, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{exp.company}</strong>
                <span style={{ color: label, fontSize: 9 }}>
                  {exp.start_date} – {exp.end_date}
                </span>
              </div>
              <div style={{ color: "#555", marginBottom: 3 }}>{exp.title}</div>
              {exp.bullets.map((b, j) => (
                <div key={j} style={{ paddingLeft: 12, color: "#333" }}>
                  · {b}
                </div>
              ))}
            </div>
          )),
        },
        {
          title: "Education",
          body: d.education.map((edu, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between" }}>
              <div>
                <strong>{edu.institution}</strong>
                <br />
                <span style={{ color: "#555" }}>
                  {edu.degree} in {edu.field}
                </span>
              </div>
              <span style={{ color: label, fontSize: 9 }}>
                {edu.start_date} – {edu.end_date}
              </span>
            </div>
          )),
        },
        {
          title: "Skills",
          body: d.skills.map((cat, i) => (
            <div key={i}>
              <span style={{ color: "#555" }}>{cat.category}{"  "}</span>
              {cat.skills.map((s) => s.name).join("  ·  ")}
            </div>
          )),
        },
      ].map((s, i) => (
        <div key={i} style={{ marginTop: 18 }}>
          <div
            style={{
              fontWeight: 600,
              fontSize: 10,
              color: label,
              textTransform: "uppercase",
              letterSpacing: 1.5,
              marginBottom: 6,
            }}
          >
            {s.title}
          </div>
          {s.body}
        </div>
      ))}
    </div>
  );
}

// ── Slate ─────────────────────────────────────────────────────────────────

function SlatePreview({ d = SAMPLE }: { d?: SampleData }) {
  const teal = "#0F766E";
  const contact = [d.email, d.phone, d.location, d.linkedin].filter(Boolean).join("  |  ");
  return (
    <div
      style={{
        fontFamily: "Verdana, Geneva, sans-serif",
        fontSize: 9.5,
        color: "#1E293B",
        padding: "64px 80px",
        width: 816,
        minHeight: 1056,
        background: "#fff",
        boxSizing: "border-box",
      }}
    >
      <div style={{ borderLeft: `4px solid ${teal}`, paddingLeft: 12, marginBottom: 14 }}>
        <div style={{ fontWeight: 800, fontSize: 22, color: "#0F172A" }}>{d.full_name}</div>
        <div style={{ fontSize: 9, color: "#64748B", marginTop: 3 }}>{contact}</div>
      </div>
      {[
        { title: "Summary", body: <div>{d.summary}</div> },
        {
          title: "Experience",
          body: d.experience.map((exp, i) => (
            <div key={i} style={{ marginBottom: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <strong>{exp.company}</strong>
                <span style={{ color: "#64748B", fontSize: 9 }}>
                  {exp.start_date} – {exp.end_date}
                </span>
              </div>
              <div style={{ color: teal, fontStyle: "italic", marginBottom: 3 }}>{exp.title}</div>
              {exp.bullets.map((b, j) => (
                <div key={j} style={{ paddingLeft: 12 }}>
                  ◆ {b}
                </div>
              ))}
            </div>
          )),
        },
        {
          title: "Education",
          body: d.education.map((edu, i) => (
            <div key={i}>
              <strong>{edu.institution}</strong>
              <span style={{ color: "#64748B", fontSize: 9 }}>
                {"  "}
                {edu.start_date} – {edu.end_date}
              </span>
              <br />
              <em>
                {edu.degree} in {edu.field}
              </em>
            </div>
          )),
        },
        {
          title: "Skills",
          body: d.skills.map((cat, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <span style={{ fontWeight: 700, color: teal }}>{cat.category}: </span>
              {cat.skills.map((s, j) => (
                <span key={j} style={{ marginRight: 12 }}>
                  {s.name}{"  "}
                  <span style={{ color: teal, fontSize: 8 }}>{dots(s.level)}</span>
                </span>
              ))}
            </div>
          )),
        },
      ].map((s, i) => (
        <div key={i} style={{ marginTop: 14 }}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 10.5,
              color: teal,
              textTransform: "uppercase",
              letterSpacing: 1,
              borderBottom: `2px solid ${teal}`,
              paddingBottom: 3,
              marginBottom: 6,
            }}
          >
            {s.title}
          </div>
          {s.body}
        </div>
      ))}
    </div>
  );
}

// ── Executive ─────────────────────────────────────────────────────────────

function ExecutivePreview({ d = SAMPLE }: { d?: SampleData }) {
  const navy = "#1E293B";
  const contact = [d.email, d.phone, d.location, d.linkedin].filter(Boolean).join("  |  ");
  return (
    <div
      style={{
        fontFamily: "Garamond, Georgia, serif",
        fontSize: 10,
        color: "#1E293B",
        width: 816,
        minHeight: 1056,
        background: "#fff",
        boxSizing: "border-box",
        overflow: "hidden",
      }}
    >
      <div style={{ background: navy, padding: "32px 64px", color: "#fff" }}>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: 1, marginBottom: 6 }}>
          {d.full_name}
        </div>
        <div style={{ fontSize: 9, color: "#94A3B8", letterSpacing: 0.5 }}>{contact}</div>
      </div>
      <div style={{ padding: "24px 64px" }}>
        {[
          { title: "Executive Summary", body: <div>{d.summary}</div> },
          {
            title: "Professional Experience",
            body: d.experience.map((exp, i) => (
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <strong style={{ fontSize: 11 }}>{exp.company}</strong>
                  <span style={{ color: "#64748B", fontSize: 9 }}>
                    {exp.start_date} – {exp.end_date}
                  </span>
                </div>
                <div style={{ fontStyle: "italic", color: "#475569", marginBottom: 4 }}>{exp.title}</div>
                {exp.bullets.map((b, j) => (
                  <div key={j} style={{ paddingLeft: 14 }}>
                    • {b}
                  </div>
                ))}
              </div>
            )),
          },
          {
            title: "Education",
            body: d.education.map((edu, i) => (
              <div key={i}>
                <strong>{edu.institution}</strong>
                <span style={{ color: "#64748B", fontSize: 9 }}>
                  {"  "}
                  {edu.start_date} – {edu.end_date}
                </span>
                <br />
                <em>
                  {edu.degree} in {edu.field}
                </em>
              </div>
            )),
          },
          {
            title: "Core Competencies",
            body: d.skills.map((cat, i) => (
              <div key={i}>
                <strong>{cat.category}: </strong>
                {cat.skills.map((s) => s.name).join(",  ")}
              </div>
            )),
          },
        ].map((s, i) => (
          <div key={i} style={{ marginTop: 16 }}>
            <div
              style={{
                fontWeight: 700,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 2,
                borderBottom: `2px solid ${navy}`,
                paddingBottom: 3,
                marginBottom: 6,
              }}
            >
              {s.title}
            </div>
            {s.body}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Template metadata ──────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: "classic",
    name: "Classic",
    desc: "Traditional, ATS-friendly",
    color: "#374151",
    Preview: ClassicPreview,
  },
  {
    id: "modern",
    name: "Modern",
    desc: "Indigo accents, contemporary",
    color: "#4F46E5",
    Preview: ModernPreview,
  },
  {
    id: "elegant",
    name: "Elegant",
    desc: "Gold accents, refined serif",
    color: "#B45309",
    Preview: ElegantPreview,
  },
  {
    id: "minimal",
    name: "Minimal",
    desc: "Clean, no borders, spacious",
    color: "#6B7280",
    Preview: MinimalPreview,
  },
  {
    id: "slate",
    name: "Slate",
    desc: "Teal accents, structured",
    color: "#0F766E",
    Preview: SlatePreview,
  },
  {
    id: "executive",
    name: "Executive",
    desc: "Navy header band, authoritative",
    color: "#1E293B",
    Preview: ExecutivePreview,
  },
];

// ── Preview card ───────────────────────────────────────────────────────────

const CARD_W = 290;
const SCALE = CARD_W / 816;
const CARD_H = Math.round(1056 * SCALE);

function TemplateCard({
  t,
  selected,
  onSelect,
}: {
  t: (typeof TEMPLATES)[0];
  selected: boolean;
  onSelect: () => void;
}) {
  const { Preview } = t;
  return (
    <div
      onClick={onSelect}
      className={cn(
        "cursor-pointer rounded-2xl border-2 overflow-hidden transition-all",
        selected
          ? "border-indigo-500 shadow-[0_0_0_3px_rgba(99,102,241,0.2)]"
          : "border-zinc-700 hover:border-zinc-500"
      )}
    >
      {/* scaled preview */}
      <div
        style={{
          width: CARD_W,
          height: CARD_H,
          overflow: "hidden",
          position: "relative",
          background: "#f5f5f5",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transformOrigin: "top left",
            transform: `scale(${SCALE})`,
            width: 816,
            pointerEvents: "none",
          }}
        >
          <Preview />
        </div>
      </div>

      {/* label */}
      <div
        className={cn(
          "px-4 py-3 border-t transition-colors",
          selected ? "bg-indigo-500/5 border-indigo-500/20" : "bg-zinc-900 border-zinc-800"
        )}
      >
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-bold text-zinc-200">{t.name}</div>
            <div className="text-[10px] text-zinc-500 mt-0.5">{t.desc}</div>
          </div>
          {selected && (
            <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center shrink-0">
              <CheckCircle2 size={12} className="text-white" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const router = useRouter();
  const [selected, setSelected] = useState("classic");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [formData, setFormData] = useState<Record<string, any> | null>(null);
  const [builtVersionId, setBuiltVersionId] = useState<number | null>(null);
  const [masterDone, setMasterDone] = useState(false);

  const buildMutation = useBuildResume();
  const setCurrentMutation = useSetCurrentResume();

  useEffect(() => {
    const raw = sessionStorage.getItem("resume_form_data");
    if (raw) {
      try {
        setFormData(JSON.parse(raw));
      } catch {
        /* ignore */
      }
    }
  }, []);

  const handleBuild = () => {
    if (!formData) return;

    const payload = {
      form_data: {
        ...formData,
        experience: (formData.experience ?? []).map(
          (e: Record<string, string>) => ({
            ...e,
            bullets:
              typeof e.bullets === "string"
                ? e.bullets
                    .split("\n")
                    .map((b: string) => b.trim().replace(/^[-•*]\s*/, ""))
                    .filter(Boolean)
                : e.bullets,
          })
        ),
        achievements:
          typeof formData.achievements === "string"
            ? formData.achievements
                .split("\n")
                .map((a: string) => a.trim().replace(/^[-•*]\s*/, ""))
                .filter(Boolean)
            : formData.achievements,
        projects: (formData.projects ?? []).map(
          (p: Record<string, string>) => ({
            ...p,
            tech_stack:
              typeof p.tech_stack === "string"
                ? p.tech_stack
                    .split(",")
                    .map((t: string) => t.trim())
                    .filter(Boolean)
                : p.tech_stack,
          })
        ),
      },
      template: selected,
    };

    buildMutation.mutate(payload, {
      onSuccess: (v) => setBuiltVersionId(v.id),
    });
  };

  const handleSetMaster = () => {
    if (!builtVersionId) return;
    setCurrentMutation.mutate(builtVersionId, {
      onSuccess: () => {
        setMasterDone(true);
        sessionStorage.removeItem("resume_form_data");
      },
    });
  };

  const isBuilt = builtVersionId !== null;
  const selectedTemplate = TEMPLATES.find((t) => t.id === selected)!;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      {/* header */}
      <header className="shrink-0 px-6 py-4 border-b border-zinc-800 bg-[#1A1A1A] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/resume/build")}
            className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-lg font-bold">Choose Template</h1>
            <p className="text-[11px] text-zinc-500">Select a style for your resume</p>
          </div>
        </div>
        {!isBuilt && (
          <button
            onClick={handleBuild}
            disabled={buildMutation.isPending || !formData}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-sm font-bold transition-colors"
          >
            {buildMutation.isPending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Wand2 size={15} />
            )}
            Build with {selectedTemplate.name}
          </button>
        )}
      </header>

      {/* body */}
      <div className="flex-1 overflow-y-auto p-6 pb-32">
        {!formData && (
          <div className="max-w-lg mx-auto mt-12 text-center space-y-3">
            <div className="text-zinc-400 text-sm">No form data found.</div>
            <button
              onClick={() => router.push("/resume/build")}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-semibold transition-colors"
            >
              Go back to form
            </button>
          </div>
        )}

        <div className="flex flex-wrap justify-center gap-6">
          {TEMPLATES.map((t) => (
            <TemplateCard
              key={t.id}
              t={t}
              selected={selected === t.id}
              onSelect={() => setSelected(t.id)}
            />
          ))}
        </div>
      </div>

      {/* footer */}
      <footer className="shrink-0 border-t border-zinc-800 bg-[#1A1A1A] px-6 py-4">
        {isBuilt ? (
          masterDone ? (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                <CheckCircle2 size={18} /> Resume set as master!
              </div>
              <button
                onClick={() => router.push("/resume")}
                className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-sm font-bold transition-colors"
              >
                Go to Resume →
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-emerald-400 font-semibold text-sm">
                <CheckCircle2 size={18} /> Resume built! Set it as your master resume?
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    sessionStorage.removeItem("resume_form_data");
                    router.push("/resume");
                  }}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg text-sm font-bold transition-colors"
                >
                  Not yet
                </button>
                <button
                  onClick={handleSetMaster}
                  disabled={setCurrentMutation.isPending}
                  className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg text-sm font-bold transition-colors"
                >
                  {setCurrentMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Star size={14} />
                  )}
                  Yes, set as master
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="flex items-center justify-between gap-4">
            <div className="text-[11px] text-zinc-500">
              {selectedTemplate.name} template selected
            </div>
            <button
              onClick={handleBuild}
              disabled={buildMutation.isPending || !formData}
              className="flex items-center gap-2 px-6 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-sm font-bold transition-colors"
            >
              {buildMutation.isPending ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Wand2 size={15} />
              )}
              Build with {selectedTemplate.name}
            </button>
          </div>
        )}
      </footer>
    </div>
  );
}
