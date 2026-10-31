import { DesktopRemoteDesktopCommand, DesktopRemoteDesktopState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopIpc from "../ipc/DesktopIpc.ts";
import { readRemoteDesktopSettings, changeRemoteDesktopSettings } from "./RemoteDesktopHost.ts";

class RemoteDesktopSettingsSenderError extends Schema.TaggedError<RemoteDesktopSettingsSenderError>()(
  "RemoteDesktopSettingsSenderError",
  {},
) {}
const trusted = Effect.fn(function* (event: DesktopIpc.DesktopIpcInvokeEvent | undefined) {
  const main = yield* (yield* ElectronWindow.ElectronWindow).main;
  if (!event || Option.isNone(main) || main.value.webContents.id !== event.sender.id)
    return yield* new RemoteDesktopSettingsSenderError();
});
export const getRemoteDesktopSettings = DesktopIpc.makeIpcMethod({
  channel: "desktop:remote-desktop:settings",
  payload: Schema.Void,
  result: DesktopRemoteDesktopState,
  handler: Effect.fn(function* (_, event) {
    yield* trusted(event);
    return yield* Effect.promise(readRemoteDesktopSettings);
  }),
});
export const changeRemoteDesktop = DesktopIpc.makeIpcMethod({
  channel: "desktop:remote-desktop:change",
  payload: DesktopRemoteDesktopCommand,
  result: Schema.Void,
  handler: Effect.fn(function* (command, event) {
    yield* trusted(event);
    yield* Effect.promise(() => changeRemoteDesktopSettings(command));
  }),
});
