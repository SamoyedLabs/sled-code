import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import { createEnvironmentQueryAtomFamily, createEnvironmentRpcCommand } from "../state/runtime.ts";
export function createOpenbotContinuityAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
  refreshTrigger: (target: { readonly environmentId: EnvironmentId }) => Atom.Atom<unknown>,
) {
  const continuity = createEnvironmentQueryAtomFamily(runtime, {
    label: "openbot:continuity",
    execute: (_input: Record<string, never>) =>
      request(WS_METHODS.openbotContinuityStatus, {}),
    staleTimeMs: 5000,
    refreshTrigger,
  });
  return {
    continuity,
    continuityCommand: createEnvironmentRpcCommand(runtime, {
      label: "Configure bot background notifications",
      tag: WS_METHODS.openbotContinuityCommand,
      onSuccess: ({ environmentId }, registry) =>
        Effect.sync(() => registry.refresh(continuity({ environmentId, input: {} }))),
      concurrency: { mode: "serial", key: ({ environmentId }) => environmentId },
    }),
  };
}
