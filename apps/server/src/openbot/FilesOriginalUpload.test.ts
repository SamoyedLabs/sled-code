import * as Schema from "effect/Schema";
import type { OpenbotOriginalUploadIdentity } from "../../../../packages/contracts/src/openbotFiles.ts";
import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
// @effect-diagnostics nodeBuiltinImport:off -- Hashing owned binary test fixtures.
import * as NodeCrypto from "node:crypto";
import { expect, it } from "@effect/vitest";
import { AuthSessionId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import * as FileSystem from "effect/FileSystem";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Config from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { AuthSessionRepository } from "../persistence/AuthSessions.ts";
import * as Files from "./Files.ts";
import * as Integration from "./Integration.ts";
import * as TeamClient from "./TeamClient.ts";
import { createFileSession } from "./FileProtocol.ts";
import { createPendingAttachmentId } from "../attachmentStore.ts";

it.live.each([undefined, "group"] as const)(
  "recovers the %s upload journal and fences it to the original app session",
  (channelId) =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const fs = yield* FileSystem.FileSystem;
      const config = yield* Config.ServerConfig;
      const bytes = Buffer.from("owned bytes");
      const attachmentId = createPendingAttachmentId(".txt");
      const path = resolveAttachmentRelativePath({
        attachmentsDir: config.attachmentsDir,
        relativePath: `${attachmentId}.txt`,
      })!;
      yield* fs.makeDirectory(path.slice(0, path.lastIndexOf("/")), { recursive: true });
      yield* fs.writeFile(path, bytes);
      const input = {
        operationId: "original-op",
        hostId: "host",
        agentId: "agent",
        threadId: channelId ?? "thread",
        ...(channelId ? { channelId } : {}),
        taskId: null,
        name: "source.txt",
        size: bytes.length,
        mimeType: "text/plain",
        sha256: NodeCrypto.createHash("sha256").update(bytes).digest("hex"),
        attachmentId,
      };
      const principal = AuthSessionId.make("session-original");
      let revoked = false,
        uploads = 0;
      const attachment = {
        id: "host-draft",
        name: input.name,
        size: input.size,
        mimeType: input.mimeType,
        kind: "file" as const,
        previewKind: "text" as const,
      };
      const baseProtocol = createFileSession({
        authenticated: (url, method) => HttpClientRequest.make(method)(url),
        send: () => Effect.die("Unexpected legacy transport"),
        json: () => Effect.die("Unexpected legacy transport"),
        error: (reason, cause) => new TeamClient.TeamClientError({ reason, cause }),
        isError: Schema.is(TeamClient.TeamClientError),
        isClosed: () => false,
      });
      let consumed = false;
      let sentId: string | undefined;
      const protocol = {
        ...baseProtocol,
        send: (...args: Parameters<typeof baseProtocol.send>) => {
          const clientMessageId = args[3];
          const reconcile = args[5];
          if (!consumed) {
            expect(reconcile).toBe(false);
            consumed = true;
            sentId = clientMessageId;
            return Effect.fail(new TeamClient.TeamClientError({ reason: "transport" }));
          }
          expect(reconcile).toBe(true);
          expect(clientMessageId).toBe(sentId);
          return Effect.succeed({
            messageId: "delivery",
            conversationMessageId: null,
            taskId: null,
          });
        },
        originalUpload: Effect.fn("test.originalUpload")(
          function* (
            _principal: string,
            _environmentId: string,
            identity: OpenbotOriginalUploadIdentity,
            action: "upload" | "upload-status" | "upload-cancel",
          ) {
            const rows = yield* sql<{
              upload_json: string;
            }>`SELECT upload_json FROM openbot_file_drafts`;
            expect(rows).toHaveLength(1);
            expect(rows[0]!.upload_json).toContain(principal);
            expect(JSON.parse(rows[0]!.upload_json).channelId).toBe(channelId);
            expect(identity.channelId).toBe(channelId);
            if (action === "upload") {
              uploads++;
              return yield* new TeamClient.TeamClientError({ reason: "transport" });
            }
            return { state: consumed ? ("released" as const) : ("ready" as const), attachment };
          },
          Effect.mapError(
            (cause) => new TeamClient.TeamClientError({ reason: "transport", cause }),
          ),
        ),
      };
      const dependencies = Layer.mergeAll(
        Layer.mock(AuthSessionRepository)({
          getById: ({ sessionId }) =>
            Effect.sync(() =>
              Option.some({
                sessionId,
                subject: "fixture",
                scopes: [],
                method: "bearer-access-token",
                client: {
                  label: null,
                  ipAddress: null,
                  userAgent: null,
                  deviceType: "unknown",
                  os: null,
                  browser: null,
                },
                issuedAt: DateTime.makeUnsafe(0),
                expiresAt: DateTime.makeUnsafe("2099-01-01"),
                lastConnectedAt: null,
                revokedAt: revoked ? DateTime.makeUnsafe(0) : null,
              }),
            ),
        }),
        Layer.mock(Integration.Integration)({
          withFilesToHost: (_host, action) =>
            action(protocol).pipe(
              Effect.mapError(
                (cause) =>
                  new Integration.IntegrationError({ message: "fixture transport", cause }),
              ),
            ),
        }),
      );
      const use = <A, E>(action: (files: Files.Files["Service"]) => Effect.Effect<A, E>) =>
        Effect.gen(function* () {
          return yield* action(yield* Files.Files);
        }).pipe(Effect.provide(Files.layer.pipe(Layer.provide(dependencies))));
      expect(
        yield* use((files) => files.originalUpload(principal, "environment", input, "upload")).pipe(
          Effect.flip,
        ),
      ).toBeDefined();
      const recovered = yield* use((files) =>
        files.originalUpload(principal, "environment", input, "upload-status"),
      );
      expect(recovered.draft?.attachment.id).toBe("host-draft");
      expect(uploads).toBe(1);
      expect(yield* use((files) => files.listDrafts(input))).toEqual([]);
      expect(
        yield* use((files) =>
          files.listDrafts(input, { principal: "other-session", environmentId: "environment" }),
        ),
      ).toEqual([]);
      expect(
        yield* use((files) => files.listDrafts(input, { principal, environmentId: "environment" })),
      ).toHaveLength(1);
      expect(
        yield* use((files) =>
          files.sendDraft(
            {
              ...input,
              attachmentId: "host-draft",
              text: "message",
              expectedThreadId: input.threadId,
              ...(channelId ? { target: { kind: "channel", channelId } } : {}),
            },
            { principal: "other-session", environmentId: "environment" },
          ),
        ).pipe(Effect.flip),
      ).toBeDefined();
      expect(
        yield* use((files) =>
          files.originalUpload("other-session", "environment", input, "upload-status"),
        ).pipe(Effect.flip),
      ).toBeDefined();
      const send = (files: Files.Files["Service"]) =>
        files.sendDraft(
          {
            ...input,
            attachmentId: "host-draft",
            text: "message",
            expectedThreadId: input.threadId,
            ...(channelId ? { target: { kind: "channel", channelId } } : {}),
          },
          { principal, environmentId: "environment" },
        );
      yield* use(send).pipe(Effect.flip);
      const consumedDraft = yield* use((files) =>
        files.originalUpload(principal, "environment", input, "upload-status"),
      );
      expect(consumedDraft.state).toBe("ready");
      expect(consumedDraft.draft?.state).toBe("sending");
      expect(consumedDraft.draft?.attachment.id).toBe("host-draft");
      const accepted = yield* use(send);
      expect(accepted.state).toBe("sent");
      expect(accepted.messageId).toBe("delivery");
      expect(uploads).toBe(1);
      revoked = true;
      expect(
        yield* use((files) =>
          files.originalUpload(principal, "environment", input, "upload-status"),
        ).pipe(Effect.flip),
      ).toBeDefined();
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Config.layerTest(process.cwd(), { prefix: "original-upload-" }),
          Sqlite.layerMemory,
        ),
      ),
      Effect.scoped,
      Effect.provide(NodeServices.layer),
    ),
);
