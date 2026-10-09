import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import modelProxyService, { type ModelProxyForm } from "../services/model-proxy";
import { clearWalrus, memorySession, saveWalrus, type SaveWalrusInput } from "../services/wallet-recall";

/** Shared keys so Integrations, Settings, the sidebar and chat refresh together. */
export const integrationKeys = {
  memory: ["builder", "memory-session"] as const,
  modelProxy: ["builder", "model-proxy"] as const,
};

export function useMemorySession() {
  return useQuery({ queryKey: integrationKeys.memory, queryFn: memorySession, staleTime: 15_000 });
}

export function useModelProxyStatus() {
  return useQuery({ queryKey: integrationKeys.modelProxy, queryFn: modelProxyService.status, staleTime: 15_000 });
}

export function useSaveModelProxy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ form, test }: { form: ModelProxyForm; test: boolean }) => modelProxyService.save(form, test),
    onSuccess: (status) => client.setQueryData(integrationKeys.modelProxy, status),
  });
}

export function useTestModelProxy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: modelProxyService.test,
    onSuccess: (status) => client.setQueryData(integrationKeys.modelProxy, status),
  });
}

export function useDisconnectModelProxy() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: modelProxyService.disconnect,
    onSuccess: (status) => client.setQueryData(integrationKeys.modelProxy, status),
  });
}

export function useSaveMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveWalrusInput) => saveWalrus(input),
    onSettled: () => client.invalidateQueries({ queryKey: integrationKeys.memory }),
  });
}

export function useDisconnectMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: clearWalrus,
    onSettled: () => client.invalidateQueries({ queryKey: integrationKeys.memory }),
  });
}

/** After a chat call reveals that a connection changed, refresh its card. */
export function useRefreshIntegrations() {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: integrationKeys.memory });
    void client.invalidateQueries({ queryKey: integrationKeys.modelProxy });
  };
}

/** Model IDs exactly as the proxy's /models endpoint returns them (no billable call). */
export function useProxyModels(enabled: boolean, baseUrl: string | null | undefined) {
  return useQuery({
    // The list belongs to one saved base URL; a different URL must never reuse it.
    queryKey: [...integrationKeys.modelProxy, "models", baseUrl ?? null],
    queryFn: () => modelProxyService.models(),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}
