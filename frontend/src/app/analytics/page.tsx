"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnalyticsSummary } from "@/hooks/useAnalytics";

// ── small reusable widgets ─────────────────────────────────────────────────

const StatCard = ({
  label,
  value,
  sub,
  colorClass,
}: {
  label: string;
  value: string | number;
  sub?: string;
  colorClass: string;
}) => (
  <div className="bg-[#1A1A1A] border border-zinc-800 rounded-xl p-5">
    <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2">
      {label}
    </div>
    <div className={cn("text-3xl font-extrabold tracking-tight", colorClass)}>
      {value}
    </div>
    {sub && <div className="text-[10px] text-zinc-600 mt-1">{sub}</div>}
  </div>
);

// Colour bands for score buckets (highest first)
const SCORE_COLORS = [
  "bg-emerald-500",
  "bg-indigo-500",
  "bg-amber-500",
  "bg-orange-500",
  "bg-zinc-600",
];
const SCORE_TEXT = [
  "text-emerald-400",
  "text-indigo-400",
  "text-amber-400",
  "text-orange-400",
  "text-zinc-400",
];

const PIPELINE_COLORS = [
  { bar: "bg-indigo-500", text: "text-indigo-400" },
  { bar: "bg-emerald-500", text: "text-emerald-400" },
  { bar: "bg-amber-500",   text: "text-amber-400" },
  { bar: "bg-rose-500",    text: "text-rose-400" },
];

// Format "2026-03-01" → "Mar 1"
function fmtDate(iso: string) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── page ──────────────────────────────────────────────────────────────────

