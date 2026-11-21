import { assert, it } from "@effect/vitest";
import { OPENBOT_LIBRARY_AUTOMATIC_IMAGE_LIMIT } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { HttpServerResponse } from "effect/http";
import { createFileSession } from "../openbot/FileProtocol.ts";
import { Integration, IntegrationError } from "../openbot/Integration.ts";
import { TeamClientError } from "../openbot/TeamClient.ts";
import { botLibraryImageResponse } from "./BotLibraryImage.ts";

it.effect("streams a large library image from its exact host and rejects unsafe metadata", () =>
  Effect.gen(function* () {
    const source = {
      version: 1,
      kind: "bot-library-image",
      hostId: "host",
      fileId: "private-file",
      conversationId: "chat",
      expiresAt: 10,
    } as const;
    const bytes = new Uint8Array(1_176_003).fill(37);
    const base = createFileSession({
      authenticated: () => {
        throw new Error("Unexpected attachment transport");
      },
      send: () => Effect.die("Unexpected attachment transport"),
      json: () => Effect.die("Unexpected attachment transport"),
      error: (reason, cause) => new TeamClientError({ reason, cause }),
      isError: Schema.is(TeamClientError),
      isClosed: () => false,
    });
    let size = bytes.length;
    let mimeType = "image/png";
    let reads = 0;
    const transport = Layer.mock(Integration)({
      withFilesToHost: (hostId, action) =>
        hostId === source.hostId
          ? action({
              ...base,
              attachment: (agentId, input) => {
                assert.isNull(agentId);
                assert.deepEqual(input, {
                  kind: "library",
                  fileId: source.fileId,
                  conversationId: source.conversationId,
                });
                return Effect.succeed({
                  id: source.fileId,
                  name: "fixture.png",
                  size,
                  mimeType,
                  kind: "image",
                  previewKind: "image",
                });
              },
              download: () =>
                Effect.sync(() => {
                  reads++;
                  return {
                    size,
                    mimeType: "application/octet-stream",
                    body: Stream.make(bytes.subarray(0, 512_000), bytes.subarray(512_000)),
                  };
                }),
            }).pipe(Effect.mapError((cause) => new IntegrationError({ message: "fixture", cause })))
          : Effect.fail(new IntegrationError({ message: "Wrong host.", cause: "host-mismatch" })),
    });
    const serve = (hostId: string = source.hostId) =>
      botLibraryImageResponse({ ...source, hostId }).pipe(Effect.provide(transport));
    const response = HttpServerResponse.toWeb(yield* serve());
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.headers.get("content-type"), "image/png");
    assert.strictEqual(response.headers.get("cache-control"), "private, no-store");
    assert.deepEqual(new Uint8Array(yield* Effect.promise(() => response.arrayBuffer())), bytes);
    assert.strictEqual((yield* serve("wrong-host")).status, 404);
    size = OPENBOT_LIBRARY_AUTOMATIC_IMAGE_LIMIT + 1;
    assert.strictEqual((yield* serve()).status, 404);
    size = bytes.length;
    mimeType = "image/svg+xml";
    assert.strictEqual((yield* serve()).status, 404);
    assert.strictEqual(reads, 1);
  }),
);
