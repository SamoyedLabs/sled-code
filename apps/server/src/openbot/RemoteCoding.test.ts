import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  AuthSessionId,
  AuthOrchestrationOperateScope,
  EnvironmentId,
  OrchestratorMcpFailure,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  CommandId,
  OpenbotCodingLaunchInput,
  type PeerLink,
  type AuthClientSession,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as RemoteCoding from "./RemoteCoding.ts";
import { liveThreadShell } from "../mcp/McpToolAccess.testkit.ts";
import type { CodingRow } from "./RemoteCodingLedger.ts";

const encodeLaunch = Schema.encodeEffect(Schema.fromJsonString(OpenbotCodingLaunchInput));
const stamp = "2026-11-03T12:00:00Z";
const environmentId = EnvironmentId.make("destination");
const receiptId = ThreadId.make("source-receipt");
const remoteThreadId = ThreadId.make("destination-thread");
const input: OpenbotCodingLaunchInput = {
  origin: { hostId: "host", agentId: "bot", taskId: "task" },
  operationId: "operation",
  environmentId,
  projectId: ProjectId.make("remote-project"),
  title: "Fix issue",
  prompt: "Fix the issue",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  workspaceStrategy: { type: "root" },
};
const operator: RemoteCoding.Authority = {
  kind: "session",
  sessionId: AuthSessionId.make("operator"),
  limits: { runtimeMode: "approval-required", interactionMode: "default" },
};
const caller: RemoteCoding.Authority = {
  kind: "session",
  sessionId: AuthSessionId.make("source-client"),
  limits: { runtimeMode: "approval-required", interactionMode: "default" },
};
const link: PeerLink = {
  environmentId,
  label: "Destination",
  urls: ["https://fixture.invalid"],
  access: "approval-required",
  linkedAt: DateTime.makeUnsafe(stamp),
  expiresAt: DateTime.makeUnsafe("2099-01-01T00:00:00Z"),
  lastReachedAt: null,
  lastError: null,
};
const session: AuthClientSession = {
  sessionId: AuthSessionId.make("source-client"),
  subject: "bot",
  scopes: [AuthOrchestrationOperateScope],
  method: "bearer-access-token",
  client: { label: "Bot", deviceType: "bot" },
  issuedAt: DateTime.makeUnsafe(stamp),
  expiresAt: DateTime.makeUnsafe("2099-01-01T00:00:00Z"),
  lastConnectedAt: null,
  connected: false,
  current: false,
};

