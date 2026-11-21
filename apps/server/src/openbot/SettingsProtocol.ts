import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { pinnedSetting, type OpenbotSettingsRequest } from "@t3tools/contracts/openbot-settings";
class SettingsProtocolError extends Schema.TaggedError<SettingsProtocolError>()(
  "SettingsProtocolError",
  { cause: Schema.Unknown },
) {}
export function isRequest(request: {
  readonly operation: string;
}): request is OpenbotSettingsRequest {
  return pinnedSetting(request.operation) !== undefined;
}
export function route(request: OpenbotSettingsRequest) {
  const entry = pinnedSetting(request.operation);
  if (!entry) throw new Error("Unknown bot setting operation.");
  if ("method" in entry && entry.method === "GET") {
    entry.codec.request(request.parameters);
    return { method: "GET" as const, path: entry.path, settingsProjection: request.operation };
  }
  return {
    method: "POST" as const,
    path: entry.path,
    body: entry.codec.request(request.parameters),
    settingsProjection: request.operation,
  };
}
export const project = Effect.fn("OpenbotSettingsProtocol.project")(
  (operation: string, value: unknown) =>
    Effect.try({
      try: () => {
        const entry = pinnedSetting(operation);
        if (!entry) throw new Error("Unknown bot setting operation.");
        return entry.codec.response(200, value);
      },
      catch: (cause) => new SettingsProtocolError({ cause }),
    }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json))),
);
