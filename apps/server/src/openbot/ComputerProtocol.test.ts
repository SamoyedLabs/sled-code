import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Computer from "./ComputerProtocol.ts";

const capabilities = {
  ready: true,
  platform: "darwin",
  unattended: false,
  runtime: "sunshine-moonlight",
  protocolVersion: 2,
  displays: [{ id: "1", label: "Main", width: 1920, height: 1080, primary: true }],
  selectedDisplayId: "1",
  activeSessions: 0,
  maxSessions: 4,
};
it("uses only the released setup/capability/display routes", () => {
  expect(Computer.route({ operation: "computer.capabilities" })).toEqual({
    method: "GET",
    path: "/v1/remote-screen/capabilities",
    computerProjection: "computer.capabilities",
  });
  expect(Computer.route({ operation: "computer.setup" })).toEqual({
    method: "POST",
    path: "/v1/remote-screen/setup",
    body: {},
    computerProjection: "computer.setup",
  });
  expect(Computer.route({ operation: "computer.display", displayId: "1" })).toEqual({
    method: "PUT",
    path: "/v1/remote-screen/display",
    body: { displayId: "1" },
    computerProjection: "computer.display",
  });
});
it.effect("projects capabilities without upstream viewer secrets or invented readiness", () =>
  Effect.gen(function* () {
    expect(
      yield* Computer.project("computer.capabilities", {
        ...capabilities,
        viewerUrl: "private",
        viewerGrant: "secret",
      }),
    ).toEqual(capabilities);
    expect(
      yield* Computer.project("computer.capabilities", { ...capabilities, ready: false }),
    ).toEqual({ ...capabilities, ready: false });
    expect(
      (yield* Computer.project("computer.capabilities", {
        ...capabilities,
        protocolVersion: 3,
      }).pipe(Effect.result))._tag,
    ).toBe("Failure");
  }),
);
it.effect("retains every setup check and rejects malformed setup", () =>
  Effect.gen(function* () {
    const setup = {
      platform: "linux",
      hostName: "host",
      username: "user",
      checkedAt: null,
      screenRecording: "unavailable",
      accessibility: "unavailable",
      service: "allowed",
      displays: "blocked",
      guiSession: "blocked",
      restartRequired: false,
      activeSessions: 0,
      message: null,
    };
    expect(yield* Computer.project("computer.setup", setup)).toEqual(setup);
    expect(
      (yield* Computer.project("computer.setup", { ...setup, displays: "ready" }).pipe(
        Effect.result,
      ))._tag,
    ).toBe("Failure");
  }),
);
it.effect("service validates response data and retains a safe typed failure", () =>
  Effect.gen(function* () {
    const service = yield* Computer.Computer;
    const result = yield* service
      .execute({ operation: "computer.capabilities" })
      .pipe(Effect.result);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("OpenbotComputerError");
      expect(result.failure.operation).toBe("computer.capabilities");
      expect(result.failure.message).not.toContain("private-viewer-token");
    }
  }).pipe(
    Effect.provide(Computer.layer),
    Effect.provideService(
      Computer.ComputerHost,
      Computer.ComputerHost.of({
        request: () => Effect.succeed({ viewerGrant: "private-viewer-token" }),
      }),
    ),
  ),
);
