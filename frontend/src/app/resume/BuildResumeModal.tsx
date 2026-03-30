"use client";

import React, { useEffect, useRef, useState } from "react";
import {
  X,
  Upload,
  FileText,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  ExternalLink,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useExtractResumeSections,
  useBuildResume,
  useSetCurrentResume,
} from "@/hooks/useProfile";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExperienceEntry {
  company: string;
  title: string;
  start_date: string;
  end_date: string;
  location: string;
  bullets: string; // newline-separated
}

interface EducationEntry {
  institution: string;
  degree: string;
  field: string;
  start_date: string;
  end_date: string;
  gpa: string;
}

interface CertificationEntry {
  name: string;
  issuer: string;
  date: string;
}

interface ProjectEntry {
  name: string;
  link: string;
  tech_stack: string; // comma-separated
  description: string;
}

interface SkillEntry {
  name: string;
  level: number; // 1–5
}

interface SkillCategory {
  category: string;
  skills: SkillEntry[];
}

interface ResumeFormData {
  full_name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  website: string;
  summary: string;
  skills: SkillCategory[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  achievements: string; // newline-separated
  certifications: CertificationEntry[];
  projects: ProjectEntry[];
}

const LEVEL_LABELS = ["", "Beginner", "Elementary", "Intermediate", "Advanced", "Expert"];

const EMPTY_SKILL: SkillEntry = { name: "", level: 3 };
const EMPTY_SKILL_CATEGORY: SkillCategory = { category: "", skills: [{ ...EMPTY_SKILL }] };

const EMPTY_FORM: ResumeFormData = {
  full_name: "",
  email: "",
  phone: "",
  location: "",
  linkedin: "",
  github: "",
  website: "",
  summary: "",
  skills: [],
  experience: [],
  education: [],
  achievements: "",
  certifications: [],
  projects: [],
};

const EMPTY_EXP: ExperienceEntry = {
  company: "",
  title: "",
  start_date: "",
  end_date: "",
  location: "",
  bullets: "",
};

const EMPTY_EDU: EducationEntry = {
  institution: "",
  degree: "",
  field: "",
  start_date: "",
  end_date: "",
  gpa: "",
};

const EMPTY_CERT: CertificationEntry = { name: "", issuer: "", date: "" };
const EMPTY_PROJECT: ProjectEntry = { name: "", link: "", tech_stack: "", description: "" };

// ── Small helpers ─────────────────────────────────────────────────────────────

type Step = "choose" | "upload" | "form" | "template" | "done";

const FORM_TABS = [
  "Profile",
  "Summary",
  "Skills",
  "Experience",
  "Education",
  "Projects",
  "Achievements",
  "Certifications",
] as const;
type FormTab = (typeof FORM_TABS)[number];

// ── MonthYearPicker ───────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseMonthYear(val: string): { month: number; year: number } | null {
  const parts = val.trim().split(" ");
  if (parts.length !== 2) return null;
  const mIdx = MONTHS.indexOf(parts[0]);
  const yr = parseInt(parts[1], 10);
  if (mIdx === -1 || isNaN(yr)) return null;
  return { month: mIdx, year: yr };
}

interface MonthYearPickerProps {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  allowPresent?: boolean;
}

function MonthYearPicker({ value, onChange, placeholder = "Select date", allowPresent = false }: MonthYearPickerProps) {
  const parsed = value && value !== "Present" ? parseMonthYear(value) : null;
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parsed?.year ?? new Date().getFullYear());
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync viewYear when value changes externally (e.g. LLM pre-fill)
  useEffect(() => {
    if (parsed) setViewYear(parsed.year);
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const selectMonth = (mIdx: number) => {
    onChange(`${MONTHS[mIdx]} ${viewYear}`);
    setOpen(false);
  };

  const displayValue = value || "";

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          inputCls,
          "flex items-center justify-between gap-2 text-left"
        )}
      >
        <span className={displayValue ? "text-zinc-200" : "text-zinc-600"}>
          {displayValue || placeholder}
        </span>
        <CalendarDays size={13} className="text-zinc-500 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 w-52 bg-[#1A1A1A] border border-zinc-700 rounded-xl shadow-2xl p-3">
          {/* Year navigation */}
          <div className="flex items-center justify-between mb-2.5">
            <button
              type="button"
              onClick={() => setViewYear((y) => y - 1)}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="text-sm font-bold text-zinc-200">{viewYear}</span>
            <button
              type="button"
              onClick={() => setViewYear((y) => y + 1)}
              className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"
            >
              <ChevronRight size={13} />
            </button>
          </div>

          {/* Month grid */}
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((m, i) => {
              const isSelected = parsed?.month === i && parsed?.year === viewYear;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => selectMonth(i)}
                  className={cn(
                    "py-1.5 rounded-lg text-[11px] font-semibold transition-colors",
                    isSelected
                      ? "bg-indigo-500 text-white"
                      : "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                  )}
                >
                  {m}
                </button>
              );
            })}
          </div>

          {/* Present option */}
          {allowPresent && (
            <button
              type="button"
              onClick={() => { onChange("Present"); setOpen(false); }}
              className={cn(
                "mt-2 w-full py-1.5 rounded-lg text-[11px] font-bold transition-colors border",
                value === "Present"
                  ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                  : "hover:bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300"
              )}
            >
              Present
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Field wrapper ─────────────────────────────────────────────────────────────

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">
        {label}
      </label>
      {children}
    </div>
  );
}

