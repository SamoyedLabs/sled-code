import * as Schema from "effect/Schema";
export const DesktopRemoteDesktopSetting = Schema.Literals([
  "clipboard",
  "virtual-display",
  "audio",
  "direct-wireless",
  "remote",
  "internet",
]);
export const DesktopRemoteDesktopCommand = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("lifecycle"),
    value: Schema.Literals(["with-t3", "persistent"]),
  }),
  Schema.Struct({
    action: Schema.Literals([
      "enable",
      "disable",
      "permissions",
      "pair",
      "cancel-pairing",
      "forget-devices",
    ]),
  }),
  Schema.Struct({
    action: Schema.Literal("setting"),
    key: DesktopRemoteDesktopSetting,
    value: Schema.Boolean,
  }),
]);
export type DesktopRemoteDesktopCommand = typeof DesktopRemoteDesktopCommand.Type;
export const DesktopRemoteDesktopState = Schema.Struct({
  lifecycle: Schema.Literals(["with-t3", "persistent"]),
  enabled: Schema.Boolean,
  ready: Schema.Boolean,
  pairing: Schema.Boolean,
  preferences: Schema.Record(DesktopRemoteDesktopSetting, Schema.Boolean),
  permissions: Schema.NullOr(
    Schema.Struct({
      screenRecording: Schema.Boolean,
      accessibility: Schema.Boolean,
    }),
  ),
});
export type DesktopRemoteDesktopState = typeof DesktopRemoteDesktopState.Type;
