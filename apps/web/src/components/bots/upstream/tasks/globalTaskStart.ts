import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Attempt = Schema.Struct({
  agentId: Id,
  principalId: Id,
  requestId: Id,
  text: Schema.String.check(Schema.isMaxLength(100000)),
  fileIds: Schema.Array(Id).check(Schema.isMaxLength(10)),
  phase: Schema.Literals(["queued", "attempted"]),
});
export type GlobalTaskAttempt = typeof Attempt.Type;
const decode = Schema.decodeUnknownResult(Attempt);
const decodeCreated = Schema.decodeUnknownResult(Schema.Struct({ id: Id, agentId: Id }));
export function globalTaskCreated(value: unknown, agentId: string) {
  const result = decodeCreated(value);
  return Result.isSuccess(result) && result.success.agentId === agentId ? result.success.id : null;
}
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const key = (scope: string) => `sled:openbot:global-task-start:${scope}`;
export function readGlobalTaskAttempt(
  scope: string,
  storage: StoragePort,
): GlobalTaskAttempt | null {
  try {
    const result = decode(JSON.parse(storage.getItem(key(scope)) ?? "null"));
    return Result.isSuccess(result) && (result.success.text.trim() || result.success.fileIds.length)
      ? result.success
      : null;
  } catch {
    return null;
  }
}
export function saveGlobalTaskAttempt(
  scope: string,
  value: GlobalTaskAttempt,
  storage: StoragePort,
) {
  try {
    const encoded = JSON.stringify(value);
    storage.setItem(key(scope), encoded);
    return storage.getItem(key(scope)) === encoded;
  } catch {
    return false;
  }
}
export function clearGlobalTaskAttempt(scope: string, storage: StoragePort) {
  try {
    storage.removeItem(key(scope));
    return storage.getItem(key(scope)) === null;
  } catch {
    return false;
  }
}
