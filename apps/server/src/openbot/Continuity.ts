import * as PubSub from "effect/PubSub";
import * as Scheduler from "../scheduling/Scheduler.ts";
import {
  AuthSessionId,
  type OpenbotChange,
  type OpenbotAttentionSnapshot,
} from "@t3tools/contracts";
import {
  OpenbotNotification,
  type OpenbotContinuityCommand,
  type OpenbotContinuityStatus,
} from "@t3tools/contracts/openbot-continuity";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as Stream from "effect/Stream";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { CLOUD_LINKED_USER_ID } from "../cloud/config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as AuthSessions from "../persistence/AuthSessions.ts";
import * as AgentAwarenessRelay from "../relay/AgentAwarenessRelay.ts";
import * as ChannelCodingEvents from "./ChannelCodingEvents.ts";
import * as ChannelCodingGrants from "./ChannelCodingGrants.ts";
import * as Integration from "./Integration.ts";

export const ContinuityCallerSession = Context.Reference<AuthSessionId | undefined>(
  "t3/openbot/ContinuityCallerSession",
  { defaultValue: () => undefined },
);
export class ContinuityError extends Schema.TaggedError<ContinuityError>()(
  "OpenbotContinuityError",
  {
    reason: Schema.Literals(["storage", "authority", "configuration", "identity-conflict"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return `Bot continuity failed (${this.reason}).`;
  }
}
export class Continuity extends Context.Service<
  Continuity,
  {
    readonly changes: Stream.Stream<OpenbotChange>;
    readonly execute: (
      command: OpenbotContinuityCommand,
    ) => Effect.Effect<OpenbotContinuityStatus, ContinuityError>;
    readonly ingest: (
      event: ChannelCodingEvents.ChannelCodingEvent,
    ) => Effect.Effect<void, ContinuityError>;
    readonly captureAttention: (
      snapshot: OpenbotAttentionSnapshot,
    ) => Effect.Effect<void, ContinuityError>;
    readonly captureResponsibilities: Effect.Effect<void, ContinuityError>;
    readonly drain: Effect.Effect<void, ContinuityError>;
    readonly start: Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/openbot/Continuity") {}
const decodeNotification = Schema.decodeUnknownEffect(Schema.fromJsonString(OpenbotNotification));
const encodeNotification = Schema.encodeEffect(Schema.fromJsonString(OpenbotNotification));
const decodeAuthority = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ChannelCodingEvents.ChannelCodingEvent),
);
const encodeAuthority = Schema.encodeEffect(
  Schema.fromJsonString(ChannelCodingEvents.ChannelCodingEvent),
);
const encodeAttentionId = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Tuple([
      Schema.String,
      Schema.String,
      Schema.String,
      Schema.Union([Schema.String, Schema.Int]),
      Schema.NullOr(Schema.String),
    ]),
  ),
);
interface Recipient {
  readonly session_id: string;
  readonly cloud_user_id: string;
  readonly enabled: number;
  readonly updated_at?: string;
}
interface Outbox {
  readonly event_id: string;
  readonly session_id: string;
  readonly payload_json: string;
  readonly authority_json: string | null;
}
const storage = (cause: unknown) =>
  isContinuityError(cause) ? cause : new ContinuityError({ reason: "storage", cause });
