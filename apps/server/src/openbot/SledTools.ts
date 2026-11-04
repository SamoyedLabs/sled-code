import {
  AuthMcpClientAccess,
  AuthSessionId,
  IsoDateTime,
  type OpenbotSledToolsConnectInput,
  type OpenbotSledToolsStatus,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as NetAddress from "effect/net/NetAddress";
import * as HttpServer from "effect/http/HttpServer";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as Integration from "./Integration.ts";

const SECRET_NAME = "openbot-sled-tools";
const OwnedServer = Schema.Struct({
  hostId: Schema.String,
  name: Schema.String,
  id: Schema.NullOr(Schema.String),
});
const McpRows = Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String }));
const decodeMcpRows = Schema.decodeUnknownEffect(McpRows);
const Entry = Schema.Struct({
  hostId: Schema.String,
  sessionId: AuthSessionId,
  access: AuthMcpClientAccess,
  expiresAt: IsoDateTime,
});
const Record = Schema.Struct({
  active: Schema.NullOr(Entry),
  revoke: Schema.Array(AuthSessionId),
  removeHosts: Schema.Array(Schema.String),
  servers: Schema.Array(OwnedServer),
});
type Record = typeof Record.Type;
const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(Record));
const encode = Schema.encodeEffect(Schema.fromJsonString(Record));

export class SledToolsError extends Schema.TaggedError<SledToolsError>()("OpenbotSledToolsError", {
  operation: Schema.Literals(["status", "connect", "disconnect", "storage", "cleanup"]),
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `The Sled tools connection could not complete (${this.operation}).`;
  }
}
export class SledTools extends Context.Service<
  SledTools,
  {
    readonly status: Effect.Effect<OpenbotSledToolsStatus, SledToolsError>;
    readonly connect: (
      input: OpenbotSledToolsConnectInput,
    ) => Effect.Effect<OpenbotSledToolsStatus, SledToolsError>;
    readonly disconnect: Effect.Effect<OpenbotSledToolsStatus, SledToolsError>;
    readonly reconcile: Effect.Effect<void, SledToolsError>;
  }
>()("t3/openbot/SledTools") {}

