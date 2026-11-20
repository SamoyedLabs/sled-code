import { WS_METHODS } from "@t3tools/contracts";
import type { HttpClient } from "effect/http";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";
import type { Atom } from "effect/reactivity";
export function createOpenbotSettingsAtoms<R, E>(
  runtime: Atom.AtomRuntime<HttpClient.HttpClient | EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    settingsRead: createEnvironmentRpcCommand(runtime, {
      label: "Read bot settings",
      tag: WS_METHODS.openbotReadToHost,
    }),
  };
}
