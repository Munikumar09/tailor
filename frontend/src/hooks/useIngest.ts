import { useMutation, useQueryClient } from "@tanstack/react-query";
import api from "@/lib/api";

export const useTriggerIngestion = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { data } = await api.post("/ingest/");
      return data;
    },
    onSuccess: () => {
      // Invalidate jobs to refresh the list once ingestion completes
      // Though ingestion is async in background, we might want to poll or just refresh later
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["jobs"] });
      }, 5000); // Give it some time to start processing
    },
  });
};
