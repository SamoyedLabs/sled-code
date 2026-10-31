import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import { changeRemoteDesktop, getRemoteDesktopSettings } from "./RemoteDesktopSettingsIpc.ts";
import { changeRemoteDesktopSettings, readRemoteDesktopSettings } from "./RemoteDesktopHost.ts";
vi.mock("./RemoteDesktopHost.ts", () => ({
  readRemoteDesktopSettings: vi.fn(),
  changeRemoteDesktopSettings: vi.fn(async () => {}),
}));
const windowService = {
  main: Effect.succeedSome({ webContents: { id: 7 } }),
} as unknown as ElectronWindow.ElectronWindow["Service"];
it.effect("rejects desktop-control changes from another web contents", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      changeRemoteDesktop
        .handler({ action: "enable" }, { sender: { id: 8 } })
        .pipe(Effect.provideService(ElectronWindow.ElectronWindow, windowService)),
    );
    expect(result._tag).toBe("Failure");
    expect(changeRemoteDesktopSettings).not.toHaveBeenCalled();
  }),
);
it.effect("rejects status reads without a trusted sender", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      getRemoteDesktopSettings
        .handler(undefined)
        .pipe(Effect.provideService(ElectronWindow.ElectronWindow, windowService)),
    );
    expect(result._tag).toBe("Failure");
    expect(readRemoteDesktopSettings).not.toHaveBeenCalled();
  }),
);
it.effect("validates the settings key before invoking the host", () =>
  Effect.gen(function* () {
    const result = yield* Effect.exit(
      changeRemoteDesktop
        .handler(
          { action: "setting", key: "arbitrary-command", value: true },
          { sender: { id: 7 } },
        )
        .pipe(Effect.provideService(ElectronWindow.ElectronWindow, windowService)),
    );
    expect(result._tag).toBe("Failure");
    expect(changeRemoteDesktopSettings).not.toHaveBeenCalled();
  }),
);
