// Adapted from Openbot 0.60.0; see LICENSE.upstream.
// Frozen optional agent-import-v1 wire contract: member-scoped 100 MB ZIP stage/apply/discard.
// Previews omit avatars and never add host skill revisions; widening needs a new capability string.
import {
  adminRoute,
  boolean,
  count,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  string,
} from "./admin-wire.ts";

export const AGENT_IMPORT_CAPABILITY = "agent-import-v1";

/** The largest export a member can send to a host. */
export const AGENT_IMPORT_UPLOAD_BYTES = 100 * 1024 * 1024;

export const AGENT_IMPORT_ROUTES = {
  stage: "/v1/agent-import/stage",
  apply: "/v1/agent-import/apply",
  discard: "/v1/agent-import/discard",
} as const;

const key = string(64);
const name = string(80);
const messages = list(string(500), 200);
const skipped = list(fields({ key, name, reason: string(500) }), 200);

const preview = fields({
  token: identifier,
  sourceApp: string(64),
  exportedAt: nullable(string(64)),
  agents: list(
    fields({
      key,
      name,
      title: string(120),
      description: string(2_000),
      skillCount: count,
      routineCount: count,
      memoryCount: count,
      fileCount: count,
      fileBytes: count,
      nameExists: boolean,
    }),
    100,
  ),
  channels: list(
    fields({
      key,
      name,
      title: string(120),
      memberKeys: list(key, 100),
      leadKey: nullable(key),
      memoryCount: count,
      routineCount: count,
    }),
    100,
  ),
  warnings: messages,
});

const result = fields({
  agents: list(fields({ agentId: identifier, name }), 100),
  skipped,
  channels: list(fields({ id: identifier, name }), 100),
  skippedChannels: skipped,
  warnings: messages,
});

export const AGENT_IMPORT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  // The request body is the raw `.zip`, so its decoder never reads it.
  [AGENT_IMPORT_ROUTES.stage, adminRoute(empty, preview)],
  [
    AGENT_IMPORT_ROUTES.apply,
    adminRoute(
      fields({
        token: identifier,
        keys: list(key, 100),
        channelKeys: list(key, 100),
        timezone: string(255),
      }),
      result,
    ),
  ],
  [AGENT_IMPORT_ROUTES.discard, adminRoute(fields({ token: identifier }), empty)],
]);
