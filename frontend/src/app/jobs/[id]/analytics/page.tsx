"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  TrendingUp,
  TrendingDown,
  Target,
  Zap,
  Shield,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Sparkles,
  Search,
  Star,
  Clock,
  BookOpen,
  BarChart2,
  Activity,
  Award,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useJob } from "@/hooks/useJobs";

// ── helpers ─────────────────────────────────────────────────────────────────

const fmt = (v: number | null | undefined, decimals = 1) =>
  v == null ? "—" : Number(v).toFixed(decimals);

const delta = (v: number | null | undefined) => {
  if (v == null) return null;
  const n = Number(v);
  if (Math.abs(n) < 0.05) return null;
  return n;
};

const DeltaBadge = ({ value, unit = "pts" }: { value: number | null | undefined; unit?: string }) => {
  const d = delta(value);
  if (d === null) return <span className="text-[10px] text-zinc-600 font-bold">no change</span>;
  const pos = d > 0;
  return (
    <span className={cn("flex items-center gap-0.5 text-[11px] font-black", pos ? "text-emerald-400" : "text-red-400")}>
      {pos ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
      {pos ? "+" : ""}{fmt(d)} {unit}
    </span>
  );
};

const ScoreBar = ({ value, max = 100, color = "bg-indigo-500" }: { value: number; max?: number; color?: string }) => (
  <div className="h-2 bg-zinc-900 rounded-full overflow-hidden border border-zinc-800">
    <div
      className={cn("h-full rounded-full transition-all duration-700", color)}
      style={{ width: `${Math.min(100, (value / max) * 100)}%` }}
    />
  </div>
);

const BAND_META: Record<string, { color: string; bg: string; label: string }> = {
  likely_filtered:  { color: "text-red-400",    bg: "bg-red-500/10 border-red-500/30",    label: "Likely Filtered" },
  borderline:       { color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/30", label: "Borderline"      },
  likely_surfaced:  { color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/30", label: "Likely Surfaced" },
  strong_pass:      { color: "text-emerald-400",bg: "bg-emerald-500/10 border-emerald-500/30", label: "Strong Pass"  },
};

const IMPACT_META: Record<string, { dot: string; text: string }> = {
  high:   { dot: "bg-red-400",    text: "text-red-400"    },
  medium: { dot: "bg-amber-400",  text: "text-amber-400"  },
  low:    { dot: "bg-zinc-500",   text: "text-zinc-500"   },
};

const SectionHeader = ({ icon: Icon, title, subtitle }: { icon: React.ElementType; title: string; subtitle?: string }) => (
  <div className="flex items-center gap-3 mb-6">
    <div className="w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 shrink-0">
      <Icon size={16} />
    </div>
    <div>
      <h2 className="text-sm font-black tracking-tight text-zinc-100">{title}</h2>
      {subtitle && <p className="text-[10px] text-zinc-500 font-medium mt-0.5">{subtitle}</p>}
    </div>
  </div>
);

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-[#131315] border border-zinc-800 rounded-3xl p-6", className)}>
    {children}
  </div>
);

const CompareRow = ({
  label,
  before,
  after,
  unit = "",
  higherIsBetter = true,
}: {
  label: string;
  before: number | null | undefined;
  after: number | null | undefined;
  unit?: string;
  higherIsBetter?: boolean;
}) => {
  const d = (after ?? 0) - (before ?? 0);
  const improved = higherIsBetter ? d > 0.05 : d < -0.05;
  const worsened = higherIsBetter ? d < -0.05 : d > 0.05;
  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-zinc-800/60 last:border-0">
      <span className="text-[11px] text-zinc-400 font-medium flex-1">{label}</span>
      <span className="text-[11px] font-bold text-zinc-400 w-16 text-right tabular-nums">
        {fmt(before)}{unit}
      </span>
      <ChevronRight size={12} className="text-zinc-700 shrink-0" />
      <span
        className={cn(
          "text-[11px] font-black w-16 text-right tabular-nums",
          improved ? "text-emerald-400" : worsened ? "text-red-400" : "text-zinc-300"
        )}
      >
        {fmt(after)}{unit}
      </span>
    </div>
  );
};

// ── change card ──────────────────────────────────────────────────────────────

const ChangeCard = ({ card }: { card: any }) => {
  const [open, setOpen] = useState(false);
  const impact = (card.impactLabel || "").toLowerCase().includes("high")
    ? "high"
    : (card.impactLabel || "").toLowerCase().includes("medium")
    ? "medium"
    : "low";
  const m = IMPACT_META[impact] || IMPACT_META.low;

  return (
    <div className="border border-zinc-800 rounded-2xl overflow-hidden bg-zinc-900/30">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-zinc-800/30 transition-colors"
      >
        <span className="w-6 h-6 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 text-[10px] font-black flex items-center justify-center shrink-0">
          {card.changeNumber}
        </span>
        <p className="text-[11px] text-zinc-400 font-medium flex-1 line-clamp-1">{card.originalText}</p>
        <div className="flex items-center gap-3 shrink-0">
          {card.scoreImpactPts > 0 && (
            <span className="text-[10px] font-black text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
              +{fmt(card.scoreImpactPts)} pts
            </span>
          )}
          <span className={cn("text-[9px] font-black uppercase tracking-widest", m.text)}>
            {card.impactLabel}
          </span>
          <ChevronDown size={14} className={cn("text-zinc-600 transition-transform", open && "rotate-180")} />
        </div>
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4 border-t border-zinc-800 pt-4 animate-in fade-in slide-in-from-top-2">
          {/* Diff */}
          <div className="space-y-2">
            <div className="p-3 bg-red-500/8 border border-red-500/15 rounded-xl">
              <p className="text-[11px] font-mono text-red-400 leading-relaxed">
                <span className="opacity-40 mr-2">−</span>{card.originalText}
              </p>
            </div>
            <div className="p-3 bg-emerald-500/8 border border-emerald-500/15 rounded-xl">
              <p className="text-[11px] font-mono text-emerald-400 leading-relaxed">
                <span className="opacity-40 mr-2">+</span>{card.newText}
              </p>
            </div>
          </div>

          {/* Keywords injected */}
          {card.injectedKeywords?.length > 0 && (
            <div className="space-y-2">
              <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Keywords Injected</p>
              <div className="flex flex-wrap gap-2">
                {card.injectedKeywords.map((k: any) => (
                  <span
                    key={k.term}
                    className={cn(
                      "px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wide border",
                      k.isRequired
                        ? "bg-red-500/10 border-red-500/20 text-red-400"
                        : "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                    )}
                  >
                    {k.term}{k.gapClosed && " ✓"}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Gaps closed */}
          {(card.requiredGapsClosed?.length > 0 || card.preferredGapsClosed?.length > 0) && (
            <div className="flex flex-wrap gap-4 text-[10px]">
              {card.requiredGapsClosed?.length > 0 && (
                <span className="text-zinc-500">
                  Required gaps closed: <span className="text-emerald-400 font-black">{card.requiredGapsClosed.join(", ")}</span>
                </span>
              )}
              {card.preferredGapsClosed?.length > 0 && (
                <span className="text-zinc-500">
                  Preferred gaps closed: <span className="text-indigo-400 font-black">{card.preferredGapsClosed.join(", ")}</span>
                </span>
              )}
            </div>
          )}

          {/* LLM reason */}
          {card.llmReason && (
            <p className="text-[11px] text-zinc-500 italic leading-relaxed border-t border-zinc-800 pt-3">
              <Sparkles size={10} className="inline mr-1.5 text-indigo-400" />
              {card.llmReason}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

// ── action queue item ────────────────────────────────────────────────────────

const ActionItem = ({ action }: { action: any }) => {
  const priority = (action.priority || "low").toLowerCase();
  const colors: Record<string, string> = {
    high:   "bg-red-500/10 border-red-500/30 text-red-400",
    medium: "bg-amber-500/10 border-amber-500/30 text-amber-400",
    low:    "bg-zinc-800 border-zinc-700 text-zinc-400",
  };
  return (
    <div className="flex items-start gap-4 p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl hover:border-zinc-700 transition-colors">
      <div className="flex flex-col items-center gap-1 shrink-0">
        <span className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-500 text-[11px] font-black flex items-center justify-center">
          {action.rank}
        </span>
        <span className={cn("text-[8px] px-1.5 py-0.5 rounded-md font-black uppercase tracking-wider border", colors[priority])}>
          {priority}
        </span>
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <p className="text-xs font-bold text-zinc-200">{action.action}</p>
        <p className="text-[10px] text-zinc-500 leading-relaxed">{action.reason}</p>
        <div className="flex flex-wrap gap-3 pt-1 text-[9px] font-bold text-zinc-600">
          {action.sectionTarget && <span>Target: <span className="text-zinc-400">{action.sectionTarget}</span></span>}
          {action.scoreImpactEstimate && <span className="text-emerald-400">{action.scoreImpactEstimate}</span>}
          {action.jdFrequency > 0 && <span>JD Frequency: <span className="text-zinc-400">{action.jdFrequency}×</span></span>}
        </div>
      </div>
    </div>
  );
};

// ── keyword chip ─────────────────────────────────────────────────────────────

const KeywordChip = ({ term, impactLevel, isRequired, extra }: any) => {
  const m = IMPACT_META[impactLevel?.toLowerCase()] || IMPACT_META.low;
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-zinc-700 transition-colors">
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", m.dot)} />
      <span className="text-[11px] font-medium text-zinc-300 flex-1 min-w-0 truncate">{term}</span>
      <div className="flex items-center gap-1 shrink-0">
        {isRequired && (
          <span className="text-[8px] font-black uppercase text-red-400 bg-red-500/10 border border-red-500/20 px-1 py-0.5 rounded">req</span>
        )}
        {extra}
      </div>
    </div>
  );
};

// ── main page ────────────────────────────────────────────────────────────────

export default function JobAnalyticsDashboard() {
  const params = useParams();
  const router = useRouter();
  const { data: job, isLoading } = useJob(params.id as string);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0B0B0C]">
        <Loader2 className="animate-spin text-indigo-500" size={36} />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0B0B0C] text-zinc-500">
        <AlertCircle size={48} className="mb-4 opacity-20" />
        <p className="text-sm font-bold text-zinc-300">Job not found</p>
        <button onClick={() => router.back()} className="mt-4 text-indigo-400 text-xs font-bold hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const analytics = job.analytics as any;

  if (!analytics) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0B0B0C] text-zinc-500 gap-4">
        <BarChart2 size={48} className="opacity-20" />
        <div className="text-center">
          <p className="text-sm font-bold text-zinc-300">No analytics available</p>
          <p className="text-[11px] text-zinc-500 mt-1">Run the tailoring pipeline to generate analytics.</p>
        </div>
        <button onClick={() => router.back()} className="text-indigo-400 text-xs font-bold hover:underline">
          Go back
        </button>
      </div>
    );
  }

  const sd = analytics.scoreDelta || {};
  const km = analytics.keywordMovement || {};
  const pb = analytics.passBand || {};
  const cards = analytics.changeCards || [];
  const queue = analytics.actionQueue || [];
  const meta = analytics.meta || {};

  const bandBefore = BAND_META[pb.bandBefore] || BAND_META.borderline;
  const bandAfter = BAND_META[pb.bandAfter] || BAND_META.borderline;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0B0B0C]">
      {/* Header */}
      <header className="px-8 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#131315] shrink-0">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-500 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-base font-black tracking-tight text-zinc-100">Resume Analytics</h1>
            <p className="text-[10px] font-bold text-zinc-500 mt-0.5 uppercase tracking-widest">
              {job.job_title} · {job.company_name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {meta.generatedAt && (
            <span className="text-[9px] text-zinc-600 font-medium">
              Generated {new Date(meta.generatedAt).toLocaleString()}
            </span>
          )}
          <span className={cn(
            "text-[9px] font-black uppercase tracking-widest px-2.5 py-1 rounded-full border",
            bandAfter.bg, bandAfter.color
          )}>
            {bandAfter.label}
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-7xl mx-auto px-8 py-8 space-y-8">

          {/* ── SECTION 1: ATS Score Overview ── */}
          <section>
            <SectionHeader icon={Activity} title="ATS Score Overview" subtitle="Weighted keyword match score before and after tailoring" />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Before */}
              <Card className="relative overflow-hidden">
                <div className="absolute top-0 right-0 opacity-5"><Target size={100} /></div>
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-3">Before Tailoring</p>
                <p className="text-5xl font-black tracking-tighter text-zinc-300">
                  {fmt(sd.atsBefore)}<span className="text-2xl text-zinc-600">/100</span>
                </p>
                <div className="mt-4">
                  <ScoreBar value={sd.atsBefore ?? 0} color="bg-zinc-600" />
                </div>
                <p className={cn("mt-3 text-xs font-black", bandBefore.color)}>{bandBefore.label}</p>
              </Card>

              {/* After */}
              <Card className="relative overflow-hidden border-indigo-500/20 bg-indigo-500/5">
                <div className="absolute top-0 right-0 opacity-5 text-indigo-500"><Target size={100} /></div>
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-3">After Tailoring</p>
                <p className="text-5xl font-black tracking-tighter text-zinc-100">
                  {fmt(sd.atsAfter)}<span className="text-2xl text-zinc-500">/100</span>
                </p>
                <div className="mt-4">
                  <ScoreBar value={sd.atsAfter ?? 0} color="bg-indigo-500" />
                </div>
                <p className={cn("mt-3 text-xs font-black", bandAfter.color)}>{bandAfter.label}</p>
              </Card>

              {/* Improvement */}
              <Card>
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-3">Net Improvement</p>
                <div className="flex items-end gap-2">
                  <p className={cn(
                    "text-5xl font-black tracking-tighter",
                    (sd.atsImprovement ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"
                  )}>
                    {(sd.atsImprovement ?? 0) >= 0 ? "+" : ""}{fmt(sd.atsImprovement)}
                  </p>
                  <span className="text-zinc-500 text-sm font-bold mb-1">pts</span>
                </div>
                <div className="mt-5 space-y-2">
                  <CompareRow label="Required Coverage" before={sd.requiredCoverage?.before} after={sd.requiredCoverage?.after} unit="%" />
                  <CompareRow label="Preferred Coverage" before={sd.preferredCoverage?.before} after={sd.preferredCoverage?.after} unit="%" />
                  <CompareRow label="Placement Bonus" before={sd.placementScore?.before} after={sd.placementScore?.after} unit=" pts" />
                  <CompareRow label="Recency Bonus" before={sd.recencyScore?.before} after={sd.recencyScore?.after} unit=" pts" />
                </div>
              </Card>
            </div>
          </section>

          {/* ── SECTION 2: Score Components Deep Dive ── */}
          <section>
            <SectionHeader icon={BarChart2} title="Score Components" subtitle="Breakdown of all ATS scoring sub-systems" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Required Keywords */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Required Keywords</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Weighted ×0.55 in ATS formula</p>
                  </div>
                  <DeltaBadge value={sd.requiredCoverage?.delta} unit="%" />
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1.5">
                      <span>Before</span><span>{fmt(sd.requiredCoverage?.before)}%</span>
                    </div>
                    <ScoreBar value={sd.requiredCoverage?.before ?? 0} color="bg-zinc-600" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1.5">
                      <span>After</span><span>{fmt(sd.requiredCoverage?.after)}%</span>
                    </div>
                    <ScoreBar value={sd.requiredCoverage?.after ?? 0} color="bg-red-400" />
                  </div>
                </div>
              </Card>

              {/* Preferred Keywords */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Preferred Keywords</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Weighted ×0.25 in ATS formula</p>
                  </div>
                  <DeltaBadge value={sd.preferredCoverage?.delta} unit="%" />
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1.5">
                      <span>Before</span><span>{fmt(sd.preferredCoverage?.before)}%</span>
                    </div>
                    <ScoreBar value={sd.preferredCoverage?.before ?? 0} color="bg-zinc-600" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1.5">
                      <span>After</span><span>{fmt(sd.preferredCoverage?.after)}%</span>
                    </div>
                    <ScoreBar value={sd.preferredCoverage?.after ?? 0} color="bg-indigo-400" />
                  </div>
                </div>
              </Card>

              {/* Placement Score */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Section Placement</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Skills &gt; Experience &gt; Summary · max 12 pts</p>
                  </div>
                  <DeltaBadge value={sd.placementScore?.delta} />
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1.5">
                      <span>Before</span><span>{fmt(sd.placementScore?.before)} pts</span>
                    </div>
                    <ScoreBar value={sd.placementScore?.before ?? 0} max={12} color="bg-zinc-600" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1.5">
                      <span>After</span><span>{fmt(sd.placementScore?.after)} pts</span>
                    </div>
                    <ScoreBar value={sd.placementScore?.after ?? 0} max={12} color="bg-purple-400" />
                  </div>
                </div>
              </Card>

              {/* Recency Score */}
              <Card>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Recency Bonus</p>
                    <p className="text-[10px] text-zinc-500 mt-0.5">Recent job experience bonus · max 8 pts</p>
                  </div>
                  <DeltaBadge value={sd.recencyScore?.delta} />
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1.5">
                      <span>Before</span><span>{fmt(sd.recencyScore?.before)} pts</span>
                    </div>
                    <ScoreBar value={sd.recencyScore?.before ?? 0} max={8} color="bg-zinc-600" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-bold text-zinc-500 mb-1.5">
                      <span>After</span><span>{fmt(sd.recencyScore?.after)} pts</span>
                    </div>
                    <ScoreBar value={sd.recencyScore?.after ?? 0} max={8} color="bg-cyan-400" />
                  </div>
                </div>
              </Card>
            </div>
          </section>

          {/* ── SECTION 3: Pass Band + Knockout + YOE ── */}
          <section>
            <SectionHeader icon={Shield} title="Filter Status & Eligibility" subtitle="ATS pass-band, knockout checks, and experience requirements" />
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

              {/* Pass Band */}
              <Card className="lg:col-span-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-4">ATS Filter Band</p>
                <div className="space-y-3">
                  <div className={cn("flex items-center justify-between p-3 rounded-xl border", bandBefore.bg)}>
                    <span className="text-[10px] font-bold text-zinc-400">Before</span>
                    <span className={cn("text-xs font-black", bandBefore.color)}>{bandBefore.label}</span>
                  </div>
                  <div className="flex justify-center">
                    <ChevronDown size={16} className="text-zinc-700" />
                  </div>
                  <div className={cn("flex items-center justify-between p-3 rounded-xl border", bandAfter.bg)}>
                    <span className="text-[10px] font-bold text-zinc-400">After</span>
                    <span className={cn("text-xs font-black", bandAfter.color)}>{bandAfter.label}</span>
                  </div>
                  {pb.bandChanged && (
                    <div className="flex items-center gap-2 mt-2 pt-2 border-t border-zinc-800">
                      <CheckCircle2 size={12} className="text-emerald-400" />
                      <span className="text-[10px] text-emerald-400 font-bold">Band improved!</span>
                    </div>
                  )}
                </div>
                {pb.explanation && (
                  <p className="mt-4 text-[10px] text-zinc-500 leading-relaxed italic border-t border-zinc-800 pt-3">
                    {pb.explanation}
                  </p>
                )}
              </Card>

              {/* Strength Signals */}
              <Card className="lg:col-span-1">
                <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-4">Strength Signals</p>
                <div className="space-y-2.5">
                  {(pb.strengthSignals || []).length === 0 && (
                    <p className="text-[11px] text-zinc-600 italic">No signals available.</p>
                  )}
                  {(pb.strengthSignals || []).map((s: any, i: number) => (
                    <div key={i} className="flex items-start gap-3 p-2.5 bg-zinc-900/50 border border-zinc-800 rounded-xl">
                      {s.positive
                        ? <CheckCircle2 size={14} className="text-emerald-400 shrink-0 mt-0.5" />
                        : <AlertCircle size={14} className="text-amber-400 shrink-0 mt-0.5" />}
                      <div>
                        <p className="text-[11px] font-bold text-zinc-300">{s.signal}</p>
                        {s.detail && <p className="text-[10px] text-zinc-500 mt-0.5">{s.detail}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Knockout + YOE */}
              <Card className="lg:col-span-1 space-y-4">
                {/* Critical Gaps */}
                <div>
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-3">Critical Gaps</p>
                  <div className="flex items-center gap-4">
                    <div className="text-center">
                      <p className="text-3xl font-black text-red-400">{sd.criticalGaps?.before ?? "—"}</p>
                      <p className="text-[9px] text-zinc-600 mt-1">Before</p>
                    </div>
                    <ChevronRight size={16} className="text-zinc-700" />
                    <div className="text-center">
                      <p className={cn("text-3xl font-black", (sd.criticalGaps?.after ?? 0) < (sd.criticalGaps?.before ?? 0) ? "text-emerald-400" : "text-red-400")}>
                        {sd.criticalGaps?.after ?? "—"}
                      </p>
                      <p className="text-[9px] text-zinc-600 mt-1">After</p>
                    </div>
                    {(sd.criticalGaps?.reduced ?? 0) > 0 && (
                      <span className="text-[10px] text-emerald-400 font-black bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-lg ml-auto">
                        −{sd.criticalGaps.reduced} resolved
                      </span>
                    )}
                  </div>
                </div>

                <div className="border-t border-zinc-800 pt-4">
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-3">Knockout Checks</p>
                  <div className="flex items-center gap-3">
                    <div className={cn("flex items-center gap-2 px-3 py-2 rounded-xl border flex-1 justify-center",
                      sd.knockoutPassed?.before ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30")}>
                      {sd.knockoutPassed?.before ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-red-400" />}
                      <span className={cn("text-[10px] font-bold", sd.knockoutPassed?.before ? "text-emerald-400" : "text-red-400")}>Before</span>
                    </div>
                    <div className={cn("flex items-center gap-2 px-3 py-2 rounded-xl border flex-1 justify-center",
                      sd.knockoutPassed?.after ? "bg-emerald-500/10 border-emerald-500/30" : "bg-red-500/10 border-red-500/30")}>
                      {sd.knockoutPassed?.after ? <CheckCircle2 size={12} className="text-emerald-400" /> : <XCircle size={12} className="text-red-400" />}
                      <span className={cn("text-[10px] font-bold", sd.knockoutPassed?.after ? "text-emerald-400" : "text-red-400")}>After</span>
                    </div>
                  </div>
                </div>

                {sd.yoeStatus && (
                  <div className="border-t border-zinc-800 pt-4">
                    <p className="text-[9px] font-black uppercase tracking-widest text-zinc-600 mb-2">Experience</p>
                    <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                      <Clock size={12} className="text-zinc-600" />
                      <span>Candidate: <span className="font-bold text-zinc-200">{sd.yoeStatus.candidateYears} yrs</span></span>
                      {sd.yoeStatus.requiredYears != null && (
                        <>
                          <span className="text-zinc-700">·</span>
                          <span>Required: <span className="font-bold text-zinc-200">{sd.yoeStatus.requiredYears} yrs</span></span>
                        </>
                      )}
                    </div>
                    <p className={cn("mt-2 text-[10px] font-black capitalize",
                      sd.yoeStatus.after === "satisfied" ? "text-emerald-400" : sd.yoeStatus.after === "partial" ? "text-amber-400" : "text-red-400"
                    )}>
                      {sd.yoeStatus.after?.replace(/_/g, " ")}
                    </p>
                  </div>
                )}
              </Card>
            </div>
          </section>

          {/* ── SECTION 4: Keyword Movement ── */}
          <section>
            <SectionHeader
              icon={Search}
              title="Keyword Movement Map"
              subtitle={`${km.summary?.totalTerms ?? 0} total JD terms · ${fmt(km.summary?.coverageAfter, 0)}% covered after tailoring`}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-2xl p-4 text-center">
                  <p className="text-2xl font-black text-emerald-400">{km.summary?.requiredNewlyAdded ?? 0}</p>
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mt-1">Required Gaps Closed</p>
                </div>
                <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-4 text-center">
                  <p className="text-2xl font-black text-red-400">{km.summary?.requiredStillMissing ?? 0}</p>
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-500 mt-1">Required Still Missing</p>
                </div>
              </div>
              <div className="bg-[#131315] border border-zinc-800 rounded-2xl p-4 flex items-center gap-4">
                <div className="flex-1 space-y-1">
                  <div className="flex justify-between text-[10px] text-zinc-500 font-medium mb-1">
                    <span>Keyword Coverage</span>
                    <span className="font-black text-zinc-300">{fmt(km.summary?.coverageAfter, 0)}%</span>
                  </div>
                  <ScoreBar value={km.summary?.coverageAfter ?? 0} color="bg-indigo-500" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Newly Added */}
              <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-emerald-400" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
                    Newly Added ({(km.newlyAdded || []).length})
                  </p>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {(km.newlyAdded || []).length === 0
                    ? <p className="text-[11px] text-zinc-600 italic">None injected.</p>
                    : (km.newlyAdded || []).map((k: any) => (
                      <KeywordChip
                        key={k.term}
                        term={k.term}
                        impactLevel={k.impactLevel}
                        isRequired={k.isRequired}
                        extra={k.jdFrequency > 1 && (
                          <span className="text-[8px] text-zinc-600 font-bold">{k.jdFrequency}×</span>
                        )}
                      />
                    ))}
                </div>
              </div>

              {/* Already Present */}
              <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-indigo-400" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
                    Already Present ({(km.alreadyPresent || []).length})
                  </p>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {(km.alreadyPresent || []).length === 0
                    ? <p className="text-[11px] text-zinc-600 italic">None pre-matched.</p>
                    : (km.alreadyPresent || []).map((k: any) => (
                      <KeywordChip
                        key={k.term}
                        term={k.term}
                        impactLevel={k.impactLevel}
                        isRequired={k.isRequired}
                        extra={k.sectionFound && (
                          <span className="text-[8px] text-zinc-600 font-bold truncate max-w-[4rem]">{k.sectionFound}</span>
                        )}
                      />
                    ))}
                </div>
              </div>

              {/* Still Missing */}
              <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-2 h-2 rounded-full bg-red-400" />
                  <p className="text-[9px] font-black uppercase tracking-widest text-zinc-400">
                    Still Missing ({(km.stillMissing || []).length})
                  </p>
                </div>
                <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                  {(km.stillMissing || []).length === 0
                    ? <p className="text-[11px] text-zinc-600 italic">All keywords covered!</p>
                    : (km.stillMissing || []).map((k: any) => (
                      <KeywordChip
                        key={k.term}
                        term={k.term}
                        impactLevel={k.impactLevel}
                        isRequired={k.isRequired}
                        extra={k.jdFrequency > 1 && (
                          <span className="text-[8px] text-zinc-600 font-bold">{k.jdFrequency}×</span>
                        )}
                      />
                    ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── SECTION 5: Change Cards ── */}
          {cards.length > 0 && (
            <section>
              <SectionHeader
                icon={BookOpen}
                title="Change Justification Cards"
                subtitle={`${cards.length} accepted modification${cards.length !== 1 ? "s" : ""} with full audit trail`}
              />
              <div className="space-y-3">
                {cards.map((card: any) => (
                  <ChangeCard key={card.changeNumber} card={card} />
                ))}
              </div>
            </section>
          )}

          {/* ── SECTION 6: Action Queue ── */}
          {queue.length > 0 && (
            <section>
              <SectionHeader
                icon={ListChecks}
                title="Manual Action Queue"
                subtitle="Highest-impact things to add to your resume manually (ranked by ATS score impact)"
              />
              <div className="space-y-3">
                {queue.map((action: any) => (
                  <ActionItem key={action.rank} action={action} />
                ))}
              </div>
            </section>
          )}

          {/* ── SECTION 7: Summary ── */}
          <section>
            <Card className="flex flex-col md:flex-row items-start md:items-center gap-6">
              <div className="w-12 h-12 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center shrink-0">
                <Award size={24} className="text-indigo-400" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-black text-zinc-100">Tailoring Summary</h3>
                <p className="text-[11px] text-zinc-500 mt-1 leading-relaxed">
                  ATS score moved from <span className="font-black text-zinc-300">{fmt(sd.atsBefore)}</span> to{" "}
                  <span className="font-black text-zinc-100">{fmt(sd.atsAfter)}</span> ({" "}
                  <span className={cn("font-black", (sd.atsImprovement ?? 0) >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {(sd.atsImprovement ?? 0) >= 0 ? "+" : ""}{fmt(sd.atsImprovement)} pts
                  </span>
                  ).{" "}
                  {(sd.criticalGaps?.reduced ?? 0) > 0
                    ? `${sd.criticalGaps.reduced} critical gap${sd.criticalGaps.reduced !== 1 ? "s" : ""} were resolved. `
                    : ""}
                  {(km.summary?.requiredNewlyAdded ?? 0) > 0
                    ? `${km.summary.requiredNewlyAdded} required keyword${km.summary.requiredNewlyAdded !== 1 ? "s" : ""} injected. `
                    : ""}
                  {pb.bandChanged
                    ? `Filter band upgraded from "${bandBefore.label}" to "${bandAfter.label}".`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  onClick={() => router.push(`/tailor?jobId=${job.id}`)}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all border border-zinc-700"
                >
                  <Sparkles size={13} /> Re-run Tailoring
                </button>
              </div>
            </Card>
          </section>

        </div>
      </div>
    </div>
  );
}
