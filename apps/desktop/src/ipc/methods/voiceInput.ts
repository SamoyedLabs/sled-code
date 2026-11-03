import {
  DesktopVoiceInputId,
  DesktopVoiceInputRequest,
  DesktopVoiceInputResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Electron from "electron";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../../electron/ElectronWindow.ts";
import { MacVoiceInput } from "../../voice-input/MacVoiceInput.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

class VoiceInputError extends Schema.TaggedError<VoiceInputError>()("VoiceInputError", {
  message: Schema.String,
}) {}

export const installVoiceInput = Effect.fn("desktop.voiceInput.install")(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  if (environment.platform !== "darwin") return;
  const ipc = yield* DesktopIpc.DesktopIpc;
  const windows = yield* ElectronWindow.ElectronWindow;
  const helper = environment.isPackaged
    ? environment.path.join(environment.resourcesPath, "voice-input", "sled-voice-input")
    : environment.path.join(
        environment.rootDir,
        "native",
        "voice-input",
        "build",
        "sled-voice-input",
      );
  const voice = new MacVoiceInput(helper);
  yield* Effect.addFinalizer(() => Effect.sync(() => voice.cancel()));
  const trusted = Effect.fn("desktop.voiceInput.trusted")(function* (
    event: DesktopIpc.DesktopIpcInvokeEvent | undefined,
  ) {
    const main = yield* windows.main;
    if (!event || Option.isNone(main) || main.value.webContents.id !== event.sender.id)
      return yield* new VoiceInputError({ message: "Untrusted voice input caller." });
    return main.value.webContents;
  });
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: "desktop:voice-input:available",
      payload: Schema.Void,
      result: Schema.Boolean,
      handler: Effect.fn("desktop.voiceInput.available")(function* (_, event) {
        yield* trusted(event);
        return yield* Effect.promise(() =>
          voice.available(Electron.app.getPreferredSystemLanguages()[0] ?? "en-US"),
        );
      }),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: "desktop:voice-input:record",
      payload: DesktopVoiceInputRequest,
      result: DesktopVoiceInputResult,
      handler: Effect.fn("desktop.voiceInput.record")(function* (request, event) {
        const sender = yield* trusted(event);
        return yield* Effect.tryPromise({
          try: async () => {
            const cancel = () => voice.cancel(request.id);
            sender.once("destroyed", cancel);
            sender.once("render-process-gone", cancel);
            sender.once("did-start-navigation", cancel);
            try {
              return await voice.record(
                request.id,
                request.locale,
                () => Electron.systemPreferences.askForMediaAccess("microphone"),
                (phase) => {
                  if (!sender.isDestroyed()) sender.send("desktop:voice-input:phase", phase);
                },
              );
            } finally {
              sender.removeListener("destroyed", cancel);
              sender.removeListener("render-process-gone", cancel);
              sender.removeListener("did-start-navigation", cancel);
            }
          },
          catch: (cause) =>
            new VoiceInputError({
              message: cause instanceof Error ? cause.message : "Voice input failed.",
            }),
        });
      }),
    }),
  );
  for (const action of ["stop", "cancel"] as const) {
    yield* ipc.handle(
      DesktopIpc.makeIpcMethod({
        channel: `desktop:voice-input:${action}`,
        payload: DesktopVoiceInputId,
        result: Schema.Void,
        handler: Effect.fn(`desktop.voiceInput.${action}`)(function* (request, event) {
          yield* trusted(event);
          voice[action](request.id);
        }),
      }),
    );
  }
});
