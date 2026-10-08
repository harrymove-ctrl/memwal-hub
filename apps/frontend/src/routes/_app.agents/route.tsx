import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Download, KeyRound, MoreHorizontal } from "lucide-react";
import { useNavigate } from "react-router";

import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Flex from "@/components/ui/flex";
import { useWorkspaceSession } from "@/components/workspace-shell/workspace-shell-session-context";
import AgentsConnectDialog from "@/components/agents-connect-dialog";
import agentConnectionsService, {
  AgentConnectionServiceError,
  type AgentConnection,
} from "@/services/agent-connections";
import agentPoolsService, {
  AgentPoolServiceError,
  type AgentPool,
  type AgentPoolRequestStatus,
} from "@/services/agent-pools";
import organizationsService from "@/services/organizations";
import playgroundService from "@/services/playground";

import AgentsExplorer from "./agents-explorer";
import AgentsRequestDialog, {
  type RequestFormValues,
} from "./agents-request-dialog";
import AgentsRequestsDialog from "./agents-requests-dialog";
import AgentsGatewayKeyDialog from "./agents-gateway-key-dialog";

interface RequestJoinVariables {
  poolId: string;
  values: RequestFormValues;
}

interface DecideRequestVariables {
  requestId: string;
  status: Exclude<AgentPoolRequestStatus, "pending">;
}

interface PoolMemberVariables {
  poolId: string;
  username: string;
}

