import { WS_METHODS } from "@t3tools/contracts";
import type { HttpClient } from "effect/http";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";
import { Atom } from "effect/reactivity";
import { EMPTY_TEMPLATES } from "./templates.ts";
// Keep unknown outcomes and original receipts across panel remounts within this client session.
export const templateState = Atom.family((_environmentAndHost: string) =>
  Atom.make(EMPTY_TEMPLATES).pipe(Atom.keepAlive),
);

export function createOpenbotTemplateAtoms<R, E>(
  runtime: Atom.AtomRuntime<HttpClient.HttpClient | EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    templateRead: createEnvironmentRpcCommand(runtime, {
      label: "Read host agent templates",
      tag: WS_METHODS.openbotReadToHost,
    }),
  };
}
