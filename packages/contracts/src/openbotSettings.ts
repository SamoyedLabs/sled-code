import { LOCAL_CATALOG_SETTINGS } from "./openbotLocalCatalogWire.ts";
import * as Schema from "effect/Schema";
import {
  PINNED_SETTINGS,
  pinnedSetting as pinnedReleasedSetting,
} from "./openbotPinnedSettings/manifest.ts";
import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  AuthFilesystemReadScope,
  AuthFilesystemWriteScope,
  AuthOrchestrationReadScope,
  AuthOrchestrationOperateScope,
  AuthSettingsWriteScope,
  AuthProvidersManageScope,
  AuthPreviewOperateScope,
  type AuthEnvironmentScope,
} from "./auth.ts";
const operations = [...PINNED_SETTINGS, ...LOCAL_CATALOG_SETTINGS];
export const pinnedSetting = (operation: string) =>
  pinnedReleasedSetting(operation) ??
  LOCAL_CATALOG_SETTINGS.find((entry) => entry.operation === operation);
const reads = operations.filter((entry) => entry.kind === "read").map((entry) => entry.operation);
const admins = operations.filter((entry) => entry.kind === "admin").map((entry) => entry.operation);
const valid = (request: { readonly operation: string; readonly parameters: unknown }) => {
  try {
    const entry = pinnedSetting(request.operation);
    if (!entry) return false;
    entry.codec.request(request.parameters);
    return true;
  } catch {
    return false;
  }
};
// The operation names and each operation's frozen codec are closed. A caller cannot choose a URL,
// HTTP verb, IPC method or schema. The JSON field is decoded AGAIN by its operation at the server.
export const OpenbotSettingsReadRequest = Schema.Struct({
  operation: Schema.Literals(reads),
  parameters: Schema.Json,
}).check(Schema.makeFilter(valid));
export const OpenbotSettingsAdminRequest = Schema.Struct({
  operation: Schema.Literals(admins),
  parameters: Schema.Json,
}).check(Schema.makeFilter(valid));
export type OpenbotSettingsRequest =
  | typeof OpenbotSettingsReadRequest.Type
  | typeof OpenbotSettingsAdminRequest.Type;
export { PINNED_SETTINGS };
export function settingsRequiredScopes(
  operation: unknown,
  kind: "read" | "admin",
): readonly AuthEnvironmentScope[] | null {
  const entry = typeof operation === "string" ? pinnedSetting(operation) : undefined;
  if (!entry || entry.kind !== kind) return null;
  // These released routes only require the ability to chat with that agent.
  if (
    entry.operation === "settings.context-reset.clear" ||
    entry.operation === "settings.context-compact.compact" ||
    entry.operation === "settings.context-compact.compactTask"
  )
    return [AuthOrchestrationOperateScope];
  if (entry.operation.startsWith("settings.storage."))
    return kind === "read"
      ? [AuthOrchestrationReadScope, AuthFilesystemReadScope]
      : [AuthSettingsWriteScope, AuthFilesystemWriteScope];
  if (
    entry.operation === "settings.local-catalog.searchAgents" ||
    entry.operation === "settings.local-catalog.searchSkills" ||
    entry.operation === "settings.local-catalog.skill" ||
    entry.operation === "settings.local-catalog.skillBySlug"
  )
    return [AuthSettingsWriteScope];
  if (entry.operation.startsWith("settings.agent-hidden.") && kind === "read")
    return [AuthOrchestrationReadScope];
  if (
    entry.operation.startsWith("settings.sled-roster-pins.") ||
    entry.operation.startsWith("settings.sidebar-folders.")
  )
    return kind === "read"
      ? [AuthOrchestrationReadScope]
      : [AuthSettingsWriteScope, AuthOrchestrationOperateScope];
  const base: AuthEnvironmentScope[] = [AuthSettingsWriteScope, AuthProvidersManageScope];
  if (entry.operation.startsWith("settings.browser-proxies.")) base.push(AuthPreviewOperateScope);
  if (entry.operation.startsWith("settings.agent-access."))
    base.push(kind === "read" ? AuthAccessReadScope : AuthAccessWriteScope);
  if (entry.operation.startsWith("settings.agent-folders."))
    base.push(kind === "read" ? AuthFilesystemReadScope : AuthFilesystemWriteScope);
  if (
    entry.operation.startsWith("settings.agent-memories.") ||
    entry.operation.startsWith("settings.routine-results.") ||
    entry.operation.startsWith("settings.side-question.") ||
    entry.operation.startsWith("settings.conversation-reads.") ||
    entry.operation.startsWith("settings.workflows-github.")
  )
    base.push(kind === "read" ? AuthOrchestrationReadScope : AuthOrchestrationOperateScope);
  if (entry.operation.startsWith("settings.local-catalog.local"))
    base.push(kind === "read" ? AuthFilesystemReadScope : AuthFilesystemWriteScope);
  return base;
}
