import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";
import {
  type OpenbotVaultRequest,
  OpenbotVaultState,
  OpenbotVaultSecret,
  OpenbotVaultImportResult,
  OpenbotVaultOnePasswordStatus,
  OpenbotVaultBitwardenStatus,
} from "@t3tools/contracts";
const decodeVaultBitwardenStatus = Schema.decodeUnknownEffect(OpenbotVaultBitwardenStatus);
const decodeVaultOnePasswordStatus = Schema.decodeUnknownEffect(OpenbotVaultOnePasswordStatus);
export function isRequest(request: { readonly operation: string }): request is OpenbotVaultRequest {
  return request.operation.startsWith("vault.");
}
export function route(request: OpenbotVaultRequest) {
  const { operation, ...input } = request;
  const path =
    operation === "vault.import"
      ? "/v1/admin/vault/import"
      : operation.startsWith("vault.onepassword.")
        ? `/v1/admin/connectors/onepassword/${operation.slice("vault.onepassword.".length)}`
        : operation.startsWith("vault.bitwarden.")
          ? `/v1/admin/connectors/bitwarden/${operation.slice("vault.bitwarden.".length)}`
          : `/v1/admin/vault/${"version" in request && request.version === "v2" ? "v2/" : ""}${operation.slice("vault.".length)}`;
  const body =
    request.operation === "vault.save"
      ? request.input
      : "version" in input
        ? Object.fromEntries(Object.entries(input).filter(([key]) => key !== "version"))
        : input;
  return {
    method: "POST" as const,
    path,
    body,
    vaultProjection: operation,
    ...("version" in request ? { vaultVersion: request.version } : {}),
  };
}
const V1State = OpenbotVaultState.check(
  Schema.makeFilter((state) => state.items.every((item) => item.kind !== "apiKey")),
);
const V1Secret = Schema.Struct({ value: Schema.String.check(Schema.isMaxLength(1024)) });
const publicJson = Schema.decodeUnknownEffect(Schema.Json);
const safeError = (value: string | null) =>
  value === null ? null : "The host password-manager connection failed.";
function safeOrigin(value: string | null) {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}
export const project = Effect.fn("OpenbotVaultProtocol.project")(function* (
  operation: OpenbotVaultRequest["operation"],
  value: unknown,
  version: "v1" | "v2" = "v2",
) {
  if (operation.startsWith("vault.onepassword.")) {
    const result = yield* decodeVaultOnePasswordStatus(value);
    const connected = result.state === "connected";
    return yield* publicJson({
      ...result,
      state: connected
        ? "connected"
        : result.state === "connecting"
          ? "connecting"
          : "disconnected",
      vaultNames: connected ? result.vaultNames : [],
      loginCount: connected ? result.loginCount : null,
      error: safeError(result.error),
    });
  }
  if (operation.startsWith("vault.bitwarden.")) {
    const result = yield* decodeVaultBitwardenStatus(value);
    return yield* publicJson({
      ...result,
      state: ["connected", "connecting"].includes(result.state) ? result.state : "disconnected",
      serverUrl: safeOrigin(result.serverUrl),
      error: safeError(result.error),
    });
  }
  const schema: Schema.Codec<unknown> =
    operation === "vault.reveal"
      ? version === "v1"
        ? V1Secret
        : OpenbotVaultSecret
      : operation === "vault.import"
        ? OpenbotVaultImportResult
        : version === "v1"
          ? V1State
          : OpenbotVaultState;
  return yield* Schema.decodeUnknownEffect(schema)(value).pipe(Effect.flatMap(publicJson));
});