const make = Effect.gen(function* () {
  const auth = yield* EnvironmentAuth.EnvironmentAuth;
  const random = yield* SecureRandom.SecureRandom;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const integration = yield* Integration.Integration;
  const server = yield* HttpServer.HttpServer;
  const gate = yield* Semaphore.make(1);
  const load = secrets.get(SECRET_NAME).pipe(
    Effect.flatMap((value) =>
      Option.isNone(value)
        ? Effect.succeed<Record>({ active: null, revoke: [], removeHosts: [], servers: [] })
        : decode(new TextDecoder().decode(value.value)),
    ),
    Effect.mapError((cause) => new SledToolsError({ operation: "storage", cause })),
  );
  const save = Effect.fn("SledTools.save")(
    function* (record: Record) {
      const text = yield* encode(record);
      yield* secrets.set(SECRET_NAME, new TextEncoder().encode(text));
    },
    Effect.mapError((cause) => new SledToolsError({ operation: "storage", cause })),
  );
  const rowsForHost = Effect.fn("SledTools.rowsForHost")(
    function* (hostId: string) {
      const rows = yield* integration.apiAdminToHost(hostId, { operation: "mcp.list" });
      return yield* decodeMcpRows(rows);
    },
    Effect.mapError((cause) => new SledToolsError({ operation: "cleanup", cause })),
  );
  const cleanup = Effect.fn("SledTools.cleanup")(function* () {
    let record = yield* load;
    for (const sessionId of record.revoke) {
      const revoked = yield* auth.revokeSession(sessionId).pipe(Effect.result);
      if (revoked._tag === "Failure") continue;
      record = {
        active: record.active,
        revoke: record.revoke.filter((id) => id !== sessionId),
        removeHosts: record.removeHosts,
        servers: record.servers,
      };
      yield* save(record);
    }
    const hostId = yield* integration.readyHostId;
    if (
      hostId !== null &&
      record.removeHosts.includes(hostId) &&
      record.active?.hostId !== hostId
    ) {
      const owned = record.servers.find((entry) => entry.hostId === hostId);
      const removed = yield* Effect.gen(function* () {
        if (!owned) return;
        const rows = yield* rowsForHost(hostId);
        const row = rows.find((row) => row.id === owned.id || row.name === owned.name);
        if (row)
          yield* integration.apiAdminToHost(hostId, {
            operation: "mcp.delete",
            mcpServerId: row.id,
          });
      }).pipe(Effect.result);
      if (removed._tag === "Success") {
        record = {
          ...record,
          removeHosts: record.removeHosts.filter((id) => id !== hostId),
          servers: record.servers.filter((entry) => entry.hostId !== hostId),
        };
        yield* save(record);
      }
    }
  });
  const status = Effect.gen(function* () {
    const record = yield* load;
    const active = record.active;
    if (!active)
      return {
        state: record.revoke.length
          ? "revocation-pending"
          : record.removeHosts.length
            ? "cleanup-pending"
            : "disconnected",
      } satisfies OpenbotSledToolsStatus;
    const view = { hostId: active.hostId, access: active.access, expiresAt: active.expiresAt };
    if (record.revoke.length)
      return { ...view, state: "revocation-pending" } satisfies OpenbotSledToolsStatus;
    const now = yield* DateTime.now;
    const sessions = yield* auth
      .listSessions()
      .pipe(Effect.mapError((cause) => new SledToolsError({ operation: "status", cause })));
    if (
      Date.parse(active.expiresAt) <= now.epochMilliseconds ||
      !sessions.some((session) => session.sessionId === active.sessionId)
    )
      return { ...view, state: "expired" } satisfies OpenbotSledToolsStatus;
    if ((yield* integration.readyHostId) !== active.hostId)
      return { ...view, state: "host-unavailable" } satisfies OpenbotSledToolsStatus;
    return {
      ...view,
      state: record.revoke.length || record.removeHosts.length ? "cleanup-pending" : "connected",
    } satisfies OpenbotSledToolsStatus;
  });
  const connect = Effect.fn("SledTools.connect")(function* (input: OpenbotSledToolsConnectInput) {
    if (!NetAddress.isInetAddress(server.address) || server.address.port <= 0)
      return yield* new SledToolsError({
        operation: "connect",
        cause: new Error("No TCP listener"),
      });
    if (
      !NetAddress.isUnspecified(server.address.address) &&
      !NetAddress.isLoopback(server.address.address)
    )
      return yield* new SledToolsError({
        operation: "connect",
        cause: new Error("No loopback listener"),
      });
    const port = server.address.port;
    const hostname = NetAddress.isUnspecified(server.address.address)
      ? "127.0.0.1"
      : NetAddress.formatUrlHost(server.address.address);
    const hostId = yield* integration.readyHostId;
    if (hostId === null)
      return yield* new SledToolsError({
        operation: "connect",
        cause: new Error("Openbot host unavailable"),
      });
    yield* cleanup();
    const previous = yield* load;
    const owned = previous.servers.find((entry) => entry.hostId === hostId) ?? {
      hostId,
      name: `Sled Code ${yield* random.uuidV4()}`,
      id: null,
    };
    const rows = yield* rowsForHost(hostId);
    const existing = rows.find((row) => row.id === owned.id || row.name === owned.name);
    const issued = yield* auth
      .issueMcpClientSession({
        label: "Sled persistent bots",
        access: input.access,
        peerLink: false,
        client: { deviceType: "bot" },
      })
      .pipe(Effect.mapError((cause) => new SledToolsError({ operation: "connect", cause })));
    const active = {
      hostId,
      sessionId: issued.sessionId,
      access: input.access,
      expiresAt: DateTime.formatIso(issued.expiresAt),
    };
    const pending: Record = {
      active: null,
      revoke: [
        ...new Set([
          ...previous.revoke,
          ...(previous.active ? [previous.active.sessionId] : []),
          issued.sessionId,
        ]),
      ],
      removeHosts: [
        ...new Set([
          ...previous.removeHosts,
          hostId,
          ...(previous.active ? [previous.active.hostId] : []),
        ]),
      ],
      servers: [...previous.servers.filter((entry) => entry.hostId !== hostId), owned],
    };
    const configured = yield* Effect.gen(function* () {
      yield* save(pending);
      const saved = yield* integration.apiAdminToHost(hostId, {
        operation: "mcp.save",
        config: {
          id: existing?.id ?? "",
          name: owned.name,
          transport: "http",
          enabled: true,
          command: "",
          args: [],
          env: [],
          envPassthrough: [],
          workingDirectory: "",
          url: `http://${hostname}:${port}/mcp`,
          headers: [{ key: "Authorization", value: `Bearer ${issued.token}` }],
        },
      });
      const savedRows = yield* decodeMcpRows(saved);
      const savedRow = savedRows.find((row) => row.name === owned.name);
      if (!savedRow?.id)
        return yield* new SledToolsError({
          operation: "connect",
          cause: new Error("Missing upstream MCP configuration receipt"),
        });
      yield* save({
        active,
        revoke: [
          ...new Set([...previous.revoke, ...(previous.active ? [previous.active.sessionId] : [])]),
        ],
        removeHosts: [
          ...new Set([
            ...previous.removeHosts,
            ...(previous.active ? [previous.active.hostId] : []),
          ]),
        ].filter((id) => id !== hostId),
        servers: [
          ...previous.servers.filter((entry) => entry.hostId !== hostId),
          { ...owned, id: savedRow.id },
        ],
      });
    }).pipe(Effect.result);
    if (configured._tag === "Failure") {
      const revoked = yield* auth.revokeSession(issued.sessionId).pipe(Effect.result);
      yield* save({
        active: null,
        revoke: [
          ...new Set([
            ...previous.revoke,
            ...(previous.active ? [previous.active.sessionId] : []),
            ...(revoked._tag === "Success" ? [] : [issued.sessionId]),
          ]),
        ],
        removeHosts: [
          ...new Set([
            ...previous.removeHosts,
            hostId,
            ...(previous.active ? [previous.active.hostId] : []),
          ]),
        ],
        servers: pending.servers,
      });
      yield* cleanup();
      return yield* new SledToolsError({ operation: "connect", cause: configured.failure });
    }
    yield* cleanup();
    return yield* status;
  });
  const disconnect = Effect.gen(function* () {
    const record = yield* load;
    yield* save({
      ...record,
      active: null,
      revoke: [...new Set([...record.revoke, ...(record.active ? [record.active.sessionId] : [])])],
      removeHosts: [
        ...new Set([...record.removeHosts, ...(record.active ? [record.active.hostId] : [])]),
      ],
    });
    yield* cleanup();
    return yield* status;
  });
  return SledTools.of({
    status: gate.withPermit(status),
    connect: Effect.fn("SledTools.connectSerialized")((input: OpenbotSledToolsConnectInput) =>
      gate.withPermit(Effect.uninterruptible(connect(input))),
    ),
    disconnect: gate.withPermit(Effect.uninterruptible(disconnect)),
    reconcile: gate.withPermit(cleanup()),
  });
});
export const layer = Layer.effect(SledTools, make);
