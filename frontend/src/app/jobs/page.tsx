"use client";

import React, { useState, useEffect } from "react";
import { 
  Zap, 
  Search, 
  MapPin, 
  DollarSign, 
  ExternalLink,
  Sparkles,
  Download,
  Loader2,
  RefreshCcw,
  Check
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useJobs, useUpdateJobStatus, JobStatus, useCleanupJobs, useSyncWithMaster } from "@/hooks/useJobs";
import { useTriggerIngestion } from "@/hooks/useIngest";
import { useTailorResume } from "@/hooks/useTailor";
import { useRouter } from "next/navigation";

const ScoreCircle = ({ score, size = 10 }: { score: number; size?: number }) => {
  const color = score >= 90 ? "text-emerald-400 border-emerald-400/50" : score >= 80 ? "text-indigo-400 border-indigo-400/50" : "text-amber-400 border-amber-400/50";
  return (
    <div className={cn("rounded-full border-2 flex items-center justify-center shrink-0 font-bold", `w-${size} h-${size} text-${size === 10 ? 'xs' : 'sm'}`, color)}>
      {score}
    </div>
  );
};

export default function JobPipeline() {
  const [filter, setFilter] = useState<JobStatus | "All">("All");
  const [search, setSearch] = useState("");
  const router = useRouter();
  
  const { data: jobs = [], isLoading } = useJobs(filter === "All" ? undefined : filter as JobStatus);
  const ingestMutation = useTriggerIngestion();
  const syncMutation = useSyncWithMaster();
  const updateStatusMutation = useUpdateJobStatus();
  const tailorMutation = useTailorResume();
  const cleanupMutation = useCleanupJobs();

  useEffect(() => {
    cleanupMutation.mutate();
  }, []);

  // Deduplicate jobs by company+title

  const uniqueJobs = Array.from(
    new Map(
      jobs.map(job => {
        const key = job.composite_key || `${job.company_name}-${job.job_title}`.toLowerCase().replace(/\s+/g, "_");
        return [key, job];
      })
    ).values()
  ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const filteredJobs = uniqueJobs.filter(j => 
    j.job_title.toLowerCase().includes(search.toLowerCase()) || 
    j.company_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div>
          <h1 className="text-lg font-bold">Job Pipeline</h1>
          <p className="text-[11px] text-zinc-500">{jobs.length} jobs in this view</p>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 rounded-lg text-xs font-semibold transition-colors"
          >
            {syncMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCcw size={14} />}
            Sync with Master
          </button>
          <button 
            onClick={() => ingestMutation.mutate()}
            disabled={ingestMutation.isPending}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
          >
            {ingestMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} fill="currentColor" />}
            Run Ingestion
          </button>
        </div>
      </header>

      <div className="p-6 flex-1 overflow-y-auto space-y-6">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="flex gap-2 p-1 bg-zinc-900 rounded-xl border border-zinc-800 overflow-x-auto w-full md:w-auto">
            {["All", "Pending", "Tailored", "Applied", "Skipped"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f as any)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-xs font-semibold transition-all whitespace-nowrap",
                  filter === f 
                    ? "bg-zinc-800 text-indigo-400 shadow-sm" 
                    : "text-zinc-500 hover:text-zinc-300"
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
            <input
              type="text"
              placeholder="Search jobs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-[#1A1A1A] border border-zinc-800 rounded-xl py-2 pl-9 pr-4 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 size={32} className="animate-spin text-indigo-500" />
          </div>
        ) : (
          <div className="space-y-3">
            {filteredJobs.map((job) => (
              <div 
                key={job.id} 
                onClick={() => router.push(`/jobs/${job.id}`)}
                className={cn(
                  "bg-[#1A1A1A] border border-zinc-800 rounded-xl p-4 flex flex-col md:flex-row items-start md:items-center gap-4 transition-all hover:border-zinc-700 group cursor-pointer active:scale-[0.995]",
                  job.status === "Skipped" && "opacity-60"
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-lg font-bold text-zinc-500 shrink-0">
                  {job.company_name[0]}
                </div>
                
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-sm font-bold truncate group-hover:text-indigo-400 transition-colors">{job.job_title}</h3>
                    <span className={cn(
                      "text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider",
                      job.status === "Pending" ? "bg-amber-500/10 text-amber-500" :
                      job.status === "Applied" ? "bg-emerald-500/10 text-emerald-500" :
                      job.status === "Tailored" ? "bg-purple-500/10 text-purple-400" :
                      "bg-zinc-800 text-zinc-500"
                    )}>
                      {job.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 items-center text-[11px] text-zinc-500">
                    <span className="font-semibold text-zinc-400">{job.company_name}</span>
                    <span className="flex items-center gap-1"><MapPin size={12} /> {job.location || "Remote"}</span>
                    {job.salary && <span className="flex items-center gap-1"><DollarSign size={12} /> {job.salary}</span>}
                  </div>
                </div>

                <div className="flex items-center gap-4 self-stretch md:self-auto justify-between md:justify-end">
                  <ScoreCircle score={job.match_score} size={10} />
                  
                  <div className="flex items-center gap-2">
                    {job.status === "Pending" && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`/tailor?jobId=${job.id}`);
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold transition-colors"
                      >
                        <Sparkles size={12} /> 
                        Tailor
                      </button>
                    )}
                    {job.status === "Tailored" && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (job.tailored_resume_path) {
                            const filename = job.tailored_resume_path.split('/').pop();
                            window.open(`http://localhost:8000/download/${filename}`, '_blank');
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-[11px] font-bold transition-colors"
                      >
                        <Download size={12} /> Download
                      </button>
                    )}
                    {job.job_url && (
                      <a 
                        href={job.job_url} 
                        target="_blank" 
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg transition-colors"
                      >
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
            
            {filteredJobs.length === 0 && (
              <div className="py-20 text-center border-2 border-dashed border-zinc-800 rounded-2xl">
                <p className="text-zinc-500 text-sm italic">No jobs found matching your criteria.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
