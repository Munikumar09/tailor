"use client";

import React, { useState, useEffect } from "react";
import {
  Upload,
  Save,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Edit,
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
  useSaveResumeAST,
  ResumeParagraph,
} from "@/hooks/useProfile";

// ── helpers ──────────────────────────────────────────────────────────────────

function getParagraphClassName(p: ResumeParagraph): string {
  switch (p.style) {
    case "h1":
      return "mt-4 mb-1";
    case "h2":
      return "mt-5 mb-0.5 border-b border-gray-300";
    case "h3":
      return "mt-3 mb-0";
    case "bullet":
      return "flex gap-2 pl-4 my-0.5";
    default:
      return "my-0.5";
  }
}

function getParagraphDefaultStyle(p: ResumeParagraph): React.CSSProperties {
  // Only apply default font sizes when the run doesn't carry its own.
  // These fallbacks mirror common resume style conventions.
  switch (p.style) {
    case "h1": return { fontWeight: 700 };
    case "h2": return { fontWeight: 700 };
    case "h3": return { fontWeight: 600 };
    default:   return {};
  }
}

// ── page ─────────────────────────────────────────────────────────────────────

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

  useEffect(() => {
    if (selectedVersionId) {
      const ver = versions.find((v) => v.id === selectedVersionId);
      if (ver && !isEditing) setEditableText(ver.content);
    }
  }, [selectedVersionId, versions, isEditing]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadResumeMutation.mutate(file);
  };

  const handleSave = () => {
    if (Object.keys(modifications).length > 0) {
      saveASTMutation.mutate(modifications, {
        onSuccess: () => { setIsEditing(false); setModifications({}); },
      });
    } else if (editableText && editableText !== resumeContent?.text) {
      saveVersionMutation.mutate(editableText, {
        onSuccess: () => setIsEditing(false),
      });
    } else {
      setIsEditing(false);
    }
  };

  // Modifications are keyed by block ID (paragraph level), not run ID,
  // because export_mutated_docx replaces whole paragraphs.
  const handleBlockChange = (blockId: string, newText: string) => {
    setModifications((prev) => ({ ...prev, [blockId]: newText }));
  };

  const handleDeleteVersion = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    if (confirm("Are you sure you want to delete this version?")) {
      deleteVersionMutation.mutate(id);
    }
  };

  const handleExportVersion = (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    window.open(`http://localhost:8000/profile/resume-export/${id}`, "_blank");
  };

  if (isLoading || isLoadingText || isLoadingVersions || isLoadingAst) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  const hasAST = ast && ast.paragraphs && ast.paragraphs.length > 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#0F0F0F]">
      {/* ── top bar ── */}
      <header className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#1A1A1A]">
        <div
          className="cursor-pointer"
          onClick={() => !isEditing && setSelectedVersionId(undefined)}
        >
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
                disabled={
                  saveASTMutation.isPending ||
                  saveVersionMutation.isPending ||
                  (Object.keys(modifications).length === 0 &&
                    editableText === resumeContent?.text)
                }
                className="px-4 py-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-2"
              >
                {saveASTMutation.isPending || saveVersionMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Save Changes
              </button>
            </>
          )}
        </div>
      </header>

      {/* ── body ── */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

          {/* ── document panel ── */}
          <div className="lg:col-span-3">
            {/* status bar */}
            <div className="flex justify-between items-center mb-3 px-1">
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">
                {isEditing ? "Editing — click any text to change it" : "Preview"}
              </span>
              {(saveVersionMutation.isSuccess || saveASTMutation.isSuccess) && (
                <span className="text-[10px] text-emerald-500 font-bold flex items-center gap-1">
                  <CheckCircle2 size={12} /> Saved as new version
                </span>
              )}
            </div>

            {/* paper shadow wrapper */}
            <div className="flex justify-center">
              <div
                className={cn(
                  "w-full max-w-[816px] bg-white shadow-[0_4px_40px_rgba(0,0,0,0.5)] rounded-sm",
                  "transition-all duration-200",
                  isEditing && "ring-2 ring-indigo-500/40"
                )}
              >
                {hasAST ? (
                  /* ── structured AST rendering ── */
                  <div className="px-16 py-14 text-gray-900">
                    {ast.paragraphs.map((p) => {
                      const isBullet = p.style === "bullet";
                      const defaultStyle = getParagraphDefaultStyle(p);

                      return (
                        <div
                          key={p.id}
                          className={getParagraphClassName(p)}
                          style={defaultStyle}
                        >
                          {/* bullet glyph */}
                          {isBullet && (
                            <span className="select-none text-gray-600 mt-[2px] shrink-0">•</span>
                          )}

                          {/* runs */}
                          <span className={isBullet ? "flex-1" : undefined}>
                            {p.runs.map((r) => (
                              <span
                                key={r.id}
                                contentEditable={isEditing}
                                suppressContentEditableWarning
                                onBlur={(e) =>
                                  handleBlockChange(
                                    p.id,
                                    e.currentTarget.closest("[data-block]")
                                      ?.textContent ?? e.currentTarget.textContent ?? ""
                                  )
                                }
                                style={{
                                  fontSize: r.fontSize ? `${r.fontSize}pt` : undefined,
                                }}
                                className={cn(
                                  r.bold && "font-bold",
                                  r.italic && "italic",
                                  r.underline && "underline",
                                  isEditing &&
                                    "outline-none rounded-[2px] hover:bg-indigo-50 focus:bg-indigo-50 focus:ring-1 focus:ring-indigo-300 px-[1px] transition-colors"
                                )}
                              >
                                {r.text}
                              </span>
                            ))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* ── plain-text fallback ── */
                  <div className="px-16 py-14">
                    <textarea
                      value={editableText}
                      onChange={(e) => setEditableText(e.target.value)}
                      readOnly={!isEditing}
                      className="w-full bg-transparent border-none focus:ring-0 resize-none min-h-[700px] text-gray-900 font-mono text-sm leading-relaxed"
                      placeholder="Upload a .docx to preview your resume here…"
                    />
                  </div>
                )}
              </div>
            </div>

            {resumeContent?.error && (
              <div className="flex items-center gap-2 text-amber-500 text-[10px] font-bold uppercase mt-3 px-1">
                <AlertCircle size={14} /> {resumeContent.error}
              </div>
            )}
          </div>

          {/* ── sidebar ── */}
          <div className="space-y-6">
            {/* version history */}
            <div className="bg-[#1A1A1A] border border-zinc-800 rounded-2xl p-5 space-y-4">
              <h3 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">
                Version History
              </h3>
              <div className="space-y-2">
                {versions.map((ver) => {
                  const isActive =
                    selectedVersionId === ver.id ||
                    (!selectedVersionId && ver.is_current);
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
                        isActive
                          ? "bg-indigo-500/5 border border-indigo-500/20"
                          : "bg-zinc-900/50 border border-zinc-800/50"
                      )}
                    >
                      <div
                        className={cn(
                          "w-8 h-8 rounded-lg border flex items-center justify-center text-[10px] font-black shrink-0",
                          isActive
                            ? "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
                            : "bg-zinc-800 border-zinc-700 text-zinc-500"
                        )}
                      >
                        {ver.is_current ? "NOW" : "VER"}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[11px] font-bold text-zinc-300 truncate">
                          {ver.version_label}
                        </div>
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
