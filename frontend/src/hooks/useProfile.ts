import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

export interface UserProfile {
  id?: number;
  full_name: string;
  current_title: string;
  years_of_experience: string;
  skills?: string[];
  resume_path?: string;
  linkedin_url?: string;
  preferred_work_mode?: string;
  min_salary?: number;
  min_ai_score: number;
  ingestion_frequency: string;
}

export const useProfile = () => {
  return useQuery<UserProfile>({
    queryKey: ["profile"],
    queryFn: async () => {
      const { data } = await api.get("/profile/");
      return data;
    },
  });
};

export const useResumeText = () => {
  return useQuery<{ text: string; error?: string }>({
    queryKey: ["resume-text"],
    queryFn: async () => {
      const { data } = await api.get("/profile/resume-text");
      return data;
    },
  });
};

export interface ResumeRun {
  id: string;
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  fontSize: number | null;
}

export interface ResumeParagraph {
  id: string;
  /** "h1" | "h2" | "h3" | "bullet" | "paragraph" */
  style: string;
  ilvl: number;
  runs: ResumeRun[];
}

export interface ResumeAST {
  paragraphs: ResumeParagraph[];
}

export const useResumeAST = (versionId?: number) => {
  return useQuery<ResumeAST>({
    queryKey: ["resume-ast", versionId],
    queryFn: async () => {
      const { data } = await api.get("/profile/resume-ast", {
        params: { version_id: versionId },
      });
      return data;
    },
  });
};

export interface ResumeVersion {
  id: number;
  version_label: string;
  content: string;
  file_path: string;
  created_at: string;
  is_current: boolean;
}

export const useResumeVersions = () => {
  return useQuery<ResumeVersion[]>({
    queryKey: ["resume-versions"],
    queryFn: async () => {
      const { data } = await api.get("/profile/resume-versions");
      return data;
    },
  });
};

export const useSaveResumeAST = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (modifications: Record<string, string>) => {
      const { data } = await api.post("/profile/resume-save-ast", { modifications });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resume-ast"] });
      queryClient.invalidateQueries({ queryKey: ["resume-text"] });
      queryClient.invalidateQueries({ queryKey: ["resume-versions"] });
    },
  });
};

export const useSaveResumeVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (content: string) => {
      const { data } = await api.post("/profile/resume-save", { content });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resume-text"] });
      queryClient.invalidateQueries({ queryKey: ["resume-versions"] });
      queryClient.invalidateQueries({ queryKey: ["resume-ast"] });
    },
  });
};

export const useDeleteResumeVersion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: number) => {
      const { data } = await api.delete(`/profile/resume-version/${id}`);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resume-versions"] });
      queryClient.invalidateQueries({ queryKey: ["resume-text"] });
      queryClient.invalidateQueries({ queryKey: ["resume-ast"] });
    },
  });
};

export const useUpdateProfile = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profile: UserProfile) => {
      const { data } = await api.post("/profile/", profile);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
};

export const useExtractResumeSections = () => {
  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post("/profile/resume-extract-sections", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      return data as Record<string, unknown>;
    },
  });
};

export const useBuildResume = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { form_data: Record<string, unknown>; template: string }) => {
      const { data } = await api.post("/profile/resume-build", payload);
      return data as ResumeVersion;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resume-versions"] });
    },
  });
};

export const useSetCurrentResume = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (versionId: number) => {
      const { data } = await api.post(`/profile/resume-set-current/${versionId}`);
      return data as ResumeVersion;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["resume-versions"] });
      queryClient.invalidateQueries({ queryKey: ["resume-text"] });
      queryClient.invalidateQueries({ queryKey: ["resume-ast"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
};

export const useUploadResume = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const { data } = await api.post("/profile/resume", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      queryClient.invalidateQueries({ queryKey: ["resume-text"] });
      queryClient.invalidateQueries({ queryKey: ["resume-versions"] });
      queryClient.invalidateQueries({ queryKey: ["resume-ast"] });
    },
  });
};
