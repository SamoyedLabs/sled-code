import {
  AuthSessionId,
  AuthSettingsWriteScope,
  sessionGrantsScope,
  type ThreadId,
} from "@t3tools/contracts";
import {
  OpenbotChannelGrantCommand,
  type OpenbotChannelGrant,
} from "@t3tools/contracts/openbotChannelGrants";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as SqlClient from "effect/sql/SqlClient";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import { channelPayloadHash } from "./ChannelCodingOrigins.ts";
import * as RemoteCoding from "./RemoteCoding.ts";
import * as Integration from "./Integration.ts";
import { TeamClientError } from "./TeamClient.ts";
import * as SledTools from "./SledTools.ts";
import { OpenbotCodingPolicyDefaults } from "@t3tools/contracts";
export class ChannelGrantError extends Schema.TaggedError<ChannelGrantError>()(
  "ChannelGrantError",
  {
    reason: Schema.Literals(["authority", "scope", "storage"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
interface Row {
  readonly id: string;
  readonly host_id: string;
  readonly fingerprint: string;
  readonly agent_id: string;
  readonly channel_id: string;
  readonly requester_kind: "routine" | "agent";
  readonly requester_id: string;
  readonly owner_session: string;
  readonly authority_json: string;
  readonly defaults_json: string;
  readonly expires_at: number;
  readonly revoked: number;
}
interface DeliveryInput {
  readonly sessionId: AuthSessionId;
  readonly grantId?: string;
  readonly hostId: string;
  readonly agentId: string;
  readonly channelId: string;
  readonly taskId: string;
  readonly threadId: ThreadId;
}
export class ChannelCodingGrants extends Context.Service<
  ChannelCodingGrants,
  {
    readonly changes: Stream.Stream<string>;
    readonly command: (
      input: OpenbotChannelGrantCommand,
    ) => Effect.Effect<ReadonlyArray<OpenbotChannelGrant>, ChannelGrantError>;
    readonly resolve: (input: {
      hostId: string;
      fingerprint: string;
      agentId: string;
      channelId: string;
      requesterKind: "routine" | "agent";
      requesterId: string;
    }) => Effect.Effect<
      { grantId: string; authority: RemoteCoding.Authority; defaults: OpenbotCodingPolicyDefaults },
      ChannelGrantError
    >;
    readonly authorizeDelivery: (input: DeliveryInput) => Effect.Effect<boolean>;
  }
>()("t3/openbot/ChannelCodingGrants") {}
const decodeDeliveryBinding = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({ agentId: Schema.String, channelId: Schema.String, taskId: Schema.String }),
  ),
);
const decodeAuthority = Schema.decodeUnknownEffect(Schema.fromJsonString(RemoteCoding.Authority));
const decodeDefaults = Schema.decodeUnknownEffect(
  Schema.fromJsonString(OpenbotCodingPolicyDefaults),
);
const encodeAuthority = Schema.encodeEffect(Schema.fromJsonString(RemoteCoding.Authority));
const encodeDefaults = Schema.encodeEffect(Schema.fromJsonString(OpenbotCodingPolicyDefaults));
const storage = (cause: unknown) => new ChannelGrantError({ reason: "storage", cause });
export const layer = Layer.effect(
  ChannelCodingGrants,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const changes = yield* PubSub.unbounded<string>();
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const integration = yield* Integration.Integration;
    const tools = yield* SledTools.SledTools;
    const authorityContext = yield* Effect.context<
      | import("../auth/EnvironmentAuth.ts").EnvironmentAuth
      | import("../orchestration-v2/ThreadManagementService.ts").ThreadManagementService
      | import("../policy/ManagedPolicy.ts").ManagedPolicy
    >();
    const validate = (authority: RemoteCoding.Authority) =>
      RemoteCoding.validateOriginalAuthority(authority).pipe(Effect.provide(authorityContext));
    const resolve = Effect.fn("ChannelCodingGrants.resolve")(function* (input: {
      hostId: string;
      fingerprint: string;
      agentId: string;
      channelId: string;
      requesterKind: "routine" | "agent";
      requesterId: string;
    }) {
      const now = yield* DateTime.now;
      const rows =
        yield* sql<Row>`SELECT * FROM openbot_channel_grants WHERE host_id=${input.hostId} AND fingerprint=${input.fingerprint}
    AND agent_id=${input.agentId} AND channel_id=${input.channelId} AND requester_kind=${input.requesterKind}
    AND requester_id=${input.requesterId} AND revoked=0 AND expires_at>${now.epochMilliseconds} ORDER BY expires_at DESC`;
      const row = rows[0];
      if (!row) return yield* new ChannelGrantError({ reason: "scope" });
      const authority = yield* decodeAuthority(row.authority_json);
      yield* validate(authority);
      return { grantId: row.id, authority, defaults: yield* decodeDefaults(row.defaults_json) };
    }, Effect.mapError(storage));
    const command = Effect.fn("ChannelCodingGrants.command")(function* (
      input: OpenbotChannelGrantCommand,
    ) {
      const caller = yield* RemoteCoding.Caller;
      if (!caller || caller.kind !== "session" || caller.linked)
        return yield* new ChannelGrantError({ reason: "authority" });
      yield* validate(caller);
      const current = (yield* auth.listSessions()).find(
        (session) => session.sessionId === caller.sessionId,
      );
      if (
        !current ||
        !sessionGrantsScope({ authenticated: true, ...current }, AuthSettingsWriteScope)
      )
        return yield* new ChannelGrantError({ reason: "authority" });
      if (
        yield* tools.assertConnector(caller.sessionId, input.hostId).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        )
      )
        return yield* new ChannelGrantError({ reason: "authority" });
      if (input.action === "create") {
        const now = yield* DateTime.now;
        const expiresAt = Date.parse(input.expiresAt);
        if (expiresAt <= now.epochMilliseconds || expiresAt > now.epochMilliseconds + 30 * 86400000)
          return yield* new ChannelGrantError({ reason: "scope" });
        const id = `grant-${channelPayloadHash({ sessionId: caller.sessionId, hostId: input.hostId, operationId: input.operationId })}`;
        const authority = yield* encodeAuthority(caller);
        const defaults = yield* encodeDefaults(input.defaults);
        yield* integration.withChannelToHost(input.hostId, (_port, identity) =>
          sql`INSERT INTO openbot_channel_grants(id,host_id,fingerprint,agent_id,channel_id,requester_kind,requester_id,owner_session,authority_json,defaults_json,expires_at)
      VALUES(${id},${input.hostId},${identity.fingerprint},${input.agentId},${input.channelId},${input.requesterKind},${input.requesterId},${caller.sessionId},${authority},${defaults},${expiresAt}) ON CONFLICT(id) DO NOTHING`.pipe(
            Effect.asVoid,
            Effect.mapError((cause) => new TeamClientError({ reason: "transport", cause })),
          ),
        );
        const saved = (yield* sql<Row>`SELECT * FROM openbot_channel_grants WHERE id=${id}`)[0];
        if (
          !saved ||
          saved.owner_session !== caller.sessionId ||
          saved.defaults_json !== defaults ||
          saved.agent_id !== input.agentId ||
          saved.channel_id !== input.channelId ||
          saved.requester_kind !== input.requesterKind ||
          saved.requester_id !== input.requesterId ||
          saved.expires_at !== expiresAt
        )
          return yield* new ChannelGrantError({ reason: "scope" });
      } else if (input.action === "revoke")
        yield* sql`UPDATE openbot_channel_grants SET revoked=1 WHERE id=${input.id} AND host_id=${input.hostId} AND owner_session=${caller.sessionId}`;
      if (input.action !== "list") yield* PubSub.publish(changes, input.hostId);
      const rows =
        yield* sql<Row>`SELECT * FROM openbot_channel_grants WHERE host_id=${input.hostId} AND owner_session=${caller.sessionId}`;
      return yield* Effect.forEach(rows, (row) =>
        decodeDefaults(row.defaults_json).pipe(
          Effect.map((defaults) => ({
            id: row.id,
            hostId: row.host_id,
            agentId: row.agent_id,
            channelId: row.channel_id,
            requesterKind: row.requester_kind,
            requesterId: row.requester_id,
            defaults,
            expiresAt: DateTime.formatIso(DateTime.makeUnsafe(row.expires_at)),
            revoked: row.revoked === 1,
          })),
        ),
      );
    }, Effect.mapError(storage));
    const authorizeDelivery = Effect.fn("ChannelCodingGrants.authorizeDelivery")(
      function* (input: DeliveryInput) {
        if (input.grantId) {
          const rows =
            yield* sql<Row>`SELECT * FROM openbot_channel_grants WHERE id=${input.grantId}`;
          const row = rows[0];
          const now = yield* DateTime.now;
          if (
            !row ||
            row.revoked ||
            row.expires_at <= now.epochMilliseconds ||
            row.owner_session !== input.sessionId ||
            row.host_id !== input.hostId ||
            row.agent_id !== input.agentId ||
            row.channel_id !== input.channelId
          )
            return false;
          const executions = yield* sql<{
            readonly binding_json: string;
          }>`SELECT binding_json FROM openbot_channel_coding_tasks WHERE grant_id=${row.id} AND (thread_id=${input.threadId} OR remote_thread_id=${input.threadId})`;
          if (!executions.length) return false;
          const binding = yield* decodeDeliveryBinding(executions[0]!.binding_json);
          if (
            binding.agentId !== input.agentId ||
            binding.channelId !== input.channelId ||
            binding.taskId !== input.taskId
          )
            return false;
          yield* validate(yield* decodeAuthority(row.authority_json));
          return true;
        }
        yield* validate({
          kind: "session",
          sessionId: input.sessionId,
          limits: { runtimeMode: "approval-required", interactionMode: "plan" },
        });
        return true;
      },
      Effect.orElseSucceed(() => false),
    );
    return ChannelCodingGrants.of({
      changes: Stream.fromPubSub(changes),
      command,
      resolve,
      authorizeDelivery,
    });
  }),
);
