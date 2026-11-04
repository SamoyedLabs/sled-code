import { WS_METHODS } from "@t3tools/contracts";
import type { HttpClient } from "effect/http";
import type { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentQueryAtomFamily, createEnvironmentRpcCommand } from "../state/runtime.ts";

import { resolveComputerViewerAccess } from "./rpc/computerView.ts";

export function createOpenbotComputerAtoms<R, E>(
  runtime: Atom.AtomRuntime<HttpClient.HttpClient | EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    computerViewCommand: createEnvironmentRpcCommand(runtime, {
      label: "Control host computer viewer",
      tag: WS_METHODS.openbotComputerViewCommand,
    }),
    computerViewAccess: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:computer-view-access",
      staleTimeMs: 0,
      idleTtlMs: 0,
      execute: (_input: Record<string, never>) => resolveComputerViewerAccess(),
    }),
    computerCapabilities: createEnvironmentRpcCommand(runtime, {
      label: "Read host computer capabilities",
      tag: WS_METHODS.openbotReadToHost,
    }),
  };
}
