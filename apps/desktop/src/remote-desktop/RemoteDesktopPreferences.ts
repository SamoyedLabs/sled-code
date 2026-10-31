import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

export const RemoteDesktopPreferences = Schema.Struct({
  enabled: Schema.Boolean,
  lifecycle: Schema.Literals(["with-t3", "persistent"]),
  clipboard: Schema.Boolean,
  "virtual-display": Schema.Boolean,
  audio: Schema.Boolean,
  "direct-wireless": Schema.Boolean,
  remote: Schema.Boolean,
  internet: Schema.Boolean,
});
export type RemoteDesktopPreferences = typeof RemoteDesktopPreferences.Type;
export const DEFAULT_REMOTE_DESKTOP: RemoteDesktopPreferences = {
  enabled: false,
  lifecycle: "with-t3",
  clipboard: true,
  "virtual-display": true,
  audio: true,
  "direct-wireless": false,
  remote: true,
  internet: true,
};
const decode = Schema.decodeUnknownOption(RemoteDesktopPreferences);
export const normalizeRemoteDesktopPreferences = (value: unknown): RemoteDesktopPreferences =>
  Option.getOrElse(
    decode(value && typeof value === "object" ? { lifecycle: "with-t3", ...value } : value),
    () => DEFAULT_REMOTE_DESKTOP,
  );
export const sameRemoteDesktopPreferences = Schema.toEquivalence(RemoteDesktopPreferences);
