"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Sparkles, Target, Download, CheckCircle2, AlertTriangle, BarChart2 } from "lucide-react";

export default function NotificationsPage() {
  const notifications = [
    { icon: Sparkles, title: "Resume tailored for Vercel", desc: "8 bullets rewritten, 6 keywords injected. Ready to download.", time: "2h ago", read: false, colorClass: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20" },
    { icon: Target, title: "New high match: Staff Eng @ Anthropic", desc: "Score: 88/100 — 'LangGraph' and 'FastAPI' match your resume directly.", time: "5h ago", read: false, colorClass: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    { icon: Download, title: "Ingestion complete", desc: "47 jobs fetched · 18 passed filter · 12 new this run.", time: "6h ago", read: true, colorClass: "text-zinc-400 bg-zinc-800 border-zinc-700" },
    { icon: CheckCircle2, title: "Application marked: Full Stack @ Linear", desc: "You applied manually. Status updated to Applied.", time: "1d ago", read: true, colorClass: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
    { icon: AlertTriangle, title: "Ingestion run failed", desc: "JSearch API timeout. Will retry in 30 minutes.", time: "2d ago", read: true, colorClass: "text-amber-400 bg-amber-500/10 border-amber-500/20" },
    { icon: BarChart2, title: "Weekly summary: Feb 22–28", desc: "12 jobs reviewed · 5 tailored · 2 applied. Avg score: 83.", time: "3d ago", read: true, colorClass: "text-purple-400 bg-purple-500/10 border-purple-500/20" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div>
          <h1 className="text-lg font-bold">Notifications</h1>
          <p className="text-[11px] text-zinc-500">2 unread notifications</p>
        </div>
        <button className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold transition-colors">
          Mark All Read
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-6 max-w-4xl mx-auto w-full">
        <div className="space-y-3">
          {notifications.map((n, i) => (
            <div key={i} className={cn(
              "p-4 rounded-2xl border flex gap-4 transition-all hover:bg-zinc-900/50",
              !n.read ? "bg-[#1A1A1A] border-zinc-800" : "bg-[#0F0F0F] border-zinc-800/50 opacity-70"
            )}>
              <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border", n.colorClass)}>
                <n.icon size={18} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <h3 className={cn("text-sm font-bold", !n.read ? "text-zinc-200" : "text-zinc-400")}>
                      {n.title}
                    </h3>
                    {!n.read && <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />}
                  </div>
                  <span className="text-[10px] text-zinc-500 whitespace-nowrap ml-4">{n.time}</span>
                </div>
                <p className="text-xs text-zinc-500 leading-relaxed">{n.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
