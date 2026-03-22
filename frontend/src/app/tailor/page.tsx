"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { 
  Sparkles, 
  Search, 
  Map, 
  Edit3, 
  FileText, 
  CheckCircle2, 
  Download, 
  Loader2,
  AlertCircle,
  Save,
  ChevronRight,
  ArrowLeft,
  XCircle,
  Zap,
  Shield,
  Layers,
  BarChart,
  BarChart2,
  TrendingUp,
  Target
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useJobs } from "@/hooks/useJobs";
import { useTailorResume, useSaveTailoredBullets } from "@/hooks/useTailor";
import Link from "next/link";
import { useRouter } from "next/navigation";

// ── UI primitives ────────────────────────────────────────────────────────────
const C = {
  accent: "#6366F1",
  green: "#34D399",
  amber: "#FBBF24",
  red: "#F87171",
  purple: "#A78BFA",
  cyan: "#22D3EE",
};

const StepItem = ({ icon: Icon, title, desc, status, isLast }: any) => (
  <div className="relative">
    {!isLast && (
      <div className={cn(
        "absolute left-[19px] top-10 w-[2px] h-12 transition-all duration-1000",
        status === "done" ? "bg-emerald-500/30" : "bg-zinc-800"
      )}>
        {status === "active" && (
          <div className="w-full h-full bg-indigo-500/50 animate-pulse origin-top scale-y-100" />
        )}
      </div>
    )}
    <div className={cn(
      "flex gap-4 p-4 border rounded-2xl transition-all duration-500 relative z-10",
      status === "done" ? "bg-emerald-500/5 border-emerald-500/20" : 
      status === "active" ? "bg-indigo-500/5 border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.1)]" : 
      "bg-zinc-900/30 border-zinc-800 opacity-40"
    )}>
      <div className={cn(
        "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border transition-all duration-500",
        status === "done" ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500 shadow-[0_0_10px_rgba(52,211,153,0.1)]" : 
        status === "active" ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-500 animate-pulse" : 
        "bg-zinc-800 border-zinc-700 text-zinc-500"
      )}>
        {status === "active" ? <Loader2 size={18} className="animate-spin" /> : <Icon size={18} />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className={cn("text-[10px] font-black uppercase tracking-[0.2em]", status === "done" ? "text-emerald-400" : status === "active" ? "text-indigo-400" : "text-zinc-500")}>
            {title}
          </h3>
          {status === "done" && <CheckCircle2 size={12} className="text-emerald-500" />}
        </div>
        <p className="text-[10px] text-zinc-500 mt-1 font-bold leading-relaxed">{desc}</p>
      </div>
    </div>
  </div>
);

const LogEntry = ({ entry }: any) => {
  const colors: any = { success: "text-emerald-400", error: "text-red-400", warn: "text-amber-400", dim: "text-zinc-600", info: "text-indigo-400" };
  const bgColors: any = { success: "bg-emerald-400", error: "bg-red-400", warn: "bg-amber-400", dim: "bg-zinc-600", info: "bg-indigo-400" };
  
  return (
    <div className="flex items-center gap-3 p-2 rounded-lg bg-zinc-900/50 border border-zinc-800/50 animate-in fade-in slide-in-from-left-2">
      <span className="text-[9px] font-mono text-zinc-600 shrink-0">{entry.t}</span>
      <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", bgColors[entry.type] || "bg-zinc-500")} />
      <span className={cn("text-[11px] font-medium", colors[entry.type] || "text-zinc-400")}>{entry.msg}</span>
      {entry.badge && (
        <span className={cn("text-[9px] px-1.5 py-0.5 rounded-md font-bold border shrink-0", colors[entry.type], `border-${entry.type}-400/20`, `bg-${entry.type}-400/10`)}>
          {entry.badge}
        </span>
      )}
    </div>
  );
};

function DiffCard({ change, accepted, onToggle, blockType, violationIssues }: any) {
  const [open, setOpen] = useState(false);
  const isViolation = violationIssues && violationIssues.length > 0;
  
  return (
    <div className={cn(
      "border rounded-2xl overflow-hidden transition-all duration-200",
      isViolation ? "border-red-500/30 bg-red-500/5" : accepted ? "border-indigo-500/30 bg-indigo-500/5" : "border-zinc-800 bg-zinc-900/40"
    )}>
      {isViolation && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 flex items-center gap-2">
          <AlertCircle size={12} className="text-red-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-red-400">Rejected by Validator</span>
          <span className="text-[10px] text-red-400/60 ml-auto">{violationIssues[0]}</span>
        </div>
      )}
      
      <div className="p-5 space-y-4">
        <div className="space-y-2">
          <div className="p-3 bg-red-500/10 border border-red-500/10 rounded-xl">
            <p className="text-[11.5px] font-mono text-red-400 leading-relaxed"><span className="opacity-50 mr-2">−</span>{change.old || change.originalText}</p>
          </div>
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/10 rounded-xl">
            <p className="text-[11.5px] font-mono text-emerald-400 leading-relaxed"><span className="opacity-50 mr-2">+</span>{change.new || change.newText}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-wrap gap-2 flex-1">
            {change.keywordsAdded?.map((k: string) => (
              <span key={k} className="px-2 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-[9px] font-black uppercase tracking-wider">
                {k}
              </span>
            ))}
          </div>
          
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest bg-zinc-800 px-2 py-1 rounded-md border border-zinc-700">
              {blockType}
            </span>
            <button 
              onClick={() => setOpen(!open)}
              className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-500 transition-colors"
            >
              <Zap size={14} className={open ? "text-amber-400" : ""} />
            </button>
            {!isViolation && (
              <button 
                onClick={onToggle}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                  accepted ? "bg-emerald-500 text-white shadow-lg shadow-emerald-500/20" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                )}
              >
                {accepted ? "Accepted" : "Accept"}
              </button>
            )}
          </div>
        </div>

        {open && (
          <div className="pt-4 border-t border-zinc-800 animate-in fade-in slide-in-from-top-2">
            <p className="text-[11px] text-zinc-500 italic leading-relaxed">
              <Sparkles size={10} className="inline mr-2 text-indigo-400" />
              {change.reason || "Keyword alignment with job description"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

const AnalyticsSummary = ({ job }: { job: any }) => {
  const isErrorReason = (r?: string | null) => !!r?.startsWith("Error");
  const tailoredReason = isErrorReason(job.tailored_match_reason) ? null : job.tailored_match_reason;

  // Use ATS before/after from analytics report for the comparison (deterministic keyword scoring).
  // Fall back to match_score / tailored_match_score if analytics is not available.
  const scoreDelta = job.analytics?.scoreDelta;
  const atsBefore = scoreDelta?.atsBefore != null ? Math.round(scoreDelta.atsBefore) : job.match_score ?? 0;
  const atsAfter = scoreDelta?.atsAfter != null ? Math.round(scoreDelta.atsAfter) : job.tailored_match_score ?? atsBefore;
  const scoreDiff = atsAfter - atsBefore;
  const numChanges = job.tailored_bullets?.length || 0;
  
  // Calculate unique keywords added
  const allKeywordsAdded = new Set();
  job.tailored_bullets?.forEach((b: any) => {
    b.keywordsAdded?.forEach((k: string) => allKeywordsAdded.add(k.toLowerCase()));
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
      {/* Match Score Comparison */}
      <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-6 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
          <Target size={80} className="text-indigo-500" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
              <TrendingUp size={16} />
            </div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Alignment Score</h3>
          </div>
          
          <div className="flex items-end gap-3">
            <span className="text-4xl font-black text-zinc-100 tracking-tighter">
              {atsAfter}%
            </span>
            {scoreDiff > 0 && (
              <span className="text-emerald-400 text-xs font-black mb-1 flex items-center">
                <ChevronRight size={12} className="-rotate-90" />
                +{scoreDiff}%
              </span>
            )}
          </div>

          <div className="mt-4 pt-4 border-t border-zinc-800/50">
            <div className="flex justify-between text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-2">
              <span>Original: {atsBefore}%</span>
              <span>Tailored: {atsAfter}%</span>
            </div>
            <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden flex">
              <div className="h-full bg-zinc-700" style={{ width: `${atsBefore}%` }} />
              <div className="h-full bg-indigo-500" style={{ width: `${Math.max(0, scoreDiff)}%` }} />
            </div>
          </div>
        </div>
      </div>

      {/* Optimization Metrics */}
      <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-6 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
          <Zap size={80} className="text-amber-500" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <BarChart size={16} />
            </div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Keyword Impact</h3>
          </div>
          
          <div className="flex items-end gap-3">
            <span className="text-4xl font-black text-zinc-100 tracking-tighter">
              {allKeywordsAdded.size}
            </span>
            <span className="text-zinc-500 text-[10px] font-bold mb-1 uppercase tracking-widest">Keywords Injected</span>
          </div>
          
          <div className="mt-4 flex flex-wrap gap-1.5">
            {Array.from(allKeywordsAdded).slice(0, 6).map((k: any) => (
              <span key={k} className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 text-[8px] font-bold uppercase">
                {k}
              </span>
            ))}
            {allKeywordsAdded.size > 6 && (
              <span className="text-[8px] font-bold text-zinc-600 self-center">+{allKeywordsAdded.size - 6} more</span>
            )}
          </div>
        </div>
      </div>

      {/* Modification Summary */}
      <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-6 relative overflow-hidden group">
        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
          <Edit3 size={80} className="text-emerald-500" />
        </div>
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle2 size={16} />
            </div>
            <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Rewrite Summary</h3>
          </div>
          
          <div className="flex items-end gap-3">
            <span className="text-4xl font-black text-zinc-100 tracking-tighter">
              {numChanges}
            </span>
            <span className="text-zinc-500 text-[10px] font-bold mb-1 uppercase tracking-widest">Blocks Tailored</span>
          </div>
          
          <p className="mt-4 text-[11px] text-zinc-500 leading-relaxed italic">
            "{tailoredReason || job.match_reason}"
          </p>
        </div>
      </div>
    </div>
  );
};

// ── Tailoring Job List ────────────────────────────────────────────────────────
function TailoringList() {
  const router = useRouter();
  const { data: jobs = [], isLoading } = useJobs();

  const tailoringJobs = jobs
    .filter(j => j.status === "Tailoring" || j.status === "Tailored")
    .sort((a, b) => {
      // In-progress first, then by date desc
      if (a.status === "Tailoring" && b.status !== "Tailoring") return -1;
      if (b.status === "Tailoring" && a.status !== "Tailoring") return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0B0B0C]">
      <header className="px-8 py-4 border-b border-zinc-800 bg-[#131315] flex items-center gap-4">
        <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
          <Sparkles size={18} />
        </div>
        <div>
          <h1 className="text-lg font-black tracking-tight text-zinc-100">Tailoring Pipeline</h1>
          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">All tailoring sessions</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-3xl mx-auto space-y-3">
          {isLoading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={24} className="animate-spin text-zinc-600" />
            </div>
          )}

          {!isLoading && tailoringJobs.length === 0 && (
            <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-20 flex flex-col items-center justify-center text-center">
              <Sparkles size={48} className="mb-6 text-zinc-700" />
              <p className="text-xs font-black uppercase tracking-[0.3em] text-zinc-500">No tailoring sessions yet</p>
              <p className="text-[11px] text-zinc-600 mt-2">Open a job and click "Tailor Resume" to start.</p>
            </div>
          )}

          {tailoringJobs.map(job => {
            const isTailoring = job.status === "Tailoring";
            const scoreDelta = job.analytics?.scoreDelta;
            const atsBefore = scoreDelta?.atsBefore != null ? Math.round(scoreDelta.atsBefore) : job.match_score ?? null;
            const atsAfter  = scoreDelta?.atsAfter  != null ? Math.round(scoreDelta.atsAfter)  : job.tailored_match_score ?? null;
            const diff = atsBefore != null && atsAfter != null ? atsAfter - atsBefore : null;

            return (
              <button
                key={job.id}
                onClick={() => router.push(`/tailor?jobId=${job.id}`)}
                className="w-full text-left bg-[#131315] border border-zinc-800 hover:border-indigo-500/40 hover:bg-indigo-500/5 rounded-2xl p-5 transition-all duration-200 group flex items-center gap-5"
              >
                {/* Status indicator */}
                <div className={cn(
                  "w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border",
                  isTailoring
                    ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
                    : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                )}>
                  {isTailoring
                    ? <Loader2 size={16} className="animate-spin" />
                    : <CheckCircle2 size={16} />}
                </div>

                {/* Job info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn(
                      "text-[9px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full border",
                      isTailoring
                        ? "bg-indigo-500/10 border-indigo-500/20 text-indigo-400"
                        : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    )}>
                      {isTailoring ? "In Progress" : "Tailored"}
                    </span>
                    <span className="text-[9px] text-zinc-600 font-mono">
                      {new Date(job.created_at).toLocaleDateString("en", { month: "short", day: "numeric" })}
                    </span>
                  </div>

                  <p className="text-sm font-black text-zinc-100 truncate group-hover:text-indigo-300 transition-colors">
                    {job.job_title}
                  </p>
                  <p className="text-[11px] text-zinc-500 truncate mt-0.5">{job.company_name}</p>

                  {isTailoring && job.sub_status && (
                    <p className="text-[10px] text-indigo-400/70 font-medium mt-1.5 truncate">
                      {job.sub_status}
                    </p>
                  )}
                </div>

                {/* Score */}
                {!isTailoring && atsBefore != null && atsAfter != null && (
                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-1.5 justify-end">
                      <span className="text-[11px] text-zinc-600 font-bold">{atsBefore}%</span>
                      <ChevronRight size={10} className="text-zinc-700" />
                      <span className="text-sm font-black text-zinc-100">{atsAfter}%</span>
                    </div>
                    {diff !== null && diff > 0 && (
                      <span className="text-[10px] font-black text-emerald-400">+{diff}%</span>
                    )}
                  </div>
                )}

                <ChevronRight size={16} className="text-zinc-700 group-hover:text-indigo-400 transition-colors shrink-0" />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TailoringPipelineView({ jobId }: { jobId: string }) {
  const router = useRouter();
  const queryJobId = jobId;

  const { data: jobs = [] } = useJobs();
  const [selectedJobId, setSelectedJobId] = useState<number | null>(parseInt(jobId));
  const [results, setResults] = useState<any>(null);
  const [editableBullets, setEditableBullets] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [emphasize, setEmphasize] = useState(true);

  const addLog = useCallback((msg: string, type = "info", badge?: string) => {
    const t = new Date().toLocaleTimeString("en", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLogs(p => {
      // Avoid duplicate consecutive logs for the same sub-status
      if (p.length > 0 && p[p.length - 1].msg === msg) return p;
      return [...p, { msg, type, badge, t }];
    });
  }, []);

  const tailorMutation = useTailorResume({
    onSuccess: () => {
      // Clear previous results when a new run starts
      setResults(null);
      setEditableBullets([]);
      setAccepted({});
      setLogs([]);
      addLog("Tailoring request accepted", "success");
    }
  });

  // 1. Trigger Tailoring
  useEffect(() => {
    if (queryJobId) {
      const id = parseInt(queryJobId);
      setSelectedJobId(id);
      
      const job = jobs.find(j => j.id === id);
      // Auto-trigger if job is still Pending, no error is present, and we haven't started a session yet
      if (job && job.status === "Pending" && !job.sub_status?.startsWith("Error:") && !tailorMutation.isPending && !results && !logs.length) {
        setLogs([]);
        addLog("System 1 — Initializing Pipeline...", "info");
        tailorMutation.mutate(id);
      }
    }
  }, [queryJobId, jobs, results, tailorMutation.isPending, logs.length, addLog, tailorMutation.mutate]);

  // 2. Poll Status & Results
  const currentJob = jobs.find(j => j.id === selectedJobId);
  
  // Update local logs when backend logs change
  useEffect(() => {
    if (currentJob?.logs && currentJob.logs.length > 0) {
      setLogs(currentJob.logs);
    }
  }, [currentJob?.logs]);
  
  useEffect(() => {
    // Once status is Tailored, populate the review results
    // CRITICAL: Only populate if we are NOT currently tailoring a new session
    if (currentJob?.status === "Tailored" && !tailorMutation.isPending && !results) {
      const bullets = currentJob.tailored_bullets || [];
      setResults({
        bullets,
        doc_path: currentJob.tailored_resume_path
      });
      setEditableBullets(bullets);

      // Auto-accept all suggestions initially
      const initAcc: Record<string, boolean> = {};
      bullets.forEach((_: any, i: number) => {
        initAcc[i] = true;
      });
      setAccepted(initAcc);
      addLog("Pipeline complete", "success");
    } else if ((tailorMutation.isPending || currentJob?.status === "Tailoring") && results) {
      // Clear results if a new tailoring run is detected
      setResults(null);
      setEditableBullets([]);
    }
  }, [currentJob, results, addLog, tailorMutation.isPending]);

  const downloadFilename = results?.doc_path?.split('/').pop() || currentJob?.tailored_resume_path?.split('/').pop();

  const handleExport = () => {
    if (downloadFilename) {
      window.open(`http://localhost:8000/download/${downloadFilename}`, '_blank');
    }
  };

  const acceptedCount = Object.values(accepted).filter(Boolean).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0B0B0C]">
      <header className="px-8 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#131315]">
        <div className="flex items-center gap-4">
          <Link href="/tailor" className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-500 transition-colors">
            <ArrowLeft size={20} />
          </Link>
          <div>
            <h1 className="text-lg font-black tracking-tight text-zinc-100">Tailoring Pipeline</h1>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">7-System Agent Architecture</p>
          </div>
        </div>
        {(results || currentJob?.status === "Tailored") && !tailorMutation.isPending && (
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                if (selectedJobId) {
                  // Explicit reset before re-run
                  setResults(null);
                  setEditableBullets([]);
                  setAccepted({});
                  setLogs([]);
                  tailorMutation.mutate(selectedJobId);
                }
              }}
              disabled={tailorMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all border border-zinc-700 active:scale-95"
            >
              {tailorMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
              Re-run AI
            </button>
            <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest bg-amber-400/10 px-3 py-1.5 rounded-full border border-amber-400/20">
              {acceptedCount} Changes Accepted
            </span>
            {currentJob?.analytics && (
              <button
                onClick={() => router.push(`/jobs/${selectedJobId}/analytics`)}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all border border-zinc-700 active:scale-95"
              >
                <BarChart2 size={14} />
                Detailed Analytics
              </button>
            )}
            <button
              onClick={handleExport}
              className="flex items-center gap-2 px-5 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
            >
              <Download size={14} />
              Export .docx
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Side Pipeline & Logs */}
          <div className="lg:col-span-4 space-y-6">
            {/* Status Steps */}
            <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-6 space-y-6">
              <div className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] px-1">Pipeline Status</div>
              <div className="space-y-4">
                <StepItem 
                  icon={Layers} 
                  title="Document Parsing" 
                  desc="System 1 — XML Node Extraction."
                  status={currentJob?.status === "Tailored" ? "done" : currentJob?.sub_status?.includes("System 1") ? "active" : currentJob?.status === "Tailoring" ? "done" : "pending"}
                />
                <StepItem 
                  icon={Search} 
                  title="Keyword Gap" 
                  desc="System 2 — Mapping JD requirements."
                  status={currentJob?.status === "Tailored" ? "done" : currentJob?.sub_status?.includes("System 2") ? "active" : (currentJob?.status === "Tailoring" && logs.some(l => l.msg.includes("System 3"))) ? "done" : "pending"}
                />
                <StepItem 
                  icon={Map} 
                  title="Tailor Strategy" 
                  desc="System 3 — Prioritizing keywords."
                  status={currentJob?.status === "Tailored" ? "done" : currentJob?.sub_status?.includes("System 3") ? "active" : (currentJob?.status === "Tailoring" && logs.some(l => l.msg.includes("System 4"))) ? "done" : "pending"}
                />
                <StepItem 
                  icon={Edit3} 
                  title="AI Rewriting" 
                  desc="System 4 — Gemini keyword injection."
                  status={currentJob?.status === "Tailored" ? "done" : currentJob?.sub_status?.includes("System 4") ? "active" : (currentJob?.status === "Tailoring" && logs.some(l => l.msg.includes("System 5"))) ? "done" : "pending"}
                />
                <StepItem 
                  icon={Shield} 
                  title="Validator" 
                  desc="System 5 — Fabrication & rule checking."
                  status={currentJob?.status === "Tailored" ? "done" : currentJob?.sub_status?.includes("System 5") ? "active" : (currentJob?.status === "Tailoring" && logs.some(l => l.msg.includes("System 6"))) ? "done" : "pending"}
                />
                <StepItem 
                  icon={Zap} 
                  title="Style Refiner" 
                  desc="System 6 — Tone consistency check."
                  status={currentJob?.status === "Tailored" ? "done" : currentJob?.sub_status?.includes("System 6") ? "active" : (currentJob?.status === "Tailoring" && logs.some(l => l.msg.includes("System 7"))) ? "done" : "pending"}
                />
                <StepItem 
                  icon={Download} 
                  title="Exporter" 
                  desc="System 7 — XML-preserved generation."
                  status={currentJob?.status === "Tailored" ? "done" : currentJob?.sub_status?.includes("System 7") ? "active" : "pending"}
                  isLast={true}
                />
              </div>
            </div>

            {/* Agent Logs */}
            {(logs.length > 0 || tailorMutation.isPending) && (
              <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] px-1">Agent Activity</div>
                  {tailorMutation.isPending && <Loader2 size={12} className="animate-spin text-indigo-500" />}
                </div>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                  {logs.map((log, i) => <LogEntry key={i} entry={log} />)}
                  {tailorMutation.isPending && (
                    <div className="flex items-center gap-3 p-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
                      <span className="text-[11px] text-zinc-500 italic">Gemini is processing blocks...</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Coverage Summary */}
            {results?.keywords && (
              <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-6 space-y-4">
                <div className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em] px-1">Keyword Impact</div>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-zinc-400">Alignment Score</span>
                    <span className="text-xs font-black text-emerald-400">+12% Gain</span>
                  </div>
                  <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500 w-[88%] transition-all duration-1000" />
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    {results.keywords.filter((k: any) => !k.present).slice(0, 10).map((k: any) => (
                      <span key={k.kw} className="text-[9px] font-black text-indigo-400 uppercase bg-indigo-500/10 border border-indigo-500/20 px-2 py-1 rounded-md">
                        {k.kw}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Main Content Area */}
          <div className="lg:col-span-8 space-y-6">
            {/* Error View */}
            {currentJob?.sub_status?.startsWith("Error:") && !tailorMutation.isPending && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-3xl p-12 flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in zoom-in-95 duration-500">
                <div className="w-20 h-20 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                  <XCircle size={40} className="text-red-500" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-xl font-black text-zinc-100 tracking-tight">Tailoring Failed</h3>
                  <p className="text-sm text-zinc-500 max-w-md mx-auto leading-relaxed">
                    {currentJob.sub_status.replace("Error: ", "")}
                  </p>
                </div>
                <button 
                  onClick={() => {
                    if (selectedJobId) {
                      setResults(null);
                      setLogs([]);
                      tailorMutation.mutate(selectedJobId);
                    }
                  }}
                  className="px-8 py-3 bg-red-500 hover:bg-red-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-red-500/20 active:scale-95"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Show progress view if tailoring or starting up */}
            {(tailorMutation.isPending || (currentJob?.status === "Tailoring" && !results)) && !currentJob?.sub_status?.startsWith("Error:") && (
              <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-20 flex flex-col items-center justify-center text-center space-y-8 animate-in fade-in zoom-in-95 duration-500 h-[600px]">
                <div className="relative">
                  <div className="w-32 h-32 rounded-full border-2 border-indigo-500/20 animate-ping absolute inset-0" />
                  <div className="w-32 h-32 rounded-3xl bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center relative">
                    <div className="absolute inset-0 bg-indigo-500/5 animate-pulse rounded-3xl" />
                    <Sparkles size={48} className="text-indigo-500 animate-bounce" />
                  </div>
                </div>
                <div className="space-y-4">
                  <h3 className="text-2xl font-black text-zinc-100 tracking-tight">Agent is Optimizing</h3>
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-xs font-black uppercase tracking-[0.3em] text-indigo-400">
                      Current: {currentJob?.sub_status || "Initializing System 1"}
                    </p>
                    <p className="text-sm text-zinc-500 max-w-sm mx-auto leading-relaxed">
                      Surgically injecting missing keywords while preserving your original resume formatting and style.
                    </p>
                  </div>
                </div>
                <div className="w-full max-w-md space-y-3">
                  <div className="flex justify-between text-[10px] font-black uppercase tracking-widest text-zinc-600">
                    <span>Progress</span>
                    <span>
                      {currentJob?.sub_status?.includes("Pipeline complete") ? "100%" :
                       currentJob?.sub_status?.includes("System 7") ? "95%" :
                       currentJob?.sub_status?.includes("System 6") ? "85%" :
                       currentJob?.sub_status?.includes("System 5") ? "70%" :
                       currentJob?.sub_status?.includes("System 4") ? "45%" :
                       currentJob?.sub_status?.includes("System 3") ? "30%" :
                       currentJob?.sub_status?.includes("System 2") ? "20%" :
                       currentJob?.sub_status?.includes("Block AST") ? "10%" : "5%"}
                    </span>
                  </div>
                  <div className="w-full h-2 bg-zinc-900 border border-zinc-800 rounded-full overflow-hidden">
                    <div className={cn(
                      "h-full bg-indigo-500 transition-all duration-1000 ease-out shadow-[0_0_10px_rgba(99,102,241,0.5)]",
                      currentJob?.sub_status?.includes("Pipeline complete") ? "w-[100%]" :
                      currentJob?.sub_status?.includes("System 7") ? "w-[95%]" :
                      currentJob?.sub_status?.includes("System 6") ? "w-[85%]" :
                      currentJob?.sub_status?.includes("System 5") ? "w-[70%]" :
                      currentJob?.sub_status?.includes("System 4") ? "w-[45%]" :
                      currentJob?.sub_status?.includes("System 3") ? "w-[30%]" :
                      currentJob?.sub_status?.includes("System 2") ? "w-[20%]" :
                      currentJob?.sub_status?.includes("Block AST") ? "w-[10%]" : "w-[5%]"
                    )} />
                  </div>
                </div>
              </div>
            )}

            {/* Results Review Area - only show if tailored and not actively tailoring a new session */}
            {currentJob?.status === "Tailored" && !tailorMutation.isPending && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                <div className="flex items-center justify-between px-2">
                  <div className="space-y-1">
                    <h2 className="text-lg font-black text-zinc-100 tracking-tight">Review Suggested Changes</h2>
                    <p className="text-[11px] text-zinc-500 font-medium">Verify AI optimizations before finalizing the document.</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 p-1 bg-zinc-900 border border-zinc-800 rounded-xl">
                      <button 
                        onClick={() => setEmphasize(!emphasize)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all",
                          emphasize ? "bg-indigo-500 text-white" : "text-zinc-500"
                        )}
                      >
                        Bold Keywords
                      </button>
                    </div>
                  </div>
                </div>

                {currentJob && <AnalyticsSummary job={currentJob} />}

                <div className="space-y-4">
                  {editableBullets.map((bullet, idx) => (
                    <DiffCard 
                      key={idx}
                      change={bullet}
                      accepted={accepted[idx]}
                      onToggle={() => setAccepted(p => ({ ...p, [idx]: !p[idx] }))}
                      blockType="Bullet Point"
                    />
                  ))}
                </div>

                <div className="bg-[#131315] border border-zinc-800 rounded-3xl p-8 flex items-center justify-between shadow-2xl">
                  <div className="flex items-center gap-4 text-zinc-400">
                    <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                      <Zap size={20} className="text-amber-400" />
                    </div>
                    <div className="text-xs font-bold leading-relaxed">
                      Format Guarantee: Original XML structure, fonts, <br/>and margins will remain 100% untouched.
                    </div>
                  </div>
                  <button 
                    onClick={handleExport}
                    className="px-8 py-3 bg-indigo-500 hover:bg-indigo-600 text-white rounded-2xl text-[11px] font-black uppercase tracking-[0.2em] transition-all shadow-xl shadow-indigo-500/20 active:scale-95"
                  >
                    Generate & Download
                  </button>
                </div>
              </div>
            )}

          </div>

        </div>
      </div>
      
      <style jsx global>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        @keyframes progress {
          0% { width: 0; }
          50% { width: 70%; }
          100% { width: 100%; }
        }
        .animate-progress {
          animation: progress 3s infinite ease-in-out;
        }
      `}</style>
    </div>
  );
}

export default function TailorPage() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("jobId");

  if (!jobId) return <TailoringList />;
  return <TailoringPipelineView jobId={jobId} />;
}
