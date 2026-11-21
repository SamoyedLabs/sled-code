import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Argument, Command, GlobalFlag } from "effect/cli";
import * as CliError from "effect/cli/CliError";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import * as Connectivity from "../remoteDesktop/Connectivity.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";

const withSecrets = Effect.fn("cli.remoteDesktop.withSecrets")(function* <A, E, R>(
  flags: { readonly baseDir: Option.Option<string> },
  operation: Effect.Effect<A, E, R | ServerSecretStore.ServerSecretStore>,
) {
  const config = yield* resolveCliAuthConfig(flags, yield* GlobalFlag.LogLevel);
  return yield* operation.pipe(
    Effect.provide(ServerSecretStore.layer.pipe(Layer.provide(ServerConfig.layer(config)))),
  );
});

const setCommand = Command.make("set", {
  ...projectLocationFlags,
  file: Argument.String("file").pipe(Argument.withDescription("Private TURN configuration JSON.")),
}).pipe(
  Command.withDescription("Install TURN configuration for this environment."),
  Command.withHandler(
    Effect.fn("cli.remoteDesktop.turn.set")(function* (flags) {
      const fs = yield* FileSystem.FileSystem;
      const bytes = yield* fs.open(flags.file, { flag: "r" }).pipe(
        Effect.flatMap((file) => file.readAlloc(Connectivity.maxTurnConfigurationBytes + 1)),
        Effect.scoped,
      );
      yield* withSecrets(
        flags,
        Connectivity.setTurnConfiguration(Option.getOrElse(bytes, () => new Uint8Array())),
      ).pipe(
        Effect.catchTags({
          RemoteDesktopConnectivityError: (cause) =>
            Effect.fail(
              new CliError.UserError({
                cause,
                userMessage:
                  "Could not save TURN configuration. Check the JSON and data directory.",
              }),
            ),
        }),
      );
      yield* Console.log("TURN configuration saved.");
    }),
  ),
);

const clearCommand = Command.make("clear", projectLocationFlags).pipe(
  Command.withDescription("Remove TURN configuration from this environment."),
  Command.withHandler(
    Effect.fn("cli.remoteDesktop.turn.clear")(function* (flags) {
      yield* withSecrets(flags, Connectivity.clearTurnConfiguration());
      yield* Console.log("TURN configuration removed.");
    }),
  ),
);

export const remoteDesktopCommand = Command.make("remote-desktop").pipe(
  Command.withDescription("Manage remote desktop connectivity."),
  Command.withSubcommands([
    Command.make("turn").pipe(
      Command.withDescription("Manage the media relay for this environment."),
      Command.withSubcommands([setCommand, clearCommand]),
    ),
  ]),
);
