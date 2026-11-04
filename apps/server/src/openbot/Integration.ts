import { type OpenbotAgentList, type OpenbotHostStatus } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Base64 from "effect/encoding/Base64";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

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
    readonly start: Effect.Effect<OpenbotHostStatus, IntegrationError>;
    readonly stop: Effect.Effect<OpenbotHostStatus, IntegrationError>;
    readonly listAgents: Effect.Effect<typeof OpenbotAgentList.Type, IntegrationError>;
  }
>()("t3/openbot/Integration") {}

const isIntegrationError = Schema.is(IntegrationError);

const make = Effect.fn("OpenbotIntegration.make")(function* (ownerSecret: string | undefined) {
  const host = yield* ManagedHost.ManagedHost;
  const client = yield* TeamClient.TeamClient;
  const status = host.getStatus.pipe(
    Effect.map((value) => ({
      state: value.status,
      ...(value.status === "failed" ? { reason: value.reason } : {}),
    })),
  );
  const gate = yield* Semaphore.make(1);
  let connection: { readonly key: string; readonly session: TeamClient.Session } | undefined;
  const clearConnection = Effect.fn("OpenbotIntegration.clearConnection")(function* () {
    const previous = connection;
    connection = undefined;
    if (previous) yield* previous.session.close.pipe(Effect.ignore);
  });
  yield* Effect.addFinalizer(() => gate.withPermit(clearConnection()));
  const start = gate
    .withPermit(
      Effect.gen(function* () {
        if ((yield* host.getStatus).status !== "ready") yield* clearConnection();
        yield* host.start;
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
      return yield* status;
    }),
  );
  const listAgents = gate
    .withPermit(
      Effect.gen(function* () {
        const current = yield* host.getStatus;
        if (current.status !== "ready" || ownerSecret === undefined) {
          yield* clearConnection();
          return yield* new IntegrationError({
            message: "The Openbot host is not ready.",
            cause: new Error("not-ready"),
          });
        }
        const key = `${current.ready.serverId}:${current.ready.fingerprint}:${current.ready.apiUrl}`;
        if (connection?.key !== key) {
          yield* clearConnection();
          const session = yield* client.connect({ apiUrl: current.ready.apiUrl, ownerSecret });
          connection = { key, session };
        }
        const active = connection;
        if (!active) return yield* Effect.die("Openbot session was not established");
        return yield* active.session.listAgents.pipe(
          Effect.catch((error) =>
            Effect.gen(function* () {
              // Expiry/revocation needs a new login; normal reads reuse the session to respect upstream limits.
              if (error.reason !== "http" || error.status !== 401) return yield* error;
              yield* clearConnection();
              const session = yield* client.connect({ apiUrl: current.ready.apiUrl, ownerSecret });
              connection = { key, session };
              return yield* session.listAgents;
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
              message: "Unable to read the Openbot agent roster.",
              cause,
            }),
      ),
    );
  return Integration.of({ status, start, stop, listAgents });
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
