import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

export type JobStatus = "Pending" | "Tailoring" | "Tailored" | "Applied" | "Skipped";

export interface Job {
  id: number;
  company_name: string;
  job_title: string;
  job_description: string;
  match_score: number;
  match_reason: string;
  tailored_match_score?: number;
  tailored_match_reason?: string;
  status: JobStatus;
  sub_status?: string;
  logs?: { msg: string; type: string; t: string }[];
  job_url: string;
  location: string;
  salary: string;
  tailored_resume_path: string | null;
  tailored_bullets: { old: string; new: string }[] | null;
  created_at: string;
}

export const useJobs = (status?: JobStatus) => {
  return useQuery<Job[]>({
    queryKey: ["jobs", status],
    queryFn: async () => {
      const { data } = await api.get("/jobs/", { params: { status } });
      return data;
    },
    // Poll every 3 seconds while on pages that use useJobs
    refetchInterval: 3000,
  });
};

export const useJob = (id: string | number) => {
  return useQuery<Job>({
    queryKey: ["job", id],
    queryFn: async () => {
      const { data } = await api.get(`/jobs/${id}`);
      return data;
    },
    enabled: !!id,
    // Poll every 2 seconds when looking at a specific job (e.g. status page)
    refetchInterval: 2000,
  });
};

export const useCleanupJobs = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.delete("/jobs/cleanup-duplicates");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
};

export const useUpdateJobStatus = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ job_id, status }: { job_id: number; status: JobStatus }) => {
      const { data } = await api.patch(`/jobs/${job_id}/status`, null, {
        params: { status },
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
};

export const useSyncWithMaster = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/jobs/sync-with-master");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
};
