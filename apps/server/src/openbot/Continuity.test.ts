import * as Scheduler from "../scheduling/Scheduler.ts";
import { expect, it } from "@effect/vitest";
import { AuthSessionId, EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Environment from "../environment/ServerEnvironment.ts";
import * as Relay from "../relay/AgentAwarenessRelay.ts";
import * as Integration from "./Integration.ts";
import * as Events from "./ChannelCodingEvents.ts";
import * as Grants from "./ChannelCodingGrants.ts";
import * as Continuity from "./Continuity.ts";
const sessionId = AuthSessionId.make("operator");
const event: Events.ChannelCodingEvent = {
  eventId: "ledger:one:revision:1",
  hostId: "host",
  agentId: "agent",
  taskId: "task",
  channelId: "channel",
  threadId: ThreadId.make("real-coding-thread"),
  status: "needs_approval",
  updatedAt: "2026-11-04T18:00:00Z",
  recipient: { sessionId },
};
it.effect(
  "recovers a durable exact-recipient notification, deduplicates receipts and stops on revocation",
  () => {
    let revoked = false,
      grantValid = true,
      cloudUser = "cloud-operator",
      hostId = "host",
      available = false,
      sends = 0;
    const delivered: string[] = [];
    const dependencies = Layer.mergeAll(
      Layer.mock(Scheduler.Scheduler)({ register: () => Effect.void }),
      Layer.mock(AuthSessions.AuthSessionRepository)({
        getById: ({ sessionId: id }) =>
          Effect.sync(() =>
            id !== sessionId
              ? Option.none()
              : Option.some({
                  sessionId,
                  subject: "operator",
                  scopes: ["orchestration:read", "settings:write"],
                  method: "bearer-access-token",
                  client: {
                    label: null,
                    ipAddress: null,
                    userAgent: null,
                    deviceType: "unknown",
                    os: null,
                    browser: null,
                  },
                  issuedAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"),
                  expiresAt: DateTime.makeUnsafe("2099-01-01T00:00:00Z"),
                  lastConnectedAt: null,
                  revokedAt: revoked ? DateTime.makeUnsafe("2026-11-04T18:00:00Z") : null,
                }),
          ),
      }),
      Layer.mock(Secrets.ServerSecretStore)({
        get: () => Effect.sync(() => Option.some(new TextEncoder().encode(cloudUser))),
      }),
      Layer.mock(Environment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(EnvironmentId.make("origin")),
      }),
      Layer.mock(Integration.Integration)({
        listAgents: Effect.succeed([
          { id: "agent", name: "Responsibilities", provider: "fixture" },
        ]),
        apiReadToHost: (_host, request) =>
          Effect.sync(() =>
            request.operation === "task.list"
              ? {
                  agentId: "agent",
                  tasks: [
                    {
                      id: "github-issue-task",
                      state: "idle",
                      outcome: "completed",
                      updatedAt: "2026-11-04T18:00:00Z",
                    },
                  ],
                }
              : request.operation === "routine.list"
                ? [{ id: "canvas-assignment-reminder" }]
                : [
                    {
                      id: "canvas-assignment-run",
                      routineId: "canvas-assignment-reminder",
                      status: "needs-attention",
                      updatedAt: "2026-11-04T18:00:00Z",
                    },
                  ],
          ),
        readyHostId: Effect.sync(() => hostId),
        attentionSnapshot: Effect.succeed({
          hostId: "host",
          state: "ready",
          complete: true,
          requests: [],
        }),
        subscribeChanges: Stream.empty,
        readyChanges: Stream.empty,
      }),
      Layer.mock(Events.ChannelCodingEvents)({ stream: Stream.empty }),
      Layer.mock(Grants.ChannelCodingGrants)({
        authorizeDelivery: () => Effect.sync(() => grantValid),
      }),
      Layer.mock(Relay.AgentAwarenessRelay)({
        botTransportStatus: Effect.succeed("configured"),
        publishBot: ({ notification, recipientUserId }) =>
          Effect.sync(() => {
            expect(recipientUserId).toBe("cloud-operator");
            sends++;
            if (!available) return "configuration-required";
            delivered.push(notification.eventId);
            return "delivered";
          }),
      }),
    );
    return Effect.gen(function* () {
      const call = (command: import("@t3tools/contracts").OpenbotContinuityCommand) =>
        Effect.service(Continuity.Continuity).pipe(
          Effect.flatMap((service) => service.execute(command)),
          Effect.provideService(Continuity.ContinuityCallerSession, sessionId),
        );
      yield* Effect.gen(function* () {
        yield* call({ action: "configure", enabled: true });
        const continuity = yield* Continuity.Continuity;
        yield* continuity.ingest(event);
        yield* continuity.ingest(event);
        yield* continuity.drain;
        expect((yield* call({ action: "status" })).pending).toBe(1);
        expect(sends).toBe(1);
      }).pipe(Effect.provide(Layer.fresh(Continuity.layer).pipe(Layer.provide(dependencies))));
      available = true;
      yield* Effect.gen(function* () {
        const continuity = yield* Continuity.Continuity;
        hostId = "other-host";
        yield* continuity.drain;
        expect(delivered).toEqual([]);
        hostId = "host";
        yield* continuity.drain;
        yield* continuity.ingest(event);
        yield* continuity.drain;
        expect(delivered).toEqual([event.eventId]);
        expect((yield* call({ action: "status" })).delivered).toBe(1);
        yield* continuity.ingest({ ...event, eventId: "revoked-grant" });
        grantValid = false;
        yield* continuity.drain;
        grantValid = true;
        yield* continuity.ingest({ ...event, eventId: "revoked-session" });
        revoked = true;
        yield* continuity.drain;
        revoked = false;
        yield* continuity.ingest({ ...event, eventId: "relinked-account" });
        cloudUser = "different-account";
        yield* continuity.drain;
        expect(delivered).toEqual([event.eventId]);
        expect((yield* call({ action: "status" })).revoked).toBe(3);
        cloudUser = "cloud-operator";
        yield* continuity.captureResponsibilities;
        yield* continuity.captureResponsibilities;
        yield* continuity.drain;
        expect(delivered).toHaveLength(3);
        const rows = yield* (yield* SqlClient.SqlClient)<{
          readonly payload_json: string;
        }>`SELECT payload_json FROM openbot_attention_outbox WHERE state='delivered'`;
        expect(rows.some((row) => row.payload_json.includes("canvas-assignment-run"))).toBe(true);
        expect(rows.some((row) => row.payload_json.includes("github-issue-task"))).toBe(true);
        const conflict = yield* continuity
          .ingest({ ...event, status: "completed" })
          .pipe(Effect.flip);
        expect(conflict.reason).toBe("identity-conflict");
      }).pipe(Effect.provide(Layer.fresh(Continuity.layer).pipe(Layer.provide(dependencies))));
    }).pipe(Effect.provide(Sqlite.layerMemory));
  },
);
