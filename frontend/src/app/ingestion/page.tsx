"use client";

import React from "react";
import { 
  Zap, 
  Clock, 
  Server, 
  History, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  ChevronRight,
  Settings
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTriggerIngestion } from "@/hooks/useIngest";
import { useProfile } from "@/hooks/useProfile";

export default function IngestionPage() {
  const { data: profile } = useProfile();
  const ingestMutation = useTriggerIngestion();

  const runHistory = [
    { time: "Today 14:00", fetched: 47, passed: 18, new: 12, status: "success" },
    { time: "Today 08:00", fetched: 52, passed: 21, new: 7, status: "success" },
    { time: "Yesterday 20:00", fetched: 38, passed: 14, new: 5, status: "success" },
    { time: "Yesterday 14:00", fetched: 0, passed: 0, new: 0, status: "error" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div>
          <h1 className="text-lg font-bold">Ingestion Control</h1>
          <p className="text-[11px] text-zinc-500">Configure & monitor job discovery</p>
        </div>
        <button 
          onClick={() => ingestMutation.mutate()}
          disabled={ingestMutation.isPending}
          className="px-6 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-2"
        >
          {ingestMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} fill="currentColor" />}
          Run Ingestion Now
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Scheduling */}
          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-6 space-y-6">
            <div className="flex items-center gap-2 text-zinc-400">
              <Clock size={18} />
              <h2 className="text-xs font-bold uppercase tracking-widest">Ingestion Schedule</h2>
            </div>
            
            <div className="space-y-2">
              {["Every 3h", "Every 6h", "Every 12h", "Daily"].map((freq) => (
                <button
                  key={freq}
                  className={cn(
                    "w-full flex items-center justify-between p-4 rounded-xl border transition-all",
                    profile?.ingestion_frequency === freq 
                      ? "bg-indigo-500/10 border-indigo-500/40 text-indigo-400" 
                      : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <span className="text-sm font-bold">{freq}</span>
                  {profile?.ingestion_frequency === freq && <CheckCircle2 size={16} />}
                </button>
              ))}
            </div>
          </div>

          {/* Data Sources */}
          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-6 space-y-6">
            <div className="flex items-center gap-2 text-zinc-400">
              <Server size={18} />
              <h2 className="text-xs font-bold uppercase tracking-widest">Data Sources</h2>
            </div>
            
            <div className="space-y-3">
              {[
                { name: "JSearch API", status: "Active", type: "Primary", active: true },
                { name: "Apify Actor", status: "Paused", type: "Fallback", active: false },
                { name: "LinkedIn API", status: "Not Configured", type: "Experimental", active: false },
              ].map((source) => (
                <div key={source.name} className="flex items-center justify-between p-4 bg-zinc-900 rounded-xl border border-zinc-800">
                  <div className="flex items-center gap-3">
                    <div className={cn("w-2 h-2 rounded-full", source.active ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-zinc-700")} />
                    <div>
                      <div className="text-sm font-bold">{source.name}</div>
                      <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-tighter">{source.status} · {source.type}</div>
                    </div>
                  </div>
                  <button className="text-[10px] font-bold text-zinc-400 hover:text-zinc-200 transition-colors uppercase tracking-widest px-3 py-1 bg-zinc-800 rounded-lg">Config</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Run History */}
        <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-zinc-800 flex items-center gap-2 text-zinc-400">
            <History size={18} />
            <h2 className="text-xs font-bold uppercase tracking-widest">Ingestion Run History</h2>
          </div>
          <div className="divide-y divide-zinc-800">
            {runHistory.map((run, i) => (
              <div key={i} className="p-4 flex items-center gap-6 hover:bg-zinc-800/30 transition-colors">
                <div className={cn("w-2 h-2 rounded-full shrink-0", run.status === "success" ? "bg-emerald-500" : "bg-red-500")} />
                <div className="text-sm font-bold text-zinc-300 w-32">{run.time}</div>
                
                <div className="flex-1 flex gap-3">
                  {run.status === "success" ? (
                    <>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700 uppercase tracking-tighter">{run.fetched} fetched</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 uppercase tracking-tighter">{run.passed} passed</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 uppercase tracking-tighter">+{run.new} new</span>
                    </>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 uppercase tracking-tighter">API Error — Timeout</span>
                  )}
                </div>
                
                <button className="text-zinc-500 hover:text-zinc-300 transition-colors">
                  <ChevronRight size={18} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Filter Config */}
        <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-6 space-y-6">
          <div className="flex items-center gap-2 text-zinc-400">
            <Settings size={18} />
            <h2 className="text-xs font-bold uppercase tracking-widest">Global Filter Configuration</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { label: "Minimum Score Threshold", value: profile?.min_ai_score || 75 },
              { label: "Max Jobs Per Run", value: 50 },
              { label: "Deduplication Window", value: "30 days" },
            ].map((config) => (
              <div key={config.label} className="space-y-2">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{config.label}</label>
                <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-sm font-mono text-indigo-400">
                  {config.value}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
