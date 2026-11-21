import { expect, it } from "@effect/vitest";
import { AuthSessionId, AuthOrchestrationOperateScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DateTime from "effect/DateTime";
import * as SqlClient from "effect/sql/SqlClient";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Ledger from "./ChannelCodingLedger.ts";
import * as Origins from "./ChannelCodingOrigins.ts";
import { Caller, type Authority } from "./RemoteCoding.ts";

const caller: Authority = {
  kind: "session",
  sessionId: AuthSessionId.make("alice"),
  limits: { runtimeMode: "approval-required", interactionMode: "default" },
};
const input = {
  hostId: "host",
  fingerprint: "pin",
  channelId: "channel",
  operationId: "operation",
  payload: { text: "request", attachmentDraftIds: ["draft"] },
};
function harness() {
  const state = { active: true, operate: true, expired: false };
  const deps = Layer.mergeAll(
    Sqlite.layerMemory,
    ManagedPolicy.layerTest(),
    Layer.mock(ThreadManagement.ThreadManagementService)({}),
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      listSessions: () =>
        Effect.succeed(
          state.active
            ? [
                {
                  sessionId: AuthSessionId.make("alice"),
                  subject: "client",
                  scopes: state.operate ? [AuthOrchestrationOperateScope] : [],
                  method: "bearer-access-token",
                  client: { label: "fixture", deviceType: "desktop" },
                  issuedAt: DateTime.makeUnsafe("2026-01-01T00:00:00Z"),
                  expiresAt: DateTime.makeUnsafe(
                    state.expired ? "1960-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
                  ),
                  lastConnectedAt: null,
                  connected: false,
                  current: false,
                },
              ]
            : [],
        ),
    }),
  );
  return {
    state,
    layer: Ledger.layer.pipe(Layer.provideMerge(Origins.layer.pipe(Layer.provideMerge(deps)))),
  };
}
it.effect(
  "journals before send, recovers uncertain operation across fresh service instances and refuses caller/payload/pin adoption",
  () => {
    const h = harness();
    return Effect.gen(function* () {
      const journal = yield* Origins.ChannelCodingOrigins;
      const first = yield* journal.prepare(input);
      expect(first.state).toBe("prepared");
      expect(first.origin_ref).toMatch(/^[a-f0-9]{64}$/);
      yield* journal.uncertain(first.origin_ref);
      const fresh = yield* Effect.service(Origins.ChannelCodingOrigins).pipe(
        Effect.provide(Origins.layer),
      );
      expect(
        (yield* fresh.prepare({
          ...input,
          payload: { attachmentDraftIds: ["draft"], text: "request" },
        })).origin_ref,
      ).toBe(first.origin_ref);
      for (const changed of [
        { ...input, payload: { text: "changed" } },
        { ...input, fingerprint: "new-pin" },
      ])
        expect(yield* journal.prepare(changed).pipe(Effect.result)).toHaveProperty(
          "_tag",
          "Failure",
        );
      expect(
        yield* journal
          .prepare(input)
          .pipe(
            Effect.provideService(Caller, { ...caller, sessionId: AuthSessionId.make("bob") }),
            Effect.result,
          ),
      ).toHaveProperty("_tag", "Failure");
      const accepted = yield* fresh.accept(first.origin_ref, "exact-message", "exact-receipt");
      expect(accepted.state).toBe("accepted");
      expect(yield* journal.accept(first.origin_ref, "exact-message", "exact-receipt")).toEqual(
        accepted,
      );
      expect(
        yield* journal
          .accept(first.origin_ref, "other-message", "exact-receipt")
          .pipe(Effect.result),
      ).toHaveProperty("_tag", "Failure");
      expect(
        yield* fresh.owner(first.origin_ref, "host", "pin", "channel", "exact-message"),
      ).toEqual(caller);
      h.state.operate = false;
      expect(
        yield* fresh
          .owner(first.origin_ref, "host", "pin", "channel", "exact-message")
          .pipe(Effect.result),
      ).toHaveProperty("_tag", "Failure");
      h.state.operate = true;
      h.state.active = false;
      expect(
        yield* fresh
          .owner(first.origin_ref, "host", "pin", "channel", "exact-message")
          .pipe(Effect.result),
      ).toHaveProperty("_tag", "Failure");
      h.state.active = true;
      h.state.expired = true;
      expect(
        yield* fresh
          .owner(first.origin_ref, "host", "pin", "channel", "exact-message")
          .pipe(Effect.result),
      ).toHaveProperty("_tag", "Failure");
      h.state.expired = false;
      yield* journal.revoke(first.origin_ref);
      expect(yield* journal.prepare(input).pipe(Effect.result)).toHaveProperty("_tag", "Failure");
      const sql = yield* SqlClient.SqlClient;
      expect(
        yield* sql`UPDATE openbot_channel_origins SET authority_json='{}'`.pipe(Effect.result),
      ).toHaveProperty("_tag", "Failure");
    }).pipe(Effect.provideService(Caller, caller), Effect.provide(h.layer));
  },
);

