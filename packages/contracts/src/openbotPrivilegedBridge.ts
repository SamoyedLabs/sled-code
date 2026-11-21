import * as Schema from "effect/Schema";
import { PrivilegedResponseRequest } from "./openbotPrivilegedResponse.ts";
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const OpenbotPrivilegedScopeInput = Schema.Struct({ hostId: Id });
export const OpenbotPrivilegedScope = Schema.Struct({
  hostId: Id,
  environmentId: Id,
  principalId: Id,
  available: Schema.Boolean,
});
export type OpenbotPrivilegedScope = typeof OpenbotPrivilegedScope.Type;
export const OpenbotPrivilegedExecuteInput = Schema.Struct({
  hostId: Id,
  principalId: Id,
  request: PrivilegedResponseRequest,
});
export type OpenbotPrivilegedExecuteInput = typeof OpenbotPrivilegedExecuteInput.Type;
export class OpenbotPrivilegedResponseError extends Schema.TaggedError<OpenbotPrivilegedResponseError>()(
  "OpenbotPrivilegedResponseError",
  {},
) {
  override get message() {
    return "Secure response is unavailable or its outcome is not confirmed.";
  }
}
