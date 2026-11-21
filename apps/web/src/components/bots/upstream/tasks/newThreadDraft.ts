import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
const Attempt = Schema.Struct({
  principalId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))),
  clientMessageId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  text: Schema.String.check(Schema.isMaxLength(100_000)),
  attachmentIds: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))).check(
      Schema.isMaxLength(10),
    ),
  ),
});
export type NewThreadAttempt = typeof Attempt.Type;
const decode = Schema.decodeUnknownResult(Attempt);
const key = (scope: string) => `sled:openbot:new-thread-attempt:${scope}`;
type StoragePort = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readNewThreadAttempt(scope: string, storage: StoragePort): NewThreadAttempt | null {
  try {
    const parsed = decode(JSON.parse(storage.getItem(key(scope)) ?? "null"));
    return Result.isSuccess(parsed) &&
      (parsed.success.text.trim() || parsed.success.attachmentIds?.length)
      ? parsed.success
      : null;
  } catch {
    return null;
  }
}
export function retainNewThreadAttempt(
  scope: string,
  attempt: NewThreadAttempt,
  storage: StoragePort,
) {
  try {
    const encoded = JSON.stringify(attempt);
    storage.setItem(key(scope), encoded);
    return storage.getItem(key(scope)) === encoded;
  } catch {
    return false;
  }
}
export function clearNewThreadAttempt(scope: string, storage: StoragePort) {
  try {
    storage.removeItem(key(scope));
  } catch {
    /* A browser preference must not prevent opening an accepted thread. */
  }
}
