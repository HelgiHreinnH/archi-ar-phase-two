import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/hooks/useProjects";
import { countFreeModels, quotaState, type Plan, type QuotaState } from "@/lib/plans";

/**
 * The signed-in account's plan (profiles.plan, migration 009) and its
 * Tabletop/Wall quota. Read-only: plans are changed by Archi AR, never the client.
 */
export function usePlan(): { plan: Plan; isLoading: boolean; quota: QuotaState } {
  const { user } = useAuth();
  const { projects, isLoading: projectsLoading } = useProjects();

  const planQuery = useQuery({
    queryKey: ["plan", user?.id],
    queryFn: async (): Promise<Plan> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("plan")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data?.plan === "paid" ? "paid" : "free";
    },
    enabled: !!user,
    staleTime: 60_000,
  });

  const plan: Plan = planQuery.data ?? "free";
  return {
    plan,
    isLoading: planQuery.isLoading || projectsLoading,
    quota: quotaState(plan, countFreeModels(projects)),
  };
}
