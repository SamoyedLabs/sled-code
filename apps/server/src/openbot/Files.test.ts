// @effect-diagnostics nodeBuiltinImport:off -- Local HTTP and disk fixtures verify binary transport and publication.
import * as NodeHttp from "node:http";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Layer from "effect/Layer";
import * as FileSystem from "effect/FileSystem";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Config from "../config.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Integration from "./Integration.ts";
import * as ManagedHost from "./ManagedHost.ts";
import * as TeamClient from "./TeamClient.ts";
import * as Files from "./Files.ts";
import { createPendingAttachmentId, resolveAttachmentPathById } from "../attachmentStore.ts";
import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";

const fixture = Effect.fnUntraced(function* (handle: NodeHttp.RequestListener) {
  const server = yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<NodeHttp.Server>((resolve, reject) => {
          const server = NodeHttp.createServer(handle);
          server.once("error", reject);
          server.listen(0, "127.0.0.1", () => resolve(server));
        }),
    ),
    (server) =>
      Effect.promise(
        () =>
          new Promise<void>((resolve) => {
            server.closeAllConnections();
            server.close(() => resolve());
          }),
      ),
  );
  const address = server.address();
  if (address === null || typeof address === "string")
    return yield* Effect.die("Missing fixture address");
  return `http://127.0.0.1:${address.port}`;
});
const scope = { hostId: "host", agentId: "bot" };
const atTime = Effect.fn("files.test.atTime")(function* <A, E, R>(
  millis: number,
  effect: Effect.Effect<A, E, R>,
) {
  const clock = yield* Clock.Clock;
  return yield* effect.pipe(
    Effect.provideService(Clock.Clock, {
      currentTimeMillisUnsafe: () => millis,
      currentTimeMillis: Effect.succeed(millis),
      currentTimeNanosUnsafe: () => BigInt(millis) * 1_000_000n,
      currentTimeNanos: Effect.succeed(BigInt(millis) * 1_000_000n),
      monotonicTimeNanosUnsafe: () => clock.monotonicTimeNanosUnsafe(),
      monotonicTimeNanos: clock.monotonicTimeNanos,
      sleep: (duration) => clock.sleep(duration),
    }),
  );
});
const applicationAt = (apiUrl: string) =>
  Layer.mergeAll(
    Config.layerTest(process.cwd(), { prefix: "t3-bot-files-" }),
    Sqlite.layerMemory,
    Integration.layerWithHost("owner-secret").pipe(
      Layer.provide(TeamClient.layer),
      Layer.provide(
        Layer.mock(ManagedHost.ManagedHost)({
          getStatus: Effect.succeed({
            status: "ready",
            ready: {
              serverId: "host",
              serverName: "Files",
              apiUrl,
              fingerprint: "fingerprint",
              publicKey: "key",
              ownerMemberId: "owner",
            },
          }),
        }),
      ),
    ),
  );

it.live(
  "streams a workspace file into a signed-asset-compatible attachment without exposing the upstream address",
  () =>
    Effect.gen(function* () {
      const bytes = Buffer.from([0, 255, 23, 8, 13, 10, 199]);
      const apiUrl = yield* fixture(async (request, response) => {
        if (request.url === "/v1/auth/login") {
          response.setHeader("content-type", "application/json");
          response.end(
            JSON.stringify({
              sessionToken: "private-file-session",
              sessionExpiresAt: "2099-01-01T00:00:00Z",
            }),
          );
        } else if (request.url === "/v1/agents") {
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify([{ id: "bot", name: "Files", provider: "codex" }]));
        } else if (request.url?.startsWith("/v1/workspace-files?")) {
          const url = new URL(request.url, "http://fixture.local");
          expect(url.searchParams.get("botId")).toBe("bot");
          expect(url.searchParams.get("path")).toBe("./Report%20A.bin");
          expect(request.headers.authorization).toBe("Bearer private-file-session");
          response.writeHead(200, {
            "content-length": bytes.length,
            "content-type": "application/octet-stream",
          });
          response.write(bytes.subarray(0, 3));
          response.end(bytes.subarray(3));
        } else response.writeHead(204).end();
      });
      yield* Effect.gen(function* () {
        const files = yield* Files.Files;
        const result = yield* files.materialize({
          ...scope,
          source: { kind: "workspace", path: "./Report%20A.bin" },
        });
        expect(result).toMatchObject({
          name: "Report A.bin",
          size: 7,
          sha256: "5b15a537b13f4067acdd8f6b003b69c34bbad2dd27cf391ee0e3ff3eee0410aa",
        });
        expect(JSON.stringify(result)).not.toContain("private-file-session");
        expect(JSON.stringify(result)).not.toContain(apiUrl);
        const config = yield* Config.ServerConfig;
        const path = resolveAttachmentPathById({
          attachmentsDir: config.attachmentsDir,
          attachmentId: result.attachmentId,
        });
        expect(path).not.toBeNull();
        expect(Array.from(yield* (yield* FileSystem.FileSystem).readFile(path!))).toEqual([
          0, 255, 23, 8, 13, 10, 199,
        ]);
      }).pipe(Effect.provide(Files.layer.pipe(Layer.provideMerge(applicationAt(apiUrl)))));
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(FetchHttpClient.layer, NodeServices.layer)),
    ),
);

