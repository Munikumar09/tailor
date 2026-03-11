"use client";

import React, { useState } from "react";
import { 
  Zap, 
  ArrowRight, 
  Clock, 
  CheckCircle2, 
  Sparkles, 
  FileDown,
  Loader2,
  ChevronRight,
  TrendingUp,
  Inbox,
  FileText,
  X,
  ExternalLink,
  MapPin,
  DollarSign
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useJobs, useUpdateJobStatus, Job } from "@/hooks/useJobs";
import { useTriggerIngestion } from "@/hooks/useIngest";
import { useTailorResume } from "@/hooks/useTailor";
import Link from "next/link";

const StatCard = ({ label, value, detail, color }: any) => {
  const colors: any = {
    indigo: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    purple: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  };
  
  return (
    <div className={cn("bg-[#1A1A1A] border rounded-2xl p-5 transition-all hover:border-zinc-700", colors[color].split(" ")[2])}>
      <div className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.15em] mb-3">{label}</div>
      <div className={cn("text-4xl font-black tracking-tighter", colors[color].split(" ")[0])}>{value}</div>
      <div className="text-[11px] font-medium text-zinc-500 mt-2 flex items-center gap-1">
        {detail}
      </div>
    </div>
  );
};

const ScoreCircle = ({ score, size = 10 }: { score: number; size?: number }) => {
  const color = score >= 90 ? "text-emerald-400 border-emerald-400" : score >= 80 ? "text-indigo-400 border-indigo-400" : "text-amber-400 border-amber-400";
  // Responsive font sizing: 0.35x size instead of 0.28x
  const fontSize = size * 0.35;
  
  return (
    <div 
      className={cn("rounded-full border-[3px] flex items-center justify-center shrink-0 font-black tracking-tighter", color)}
      style={{ width: size * 4, height: size * 4, fontSize: fontSize * 4 }}
    >
      {score}
    </div>
  );
};

