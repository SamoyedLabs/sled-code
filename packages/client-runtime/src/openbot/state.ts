import {
  type OpenbotCodingListInput,
  type OpenbotReadRequest,
  type OpenbotHostReadInput,
  type OpenbotCodingPolicyScope,
  type EnvironmentId,
  WS_METHODS,
} from "@t3tools/contracts";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/reactivity";
import type { HttpClient } from "effect/http";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";
import {
  readHostStatus,
  readRuntimeStatus,
  readMaintenanceStatus,
  listAgents,
  read,
  codingTasks,
  sledToolsStatus,
  attentionSnapshot,
  readFromHost,
  readCodingPolicy,
} from "./rpc/index.ts";
import { createOpenbotFileAtoms } from "./files.ts";
import { createOpenbotComputerAtoms } from "./ComputerAtoms.ts";
import { createOpenbotBrowserAtoms } from "./browserAtoms.ts";

export function createOpenbotAtoms<R, E>(
  runtime: Atom.AtomRuntime<HttpClient.HttpClient | EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  const changes = createEnvironmentRpcSubscriptionAtomFamily(runtime, {
    label: "openbot:changes",
    tag: WS_METHODS.openbotSubscribeChanges,
    idleTtlMs: 0,
  });
  const refreshTrigger = ({ environmentId }: { readonly environmentId: EnvironmentId }) =>
    changes({ environmentId, input: {} });
  const agents = createEnvironmentQueryAtomFamily(runtime, {
    label: "openbot:agents",
    execute: (_input: Record<string, never>) => listAgents(),
    staleTimeMs: 5_000,
    refreshTrigger,
  });
  const attention = createEnvironmentQueryAtomFamily(runtime, {
    label: "openbot:attention",
    execute: (_input: Record<string, never>) => attentionSnapshot(),
    refreshTrigger,
    staleTimeMs: 5_000,
  });
  const upstream = createEnvironmentQueryAtomFamily(runtime, {
    label: "openbot:runtime",
    execute: (_input: Record<string, never>) => readRuntimeStatus(),
    staleTimeMs: 5_000,
    refreshTrigger,
  });
  const codingPolicy = createEnvironmentQueryAtomFamily(runtime, {
    label: "openbot:coding-policy",
    execute: (input: OpenbotCodingPolicyScope) => readCodingPolicy(input),
    staleTimeMs: 5_000,
    refreshTrigger,
  });
  const maintenance = createEnvironmentQueryAtomFamily(runtime, {
    label: "openbot:maintenance",
    execute: (_input: Record<string, never>) => readMaintenanceStatus(),
    staleTimeMs: 5_000,
    refreshTrigger,
  });
  return {
    maintenance,
    maintenanceCommand: createEnvironmentRpcCommand(runtime, {
      label: "Update upstream maintenance",
      tag: WS_METHODS.openbotMaintenanceCommand,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(maintenance({ environmentId, input: {} }))),
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    ...createOpenbotFileAtoms(runtime, refreshTrigger),
    ...createOpenbotBrowserAtoms(runtime),
    ...createOpenbotComputerAtoms(runtime),
    codingPolicy,
    codingPolicyEnable: createEnvironmentRpcCommand(runtime, {
      label: "Enable bot coding delegation",
      tag: WS_METHODS.openbotCodingPolicyEnable,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(
            codingPolicy({
              environmentId,
              input: { hostId: input.hostId, agentId: input.agentId },
            }),
          ),
        ),
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => `${environmentId}:${input.hostId}:${input.agentId}`,
      },
    }),
    codingPolicyDisable: createEnvironmentRpcCommand(runtime, {
      label: "Disable bot coding delegation",
      tag: WS_METHODS.openbotCodingPolicyDisable,
      onSuccess: ({ environmentId, input }, registry) =>
        Effect.sync(() =>
          registry.refresh(
            codingPolicy({
              environmentId,
              input: { hostId: input.hostId, agentId: input.agentId },
            }),
          ),
        ),
      concurrency: {
        mode: "serial",
        key: ({ environmentId, input }) => `${environmentId}:${input.hostId}:${input.agentId}`,
      },
    }),
    changes,
    upstream,
    checkRuntime: createEnvironmentRpcCommand(runtime, {
      label: "Check bot engine release",
      tag: WS_METHODS.openbotUpstreamCheck,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(upstream({ environmentId, input: {} }))),
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    stageRuntime: createEnvironmentRpcCommand(runtime, {
      label: "Download bot engine release",
      tag: WS_METHODS.openbotUpstreamStage,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(upstream({ environmentId, input: {} }))),
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    installRuntime: createEnvironmentRpcCommand(runtime, {
      label: "Install bot engine release",
      tag: WS_METHODS.openbotUpstreamInstall,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(upstream({ environmentId, input: {} }))),
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    activateRuntime: createEnvironmentRpcCommand(runtime, {
      label: "Activate bot engine release",
      tag: WS_METHODS.openbotRuntimeActivate,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(upstream({ environmentId, input: {} }))),
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    rollbackRuntime: createEnvironmentRpcCommand(runtime, {
      label: "Roll back bot engine release",
      tag: WS_METHODS.openbotRuntimeRollback,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(upstream({ environmentId, input: {} }))),
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    attention,
    attentionRespond: createEnvironmentRpcCommand(runtime, {
      label: "Respond to bot request",
      tag: WS_METHODS.openbotAttentionRespond,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(attention({ environmentId, input: {} }))),
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    status: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:status",
      execute: (_input: Record<string, never>) => readHostStatus(),
      staleTimeMs: 5_000,
      refreshTrigger,
    }),
    agents,
    read: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:read",
      execute: (input: OpenbotReadRequest) => read(input),
      staleTimeMs: 5_000,
      refreshTrigger,
    }),
    readFromHost: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:host-read",
      execute: (input: OpenbotHostReadInput) => readFromHost(input),
      staleTimeMs: 5_000,
      refreshTrigger,
    }),
    sledTools: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:sled-tools",
      execute: (_input: Record<string, never>) => sledToolsStatus(),
      staleTimeMs: 5_000,
      refreshTrigger,
    }),
    connectSledTools: createEnvironmentRpcCommand(runtime, {
      label: "Connect bots to Sled",
      tag: WS_METHODS.openbotSledToolsConnect,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    disconnectSledTools: createEnvironmentRpcCommand(runtime, {
      label: "Disconnect bots from Sled",
      tag: WS_METHODS.openbotSledToolsDisconnect,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    codingTasks: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:coding-tasks",
      execute: (input: OpenbotCodingListInput) => codingTasks(input),
      staleTimeMs: 5_000,
      refreshTrigger,
    }),
    write: createEnvironmentRpcCommand(runtime, {
      label: "Update bot task",
      tag: WS_METHODS.openbotWrite,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    writeToHost: createEnvironmentRpcCommand(runtime, {
      label: "Update bot conversation or task",
      tag: WS_METHODS.openbotWriteToHost,
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    admin: createEnvironmentRpcCommand(runtime, {
      label: "Update bot",
      tag: WS_METHODS.openbotAdmin,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => {
          registry.refresh(agents({ environmentId, input: {} }));
          registry.refresh(attention({ environmentId, input: {} }));
        }),
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    adminToHost: createEnvironmentRpcCommand(runtime, {
      label: "Update bot engine configuration",
      tag: WS_METHODS.openbotAdminToHost,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => {
          registry.refresh(agents({ environmentId, input: {} }));
          registry.refresh(attention({ environmentId, input: {} }));
        }),
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
    start: createEnvironmentRpcCommand(runtime, {
      label: "Start bot engine",
      tag: WS_METHODS.openbotStart,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
    stop: createEnvironmentRpcCommand(runtime, {
      label: "Stop bot engine",
      tag: WS_METHODS.openbotStop,
      concurrency: { mode: "singleFlight", key: ({ environmentId }) => environmentId },
    }),
  };
}
