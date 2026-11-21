// Adapted from nightly-labs/openbot 0.60.0; see LICENSE.upstream.
// Frozen optional agent-host-settings-v1 wire contract gated by `requireAdmin`.
// Covers `computerUse`, `allowAutomation` (single local-scripts grant), and `busyMessageMode`.
// Any further widening requires a new capability string.
import {
  type AdminDecoder,
  adminRoute,
  boolean,
  fields,
  identifier,
  nullable,
  type OptionalRouteCodec,
  oneOf,
} from "./admin-wire.ts";

export const AGENT_HOST_SETTINGS_CAPABILITY = "agent-host-settings-v1";

export const AGENT_HOST_SETTINGS_ROUTES = {
  settings: "/v1/admin/agents/host-settings",
  update: "/v1/admin/agents/host-settings/update",
} as const;

const mode = oneOf("queue", "steer");
const settings: AdminDecoder = fields({
  computerUse: boolean,
  allowAutomation: boolean,
  busyMessageMode: nullable(mode),
  defaultBusyMessageMode: mode,
});

export const AGENT_HOST_SETTINGS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_HOST_SETTINGS_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [
    AGENT_HOST_SETTINGS_ROUTES.update,
    adminRoute(
      fields(
        { agentId: identifier },
        { computerUse: boolean, allowAutomation: boolean, busyMessageMode: nullable(mode) },
      ),
      settings,
    ),
  ],
]);
