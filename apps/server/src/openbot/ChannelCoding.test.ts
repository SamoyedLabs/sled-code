import { expect, it } from "@effect/vitest";
import {
  OrchestratorMcpFailure,
  AuthSessionId,
  AuthOrchestrationOperateScope,
  EventId,
  ProjectId,
  ProviderInstanceId,
  type OpenbotChannelCodingBinding,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as CommandReceipts from "../orchestration-v2/CommandReceiptStore.ts";
import * as OrchestrationEvents from "../persistence/OrchestrationEventStore.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";
import * as Integration from "./Integration.ts";
import * as Origins from "./ChannelCodingOrigins.ts";
import * as Ledger from "./ChannelCodingLedger.ts";
import * as Events from "./ChannelCodingEvents.ts";
import * as Grants from "./ChannelCodingGrants.ts";
import * as CodingPolicy from "./CodingPolicy.ts";
import * as Coding from "./ChannelCoding.ts";
import * as Tools from "./SledTools.ts";
import { Caller, type Authority } from "./RemoteCoding.ts";
import { TeamClientError } from "./TeamClient.ts";
import type { ChannelCodingTransport, AttributedReceipt } from "./ChannelCodingTransport.ts";
const toJson = Schema.decodeSync(Schema.Json);
const caller = {
  kind: "session",
  sessionId: AuthSessionId.make("alice"),
  limits: { runtimeMode: "approval-required", interactionMode: "default" },
} satisfies Authority;
const request = {
  operation: "channel.send" as const,
  channelId: "channel",
  operationId: "send",
  text: "Fix this",
  recipientAgentId: null,
  replyToMessageId: null,
  attachmentDraftIds: ["draft"],
};
const intent = {
  title: "Fix this",
  prompt: "Fix this",
  projectId: ProjectId.make("project"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  workspaceStrategy: { type: "root" as const },
};
function fixture() {
  const state = {
    remoteKind: "permission",
    sends: 0,
    launches: 0,
    lost: true,
    active: true,
    origin: "",
    message: "",
    hash: "",
    connector: true,
    mode: "",
    attachments: 0,
    loseLaunchResponse: false,
    standing: false,
    permitted: true,
    stops: [] as string[],
    events: [] as Events.ChannelCodingEvent[],
    progress: [] as { eventId: string; status: string; updatedAt: string }[],
  };
  const projections = new Map<string, ReturnType<typeof ProjectionStore.emptyProjection>>();
  const stored = new Map<string, Uint8Array>();
  const launched = new Map<string, CommandReceipts.CommandReceiptV2>();
  const binding = {
    channelId: "channel",
    taskId: "task",
    taskRevision: 1,
    assignmentId: "assignment",
    agentId: "agent",
    turnId: "turn",
    requestMessageId: "",
    requesterId: "upstream-private-owner",
    operationId: "coding",
  } satisfies OpenbotChannelCodingBinding;
  const receipt = (): AttributedReceipt => ({
    originRef: state.origin,
    operationId: "send",
    payloadHash: state.hash,
    actorId: "private-owner",
    messageId: state.message,
    channelId: "channel",
    receiptId: "receipt",
  });
  const port: ChannelCodingTransport = {
    progressAvailable: Effect.succeed(true),
    progress: (_credential, event) =>
      Effect.sync(() => {
        state.progress.push(event);
        return { ...event, delivery: "accepted" as const };
      }),
    available: Effect.succeed(true),
    configure: () => Effect.succeed({ configured: true }),
    recover: () => Effect.succeed(state.origin ? receipt() : null),
    send: (origin, command) =>
      Effect.gen(function* () {
        state.sends++;
        state.origin = origin;
        state.message = `sled-origin-${origin}`;
        binding.requestMessageId = state.message;
        state.attachments =
          command !== null &&
          typeof command === "object" &&
          "attachmentDraftIds" in command &&
          Array.isArray(command.attachmentDraftIds)
            ? command.attachmentDraftIds.length
            : 0;
        state.hash = Origins.channelPayloadHash(command);
        if (state.lost) {
          state.lost = false;
          return yield* new TeamClientError({ reason: "transport" });
        }
        return receipt();
      }),
    verify: () =>
      Effect.succeed({
        originRef: state.standing ? null : state.origin,
        requesterKind: state.standing ? "routine" : "session",
        binding,
        expiresAt: DateTime.makeUnsafe("2099-01-01").epochMilliseconds,
        payloadHash: Origins.channelPayloadHash(toJson(intent)),
      }),
    renew: () => Effect.die("unused"),
    receipt: () => Effect.succeed(null),
    submit: () => Effect.die("unused"),
  };
  const deps = Layer.mergeAll(
    Sqlite.layerMemory,
    SecureRandom.layerWebCrypto,
    ManagedPolicy.layerTest(),
    Layer.mock(Events.ChannelCodingEvents)({
      publish: (event) =>
        Effect.sync(() => {
          state.events.push(event);
        }),
    }),
    Layer.mock(EnvironmentAuth.EnvironmentAuth)({
      listSessions: () =>
        Effect.succeed(
          state.active
            ? [
                {
                  sessionId: caller.sessionId,
                  subject: "client",
                  scopes: [AuthOrchestrationOperateScope],
                  method: "bearer-access-token",
                  client: { label: "fixture", deviceType: "desktop" },
                  issuedAt: DateTime.makeUnsafe("2026-01-01"),
                  expiresAt: DateTime.makeUnsafe("2099-01-01"),
                  lastConnectedAt: null,
                  connected: false,
                  current: false,
                },
              ]
            : [],
        ),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      dispatch: (command) =>
        Effect.sync(() => {
          if ("threadId" in command) state.stops.push(command.threadId);
          return { sequence: 1, storedEvents: [] };
        }),
      stopDelegatedTasks: () => Effect.void,
    }),
    Layer.mock(Integration.Integration)({
      readyHostId: Effect.succeed("host"),
      withChannelToHost: (host, action) =>
        action(port, { hostId: host, fingerprint: "pin" }).pipe(
          Effect.mapError(
            (cause) => new Integration.IntegrationError({ message: "fixture", cause }),
          ),
        ),
      apiReadToHost: () => Effect.succeed({ page: "accepted" }),
    }),
    Layer.mock(Tools.SledTools)({
      connectorSession: () => Effect.succeed(AuthSessionId.make("connector")),
      assertConnector: (session) =>
        session === "connector" && state.connector
          ? Effect.void
          : Effect.fail(
              new Tools.SledToolsError({ operation: "status", cause: "wrong connector" }),
            ),
    }),
    Layer.mock(Grants.ChannelCodingGrants)({
      resolve: () => Effect.succeed({ grantId: "grant", authority: caller, defaults: intent }),
      authorizeDelivery: () => Effect.succeed(state.permitted),
    }),
    Layer.mock(CodingPolicy.CodingPolicy)({
      executionDefaults: () => Effect.succeed(null),
      get: () =>
        Effect.succeed({
          hostId: "host",
          agentId: "agent",
          revision: 0,
          status: "disabled",
          defaults: null,
          pending: null,
          managedBlock: null,
        }),
    }),
    Layer.mock(ServerSecretStore.ServerSecretStore)({
      get: (name) => Effect.succeed(Option.fromNullishOr(stored.get(name))),
      set: (name, value) =>
        Effect.sync(() => {
          stored.set(name, value);
        }),
    }),
    Layer.mock(OrchestrationEvents.OrchestrationEventStore)({}),
    Layer.mock(PeerLinks.PeerLinks)({}),
    Layer.mock(PeerMcpClient.PeerMcpClient)({
      call: (input) =>
        // The mocked peer receives its response schema from the coordinator.
        // eslint-disable-next-line t3code/no-inline-schema-compile
        Schema.decodeEffect(input.success)(
          input.tool === "t3_thread_read"
            ? {
                thread: {
                  threadId: "remote-thread",
                  projectId: "project",
                  title: "Remote",
                  createdBy: "agent",
                  creationSource: "server",
                  status: "waiting",
                  latestRunId: "run",
                  activeRunId: "run",
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
                  runCount: 1,
                  itemCount: 0,
                  pendingRequestCount: 1,
                  pendingRequestIds: ["pending"],
                  pendingRequestKinds: [{ requestId: "pending", kind: state.remoteKind }],
                  archived: false,
                  settled: false,
                  settledAt: null,
                  snoozed: false,
                  snoozedUntil: null,
                  createdAt: "2026-11-04T19:00:00.000Z",
                  updatedAt: "2026-11-04T19:00:00.000Z",
                },
                items: [],
                recentRuns: [],
                hasMore: false,
                nextPosition: null,
              }
            : { threadId: "remote-thread", runId: "run", status: "waiting", timedOut: true },
        ).pipe(
          Effect.mapError(
            (cause) =>
              new OrchestratorMcpFailure({ code: "orchestration_error", message: String(cause) }),
          ),
        ),
    }),
    Layer.mock(ProjectionStore.ProjectionStoreV2)({
      getThreadProjection: (id) => Effect.succeed(projections.get(id)!),
    }),
    Layer.mock(CommandReceipts.CommandReceiptStoreV2)({
      getByCommandId: (id) => Effect.succeed(Option.fromNullishOr(launched.get(id))),
    }),
    Layer.mock(ThreadLaunch.ThreadLaunchService)({
      launch: (input) =>
        Effect.sync(() => {
          const threadId = input.threadId;
          if (!threadId) throw new Error("Expected reserved thread ID");
          state.launches++;
          state.mode = input.runtimeMode;
          launched.set(input.commandId, {
            commandId: input.commandId,
            threadId: threadId,
            commandType: "thread.send",
            acceptedAt: DateTime.makeUnsafe("2026-01-01"),
            resultSequence: 0,
            status: "accepted",
            error: null,
          });
          return {
            threadId: threadId,
            resumed: false,
            projection: ProjectionStore.emptyProjection({
              type: "thread.created",
              id: EventId.make("event"),
              threadId: threadId,
              occurredAt: DateTime.makeUnsafe("2026-01-01"),
              payload: {
                id: threadId,
                projectId: input.projectId,
                title: input.title,
                providerInstanceId: intent.modelSelection.instanceId,
                modelSelection: intent.modelSelection,
                runtimeMode: input.runtimeMode,
                interactionMode: input.interactionMode,
                branch: null,
                worktreePath: null,
                activeProviderThreadId: null,
                lineage: {
                  parentThreadId: null,
                  relationshipToParent: null,
                  rootThreadId: threadId,
                },
                forkedFrom: null,
                createdBy: "agent",
                creationSource: "server",
                createdAt: DateTime.makeUnsafe("2026-01-01"),
                updatedAt: DateTime.makeUnsafe("2026-01-01"),
                archivedAt: null,
                settledOverride: null,
                settledAt: null,
                lastVisitedAt: null,
                deletedAt: null,
              },
            }),
          };
        }).pipe(
          Effect.tap((result) =>
            Effect.sync(() => {
              projections.set(result.threadId, result.projection);
            }),
          ),
          Effect.filterOrFail(
            () => !state.loseLaunchResponse,
            () =>
              new ThreadLaunch.ThreadLaunchError({
                operation: "dispatch-message",
                commandId: input.commandId,
                projectId: input.projectId,
                cause: "Accepted launch response lost",
              }),
          ),
        ),
    }),
  );
  const base = Origins.layer.pipe(Layer.provideMerge(deps));
  return {
    state,
    layer: Coding.layer.pipe(Layer.provideMerge(Ledger.layer.pipe(Layer.provideMerge(base)))),
  };
}
it.effect(
  "recovers a committed lost send, preserves attachments, launches once, and refuses another connector/revoked owner",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const coding = yield* Coding.ChannelCoding;
      expect((yield* coding.send("host", request).pipe(Effect.result))._tag).toBe("Failure");
      expect(yield* coding.send("host", request)).toEqual({ page: "accepted" });
      expect(yield* coding.send("host", { ...request, includeReceipt: true })).toEqual({
        acceptedOperationId: request.operationId,
        acceptedMessageId: f.state.message,
      });
      expect(f.state.sends).toBe(1);
      expect(f.state.attachments).toBe(1);
      const denied = yield* coding.launch("other", "credential", intent).pipe(Effect.result);
      expect(denied._tag).toBe("Failure");
      if (denied._tag === "Failure") expect(denied.failure.definitiveRefusal).toBe(true);
      f.state.loseLaunchResponse = true;
      const uncertain = yield* coding.launch("connector", "credential", intent).pipe(Effect.result);
      expect(uncertain._tag).toBe("Failure");
      if (uncertain._tag === "Failure") expect(uncertain.failure.definitiveRefusal).toBe(false);
      f.state.loseLaunchResponse = false;
      const first = yield* coding.launch("connector", "credential", intent);
      expect(yield* coding.launch("connector", "credential", intent)).toEqual(first);
      expect(f.state.launches).toBe(1);
      expect(f.state.mode).toBe("approval-required");
      f.state.active = false;
      expect(
        (yield* coding.launch("connector", "credential", intent).pipe(Effect.result))._tag,
      ).toBe("Failure");
      expect(f.state.launches).toBe(1);
    }).pipe(Effect.provideService(Caller, caller), Effect.provide(f.layer));
  },
);