function harness(uncertainLaunch = false) {
  const calls: Array<{
    tool: string;
    args: Record<string, unknown>;
    limits: PeerMcpClient.PeerCallLimits;
  }> = [];
  const state = {
    active: true,
    enabled: true,
    linkedAt: link.linkedAt,
    settled: false,
    stops: 0,
    failNextSend: false,
    operatorActive: true,
    destinationAccepted: false,
    receiptAvailable: true,
    destinationCancelled: false,
    rejectFirstLaunch: false,
  };
  const detail = () => ({
    threadId: remoteThreadId,
    projectId: input.projectId,
    title: input.title,
    link: "https://fixture.invalid/thread/destination-thread",
    createdBy: "agent",
    creationSource: "server",
    status: "completed",
    latestRunId: "provider-turn",
    activeRunId: null,
    providerInstanceId: "codex",
    model: "fixture",
    runtimeMode: "approval-required",
    interactionMode: "default",
    linkedPullRequest: null,
    titleRegeneration: null,
    branch: null,
    worktreePath: null,
    parentThreadId: null,
    relationshipToParent: null,
    runCount: 2,
    itemCount: 2,
    pendingRequestCount: state.settled ? 0 : 1,
    archived: false,
    settled: state.settled,
    settledAt: null,
    snoozed: false,
    snoozedUntil: null,
    createdAt: stamp,
    updatedAt: stamp,
  });
  const item = (runId: string, text: string, position: number) => ({
    position,
    visibility: "local",
    sourceThreadId: remoteThreadId,
    itemId: `message-${position}`,
    runId,
    messageId: null,
    createdBy: "agent",
    creationSource: "server",
    type: "assistant_message",
    status: "completed",
    title: null,
    text,
    textTruncated: false,
    updatedAt: stamp,
  });
  const dependencies = Layer.mergeAll(
    SqlitePersistence.layerMemory,
    NodeCrypto.layer,
    ManagedPolicy.layerTest(),
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      listSessions: () =>
        Effect.sync(() => [
          ...(state.active ? [session] : []),
          ...(state.operatorActive
            ? [{ ...session, sessionId: AuthSessionId.make("operator") }]
            : []),
        ]),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({}),
    Layer.mock(PeerLinks.PeerLinks)({
      enabled: Effect.sync(() => state.enabled),
      get: () => Effect.sync(() => Option.some({ ...link, linkedAt: state.linkedAt })),
    }),
    Layer.mock(PeerMcpClient.PeerMcpClient)({
      call: (request) =>
        Effect.gen(function* () {
          calls.push({ tool: request.tool, args: request.arguments, limits: request.limits });
          let value: unknown;
          switch (request.tool) {
            case "t3_thread_launch":
              if (state.rejectFirstLaunch) {
                state.rejectFirstLaunch = false;
                return yield* new OrchestratorMcpFailure({
                  code: "orchestration_error",
                  message: "Launch response lost before acceptance",
                });
              }
              state.destinationAccepted = true;
              if (
                uncertainLaunch &&
                calls.filter((call) => call.tool === request.tool).length === 1
              )
                return yield* new OrchestratorMcpFailure({
                  code: "orchestration_error",
                  message: "Launch accepted; response lost",
                });
              value = {
                threadId: remoteThreadId,
                runId: "provider-turn",
                link: "https://fixture.invalid/thread/destination-thread",
              };
              break;
            case "t3_thread_launch_receipt":
              if (!state.receiptAvailable)
                return yield* new OrchestratorMcpFailure({
                  code: "orchestration_error",
                  message: "Destination unavailable",
                });
              if (request.arguments.action === "cancel") {
                state.destinationCancelled = true;
                if (state.destinationAccepted) state.stops++;
              }
              value = {
                state: state.destinationCancelled
                  ? "cancelled"
                  : state.destinationAccepted
                    ? "accepted"
                    : "unknown",
                threadId: state.destinationAccepted ? remoteThreadId : null,
                projectId: state.destinationAccepted ? input.projectId : null,
                cancelRequested: state.destinationCancelled,
                stopState: state.destinationCancelled
                  ? state.destinationAccepted
                    ? "requested"
                    : "not-needed"
                  : null,
              };
              break;
            case "t3_thread_wait":
              expect(request.arguments.untilDelegatedWorkSettled).toBe(true);
              value = {
                threadId: remoteThreadId,
                runId: "provider-turn",
                status: "completed",
                timedOut: !state.settled,
                ...(state.settled
                  ? { resultRun: { runId: "result-run", status: "completed" } }
                  : {}),
              };
              break;
            case "t3_thread_read": {
              const after = request.arguments.afterPosition;
              value = {
                thread: detail(),
                recentRuns: [],
                items:
                  request.arguments.limit === 1
                    ? []
                    : after === undefined
                      ? [item("provider-turn", "Old provider reply", 1)]
                      : [item("result-run", "Final delegated result", 2)],
                hasMore: request.arguments.limit !== 1 && after === undefined,
                nextPosition: request.arguments.limit !== 1 && after === undefined ? 1 : null,
              };
              break;
            }
            case "t3_thread_interrupt":
              state.stops++;
              value = {
                threadId: remoteThreadId,
                runId: "provider-turn",
                status: "interrupt_requested",
              };
              break;
            case "t3_thread_send":
              if (state.failNextSend) {
                state.failNextSend = false;
                return yield* new OrchestratorMcpFailure({
                  code: "orchestration_error",
                  message: "Send accepted; response lost",
                });
              }
              value = {
                threadId: remoteThreadId,
                messageId: "followup-message",
                runId: "followup-run",
                status: "running",
                delivery: "started",
              };
              break;
            default:
              return yield* new OrchestratorMcpFailure({
                code: "invalid_request",
                message: "Unexpected tool",
              });
          }
          // eslint-disable-next-line t3code/no-inline-schema-compile -- Each generic mocked tool supplies its own response schema.
          return yield* Schema.decodeUnknownEffect(request.success)(value).pipe(
            Effect.mapError(
              (cause) =>
                new OrchestratorMcpFailure({ code: "orchestration_error", message: String(cause) }),
            ),
          );
        }),
    }),
  );
  return { calls, state, dependencies };
}