export default function AnalyticsPage() {
  const { data, isLoading, error } = useAnalyticsSummary();

  // Dynamic header subtitle: date range of last 30 days
  const today     = new Date();
  const thirtyAgo = new Date(today);
  thirtyAgo.setDate(today.getDate() - 29);
  const dateRange = `${thirtyAgo.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${today.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0F0F0F]">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center bg-[#0F0F0F] text-zinc-500 text-sm">
        Failed to load analytics. Make sure the backend is running.
      </div>
    );
  }

  const { stats, timeline, score_distribution, top_companies, top_keywords, status_breakdown, pipeline } = data;

  // Timeline chart — height of each bar relative to max
  const maxCount = Math.max(...timeline.map((d) => d.count), 1);

  // Show every 5th date label to avoid crowding
  const labelDates = new Set(
    timeline.filter((_, i) => i === 0 || i === 14 || i === 29).map((d) => d.date)
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      {/* header */}
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div>
          <h1 className="text-lg font-bold">Analytics & Insights</h1>
          <p className="text-[11px] text-zinc-500">Last 30 days · {dateRange}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* live indicator */}
          <span className="flex items-center gap-1.5 text-[10px] text-emerald-500 font-bold uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live
          </span>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">

        {/* ── top stats ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            label="Total Jobs"
            value={stats.total_jobs}
            sub={`${status_breakdown.pending} pending`}
            colorClass="text-indigo-400"
          />
          <StatCard
            label="Avg Match Score"
            value={stats.avg_match_score > 0 ? `${stats.avg_match_score}` : "—"}
            sub="semantic similarity"
            colorClass="text-purple-400"
          />
          <StatCard
            label="Resumes Tailored"
            value={stats.resumes_tailored}
            sub={`${stats.applications_sent} applied`}
            colorClass="text-amber-400"
          />
          <StatCard
            label="Applications Sent"
            value={stats.applications_sent}
            sub={stats.total_jobs > 0 ? `${Math.round(stats.applications_sent / stats.total_jobs * 100)}% conversion` : "—"}
            colorClass="text-emerald-400"
          />
        </div>

        {/* ── timeline + score distribution ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* timeline bar chart */}
          <div className="lg:col-span-2 bg-[#1A1A1A] border border-zinc-800 rounded-xl p-6">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">
              Jobs Ingested Over Time
            </div>
            {maxCount === 1 && timeline.every((d) => d.count === 0) ? (
              <div className="h-32 flex items-center justify-center text-zinc-600 text-xs">
                No data yet — ingest some jobs first
              </div>
            ) : (
              <>
                <div className="h-32 flex items-end gap-[3px]">
                  {timeline.map((d, i) => {
                    const heightPct = Math.max((d.count / maxCount) * 100, d.count > 0 ? 4 : 0);
                    const isRecent  = i >= 25;
                    return (
                      <div
                        key={d.date}
                        title={`${fmtDate(d.date)}: ${d.count} job${d.count !== 1 ? "s" : ""}`}
                        className={cn(
                          "flex-1 rounded-t-[2px] transition-all cursor-default",
                          d.count === 0 ? "bg-zinc-800/40" : isRecent ? "bg-indigo-500" : "bg-zinc-600"
                        )}
                        style={{ height: `${heightPct || 2}%` }}
                      />
                    );
                  })}
                </div>
                <div className="flex justify-between mt-2">
                  {timeline.filter((d) => labelDates.has(d.date)).map((d) => (
                    <span key={d.date} className="text-[10px] text-zinc-500">
                      {fmtDate(d.date)}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* score distribution */}
          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-xl p-6">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-5">
              Score Distribution
            </div>
            <div className="space-y-4">
              {score_distribution.map((item, i) => (
                <div key={item.range} className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-400">{item.range}</span>
                    <span className={cn("font-bold", SCORE_TEXT[i] ?? "text-zinc-400")}>
                      {item.count} job{item.count !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <div className="h-1.5 bg-zinc-900 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", SCORE_COLORS[i] ?? "bg-zinc-600")}
                      style={{ width: `${item.pct}%` }}
                    />
                  </div>
                </div>
              ))}
              {score_distribution.every((b) => b.count === 0) && (
                <p className="text-[11px] text-zinc-600 text-center pt-4">No scored jobs yet</p>
              )}
            </div>
          </div>
        </div>

        {/* ── bottom row ── */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

          {/* top companies */}
          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-xl p-6">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">
              Top Companies
            </div>
            {top_companies.length === 0 ? (
              <p className="text-[11px] text-zinc-600 text-center pt-6">No data</p>
            ) : (
              <div className="space-y-0">
                {top_companies.map((c, i) => (
                  <div
                    key={c.company}
                    className="flex justify-between items-center py-2 border-b border-zinc-800/50 last:border-0"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-zinc-600 font-bold w-4 shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-xs text-zinc-400 truncate max-w-[120px]">
                        {c.company}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-zinc-200">
                      {c.count}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* keyword gap analysis */}
          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-xl p-6">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">
              Keyword Gap Analysis
            </div>
            {top_keywords.length === 0 ? (
              <p className="text-[11px] text-zinc-600 text-center pt-6">
                Run tailoring on jobs to see keyword data
              </p>
            ) : (
              <div className="space-y-0">
                {top_keywords.map((kw) => {
                  const matchRate = kw.total > 0 ? Math.round((kw.present / kw.total) * 100) : 0;
                  const color =
                    matchRate >= 70
                      ? "text-emerald-400"
                      : matchRate >= 40
                      ? "text-amber-400"
                      : "text-rose-400";
                  return (
                    <div
                      key={kw.keyword}
                      className="flex justify-between items-center py-2 border-b border-zinc-800/50 last:border-0"
                    >
                      <span className="text-xs text-zinc-400 truncate max-w-[130px]" title={kw.keyword}>
                        {kw.keyword}
                      </span>
                      <span className={cn("text-xs font-bold", color)}>
                        {matchRate}% match
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* pipeline conversion */}
          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-xl p-6">
            <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-4">
              Pipeline Conversion
            </div>
            <div className="space-y-4">
              {pipeline.map((item, i) => (
                <div key={item.label} className="space-y-1">
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-zinc-500">{item.label}</span>
                    <span className={cn("text-[11px] font-bold", PIPELINE_COLORS[i]?.text ?? "text-zinc-400")}>
                      {item.value}%
                    </span>
                  </div>
                  <div className="h-1 bg-zinc-900 rounded-full overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all", PIPELINE_COLORS[i]?.bar ?? "bg-zinc-600")}
                      style={{ width: `${item.value}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* status breakdown pills */}
            <div className="mt-6 pt-4 border-t border-zinc-800/50">
              <div className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-3">
                Status breakdown
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "Pending",  value: status_breakdown.pending,  color: "text-zinc-400" },
                  { label: "Tailored", value: status_breakdown.tailored, color: "text-amber-400" },
                  { label: "Applied",  value: status_breakdown.applied,  color: "text-emerald-400" },
                  { label: "Skipped",  value: status_breakdown.skipped,  color: "text-zinc-600" },
                ].map((s) => (
                  <div key={s.label} className="bg-zinc-900/50 rounded-lg p-2 text-center">
                    <div className={cn("text-lg font-black", s.color)}>{s.value}</div>
                    <div className="text-[9px] text-zinc-600 uppercase tracking-wider font-bold">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
