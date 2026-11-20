// Adapted from OpenBot mobile 1.4.11. See LICENSE.upstream.
// Frozen per-member ordered agent and channel pins. Seed only writes a previously unset list.
import { isDynamicRecord } from "./runtime-values.ts";
import {
  type AdminDecoder,
  adminRoute,
  empty,
  fields,
  identifier,
  list,
  nullable,
  type OptionalRouteCodec,
  oneOf,
  string,
} from "./admin-wire.ts";

export const SIDEBAR_PINS_CAPABILITY = "sidebar-pins-v1";

export const SIDEBAR_PINS_ROUTES = {
  read: "/v1/sidebar-pins",
  set: "/v1/sidebar-pins/set",
  seed: "/v1/sidebar-pins/seed",
} as const;

const pins = list(fields({ kind: oneOf("agent", "channel"), id: identifier }), 1000);
const updatedAt: AdminDecoder = (input) => {
  const value = nullable(string(64))(input);
  if (value === "" || (typeof value === "string" && Number.isNaN(Date.parse(value))))
    throw new Error("Invalid pinned chats time.");
  return value;
};
const snapshot = fields({ items: pins, updatedAt });
const save: AdminDecoder = (input) => {
  if (!isDynamicRecord(input) || Object.keys(input).some((key) => key !== "items"))
    throw new Error("Invalid pinned chats request.");
  return fields({ items: pins })(input);
};

export const SIDEBAR_PINS_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [SIDEBAR_PINS_ROUTES.read, adminRoute(empty, snapshot)],
  [SIDEBAR_PINS_ROUTES.set, adminRoute(save, snapshot)],
  [SIDEBAR_PINS_ROUTES.seed, adminRoute(save, snapshot)],
]);
