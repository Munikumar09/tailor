"use client";

import React from "react";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

export default function BillingPage() {
  const plans = [
    { plan: "Free", price: "$0", features: ["10 jobs/month", "Basic filtering", "Manual tailoring"], current: false, cta: "Current Plan" },
    { plan: "Pro", price: "$19/mo", features: ["Unlimited jobs", "AI filtering", "Auto tailoring", "Priority support"], current: true, cta: "Current Plan" },
    { plan: "Team", price: "$49/mo", features: ["5 users", "Shared pipelines", "API access", "Custom models"], current: false, cta: "Upgrade" }
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div>
          <h1 className="text-lg font-bold">Billing & Plan</h1>
          <p className="text-[11px] text-zinc-500">Manage your subscription</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((p) => (
            <div key={p.plan} className={cn(
              "bg-[#1A1A1A] rounded-2xl p-6 relative flex flex-col",
              p.current ? "border-2 border-indigo-500" : "border border-zinc-800"
            )}>
              {p.current && (
                <div className="absolute -top-3 right-6 bg-indigo-500 text-white text-[9px] font-bold px-3 py-1 rounded-full uppercase tracking-widest shadow-lg shadow-indigo-500/20">
                  Current
                </div>
              )}
              <h2 className="text-lg font-bold text-zinc-200 mb-1">{p.plan}</h2>
              <div className={cn("text-3xl font-black mb-6", p.current ? "text-indigo-400" : "text-zinc-100")}>{p.price}</div>
              
              <div className="space-y-3 mb-8 flex-1">
                {p.features.map(f => (
                  <div key={f} className="flex items-center gap-3">
                    <Check size={14} className="text-emerald-500" />
                    <span className="text-xs text-zinc-400">{f}</span>
                  </div>
                ))}
              </div>

              <button className={cn(
                "w-full py-2.5 rounded-xl text-xs font-bold transition-colors",
                !p.current && p.cta === "Upgrade" ? "bg-indigo-500 hover:bg-indigo-600 text-white" :
                "bg-zinc-800 text-zinc-500 cursor-not-allowed"
              )}>
                {p.cta}
              </button>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-6">
            <h2 className="text-sm font-bold mb-6">Payment Method</h2>
            <div className="flex items-center justify-between p-4 bg-zinc-900 rounded-xl border border-zinc-800 mb-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-8 bg-[#1A1FE8] rounded flex items-center justify-center text-[10px] font-bold text-white tracking-widest">
                  VISA
                </div>
                <div>
                  <div className="text-xs font-bold">•••• •••• •••• 4242</div>
                  <div className="text-[10px] text-zinc-500">Expires 12/27</div>
                </div>
              </div>
              <button className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-[10px] font-semibold transition-colors">
                Change
              </button>
            </div>
            <button className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-colors border border-dashed border-zinc-600">
              + Add Payment Method
            </button>
          </div>

          <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-6">
            <h2 className="text-sm font-bold mb-6">Usage This Month</h2>
            <div className="space-y-4">
              {[
                ["Jobs Ingested", "247 / ∞"],
                ["Tailoring Runs", "34 / ∞"],
                ["LLM Tokens Used", "1.2M / ∞"],
                ["API Calls", "892 / ∞"]
              ].map(([label, val]) => (
                <div key={label} className="flex justify-between items-center py-2 border-b border-zinc-800/50 last:border-0">
                  <span className="text-xs text-zinc-400">{label}</span>
                  <span className="text-xs font-bold text-zinc-200">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