const row = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  return (yield* sql<CodingRow>`SELECT * FROM openbot_coding_tasks WHERE thread_id = ${receiptId}`)[0]!;
});
const seed = Effect.gen(function* () {
  const remote = yield* RemoteCoding.RemoteCoding;
  const sql = yield* SqlClient.SqlClient;
  const authority = yield* remote.authorize(input);
  const json = yield* encodeLaunch(input);
  yield* sql`INSERT INTO openbot_coding_tasks (host_id,agent_id,task_id,operation_id,project_id,thread_id,command_id,input_json,created_at,destination_environment_id,remote_authority_json)
    VALUES ('host','bot','task','operation',${input.projectId},${receiptId},'stable-launch',${json},${stamp},${environmentId},${authority})`;
});

it.effect(
  "recovers an uncertain launch with one receipt, follows settled children and stops after source revocation",
  () => {
    const h = harness(true);
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const remote = yield* RemoteCoding.RemoteCoding;
        yield* seed;
        expect((yield* Effect.flip(remote.launch(yield* row, input))).reason).toBe("execution");
        expect((yield* remote.snapshot(yield* row)).remoteState).toBe("reconciliation-required");
      }).pipe(Effect.provide(RemoteCoding.layer));
      yield* Effect.gen(function* () {
        const remote = yield* RemoteCoding.RemoteCoding;
        yield* remote.reconcile();
        let task = yield* remote.snapshot(yield* row);
        expect(task.threadId).toBe(remoteThreadId);
        expect(task.environmentId).toBe(environmentId);
        expect(task.state).toBe("waiting");
        expect(task.result).toBeNull();
        expect(task.pendingRequestIds).toEqual([]);
        expect(task.pendingRequestCount).toBe(1);
        const launches = h.calls.filter((call) => call.tool === "t3_thread_launch");
        expect(launches).toHaveLength(1);
        expect(
          h.calls.find((call) => call.tool === "t3_thread_launch_receipt")?.args.clientRequestId,
        ).toBe(launches[0]!.args.clientRequestId);
        h.state.settled = true;
        yield* remote.reconcile();
        task = yield* remote.snapshot(yield* row);
        expect(task.state).toBe("completed");
        expect(task.runId).toBe("result-run");
        expect(task.result).toBe("Final delegated result");
        expect(task.remoteState).toBe("settled");
        const before = h.calls.length;
        h.state.active = false;
        expect(
          (yield* Effect.flip(
            remote.send(yield* row, {
              ...input,
              commandId: CommandId.make("followup"),
              text: "Continue",
            }),
          )).reason,
        ).toBe("authorization");
        yield* remote.reconcile(receiptId);
        expect(h.calls).toHaveLength(before);
        expect((yield* remote.snapshot(yield* row)).result).toBe("Final delegated result");
      }).pipe(Effect.provide(RemoteCoding.layer));
    }).pipe(Effect.provideService(RemoteCoding.Caller, caller), Effect.provide(h.dependencies));
  },
);

it.effect(
  "reconciles uncertain launch cancellation with its destination receipt without relaunching work",
  () => {
    const h = harness(true);
    return Effect.gen(function* () {
      const remote = yield* RemoteCoding.RemoteCoding;
      yield* seed;
      yield* remote.launch(yield* row, input).pipe(Effect.ignore);
      h.state.receiptAvailable = false;
      const cancelled = yield* remote.cancel(yield* row, {
        ...input,
        commandId: CommandId.make("stop"),
      });
      expect(cancelled.cancelRequested).toBe(true);
      expect(cancelled.state).toBe("launch_pending");
      expect(cancelled.remoteState).toBe("reconciliation-required");
      h.state.receiptAvailable = true;
      yield* remote.reconcile();
      const recovered = yield* remote.snapshot(yield* row);
      expect(recovered.threadId).toBe(remoteThreadId);
      expect(recovered.cancelRequested).toBe(true);
      expect(recovered.state).toBe("waiting");
      expect(recovered.remoteState).toBe("following");
      expect(h.state.stops).toBe(1);
      expect(h.calls.filter((call) => call.tool === "t3_thread_launch")).toHaveLength(1);
      expect(
        h.calls.some(
          (call) => call.tool === "t3_thread_launch_receipt" && call.args.action === "cancel",
        ),
      ).toBe(true);
    }).pipe(
      Effect.provide(RemoteCoding.layer),
      Effect.provideService(RemoteCoding.Caller, caller),
      Effect.provide(h.dependencies),
    );
  },
);

