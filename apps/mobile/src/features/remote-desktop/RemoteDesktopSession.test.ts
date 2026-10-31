import {
  EnvironmentId,
  RemoteDesktopError,
  EnvironmentAuthorizationError,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { RemoteDesktopSession, type DesktopSessionDependencies } from "./RemoteDesktopSession";

const target = { environmentId: EnvironmentId.make("test-mac"), label: "Development Mac" };
const hostFingerprint = "B".repeat(43);
const offer = {
  clientNonce: "10000000-0000-4000-8000-000000000001",
  clientFingerprint: "A".repeat(43),
  hostFingerprint,
  offer: "v=0\r\n",
};
function setup(
  options: {
    holdStart?: boolean;
    changedHost?: boolean;
    failRetries?: boolean;
    deniedPermissions?: boolean;
    relayAvailable?: boolean;
    signalingReady?: () => boolean;
    retryStatusFailure?: () => unknown;
  } = {},
) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  const starts: string[] = [],
    stops: string[] = [];
  let restartCount = 0;
  const restartConfigurations: string[] = [];
  let renewFailure: unknown;
  const restartGate = Promise.withResolvers<void>();
  const startGate = Promise.withResolvers<void>();
  const startEntered = Promise.withResolvers<void>();
  let statusReads = 0;
  let holdRestart = false;
  const dependencies: DesktopSessionDependencies = {
    ...(options.signalingReady ? { signalingReady: options.signalingReady } : {}),
    native: () => ({
      createNativeOffer: async () => offer,
      createConfiguredNativeOffer: async () => offer,
      createNativeRestartOffer: async (configuration) => {
        restartConfigurations.push(configuration);
        return { sessionId: starts.at(-1)!, offer: offer.offer };
      },
      acceptNativeAnswer: async () => {},
      closeNativeSession: async () => {},
    }),
    rpc: {
      status: async () => {
        statusReads++;
        if (statusReads > 1) {
          const error = options.retryStatusFailure?.();
          if (error) throw error;
        }
        if (options.failRetries && statusReads > 1)
          throw new RemoteDesktopError({ reason: "transport" });
        return {
          ...(options.deniedPermissions
            ? { permissions: { screenRecording: false, accessibility: true } }
            : {}),
          available: true,
          enabled: true,
          remoteEnabled: true,
          internetEnabled: true,
          hostFingerprint:
            options.changedHost && statusReads > 1 ? "C".repeat(43) : hostFingerprint,
          connectivity: {
            iceServers: [],
            expiresAt: 3_600_000,
            relayOnly: false,
            relayAvailable: options.relayAvailable ?? true,
          },
        };
      },
      start: async () => {
        const sessionId = `10000000-0000-4000-8000-${String(starts.length + 1).padStart(12, "0")}`;
        starts.push(sessionId);
        startEntered.resolve();
        if (options.holdStart) await startGate.promise;
        return {
          sessionId,
          clientNonce: offer.clientNonce,
          hostFingerprint,
          answer: offer.offer,
          expiresAt: 30_000,
        };
      },
      renew: async (_environmentId, input) => {
        if (renewFailure) throw renewFailure;
        return { ...input, expiresAt: 30_000 };
      },
      restart: async (_environmentId, input) => {
        restartCount++;
        if (holdRestart) await restartGate.promise;
        return {
          ...input,
          clientNonce: offer.clientNonce,
          hostFingerprint,
          answer: offer.offer,
          expiresAt: 30_000,
        };
      },
      stop: async (_environmentId, input) => {
        stops.push(input.sessionId);
      },
    },
  };
  const session = new RemoteDesktopSession(dependencies);
  return {
    session,
    starts,
    stops,
    restartGate,
    startGate,
    startEntered,
    statusReads: () => statusReads,
    holdRestart: () => {
      holdRestart = true;
    },
    failRenew: (error: unknown) => {
      renewFailure = error;
    },
    restartCount: () => restartCount,
    restartConfigurations,
    [Symbol.dispose]() {
      session.stop();
      vi.useRealTimers();
    },
  };
}

