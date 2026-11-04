import {
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
export function route(request: Request) {
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
const decodeList = Schema.decodeUnknownEffect(
  Schema.Array(OpenbotChannelSummary).check(Schema.isMaxLength(10_000)),
);
const decodeChannel = Schema.decodeUnknownEffect(OpenbotChannel);
const decodePage = Schema.decodeUnknownEffect(OpenbotChannelPage);
const decodePublicJson = Schema.decodeUnknownEffect(Schema.Json);
export const project = Effect.fn("OpenbotChannelProtocol.project")((
  operation: Request["operation"],
  value: unknown,
) => {
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
  return projected.pipe(Effect.flatMap(decodePublicJson));
});
