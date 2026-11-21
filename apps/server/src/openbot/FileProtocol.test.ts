import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Schema from "effect/Schema";
import { createFileSession } from "./FileProtocol.ts";

class Refused extends Schema.TaggedError<Refused>()("Refused", {}) {}

it.effect("checks authoritative stored-file ownership and availability before downloading", () =>
  Effect.gen(function* () {
    let owner = "bot";
    let available = true;
    const downloads: string[] = [];
    const session = createFileSession({
      authenticated: (path, method) =>
        HttpClientRequest.make(method)(`http://fixture.invalid${path}`),
      send: (request) =>
        Effect.sync(() => {
          const pathname = new URL(request.url).pathname;
          if (pathname === "/v1/storage/usage")
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                scope: "agent",
                agentId: "bot",
                files: [
                  {
                    id: "stored-file",
                    name: "report.txt",
                    size: 3,
                    kind: "file",
                    mimeType: "text/plain",
                    previewKind: "text",
                    agentId: owner,
                    status: available ? "available" : "missing",
                    conversation: { id: "real-conversation" },
                  },
                ],
              }),
            );
          downloads.push(pathname);
          return HttpClientResponse.fromWeb(
            request,
            new Response("abc", {
              headers: { "content-length": "3", "content-type": "text/plain" },
            }),
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
      kind: "stored" as const,
      fileId: "stored-file",
      conversationId: "real-conversation",
    };
    expect(yield* session.attachment("bot", source)).toMatchObject({ name: "report.txt", size: 3 });
    expect((yield* session.download("bot", source)).size).toBe(3);
    expect(downloads).toEqual(["/v1/attachments/stored-file"]);
    owner = "other-bot";
    expect(yield* Effect.flip(session.download("bot", source))).toBeInstanceOf(Refused);
    owner = "bot";
    available = false;
    expect(yield* Effect.flip(session.download("bot", source))).toBeInstanceOf(Refused);
    available = true;
    expect(
      yield* Effect.flip(
        session.download("bot", { ...source, conversationId: "other-conversation" }),
      ),
    ).toBeInstanceOf(Refused);
    expect(
      yield* Effect.flip(session.download("bot", { ...source, fileId: "unknown" })),
    ).toBeInstanceOf(Refused);
    expect(downloads).toHaveLength(1);
  }),
);

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

it.effect(
  "never falls back when guarded thread support is missing and carries the exact replay authority",
  () =>
    Effect.gen(function* () {
      let supported = false;
      const paths: string[] = [];
      const bodies: unknown[] = [];
      const session = createFileSession({
        authenticated: (path, method) =>
          HttpClientRequest.make(method)(`http://fixture.invalid${path}`),
        send: (request) =>
          Effect.sync(() => {
            const path = new URL(request.url).pathname;
            paths.push(path);
            if (path === "/v1/compatibility")
              return HttpClientResponse.fromWeb(
                request,
                Response.json({ capabilities: supported ? ["sled-files-identity-v1"] : [] }),
              );
            if (path !== "/v1/sled/files/send") throw new Error("Unexpected weaker route");
            if (request.body._tag === "Uint8Array")
              bodies.push(JSON.parse(new TextDecoder().decode(request.body.body)));
            return HttpClientResponse.fromWeb(
              request,
              Response.json({
                messageId: "receipt",
                deliveries: [{ id: "delivery", recipientAgentId: "bot", taskId: "task" }],
              }),
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
      const send = () =>
        session.send(
          "bot",
          "draft",
          "original",
          "operation",
          { kind: "task", taskId: "task" },
          true,
          ["draft"],
          undefined,
          "original-thread",
        );
      yield* Effect.flip(send());
      expect(paths).toEqual(["/v1/compatibility"]);
      supported = true;
      yield* send();
      expect(bodies).toEqual([
        {
          agentId: "bot",
          expectedThreadId: "original-thread",
          clientMessageId: "operation",
          text: "original",
          attachmentDraftIds: ["draft"],
          taskId: "task",
          replyToMessageId: null,
          receiptOnly: true,
        },
      ]);
      yield* Effect.flip(
        session.send(
          "bot",
          "draft",
          "original",
          "operation",
          { kind: "new-task" },
          false,
          ["draft"],
          undefined,
          "original-thread",
        ),
      );
      expect(paths).toEqual(["/v1/compatibility", "/v1/compatibility", "/v1/sled/files/send"]);
    }),
);

it.effect("binds signed original Files send and receipt-only lookup to the exact host", () =>
  Effect.gen(function* () {
    const signed: unknown[] = [];
    const session = createFileSession({
      authenticated: (path, method) =>
        HttpClientRequest.make(method)(`http://fixture.invalid${path}`),
      send: (request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              capabilities: ["sled-files-identity-v1", "sled-files-upload-recovery-v1"],
            }),
          ),
        ),
      json: (response) =>
        response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
          Effect.mapError(() => new Refused()),
        ),
      signedFiles: (_principal, _path, body) =>
        Effect.gen(function* () {
          if (
            typeof body !== "object" ||
            body === null ||
            !("hostId" in body) ||
            body.hostId !== "exact-host"
          )
            return yield* new Refused();
          signed.push(body);
          return {
            messageId: "receipt",
            deliveries: [{ id: "delivery", recipientAgentId: "bot", taskId: null }],
          };
        }),
      error: () => new Refused(),
      isError: Schema.is(Refused),
      isClosed: () => false,
    });
    const authority = {
      principal: "original-session",
      environmentId: "environment",
      hostId: "exact-host",
    };
    for (const lookup of [false, true])
      yield* session.send(
        "bot",
        "draft",
        "original",
        "original-operation",
        { kind: "main" },
        lookup,
        ["draft"],
        undefined,
        "original-thread",
        authority,
      );
    expect(signed).toEqual(
      [false, true].map((receiptOnly) => ({
        agentId: "bot",
        expectedThreadId: "original-thread",
        clientMessageId: "original-operation",
        text: "original",
        attachmentDraftIds: ["draft"],
        taskId: null,
        replyToMessageId: null,
        receiptOnly,
        environmentId: "environment",
        hostId: "exact-host",
      })),
    );
  }),
);

it.effect(
  "maps shared files to the authenticated shared root and rejects invalid transfer lengths",
  () =>
    Effect.gen(function* () {
      let length = "3";
      const paths: string[] = [];
      const session = createFileSession({
        authenticated: (path, method) => {
          paths.push(path);
          return HttpClientRequest.make(method)(`http://fixture.invalid${path}`);
        },
        send: (request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              new Response("abc", {
                headers: { "content-length": length, "content-type": "text/plain" },
              }),
            ),
          ),
        json: (response) =>
          response.json.pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
            Effect.mapError(() => new Refused()),
          ),
        error: () => new Refused(),
        isError: Schema.is(Refused),
        isClosed: () => false,
      });
      const file = yield* session.download("bot", {
        kind: "shared",
        path: "reports/one & two.txt",
      });
      expect(paths).toEqual(["/v1/shared-files?path=reports%2Fone+%26+two.txt"]);
      expect(file.size).toBe(3);
      expect(file.mimeType).toBe("text/plain");
      length = "104857601";
      expect(
        yield* Effect.flip(session.download("bot", { kind: "shared", path: "large.txt" })),
      ).toBeInstanceOf(Refused);
    }),
);