it.effect(
  "recovers accepted local receipts, publishes progress, and stops only the revoked standing launch",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const coding = yield* Coding.ChannelCoding;
      yield* coding.send("host", request).pipe(Effect.ignore);
      yield* coding.send("host", request);
      const sql = yield* SqlClient.SqlClient;
      yield* sql`INSERT INTO openbot_channel_grants(id,host_id,fingerprint,agent_id,channel_id,requester_kind,requester_id,owner_session,authority_json,defaults_json,expires_at)
        VALUES('grant','host','pin','agent','channel','routine','routine:owned','alice',${JSON.stringify(caller)},${JSON.stringify(intent)},4070908800000)`;
      f.state.standing = true;
      f.state.loseLaunchResponse = true;
      yield* coding.launch("connector", "credential", intent).pipe(Effect.ignore);
      expect(f.state.launches).toBe(1);
      yield* coding.reconcile;
      expect(f.state.events).toHaveLength(1);
      const event = f.state.events[0]!;
      expect(event.status).toBe("executing");
      expect(f.state.progress).toHaveLength(1);
      expect(f.state.progress[0]?.status).toBe("executing");
      expect(event.recipient).toEqual({ sessionId: caller.sessionId, grantId: "grant" });
      expect(event.channelId).toBe("channel");
      expect(event.taskId).toBe("task");
      yield* TestClock.adjust("1 second");
      yield* coding.reconcile;
      expect(f.state.events[1]).toEqual(event);
      expect(f.state.progress[1]).toEqual(f.state.progress[0]);
      f.state.permitted = false;
      yield* coding.reconcile;
      expect(f.state.stops).toEqual([event.threadId]);
      expect(f.state.events).toHaveLength(2);
      yield* coding.reconcile;
      expect(f.state.stops).toHaveLength(1);
      expect(f.state.progress).toHaveLength(2);
      expect(f.state.launches).toBe(1);
    }).pipe(Effect.provideService(Caller, caller), Effect.provide(f.layer));
  },
);

