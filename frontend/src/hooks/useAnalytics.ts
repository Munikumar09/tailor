import { useQuery } from "@tanstack/react-query";
import api from "@/lib/api";

export interface AnalyticsSummary {
  stats: {
    total_jobs: number;
    avg_match_score: number;
    resumes_tailored: number;
    applications_sent: number;
  };
  timeline: { date: string; count: number }[];
  score_distribution: { range: string; count: number; pct: number }[];
  top_companies: { company: string; count: number }[];
  top_keywords: {
    keyword: string;
    present: number;
    missing: number;
    total: number;
  }[];
  status_breakdown: {
    pending: number;
    tailored: number;
    applied: number;
    skipped: number;
  };
  pipeline: { label: string; value: number }[];
}

export const useAnalyticsSummary = () => {
  return useQuery<AnalyticsSummary>({
    queryKey: ["analytics-summary"],
    queryFn: async () => {
      const { data } = await api.get("/analytics/summary");
      return data;
    },
    refetchInterval: 30_000, // refresh every 30 s
    staleTime: 10_000,
  });
};