describe("remote desktop network recovery", () => {
  it("waits for T3 signaling to reconnect without exhausting media attempts", async () => {
    let ready = true;
    using f = setup({ signalingReady: () => ready });
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    ready = false;
    f.session.nativeState({ state: "closed" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.session.snapshot().phase).toBe("recovering");
    expect(f.statusReads()).toBe(1);
    ready = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(f.starts).toHaveLength(2);
    f.session.nativeState({ state: "connected" });
    expect(f.session.snapshot().phase).toBe("connected");
  });

  it("rechecks authorization after signaling returns when the grant lookup is unavailable", async () => {
    let ready = true;
    using f = setup({ signalingReady: () => ready });
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    ready = false;
    f.failRenew({ _tag: "ConnectionTransientError" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.session.snapshot().phase).toBe("recovering");
    f.failRenew(undefined);
    ready = true;
    await vi.advanceTimersByTimeAsync(500);
    expect(f.starts).toHaveLength(2);
  });

  it("still stops for a real authorization denial on a connected T3 session", async () => {
    using f = setup({ signalingReady: () => true });
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    f.failRenew(
      new EnvironmentAuthorizationError({
        message: "Desktop control was denied.",
        requiredScope: "orchestration:operate",
        requiredPermission: "desktop:operate",
      }),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.session.snapshot().phase).toBe("idle");
    expect(f.starts).toHaveLength(1);
  });

  it("keeps retrying transient signaling lookup failures within the deadline", async () => {
    let unavailable = true;
    using f = setup({
      retryStatusFailure: () =>
        unavailable ? { _tag: "EnvironmentRpcUnavailableError" } : undefined,
    });
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    f.session.nativeState({ state: "closed" });
    await vi.advanceTimersByTimeAsync(20_000);
    unavailable = false;
    await vi.advanceTimersByTimeAsync(500);
    expect(f.starts).toHaveLength(2);
  });

  it("moves an unusable direct stream to TURN while retaining its authenticated lease", async () => {
    using f = setup();
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    f.session.nativeState({ state: "path", path: "direct" });
    f.session.nativeState({ state: "degraded" });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.restartCount()).toBe(1);
    expect(JSON.parse(f.restartConfigurations[0]!)).toMatchObject({ relayOnly: true });
    expect(f.starts).toHaveLength(1);
    expect(f.stops).toHaveLength(0);
    f.session.nativeState({ state: "path", path: "relayed" });
    f.session.nativeState({ state: "recovered" });
    f.session.nativeState({ state: "needsRestart" });
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(f.restartConfigurations[1]!)).toMatchObject({ relayOnly: true });
    f.session.nativeState({ state: "network", available: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(f.restartConfigurations[2]!)).toMatchObject({ relayOnly: false });
  });

  it("does not force TURN when the host has no configured relay", async () => {
    using f = setup({ relayAvailable: false });
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    f.session.nativeState({ state: "path", path: "direct" });
    f.session.nativeState({ state: "degraded" });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.restartCount()).toBe(0);
    expect(f.session.snapshot().phase).toBe("connected");
  });
  it("does not admit a desktop session before the Mac grants screen permission", async () => {
    using f = setup({ deniedPermissions: true });
    await f.session.connect(target);
    expect(f.starts).toHaveLength(0);
    expect(f.session.snapshot().error).toContain("permissions");
  });
  it("stops a late native admission after the user has disconnected", async () => {
    using f = setup({ holdStart: true });
    const pending = f.session.connect(target);
    await f.startEntered.promise;
    f.session.stop();
    f.startGate.resolve();
    await pending;
    expect(f.stops).toEqual([f.starts[0]]);
    expect(f.session.snapshot().phase).toBe("idle");
  });

  it("never silently follows a changed host identity during recovery", async () => {
    using f = setup({ changedHost: true });
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    f.session.nativeState({ state: "closed" });
    await vi.advanceTimersByTimeAsync(500);
    expect(f.session.snapshot().phase).toBe("idle");
    expect(f.starts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.statusReads()).toBe(2);
  });

  it("limits failed reconnects instead of retrying indefinitely", async () => {
    using f = setup({ failRetries: true });
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    f.session.nativeState({ state: "closed" });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(f.session.snapshot().phase).toBe("idle");
    expect(f.statusReads()).toBe(4);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.statusReads()).toBe(4);
  });
  it("coalesces network changes during restart and keeps the original session", async () => {
    using f = setup();
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    f.holdRestart();
    f.session.nativeState({ state: "network", available: true });
    await vi.advanceTimersByTimeAsync(0);
    expect(f.restartCount()).toBe(1);
    f.session.nativeState({ state: "needsRestart" });
    f.session.nativeState({ state: "needsRestart" });
    f.restartGate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.restartCount()).toBe(2);
    expect(f.starts).toHaveLength(1);
    expect(f.stops).toHaveLength(0);
  });

  it("waits for network recovery and never reconnects after explicit stop", async () => {
    using f = setup();
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    f.session.nativeState({ state: "network", available: false });
    f.session.nativeState({ state: "closed" });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.starts).toHaveLength(1);
    f.session.nativeState({ state: "network", available: true });
    f.session.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.starts).toHaveLength(1);
    expect(f.session.snapshot().phase).toBe("idle");
  });

  it("reconnects a lost stream once with the same pinned host", async () => {
    using f = setup();
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    f.session.nativeState({ state: "closed" });
    expect(f.session.snapshot().phase).toBe("recovering");
    await vi.advanceTimersByTimeAsync(500);
    expect(f.starts).toHaveLength(2);
    expect(f.stops).toEqual([f.starts[0]]);
    f.session.nativeState({ state: "connected" });
    expect(f.session.snapshot().phase).toBe("connected");
  });

  it("ends recovery on revoked authority instead of creating a replacement session", async () => {
    using f = setup();
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    f.failRenew(new RemoteDesktopError({ reason: "revoked" }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(f.session.snapshot().phase).toBe("idle");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.starts).toHaveLength(1);
    expect(f.stops).toEqual([f.starts[0]]);
  });

  it("gives up on an offline recovery within its deadline", async () => {
    using f = setup();
    await f.session.connect(target);
    f.session.nativeState({ state: "connected" });
    f.session.nativeState({ state: "network", available: false });
    f.session.nativeState({ state: "closed" });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.session.snapshot().phase).toBe("idle");
    f.session.nativeState({ state: "network", available: true });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.starts).toHaveLength(1);
  });
});
