"use client";

import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { Settings as SettingsIcon, Brain, Key, Mail, Shield, Trash2 } from "lucide-react";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState("General");

  const tabs = [
    { icon: SettingsIcon, label: "General" },
    { icon: Brain, label: "AI Models" },
    { icon: Key, label: "API Keys" },
    { icon: Mail, label: "Email Alerts" },
    { icon: Shield, label: "Security" },
    { icon: Trash2, label: "Data & Privacy" },
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div>
          <h1 className="text-lg font-bold">Settings</h1>
          <p className="text-[11px] text-zinc-500">Manage your account and pipeline configuration</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex flex-col md:flex-row gap-6 max-w-5xl mx-auto">
          {/* Sidebar Tabs */}
          <div className="w-full md:w-56 flex flex-col gap-1 shrink-0">
            {tabs.map((tab) => {
              const active = activeTab === tab.label;
              return (
                <button
                  key={tab.label}
                  onClick={() => setActiveTab(tab.label)}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm transition-all text-left",
                    active 
                      ? "bg-indigo-500/10 border border-indigo-500/30 text-indigo-400 font-semibold" 
                      : "text-zinc-500 hover:bg-zinc-900 border border-transparent hover:text-zinc-300"
                  )}
                >
                  <tab.icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="flex-1 space-y-6">
            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-6">
              <h2 className="text-sm font-bold mb-6">General Settings</h2>
              <div className="space-y-4">
                {[
                  ["Default LLM Model (Filtering)", "Gemini 1.5 Flash"],
                  ["Default LLM Model (Tailoring)", "Gemini Flash Latest"],
                  ["Output Format", "DOCX (Recommended)"],
                  ["Timezone", "America/Los_Angeles"],
                  ["Language", "English (US)"]
                ].map(([label, value], i) => (
                  <div key={label} className="flex justify-between items-center py-3 border-b border-zinc-800/50 last:border-0">
                    <span className="text-xs text-zinc-300">{label}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-xs text-zinc-500">{value}</span>
                      <button className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-[10px] font-semibold transition-colors">
                        Change
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-6">
              <h2 className="text-sm font-bold mb-6">Notifications</h2>
              <div className="space-y-4">
                {[
                  ["New high-scoring job (≥85)", true],
                  ["Ingestion run complete", true],
                  ["Resume tailoring done", true],
                  ["Weekly pipeline summary", false],
                  ["Application reminders", false]
                ].map(([label, on], i) => (
                  <div key={label as string} className="flex justify-between items-center py-3 border-b border-zinc-800/50 last:border-0">
                    <span className="text-xs text-zinc-300">{label as string}</span>
                    <button className={cn(
                      "w-10 h-5 rounded-full relative transition-colors duration-300",
                      on ? "bg-indigo-500" : "bg-zinc-800"
                    )}>
                      <div className={cn(
                        "w-3.5 h-3.5 bg-white rounded-full absolute top-[3px] transition-all duration-300 shadow-sm",
                        on ? "left-[22px]" : "left-[3px]"
                      )} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-3 pt-4">
              <button className="px-5 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-xs font-bold transition-colors">
                Save Changes
              </button>
              <button className="px-5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-colors">
                Reset Defaults
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