it.live(
  "routes files to their task and holds an uncertain new task without starting a second one",
  () =>
    Effect.gen(function* () {
      let uploads = 0;
      let starts = 0;
      let discarded = 0;
      const sends: Array<{ attachment: string; key: string }> = [];
      const taskSummary = (id: string) => ({ id, agentId: "bot", threadId: `thread-${id}` });
      const attachment = (id: string) => ({
        id,
        name: "task.bin",
        size: 3,
        kind: "file",
        mimeType: "application/octet-stream",
        previewKind: "none",
      });
      const apiUrl = yield* fixture(async (request, response) => {
        const parts: Buffer[] = [];
        for await (const part of request) parts.push(part);
        const bytes = Buffer.concat(parts);
        response.setHeader("content-type", "application/json");
        if (request.url === "/v1/auth/login")
          response.end(
            JSON.stringify({
              sessionToken: "private-task-session",
              sessionExpiresAt: "2099-01-01T00:00:00Z",
            }),
          );
        else if (request.url === "/v1/agents")
          response.end(JSON.stringify([{ id: "bot", name: "Files", provider: "codex" }]));
        else if (request.url?.startsWith("/v1/agents/bot/conversation-page?"))
          response.end(JSON.stringify({ agentId: "bot", threadId: null, messages: [] }));
        else if (request.url?.startsWith("/v1/attachments?")) {
          uploads++;
          expect(Array.from(bytes)).toEqual([0, 255, 23]);
          response.writeHead(201).end(JSON.stringify(attachment(`draft-${uploads}`)));
        } else if (request.url === "/v1/agent-tasks/list")
          response.end(
            JSON.stringify({
              agentId: "bot",
              tasks: [taskSummary("existing"), ...(starts > 0 ? [taskSummary("created")] : [])],
              limit: 2,
            }),
          );
        else if (request.url === "/v1/agent-tasks/read") {
          const body = JSON.parse(bytes.toString());
          response.end(
            JSON.stringify({
              agentId: "bot",
              threadId: `thread-${body.taskId}`,
              messages: [
                {
                  id: body.taskId === "created" ? "created-message" : "side-message",
                  createdAt: "2030-01-01T00:00:00Z",
                  attachments: [
                    attachment(body.taskId === "created" ? "committed-2" : "committed-1"),
                  ],
                },
              ],
            }),
          );
        } else if (request.url === "/v1/agent-threads/send-with-files") {
          const body = JSON.parse(bytes.toString());
          expect(body.taskId).toBe("existing");
          expect(body.agentId).toBe("bot");
          expect(body.text).toBe("Check this task file");
          expect(Object.keys(body).sort()).toEqual([
            "agentId",
            "attachmentDraftIds",
            "clientMessageId",
            "taskId",
            "text",
          ]);
          sends.push({ attachment: body.attachmentDraftIds[0], key: body.clientMessageId });
          if (sends.filter((sent) => sent.attachment === body.attachmentDraftIds[0]).length === 1)
            response.writeHead(503).end(JSON.stringify({ error: "accepted; reply lost" }));
          else
            response.writeHead(202).end(
              JSON.stringify({
                messageId: "task-receipt",
                deliveries: [{ id: "side-message", recipientAgentId: "bot" }],
              }),
            );
        } else if (request.url === "/v1/agent-threads/start-with-files") {
          starts++;
          const body = JSON.parse(bytes.toString());
          expect(body.attachmentDraftIds).toEqual(["draft-2"]);
          expect(Object.keys(body).sort()).toEqual([
            "agentId",
            "attachmentDraftIds",
            "clientMessageId",
            "text",
          ]);
          response.writeHead(503).end(JSON.stringify({ error: "accepted; reply lost" }));
        } else if (request.url === "/v1/attachments/committed-1" && request.method === "GET")
          response
            .writeHead(200, { "content-type": "application/octet-stream", "content-length": 3 })
            .end(Buffer.from([0, 255, 23]));
        else if (request.url?.startsWith("/v1/attachments/") && request.method === "DELETE") {
          discarded++;
          response.writeHead(204).end();
        } else response.writeHead(404).end(JSON.stringify({ error: "unexpected path" }));
      });
      yield* atTime(
        Date.UTC(2030, 0, 1),
        Effect.gen(function* () {
          const pendingId = yield* Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;
            const config = yield* Config.ServerConfig;
            const pendingId = createPendingAttachmentId("bin");
            const filePath = resolveAttachmentRelativePath({
              attachmentsDir: config.attachmentsDir,
              relativePath: `${pendingId}.bin`,
            });
            if (!filePath) return yield* Effect.die("Invalid pending fixture path");
            yield* fs.writeFile(filePath, new Uint8Array([0, 255, 23]));
            const files = yield* Files.Files;
            const draft = yield* files.uploadDraft({
              ...scope,
              attachmentId: pendingId,
              name: "task.bin",
              mimeType: "application/octet-stream",
              size: 3,
            });
            yield* Effect.flip(
              files.sendDraft({
                ...scope,
                attachmentId: draft.attachment.id,
                text: "Check this task file",
                target: { kind: "task", taskId: "existing" },
              }),
            );
            expect(
              (yield* Effect.flip(
                files.sendDraft({
                  ...scope,
                  attachmentId: draft.attachment.id,
                  text: "Check this task file",
                  target: { kind: "main" },
                }),
              )).reason,
            ).toBe("conflict");
            return pendingId;
          }).pipe(Effect.provide(Files.layer));
          yield* Effect.gen(function* () {
            const files = yield* Files.Files;
            const sent = yield* files.sendDraft({
              ...scope,
              attachmentId: "draft-1",
              text: "Check this task file",
              target: { kind: "task", taskId: "existing" },
            });
            expect(sent).toMatchObject({
              state: "sent",
              messageId: "task-receipt",
              conversationMessageId: "side-message",
              committedAttachments: [
                {
                  id: "committed-1",
                  name: "task.bin",
                  size: 3,
                  kind: "file",
                  mimeType: "application/octet-stream",
                  previewKind: "none",
                },
              ],
              taskId: "existing",
              target: { kind: "task", taskId: "existing" },
            });
            expect(sends).toHaveLength(2);
            expect(sends[0]?.key).toBe(sends[1]?.key);
            const found = yield* files.search({
              hostId: scope.hostId,
              agentId: scope.agentId,
              taskId: "existing",
              query: "task",
            });
            expect(found.results[0]).toMatchObject({
              taskId: "existing",
              attachment: { id: "committed-1" },
            });
            expect(
              (yield* files.materialize({
                ...scope,
                source: {
                  kind: "attachment",
                  attachmentId: "committed-1",
                  messageId: "side-message",
                  taskId: "existing",
                },
              })).size,
            ).toBe(3);
            const draft = yield* files.uploadDraft({
              ...scope,
              attachmentId: pendingId,
              name: "task.bin",
              mimeType: "application/octet-stream",
              size: 3,
            });
            yield* Effect.flip(
              files.sendDraft({
                ...scope,
                attachmentId: draft.attachment.id,
                text: "Create a task with this file",
                target: { kind: "new-task" },
              }),
            );
            expect(
              (yield* files.listDrafts(scope)).find(
                (row) => row.attachment.id === draft.attachment.id,
              )?.state,
            ).toBe("reconciliation-required");
          }).pipe(Effect.provide(Files.layer));
          yield* Effect.gen(function* () {
            const files = yield* Files.Files;
            const uncertain = yield* Effect.flip(
              files.sendDraft({
                ...scope,
                attachmentId: "draft-2",
                text: "Create a task with this file",
                target: { kind: "new-task" },
              }),
            );
            expect(uncertain.reason).toBe("reconciliation-required");
            expect(
              (yield* files.listDrafts(scope)).find((row) => row.attachment.id === "draft-2")
                ?.state,
            ).toBe("reconciliation-required");
            expect(starts).toBe(1);
            const ready = yield* files.uploadDraft({
              ...scope,
              attachmentId: pendingId,
              name: "task.bin",
              mimeType: "application/octet-stream",
              size: 3,
            });
            expect(
              (yield* Effect.flip(
                files.discardDraft({
                  ...scope,
                  agentId: "other",
                  attachmentId: ready.attachment.id,
                }),
              )).reason,
            ).toBe("ownership");
            yield* files.discardDraft({ ...scope, attachmentId: ready.attachment.id });
            expect(discarded).toBe(1);
            const expiring = yield* files.uploadDraft({
              ...scope,
              attachmentId: pendingId,
              name: "task.bin",
              mimeType: "application/octet-stream",
              size: 3,
            });
            yield* Effect.flip(
              files.sendDraft({
                ...scope,
                attachmentId: expiring.attachment.id,
                text: "Check this task file",
                target: { kind: "task", taskId: "existing" },
              }),
            );
            expect(
              (yield* atTime(
                Date.UTC(2030, 0, 1, 23),
                Effect.flip(
                  files.sendDraft({
                    ...scope,
                    attachmentId: expiring.attachment.id,
                    text: "Check this task file",
                    target: { kind: "task", taskId: "existing" },
                  }),
                ),
              )).reason,
            ).toBe("reconciliation-required");
            expect(sends).toHaveLength(3);
            expect(
              (yield* files.listDrafts(scope)).find(
                (row) => row.attachment.id === expiring.attachment.id,
              )?.state,
            ).toBe("reconciliation-required");
          }).pipe(Effect.provide(Files.layer));
        }).pipe(Effect.provide(applicationAt(apiUrl))),
      );
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(FetchHttpClient.layer, NodeServices.layer)),
    ),
);