it.effect(
  "records a destination cancellation tombstone when the uncertain launch never arrived",
  () => {
    const h = harness();
    h.state.rejectFirstLaunch = true;
    return Effect.gen(function* () {
      const remote = yield* RemoteCoding.RemoteCoding;
      yield* seed;
      yield* remote.launch(yield* row, input).pipe(Effect.ignore);
      const cancelled = yield* remote.cancel(yield* row, {
        ...input,
        commandId: CommandId.make("cancel-undelivered"),
      });
      expect(cancelled.state).toBe("cancelled");
      expect(cancelled.cancelRequested).toBe(true);
      expect(cancelled.remoteState).toBe("settled");
      expect(h.state.destinationCancelled).toBe(true);
      yield* remote.reconcile();
      yield* remote.launch(yield* row, input);
      expect(h.calls.filter((call) => call.tool === "t3_thread_launch")).toHaveLength(1);
      expect(h.state.destinationAccepted).toBe(false);
    }).pipe(
      Effect.provide(RemoteCoding.layer),
      Effect.provideService(RemoteCoding.Caller, caller),
      Effect.provide(h.dependencies),
    );
  },
);

it.effect(
  "fences the original peer grant, preserves stable send/stop keys after reconstruction and denies absent caller authority",
  () => {
    const h = harness();
    const followup = { ...input, commandId: CommandId.make("followup"), text: "Continue" };
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const remote = yield* RemoteCoding.RemoteCoding;
        yield* seed;
        yield* remote.launch(yield* row, input);
        h.state.failNextSend = true;
        yield* remote.send(yield* row, followup).pipe(Effect.ignore);
      }).pipe(Effect.provide(RemoteCoding.layer));
      yield* Effect.gen(function* () {
        const remote = yield* RemoteCoding.RemoteCoding;
        yield* remote.reconcile();
        yield* remote.send(yield* row, followup);
        expect(
          (yield* Effect.flip(remote.send(yield* row, { ...followup, text: "Changed" }))).reason,
        ).toBe("conflict");
        const sends = h.calls.filter((call) => call.tool === "t3_thread_send");
        expect(sends).toHaveLength(2);
        expect(sends[0]!.args.clientRequestId).toBe(sends[1]!.args.clientRequestId);
        yield* remote.cancel(yield* row, { ...input, commandId: CommandId.make("stop") });
        expect(h.state.stops).toBe(1);
        h.state.linkedAt = DateTime.add(link.linkedAt, { seconds: 1 });
        const before = h.calls.length;
        yield* remote.reconcile();
        expect(h.calls).toHaveLength(before);
        expect((yield* remote.snapshot(yield* row)).remoteState).toBe("unavailable");
        expect(
          (yield* Effect.flip(
            remote.authorize(input).pipe(Effect.provideService(RemoteCoding.Caller, undefined)),
          )).reason,
        ).toBe("authorization");
      }).pipe(Effect.provide(RemoteCoding.layer));
    }).pipe(Effect.provideService(RemoteCoding.Caller, caller), Effect.provide(h.dependencies));
  },
);

it.effect("keeps following an accepted recovered send if its snapshot writer stops", () => {
  const h = harness();
  return Effect.gen(function* () {
    const remote = yield* RemoteCoding.RemoteCoding;
    const sql = yield* SqlClient.SqlClient;
    yield* seed;
    yield* remote.launch(yield* row, input);
    h.state.settled = true;
    yield* remote.reconcile();
    expect((yield* row).remote_settled).toBe(1);
    // Crash after enqueue, before clearing the prior turn's settled flag.
    yield* sql`INSERT INTO openbot_remote_coding_sends (receipt_id,command_id,text,authority_json)
      VALUES (${receiptId},'recovered-send','Continue',${JSON.stringify(caller)})`;
    // Stop the subsequent snapshot writer after the peer's acknowledgement is persisted.
    yield* sql`CREATE TRIGGER stop_send_snapshot BEFORE UPDATE OF remote_snapshot_json ON openbot_coding_tasks
      WHEN NEW.remote_settled = 0 AND EXISTS (SELECT 1 FROM openbot_remote_coding_sends WHERE receipt_id = NEW.thread_id AND accepted = 1)
      BEGIN SELECT RAISE(FAIL, 'snapshot writer stopped'); END`;
    h.state.settled = false;
    yield* remote.reconcile().pipe(Effect.ignore);
    yield* sql`DROP TRIGGER stop_send_snapshot`;
    expect((yield* row).remote_settled).toBe(0);
    yield* remote.reconcile();
    const task = yield* remote.snapshot(yield* row);
    expect(task.state).toBe("waiting");
    expect(task.result).toBeNull();
    expect(task.remoteState).toBe("following");
    expect(h.calls.filter((call) => call.tool === "t3_thread_send")).toHaveLength(1);
  }).pipe(
    Effect.provide(RemoteCoding.layer),
    Effect.provideService(RemoteCoding.Caller, caller),
    Effect.provide(h.dependencies),
  );
});

