import { WS_METHODS } from "@t3tools/contracts";
import type { HttpClient } from "effect/http";
import type { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";

export function createOpenbotDataAtoms<R, E>(
  runtime: Atom.AtomRuntime<HttpClient.HttpClient | EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    dataRead: createEnvironmentRpcCommand(runtime, {
      label: "Read shared tables and hosted sites",
      tag: WS_METHODS.openbotReadToHost,
    }),
  };
}
