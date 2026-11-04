// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off -- Canonical sorted JSON is the persisted hash format; Node crypto creates opaque origin references.
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Clock from "effect/Clock";
import * as SqlClient from "effect/sql/SqlClient";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";
import { Caller, Authority, validateOriginalAuthority } from "./RemoteCoding.ts";

export class ChannelOriginError extends Schema.TaggedError<ChannelOriginError>()(
  "ChannelOriginError",
  {
    reason: Schema.Literals(["authority", "conflict", "missing", "revoked", "storage"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export interface OriginRow {
  readonly origin_ref: string;
  readonly host_id: string;
  readonly fingerprint: string;
  readonly channel_id: string;
  readonly operation_id: string;
  readonly payload_hash: string;
  readonly authority_json: string;
  readonly state: "prepared" | "uncertain" | "accepted" | "revoked";
  readonly message_id: string | null;
  readonly receipt_id: string | null;
  readonly created_at: number;
}

const canonical = (value: Schema.Json): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
export const channelPayloadHash = (value: Schema.Json) =>
  NodeCrypto.createHash("sha256").update(canonical(value)).digest("hex");
const encode = Schema.encodeEffect(Schema.fromJsonString(Authority));
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Authority));
const isChannelOriginError = Schema.is(ChannelOriginError);
const storage = (cause: unknown) => new ChannelOriginError({ reason: "storage", cause });

export class ChannelCodingOrigins extends Context.Service<
  ChannelCodingOrigins,
  {
    readonly prepare: (input: {
      readonly hostId: string;
      readonly fingerprint: string;
      readonly channelId: string;
      readonly operationId: string;
      readonly payload: Schema.Json;
    }) => Effect.Effect<OriginRow, ChannelOriginError>;
    readonly uncertain: (originRef: string) => Effect.Effect<void, ChannelOriginError>;
    readonly accept: (
      originRef: string,
      messageId: string,
      receiptId: string,
    ) => Effect.Effect<OriginRow, ChannelOriginError>;
    readonly revoke: (originRef: string) => Effect.Effect<void, ChannelOriginError>;
    readonly owner: (
      originRef: string,
      hostId: string,
      fingerprint: string,
      channelId: string,
      messageId: string,
    ) => Effect.Effect<Authority, ChannelOriginError>;
  }
>()("t3/openbot/ChannelCodingOrigins") {}

const make = Effect.gen(function* () {
  const authorityContext = yield* Effect.context<
    | EnvironmentAuth.EnvironmentAuth
    | ThreadManagement.ThreadManagementService
    | ManagedPolicy.ManagedPolicy
  >();
  const sql = yield* SqlClient.SqlClient;
  const read = Effect.fn("ChannelCodingOrigins.read")(function* (ref: string) {
    const rows =
      yield* sql<OriginRow>`SELECT * FROM openbot_channel_origins WHERE origin_ref = ${ref}`.pipe(
        Effect.mapError(storage),
      );
    if (!rows[0]) return yield* new ChannelOriginError({ reason: "missing" });
    if (rows[0].state === "revoked") return yield* new ChannelOriginError({ reason: "revoked" });
    return rows[0];
  });
  const prepare: ChannelCodingOrigins["Service"]["prepare"] = Effect.fn(
    "ChannelCodingOrigins.prepare",
  )(function* (input) {
    const caller = yield* Caller;
    // Thread/routine origins need a real standing human grant before they can be adopted.
    if (!caller || caller.kind !== "session" || caller.linked)
      return yield* new ChannelOriginError({ reason: "authority" });
    yield* validateOriginalAuthority(caller).pipe(
      Effect.provide(authorityContext),
      Effect.mapError((cause) => new ChannelOriginError({ reason: "authority", cause })),
    );
    const authority = yield* encode(caller).pipe(Effect.mapError(storage));
    const hash = channelPayloadHash(input.payload);
    const now = yield* Clock.currentTimeMillis;
    const ref = NodeCrypto.randomBytes(32).toString("hex");
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* sql`INSERT INTO openbot_channel_origins (origin_ref,host_id,fingerprint,channel_id,operation_id,payload_hash,authority_json,state,created_at)
        VALUES (${ref},${input.hostId},${input.fingerprint},${input.channelId},${input.operationId},${hash},${authority},'prepared',${now})
        ON CONFLICT(host_id,channel_id,operation_id) DO NOTHING`;
          const rows =
            yield* sql<OriginRow>`SELECT * FROM openbot_channel_origins WHERE host_id=${input.hostId} AND channel_id=${input.channelId} AND operation_id=${input.operationId}`;
          const row = rows[0];
          if (
            !row ||
            row.fingerprint !== input.fingerprint ||
            row.payload_hash !== hash ||
            row.authority_json !== authority
          )
            return yield* new ChannelOriginError({ reason: "conflict" });
          if (row.state === "revoked") return yield* new ChannelOriginError({ reason: "revoked" });
          return row;
        }),
      )
      .pipe(Effect.mapError((cause) => (isChannelOriginError(cause) ? cause : storage(cause))));
  });
  const accept = Effect.fn("ChannelCodingOrigins.accept")(function* (
    ref: string,
    messageId: string,
    receiptId: string,
  ) {
    return yield* sql
      .withTransaction(
        Effect.gen(function* () {
          const row = yield* read(ref);
          if (
            !messageId ||
            !receiptId ||
            (row.message_id !== null &&
              (row.message_id !== messageId || row.receipt_id !== receiptId))
          )
            return yield* new ChannelOriginError({ reason: "conflict" });
          yield* sql`UPDATE openbot_channel_origins SET message_id=${messageId},receipt_id=${receiptId},state='accepted' WHERE origin_ref=${ref}`;
          return yield* read(ref);
        }),
      )
      .pipe(Effect.mapError((cause) => (isChannelOriginError(cause) ? cause : storage(cause))));
  });
  const uncertain = Effect.fn("ChannelCodingOrigins.uncertain")(function* (ref: string) {
    yield* read(ref);
    yield* sql`UPDATE openbot_channel_origins SET state='uncertain' WHERE origin_ref=${ref} AND state='prepared'`.pipe(
      Effect.mapError(storage),
    );
  });
  const revoke = Effect.fn("ChannelCodingOrigins.revoke")(function* (ref: string) {
    yield* sql`UPDATE openbot_channel_origins SET state='revoked' WHERE origin_ref=${ref}`.pipe(
      Effect.mapError(storage),
    );
  });
  const owner = Effect.fn("ChannelCodingOrigins.owner")(function* (
    ref: string,
    hostId: string,
    fingerprint: string,
    channelId: string,
    messageId: string,
  ) {
    const row = yield* read(ref);
    if (
      row.state !== "accepted" ||
      row.host_id !== hostId ||
      row.fingerprint !== fingerprint ||
      row.channel_id !== channelId ||
      row.message_id !== messageId
    )
      return yield* new ChannelOriginError({ reason: "conflict" });
    const authority = yield* decode(row.authority_json).pipe(Effect.mapError(storage));
    yield* validateOriginalAuthority(authority).pipe(
      Effect.provide(authorityContext),
      Effect.mapError((cause) => new ChannelOriginError({ reason: "authority", cause })),
    );
    return authority;
  });
  return ChannelCodingOrigins.of({ prepare, accept, uncertain, revoke, owner });
});
export const layer = Layer.effect(ChannelCodingOrigins, make);
