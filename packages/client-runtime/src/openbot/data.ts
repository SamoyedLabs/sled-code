import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotSharedTables,
  OpenbotHostedSites,
  type OpenbotDataReadRequest,
  type OpenbotDataAdminRequest,
} from "@t3tools/contracts";
export type DataRequest = OpenbotDataReadRequest | OpenbotDataAdminRequest;
export type DataActions = {
  readonly execute: (request: DataRequest) => Promise<unknown>;
  readonly canReadTables: boolean;
  readonly canReadSites: boolean;
  readonly canDelete: (request: OpenbotDataAdminRequest) => boolean;
};
const decodeTables = Schema.decodeUnknownResult(OpenbotSharedTables);
const decodeSites = Schema.decodeUnknownResult(OpenbotHostedSites);
export function sharedTables(value: unknown) {
  const result = decodeTables(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function hostedSites(value: unknown) {
  const result = decodeSites(value);
  return Result.isSuccess(result) ? result.success : null;
}
export function tableOwner(
  ownerAgentId: string | null,
  agents: readonly { id: string; name: string }[],
) {
  if (ownerAgentId === null) return "Created outside an agent";
  const owner = agents.find((agent) => agent.id === ownerAgentId);
  return owner ? `Created by ${owner.name}` : `Creator unavailable (${ownerAgentId})`;
}
export function hostedSiteLink(site: OpenbotHostedSites["sites"][number]) {
  if (site.status !== "active") return null;
  try {
    const url = new URL(site.url);
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.hostname === site.hostname
      ? site.url
      : null;
  } catch {
    return null;
  }
}
export function dataFailure(value: unknown) {
  if (typeof value !== "object" || value === null || !("dataError" in value)) return null;
  switch (value.dataError) {
    case "unsupported":
      return "This host does not support the released data capability.";
    case "forbidden":
      return "The host refused access. Check the host role and Sled permissions.";
    case "account-or-conflict":
      return "The host could not complete the request. Hosted sites require a signed-in host account; the resource may also be missing or belong to another server.";
    default:
      return "The host data request failed. Refresh before retrying.";
  }
}
