import {
  OpenbotChannelMemory,
  OpenbotChannelRoutine,
  OpenbotChannelRoutineRun,
  OpenbotChannel,
  OpenbotChannelSummary,
  OpenbotChannelPage,
  type OpenbotChannelReadRequest,
  type OpenbotChannelAdminRequest,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

type Request = OpenbotChannelReadRequest | OpenbotChannelAdminRequest;
export function isRequest(request: { readonly operation: string }): request is Request {
  return request.operation.startsWith("channel.");
}
const settingsPaths = {
  "channel.memories": "/v1/channels/memories",
  "channel.memory.create": "/v1/channels/memories/create",
  "channel.memory.update": "/v1/channels/memories/update",
  "channel.memory.delete": "/v1/channels/memories/delete",
  "channel.memory.clear": "/v1/channels/memories/clear",
  "channel.routines": "/v1/channels/routines",
  "channel.routine.create": "/v1/channels/routines/create",
  "channel.routine.update": "/v1/channels/routines/update",
  "channel.routine.delete": "/v1/channels/routines/delete",
  "channel.routine.test": "/v1/channels/routines/test",
  "channel.routine.runs": "/v1/channels/routines/runs",
} as const;
export function route(request: Request) {
  if (request.operation in settingsPaths) {
    const { operation, ...body } = request;
    return {
      method: "POST" as const,
      path: settingsPaths[operation as keyof typeof settingsPaths],
      body,
      channelProjection: operation,
    };
  }
  if (request.operation === "channel.list")
    return { method: "GET" as const, path: "/v1/channels", channelProjection: request.operation };
  if (request.operation === "channel.read")
    return {
      method: "POST" as const,
      path: "/v1/channels/read",
      body: {
        channelId: request.channelId,
        ...(request.beforeSequence == null ? {} : { beforeSequence: request.beforeSequence }),
      },
      channelProjection: request.operation,
    };
  if (request.operation === "channel.delete")
    return {
      method: "POST" as const,
      path: "/v1/channels/delete",
      body: { channelId: request.channelId },
      channelProjection: request.operation,
    };
  const { operation, ...input } = request;
  const type = operation === "channel.markRead" ? "read" : operation.slice("channel.".length);
  const body =
    request.operation === "channel.save"
      ? {
          type,
          channelId: request.channelId,
          operationId: request.operationId,
          draft: request.draft,
          ...(request.update ? { update: true } : {}),
        }
      : { type, ...input };
  return {
    method: "POST" as const,
    path: "/v1/channels/commands",
    body,
    channelProjection: operation,
  };
}
const settingsSchemas = {
  "channel.memories": Schema.Array(OpenbotChannelMemory).check(Schema.isMaxLength(64)),
  "channel.memory.create": OpenbotChannelMemory,
  "channel.memory.update": OpenbotChannelMemory,
  "channel.memory.delete": Schema.Null,
  "channel.memory.clear": Schema.Null,
  "channel.routines": Schema.Array(OpenbotChannelRoutine).check(Schema.isMaxLength(64)),
  "channel.routine.create": OpenbotChannelRoutine,
  "channel.routine.update": OpenbotChannelRoutine,
  "channel.routine.delete": Schema.Null,
  "channel.routine.test": OpenbotChannelRoutineRun,
  "channel.routine.runs": Schema.Array(OpenbotChannelRoutineRun).check(Schema.isMaxLength(100)),
} as const;
const decodeList = Schema.decodeUnknownEffect(
  Schema.Array(OpenbotChannelSummary).check(Schema.isMaxLength(10_000)),
);
const decodeChannel = Schema.decodeUnknownEffect(OpenbotChannel);
const decodePage = Schema.decodeUnknownEffect(OpenbotChannelPage);
const decodePublicJson = Schema.decodeUnknownEffect(Schema.Json);
export const project = Effect.fn("OpenbotChannelProtocol.project")(
  (operation: Request["operation"], value: unknown) =>
    Effect.gen(function* () {
      if (operation in settingsSchemas) {
        const schema: Schema.Codec<unknown> =
          settingsSchemas[operation as keyof typeof settingsSchemas];
        return yield* Schema.decodeUnknownEffect(schema)(value).pipe(
          Effect.flatMap(decodePublicJson),
        );
      }
      const projected: Effect.Effect<unknown, Schema.SchemaError> =
        operation === "channel.delete"
          ? Effect.succeed(null)
          : operation === "channel.list"
            ? decodeList(value)
            : operation === "channel.read"
              ? decodePage(value).pipe(
                  Effect.map((page) => ({
                    ...page,
                    messages: page.messages.map((message) => ({
                      ...message,
                      message: {
                        ...message.message,
                        ...(message.message.attachments === undefined
                          ? {}
                          : {
                              attachments: message.message.attachments.map((attachment) => ({
                                ...attachment,
                                previewUrl: null,
                              })),
                            }),
                      },
                    })),
                  })),
                )
              : decodeChannel(value);
      return yield* projected.pipe(Effect.flatMap(decodePublicJson));
    }),
);