it.live("rejects mismatched file provenance and removes incomplete downloads", () =>
  Effect.gen(function* () {
    let downloads = 0;
    const summary = {
      id: "artifact",
      name: "report.bin",
      size: 7,
      kind: "file",
      mimeType: "application/octet-stream",
      previewKind: "none",
      previewUrl: "http://private.invalid/attachment",
    };
    const apiUrl = yield* fixture(async (request, response) => {
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/auth/login")
        response.end(
          JSON.stringify({
            sessionToken: "private-provenance-session",
            sessionExpiresAt: "2099-01-01T00:00:00Z",
          }),
        );
      else if (request.url === "/v1/agents")
        response.end(JSON.stringify([{ id: "bot", name: "Files", provider: "codex" }]));
      else if (request.url?.startsWith("/v1/agents/bot/conversation-page?"))
        response.end(
          JSON.stringify({
            agentId: "other",
            threadId: null,
            messages: [{ id: "message", attachments: [summary] }],
          }),
        );
      else if (request.url === "/v1/agent-tasks/read")
        response.end(
          JSON.stringify({
            agentId: "bot",
            threadId: "other-task",
            messages: [{ id: "message", attachments: [summary] }],
          }),
        );
      else if (request.url === "/v1/agent-tasks/list")
        response.end(
          JSON.stringify({
            agentId: "bot",
            tasks: [{ id: "task", agentId: "bot", threadId: "thread-task" }],
            limit: 2,
          }),
        );
      else if (request.url === "/v1/workspace-directory")
        response.end(
          JSON.stringify({
            name: "workspace",
            path: ".",
            parentPath: null,
            root: "/private/upstream/root",
            entries: [
              { name: "report.bin", path: "./report.bin", kind: "file", size: 7, modifiedAt: 123 },
            ],
            truncated: false,
          }),
        );
      else if (request.url === "/v1/conversation-files/search")
        response.end(
          JSON.stringify({
            results: [
              {
                agentId: "bot",
                messageId: "message",
                createdAt: "2026-11-04T00:00:00Z",
                attachment: summary,
              },
            ],
            nextCursor: null,
          }),
        );
      else if (
        request.url?.startsWith("/v1/workspace-files?") ||
        request.url === "/v1/attachments/artifact"
      ) {
        downloads++;
        response.writeHead(200, {
          "content-type": "application/octet-stream",
          "content-length": "7",
          connection: "close",
        });
        response.end(Buffer.from([0, 255, 23]));
      } else response.writeHead(204).end();
    });
    yield* Effect.gen(function* () {
      const files = yield* Files.Files;
      const metadata = yield* files.listWorkspace({ ...scope, path: "." });
      expect(JSON.stringify(metadata)).not.toContain("/private/upstream/root");
      expect(metadata.entries[0]?.name).toBe("report.bin");
      const found = yield* files.search({ hostId: scope.hostId, query: "report" });
      expect(found.results[0]?.attachment.id).toBe("artifact");
      expect(JSON.stringify(found)).not.toContain("private.invalid");
      yield* Effect.flip(
        files.materialize({
          ...scope,
          hostId: "other-host",
          source: { kind: "workspace", path: "./report.bin" },
        }),
      );
      yield* Effect.flip(
        files.materialize({
          ...scope,
          source: { kind: "attachment", attachmentId: "artifact", messageId: "message" },
        }),
      );
      yield* Effect.flip(
        files.materialize({
          ...scope,
          source: {
            kind: "attachment",
            attachmentId: "artifact",
            messageId: "message",
            taskId: "task",
          },
        }),
      );
      expect(downloads).toBe(0);
      yield* Effect.flip(
        files.materialize({ ...scope, source: { kind: "workspace", path: "./report.bin" } }),
      );
      expect(downloads).toBe(1);
      const config = yield* Config.ServerConfig;
      expect(yield* (yield* FileSystem.FileSystem).readDirectory(config.attachmentsDir)).toEqual(
        [],
      );
    }).pipe(Effect.provide(Files.layer.pipe(Layer.provideMerge(applicationAt(apiUrl)))));
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(FetchHttpClient.layer, NodeServices.layer))),
);

