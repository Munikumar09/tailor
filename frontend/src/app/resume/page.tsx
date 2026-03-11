"use client";

import React, { useState, useEffect } from "react";
import { 
  FileText, 
  Upload, 
  Save, 
  History, 
  Download, 
  CheckCircle2, 
  AlertCircle,
  Loader2,
  Edit,
  RefreshCw,
  Trash2
} from "lucide-react";
import { cn } from "@/lib/utils";
import { 
  useProfile, 
  useUploadResume, 
  useResumeText, 
  useResumeVersions, 
  useSaveResumeVersion, 
  useDeleteResumeVersion,
  useResumeAST,
  useSaveResumeAST
} from "@/hooks/useProfile";

export default function MasterResumePage() {
  const { data: profile, isLoading } = useProfile();
  const { data: resumeContent, isLoading: isLoadingText } = useResumeText();
  const { data: versions = [], isLoading: isLoadingVersions } = useResumeVersions();
  
  const [selectedVersionId, setSelectedVersionId] = useState<number | undefined>(undefined);
  const { data: ast, isLoading: isLoadingAst } = useResumeAST(selectedVersionId);
  
  const uploadResumeMutation = useUploadResume();
  const saveVersionMutation = useSaveResumeVersion();
  const saveASTMutation = useSaveResumeAST();
  const deleteVersionMutation = useDeleteResumeVersion();

  const [editableText, setEditableText] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [modifications, setModifications] = useState<Record<string, string>>({});

  useEffect(() => {
    if (resumeContent?.text && !isEditing && !selectedVersionId) {
      setEditableText(resumeContent.text);
      setModifications({});
    }
  }, [resumeContent, isEditing, selectedVersionId]);

  // Fallback for when we select a version that doesn't have an AST (or before AST loads)
  useEffect(() => {
    if (selectedVersionId) {
      const ver = versions.find(v => v.id === selectedVersionId);
      if (ver && !isEditing) {
        setEditableText(ver.content);
      }
    }
  }, [selectedVersionId, versions, isEditing]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadResumeMutation.mutate(file);
    }
  };

  const handleSave = () => {
    if (Object.keys(modifications).length > 0) {
      saveASTMutation.mutate(modifications, {
        onSuccess: () => {
          setIsEditing(false);
          setModifications({});
        }
      });
    } else if (editableText && editableText !== resumeContent?.text) {
      // Fallback to text save if no structured modifications but text changed
      saveVersionMutation.mutate(editableText, {
        onSuccess: () => setIsEditing(false)
      });
    } else {
      setIsEditing(false);
    }
  };

  const handleRunChange = (runId: string, newText: string) => {
    setModifications(prev => ({
      ...prev,
      [runId]: newText
    }));
  };

  const handleDeleteVersion = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this version?")) {
      deleteVersionMutation.mutate(id);
    }
  };

  const handleExportVersion = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    window.open(`http://localhost:8000/profile/resume-export/${id}`, '_blank');
  };

  if (isLoading || isLoadingText || isLoadingVersions || isLoadingAst) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div className="cursor-pointer" onClick={() => !isEditing && setSelectedVersionId(undefined)}>
          <h1 className="text-lg font-bold">Master Resume</h1>
          <p className="text-[11px] text-zinc-500">Base document for all tailored versions</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="cursor-pointer px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2">
            <Upload size={14} />
            Replace File
            <input type="file" className="hidden" accept=".docx" onChange={handleFileUpload} />
          </label>
          
          {!isEditing ? (
            <button 
              onClick={() => setIsEditing(true)}
              className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold transition-colors flex items-center gap-2"
            >
              <Edit size={14} />
              Edit Content
            </button>
          ) : (
            <>
              <button 
                onClick={() => {
                  setIsEditing(false);
                  setEditableText(resumeContent?.text || "");
                  setModifications({});
                }}
                className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-500 rounded-lg text-xs font-semibold transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={handleSave}
                disabled={saveASTMutation.isPending || saveVersionMutation.isPending || (Object.keys(modifications).length === 0 && editableText === resumeContent?.text)}
                className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-2"
              >
                {(saveASTMutation.isPending || saveVersionMutation.isPending) ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Changes
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Main Resume Preview Area */}
          <div className="lg:col-span-3 space-y-6">
            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl min-h-[800px] p-12 shadow-2xl relative overflow-hidden">
              <div className="max-w-3xl mx-auto space-y-8">
                <div className="border-b border-zinc-800 pb-8 flex justify-between items-start">
                  <div>
                    <h2 className="text-3xl font-black tracking-tight">{profile?.full_name || "Your Name"}</h2>
                    <p className="text-indigo-400 font-medium mt-1">{profile?.current_title || "Professional Title"}</p>
                    <div className="flex gap-4 mt-4 text-[11px] text-zinc-500 font-bold uppercase tracking-widest">
                      <span>San Francisco, CA</span>
                      <span>{profile?.linkedin_url || "linkedin.com/in/alexchen"}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <h3 className="text-xs font-black uppercase tracking-[0.2em] text-zinc-500">
                      Extracted Content {isEditing ? "(Editing mode)" : "(Read-only)"}
                    </h3>
                    {(saveVersionMutation.isSuccess || saveASTMutation.isSuccess) && (
                      <span className="text-[10px] text-emerald-500 font-bold flex items-center gap-1 animate-in fade-in duration-500">
                        <CheckCircle2 size={12} /> Saved as new version
                      </span>
                    )}
                  </div>
                  
                  <div className={cn(
                    "w-full rounded-xl p-8 text-sm focus:outline-none transition-all min-h-[600px] leading-relaxed whitespace-pre-wrap",
                    isEditing 
                      ? "bg-zinc-900/50 border border-indigo-500/50 text-zinc-100 ring-1 ring-indigo-500/20" 
                      : "bg-zinc-900/20 border border-zinc-800 text-zinc-400 cursor-default"
                  )}>
                    {ast && ast.paragraphs && ast.paragraphs.length > 0 ? (
                      <div className="space-y-2">
                        {ast.paragraphs.map(p => (
                          <div key={p.id} className={cn("min-h-[1.5em]", p.style?.includes("Heading") && "text-lg font-bold text-zinc-200 mt-4 mb-2")}>
                            {p.runs.map(r => (
                              <span 
                                key={r.id}
                                contentEditable={isEditing}
                                suppressContentEditableWarning
                                onBlur={(e) => handleRunChange(r.id, e.currentTarget.textContent || "")}
                                className={cn(
                                  r.bold && "font-bold",
                                  r.italic && "italic",
                                  isEditing && "hover:bg-zinc-800/80 outline-none rounded-sm px-0.5 transition-colors focus:bg-zinc-800 focus:text-white"
                                )}
                              >
                                {r.text}
                              </span>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <textarea 
                        value={editableText}
                        onChange={(e) => setEditableText(e.target.value)}
                        readOnly={!isEditing}
                        className="w-full bg-transparent border-none focus:ring-0 resize-none min-h-[500px] font-mono"
                        placeholder="Upload a .docx to see extracted content here..."
                      />
                    )}
                  </div>

                  {resumeContent?.error && (
                    <div className="flex items-center gap-2 text-amber-500 text-[10px] font-bold uppercase mt-2">
                      <AlertCircle size={14} /> {resumeContent.error}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar Info */}
          <div className="space-y-6">
            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Resume Health</h3>
              <div className="space-y-3">
                {[
                  { label: "ATS Score", value: "87/100", color: "text-emerald-400" },
                  { label: "Keyword Density", value: "Medium", color: "text-amber-400" },
                  { label: "Bullet Strength", value: "High", color: "text-emerald-400" },
                  { label: "Length", value: "1.8 pages", color: "text-indigo-400" },
                ].map((stat) => (
                  <div key={stat.label} className="flex justify-between items-center py-3 border-b border-zinc-800/50 last:border-0">
                    <span className="text-[11px] text-zinc-500 font-medium">{stat.label}</span>
                    <span className={cn("text-[11px] font-bold", stat.color)}>{stat.value}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Version History</h3>
              <div className="space-y-2">
                {versions.map((ver) => {
                  const isActive = selectedVersionId === ver.id || (!selectedVersionId && ver.is_current);
                  return (
                    <div 
                      key={ver.id} 
                      onClick={() => {
                        if (!isEditing) {
                          setSelectedVersionId(ver.id);
                          setModifications({});
                        }
                      }}
                      className={cn(
                        "flex items-center gap-3 p-2.5 rounded-xl hover:bg-zinc-800/50 transition-colors cursor-pointer group",
                        isActive ? "bg-indigo-500/5 border border-indigo-500/20" : "bg-zinc-900/50 border border-zinc-800/50"
                      )}
                    >
                      <div className={cn(
                        "w-8 h-8 rounded-lg border flex items-center justify-center text-[10px] font-black shrink-0",
                        isActive ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400" : "bg-zinc-800 border-zinc-700 text-zinc-500"
                      )}>
                        {ver.is_current ? "NOW" : "VER"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-zinc-300 truncate">{ver.version_label}</div>
                        <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-tighter">
                          {new Date(ver.created_at).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button 
                          onClick={(e) => handleExportVersion(e, ver.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-emerald-500/10 hover:text-emerald-500 rounded text-zinc-500"
                          title="Export as .docx"
                        >
                          <Download size={12} />
                        </button>
                        <button 
                          onClick={(e) => handleDeleteVersion(e, ver.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-red-500/10 hover:text-red-500 rounded text-zinc-500"
                          title="Delete version"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {versions.length === 0 && (
                  <div className="text-[10px] text-zinc-600 text-center py-4 font-bold uppercase tracking-widest">
                    No versions yet
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
