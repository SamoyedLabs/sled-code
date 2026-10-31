import * as Schema from "effect/Schema";

const Identifier = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
);
export const RemoteDesktopSessionId = Identifier;
export const RemoteDesktopFingerprint = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9_-]{43}$/),
);
const Description = Schema.String.check(
  Schema.isMaxLength(65_536),
  Schema.isPattern(/^v=0\r?\n/),
  Schema.isPattern(/^[\x09\x0a\x0d\x20-\x7e]*$/),
  Schema.makeFilter(
    (sdp) => sdp.split("\n").filter((line) => line.startsWith("a=candidate:")).length <= 64,
    { expected: "at most 64 ICE candidates" },
  ),
);
const Deadline = Schema.Int.check(Schema.isGreaterThan(0));
const IceUrl = Schema.String.check(
  Schema.isMaxLength(512),
  Schema.isPattern(
    /^(stun|turn|turns):(\[[0-9A-Fa-f:]+\]|[A-Za-z0-9.-]+)(:[0-9]{1,5})?(\?transport=(udp|tcp))?$/,
  ),
  Schema.makeFilter(
    (url) => {
      const authority = url.slice(url.indexOf(":") + 1).split("?")[0] ?? "";
      const port = authority.match(/:([0-9]+)$/)?.[1];
      return port === undefined || (Number(port) > 0 && Number(port) <= 65_535);
    },
    { expected: "a valid ICE endpoint and port" },
  ),
);
const IceSecret = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(1024),
  Schema.isPattern(/^[\x20-\x7e]+$/),
);
export const RemoteDesktopIceServer = Schema.Struct({
  urls: Schema.Array(IceUrl).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
  username: Schema.optionalKey(IceSecret),
  credential: Schema.optionalKey(IceSecret),
}).check(
  Schema.makeFilter(
    (server) =>
      server.urls.every(
        (url) =>
          url.startsWith("stun:") ||
          (server.username !== undefined &&
            server.credential !== undefined &&
            !(url.startsWith("turns:") && url.endsWith("transport=udp"))),
      ),
    { expected: "authenticated TURN endpoints" },
  ),
);
export const RemoteDesktopConnectivity = Schema.Struct({
  iceServers: Schema.Array(RemoteDesktopIceServer).check(Schema.isMaxLength(8)),
  expiresAt: Deadline,
  relayOnly: Schema.Boolean,
  relayAvailable: Schema.Boolean,
});
export type RemoteDesktopConnectivity = typeof RemoteDesktopConnectivity.Type;

export const RemoteDesktopErrorReason = Schema.Literals([
  "unavailable",
  "disabled",
  "forbidden",
  "not_found",
  "limit",
  "expired",
  "revoked",
  "transport",
  "identity_mismatch",
  "authorization_unavailable",
]);
export type RemoteDesktopErrorReason = typeof RemoteDesktopErrorReason.Type;
export class RemoteDesktopError extends Schema.TaggedError<RemoteDesktopError>()(
  "RemoteDesktopError",
  {
    reason: RemoteDesktopErrorReason,
  },
) {
  override get message(): string {
    return `Remote desktop session failed (${this.reason}).`;
  }
}

export const RemoteDesktopStatus = Schema.Struct({
  permissions: Schema.optionalKey(
    Schema.Struct({ screenRecording: Schema.Boolean, accessibility: Schema.Boolean }),
  ),
  available: Schema.Boolean,
  enabled: Schema.Boolean,
  remoteEnabled: Schema.Boolean,
  internetEnabled: Schema.Boolean,
  hostFingerprint: Schema.NullOr(RemoteDesktopFingerprint),
  connectivity: Schema.optionalKey(RemoteDesktopConnectivity),
});
export type RemoteDesktopStatus = typeof RemoteDesktopStatus.Type;
export const RemoteDesktopStartInput = Schema.Struct({
  clientNonce: Identifier,
  clientFingerprint: RemoteDesktopFingerprint,
  hostFingerprint: RemoteDesktopFingerprint,
  offer: Description,
});
export type RemoteDesktopStartInput = typeof RemoteDesktopStartInput.Type;
export const RemoteDesktopSessionInput = Schema.Struct({ sessionId: RemoteDesktopSessionId });
export type RemoteDesktopSessionInput = typeof RemoteDesktopSessionInput.Type;
export const RemoteDesktopRestartInput = Schema.Struct({
  ...RemoteDesktopSessionInput.fields,
  offer: Description,
});
export type RemoteDesktopRestartInput = typeof RemoteDesktopRestartInput.Type;
export const RemoteDesktopLease = Schema.Struct({
  sessionId: RemoteDesktopSessionId,
  expiresAt: Deadline,
});
export type RemoteDesktopLease = typeof RemoteDesktopLease.Type;
export const RemoteDesktopAnswer = Schema.Struct({
  ...RemoteDesktopLease.fields,
  clientNonce: Identifier,
  hostFingerprint: RemoteDesktopFingerprint,
  answer: Description,
});
export type RemoteDesktopAnswer = typeof RemoteDesktopAnswer.Type;

// Only the environment server issues these native leases; clients never set deadlines.
const StartCommand = Schema.Struct({
  type: Schema.Literal("start"),
  ...RemoteDesktopStartInput.fields,
  ...RemoteDesktopLease.fields,
  connectivity: Schema.optionalKey(RemoteDesktopConnectivity),
});
export const RemoteDesktopNativeCommand = Schema.Union([
  Schema.Struct({ type: Schema.Literal("status") }),
  StartCommand,
  Schema.Struct({
    type: Schema.Literal("restart"),
    ...RemoteDesktopRestartInput.fields,
    ...RemoteDesktopLease.fields,
    clientNonce: Identifier,
    hostFingerprint: RemoteDesktopFingerprint,
    connectivity: RemoteDesktopConnectivity,
  }),
  Schema.Struct({ type: Schema.Literal("renew"), ...RemoteDesktopLease.fields }),
  Schema.Struct({ type: Schema.Literal("stop"), sessionId: RemoteDesktopSessionId }),
]);
export type RemoteDesktopNativeCommand = typeof RemoteDesktopNativeCommand.Type;
export const RemoteDesktopNativeRequest = Schema.Struct({
  requestId: Identifier,
  command: RemoteDesktopNativeCommand,
});
export type RemoteDesktopNativeRequest = typeof RemoteDesktopNativeRequest.Type;
export const RemoteDesktopNativeResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("status"), status: RemoteDesktopStatus }),
  Schema.Struct({ type: Schema.Literal("answer"), ...RemoteDesktopAnswer.fields }),
  Schema.Struct({ type: Schema.Literal("renewed"), ...RemoteDesktopLease.fields }),
  Schema.Struct({ type: Schema.Literal("stopped"), sessionId: RemoteDesktopSessionId }),
  Schema.Struct({ type: Schema.Literal("error"), reason: RemoteDesktopErrorReason }),
]);
export type RemoteDesktopNativeResult = typeof RemoteDesktopNativeResult.Type;
export const RemoteDesktopNativeEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("reply"),
    requestId: Identifier,
    result: RemoteDesktopNativeResult,
  }),
  Schema.Struct({ type: Schema.Literal("closed"), sessionId: RemoteDesktopSessionId }),
  Schema.Struct({ type: Schema.Literal("unavailable") }),
]);
export type RemoteDesktopNativeEvent = typeof RemoteDesktopNativeEvent.Type;