it.effect(
  "allows an active app operator to stop after the original bot credential is revoked without reviving work",
  () => {
    const h = harness();
    return Effect.gen(function* () {
      const remote = yield* RemoteCoding.RemoteCoding;
      yield* seed;
      yield* remote.launch(yield* row, input);
      h.state.active = false;
      const before = h.calls.filter(
        (call) => call.tool === "t3_thread_launch" || call.tool === "t3_thread_send",
      ).length;
      const cancelled = yield* remote
        .cancel(yield* row, { ...input, commandId: CommandId.make("operator-stop") })
        .pipe(Effect.provideService(RemoteCoding.Caller, operator));
      expect(cancelled.cancelRequested).toBe(true);
      expect(h.state.stops).toBe(1);
      expect(
        h.calls.filter(
          (call) => call.tool === "t3_thread_launch" || call.tool === "t3_thread_send",
        ),
      ).toHaveLength(before);
      const stored = yield* row;
      expect(stored.remote_stop_authority_json).toContain("operator");
      h.state.operatorActive = false;
      const calls = h.calls.length;
      yield* remote.reconcile();
      expect(h.calls).toHaveLength(calls);
      expect((yield* remote.snapshot(yield* row)).remoteState).toBe("authorization-required");
    }).pipe(
      Effect.provide(RemoteCoding.layer),
      Effect.provideService(RemoteCoding.Caller, caller),
      Effect.provide(h.dependencies),
    );
  },
);

it.effect(
  "reuses original authority validation locally with current policy and captured ceilings",
  () => {
    const h = harness();
    return Effect.gen(function* () {
      const broad: RemoteCoding.Authority = {
        ...caller,
        limits: { runtimeMode: "full-access", interactionMode: "default" },
      };
      expect(
        yield* RemoteCoding.validateOriginalAuthority(broad).pipe(
          Effect.provide(
            ManagedPolicy.layerTest({
              schemaVersion: 1,
              organization: "fixture",
              limits: { maxRuntimeMode: "approval-required" },
            }),
          ),
        ),
      ).toEqual({ runtimeMode: "approval-required", interactionMode: "default" });
      expect(
        yield* RemoteCoding.validateOriginalAuthority({
          ...caller,
          limits: { runtimeMode: "approval-required", interactionMode: "plan" },
        }),
      ).toEqual({ runtimeMode: "approval-required", interactionMode: "plan" });
      h.state.active = false;
      expect(
        yield* RemoteCoding.validateOriginalAuthority(broad).pipe(Effect.result),
      ).toHaveProperty("_tag", "Failure");
    }).pipe(Effect.provide(h.dependencies));
  },
);

it.effect(
  "local original-thread revalidation narrows modes and rejects provider replacement, archive, deletion and idle context",
  () => {
    const h = harness();
    const threadId = ThreadId.make("original-thread");
    let shell = liveThreadShell(threadId, {
      runtimeMode: "approval-required",
      interactionMode: "plan",
    });
    const original: RemoteCoding.Authority = {
      kind: "thread",
      threadId,
      providerInstanceId: ProviderInstanceId.make("codex"),
      limits: { runtimeMode: "full-access", interactionMode: "default" },
    };
    return Effect.gen(function* () {
      expect(yield* RemoteCoding.validateOriginalAuthority(original)).toEqual({
        runtimeMode: "approval-required",
        interactionMode: "plan",
      });
      const initial = shell;
      for (const changed of [
        { ...initial, providerInstanceId: ProviderInstanceId.make("replacement") },
        { ...initial, archivedAt: DateTime.makeUnsafe(stamp) },
        { ...initial, deletedAt: DateTime.makeUnsafe(stamp) },
        { ...initial, activeRunId: null, pendingBackgroundTasks: [] },
      ]) {
        shell = changed;
        expect(
          yield* RemoteCoding.validateOriginalAuthority(original).pipe(Effect.result),
        ).toHaveProperty("_tag", "Failure");
      }
    }).pipe(
      Effect.provide(
        Layer.merge(
          h.dependencies,
          Layer.mock(ThreadManagement.ThreadManagementService)({
            getThreadShell: () => Effect.sync(() => shell),
          }),
        ),
      ),
    );
  },
);
