// @effect-diagnostics nodeBuiltinImport:off -- Node crypto reserves durable command and thread identifiers before dispatch.
import * as NodeCrypto from "node:crypto";
import type { OpenbotChannelCodingBinding } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Clock from "effect/Clock";
import * as SqlClient from "effect/sql/SqlClient";
import * as Origins from "./ChannelCodingOrigins.ts";
import { Authority } from "./RemoteCoding.ts";

export class ChannelLedgerError extends Schema.TaggedError<ChannelLedgerError>()(
  "ChannelLedgerError",
  {
    reason: Schema.Literals(["conflict", "state", "storage"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {}
export interface ChannelRow {
  readonly binding_key: string;
  readonly binding_json: string;
  readonly origin_ref: string;
  readonly launch_hash: string;
  readonly launch_json: string;
  readonly authority_json: string;
  readonly thread_id: string;
  readonly command_id: string;
  readonly environment_id: string | null;
  readonly project_id: string;
  readonly state:
    | "reserved"
    | "uncertain"
    | "accepted"
    | "terminal"
    | "delivered"
    | "stale"
    | "cancelled";
  readonly outcome_json: string | null;
  readonly result_hash: string | null;
  readonly receipt_json: string | null;
  readonly created_at: number;
}
export class ChannelCodingLedger extends Context.Service<
  ChannelCodingLedger,
  {
    readonly reserve: (input: {
      readonly hostId: string;
      readonly fingerprint: string;
      readonly originRef: string;
      readonly binding: OpenbotChannelCodingBinding;
      readonly launch: Schema.Json;
      readonly projectId: string;
      readonly environmentId?: string;
    }) => Effect.Effect<ChannelRow, ChannelLedgerError | Origins.ChannelOriginError>;
    readonly read: (key: string) => Effect.Effect<ChannelRow, ChannelLedgerError>;
    readonly transition: (
      key: string,
      state: ChannelRow["state"],
    ) => Effect.Effect<ChannelRow, ChannelLedgerError>;
    readonly terminal: (
      key: string,
      outcome: Schema.Json,
    ) => Effect.Effect<ChannelRow, ChannelLedgerError>;
    readonly delivered: (
      key: string,
      result: Schema.Json,
      receipt: Schema.Json,
    ) => Effect.Effect<ChannelRow, ChannelLedgerError>;
  }
>()("t3/openbot/ChannelCodingLedger") {}
const isChannelLedgerError = Schema.is(ChannelLedgerError);
const storage = (cause: unknown) => new ChannelLedgerError({ reason: "storage", cause });
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Json));
const encodeAuthority = Schema.encodeEffect(Schema.fromJsonString(Authority));
const next: Record<ChannelRow["state"], ReadonlyArray<ChannelRow["state"]>> = {
  reserved: ["uncertain", "accepted", "cancelled", "stale"],
  uncertain: ["accepted", "cancelled", "stale"],
  accepted: ["cancelled", "stale"],
  terminal: ["cancelled", "stale"],
  cancelled: [],
  stale: [],
  delivered: [],
};
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const origins = yield* Origins.ChannelCodingOrigins;
  const read = Effect.fn("ChannelCodingLedger.read")(function* (key: string) {
    const rows =
      yield* sql<ChannelRow>`SELECT * FROM openbot_channel_coding_tasks WHERE binding_key=${key}`.pipe(
        Effect.mapError(storage),
      );
    if (!rows[0]) return yield* new ChannelLedgerError({ reason: "state" });
    return rows[0];
  });
  const reserve: ChannelCodingLedger["Service"]["reserve"] = Effect.fn(
    "ChannelCodingLedger.reserve",
  )(function* (input) {
    const owner = yield* origins.owner(
      input.originRef,
      input.hostId,
      input.fingerprint,
      input.binding.channelId,
      input.binding.requestMessageId,
    );
    const authority = yield* encodeAuthority(owner).pipe(Effect.mapError(storage));
    const binding = encodeJson({ ...input.binding });
    const key = Origins.channelPayloadHash({
      hostId: input.hostId,
      fingerprint: input.fingerprint,
      ...input.binding,
    });
    const hash = Origins.channelPayloadHash({
      launch: input.launch,
      projectId: input.projectId,
      environmentId: input.environmentId ?? null,
    });
    const now = yield* Clock.currentTimeMillis;
    const threadId = NodeCrypto.randomUUID();
    const commandId = NodeCrypto.randomUUID();
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`INSERT INTO openbot_channel_coding_tasks (binding_key,binding_json,origin_ref,launch_hash,launch_json,authority_json,thread_id,command_id,environment_id,project_id,state,created_at)
        VALUES (${key},${binding},${input.originRef},${hash},${encodeJson(input.launch)},${authority},${threadId},${commandId},${input.environmentId ?? null},${input.projectId},'reserved',${now}) ON CONFLICT(binding_key) DO NOTHING`;
          const row = yield* read(key);
          if (
            row.origin_ref !== input.originRef ||
            row.launch_hash !== hash ||
            row.authority_json !== authority
          )
            return yield* new ChannelLedgerError({ reason: "conflict" });
          return row;
        }),
      )
      .pipe(Effect.mapError((cause) => (isChannelLedgerError(cause) ? cause : storage(cause))));
  });
  const transition = Effect.fn("ChannelCodingLedger.transition")(function* (
    key: string,
    state: ChannelRow["state"],
  ) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const row = yield* read(key);
          if (row.state === state) return row;
          if (!next[row.state].includes(state))
            return yield* new ChannelLedgerError({ reason: "state" });
          yield* sql`UPDATE openbot_channel_coding_tasks SET state=${state} WHERE binding_key=${key}`;
          return yield* read(key);
        }),
      )
      .pipe(Effect.mapError((cause) => (isChannelLedgerError(cause) ? cause : storage(cause))));
  });
  const terminal = Effect.fn("ChannelCodingLedger.terminal")(function* (
    key: string,
    outcome: Schema.Json,
  ) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const row = yield* read(key);
          const json = encodeJson(outcome);
          if (row.state === "terminal" && row.outcome_json === json) return row;
          if (row.state !== "accepted") return yield* new ChannelLedgerError({ reason: "state" });
          yield* sql`UPDATE openbot_channel_coding_tasks SET state='terminal',outcome_json=${json} WHERE binding_key=${key}`;
          return yield* read(key);
        }),
      )
      .pipe(Effect.mapError((cause) => (isChannelLedgerError(cause) ? cause : storage(cause))));
  });
  const delivered = Effect.fn("ChannelCodingLedger.delivered")(function* (
    key: string,
    result: Schema.Json,
    receipt: Schema.Json,
  ) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const row = yield* read(key);
          const hash = Origins.channelPayloadHash(result);
          const json = encodeJson(receipt);
          if (row.state === "delivered" && row.result_hash === hash && row.receipt_json === json)
            return row;
          if (row.state !== "terminal") return yield* new ChannelLedgerError({ reason: "state" });
          yield* sql`UPDATE openbot_channel_coding_tasks SET state='delivered',result_hash=${hash},receipt_json=${json} WHERE binding_key=${key}`;
          return yield* read(key);
        }),
      )
      .pipe(Effect.mapError((cause) => (isChannelLedgerError(cause) ? cause : storage(cause))));
  });
  return ChannelCodingLedger.of({ reserve, read, transition, terminal, delivered });
});
export const layer = Layer.effect(ChannelCodingLedger, make);