const inputCls =
  "w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors";

const textareaCls = cn(inputCls, "resize-none");

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

export default function BuildResumeModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>("choose");
  const [formData, setFormData] = useState<ResumeFormData>(EMPTY_FORM);
  const [activeTab, setActiveTab] = useState<FormTab>("Profile");
  const [template, setTemplate] = useState<"classic" | "modern">("classic");
  const [builtVersionId, setBuiltVersionId] = useState<number | null>(null);
  const [setAsMasterDone, setSetAsMasterDone] = useState(false);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  const extractMutation = useExtractResumeSections();
  const buildMutation = useBuildResume();
  const setCurrentMutation = useSetCurrentResume();

  // ── upload path ──
  const handleFileSelect = (file: File) => {
    extractMutation.mutate(file, {
      onSuccess: (sections) => {
        const arr = (v: unknown): string[] =>
          Array.isArray(v) ? (v as string[]) : [];

        setFormData({
          full_name: String(sections.full_name ?? ""),
          email: String(sections.email ?? ""),
          phone: String(sections.phone ?? ""),
          location: String(sections.location ?? ""),
          linkedin: String(sections.linkedin ?? ""),
          github: String(sections.github ?? ""),
          website: String(sections.website ?? ""),
          summary: String(sections.summary ?? ""),
          skills: (() => {
            const raw = sections.skills;
            if (!Array.isArray(raw) || raw.length === 0) return [];
            // Categorised format from updated LLM prompt
            if (typeof raw[0] === "object" && raw[0] !== null && "category" in raw[0]) {
              return (raw as Record<string, unknown>[]).map((cat) => ({
                category: String(cat.category ?? "Skills"),
                skills: (Array.isArray(cat.skills) ? cat.skills : []).map((s: unknown) => {
                  const sk = s as Record<string, unknown>;
                  return { name: String(sk.name ?? ""), level: Number(sk.level ?? 3) };
                }),
              }));
            }
            // Fallback: flat string array → single "Skills" category at level 3
            return [{ category: "Skills", skills: (raw as string[]).map((s) => ({ name: String(s), level: 3 })) }];
          })(),
          experience: arr(sections.experience).map((e: unknown) => {
            const exp = e as Record<string, unknown>;
            const bullets = Array.isArray(exp.bullets)
              ? (exp.bullets as string[]).join("\n")
              : String(exp.bullets ?? "");
            return {
              company: String(exp.company ?? ""),
              title: String(exp.title ?? ""),
              start_date: String(exp.start_date ?? ""),
              end_date: String(exp.end_date ?? ""),
              location: String(exp.location ?? ""),
              bullets,
            };
          }),
          education: arr(sections.education).map((e: unknown) => {
            const edu = e as Record<string, unknown>;
            return {
              institution: String(edu.institution ?? ""),
              degree: String(edu.degree ?? ""),
              field: String(edu.field ?? ""),
              start_date: String(edu.start_date ?? ""),
              end_date: String(edu.end_date ?? ""),
              gpa: String(edu.gpa ?? ""),
            };
          }),
          achievements: arr(sections.achievements).join("\n"),
          certifications: arr(sections.certifications).map((c: unknown) => {
            const cert = c as Record<string, unknown>;
            return {
              name: String(cert.name ?? ""),
              issuer: String(cert.issuer ?? ""),
              date: String(cert.date ?? ""),
            };
          }),
          projects: arr(sections.projects).map((p: unknown) => {
            const proj = p as Record<string, unknown>;
            const stack = Array.isArray(proj.tech_stack)
              ? (proj.tech_stack as string[]).join(", ")
              : String(proj.tech_stack ?? "");
            return {
              name: String(proj.name ?? ""),
              link: String(proj.link ?? ""),
              tech_stack: stack,
              description: String(proj.description ?? ""),
            };
          }),
        });
        setStep("form");
      },
    });
  };

  // ── build ──
  const handleBuild = () => {
    const payload = {
      form_data: {
        ...formData,
        experience: formData.experience.map((e) => ({
          ...e,
          bullets: e.bullets
            .split("\n")
            .map((b) => b.trim().replace(/^[-•*]\s*/, ""))
            .filter(Boolean),
        })),
        achievements: formData.achievements
          .split("\n")
          .map((a) => a.trim().replace(/^[-•*]\s*/, ""))
          .filter(Boolean),
      },
      template,
    };

    buildMutation.mutate(payload, {
      onSuccess: (version) => {
        setBuiltVersionId(version.id);
        setStep("done");
      },
    });
  };

  // ── set as master ──
  const handleSetMaster = () => {
    if (!builtVersionId) return;
    setCurrentMutation.mutate(builtVersionId, {
      onSuccess: () => setSetAsMasterDone(true),
    });
  };

  // ── form field helpers ──
  // Clear validation error for a tab whenever the user edits data in it
  const clearTabError = (tab: string) => {
    if (validationErrors[tab]) {
      setValidationErrors((prev) => {
        const next = { ...prev };
        delete next[tab];
        // Also clear the paired Experience/Projects error if both point to the same message
        if (tab === "Experience" || tab === "Projects") {
          delete next["Experience"];
          delete next["Projects"];
        }
        return next;
      });
    }
  };

  const setField = <K extends keyof ResumeFormData>(
    key: K,
    value: ResumeFormData[K]
  ) => {
    // Map form keys to the tab that owns them
    const keyTabMap: Partial<Record<keyof ResumeFormData, string>> = {
      full_name: "Profile", email: "Profile", phone: "Profile",
      location: "Profile", linkedin: "Profile", github: "Profile", website: "Profile",
      summary: "Summary",
    };
    const tab = keyTabMap[key];
    if (tab) clearTabError(tab);
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const updateExp = (
    idx: number,
    key: keyof ExperienceEntry,
    value: string
  ) => {
    if (key === "company" && value.trim()) clearTabError("Experience");
    setFormData((prev) => {
      const updated = [...prev.experience];
      updated[idx] = { ...updated[idx], [key]: value };
      return { ...prev, experience: updated };
    });
  };

  const updateEdu = (
    idx: number,
    key: keyof EducationEntry,
    value: string
  ) => {
    if (key === "institution" && value.trim()) clearTabError("Education");
    setFormData((prev) => {
      const updated = [...prev.education];
      updated[idx] = { ...updated[idx], [key]: value };
      return { ...prev, education: updated };
    });
  };

  const updateProject = (
    idx: number,
    key: keyof ProjectEntry,
    value: string
  ) => {
    if (key === "name" && value.trim()) clearTabError("Projects");
    setFormData((prev) => {
      const updated = [...prev.projects];
      updated[idx] = { ...updated[idx], [key]: value };
      return { ...prev, projects: updated };
    });
  };

  const updateCert = (
    idx: number,
    key: keyof CertificationEntry,
    value: string
  ) => {
    setFormData((prev) => {
      const updated = [...prev.certifications];
      updated[idx] = { ...updated[idx], [key]: value };
      return { ...prev, certifications: updated };
    });
  };

  // ── validation ────────────────────────────────────────────────────────────

  const validateForm = (): Record<string, string> => {
    const errors: Record<string, string> = {};

    if (!formData.full_name.trim()) {
      errors["Profile"] = "Full name is required";
    }

    if (!formData.summary.trim()) {
      errors["Summary"] = "Summary is required";
    }

    const hasValidEducation = formData.education.some((e) => e.institution.trim());
    if (!hasValidEducation) {
      errors["Education"] = "At least one education entry is required";
    }

    const hasValidSkills = formData.skills.some((cat) =>
      cat.skills.some((sk) => sk.name.trim())
    );
    if (!hasValidSkills) {
      errors["Skills"] = "At least one skill is required";
    }

    const hasExperience = formData.experience.some((e) => e.company.trim());
    const hasProjects = formData.projects.some((p) => p.name.trim());
    if (!hasExperience && !hasProjects) {
      errors["Experience"] = "Add at least one experience or project";
      errors["Projects"] = "Add at least one experience or project";
    }

    return errors;
  };

  const handleNextToTemplate = () => {
    const errors = validateForm();
    setValidationErrors(errors);
    if (Object.keys(errors).length === 0) setStep("template");
  };

  // ── render steps ──────────────────────────────────────────────────────────

  const renderChoose = () => (
    <div className="flex flex-col items-center gap-6 py-4">
      <p className="text-zinc-400 text-sm">How would you like to build your resume?</p>
      <div className="grid grid-cols-2 gap-4 w-full">
        {/* Upload path */}
        <button
          onClick={() => setStep("upload")}
          className="flex flex-col items-center gap-3 p-6 bg-zinc-900 border border-zinc-700 hover:border-indigo-500/60 rounded-2xl transition-colors group"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center group-hover:bg-indigo-500/20 transition-colors">
            <Upload size={22} className="text-indigo-400" />
          </div>
          <div className="text-center">
            <div className="text-sm font-bold text-zinc-200">Upload Resume</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">PDF or DOCX — we'll extract the content</div>
          </div>
        </button>

        {/* Manual path */}
        <button
          onClick={() => { setFormData(EMPTY_FORM); setStep("form"); }}
          className="flex flex-col items-center gap-3 p-6 bg-zinc-900 border border-zinc-700 hover:border-indigo-500/60 rounded-2xl transition-colors group"
        >
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center group-hover:bg-indigo-500/20 transition-colors">
            <FileText size={22} className="text-indigo-400" />
          </div>
          <div className="text-center">
            <div className="text-sm font-bold text-zinc-200">Fill Form</div>
            <div className="text-[11px] text-zinc-500 mt-0.5">Enter each section manually</div>
          </div>
        </button>
      </div>
    </div>
  );

  const renderUpload = () => (
    <div className="flex flex-col items-center gap-5 py-4">
      {extractMutation.isPending ? (
        <div className="flex flex-col items-center gap-3 py-8">
          <Loader2 size={32} className="animate-spin text-indigo-500" />
          <p className="text-zinc-400 text-sm">Extracting resume content…</p>
        </div>
      ) : (
        <>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="w-full border-2 border-dashed border-zinc-700 hover:border-indigo-500/60 rounded-2xl p-12 flex flex-col items-center gap-3 cursor-pointer transition-colors"
          >
            <Upload size={28} className="text-zinc-500" />
            <div className="text-center">
              <p className="text-sm font-semibold text-zinc-300">Click to upload</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">PDF or DOCX accepted</p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFileSelect(file);
            }}
          />
          {extractMutation.isError && (
            <p className="text-red-400 text-xs">
              Failed to extract. Please try again or use Fill Form.
            </p>
          )}
          <button
            onClick={() => setStep("choose")}
            className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors flex items-center gap-1"
          >
            <ChevronLeft size={12} /> Back
          </button>
        </>
      )}
    </div>
  );

  const renderForm = () => (
    <div className="flex flex-col gap-4 min-h-0">
      {/* Tab bar */}
      <div className="flex gap-1 flex-wrap">
        {FORM_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "relative px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors",
              activeTab === tab
                ? "bg-indigo-500 text-white"
                : validationErrors[tab]
                ? "bg-red-500/10 text-red-400 ring-1 ring-red-500/40"
                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
            )}
          >
            {tab}
            {validationErrors[tab] && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="overflow-y-auto max-h-[380px] pr-1 space-y-4">
        {activeTab === "Profile" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Full Name">
                <input className={inputCls} value={formData.full_name} onChange={(e) => setField("full_name", e.target.value)} placeholder="Jane Doe" />
              </Field>
              <Field label="Email">
                <input className={inputCls} value={formData.email} onChange={(e) => setField("email", e.target.value)} placeholder="jane@example.com" />
              </Field>
              <Field label="Phone">
                <input className={inputCls} value={formData.phone} onChange={(e) => setField("phone", e.target.value)} placeholder="+1 555 000 0000" />
              </Field>
              <Field label="Location">
                <input className={inputCls} value={formData.location} onChange={(e) => setField("location", e.target.value)} placeholder="San Francisco, CA" />
              </Field>
              <Field label="LinkedIn">
                <input className={inputCls} value={formData.linkedin} onChange={(e) => setField("linkedin", e.target.value)} placeholder="linkedin.com/in/janedoe" />
              </Field>
              <Field label="GitHub">
                <input className={inputCls} value={formData.github} onChange={(e) => setField("github", e.target.value)} placeholder="github.com/janedoe" />
              </Field>
            </div>
            <Field label="Website">
              <input className={inputCls} value={formData.website} onChange={(e) => setField("website", e.target.value)} placeholder="janedoe.dev" />
            </Field>
          </>
        )}

        {activeTab === "Summary" && (
          <Field label="Professional Summary">
            <textarea
              className={cn(textareaCls, "h-36")}
              value={formData.summary}
              onChange={(e) => setField("summary", e.target.value)}
              placeholder="A concise overview of your experience, skills, and career goals…"
            />
          </Field>
        )}

        {activeTab === "Skills" && (
          <div className="space-y-3">
            {formData.skills.map((cat, catIdx) => (
              <div key={catIdx} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                {/* Category header */}
                <div className="flex items-center gap-2">
                  <input
                    className={cn(inputCls, "flex-1 font-semibold")}
                    value={cat.category}
                    onChange={(e) => {
                      setFormData((prev) => {
                        const cats = [...prev.skills];
                        cats[catIdx] = { ...cats[catIdx], category: e.target.value };
                        return { ...prev, skills: cats };
                      });
                    }}
                    placeholder="Category name (e.g. Programming Languages)"
                  />
                  <button
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        skills: prev.skills.filter((_, i) => i !== catIdx),
                      }))
                    }
                    className="p-1.5 hover:text-red-400 text-zinc-600 transition-colors shrink-0"
                    title="Remove category"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* Skill rows */}
                <div className="space-y-2">
                  {cat.skills.map((sk, skIdx) => (
                    <div key={skIdx} className="flex items-center gap-2">
                      {/* Name */}
                      <input
                        className={cn(inputCls, "flex-1 min-w-0")}
                        value={sk.name}
                        onChange={(e) => {
                          if (e.target.value.trim()) clearTabError("Skills");
                          setFormData((prev) => {
                            const cats = [...prev.skills];
                            const skills = [...cats[catIdx].skills];
                            skills[skIdx] = { ...skills[skIdx], name: e.target.value };
                            cats[catIdx] = { ...cats[catIdx], skills };
                            return { ...prev, skills: cats };
                          });
                        }}
                        placeholder="Skill name"
                      />
                      {/* Proficiency dots */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        {[1, 2, 3, 4, 5].map((lvl) => (
                          <button
                            key={lvl}
                            type="button"
                            title={LEVEL_LABELS[lvl]}
                            onClick={() => {
                              setFormData((prev) => {
                                const cats = [...prev.skills];
                                const skills = [...cats[catIdx].skills];
                                skills[skIdx] = { ...skills[skIdx], level: lvl };
                                cats[catIdx] = { ...cats[catIdx], skills };
                                return { ...prev, skills: cats };
                              });
                            }}
                            className={cn(
                              "w-5 h-5 rounded-full border-2 transition-colors",
                              lvl <= sk.level
                                ? "bg-indigo-500 border-indigo-500"
                                : "bg-transparent border-zinc-600 hover:border-indigo-400"
                            )}
                          />
                        ))}
                      </div>
                      {/* Level label */}
                      <span className="text-[10px] text-zinc-500 w-20 shrink-0">
                        {LEVEL_LABELS[sk.level]}
                      </span>
                      {/* Remove skill */}
                      <button
                        onClick={() => {
                          setFormData((prev) => {
                            const cats = [...prev.skills];
                            const skills = cats[catIdx].skills.filter((_, i) => i !== skIdx);
                            cats[catIdx] = { ...cats[catIdx], skills };
                            return { ...prev, skills: cats };
                          });
                        }}
                        className="p-1 hover:text-red-400 text-zinc-600 transition-colors shrink-0"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Add skill */}
                <button
                  onClick={() => {
                    setFormData((prev) => {
                      const cats = [...prev.skills];
                      cats[catIdx] = {
                        ...cats[catIdx],
                        skills: [...cats[catIdx].skills, { ...EMPTY_SKILL }],
                      };
                      return { ...prev, skills: cats };
                    });
                  }}
                  className="flex items-center gap-1.5 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors font-semibold"
                >
                  <Plus size={12} /> Add Skill
                </button>
              </div>
            ))}

            {/* Add category */}
            <button
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  skills: [...prev.skills, { ...EMPTY_SKILL_CATEGORY, skills: [{ ...EMPTY_SKILL }] }],
                }))
              }
              className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold"
            >
              <Plus size={14} /> Add Category
            </button>
          </div>
        )}

        {activeTab === "Experience" && (
          <div className="space-y-5">
            {formData.experience.map((exp, idx) => (
              <div key={idx} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Experience #{idx + 1}
                  </span>
                  <button
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        experience: prev.experience.filter((_, i) => i !== idx),
                      }))
                    }
                    className="p-1 hover:text-red-400 text-zinc-600 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Company">
                    <input className={inputCls} value={exp.company} onChange={(e) => updateExp(idx, "company", e.target.value)} placeholder="Acme Corp" />
                  </Field>
                  <Field label="Title">
                    <input className={inputCls} value={exp.title} onChange={(e) => updateExp(idx, "title", e.target.value)} placeholder="Software Engineer" />
                  </Field>
                  <Field label="Start Date">
                    <MonthYearPicker
                      value={exp.start_date}
                      onChange={(v) => updateExp(idx, "start_date", v)}
                      placeholder="Start date"
                    />
                  </Field>
                  <Field label="End Date">
                    <MonthYearPicker
                      value={exp.end_date}
                      onChange={(v) => updateExp(idx, "end_date", v)}
                      placeholder="End date"
                      allowPresent
                    />
                  </Field>
                  <Field label="Location">
                    <input className={inputCls} value={exp.location} onChange={(e) => updateExp(idx, "location", e.target.value)} placeholder="Remote" />
                  </Field>
                </div>
                <Field label="Bullets (one per line)">
                  <textarea
                    className={cn(textareaCls, "h-24")}
                    value={exp.bullets}
                    onChange={(e) => updateExp(idx, "bullets", e.target.value)}
                    placeholder="Built scalable API handling 10M requests/day&#10;Led team of 4 engineers…"
                  />
                </Field>
              </div>
            ))}
            <button
              onClick={() => setFormData((prev) => ({ ...prev, experience: [...prev.experience, { ...EMPTY_EXP }] }))}
              className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold"
            >
              <Plus size={14} /> Add Experience
            </button>
          </div>
        )}

        {activeTab === "Education" && (
          <div className="space-y-5">
            {formData.education.map((edu, idx) => (
              <div key={idx} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Education #{idx + 1}
                  </span>
                  <button
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        education: prev.education.filter((_, i) => i !== idx),
                      }))
                    }
                    className="p-1 hover:text-red-400 text-zinc-600 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Institution">
                    <input className={inputCls} value={edu.institution} onChange={(e) => updateEdu(idx, "institution", e.target.value)} placeholder="MIT" />
                  </Field>
                  <Field label="Degree">
                    <input className={inputCls} value={edu.degree} onChange={(e) => updateEdu(idx, "degree", e.target.value)} placeholder="B.S." />
                  </Field>
                  <Field label="Field of Study">
                    <input className={inputCls} value={edu.field} onChange={(e) => updateEdu(idx, "field", e.target.value)} placeholder="Computer Science" />
                  </Field>
                  <Field label="GPA">
                    <input className={inputCls} value={edu.gpa} onChange={(e) => updateEdu(idx, "gpa", e.target.value)} placeholder="3.9" />
                  </Field>
                  <Field label="Start Date">
                    <MonthYearPicker
                      value={edu.start_date}
                      onChange={(v) => updateEdu(idx, "start_date", v)}
                      placeholder="Start date"
                    />
                  </Field>
                  <Field label="End Date">
                    <MonthYearPicker
                      value={edu.end_date}
                      onChange={(v) => updateEdu(idx, "end_date", v)}
                      placeholder="End date"
                      allowPresent
                    />
                  </Field>
                </div>
              </div>
            ))}
            <button
              onClick={() => setFormData((prev) => ({ ...prev, education: [...prev.education, { ...EMPTY_EDU }] }))}
              className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold"
            >
              <Plus size={14} /> Add Education
            </button>
          </div>
        )}

        {activeTab === "Achievements" && (
          <Field label="Achievements (one per line)">
            <textarea
              className={cn(textareaCls, "h-40")}
              value={formData.achievements}
              onChange={(e) => setField("achievements", e.target.value)}
              placeholder="Won company hackathon 2023&#10;Published paper on distributed systems…"
            />
          </Field>
        )}

        {activeTab === "Projects" && (
          <div className="space-y-5">
            {formData.projects.map((proj, idx) => (
              <div key={idx} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Project #{idx + 1}
                  </span>
                  <button
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        projects: prev.projects.filter((_, i) => i !== idx),
                      }))
                    }
                    className="p-1 hover:text-red-400 text-zinc-600 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Field label="Project Name">
                    <input
                      className={inputCls}
                      value={proj.name}
                      onChange={(e) => updateProject(idx, "name", e.target.value)}
                      placeholder="Job Search Assistant"
                    />
                  </Field>
                  <Field label="GitHub / Hosted Link">
                    <div className="relative">
                      <ExternalLink size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                      <input
                        className={cn(inputCls, "pl-8")}
                        value={proj.link}
                        onChange={(e) => updateProject(idx, "link", e.target.value)}
                        placeholder="github.com/user/repo"
                      />
                    </div>
                  </Field>
                </div>

                <Field label="Tech Stack (comma-separated)">
                  <input
                    className={inputCls}
                    value={proj.tech_stack}
                    onChange={(e) => updateProject(idx, "tech_stack", e.target.value)}
                    placeholder="Python, FastAPI, React, PostgreSQL, Docker"
                  />
                  {/* Live tag preview */}
                  {proj.tech_stack.trim() && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {proj.tech_stack.split(",").map((t) => t.trim()).filter(Boolean).map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[10px] font-semibold rounded-full"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </Field>

                <Field label="Description">
                  <textarea
                    className={cn(textareaCls, "h-20")}
                    value={proj.description}
                    onChange={(e) => updateProject(idx, "description", e.target.value)}
                    placeholder="Brief description of what the project does, your role, and key outcomes…"
                  />
                </Field>
              </div>
            ))}

            <button
              onClick={() => setFormData((prev) => ({ ...prev, projects: [...prev.projects, { ...EMPTY_PROJECT }] }))}
              className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold"
            >
              <Plus size={14} /> Add Project
            </button>
          </div>
        )}

        {activeTab === "Certifications" && (
          <div className="space-y-5">
            {formData.certifications.map((cert, idx) => (
              <div key={idx} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                    Cert #{idx + 1}
                  </span>
                  <button
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        certifications: prev.certifications.filter((_, i) => i !== idx),
                      }))
                    }
                    className="p-1 hover:text-red-400 text-zinc-600 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Name">
                    <input className={inputCls} value={cert.name} onChange={(e) => updateCert(idx, "name", e.target.value)} placeholder="AWS Solutions Architect" />
                  </Field>
                  <Field label="Issuer">
                    <input className={inputCls} value={cert.issuer} onChange={(e) => updateCert(idx, "issuer", e.target.value)} placeholder="Amazon" />
                  </Field>
                  <Field label="Date">
                    <MonthYearPicker
                      value={cert.date}
                      onChange={(v) => updateCert(idx, "date", v)}
                      placeholder="Issue date"
                    />
                  </Field>
                </div>
              </div>
            ))}
            <button
              onClick={() => setFormData((prev) => ({ ...prev, certifications: [...prev.certifications, { ...EMPTY_CERT }] }))}
              className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold"
            >
              <Plus size={14} /> Add Certification
            </button>
          </div>
        )}
      </div>

      {/* Validation errors summary */}
      {Object.keys(validationErrors).length > 0 && (
        <div className="flex flex-col gap-1.5 px-3 py-2.5 bg-red-500/8 border border-red-500/20 rounded-xl">
          {/* Deduplicate: Experience+Projects share one message */}
          {Array.from(
            new Set(Object.values(validationErrors))
          ).map((msg) => (
            <div key={msg} className="flex items-center gap-2 text-[11px] text-red-400">
              <AlertCircle size={12} className="shrink-0" />
              {msg}
            </div>
          ))}
        </div>
      )}

      {/* Nav */}
      <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
        <button
          onClick={() => setStep("choose")}
          className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors flex items-center gap-1"
        >
          <ChevronLeft size={12} /> Back
        </button>
        <button
          onClick={handleNextToTemplate}
          className="px-5 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
        >
          Choose Template <ChevronRight size={13} />
        </button>
      </div>
    </div>
  );

  const renderTemplate = () => (
    <div className="flex flex-col gap-5">
      <p className="text-zinc-400 text-sm">Select a resume template</p>
      <div className="grid grid-cols-2 gap-4">
        {/* Classic preview */}
        <button
          onClick={() => setTemplate("classic")}
          className={cn(
            "rounded-2xl border-2 p-4 text-left transition-colors space-y-3",
            template === "classic"
              ? "border-indigo-500 bg-indigo-500/5"
              : "border-zinc-700 bg-zinc-900 hover:border-zinc-600"
          )}
        >
          {/* Mini preview */}
          <div className="w-full bg-white rounded p-3 space-y-1.5 pointer-events-none select-none">
            <div className="h-3 bg-gray-800 w-2/3 mx-auto rounded" />
            <div className="h-1.5 bg-gray-300 w-1/2 mx-auto rounded" />
            <div className="mt-2 h-1 bg-gray-800 w-full rounded" style={{ borderBottom: "1px solid #000" }} />
            <div className="space-y-0.5 mt-1">
              <div className="h-1 bg-gray-400 w-3/4 rounded" />
              <div className="h-1 bg-gray-400 w-full rounded" />
              <div className="h-1 bg-gray-400 w-5/6 rounded" />
            </div>
            <div className="mt-1 h-1 bg-gray-800 w-full rounded" />
            <div className="space-y-0.5 mt-1">
              <div className="h-1 bg-gray-400 w-1/2 rounded" />
              <div className="h-1 bg-gray-400 w-2/3 rounded" />
            </div>
          </div>
          <div>
            <div className="text-sm font-bold text-zinc-200">Classic</div>
            <div className="text-[10px] text-zinc-500">Clean, traditional, ATS-friendly</div>
          </div>
          {template === "classic" && (
            <div className="flex items-center gap-1 text-indigo-400 text-[10px] font-bold">
              <CheckCircle2 size={12} /> Selected
            </div>
          )}
        </button>

        {/* Modern preview */}
        <button
          onClick={() => setTemplate("modern")}
          className={cn(
            "rounded-2xl border-2 p-4 text-left transition-colors space-y-3",
            template === "modern"
              ? "border-indigo-500 bg-indigo-500/5"
              : "border-zinc-700 bg-zinc-900 hover:border-zinc-600"
          )}
        >
          {/* Mini preview */}
          <div className="w-full bg-white rounded p-3 space-y-1.5 pointer-events-none select-none">
            <div className="h-3 bg-indigo-800 w-2/3 rounded" />
            <div className="h-1.5 bg-gray-300 w-1/2 rounded" />
            <div className="mt-2 flex items-center gap-1">
              <div className="w-1 h-4 bg-indigo-500 rounded" />
              <div className="h-1.5 bg-indigo-400 w-16 rounded" />
            </div>
            <div className="space-y-0.5 ml-2">
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 bg-indigo-400 rounded-full" />
                <div className="h-1 bg-gray-400 w-3/4 rounded" />
              </div>
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 bg-indigo-400 rounded-full" />
                <div className="h-1 bg-gray-400 w-2/3 rounded" />
              </div>
            </div>
            <div className="flex items-center gap-1 mt-1">
              <div className="w-1 h-4 bg-indigo-500 rounded" />
              <div className="h-1.5 bg-indigo-400 w-16 rounded" />
            </div>
            <div className="ml-2 space-y-0.5">
              <div className="h-1 bg-gray-400 w-1/2 rounded" />
              <div className="h-1 bg-gray-400 w-2/3 rounded" />
            </div>
          </div>
          <div>
            <div className="text-sm font-bold text-zinc-200">Modern</div>
            <div className="text-[10px] text-zinc-500">Indigo accents, contemporary style</div>
          </div>
          {template === "modern" && (
            <div className="flex items-center gap-1 text-indigo-400 text-[10px] font-bold">
              <CheckCircle2 size={12} /> Selected
            </div>
          )}
        </button>
      </div>

      <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
        <button
          onClick={() => setStep("form")}
          className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors flex items-center gap-1"
        >
          <ChevronLeft size={12} /> Back
        </button>
        <button
          onClick={handleBuild}
          disabled={buildMutation.isPending}
          className="px-5 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
        >
          {buildMutation.isPending ? (
            <><Loader2 size={13} className="animate-spin" /> Building…</>
          ) : (
            <>Build Resume <ChevronRight size={13} /></>
          )}
        </button>
      </div>
    </div>
  );

  const renderDone = () => (
    <div className="flex flex-col items-center gap-5 py-4 text-center">
      <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
        <CheckCircle2 size={28} className="text-emerald-400" />
      </div>
      <div>
        <div className="text-base font-bold text-zinc-100">Resume built successfully!</div>
        <div className="text-[11px] text-zinc-500 mt-1">
          The resume has been saved as a new version.
        </div>
      </div>

      {!setAsMasterDone ? (
        <>
          <p className="text-sm text-zinc-300">
            Would you like to set this as your master resume?
          </p>
          <div className="flex gap-3">
            <button
              onClick={handleSetMaster}
              disabled={setCurrentMutation.isPending}
              className="px-5 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-colors flex items-center gap-2"
            >
              {setCurrentMutation.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <CheckCircle2 size={13} />
              )}
              Yes, set as master
            </button>
            <button
              onClick={onClose}
              className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-bold transition-colors"
            >
              Not yet
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
            <CheckCircle2 size={16} /> Set as master resume!
          </div>
          <button
            onClick={onClose}
            className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-bold transition-colors"
          >
            Close
          </button>
        </>
      )}
    </div>
  );

  const STEP_TITLES: Record<Step, string> = {
    choose: "Build Resume",
    upload: "Upload Resume",
    form: "Fill in Details",
    template: "Choose Template",
    done: "Done",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl bg-[#1A1A1A] border border-zinc-800 rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <div>
            <h2 className="text-base font-bold text-zinc-100">{STEP_TITLES[step]}</h2>
            <div className="flex items-center gap-1.5 mt-1">
              {(["choose", "upload", "form", "template"] as Step[]).map((s, i) => (
                <div
                  key={s}
                  className={cn(
                    "h-1 rounded-full transition-all",
                    step === s || (step === "done" && i < 4)
                      ? "bg-indigo-500 w-5"
                      : "bg-zinc-700 w-3"
                  )}
                />
              ))}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === "choose" && renderChoose()}
          {step === "upload" && renderUpload()}
          {step === "form" && renderForm()}
          {step === "template" && renderTemplate()}
          {step === "done" && renderDone()}
        </div>
      </div>
    </div>
  );
}
