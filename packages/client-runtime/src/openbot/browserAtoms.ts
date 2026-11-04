import { WS_METHODS } from "@t3tools/contracts";
import type { HttpClient } from "effect/http";
import type { Atom } from "effect/reactivity";
import type * as EnvironmentRegistry from "../connection/registry.ts";
import { createEnvironmentQueryAtomFamily, createEnvironmentRpcCommand } from "../state/runtime.ts";
import { resolveBrowserViewerAccess } from "./rpc/browserView.ts";

export function createOpenbotBrowserAtoms<R, E>(
  runtime: Atom.AtomRuntime<HttpClient.HttpClient | EnvironmentRegistry.EnvironmentRegistry | R, E>,
) {
  return {
    browserViewCommand: createEnvironmentRpcCommand(runtime, {
      label: "Control bot browser viewer",
      tag: WS_METHODS.openbotBrowserViewCommand,
    }),
    browserViewAccess: createEnvironmentQueryAtomFamily(runtime, {
      label: "openbot:browser-view-access",
      staleTimeMs: 0,
      idleTtlMs: 0,
      execute: (_input: Record<string, never>) => resolveBrowserViewerAccess(),
    }),
  };
}