it.effect("requires the negotiated and signed route for a bound group file", () =>
  Effect.gen(function* () {
    let compatible = false;
    const requests: unknown[] = [];
    const session = createFileSession({
      authenticated: (path, method) =>
        HttpClientRequest.make(method)(`http://fixture.invalid${path}`),
      send: (request) => {
        expect(new URL(request.url).pathname).toBe("/v1/compatibility");
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              capabilities: [
                "sled-files-identity-v1",
                "sled-files-upload-recovery-v1",
                ...(compatible ? ["sled-channel-files-upload-recovery-v1"] : []),
              ],
            }),
          ),
        );
      },
      json: (response) =>
        response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
          Effect.mapError(() => new Refused()),
        ),
      signedFiles: (principal, path, body) =>
        Effect.sync(() => {
          requests.push({ principal, path, body });
          return { channelId: "group", messageId: "origin", receiptId: "accepted" };
        }),
      error: () => new Refused(),
      isError: Schema.is(Refused),
      isClosed: () => false,
    });
    const authority = { principal: "paired-session", environmentId: "environment", hostId: "host" };
    const send = (expectedThreadId: string, signed: boolean) =>
      session.send(
        "memberBot",
        "file",
        "send fixture",
        "fixed-message-id",
        { kind: "channel", channelId: "group" },
        false,
        ["file"],
        undefined,
        expectedThreadId,
        signed ? authority : undefined,
      );
    expect(yield* send("group", true).pipe(Effect.flip)).toBeInstanceOf(Refused);
    compatible = true;
    expect(yield* send("other-group", true).pipe(Effect.flip)).toBeInstanceOf(Refused);
    expect(yield* send("group", false).pipe(Effect.flip)).toBeInstanceOf(Refused);
    expect(requests).toEqual([]);
    expect(yield* send("group", true)).toMatchObject({ messageId: "accepted" });
    expect(requests).toEqual([
      {
        principal: "paired-session",
        path: "/v1/sled/files/channel-send",
        body: {
          agentId: "memberBot",
          channelId: "group",
          hostId: "host",
          environmentId: "environment",
          clientMessageId: "fixed-message-id",
          text: "send fixture",
          replyToMessageId: null,
          attachmentDraftIds: ["file"],
        },
      },
    ]);
  }),
);

it.effect("opens a library group file without inventing an agent or trusting its preview URL", () =>
  Effect.gen(function* () {
    const calls: string[] = [];
    const session = createFileSession({
      authenticated: (path, method) =>
        HttpClientRequest.make(method)(`http://fixture.invalid${path}`),
      send: (request) => {
        const pathname = new URL(request.url).pathname;
        calls.push(pathname);
        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            pathname === "/v1/storage/usage"
              ? Response.json({
                  scope: "host",
                  agentId: null,
                  files: [
                    {
                      id: "group-file",
                      name: "proof.png",
                      size: 3,
                      kind: "image",
                      mimeType: "image/png",
                      agentId: null,
                      conversation: null,
                      status: "available",
                      previewKind: "image",
                      previewUrl: "https://untrusted.invalid/preview",
                    },
                  ],
                })
              : new Response("abc", {
                  headers: { "content-length": "3", "content-type": "image/png" },
                }),
          ),
        );
      },
      json: (response) =>
        response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
          Effect.mapError(() => new Refused()),
        ),
      error: () => new Refused(),
      isError: Schema.is(Refused),
      isClosed: () => false,
    });
    const source = { kind: "library" as const, fileId: "group-file" };
    expect(yield* session.attachment(null, source)).toMatchObject({ name: "proof.png", size: 3 });
    expect((yield* session.download(null, source)).size).toBe(3);
    expect(
      yield* session.download(null, { ...source, fileId: "missing" }).pipe(Effect.flip),
    ).toBeInstanceOf(Refused);
    expect(calls.filter((path) => path.startsWith("/v1/attachments/"))).toEqual([
      "/v1/attachments/group-file",
    ]);
  }),
);
