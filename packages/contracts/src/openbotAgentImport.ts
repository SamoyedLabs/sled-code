import * as Schema from "effect/Schema";
import {
  AGENT_IMPORT_CODECS,
  AGENT_IMPORT_ROUTES,
} from "./openbotPinnedSettings/agent-import-v1.ts";
export const IMPORT_CAPABILITY = "sled-agent-import-v1";
export const IMPORT_MAX_BYTES = 100 * 1024 * 1024;
const Text = Schema.String;
const Key = Text.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
export const ImportPreview = Schema.Struct({
  token: Key,
  sourceApp: Text,
  exportedAt: Schema.NullOr(Text),
  agents: Schema.Array(
    Schema.Struct({
      key: Key,
      name: Text,
      title: Text,
      description: Text,
      skillCount: Count,
      routineCount: Count,
      memoryCount: Count,
      fileCount: Count,
      fileBytes: Count,
      nameExists: Schema.Boolean,
    }),
  ),
  channels: Schema.Array(
    Schema.Struct({
      key: Key,
      name: Text,
      title: Text,
      memberKeys: Schema.Array(Key),
      leadKey: Schema.NullOr(Key),
      memoryCount: Count,
      routineCount: Count,
    }),
  ),
  warnings: Schema.Array(Text),
});
const Skipped = Schema.Array(Schema.Struct({ key: Key, name: Text, reason: Text }));
export const ImportResult = Schema.Struct({
  agents: Schema.Array(Schema.Struct({ agentId: Key, name: Text })),
  channels: Schema.Array(Schema.Struct({ id: Key, name: Text })),
  skipped: Skipped,
  skippedChannels: Skipped,
  warnings: Schema.Array(Text),
});
export const ImportReceipt = Schema.Struct({
  requestId: Key,
  token: Key,
  digest: Text,
  preview: ImportPreview,
  state: Schema.Literals(["staged", "applying", "uncertain", "complete", "discarded"]),
  result: Schema.NullOr(ImportResult),
  selection: Schema.NullOr(Text),
});
export type ImportReceipt = typeof ImportReceipt.Type;
export type ImportSelection = {
  readonly token: string;
  readonly keys: readonly string[];
  readonly channelKeys: readonly string[];
  readonly timezone: string;
};
export const ImportRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("import.status"), hostId: Key }),
  Schema.Struct({
    operation: Schema.Literal("import.stage"),
    hostId: Key,
    requestId: Key,
    uploadId: Key,
  }),
  Schema.Struct({
    operation: Schema.Literal("import.apply"),
    hostId: Key,
    token: Key,
    keys: Schema.Array(Key).check(Schema.isMaxLength(100)),
    channelKeys: Schema.Array(Key).check(Schema.isMaxLength(100)),
    timezone: Text.check(Schema.isMaxLength(255)),
  }),
  Schema.Struct({ operation: Schema.Literal("import.discard"), hostId: Key, token: Key }),
]);
export type ImportRequest = typeof ImportRequest.Type;
const decodeImportReceiptSync = Schema.decodeUnknownSync(ImportReceipt);
export function decodeImportReceipt(value: unknown): ImportReceipt | null {
  if (value === null) return null;
  const receipt = decodeImportReceiptSync(value);
  AGENT_IMPORT_CODECS.get(AGENT_IMPORT_ROUTES.stage)!.response(200, receipt.preview);
  if (receipt.preview.token !== receipt.token) throw new Error("Import preview identity mismatch");
  if (receipt.result)
    AGENT_IMPORT_CODECS.get(AGENT_IMPORT_ROUTES.apply)!.response(200, receipt.result);
  if ((receipt.state === "complete") !== (receipt.result !== null) && receipt.state !== "discarded")
    throw new Error("Invalid import result state");
  return receipt;
}

export const importApplyBody = (value: unknown) =>
  AGENT_IMPORT_CODECS.get(AGENT_IMPORT_ROUTES.apply)!.request(value);
export const importDiscardBody = (value: unknown) =>
  AGENT_IMPORT_CODECS.get(AGENT_IMPORT_ROUTES.discard)!.request(value);
