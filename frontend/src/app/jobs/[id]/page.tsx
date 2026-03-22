"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { 
  ArrowLeft,
  Sparkles,
  ExternalLink,
  MapPin,
  DollarSign,
  Clock,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Building2,
  Calendar,
  Briefcase,
  Target,
  Download,
  RefreshCw
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useJob, useUpdateJobStatus, useRescoreJob, JobStatus } from "@/hooks/useJobs";
import { useTailorResume } from "@/hooks/useTailor";

const ScoreCircle = ({ score, size = 16 }: { score: number; size?: number }) => {
  const color = score >= 90 ? "text-emerald-400 border-emerald-400" : score >= 80 ? "text-indigo-400 border-indigo-400" : "text-amber-400 border-amber-400";
  return (
    <div className={cn("rounded-full border-[4px] flex items-center justify-center shrink-0 font-black tracking-tighter", color)} style={{ width: size * 4, height: size * 4, fontSize: size * 1.4 }}>
      {score}
    </div>
  );
};

const Tag = ({ label }: { label: string }) => (
  <span className="text-[10px] px-2 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-400 font-bold uppercase tracking-wider">
    {label}
  </span>
);

export default function JobDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: job, isLoading } = useJob(params.id as string);
  const { mutate: updateStatus } = useUpdateJobStatus();
  const tailorMutation = useTailorResume();
  const rescoreMutation = useRescoreJob();

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0F0F0F]">
        <Loader2 className="animate-spin text-indigo-500" size={40} />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-[#0F0F0F] text-zinc-500">
        <AlertCircle size={48} className="mb-4 opacity-20" />
        <h1 className="text-xl font-bold text-zinc-300">Job Not Found</h1>
        <button onClick={() => router.back()} className="mt-4 text-indigo-400 font-bold uppercase tracking-widest text-xs hover:underline">
          Go Back
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      {/* Header */}
      <header className="px-8 py-5 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => router.back()}
            className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-500 transition-colors"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-lg font-black tracking-tight text-zinc-100">Job Detail</h1>
            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">Analysis & Metadata</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {job.tailored_resume_path && (
            <button 
              onClick={() => {
                const filename = job.tailored_resume_path!.split('/').pop();
                window.open(`http://localhost:8000/download/${filename}`, '_blank');
              }}
              className="flex items-center gap-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
            >
              <Download size={14} />
              Download Resume
            </button>
          )}
          <Link 
            href={`/tailor?jobId=${job.id}`}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            <Sparkles size={14} />
            Tailor Resume
          </Link>
          {job.job_url && (
            <a 
              href={job.job_url} 
              target="_blank" 
              rel="noreferrer"
              className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-bold transition-all flex items-center gap-2 active:scale-95"
            >
              View JD <ExternalLink size={14} />
            </a>
          )}
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8">
        <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          {/* Left Column: Job Info */}
          <div className="lg:col-span-2 space-y-8">
            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-3xl p-8 space-y-6 shadow-xl">
              <div className="flex gap-6 items-start">
                <div className="w-16 h-16 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-3xl font-black text-zinc-500">
                  {job.company_name[0]}
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <h2 className="text-2xl font-black text-zinc-100 tracking-tight">{job.job_title}</h2>
                  <div className="flex flex-wrap gap-4 text-[11px] font-bold text-zinc-500 uppercase tracking-widest">
                    <span className="flex items-center gap-1.5"><Building2 size={14} className="text-zinc-600" /> {job.company_name}</span>
                    <span className="flex items-center gap-1.5"><MapPin size={14} className="text-zinc-600" /> {job.location || "Remote"}</span>
                    {job.salary && <span className="flex items-center gap-1.5"><DollarSign size={14} className="text-zinc-600" /> {job.salary}</span>}
                  </div>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Tag label="Next.js" />
                    <Tag label="TypeScript" />
                    <Tag label="React" />
                    <Tag label="Full-Time" />
                  </div>
                </div>
              </div>

              <div className="border-t border-zinc-800/50 pt-8 space-y-4">
                <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Job Description</h3>
                <div className="text-sm text-zinc-400 leading-relaxed space-y-4 bg-zinc-900/30 p-6 rounded-2xl border border-zinc-800/50 min-h-[200px]">
                  {job.job_description.split('\n').map((p, i) => (
                    <p key={i}>{p}</p>
                  ))}
                </div>
              </div>
            </div>

            {/* Extracted Keywords (by LLM) */}
            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-3xl p-8 space-y-6">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Extracted Keywords (by LLM)</h3>
              {job.extracted_keywords && job.extracted_keywords.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {job.extracted_keywords.map((k) => (
                    <div key={k.kw} className="flex items-center gap-4 p-3 bg-zinc-900/50 border border-zinc-800 rounded-xl hover:border-zinc-700 transition-all">
                      <div className={cn("w-6 h-6 rounded-lg flex items-center justify-center text-xs shadow-sm", k.present ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500")}>
                        {k.present ? "✓" : "!"}
                      </div>
                      <div className="flex-1">
                        <div className="text-xs font-bold text-zinc-200">{k.kw}</div>
                        <div className="text-[9px] font-black text-zinc-600 uppercase tracking-tighter">{k.weight} Priority</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 space-y-2">
                  <div className="text-zinc-700 text-2xl">⚙</div>
                  <p className="text-[11px] text-zinc-600 font-bold uppercase tracking-widest text-center">
                    Run tailoring to extract keywords
                  </p>
                  <p className="text-[10px] text-zinc-700 text-center max-w-[220px]">
                    Keywords are extracted during the tailoring pipeline and matched against your resume.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Sidebar Analysis */}
          <div className="space-y-8">
            {/* AI Match Card */}
            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-3xl p-8 space-y-6 shadow-xl relative overflow-hidden">
              <div className="absolute -top-12 -right-12 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl" />
              <div className="flex items-center justify-between relative z-10">
                <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">AI Match Score</h3>
                <button
                  onClick={() => rescoreMutation.mutate(job.id)}
                  disabled={rescoreMutation.isPending}
                  title="Recalculate score"
                  className="p-1.5 rounded-lg hover:bg-zinc-800 text-zinc-600 hover:text-zinc-300 transition-colors disabled:opacity-40"
                >
                  <RefreshCw size={13} className={rescoreMutation.isPending ? "animate-spin" : ""} />
                </button>
              </div>
              <div className="flex flex-col items-center py-4 space-y-6 relative z-10">
                {rescoreMutation.isPending ? (
                  <div className="flex flex-col items-center gap-3">
                    <Loader2 size={40} className="animate-spin text-indigo-400" />
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Calculating…</span>
                  </div>
                ) : (
                  <ScoreCircle score={job.match_score} size={24} />
                )}
                <p className="text-xs text-zinc-400 text-center leading-relaxed font-medium italic px-4">
                  "{job.match_reason || "No score yet — click refresh to calculate."}"
                </p>
              </div>
            </div>

            {/* Quick Stats */}
            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-3xl p-8 space-y-6 shadow-xl">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Quick Stats</h3>
              <div className="space-y-1">
                {[
                  { icon: Clock, label: "Posted", value: "2 hours ago" },
                  { icon: Building2, label: "Company Size", value: "500–1000" },
                  { icon: Target, label: "ATS System", value: "Greenhouse" },
                  { icon: Calendar, label: "Apply Before", value: "Mar 15, 2026" },
                ].map((stat, i) => (
                  <div key={i} className="flex justify-between items-center py-3 border-b border-zinc-800/50 last:border-0">
                    <div className="flex items-center gap-2 text-zinc-500">
                      <stat.icon size={14} />
                      <span className="text-[11px] font-bold uppercase tracking-tight">{stat.label}</span>
                    </div>
                    <span className="text-[11px] font-black text-zinc-200">{stat.value}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Status Selector */}
            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-3xl p-8 space-y-6 shadow-xl">
              <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Current Status</h3>
              <div className="space-y-2">
                {(["Pending", "Tailored", "Applied", "Skipped"] as JobStatus[]).map((status) => {
                  const active = job.status === status;
                  return (
                    <button
                      key={status}
                      onClick={() => updateStatus({ job_id: job.id, status })}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 rounded-xl border transition-all text-left",
                        active 
                          ? "bg-indigo-500/10 border-indigo-500/40 text-indigo-400 font-bold" 
                          : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                      )}
                    >
                      <div className={cn("w-2 h-2 rounded-full", active ? "bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,0.5)]" : "bg-zinc-700")} />
                      <span className="text-xs uppercase tracking-widest">{status}</span>
                      {active && <CheckCircle2 size={14} className="ml-auto" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
