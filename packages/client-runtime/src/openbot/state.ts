import {
  type OpenbotCodingListInput,
  type OpenbotReadRequest,
  type OpenbotHostReadInput,
  type EnvironmentId,
  WS_METHODS,
} from "@t3tools/contracts";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/reactivity";
import {
  createEnvironmentQueryAtomFamily,
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";
import {
  readHostStatus,
  listAgents,
  read,
  codingTasks,
  sledToolsStatus,
  attentionSnapshot,
  readFromHost,
} from "./rpc/index.ts";

export function createOpenbotAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
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
  return {
    changes,
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
