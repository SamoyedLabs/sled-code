import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { EnvironmentSupervisor } from "../../connection/supervisor.ts";
import { EnvironmentRpcUnavailableError } from "../../rpc/client.ts";
import { resolveDeviceHubAccess } from "../../state/deviceHubAccess.ts";

export const resolveBrowserViewerAccess = Effect.fn("Openbot.browserViewerAccess")(function* () {
  const supervisor = yield* EnvironmentSupervisor;
  const prepared = yield* SubscriptionRef.get(supervisor.prepared);
  if (Option.isNone(prepared))
    return yield* new EnvironmentRpcUnavailableError({
      environmentId: supervisor.target.environmentId,
      message: "Connect to this environment before opening its browser.",
    });
  return yield* resolveDeviceHubAccess({
    prepared: prepared.value,
    hubBasePath: "/api/openbot/browser-view",
  });
});