it.effect(
  "delivers remote approval versus question metadata under current origin authority without settling",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const coding = yield* Coding.ChannelCoding;
      yield* coding.send("host", request).pipe(Effect.ignore);
      yield* coding.send("host", request);
      yield* coding.launch("connector", "credential", intent);
      const sql = yield* SqlClient.SqlClient;
      const rows = yield* sql`SELECT * FROM openbot_channel_coding_tasks`;
      const row = rows[0]!;
      yield* sql`DELETE FROM openbot_channel_coding_tasks`;
      yield* sql`INSERT INTO openbot_channel_coding_tasks ${sql.insert({ ...row, environment_id: "peer", remote_thread_id: "remote-thread", remote_linked_at: "2026-11-04T19:00:00.000Z" })}`;
      for (const [kind, expected] of [
        ["permission", "needs_approval"],
        ["user_input", "needs_input"],
        ["auth_refresh", "needs_input"],
        ["dynamic_tool_call", "needs_input"],
      ]) {
        f.state.remoteKind = kind!;
        yield* coding.reconcile;
        expect(f.state.progress.at(-1)?.status).toBe(expected);
        expect(f.state.events.at(-1)?.recipient).toEqual({ sessionId: caller.sessionId });
      }
      expect(f.state.progress).toHaveLength(4);
      expect(
        (yield* sql<{ state: string }>`SELECT state FROM openbot_channel_coding_tasks`)[0]?.state,
      ).toBe("accepted");
      f.state.active = false;
      yield* coding.reconcile;
      expect(f.state.progress).toHaveLength(4);
      expect(f.state.launches).toBe(1);
    }).pipe(Effect.provideService(Caller, caller), Effect.provide(f.layer));
  },
);
