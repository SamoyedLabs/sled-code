import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "~/rpc/atomRegistry";
class RemoteDesktopSettingsError extends Schema.TaggedError<RemoteDesktopSettingsError>()(
  "RemoteDesktopSettingsError",
  {},
) {
  override get message() {
    return "Could not load Remote Desktop settings.";
  }
}
export const desktopRemoteDesktopAtom = Atom.make(
  Effect.tryPromise({
    try: () => {
      const bridge = window.desktopBridge?.remoteDesktop;
      if (!bridge) return Promise.reject(new Error("Desktop app required"));
      return bridge.getState();
    },
    catch: () => new RemoteDesktopSettingsError(),
  }),
).pipe(Atom.keepAlive, Atom.swr({ staleTime: 3_000, revalidateOnMount: true }));
export const refreshRemoteDesktop = () => appAtomRegistry.refresh(desktopRemoteDesktopAtom);
