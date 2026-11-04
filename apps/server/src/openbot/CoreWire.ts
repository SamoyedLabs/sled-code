import type * as Schema from "effect/Schema";

type Json = Schema.Json;
type ObjectValue = { readonly [key: string]: Json };
const isObject = (value: Json | undefined): value is ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function reference(value: ObjectValue, wire: string, current: string): ObjectValue {
  const id = value[wire];
  if (id === undefined) return value;
  if (typeof id !== "string" || (value[current] !== undefined && value[current] !== id))
    throw new Error("Ambiguous upstream agent reference");
  const { [wire]: _wire, ...rest } = value;
  return { ...rest, [current]: id };
}

function message(value: Json): Json {
  if (!isObject(value)) return value;
  return reference(value, "senderBotId", "senderAgentId");
}

function row(value: Json): Json {
  if (!isObject(value)) return value;
  let result = reference(value, "botId", "agentId");
  if (Array.isArray(result.messages))
    result = { ...result, messages: result.messages.map(message) };
  if (isObject(result.references))
    result = {
      ...result,
      references: Object.fromEntries(
        Object.entries(result.references).map(([id, value]) => [id, message(value)]),
      ),
    };
  if (!Array.isArray(result.deliveries)) return result;
  return {
    ...result,
    deliveries: result.deliveries.map((delivery) => {
      if (!isObject(delivery)) return delivery;
      const item = reference(delivery, "recipientBotId", "recipientAgentId");
      if (!isObject(item.sender) || item.sender.kind !== "bot") return item;
      return { ...item, sender: { ...reference(item.sender, "botId", "agentId"), kind: "agent" } };
    }),
  };
}

// Frozen core routes use bot vocabulary; optional capability routes already use agent vocabulary.
export function normalize(path: string, value: Json): Json {
  if (
    !/^\/v1\/agents\/[^/]+\/(?:conversation(?:-page)?|queue(?:\/edit)?|messages|memories(?:\/[^/]+)?|routines(?:\/[^/]+)?(?:\/(?:runs|test))?)$/.test(
      new URL(path).pathname,
    )
  )
    return value;
  return Array.isArray(value) ? value.map(row) : row(value);
}