const JobDetailModal = ({ job, onClose, onApply }: { job: Job; onClose: () => void; onApply: (id: number) => void }) => {
  if (!job) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[#1A1A1A] border border-zinc-800 rounded-3xl w-full max-w-2xl max-h-[90vh] overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-zinc-800 flex items-center justify-center text-xl font-bold text-zinc-400 border border-zinc-700">
              {job.company_name[0]}
            </div>
            <div>
              <h2 className="text-lg font-black text-zinc-100 tracking-tight">{job.job_title}</h2>
              <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest">{job.company_name}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full text-zinc-500 transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-8 overflow-y-auto max-h-[calc(90vh-100px)] space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl flex items-center gap-5">
              <ScoreCircle score={job.match_score} size={14} />
              <div>
                <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">AI Match Score</p>
                <p className="text-sm font-bold text-zinc-300 mt-1">Strong compatibility</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-zinc-400">
                <MapPin size={14} />
                <span className="text-xs font-bold">{job.location || "Remote"}</span>
              </div>
              <div className="flex items-center gap-2 text-zinc-400">
                <DollarSign size={14} />
                <span className="text-xs font-bold">{job.salary || "Not specified"}</span>
              </div>
              <div className="flex items-center gap-2 text-indigo-400">
                <Clock size={14} />
                <span className="text-xs font-bold uppercase tracking-tighter">Ready for tailoring</span>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Match Analysis</h3>
            <p className="text-sm text-zinc-400 leading-relaxed bg-zinc-900/30 p-4 rounded-xl border border-zinc-800/50 italic">
              "{job.match_reason}"
            </p>
          </div>

          <div className="space-y-3">
            <h3 className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Job Description</h3>
            <div className="text-xs text-zinc-500 leading-relaxed space-y-4 max-h-64 overflow-y-auto pr-4 scrollbar-thin scrollbar-thumb-zinc-800">
              {job.job_description.split('\n').map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </div>

          <div className="pt-4 flex gap-3">
            {job.job_url && (
              <a 
                href={job.job_url} 
                target="_blank" 
                rel="noreferrer"
                className="flex-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all flex items-center justify-center gap-2"
              >
                View JD <ExternalLink size={14} />
              </a>
            )}
            <button 
              onClick={() => {
                onApply(job.id);
                onClose();
              }}
              className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all shadow-lg shadow-emerald-500/20"
            >
              Mark Applied
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function Dashboard() {
  const { data: allJobs = [], isLoading } = useJobs();
  const ingestMutation = useTriggerIngestion();
  const updateStatusMutation = useUpdateJobStatus();
  const tailorMutation = useTailorResume();
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  const counts = {
    ingested: allJobs.length,
    passed: allJobs.filter(j => j.match_score >= 75).length,
    pending: allJobs.filter(j => j.status === "Pending").length,
    tailored: allJobs.filter(j => j.status === "Tailored").length,
    applied: allJobs.filter(j => j.status === "Applied").length,
  };

  const today = new Date().toLocaleDateString('en-US', { 
    weekday: 'long', 
    month: 'short', 
    day: 'numeric' 
  });

  const pendingActions = allJobs.filter(j => j.status === "Pending" || j.status === "Tailored");

  const handleMarkApplied = (id: number) => {
    updateStatusMutation.mutate({ job_id: id, status: "Applied" });
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      {/* Header */}
      <header className="px-8 py-5 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div>
          <h1 className="text-xl font-black tracking-tight text-zinc-100">Dashboard</h1>
          <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-widest mt-0.5">{today} · Pipeline is active</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => ingestMutation.mutate()}
            disabled={ingestMutation.isPending}
            className="flex items-center gap-2 px-5 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            {ingestMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} fill="currentColor" />}
            Run Ingestion
          </button>
          <Link href="/jobs" className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-bold transition-all active:scale-95">
            View All Jobs
          </Link>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 space-y-8">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
             <Loader2 size={40} className="animate-spin text-indigo-500 opacity-20" />
          </div>
        ) : (
          <>
            {/* Stat Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard label="Ingested" value={counts.ingested} detail="↑ 12 discovery run" color="indigo" />
              <StatCard label="Passed Filter" value={counts.passed} detail="≥ 75 fit score" color="purple" />
              <StatCard label="Pending Review" value={counts.pending} detail="Manual action required" color="amber" />
              <StatCard label="Applied" value={counts.applied} detail="Success this week" color="emerald" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Funnel Card */}
              <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-8 space-y-8">
                <div className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Pipeline Funnel</div>
                <div className="space-y-6">
                  {[
                    { label: "Ingested", value: counts.ingested, color: "bg-zinc-700", width: "100%", textClass: "text-zinc-500" },
                    { label: "Filtered ≥75", value: counts.passed, color: "bg-indigo-500", width: counts.ingested ? `${(counts.passed / counts.ingested) * 100}%` : "0%", textClass: "text-indigo-400" },
                    { label: "Reviewed", value: (counts.pending + counts.tailored + counts.applied), color: "bg-purple-500", width: counts.ingested ? `${((counts.pending + counts.tailored + counts.applied) / counts.ingested) * 100}%` : "0%", textClass: "text-purple-400" },
                    { label: "Tailored", value: (counts.tailored + counts.applied), color: "bg-amber-500", width: counts.ingested ? `${((counts.tailored + counts.applied) / counts.ingested) * 100}%` : "0%", textClass: "text-amber-400" },
                    { label: "Applied", value: counts.applied, color: "bg-emerald-500", width: counts.ingested ? `${(counts.applied / counts.ingested) * 100}%` : "0%", textClass: "text-emerald-400" },
                  ].map((item) => (
                    <div key={item.label} className="space-y-2">
                      <div className="flex justify-between items-center px-1">
                        <span className="text-[11px] font-bold text-zinc-400">{item.label}</span>
                        <span className={cn("text-xs font-black", item.textClass)}>{item.value}</span>
                      </div>
                      <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all duration-1000 ease-out", item.color)} style={{ width: item.width || "0%" }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Activity Card */}
              <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-8 space-y-8">
                <div className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Recent Activity</div>
                <div className="space-y-1">
                  {allJobs.slice(0, 4).map((job, i) => (
                    <div 
                      key={i} 
                      onClick={() => setSelectedJob(job)}
                      className="flex gap-5 py-4 group cursor-pointer border-b border-zinc-800/50 last:border-0 hover:bg-zinc-800/20 px-2 -mx-2 rounded-xl transition-all"
                    >
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border border-indigo-500/20 bg-indigo-500/5 text-indigo-400")}>
                        <Sparkles size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-0.5">
                          <div className="text-sm font-bold text-zinc-200 group-hover:text-indigo-400 transition-colors truncate pr-2">
                            New job matched: {job.job_title}
                          </div>
                          <div className="text-[10px] font-bold text-zinc-600 uppercase whitespace-nowrap">2h ago</div>
                        </div>
                        <div className="text-[11px] font-medium text-zinc-500 line-clamp-1 italic">
                          {job.company_name} · score {job.match_score}/100
                        </div>
                      </div>
                    </div>
                  ))}
                  {allJobs.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-12 text-center space-y-3 opacity-20">
                      <TrendingUp size={40} />
                      <p className="text-xs font-bold uppercase tracking-widest">No activity detected</p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Pending Action Card */}
            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30">
                <div className="text-[10px] font-black text-zinc-500 uppercase tracking-[0.2em]">Pending Action</div>
                <Link href="/jobs?status=Pending" className="text-[10px] font-black text-indigo-400 hover:text-indigo-300 transition-colors flex items-center gap-1.5 uppercase tracking-widest">
                  View All <ArrowRight size={12} />
                </Link>
              </div>
              <div className="divide-y divide-zinc-800">
                {pendingActions.slice(0, 10).map((job, i) => (
                  <div 
                    key={i} 
                    onClick={() => setSelectedJob(job)}
                    className="p-5 flex items-center gap-6 hover:bg-zinc-800/30 transition-all cursor-pointer group"
                  >
                    <div className="w-10 h-10 shrink-0">
                      <ScoreCircle score={job.match_score} size={10} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-black text-zinc-200 truncate group-hover:text-indigo-400 transition-colors mb-0.5">{job.job_title}</div>
                      <div className="text-[11px] font-bold text-zinc-500 uppercase tracking-tight">{job.company_name}</div>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className={cn(
                        "text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-wider border",
                        job.status === "Pending" ? "bg-amber-500/10 text-amber-500 border-amber-500/20" : "bg-purple-500/10 text-purple-400 border-purple-500/20"
                      )}>
                        {job.status}
                      </span>
                      {job.status === "Pending" ? (
                        <Link 
                          href={`/tailor?jobId=${job.id}`}
                          className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2 active:scale-95"
                        >
                          Tailor
                        </Link>
                      ) : (
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkApplied(job.id);
                          }}
                          disabled={updateStatusMutation.isPending}
                          className="px-4 py-1.5 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
                        >
                          Mark Applied
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {pendingActions.length === 0 && (
                  <div className="p-16 flex flex-col items-center justify-center text-center space-y-4">
                    <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-700">
                      <CheckCircle2 size={32} />
                    </div>
                    <div>
                      <p className="text-zinc-300 font-bold uppercase tracking-widest text-xs">Queue Clear</p>
                      <p className="text-zinc-500 text-[11px] mt-1">Run ingestion to find new opportunities.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modal */}
      {selectedJob && (
        <JobDetailModal 
          job={selectedJob} 
          onClose={() => setSelectedJob(null)} 
          onApply={handleMarkApplied}
        />
      )}
    </div>
  );
}
