import {
  type OpenbotAgentList,
  type OpenbotHostStatus,
  type OpenbotReadRequest,
  type OpenbotWriteRequest,
  type OpenbotAdminRequest,
  type OpenbotApiResponse,
  type OpenbotAttentionSnapshot,
  type OpenbotChange,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Base64 from "effect/encoding/Base64";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as PubSub from "effect/PubSub";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as ManagedHost from "./ManagedHost.ts";
import * as TeamClient from "./TeamClient.ts";

export class IntegrationError extends Schema.TaggedError<IntegrationError>()(
  "OpenbotIntegrationError",
  {
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class Integration extends Context.Service<
  Integration,
  {
    readonly status: Effect.Effect<OpenbotHostStatus>;
    readonly readyHostId: Effect.Effect<string | null>;
    readonly readyChanges: Stream.Stream<string | null>;
    readonly subscribeChanges: Stream.Stream<OpenbotChange>;
    readonly attentionSnapshot: Effect.Effect<OpenbotAttentionSnapshot>;
    readonly start: Effect.Effect<OpenbotHostStatus, IntegrationError>;
    readonly stop: Effect.Effect<OpenbotHostStatus, IntegrationError>;
    readonly listAgents: Effect.Effect<typeof OpenbotAgentList.Type, IntegrationError>;
    readonly apiRead: (
      input: OpenbotReadRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
    readonly apiReadToHost: (
      hostId: string,
      input: OpenbotReadRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
    readonly apiWrite: (
      input: OpenbotWriteRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
    readonly apiWriteToHost: (
      hostId: string,
      input: OpenbotWriteRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
    readonly apiAdminToHost: (
      hostId: string,
      input: OpenbotAdminRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
    readonly apiAdmin: (
      input: OpenbotAdminRequest,
    ) => Effect.Effect<typeof OpenbotApiResponse.Type, IntegrationError>;
  }
>()("t3/openbot/Integration") {}

const isIntegrationError = Schema.is(IntegrationError);

const make = Effect.fn("OpenbotIntegration.make")(function* (ownerSecret: string | undefined) {
  const host = yield* ManagedHost.ManagedHost;
  const client = yield* TeamClient.TeamClient;
  const status = host.getStatus.pipe(
    Effect.map((value) => ({
      state: value.status,
      ...(value.status === "ready" ? { hostId: value.ready.serverId } : {}),
      ...(value.status === "failed" ? { reason: value.reason } : {}),
    })),
  );
  const scope = yield* Effect.scope;
  const gate = yield* Semaphore.make(1);
  const eventChanges = yield* PubSub.sliding<OpenbotChange>(1);
  let attention: OpenbotAttentionSnapshot = {
    hostId: null,
    state: "disconnected",
    complete: false,
    requests: [],
  };
  const changes = yield* PubSub.unbounded<string | null>();
  const readyHostId = host.getStatus.pipe(
    Effect.map((value) => (value.status === "ready" ? value.ready.serverId : null)),
  );
  const readyChanges = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(changes);
      const current = yield* readyHostId;
      return Stream.concat(Stream.make(current), Stream.fromSubscription(subscription));
    }),
  );
  let connection: { readonly key: string; readonly session: TeamClient.Session } | undefined;
  const clearConnection = Effect.fn("OpenbotIntegration.clearConnection")(function* () {
    const previous = connection;
    connection = undefined;
    attention = { hostId: null, state: "disconnected", complete: false, requests: [] };
    yield* PubSub.publish(eventChanges, { hostId: null, resource: "all" });
    if (previous) yield* previous.session.close.pipe(Effect.ignore);
  });
  yield* Effect.addFinalizer(() => gate.withPermit(clearConnection()));
  const start = gate
    .withPermit(
      Effect.gen(function* () {
        if ((yield* host.getStatus).status !== "ready") yield* clearConnection();
        const started = yield* host.start;
        yield* PubSub.publish(changes, started.serverId);
        return yield* status;
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new IntegrationError({
            message: "Unable to start the configured Openbot host.",
            cause,
          }),
      ),
    );
  const stop = gate.withPermit(
    Effect.gen(function* () {
      yield* clearConnection();
      yield* host.stop;
      yield* PubSub.publish(changes, null);
      return yield* status;
    }),
  );
  const initializedSessions = new WeakSet<TeamClient.Session>();
  const readyAction = Effect.fn("OpenbotIntegration.readyAction")(function* <A>(
    session: TeamClient.Session,
    action: (session: TeamClient.Session) => Effect.Effect<A, TeamClient.TeamClientError>,
    initializes: boolean,
  ) {
    if (!initializedSessions.has(session) && !initializes) {
      // In v0.60 only the roster endpoint waits for provider initialization.
      yield* session.listAgents;
      initializedSessions.add(session);
    }
    const result = yield* action(session);
    if (initializes) initializedSessions.add(session);
    return result;
  });
  const withSession = <A>(
    action: (session: TeamClient.Session) => Effect.Effect<A, TeamClient.TeamClientError>,
    message: string,
    expectedHostId?: string,
    initializes = false,
  ) =>
    gate
      .withPermit(
        Effect.gen(function* () {
          const current = yield* host.getStatus;
          if (
            current.status !== "ready" ||
            ownerSecret === undefined ||
            (expectedHostId !== undefined && current.ready.serverId !== expectedHostId)
          ) {
            yield* clearConnection();
            return yield* new IntegrationError({
              message: "The Openbot host is not ready.",
              cause: new Error("not-ready"),
            });
          }
          const key = `${current.ready.serverId}:${current.ready.fingerprint}:${current.ready.apiUrl}`;
          if (connection?.key !== key) {
            yield* clearConnection();
            attention = {
              hostId: current.ready.serverId,
              state: "connecting",
              complete: false,
              requests: [],
            };
            yield* PubSub.publish(eventChanges, {
              hostId: current.ready.serverId,
              resource: "all",
            });
            const session = yield* client.connect({ apiUrl: current.ready.apiUrl, ownerSecret });
            connection = { key, session };
          }
          const active = connection;
          if (!active) return yield* Effect.die("Openbot session was not established");
          return yield* readyAction(active.session, action, initializes).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                // Expiry/revocation needs a new login; normal reads reuse the session to respect upstream limits.
                if (error.reason !== "http" || error.status !== 401) return yield* error;
                yield* clearConnection();
                attention = {
                  hostId: current.ready.serverId,
                  state: "connecting",
                  complete: false,
                  requests: [],
                };
                yield* PubSub.publish(eventChanges, {
                  hostId: current.ready.serverId,
                  resource: "all",
                });
                const session = yield* client.connect({
                  apiUrl: current.ready.apiUrl,
                  ownerSecret,
                });
                connection = { key, session };
                return yield* readyAction(session, action, initializes);
              }),
            ),
          );
        }),
      )
      .pipe(
        Effect.mapError((cause) =>
          isIntegrationError(cause)
            ? cause
            : new IntegrationError({
                message,
                cause,
              }),
        ),
      );
  let watching = false;
  const watch = readyChanges.pipe(
    Stream.switchMap((hostId) => {
      if (hostId === null) return Stream.empty;
      return Stream.unwrap(
        withSession(
          (session) => session.listAgents.pipe(Effect.as(session)),
          "Unable to connect Openbot events.",
          hostId,
          true,
        ).pipe(
          Effect.map((session) =>
            session.events.pipe(
              Stream.tap((frame) =>
                gate.withPermit(
                  Effect.gen(function* () {
                    // A closed/replaced session may still have queued frames from its previous host.
                    if (connection?.session !== session) return;
                    const current = yield* readyHostId;
                    if (current !== hostId) return;
                    if (frame.type === "snapshot")
                      attention = {
                        hostId,
                        state: "ready",
                        complete: frame.complete,
                        requests: frame.requests,
                      };
                    // A sliding notification may replace another resource, so invalidate the whole Openbot cache.
                    yield* PubSub.publish(eventChanges, { hostId, resource: "all" });
                  }),
                ),
              ),
              Stream.tapError(() =>
                gate.withPermit(
                  Effect.gen(function* () {
                    if (connection?.session !== session) return;
                    attention = { hostId, state: "connecting", complete: false, requests: [] };
                    yield* PubSub.publish(eventChanges, { hostId, resource: "all" });
                  }),
                ),
              ),
            ),
          ),
        ),
      ).pipe(Stream.retry(Schedule.spaced("1 second")));
    }),
    Stream.runDrain,
  );
  const ensureEventsStarted = Effect.fn("OpenbotIntegration.ensureEventsStarted")(function* () {
    if (watching) return;
    watching = true;
    const hostId = yield* readyHostId;
    attention = {
      hostId,
      state: hostId === null ? "disconnected" : "connecting",
      complete: false,
      requests: [],
    };
    yield* Effect.forkIn(watch, scope);
  }, Effect.uninterruptible);
  const attentionSnapshot = ensureEventsStarted().pipe(
    Effect.andThen(Effect.sync(() => attention)),
  );
  const subscribeChanges = Stream.unwrap(
    Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(eventChanges);
      yield* ensureEventsStarted();
      const hostId = yield* readyHostId;
      return Stream.concat(
        Stream.make({ hostId, resource: "all" as const }),
        Stream.fromSubscription(subscription),
      );
    }),
  );
  const listAgents = withSession(
    (session) => session.listAgents,
    "Unable to read the Openbot agent roster.",
    undefined,
    true,
  );
  const apiRead = (input: OpenbotReadRequest) =>
    withSession((session) => session.apiRead(input), "Unable to read Openbot data.");
  const apiReadToHost = (hostId: string, input: OpenbotReadRequest) =>
    withSession(
      (session) => session.apiRead(input),
      "Unable to read the expected Openbot host.",
      hostId,
    );
  const apiWrite = (input: OpenbotWriteRequest) =>
    withSession((session) => session.apiWrite(input), "Unable to update Openbot work.");
  const apiWriteToHost = (hostId: string, input: OpenbotWriteRequest) =>
    withSession(
      (session) => session.apiWrite(input),
      "Unable to update the expected Openbot host.",
      hostId,
    );
  const apiAdminToHost = (hostId: string, input: OpenbotAdminRequest) =>
    withSession(
      (session) => session.apiAdmin(input),
      "Unable to configure the expected Openbot host.",
      hostId,
    );
  const apiAdmin = (input: OpenbotAdminRequest) =>
    withSession((session) => session.apiAdmin(input), "Unable to configure Openbot.");
  return Integration.of({
    status,
    readyHostId,
    readyChanges,
    subscribeChanges,
    attentionSnapshot,
    start,
    stop,
    listAgents,
    apiRead,
    apiReadToHost,
    apiWrite,
    apiWriteToHost,
    apiAdminToHost,
    apiAdmin,
  });
});

export const layerWithHost = (ownerSecret: string | undefined) =>
  Layer.effect(Integration, make(ownerSecret));

// An explicit executable opts this environment in. State and credentials belong to this Sled home.
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const environment = yield* HostProcess.Environment;
    const executablePath = environment.T3CODE_OPENBOT_EXECUTABLE?.trim();
    if (!executablePath) {
      return layerWithHost(undefined).pipe(
        Layer.provide(ManagedHost.layer(undefined)),
        Layer.provide(TeamClient.layer),
      );
    }
    const config = yield* ServerConfig.ServerConfig;
    const path = yield* Path.Path;
    const secrets = yield* ServerSecretStore.ServerSecretStore;
    const ownerSecret = Base64.encode(yield* secrets.getOrCreateRandom("openbot-owner", 32));
    const hostConfig: ManagedHost.ManagedHostConfig = {
      executablePath,
      userDataDirectory: path.join(config.stateDir, "openbot", "profile"),
      agentRoot: path.join(config.stateDir, "openbot", "agents"),
      serverName: "Sled bots",
      ownerSecret,
    };
    return layerWithHost(ownerSecret).pipe(
      Layer.provide(ManagedHost.layer(hostConfig)),
      Layer.provide(TeamClient.layer),
    );
  }),
);
