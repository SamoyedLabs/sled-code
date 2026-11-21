// @effect-diagnostics globalDate:off - Pure timestamp validation matches the frozen setup decoder.
import * as Schema from "effect/Schema";
const Id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const Text = Schema.String.check(Schema.isMaxLength(255));
const Count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));
const Platform = Schema.Literals(["darwin", "win32", "linux"]);
export const OpenbotComputerDisplay = Schema.Struct({
  id: Id,
  label: Text,
  width: Count,
  height: Count,
  primary: Schema.Boolean,
});
export const OpenbotComputerCapabilities = Schema.Struct({
  ready: Schema.Boolean,
  platform: Platform,
  unattended: Schema.Boolean,
  runtime: Schema.Literal("sunshine-moonlight"),
  protocolVersion: Schema.Literal(2),
  displays: Schema.Array(OpenbotComputerDisplay).check(Schema.isMaxLength(128)),
  selectedDisplayId: Schema.NullOr(Id),
  activeSessions: Count,
  maxSessions: Count,
});
export type OpenbotComputerCapabilities = typeof OpenbotComputerCapabilities.Type;
const Check = Schema.Literals([
  "not-checked",
  "checking",
  "allowed",
  "blocked",
  "unavailable",
  "failed",
]);
export const OpenbotComputerSetup = Schema.Struct({
  platform: Platform,
  hostName: Text,
  username: Text,
  checkedAt: Schema.NullOr(
    Schema.String.check(
      Schema.isMaxLength(40),
      Schema.makeFilter((value) => Number.isFinite(Date.parse(value))),
    ),
  ),
  screenRecording: Check,
  accessibility: Check,
  service: Check,
  displays: Check,
  guiSession: Check,
  restartRequired: Schema.Boolean,
  activeSessions: Count,
  message: Schema.NullOr(Schema.String.check(Schema.isMaxLength(1000))),
});
export type OpenbotComputerSetup = typeof OpenbotComputerSetup.Type;
export const OpenbotComputerReadRequest = Schema.Struct({
  operation: Schema.Literal("computer.capabilities"),
});
export const OpenbotComputerAdminRequest = Schema.Union([
  Schema.Struct({ operation: Schema.Literal("computer.setup") }),
  Schema.Struct({ operation: Schema.Literal("computer.display"), displayId: Id }),
]);
export type OpenbotComputerReadRequest = typeof OpenbotComputerReadRequest.Type;
export type OpenbotComputerAdminRequest = typeof OpenbotComputerAdminRequest.Type;

export const OpenbotComputerViewCommand = Schema.Union([
  Schema.Struct({
    operation: Schema.Literal("open"),
    hostId: Id,
    frameOrigin: Schema.String.check(Schema.isMaxLength(512)),
  }),
  Schema.Struct({ operation: Schema.Literal("close"), hostId: Id, id: Id }),
]);
export type OpenbotComputerViewCommand = typeof OpenbotComputerViewCommand.Type;
export const OpenbotComputerViewerGrant = Schema.Struct({
  id: Id,
  hostId: Id,
  ticket: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  expiresAt: Schema.Number.check(Schema.isFinite()),
});
export type OpenbotComputerViewerGrant = typeof OpenbotComputerViewerGrant.Type;
