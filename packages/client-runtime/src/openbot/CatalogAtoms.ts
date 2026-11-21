import { WS_METHODS } from "@t3tools/contracts";
import type { HttpClient } from "effect/http";
import type { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";
import { mFallback, msg } from "gt-i18n";

export function createOpenbotCatalogAtoms<R, E>(
  runtime: Atom.AtomRuntime<HttpClient.HttpClient | EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    catalogRead: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Read host ACP registry")),
      tag: WS_METHODS.openbotReadToHost,
    }),
  };
}
