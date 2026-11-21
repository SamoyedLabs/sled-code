import { WS_METHODS, type EnvironmentId } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentQueryAtomFamily, createEnvironmentRpcCommand } from "../state/runtime.ts";
import { privilegedScope } from "./rpc/privileged.ts";
import { mFallback, msg } from "gt-i18n";
export function createOpenbotPrivilegedAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, E>,
  refreshTrigger: (target: { readonly environmentId: EnvironmentId }) => Atom.Atom<unknown>,
) {
  return {
    privilegedScope: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:privileged-scope",
      execute: privilegedScope,
      staleTimeMs: 0,
      refreshTrigger,
    }),
    privilegedExecute: createEnvironmentRpcCommand(runtime, {
      label: mFallback(msg("Secure response")),
      tag: WS_METHODS.openbotPrivilegedExecute,
    }),
  };
}