it.live(
  "keeps an uploaded draft and its send identity across reconstruction after an accepted but lost reply",
  () =>
    Effect.gen(function* () {
      let uploads = 0;
      const sends: string[] = [];
      let committedVisible = false;
      const summary = {
        id: "draft-one",
        name: "report.bin",
        size: 7,
        kind: "file",
        mimeType: "application/octet-stream",
        previewKind: "none",
      };
      const apiUrl = yield* fixture(async (request, response) => {
        const parts: Buffer[] = [];
        for await (const part of request) parts.push(part);
        const body = Buffer.concat(parts);
        response.setHeader("content-type", "application/json");
        if (request.url === "/v1/auth/login")
          response.end(
            JSON.stringify({
              sessionToken: "private-draft-session",
              sessionExpiresAt: "2099-01-01T00:00:00Z",
            }),
          );
        else if (request.url === "/v1/agents")
          response.end(JSON.stringify([{ id: "bot", name: "Files", provider: "codex" }]));
        else if (request.url?.startsWith("/v1/agents/bot/conversation-page?")) {
          expect(new URL(request.url, "http://fixture.local").searchParams.get("around")).toBe(
            "delivery-one",
          );
          if (!committedVisible)
            response.writeHead(503).end(JSON.stringify({ error: "not yet visible" }));
          else
            response.end(
              JSON.stringify({
                agentId: "bot",
                threadId: null,
                messages: [
                  {
                    id: "delivery-one",
                    attachments: [
                      { ...summary, id: "committed-one", previewUrl: `${apiUrl}/private-preview` },
                    ],
                  },
                ],
              }),
            );
        } else if (request.url?.startsWith("/v1/agents/other/conversation-page?"))
          response.writeHead(404).end(JSON.stringify({ error: "missing" }));
        else if (request.url?.startsWith("/v1/attachments?")) {
          uploads++;
          expect(Array.from(body)).toEqual([0, 255, 23, 8, 13, 10, 199]);
          response
            .writeHead(201)
            .end(JSON.stringify({ ...summary, previewUrl: `${apiUrl}/private-preview` }));
        } else if (request.url === "/v1/agents/bot/messages") {
          const sent = JSON.parse(body.toString());
          expect(sent.attachmentDraftIds).toEqual(["draft-one"]);
          expect(sent.text).toBe("Review this file");
          sends.push(sent.clientMessageId);
          if (sends.length === 1)
            response.writeHead(503).end(JSON.stringify({ error: "accepted; reply lost" }));
          else
            response.writeHead(202).end(
              JSON.stringify({
                messageId: "receipt-one",
                deliveries: [
                  { id: "wrong-delivery", recipientAgentId: "other" },
                  { id: "delivery-one", recipientAgentId: "bot" },
                ],
              }),
            );
        } else if (request.url === "/v1/attachments/committed-one" && request.method === "GET") {
          response
            .writeHead(200, { "content-type": "application/octet-stream", "content-length": 7 })
            .end(Buffer.from([0, 255, 23, 8, 13, 10, 199]));
        } else response.writeHead(204).end();
      });
      yield* Effect.gen(function* () {
        yield* Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const config = yield* Config.ServerConfig;
          const attachmentId = createPendingAttachmentId("bin");
          const filePath = resolveAttachmentRelativePath({
            attachmentsDir: config.attachmentsDir,
            relativePath: `${attachmentId}.bin`,
          });
          if (!filePath) return yield* Effect.die("Missing pending fixture path");
          yield* fs.writeFile(filePath, new Uint8Array([0, 255, 23, 8, 13, 10, 199]));
          const files = yield* Files.Files;
          expect(
            (yield* Effect.flip(
              files.uploadDraft({
                ...scope,
                agentId: "other",
                attachmentId,
                name: "report.bin",
                mimeType: "application/octet-stream",
                size: 7,
              }),
            )).reason,
          ).toBe("transfer");
          expect(uploads).toBe(0);
          const draft = yield* files.uploadDraft({
            ...scope,
            attachmentId,
            name: "report.bin",
            mimeType: "application/octet-stream",
            size: 7,
          });
          expect(draft.state).toBe("ready");
          expect(JSON.stringify(draft)).not.toContain(apiUrl);
          expect(
            (yield* Effect.flip(
              files.sendDraft({
                ...scope,
                attachmentId: draft.attachment.id,
                text: "Review this file",
              }),
            )).reason,
          ).toBe("transfer");
          expect((yield* files.listDrafts(scope))[0]?.state).toBe("sending");
        }).pipe(Effect.provide(Files.layer));
        yield* Effect.gen(function* () {
          const files = yield* Files.Files;
          expect(
            (yield* Effect.flip(
              files.sendDraft({ ...scope, attachmentId: "draft-one", text: "Changed" }),
            )).reason,
          ).toBe("conflict");
          const sent = yield* files.sendDraft({
            ...scope,
            attachmentId: "draft-one",
            text: "Review this file",
          });
          expect(sent.state).toBe("sent");
          expect(sent.messageId).toBe("receipt-one");
          expect(sent.conversationMessageId).toBe("delivery-one");
          expect(sent.committedAttachments).toBeNull();
          expect(uploads).toBe(1);
          expect(sends).toHaveLength(2);
          expect(sends[0]).toBe(sends[1]);
          expect(
            (yield* Effect.flip(files.discardDraft({ ...scope, attachmentId: "draft-one" })))
              .reason,
          ).toBe("conflict");
        }).pipe(Effect.provide(Files.layer));
        committedVisible = true;
        yield* Effect.gen(function* () {
          const files = yield* Files.Files;
          const persisted = (yield* files.listDrafts(scope))[0];
          expect(persisted).toMatchObject({
            state: "sent",
            messageId: "receipt-one",
            conversationMessageId: "delivery-one",
            committedAttachments: null,
          });
          const resolved = yield* files.sendDraft({
            ...scope,
            attachmentId: "draft-one",
            text: "Review this file",
          });
          expect(resolved.attachment.id).toBe("draft-one");
          expect(resolved.committedAttachments?.[0]?.id).toBe("committed-one");
          expect(JSON.stringify(resolved)).not.toContain(apiUrl);
          expect(sends).toHaveLength(2);
          const stored = (yield* files.listDrafts(scope))[0];
          expect(stored?.committedAttachments?.[0]?.id).toBe("committed-one");
          const artifact = yield* files.materialize({
            ...scope,
            source: {
              kind: "attachment",
              attachmentId: "committed-one",
              messageId: "delivery-one",
            },
          });
          expect(artifact.size).toBe(7);
        }).pipe(Effect.provide(Files.layer));
      }).pipe(Effect.provide(applicationAt(apiUrl)));
    }).pipe(
      Effect.scoped,
      Effect.provide(Layer.mergeAll(FetchHttpClient.layer, NodeServices.layer)),
    ),
);
