// Adapted from nightly-labs/openbot 0.60.0, 0c7753fa622c38419939cd230657f40e5883d098.
// Copyright upstream authors; see LICENSE.upstream. Only import paths/types adapted.
// Frozen optional agent-new-chat-v1 wire contract.
//
// What it grants, recorded here because freezing it makes it permanent: an owner or admin of a
// server can read and change whether each agent on that host may start a new chat itself when its
// chat gets long (`allowNewChat`). The agent saves notes before it starts the new chat. The read
// gives the value that applies, the agent's own choice or else the host's account default; a change
// saves the agent's own choice. The host default stays a local choice. A member cannot use either
// route; `requireAdmin` on the host is the only gate. Widening any of it needs a second capability.
import { adminRoute, boolean, fields, identifier, type OptionalRouteCodec } from "./admin-wire.ts";

export const AGENT_NEW_CHAT_CAPABILITY = "agent-new-chat-v1";

export const AGENT_NEW_CHAT_ROUTES = {
  settings: "/v1/admin/agents/new-chat",
  update: "/v1/admin/agents/new-chat/update",
} as const;

const settings = fields({ allowNewChat: boolean });

export const AGENT_NEW_CHAT_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [AGENT_NEW_CHAT_ROUTES.settings, adminRoute(fields({ agentId: identifier }), settings)],
  [AGENT_NEW_CHAT_ROUTES.update, adminRoute(fields({ agentId: identifier, allowNewChat: boolean }), settings)],
]);
