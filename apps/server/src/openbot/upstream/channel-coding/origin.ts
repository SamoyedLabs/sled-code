// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- Maintained upstream adapter uses canonical JSON hashes and Node crypto.
import * as NodeCrypto from "node:crypto";

export interface SledChannelOrigin {
  readonly originRef: string;
  readonly operationId: string;
  readonly payloadHash: string;
  readonly actorId: string;
  readonly messageId: string;
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
export function channelOrigin(
  originRef: string,
  command: { operationId: string },
  actorId: string,
): SledChannelOrigin {
  if (!/^[a-f0-9]{64}$/.test(originRef)) throw new Error("Invalid Sled origin reference.");
  return {
    originRef,
    operationId: command.operationId,
    actorId,
    payloadHash: NodeCrypto.createHash("sha256").update(canonical(command)).digest("hex"),
    messageId: `sled-origin-${originRef}`,
  };
}
export function storedChannelOrigin(value: unknown): SledChannelOrigin {
  if (value === null || typeof value !== "object" || !("sledOrigin" in value))
    throw new Error("Missing attributable request.");
  const origin = value.sledOrigin;
  if (
    origin === null ||
    typeof origin !== "object" ||
    !("originRef" in origin) ||
    typeof origin.originRef !== "string" ||
    !/^[a-f0-9]{64}$/.test(origin.originRef) ||
    !("operationId" in origin) ||
    typeof origin.operationId !== "string" ||
    !("payloadHash" in origin) ||
    typeof origin.payloadHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(origin.payloadHash) ||
    !("actorId" in origin) ||
    typeof origin.actorId !== "string" ||
    !("messageId" in origin) ||
    origin.messageId !== `sled-origin-${origin.originRef}`
  )
    throw new Error("Invalid attributable request.");
  return {
    originRef: origin.originRef,
    operationId: origin.operationId,
    payloadHash: origin.payloadHash,
    actorId: origin.actorId,
    messageId: origin.messageId,
  };
}
