import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Schema from "effect/Schema";
import { createFileSession } from "./FileProtocol.ts";

class Refused extends Schema.TaggedError<Refused>()("Refused", {}) {}

it.effect(
  "keeps channel assignments separate from side tasks and refuses foreign channel attachments",
  () =>
    Effect.gen(function* () {
      const commands: string[] = [];
      const page = {
        channel: {
          id: "channel",
          name: "Team",
          title: "",
          instructions: "",
          members: [{ agentId: "bot" }],
          leadAgentId: "bot",
          archived: false,
          revision: 1,
          createdAt: "now",
        },
        tasks: [],
        messages: [
          {
            id: "message",
            channelId: "channel",
            sequence: 1,
            author: { kind: "member", id: "owner", name: "Owner" },
            taskId: null,
            superseded: false,
            message: {
              id: "message",
              author: "user",
              text: "file",
              createdAt: "now",
              status: "completed",
              attachments: [
                {
                  id: "file",
                  name: "file.txt",
                  size: 3,
                  kind: "file",
                  mimeType: "text/plain",
                  previewKind: "text",
                  previewUrl: null,
                },
              ],
            },
          },
        ],
        olderCursor: null,
        throughSequence: 1,
      };
      const session = createFileSession({
        authenticated: (path, method) =>
          HttpClientRequest.make(method)(`http://fixture.invalid${path}`),
        send: (request) =>
          Effect.sync(() => {
            const path = new URL(request.url).pathname;
            if (path === "/v1/channels/commands") commands.push(path);
            if (path !== "/v1/channels/read" && path !== "/v1/channels/commands")
              throw new Error("Channel tasks must never use side-task routes");
            return HttpClientResponse.fromWeb(
              request,
              Response.json(path === "/v1/channels/commands" ? page.channel : page),
            );
          }),
        json: (response) =>
          response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
            Effect.mapError(() => new Refused()),
          ),
        error: () => new Refused(),
        isError: Schema.is(Refused),
        isClosed: () => false,
      });
      const source = {
        kind: "attachment" as const,
        channelId: "channel",
        messageId: "message",
        attachmentId: "file",
      };
      expect(yield* session.attachment("bot", source)).toMatchObject({
        id: "file",
        name: "file.txt",
      });
      expect(
        yield* Effect.flip(session.attachment("bot", { ...source, channelId: "foreign" })),
      ).toBeInstanceOf(Refused);
      expect(
        yield* Effect.flip(session.attachment("bot", { ...source, attachmentId: "foreign" })),
      ).toBeInstanceOf(Refused);
      expect(
        yield* Effect.flip(
          session.send(
            "outsider",
            "draft",
            "Work",
            "op",
            { kind: "channel", channelId: "channel" },
            false,
          ),
        ),
      ).toBeInstanceOf(Refused);
      expect(commands).toEqual([]);
      expect(
        yield* session.send(
          "bot",
          "draft",
          "Work",
          "op",
          { kind: "channel", channelId: "channel" },
          false,
        ),
      ).toEqual({ messageId: null, conversationMessageId: null, taskId: null });
      expect(commands).toHaveLength(1);
    }),
);
