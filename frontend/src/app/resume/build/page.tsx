"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Upload,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  ExternalLink,
  AlertCircle,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useExtractResumeSections } from "@/hooks/useProfile";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ExperienceEntry {
  company: string; title: string;
  start_date: string; end_date: string;
  location: string; bullets: string;
}
interface EducationEntry {
  institution: string; degree: string; field: string;
  start_date: string; end_date: string; gpa: string;
}
interface CertificationEntry { name: string; issuer: string; date: string; }
interface ProjectEntry { name: string; link: string; tech_stack: string; description: string; }
interface SkillEntry { name: string; level: number; }
interface SkillCategory { category: string; skills: SkillEntry[]; }

interface ResumeFormData {
  full_name: string; email: string; phone: string;
  location: string; linkedin: string; github: string; website: string;
  summary: string;
  skills: SkillCategory[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  projects: ProjectEntry[];
  achievements: string;
  certifications: CertificationEntry[];
}

const LEVEL_LABELS = ["", "Beginner", "Elementary", "Intermediate", "Advanced", "Expert"];
const EMPTY_SKILL: SkillEntry = { name: "", level: 3 };
const EMPTY_SKILL_CAT: SkillCategory = { category: "", skills: [{ ...EMPTY_SKILL }] };
const EMPTY_EXP: ExperienceEntry = { company: "", title: "", start_date: "", end_date: "", location: "", bullets: "" };
const EMPTY_EDU: EducationEntry = { institution: "", degree: "", field: "", start_date: "", end_date: "", gpa: "" };
const EMPTY_CERT: CertificationEntry = { name: "", issuer: "", date: "" };
const EMPTY_PROJECT: ProjectEntry = { name: "", link: "", tech_stack: "", description: "" };

const EMPTY_FORM: ResumeFormData = {
  full_name: "", email: "", phone: "", location: "", linkedin: "", github: "", website: "",
  summary: "", skills: [], experience: [], education: [], projects: [], achievements: "", certifications: [],
};

// ── MonthYearPicker ───────────────────────────────────────────────────────────

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function parseMonthYear(val: string) {
  const [m, y] = val.trim().split(" ");
  const mIdx = MONTHS.indexOf(m);
  const yr = parseInt(y, 10);
  return mIdx !== -1 && !isNaN(yr) ? { month: mIdx, year: yr } : null;
}

function MonthYearPicker({ value, onChange, placeholder = "Select date", allowPresent = false }: {
  value: string; onChange: (v: string) => void; placeholder?: string; allowPresent?: boolean;
}) {
  const parsed = value && value !== "Present" ? parseMonthYear(value) : null;
  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(parsed?.year ?? new Date().getFullYear());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => { if (parsed) setViewYear(parsed.year); }, [value]); // eslint-disable-line

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(o => !o)}
        className={cn(inputCls, "flex items-center justify-between gap-2 text-left")}>
        <span className={value ? "text-zinc-200" : "text-zinc-600"}>{value || placeholder}</span>
        <CalendarDays size={13} className="text-zinc-500 shrink-0" />
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 w-52 bg-[#1A1A1A] border border-zinc-700 rounded-xl shadow-2xl p-3">
          <div className="flex items-center justify-between mb-2.5">
            <button type="button" onClick={() => setViewYear(y => y - 1)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"><ChevronLeft size={13} /></button>
            <span className="text-sm font-bold text-zinc-200">{viewYear}</span>
            <button type="button" onClick={() => setViewYear(y => y + 1)} className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-500 hover:text-zinc-200 transition-colors"><ChevronRight size={13} /></button>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {MONTHS.map((m, i) => (
              <button key={m} type="button"
                onClick={() => { onChange(`${MONTHS[i]} ${viewYear}`); setOpen(false); }}
                className={cn("py-1.5 rounded-lg text-[11px] font-semibold transition-colors",
                  parsed?.month === i && parsed?.year === viewYear ? "bg-indigo-500 text-white" : "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                )}>{m}</button>
            ))}
          </div>
          {allowPresent && (
            <button type="button" onClick={() => { onChange("Present"); setOpen(false); }}
              className={cn("mt-2 w-full py-1.5 rounded-lg text-[11px] font-bold transition-colors border",
                value === "Present" ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" : "hover:bg-zinc-800 text-zinc-500 border-zinc-700 hover:text-zinc-300"
              )}>Present</button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Shared field components ───────────────────────────────────────────────────

const inputCls = "w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors";
const textareaCls = cn(inputCls, "resize-none");

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">{label}</label>
      {children}
    </div>
  );
}

function SectionCard({ title, required, orNote, error, children }: {
  title: string; required?: boolean; orNote?: boolean; error?: string; children: React.ReactNode;
}) {
  return (
    <div className={cn("bg-[#1A1A1A] border rounded-2xl overflow-hidden transition-colors",
      error ? "border-red-500/30" : "border-zinc-800")}>
      <div className={cn("flex items-center justify-between px-5 py-3.5 border-b",
        error ? "border-red-500/20 bg-red-500/5" : "border-zinc-800/80")}>
        <div className="flex items-center gap-2.5">
          <h3 className="text-sm font-bold text-zinc-100">{title}</h3>
          {required && (
            <span className={cn("text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded",
              orNote ? "text-amber-400 bg-amber-500/10" : "text-zinc-500 bg-zinc-800")}>
              {orNote ? "required*" : "required"}
            </span>
          )}
        </div>
        {error && (
          <div className="flex items-center gap-1.5 text-red-400 text-[11px] font-semibold">
            <AlertCircle size={12} />{error}
          </div>
        )}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BuildResumePage() {
  const router = useRouter();
  const [formData, setFormData] = useState<ResumeFormData>(EMPTY_FORM);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [extractDone, setExtractDone] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractMutation = useExtractResumeSections();

  // ── helpers ──────────────────────────────────────────────────────────────

  const clearError = (tab: string) => {
    setValidationErrors(prev => {
      if (!prev[tab]) return prev;
      const next = { ...prev };
      delete next[tab];
      if (tab === "Experience" || tab === "Projects") { delete next["Experience"]; delete next["Projects"]; }
      return next;
    });
  };

  const setField = <K extends keyof ResumeFormData>(key: K, value: ResumeFormData[K]) => {
    const keyTab: Partial<Record<keyof ResumeFormData, string>> = {
      full_name: "Profile", email: "Profile", phone: "Profile",
      location: "Profile", linkedin: "Profile", github: "Profile", website: "Profile",
      summary: "Summary",
    };
    const t = keyTab[key]; if (t) clearError(t);
    setFormData(p => ({ ...p, [key]: value }));
  };

  const updExp = (i: number, k: keyof ExperienceEntry, v: string) => {
    if (k === "company" && v.trim()) clearError("Experience");
    setFormData(p => { const a = [...p.experience]; a[i] = { ...a[i], [k]: v }; return { ...p, experience: a }; });
  };
  const updEdu = (i: number, k: keyof EducationEntry, v: string) => {
    if (k === "institution" && v.trim()) clearError("Education");
    setFormData(p => { const a = [...p.education]; a[i] = { ...a[i], [k]: v }; return { ...p, education: a }; });
  };
  const updCert = (i: number, k: keyof CertificationEntry, v: string) =>
    setFormData(p => { const a = [...p.certifications]; a[i] = { ...a[i], [k]: v }; return { ...p, certifications: a }; });
  const updProj = (i: number, k: keyof ProjectEntry, v: string) => {
    if (k === "name" && v.trim()) clearError("Projects");
    setFormData(p => { const a = [...p.projects]; a[i] = { ...a[i], [k]: v }; return { ...p, projects: a }; });
  };

  // ── upload & extract ──────────────────────────────────────────────────────

  const handleFile = (file: File) => {
    setExtractDone(false);
    extractMutation.mutate(file, {
      onSuccess: (sections) => {
        const arr = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
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
            if (!Array.isArray(raw) || !raw.length) return [];
            if (typeof raw[0] === "object" && raw[0] !== null && "category" in (raw[0] as object))
              return (raw as Record<string,unknown>[]).map(c => ({
                category: String(c.category ?? "Skills"),
                skills: arr(c.skills).map((s) => {
                  const sk = s as Record<string,unknown>;
                  return { name: String(sk.name ?? ""), level: Number(sk.level ?? 3) };
                }),
              }));
            return [{ category: "Skills", skills: (raw as string[]).map(s => ({ name: String(s), level: 3 })) }];
          })(),
          experience: arr(sections.experience).map((e) => {
            const x = e as Record<string,unknown>;
            return { company: String(x.company ?? ""), title: String(x.title ?? ""),
              start_date: String(x.start_date ?? ""), end_date: String(x.end_date ?? ""),
              location: String(x.location ?? ""),
              bullets: Array.isArray(x.bullets) ? (x.bullets as string[]).join("\n") : String(x.bullets ?? "") };
          }),
          education: arr(sections.education).map((e) => {
            const x = e as Record<string,unknown>;
            return { institution: String(x.institution ?? ""), degree: String(x.degree ?? ""),
              field: String(x.field ?? ""), start_date: String(x.start_date ?? ""),
              end_date: String(x.end_date ?? ""), gpa: String(x.gpa ?? "") };
          }),
          projects: arr(sections.projects).map((p) => {
            const x = p as Record<string,unknown>;
            return { name: String(x.name ?? ""), link: String(x.link ?? ""),
              tech_stack: Array.isArray(x.tech_stack) ? (x.tech_stack as string[]).join(", ") : String(x.tech_stack ?? ""),
              description: String(x.description ?? "") };
          }),
          achievements: arr(sections.achievements).join("\n"),
          certifications: arr(sections.certifications).map((c) => {
            const x = c as Record<string,unknown>;
            return { name: String(x.name ?? ""), issuer: String(x.issuer ?? ""), date: String(x.date ?? "") };
          }),
        });
        setValidationErrors({});
        setExtractDone(true);
      },
    });
  };

  // ── validation ────────────────────────────────────────────────────────────

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!formData.full_name.trim()) e["Profile"] = "Full name is required";
    if (!formData.summary.trim()) e["Summary"] = "Summary is required";
    if (!formData.education.some(x => x.institution.trim())) e["Education"] = "At least one education entry is required";
    if (!formData.skills.some(c => c.skills.some(s => s.name.trim()))) e["Skills"] = "At least one skill is required";
    const hasExp = formData.experience.some(x => x.company.trim());
    const hasProj = formData.projects.some(x => x.name.trim());
    if (!hasExp && !hasProj) {
      e["Experience"] = "Add at least one experience or project";
      e["Projects"] = "Add at least one experience or project";
    }
    return e;
  };

  // ── choose template ───────────────────────────────────────────────────────

  const handleChooseTemplate = () => {
    const errors = validate();
    setValidationErrors(errors);
    if (Object.keys(errors).length > 0) return;
    sessionStorage.setItem("resume_form_data", JSON.stringify(formData));
    router.push("/resume/build/templates");
  };

  // ── footer state ──────────────────────────────────────────────────────────

  const errorList = Array.from(new Set(Object.values(validationErrors)));

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">

      {/* ── Header ── */}
      <header className="shrink-0 px-6 py-4 border-b border-zinc-800 bg-[#1A1A1A] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/resume")}
            className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-200 transition-colors">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-lg font-bold">Build Resume</h1>
            <p className="text-[11px] text-zinc-500">Fill in your details then choose a template</p>
          </div>
        </div>
        <button onClick={handleChooseTemplate}
          className="flex items-center gap-2 px-5 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-bold transition-colors">
          Choose Template
          <ChevronRight size={15} />
        </button>
      </header>

      {/* ── Scrollable body ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 pb-40 space-y-5">

          {/* ── Pre-fill from file ── */}
          <div className={cn("bg-[#1A1A1A] border border-zinc-800 rounded-2xl overflow-hidden",
            extractDone && "border-emerald-500/20")}>
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800/80">
              <div className="flex items-center gap-2.5">
                <h3 className="text-sm font-bold text-zinc-100">Pre-fill from Resume</h3>
                <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">optional</span>
              </div>
              {extractDone && (
                <button onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                  <RotateCcw size={11} /> Re-upload
                </button>
              )}
            </div>
            <div className="p-5">
              {extractMutation.isPending ? (
                <div className="flex items-center justify-center gap-3 py-8">
                  <Loader2 size={22} className="animate-spin text-indigo-500" />
                  <span className="text-sm text-zinc-400">Extracting content from your resume…</span>
                </div>
              ) : extractDone ? (
                <div className="flex items-center gap-2.5 text-emerald-400 text-sm font-semibold py-2">
                  <CheckCircle2 size={18} />
                  Content extracted — sections below are pre-filled. Edit anything you like.
                </div>
              ) : (
                <div onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-zinc-700 hover:border-indigo-500/50 rounded-xl p-8 flex flex-col items-center gap-2.5 cursor-pointer transition-colors group">
                  <Upload size={24} className="text-zinc-600 group-hover:text-indigo-400 transition-colors" />
                  <div className="text-center">
                    <p className="text-sm font-semibold text-zinc-300">Upload your existing resume to auto-fill</p>
                    <p className="text-[11px] text-zinc-600 mt-0.5">PDF or DOCX — LLM will extract the content</p>
                  </div>
                </div>
              )}
              {extractMutation.isError && (
                <p className="mt-2 text-xs text-red-400 flex items-center gap-1.5">
                  <AlertCircle size={12} /> Extraction failed. Fill the form manually below.
                </p>
              )}
              <input ref={fileInputRef} type="file" accept=".pdf,.docx" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
            </div>
          </div>

          {/* ── Profile ── */}
          <SectionCard title="Profile" required error={validationErrors["Profile"]}>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Full Name">
                <input className={inputCls} value={formData.full_name}
                  onChange={e => setField("full_name", e.target.value)} placeholder="Jane Doe" />
              </Field>
              <Field label="Email">
                <input className={inputCls} value={formData.email}
                  onChange={e => setField("email", e.target.value)} placeholder="jane@example.com" />
              </Field>
              <Field label="Phone">
                <input className={inputCls} value={formData.phone}
                  onChange={e => setField("phone", e.target.value)} placeholder="+1 555 000 0000" />
              </Field>
              <Field label="Location">
                <input className={inputCls} value={formData.location}
                  onChange={e => setField("location", e.target.value)} placeholder="San Francisco, CA" />
              </Field>
              <Field label="LinkedIn">
                <input className={inputCls} value={formData.linkedin}
                  onChange={e => setField("linkedin", e.target.value)} placeholder="linkedin.com/in/janedoe" />
              </Field>
              <Field label="GitHub">
                <input className={inputCls} value={formData.github}
                  onChange={e => setField("github", e.target.value)} placeholder="github.com/janedoe" />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Website">
                <input className={inputCls} value={formData.website}
                  onChange={e => setField("website", e.target.value)} placeholder="janedoe.dev" />
              </Field>
            </div>
          </SectionCard>

          {/* ── Summary ── */}
          <SectionCard title="Summary" required error={validationErrors["Summary"]}>
            <textarea className={cn(textareaCls, "h-28")} value={formData.summary}
              onChange={e => setField("summary", e.target.value)}
              placeholder="A concise overview of your experience, skills, and career goals…" />
          </SectionCard>

          {/* ── Skills ── */}
          <SectionCard title="Skills" required error={validationErrors["Skills"]}>
            <div className="space-y-4">
              {formData.skills.map((cat, ci) => (
                <div key={ci} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <input className={cn(inputCls, "flex-1 font-semibold")} value={cat.category}
                      onChange={e => {
                        setFormData(p => { const s = [...p.skills]; s[ci] = { ...s[ci], category: e.target.value }; return { ...p, skills: s }; });
                      }} placeholder="Category (e.g. Programming Languages)" />
                    <button onClick={() => setFormData(p => ({ ...p, skills: p.skills.filter((_, i) => i !== ci) }))}
                      className="p-1.5 hover:text-red-400 text-zinc-600 transition-colors shrink-0"><Trash2 size={14} /></button>
                  </div>
                  <div className="space-y-2">
                    {cat.skills.map((sk, si) => (
                      <div key={si} className="flex items-center gap-2">
                        <input className={cn(inputCls, "flex-1 min-w-0")} value={sk.name}
                          onChange={e => {
                            if (e.target.value.trim()) clearError("Skills");
                            setFormData(p => {
                              const cats = [...p.skills];
                              const skills = [...cats[ci].skills];
                              skills[si] = { ...skills[si], name: e.target.value };
                              cats[ci] = { ...cats[ci], skills };
                              return { ...p, skills: cats };
                            });
                          }} placeholder="Skill name" />
                        <div className="flex items-center gap-0.5 shrink-0">
                          {[1,2,3,4,5].map(lvl => (
                            <button key={lvl} type="button" title={LEVEL_LABELS[lvl]}
                              onClick={() => setFormData(p => {
                                const cats = [...p.skills];
                                const skills = [...cats[ci].skills];
                                skills[si] = { ...skills[si], level: lvl };
                                cats[ci] = { ...cats[ci], skills };
                                return { ...p, skills: cats };
                              })}
                              className={cn("w-5 h-5 rounded-full border-2 transition-colors",
                                lvl <= sk.level ? "bg-indigo-500 border-indigo-500" : "bg-transparent border-zinc-600 hover:border-indigo-400"
                              )} />
                          ))}
                        </div>
                        <span className="text-[10px] text-zinc-500 w-20 shrink-0">{LEVEL_LABELS[sk.level]}</span>
                        <button onClick={() => setFormData(p => {
                          const cats = [...p.skills];
                          cats[ci] = { ...cats[ci], skills: cats[ci].skills.filter((_, i) => i !== si) };
                          return { ...p, skills: cats };
                        })} className="p-1 hover:text-red-400 text-zinc-600 transition-colors shrink-0"><Trash2 size={12} /></button>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => setFormData(p => {
                    const cats = [...p.skills];
                    cats[ci] = { ...cats[ci], skills: [...cats[ci].skills, { ...EMPTY_SKILL }] };
                    return { ...p, skills: cats };
                  })} className="flex items-center gap-1.5 text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors font-semibold">
                    <Plus size={12} /> Add Skill
                  </button>
                </div>
              ))}
              <button onClick={() => setFormData(p => ({ ...p, skills: [...p.skills, { ...EMPTY_SKILL_CAT }] }))}
                className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold">
                <Plus size={14} /> Add Category
              </button>
            </div>
          </SectionCard>

          {/* ── Experience ── */}
          <SectionCard title="Experience" required orNote error={validationErrors["Experience"]}>
            {validationErrors["Experience"] === validationErrors["Projects"] && (
              <p className="text-[11px] text-amber-400 mb-3">At least one of <strong>Experience</strong> or <strong>Projects</strong> must be filled.</p>
            )}
            <div className="space-y-5">
              {formData.experience.map((exp, i) => (
                <div key={i} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Experience #{i+1}</span>
                    <button onClick={() => setFormData(p => ({ ...p, experience: p.experience.filter((_, x) => x !== i) }))}
                      className="p-1 hover:text-red-400 text-zinc-600 transition-colors"><Trash2 size={13} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Company"><input className={inputCls} value={exp.company} onChange={e => updExp(i,"company",e.target.value)} placeholder="Acme Corp" /></Field>
                    <Field label="Title"><input className={inputCls} value={exp.title} onChange={e => updExp(i,"title",e.target.value)} placeholder="Software Engineer" /></Field>
                    <Field label="Start Date"><MonthYearPicker value={exp.start_date} onChange={v => updExp(i,"start_date",v)} placeholder="Start date" /></Field>
                    <Field label="End Date"><MonthYearPicker value={exp.end_date} onChange={v => updExp(i,"end_date",v)} placeholder="End date" allowPresent /></Field>
                    <Field label="Location"><input className={inputCls} value={exp.location} onChange={e => updExp(i,"location",e.target.value)} placeholder="Remote" /></Field>
                  </div>
                  <Field label="Bullets (one per line)">
                    <textarea className={cn(textareaCls,"h-24")} value={exp.bullets} onChange={e => updExp(i,"bullets",e.target.value)}
                      placeholder={"Built scalable API handling 10M requests/day\nLed team of 4 engineers…"} />
                  </Field>
                </div>
              ))}
              <button onClick={() => setFormData(p => ({ ...p, experience: [...p.experience, { ...EMPTY_EXP }] }))}
                className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold">
                <Plus size={14} /> Add Experience
              </button>
            </div>
          </SectionCard>

          {/* ── Education ── */}
          <SectionCard title="Education" required error={validationErrors["Education"]}>
            <div className="space-y-5">
              {formData.education.map((edu, i) => (
                <div key={i} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Education #{i+1}</span>
                    <button onClick={() => setFormData(p => ({ ...p, education: p.education.filter((_, x) => x !== i) }))}
                      className="p-1 hover:text-red-400 text-zinc-600 transition-colors"><Trash2 size={13} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Institution"><input className={inputCls} value={edu.institution} onChange={e => updEdu(i,"institution",e.target.value)} placeholder="MIT" /></Field>
                    <Field label="Degree"><input className={inputCls} value={edu.degree} onChange={e => updEdu(i,"degree",e.target.value)} placeholder="B.S." /></Field>
                    <Field label="Field of Study"><input className={inputCls} value={edu.field} onChange={e => updEdu(i,"field",e.target.value)} placeholder="Computer Science" /></Field>
                    <Field label="GPA"><input className={inputCls} value={edu.gpa} onChange={e => updEdu(i,"gpa",e.target.value)} placeholder="3.9" /></Field>
                    <Field label="Start Date"><MonthYearPicker value={edu.start_date} onChange={v => updEdu(i,"start_date",v)} placeholder="Start date" /></Field>
                    <Field label="End Date"><MonthYearPicker value={edu.end_date} onChange={v => updEdu(i,"end_date",v)} placeholder="End date" allowPresent /></Field>
                  </div>
                </div>
              ))}
              <button onClick={() => setFormData(p => ({ ...p, education: [...p.education, { ...EMPTY_EDU }] }))}
                className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold">
                <Plus size={14} /> Add Education
              </button>
            </div>
          </SectionCard>

          {/* ── Projects ── */}
          <SectionCard title="Projects" required orNote error={validationErrors["Projects"]}>
            <div className="space-y-5">
              {formData.projects.map((proj, i) => (
                <div key={i} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Project #{i+1}</span>
                    <button onClick={() => setFormData(p => ({ ...p, projects: p.projects.filter((_, x) => x !== i) }))}
                      className="p-1 hover:text-red-400 text-zinc-600 transition-colors"><Trash2 size={13} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Project Name"><input className={inputCls} value={proj.name} onChange={e => updProj(i,"name",e.target.value)} placeholder="Job Search Assistant" /></Field>
                    <Field label="GitHub / Hosted Link">
                      <div className="relative">
                        <ExternalLink size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
                        <input className={cn(inputCls,"pl-8")} value={proj.link} onChange={e => updProj(i,"link",e.target.value)} placeholder="github.com/user/repo" />
                      </div>
                    </Field>
                  </div>
                  <Field label="Tech Stack (comma-separated)">
                    <input className={inputCls} value={proj.tech_stack} onChange={e => updProj(i,"tech_stack",e.target.value)} placeholder="Python, FastAPI, React, PostgreSQL" />
                    {proj.tech_stack.trim() && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {proj.tech_stack.split(",").map(t => t.trim()).filter(Boolean).map(tag => (
                          <span key={tag} className="px-2 py-0.5 bg-indigo-500/10 border border-indigo-500/20 text-indigo-300 text-[10px] font-semibold rounded-full">{tag}</span>
                        ))}
                      </div>
                    )}
                  </Field>
                  <Field label="Description">
                    <textarea className={cn(textareaCls,"h-20")} value={proj.description} onChange={e => updProj(i,"description",e.target.value)}
                      placeholder="What the project does, your role, and key outcomes…" />
                  </Field>
                </div>
              ))}
              <button onClick={() => setFormData(p => ({ ...p, projects: [...p.projects, { ...EMPTY_PROJECT }] }))}
                className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold">
                <Plus size={14} /> Add Project
              </button>
            </div>
          </SectionCard>

          {/* ── Achievements ── */}
          <SectionCard title="Achievements">
            <textarea className={cn(textareaCls,"h-28")} value={formData.achievements}
              onChange={e => setField("achievements", e.target.value)}
              placeholder={"Won company hackathon 2023\nPublished paper on distributed systems…"} />
          </SectionCard>

          {/* ── Certifications ── */}
          <SectionCard title="Certifications">
            <div className="space-y-4">
              {formData.certifications.map((cert, i) => (
                <div key={i} className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Cert #{i+1}</span>
                    <button onClick={() => setFormData(p => ({ ...p, certifications: p.certifications.filter((_, x) => x !== i) }))}
                      className="p-1 hover:text-red-400 text-zinc-600 transition-colors"><Trash2 size={13} /></button>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Name"><input className={inputCls} value={cert.name} onChange={e => updCert(i,"name",e.target.value)} placeholder="AWS Solutions Architect" /></Field>
                    <Field label="Issuer"><input className={inputCls} value={cert.issuer} onChange={e => updCert(i,"issuer",e.target.value)} placeholder="Amazon" /></Field>
                    <Field label="Date"><MonthYearPicker value={cert.date} onChange={v => updCert(i,"date",v)} placeholder="Issue date" /></Field>
                  </div>
                </div>
              ))}
              <button onClick={() => setFormData(p => ({ ...p, certifications: [...p.certifications, { ...EMPTY_CERT }] }))}
                className="flex items-center gap-2 text-xs text-indigo-400 hover:text-indigo-300 transition-colors font-semibold">
                <Plus size={14} /> Add Certification
              </button>
            </div>
          </SectionCard>

        </div>
      </div>

      {/* ── Sticky footer ── */}
      <footer className="shrink-0 border-t border-zinc-800 bg-[#1A1A1A] px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1 min-w-0">
            {errorList.length > 0 && errorList.map(msg => (
              <div key={msg} className="flex items-center gap-1.5 text-[11px] text-red-400">
                <AlertCircle size={11} className="shrink-0" />{msg}
              </div>
            ))}
          </div>
          <button onClick={handleChooseTemplate}
            className="shrink-0 flex items-center gap-2 px-6 py-2.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-bold transition-colors">
            Choose Template
            <ChevronRight size={15} />
          </button>
        </div>
      </footer>
    </div>
  );
}
