// Projection of pinned 0.60.0 provider-aware-codec.ts isProviderAwareConversationReadState(s).
// Copyright upstream authors; see LICENSE.upstream. Strip unrelated fields at the Sled boundary.
import {
  adminRoute,
  count,
  empty,
  fields,
  identifier,
  nullable,
  type AdminDecoder,
} from "./admin-wire.ts";
import { isDynamicRecord } from "./runtime-values.ts";
const read = fields({
  unreadCount: count,
  firstUnreadMessageId: nullable(identifier),
  throughMessageId: nullable(identifier),
});
const reads: AdminDecoder = (value) => {
  if (!isDynamicRecord(value) || Object.keys(value).length > 10_000)
    throw new Error("Invalid conversation read states");
  return Object.fromEntries(
    Object.entries(value).map(([key, value]) => [identifier(key), read(value)]),
  );
};
export const CONVERSATION_READS_CODEC = adminRoute(empty, reads);
