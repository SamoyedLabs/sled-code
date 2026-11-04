import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotRegistryEntries,
  OpenbotRegistryInstalled,
  OpenbotRegistryStatus,
  OpenbotRegistryInstallResult,
  OpenbotCatalogReadRequest,
  OpenbotCatalogAdminRequest,
  type OpenbotCatalogRequest,
  type OpenbotCatalogAdminRequest as Admin,
} from "@t3tools/contracts/openbot-catalog";
const decodeEntries = Schema.decodeUnknownResult(OpenbotRegistryEntries);
const decodeInstalled = Schema.decodeUnknownResult(OpenbotRegistryInstalled);
const decodeStatus = Schema.decodeUnknownResult(OpenbotRegistryStatus);
const decodeInstall = Schema.decodeUnknownResult(OpenbotRegistryInstallResult);
const decodeEmpty = Schema.decodeUnknownResult(Schema.Record(Schema.String, Schema.Unknown));
const decodeAdmin = Schema.decodeUnknownResult(OpenbotCatalogAdminRequest);
const decodeRequest = Schema.decodeResult(
  Schema.Union([OpenbotCatalogReadRequest, OpenbotCatalogAdminRequest]),
);
export type CatalogActions = {
  readonly execute: (request: OpenbotCatalogRequest) => Promise<unknown>;
  readonly can: (request: OpenbotCatalogRequest) => boolean;
};
export type CatalogState = {
  readonly entries: typeof OpenbotRegistryEntries.Type | null;
  readonly installed: typeof OpenbotRegistryInstalled.Type | null;
  readonly status: typeof OpenbotRegistryStatus.Type | null;
  readonly notice: string | null;
};
export const EMPTY_CATALOG: CatalogState = {
  entries: null,
  installed: null,
  status: null,
  notice: null,
};
export function catalogResult(
  state: CatalogState,
  request: OpenbotCatalogRequest,
  value: unknown,
): CatalogState | null {
  if (request.operation === "registry.search") {
    const result = decodeEntries(value);
    return Result.isSuccess(result) ? { ...state, entries: result.success } : null;
  }
  if (request.operation === "registry.installed") {
    const result = decodeInstalled(value);
    return Result.isSuccess(result) ? { ...state, installed: result.success } : null;
  }
  if (request.operation === "registry.status") {
    const result = decodeStatus(value);
    return Result.isSuccess(result) ? { ...state, status: result.success } : null;
  }
  if (request.operation === "registry.install") {
    const result = decodeInstall(value);
    return Result.isSuccess(result)
      ? {
          ...state,
          entries: null,
          installed: null,
          status: null,
          notice:
            result.success.restart === "skipped-busy"
              ? "Registry request accepted. Provider restart skipped because it is busy. Refresh host status and installed agents."
              : `Registry request accepted (${result.success.restart}). Refresh host status and installed agents.`,
        }
      : null;
  }
  const result = decodeEmpty(value);
  return Result.isSuccess(result)
    ? {
        ...state,
        entries: null,
        installed: null,
        status: null,
        notice: "Request accepted. Refresh to check the host outcome.",
      }
    : null;
}
export function registryInstall(
  entry: { id: string; customAgentId: string | null; distributions: readonly string[] },
  customAgentId: string,
  distribution: string,
  name: string,
): Admin | null {
  if (!entry.distributions.includes(distribution)) return null;
  const id = entry.customAgentId ?? customAgentId.trim();
  if (["codex", "claude", "grok", "opencode", "antigravity", "acp", "custom"].includes(id))
    return null;
  const result = decodeAdmin({
    operation: "registry.install",
    registryId: entry.id,
    customAgentId: id,
    distribution,
    ...(name.trim() ? { name: name.trim() } : {}),
  });
  return Result.isSuccess(result) ? result.success : null;
}
export function catalogRequestValid(request: OpenbotCatalogRequest) {
  return Result.isSuccess(decodeRequest(request));
}
export function registryConfirmation(request: Admin) {
  return request.operation === "registry.install"
    ? `Install or update ${request.registryId} as ${request.customAgentId} on this host using ${request.distribution ?? "the host default"}? The host downloads packages or binaries and may run the installed command and restart providers. Existing coding and approval settings stay authoritative.`
    : request.operation === "registry.remove"
      ? `Remove registry provider ${request.registryId} from this host? This affects every client connected to this host.`
      : `Cancel the installation of ${request.registryId} on this host? Refresh afterward to check the outcome.`;
}

export function catalogRecovered(state: CatalogState) {
  return (
    state.installed !== null &&
    state.status !== null &&
    !state.status.some((item) => item.state === "installing")
  );
}