export default function AgentsRoute() {
  const navigate = useNavigate();
  const session = useWorkspaceSession();
  const queryClient = useQueryClient();
  const [requestPoolId, setRequestPoolId] = useState<string | null>(null);
  const [reviewPoolId, setReviewPoolId] = useState<string | null>(null);
  const [gatewayKeyOpen, setGatewayKeyOpen] = useState(false);
  const refreshAgentData = useCallback(
    () =>
      Promise.all(
        [
          agentPoolsService.queryKey,
          agentConnectionsService.queryKey,
          organizationsService.queryKey,
          playgroundService.queryKey,
        ].map((queryKey) =>
          queryClient.invalidateQueries({
            queryKey,
            // Completion polling already supplied the fresh connection. Refetching
            // it here would trigger onRefreshComplete and invalidate it forever.
            predicate: (query) =>
              query.queryKey[1] !== "refresh-status" &&
              query.queryKey[1] !== "status",
          }),
        ),
      ),
    [queryClient],
  );
  const poolsQuery = useQuery({
    enabled: session.status !== "loading",
    queryFn: agentPoolsService.list,
    queryKey: [...agentPoolsService.queryKey, session.user?.id ?? "guest"],
  });
  const requestMutation = useMutation({
    mutationFn: ({ poolId, values }: RequestJoinVariables) =>
      agentPoolsService.requestJoin(poolId, values),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentPoolsService.queryKey }),
  });
  const decisionMutation = useMutation({
    mutationFn: ({ requestId, status }: DecideRequestVariables) =>
      agentPoolsService.decide(requestId, status),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentPoolsService.queryKey }),
  });
  const inviteMutation = useMutation({
    mutationFn: ({ poolId, username }: PoolMemberVariables) =>
      agentPoolsService.invite(poolId, username),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentPoolsService.queryKey }),
  });
  const removeMemberMutation = useMutation({
    mutationFn: ({ poolId, username }: PoolMemberVariables) =>
      agentPoolsService.removeMember(poolId, username),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: agentPoolsService.queryKey }),
  });
  const refreshMutation = useMutation({
    mutationFn: (poolId: string) => agentConnectionsService.refresh(poolId),
    onSuccess: refreshAgentData,
  });
  const deletePoolMutation = useMutation({
    mutationFn: (poolId: string) => agentConnectionsService.disconnect(poolId),
    onSuccess: async () => {
      setReviewPoolId(null);
      await refreshAgentData();
    },
  });
  const pools = poolsQuery.data ?? [];
  const requestPool = pools.find((pool) => pool.id === requestPoolId) ?? null;
  const reviewPool =
    pools.find(
      (pool) =>
        pool.id === reviewPoolId &&
        pool.owner.username === session.user?.username,
    ) ?? null;
  const routeError =
    poolsQuery.error ??
    decisionMutation.error ??
    removeMemberMutation.error ??
    deletePoolMutation.error ??
    refreshMutation.error;
  const errorMessage = routeError
    ? routeError instanceof AgentPoolServiceError ||
      routeError instanceof AgentConnectionServiceError
      ? routeError.message
      : "The account pools could not be loaded."
    : null;

  function requestJoin(pool: AgentPool) {
    if (!session.user) {
      session.openAuth();
      return;
    }

    setRequestPoolId(pool.id);
  }

  async function submitRequest(values: RequestFormValues) {
    if (!session.user || !requestPool) return;

    await requestMutation.mutateAsync({ poolId: requestPool.id, values });
    setRequestPoolId(null);
  }

  async function decideRequest(
    requestId: string,
    status: Exclude<AgentPoolRequestStatus, "pending">,
  ) {
    if (!reviewPool) return;
    decisionMutation.mutate({ requestId, status });
  }

  async function inviteMember(username: string) {
    if (!reviewPool) return;
    await inviteMutation.mutateAsync({ poolId: reviewPool.id, username });
  }

  async function removeMember(username: string) {
    if (!reviewPool) return;
    await removeMemberMutation.mutateAsync({
      poolId: reviewPool.id,
      username,
    });
  }

  async function refreshPool(): Promise<AgentConnection> {
    if (!reviewPool) {
      throw new AgentConnectionServiceError("Select a pool to refresh.");
    }
    return refreshMutation.mutateAsync(reviewPool.id);
  }

  async function deletePool() {
    if (!reviewPool) return;
    await deletePoolMutation.mutateAsync(reviewPool.id);
  }

  const refreshPoolData = useCallback(
    (connection: AgentConnection) => {
      queryClient.setQueryData(
        [
          ...agentConnectionsService.queryKey,
          "pool-availability",
          connection.id,
        ],
        connection,
      );
      void refreshAgentData();
    },
    [queryClient, refreshAgentData],
  );

  return (
    <section
      aria-labelledby="agents-title"
      className="relative isolate flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-6 pb-4 sm:px-6 lg:px-8 lg:pt-8"
    >
      <div
        aria-hidden="true"
        className="canvas-grid-dots absolute inset-0 -z-20 opacity-45"
      />
      <div
        aria-hidden="true"
        className="absolute top-0 right-0 -z-10 size-80 rounded-full bg-primary/10 blur-3xl"
      />

      <Flex className="mx-auto min-h-0 w-full max-w-400 flex-1 flex-col">
        <header className="flex shrink-0 flex-wrap items-end justify-between gap-4 border-b border-border/80 pb-5 sm:gap-6">
          <div>
            <Flex className="items-center gap-2 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
              <Bot aria-hidden="true" className="size-3.5" />
              Connect a model
            </Flex>

            <h1
              id="agents-title"
              className="mt-3 font-heading text-3xl font-bold tracking-tight"
            >
              Models
            </h1>

            <p className="mt-2 max-w-lg text-sm/relaxed text-muted-foreground">
              ZRoute gives MemWal access to the models on your key. This is a model connection, not an assistant. Provider account sharing stays available below.
            </p>
          </div>

          <Flex className="flex-wrap items-center gap-2">
            <a className="inline-flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground" href="/builder/integrations">Connect model</a>
            <AgentsConnectDialog
              onConnected={() =>
                void queryClient.invalidateQueries({
                  queryKey: agentPoolsService.queryKey,
                })
              }
            />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="More agent setup options"
                  className="size-10"
                  type="button"
                  variant="outline"
                >
                  <MoreHorizontal aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => navigate("/tools?node=gateway")}>
                  <Download aria-hidden="true" />
                  Install
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setGatewayKeyOpen(true)}>
                  <KeyRound aria-hidden="true" />
                  Gateway Key
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <AgentsGatewayKeyDialog
              hideTrigger
              open={gatewayKeyOpen}
              onOpenChange={setGatewayKeyOpen}
            />
          </Flex>
        </header>

        {errorMessage ? (
          <Alert className="mt-5 shrink-0" variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        {poolsQuery.isPending || pools.length > 0 ? (
          <AgentsExplorer
            loading={poolsQuery.isPending}
            currentUsername={session.user?.username ?? null}
            onCheckRequests={(selectedPool) => setReviewPoolId(selectedPool.id)}
            onRequestJoin={requestJoin}
            pools={pools}
          />
        ) : (
          <p className="mt-5 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No connected accounts yet.
          </p>
        )}
      </Flex>

      <AgentsRequestDialog
        open={requestPool !== null}
        onOpenChange={(open) => {
          if (!open) setRequestPoolId(null);
        }}
        onSubmitRequest={submitRequest}
        pool={requestPool}
      />

      <AgentsRequestsDialog
        busy={
          decisionMutation.isPending ||
          inviteMutation.isPending ||
          removeMemberMutation.isPending ||
          deletePoolMutation.isPending ||
          refreshMutation.isPending
        }
        open={reviewPool !== null}
        onDecision={decideRequest}
        onDelete={deletePool}
        onInvite={inviteMember}
        onOpenChange={(open) => {
          if (!open) setReviewPoolId(null);
        }}
        onRefresh={refreshPool}
        onRefreshComplete={refreshPoolData}
        onRemoveMember={removeMember}
        pool={reviewPool}
      />
    </section>
  );
}
