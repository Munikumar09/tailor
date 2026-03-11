"use client";

import React from "react";
import { cn } from "@/lib/utils";

const StatCard = ({ label, value, colorClass }: { label: string, value: string, colorClass: string }) => (
  <div className="bg-[#1A1A1A] border border-zinc-800 rounded-xl p-5">
    <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">{label}</div>
    <div className={cn("text-3xl font-extrabold tracking-tight", colorClass)}>{value}</div>
  </div>
);

export default function AnalyticsPage() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div>
          <h1 className="text-lg font-bold">Analytics & Insights</h1>
          <p className="text-[11px] text-zinc-500">Last 30 days · Feb 2026</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard label="Total Discovered" value="247" colorClass="text-indigo-400" />
          <StatCard label="Passed Filter" value="89" colorClass="text-purple-400" />
          <StatCard label="Resumes Tailored" value="34" colorClass="text-amber-400" />
          <StatCard label="Applications Sent" value="12" colorClass="text-emerald-400" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 bg-[#1A1A1A] border border-zinc-800 rounded-xl p-6">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-6">Applications Over Time</div>
            <div className="h-32 flex items-end gap-1 pt-2">
              {[30,45,20,60,80,50,70,90,40,55,75,85,30,65,95,45,70,50,80,60,75,55,90,65,80,45,70,85,60,95].map((h,i)=>(
                <div key={i} className={cn("flex-1 rounded-t-sm opacity-80", i > 25 ? "bg-indigo-500" : "bg-zinc-800")} style={{ height: `${h}%` }} />
              ))}
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-[10px] text-zinc-500">Feb 1</span>
              <span className="text-[10px] text-zinc-500">Feb 28</span>
            </div>
          </div>

          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-xl p-6">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-6">Score Distribution</div>
            <div className="space-y-4">
              {[
                { range: "90–100", value: "8 jobs", color: "bg-emerald-500", textClass: "text-emerald-400", width: "30%" },
                { range: "80–89", value: "24 jobs", color: "bg-indigo-500", textClass: "text-indigo-400", width: "60%" },
                { range: "75–79", value: "57 jobs", color: "bg-amber-500", textClass: "text-amber-400", width: "100%" }
              ].map((item) => (
                <div key={item.range} className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">{item.range}</span>
                    <span className={cn("font-bold", item.textClass)}>{item.value}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", item.color)} style={{ width: item.width }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-xl p-6">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">Top Companies Matched</div>
            <div className="space-y-3">
              {[["Vercel","8"],["Anthropic","6"],["Stripe","5"],["Linear","4"],["Figma","4"]].map(([c,n])=>(
                <div key={c} className="flex justify-between items-center py-1.5 border-b border-zinc-800/50 last:border-0">
                  <span className="text-xs text-zinc-400">{c}</span>
                  <span className="text-xs font-bold text-zinc-200">{n}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-xl p-6">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">Keyword Gap Analysis</div>
            <div className="space-y-3">
              {[
                { k: "Edge Runtime", v: "Injected 12×", c: "text-amber-400" },
                { k: "RLHF", v: "Injected 5×", c: "text-amber-400" },
                { k: "Kubernetes", v: "Skipped", c: "text-zinc-500" },
                { k: "WebGL", v: "Injected 3×", c: "text-indigo-400" },
                { k: "GraphQL", v: "Injected 8×", c: "text-indigo-400" }
              ].map((item)=>(
                <div key={item.k} className="flex justify-between items-center py-1.5 border-b border-zinc-800/50 last:border-0">
                  <span className="text-xs text-zinc-400">{item.k}</span>
                  <span className={cn("text-xs font-bold", item.c)}>{item.v}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-xl p-6">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">Pipeline Conversion</div>
            <div className="space-y-3">
              {[
                { l: "Ingested → Filtered", v: "36%", c: "bg-indigo-500", textClass: "text-indigo-400" },
                { l: "Filtered → Reviewed", v: "78%", c: "bg-purple-500", textClass: "text-purple-400" },
                { l: "Reviewed → Tailored", v: "62%", c: "bg-amber-500", textClass: "text-amber-400" },
                { l: "Tailored → Applied", v: "35%", c: "bg-emerald-500", textClass: "text-emerald-400" }
              ].map((item)=>(
                <div key={item.l} className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-zinc-500">{item.l}</span>
                    <span className={cn("text-[11px] font-bold", item.textClass)}>{item.v}</span>
                  </div>
                  <div className="h-1 bg-zinc-900 rounded-full overflow-hidden">
                    <div className={cn("h-full rounded-full", item.c)} style={{ width: item.v }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