it.effect(
  "channel reservations retain one command/thread across uncertainty and reject stale settlement and changed launch",
  () => {
    const h = harness();
    return Effect.gen(function* () {
      const origins = yield* Origins.ChannelCodingOrigins;
      const ledger = yield* Ledger.ChannelCodingLedger;
      const origin = yield* origins.prepare(input);
      yield* origins.accept(origin.origin_ref, "request", "receipt");
      const launch = {
        hostId: "host",
        fingerprint: "pin",
        originRef: origin.origin_ref,
        binding: {
          channelId: "channel",
          taskId: "task",
          taskRevision: 1,
          assignmentId: "assignment",
          agentId: "agent",
          turnId: "turn",
          requestMessageId: "request",
          requesterId: "requester",
          operationId: "coding-op",
        },
        launch: { prompt: "code", runtimeMode: "approval-required" },
        projectId: "project",
      };
      const row = yield* ledger.reserve(launch);
      yield* ledger.transition(row.binding_key, "uncertain");
      const fresh = yield* Effect.service(Ledger.ChannelCodingLedger).pipe(
        Effect.provide(Ledger.layer),
      );
      const retry = yield* fresh.reserve(launch);
      expect(retry.thread_id).toBe(row.thread_id);
      expect(retry.command_id).toBe(row.command_id);
      expect(retry.state).toBe("uncertain");
      expect(
        yield* ledger.reserve({ ...launch, launch: { prompt: "changed" } }).pipe(Effect.result),
      ).toHaveProperty("_tag", "Failure");
      yield* fresh.transition(row.binding_key, "accepted");
      yield* fresh.terminal(row.binding_key, { text: "result" });
      yield* fresh.transition(row.binding_key, "stale");
      expect(
        yield* fresh
          .delivered(row.binding_key, { text: "result" }, { messageId: "result" })
          .pipe(Effect.result),
      ).toHaveProperty("_tag", "Failure");
      const newer = yield* ledger.reserve({
        ...launch,
        binding: {
          ...launch.binding,
          taskRevision: 2,
          assignmentId: "new-assignment",
          turnId: "new-turn",
        },
      });
      expect(newer.thread_id).not.toBe(row.thread_id);
      yield* ledger.transition(newer.binding_key, "accepted");
      yield* ledger.terminal(newer.binding_key, { text: "new-result" });
      const delivered = yield* ledger.delivered(
        newer.binding_key,
        { text: "new-result" },
        { messageId: "exact-assignment-result" },
      );
      expect(
        yield* ledger.delivered(
          newer.binding_key,
          { text: "new-result" },
          { messageId: "exact-assignment-result" },
        ),
      ).toEqual(delivered);
      expect(
        yield* ledger
          .delivered(
            newer.binding_key,
            { text: "changed" },
            { messageId: "exact-assignment-result" },
          )
          .pipe(Effect.result),
      ).toHaveProperty("_tag", "Failure");
      yield* origins.revoke(origin.origin_ref);
      expect(yield* ledger.reserve(launch).pipe(Effect.result)).toHaveProperty("_tag", "Failure");
      const sql = yield* SqlClient.SqlClient;
      expect(
        yield* sql`UPDATE openbot_channel_coding_tasks SET origin_ref='forged'`.pipe(Effect.result),
      ).toHaveProperty("_tag", "Failure");
    }).pipe(Effect.provideService(Caller, caller), Effect.provide(h.layer));
  },
);
