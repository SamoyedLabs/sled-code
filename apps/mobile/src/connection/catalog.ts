import type { EnvironmentId } from "@t3tools/contracts";
import { RemoteEnvironmentAuthorization } from "@t3tools/client-runtime/authorization";
import { EnvironmentRegistry, EnvironmentSupervisor } from "@t3tools/client-runtime/connection";
import { createRuntimeCommand } from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";

import { createEnvironmentCatalogAtoms } from "@t3tools/client-runtime/state/connections";

import { connectionAtomRuntime } from "./runtime";

export const environmentCatalog = createEnvironmentCatalogAtoms(connectionAtomRuntime);

export const refreshRelayAccess = createRuntimeCommand(connectionAtomRuntime, {
  label: "environment-catalog:refresh-relay-access",
  concurrency: { mode: "singleFlight", key: (environmentId: EnvironmentId) => environmentId },
  execute: Effect.fn("EnvironmentCatalog.refreshRelayAccess")(function* (
    environmentId: EnvironmentId,
  ) {
    const registry = yield* EnvironmentRegistry.EnvironmentRegistry;
    const remote = yield* RemoteEnvironmentAuthorization;
    return yield* registry.run(
      environmentId,
      EnvironmentSupervisor.refreshRelayAccess(
        remote.authorizeDpopHttp({
          expectedEnvironmentId: environmentId,
          refreshRelayAccess: true,
        }),
      ),
    );
  }),
});