const isContinuityError = Schema.is(ContinuityError);
const encodeResponsibilityId = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const sessions = yield* AuthSessions.AuthSessionRepository;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const integration = yield* Integration.Integration;
  const events = yield* ChannelCodingEvents.ChannelCodingEvents;
  const grants = yield* ChannelCodingGrants.ChannelCodingGrants;
  const relay = yield* AgentAwarenessRelay.AgentAwarenessRelay;
  const changes = yield* PubSub.sliding<OpenbotChange>(1);
  const gate = yield* Semaphore.make(1);
  const scanGate = yield* Semaphore.make(1);
  const scheduler = yield* Scheduler.Scheduler;
  let responsibilitiesDirty = true;
  let started = false;
  const cloudUser = secrets.get(CLOUD_LINKED_USER_ID).pipe(
    Effect.map((bytes) => (Option.isSome(bytes) ? new TextDecoder().decode(bytes.value) : null)),
    Effect.mapError(storage),
  );
  const allowed = Effect.fn("Continuity.allowed")(function* (recipient: Recipient) {
    const session = yield* sessions
      .getById({ sessionId: AuthSessionId.make(recipient.session_id) })
      .pipe(Effect.mapError(storage));
    const now = yield* DateTime.now;
    return (
      recipient.enabled === 1 &&
      recipient.cloud_user_id === (yield* cloudUser) &&
      Option.isSome(session) &&
      session.value.revokedAt === null &&
      session.value.expiresAt.epochMilliseconds > now.epochMilliseconds &&
      session.value.scopes.includes("orchestration:read")
    );
  });
  const enqueue = Effect.fn("Continuity.enqueue")(function* (
    notification: OpenbotNotification,
    recipient: Recipient,
    authority: ChannelCodingEvents.ChannelCodingEvent | null,
  ) {
    if (!(yield* allowed(recipient))) return;
    const payload = yield* encodeNotification(notification).pipe(Effect.mapError(storage));
    const existing = yield* sql<{
      readonly payload_json: string;
    }>`SELECT payload_json FROM openbot_attention_outbox WHERE event_id=${notification.eventId} AND session_id=${recipient.session_id}`.pipe(
      Effect.mapError(storage),
    );
    if (existing[0] && existing[0].payload_json !== payload)
      return yield* new ContinuityError({ reason: "identity-conflict" });
    const now = DateTime.formatIso(yield* DateTime.now);
    yield* sql`INSERT INTO openbot_attention_outbox(event_id,session_id,payload_json,authority_json,created_at) VALUES(${notification.eventId},${recipient.session_id},${payload},${authority === null ? null : yield* encodeAuthority(authority).pipe(Effect.mapError(storage))},${now}) ON CONFLICT(event_id,session_id) DO NOTHING`.pipe(
      Effect.mapError(storage),
    );
    yield* PubSub.publish(changes, { hostId: notification.target.hostId, resource: "all" });
  });
  const ingest = Effect.fn("Continuity.ingest")(function* (
    event: ChannelCodingEvents.ChannelCodingEvent,
  ) {
    const recipients =
      yield* sql<Recipient>`SELECT * FROM openbot_attention_recipients WHERE session_id=${event.recipient.sessionId} AND enabled=1`.pipe(
        Effect.mapError(storage),
      );
    if (!recipients[0]) return;
    const environmentId = yield* environment.getEnvironmentId;
    yield* enqueue(
      {
        eventId: event.eventId,
        target: {
          kind: "bot",
          environmentId,
          hostId: event.hostId,
          agentId: event.agentId,
          taskId: event.taskId,
          channelId: event.channelId,
        },
        codingTarget: {
          environmentId: event.environmentId ?? environmentId,
          threadId: event.threadId,
        },
        phase: event.status,
        updatedAt: event.updatedAt,
      },
      recipients[0],
      event,
    );
  }, Effect.mapError(storage));
  const captureAttention = Effect.fn("Continuity.captureAttention")(function* (
    snapshot: OpenbotAttentionSnapshot,
  ) {
    if (snapshot.hostId === null || snapshot.state !== "ready" || !snapshot.complete) return;
    const recipients =
      yield* sql<Recipient>`SELECT * FROM openbot_attention_recipients WHERE enabled=1`.pipe(
        Effect.mapError(storage),
      );
    // These recipients explicitly opted their own session into host attention; channel events use their exact origin recipient.
    const environmentId = yield* environment.getEnvironmentId;
    for (const request of snapshot.requests) {
      const eventId = yield* encodeAttentionId([
        snapshot.hostId,
        request.agentId,
        request.kind,
        request.requestId,
        request.turnId ?? null,
      ]).pipe(Effect.mapError(storage));
      const existing = yield* sql<{
        readonly payload_json: string;
      }>`SELECT payload_json FROM openbot_attention_outbox WHERE event_id=${eventId} LIMIT 1`.pipe(
        Effect.mapError(storage),
      );
      const notification: OpenbotNotification = existing[0]
        ? yield* decodeNotification(existing[0].payload_json).pipe(Effect.mapError(storage))
        : {
            eventId,
            target: {
              kind: "bot",
              environmentId,
              hostId: snapshot.hostId,
              agentId: request.agentId,
            },
            phase: request.kind === "approval" ? "needs_approval" : "needs_input",
            updatedAt: DateTime.formatIso(yield* DateTime.now),
          };
      for (const recipient of recipients) yield* enqueue(notification, recipient, null);
    }
  });
  const captureResponsibilities = scanGate
    .withPermit(
      Effect.gen(function* () {
        const hostId = yield* integration.readyHostId;
        if (hostId === null) return;
        const recipients =
          yield* sql<Recipient>`SELECT * FROM openbot_attention_recipients WHERE enabled=1`.pipe(
            Effect.mapError(storage),
          );
        if (recipients.length === 0) return;
        const environmentId = yield* environment.getEnvironmentId;
        const agents = yield* integration.listAgents;
        const tasksSchema = Schema.Struct({
          agentId: Schema.String,
          tasks: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              outcome: Schema.NullOr(Schema.String),
              state: Schema.String,
              updatedAt: Schema.String,
            }),
          ),
        });
        const runsSchema = Schema.Array(
          Schema.Struct({
            id: Schema.String,
            routineId: Schema.String,
            status: Schema.String,
            updatedAt: Schema.String,
          }),
        );
        const routineSchema = Schema.Array(Schema.Struct({ id: Schema.String }));
        const emit = Effect.fn("Continuity.responsibilityEvent")(function* (
          notification: OpenbotNotification,
        ) {
          const at = Date.parse(notification.updatedAt);
          if (!Number.isFinite(at)) return;
          for (const recipient of recipients) {
            if (recipient.updated_at && at < Date.parse(recipient.updated_at)) continue;
            yield* enqueue(notification, recipient, null);
          }
        });
        for (const agent of agents) {
          const tasks = yield* integration
            .apiReadToHost(hostId, { operation: "task.list", agentId: agent.id })
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(tasksSchema)));
          if (tasks.agentId !== agent.id)
            return yield* new ContinuityError({ reason: "identity-conflict" });
          for (const task of tasks.tasks) {
            const phase =
              task.outcome === "completed"
                ? "completed"
                : task.outcome === "failed"
                  ? "failed"
                  : task.outcome === "interrupted"
                    ? "cancelled"
                    : null;
            if (phase === null) continue;
            const eventId = yield* encodeResponsibilityId([
              hostId,
              agent.id,
              "task",
              task.id,
              phase,
              task.updatedAt,
            ]);
            yield* emit({
              eventId,
              target: { kind: "bot", environmentId, hostId, agentId: agent.id, taskId: task.id },
              phase,
              updatedAt: task.updatedAt,
            });
          }
          const routines = yield* integration
            .apiReadToHost(hostId, { operation: "routine.list", agentId: agent.id })
            .pipe(Effect.flatMap(Schema.decodeUnknownEffect(routineSchema)));
          for (const routine of routines) {
            const runs = yield* integration
              .apiReadToHost(hostId, {
                operation: "routine.runs",
                agentId: agent.id,
                routineId: routine.id,
              })
              .pipe(Effect.flatMap(Schema.decodeUnknownEffect(runsSchema)));
            for (const run of runs) {
              if (run.routineId !== routine.id)
                return yield* new ContinuityError({ reason: "identity-conflict" });
              const phase =
                run.status === "succeeded"
                  ? "completed"
                  : run.status === "needs-attention"
                    ? "needs_input"
                    : run.status === "failed"
                      ? "failed"
                      : run.status === "interrupted" || run.status === "cancelled"
                        ? "cancelled"
                        : null;
              if (phase === null) continue;
              const eventId = yield* encodeResponsibilityId([
                hostId,
                agent.id,
                "routine",
                routine.id,
                run.id,
                phase,
                run.updatedAt,
              ]);
              yield* emit({
                eventId,
                target: {
                  kind: "bot",
                  environmentId,
                  hostId,
                  agentId: agent.id,
                  routineId: routine.id,
                  routineRunId: run.id,
                },
                phase,
                updatedAt: run.updatedAt,
              });
            }
          }
        }
      }),
    )
    .pipe(Effect.mapError(storage));
  const drain = gate.withPermit(
    Effect.gen(function* () {
      const rows =
        yield* sql<Outbox>`SELECT event_id,session_id,payload_json,authority_json FROM openbot_attention_outbox WHERE state='pending' ORDER BY created_at LIMIT 100`.pipe(
          Effect.mapError(storage),
        );
      for (const row of rows) {
        const recipient =
          (yield* sql<Recipient>`SELECT * FROM openbot_attention_recipients WHERE session_id=${row.session_id}`.pipe(
            Effect.mapError(storage),
          ))[0];
        const notification = yield* decodeNotification(row.payload_json).pipe(
          Effect.mapError(storage),
        );
        let valid = recipient !== undefined && (yield* allowed(recipient));
        if (valid && row.authority_json !== null) {
          const event = yield* decodeAuthority(row.authority_json).pipe(Effect.mapError(storage));
          valid = yield* grants
            .authorizeDelivery({
              hostId: event.hostId,
              agentId: event.agentId,
              taskId: event.taskId,
              channelId: event.channelId,
              threadId: event.threadId,
              sessionId: event.recipient.sessionId,
              ...(event.recipient.grantId === undefined
                ? {}
                : { grantId: event.recipient.grantId }),
            })
            .pipe(Effect.mapError(storage));
        }
        if (!valid) {
          yield* sql`UPDATE openbot_attention_outbox SET state='revoked',last_error='recipient-revoked' WHERE event_id=${row.event_id} AND session_id=${row.session_id}`.pipe(
            Effect.mapError(storage),
          );
          continue;
        }
        if ((yield* integration.readyHostId) !== notification.target.hostId) continue;
        const result = yield* relay.publishBot({
          notification,
          recipientUserId: recipient!.cloud_user_id,
        });
        yield* sql`UPDATE openbot_attention_outbox SET attempts=attempts+1,state=${result === "delivered" ? "delivered" : result === "recipient-revoked" ? "revoked" : "pending"},last_error=${result === "delivered" ? null : result},delivered_at=${result === "delivered" ? DateTime.formatIso(yield* DateTime.now) : null} WHERE event_id=${row.event_id} AND session_id=${row.session_id}`.pipe(
          Effect.mapError(storage),
        );
      }
      if (rows.length > 0)
        yield* PubSub.publish(changes, { hostId: yield* integration.readyHostId, resource: "all" });
    }),
  );
  const execute = Effect.fn("Continuity.execute")(function* (command: OpenbotContinuityCommand) {
    const sessionId = yield* ContinuityCallerSession;
    if (sessionId === undefined) return yield* new ContinuityError({ reason: "authority" });
    if (command.action === "configure") {
      const caller = yield* sessions.getById({ sessionId }).pipe(Effect.mapError(storage));
      const now = yield* DateTime.now;
      if (
        Option.isNone(caller) ||
        caller.value.revokedAt !== null ||
        caller.value.expiresAt.epochMilliseconds <= now.epochMilliseconds ||
        !caller.value.scopes.includes("settings:write")
      )
        return yield* new ContinuityError({ reason: "authority" });
      if (!command.enabled) {
        yield* sql`UPDATE openbot_attention_recipients SET enabled=0,updated_at=${DateTime.formatIso(now)} WHERE session_id=${sessionId}`.pipe(
          Effect.mapError(storage),
        );
      } else {
        const userId = yield* cloudUser;
        if (userId === null) return yield* new ContinuityError({ reason: "configuration" });
        if (!(yield* allowed({ session_id: sessionId, cloud_user_id: userId, enabled: 1 })))
          return yield* new ContinuityError({ reason: "authority" });
        yield* sql`INSERT INTO openbot_attention_recipients(session_id,cloud_user_id,enabled,updated_at) VALUES(${sessionId},${userId},1,${DateTime.formatIso(now)}) ON CONFLICT(session_id) DO UPDATE SET cloud_user_id=excluded.cloud_user_id,enabled=excluded.enabled,updated_at=excluded.updated_at`.pipe(
          Effect.mapError(storage),
        );
        yield* captureAttention(yield* integration.attentionSnapshot);
        responsibilitiesDirty = true;
      }
    }
    if (command.action !== "status") yield* drain;
    const recipient =
      (yield* sql<Recipient>`SELECT * FROM openbot_attention_recipients WHERE session_id=${sessionId}`.pipe(
        Effect.mapError(storage),
      ))[0];
    const counts = yield* sql<{
      readonly state: string;
      readonly count: number;
    }>`SELECT state,COUNT(*) AS count FROM openbot_attention_outbox WHERE session_id=${sessionId} GROUP BY state`.pipe(
      Effect.mapError(storage),
    );
    const last = (yield* sql<{
      readonly last_error: string | null;
    }>`SELECT last_error FROM openbot_attention_outbox WHERE session_id=${sessionId} ORDER BY created_at DESC LIMIT 1`.pipe(
      Effect.mapError(storage),
    ))[0];
    return {
      enabled: recipient !== undefined && (yield* allowed(recipient)),
      transport: yield* relay.botTransportStatus,
      pending: counts.find((row) => row.state === "pending")?.count ?? 0,
      delivered: counts.find((row) => row.state === "delivered")?.count ?? 0,
      revoked: counts.find((row) => row.state === "revoked")?.count ?? 0,
      lastError: last?.last_error ?? null,
    } satisfies OpenbotContinuityStatus;
  });
  const start = Effect.gen(function* () {
    if (started) return;
    started = true;
    const capture = Effect.suspend(() =>
      integration.attentionSnapshot.pipe(Effect.flatMap(captureAttention)),
    ).pipe(
      Effect.andThen(drain),
      Effect.catchCause(() => Effect.logWarning("openbot.continuity-pending")),
    );
    yield* Stream.runForEach(events.stream, (event) =>
      ingest(event).pipe(
        Effect.andThen(drain),
        Effect.catchCause(() => Effect.logWarning("openbot.continuity-channel-pending")),
      ),
    ).pipe(Effect.forkScoped);
    yield* Stream.runForEach(integration.subscribeChanges, () =>
      Effect.sync(() => {
        responsibilitiesDirty = true;
      }).pipe(Effect.andThen(capture)),
    ).pipe(Effect.forkScoped);
    yield* Stream.runForEach(integration.readyChanges, () => drain.pipe(Effect.ignore)).pipe(
      Effect.forkScoped,
    );
    yield* scheduler.register(
      "openbot-notification-outbox",
      Effect.gen(function* () {
        if (responsibilitiesDirty) {
          responsibilitiesDirty = false;
          yield* captureResponsibilities.pipe(
            Effect.tapError(() =>
              Effect.sync(() => {
                responsibilitiesDirty = true;
              }),
            ),
          );
        }
        yield* drain;
      }),
    );
    yield* capture;
  });
  return Continuity.of({
    changes: Stream.fromPubSub(changes),
    execute,
    ingest,
    captureAttention,
    captureResponsibilities,
    drain,
    start,
  });
});
export const layer = Layer.effect(Continuity, make);
