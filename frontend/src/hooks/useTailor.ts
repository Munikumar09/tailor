import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

export const useTailorResume = (options?: { onSuccess?: (data: any) => void }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (job_id: number) => {
      const { data } = await api.post(`/tailor/${job_id}`);
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      if (options?.onSuccess) options.onSuccess(data);
    },
  });
};

export const useSaveTailoredBullets = (options?: { onSuccess?: (data: any) => void }) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ job_id, bullets }: { job_id: number; bullets: any[] }) => {
      const { data } = await api.post(`/tailor/${job_id}/save`, { bullets });
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      if (options?.onSuccess) options.onSuccess(data);
    },
  });
};
