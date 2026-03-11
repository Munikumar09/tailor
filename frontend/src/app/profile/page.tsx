"use client";

import React, { useState, useEffect } from "react";
import { 
  User, 
  Settings, 
  CheckCircle2, 
  Loader2,
  DollarSign,
  Trophy
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useProfile, useUpdateProfile } from "@/hooks/useProfile";

const SectionTitle = ({ children, icon: Icon }: any) => (
  <div className="flex items-center gap-2 mb-6 text-zinc-400">
    <Icon size={18} />
    <h2 className="text-xs font-bold uppercase tracking-widest">{children}</h2>
  </div>
);

const Input = ({ label, ...props }: any) => (
  <div className="space-y-1.5 flex-1">
    <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-tight ml-1">{label}</label>
    <input
      {...props}
      className="w-full bg-[#1A1A1A] border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-zinc-600"
    />
  </div>
);

export default function ProfilePage() {
  const { data: profile, isLoading } = useProfile();
  const updateProfileMutation = useUpdateProfile();
  
  const [formData, setFormData] = useState<any>({
    full_name: "",
    current_title: "",
    years_of_experience: "",
    linkedin_url: "",
    preferred_work_mode: "Remote",
    min_salary: 100000,
    min_ai_score: 75,
    ingestion_frequency: "Every 6h",
  });

  useEffect(() => {
    if (profile) {
      setFormData({
        ...profile,
        // Handle potentially missing fields
        full_name: profile.full_name || "",
        current_title: profile.current_title || "",
        years_of_experience: profile.years_of_experience || "",
        linkedin_url: profile.linkedin_url || "",
        preferred_work_mode: profile.preferred_work_mode || "Remote",
        min_salary: profile.min_salary || 100000,
        min_ai_score: profile.min_ai_score || 75,
        ingestion_frequency: profile.ingestion_frequency || "Every 6h",
      });
    }
  }, [profile]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateProfileMutation.mutate(formData);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div>
          <h1 className="text-lg font-bold">User Profile</h1>
          <p className="text-[11px] text-zinc-500">Personal details & preferences</p>
        </div>
        <button 
          onClick={handleSubmit}
          disabled={updateProfileMutation.isPending}
          className="flex items-center gap-2 px-6 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors"
        >
          {updateProfileMutation.isPending && <Loader2 size={14} className="animate-spin" />}
          Save Profile
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-8 max-w-4xl mx-auto w-full space-y-12 pb-20">
        {/* Personal Information */}
        <section>
          <SectionTitle icon={User}>Personal Information</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#1A1A1A] border border-zinc-800 p-8 rounded-2xl">
            <Input label="Full Name" name="full_name" value={formData.full_name} onChange={handleInputChange} placeholder="Alex Chen" />
            <Input label="Current Title" name="current_title" value={formData.current_title} onChange={handleInputChange} placeholder="Senior Frontend Engineer" />
            <Input label="Experience (Years)" name="years_of_experience" value={formData.years_of_experience} onChange={handleInputChange} placeholder="7" />
            <Input label="LinkedIn URL" name="linkedin_url" value={formData.linkedin_url} onChange={handleInputChange} placeholder="linkedin.com/in/alexchen" />
          </div>
        </section>

        {/* Job Preferences */}
        <section>
          <SectionTitle icon={Settings}>Job Search Preferences</SectionTitle>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#1A1A1A] border border-zinc-800 p-8 rounded-2xl">
            <div className="space-y-1.5 flex-1">
              <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-tight ml-1">Work Mode</label>
              <select 
                name="preferred_work_mode" 
                value={formData.preferred_work_mode} 
                onChange={handleInputChange}
                className="w-full bg-[#1A1A1A] border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
              >
                <option value="Remote">Remote</option>
                <option value="Hybrid">Hybrid</option>
                <option value="On-site">On-site</option>
                <option value="Any">Any</option>
              </select>
            </div>
            
            <Input label="Min Salary (USD)" name="min_salary" type="number" value={formData.min_salary} onChange={handleInputChange} icon={DollarSign} />
            <Input label="Min AI Fit Score (0-100)" name="min_ai_score" type="number" value={formData.min_ai_score} onChange={handleInputChange} icon={Trophy} />
            
            <div className="space-y-1.5 flex-1">
              <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-tight ml-1">Ingestion Frequency</label>
              <select 
                name="ingestion_frequency" 
                value={formData.ingestion_frequency} 
                onChange={handleInputChange}
                className="w-full bg-[#1A1A1A] border border-zinc-800 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
              >
                <option value="Every 3h">Every 3h</option>
                <option value="Every 6h">Every 6h</option>
                <option value="Every 12h">Every 12h</option>
                <option value="Daily">Daily</option>
              </select>
            </div>
          </div>
        </section>
        
        {updateProfileMutation.isSuccess && (
          <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 p-4 rounded-xl flex items-center gap-3 text-sm">
            <CheckCircle2 size={18} />
            Profile updated successfully.
          </div>
        )}
      </div>
    </div>
  );
}
