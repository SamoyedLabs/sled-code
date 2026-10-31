// @effect-diagnostics globalTimers:off -- This route-owned React Native controller cancels every timer on stop/background/unmount.
import {
  RemoteDesktopError,
  type EnvironmentId,
  type RemoteDesktopAnswer,
  type RemoteDesktopLease,
  type RemoteDesktopRestartInput,
  type RemoteDesktopSessionInput,
  type RemoteDesktopStartInput,
  type RemoteDesktopStatus,
} from "@t3tools/contracts";

interface NativeSession {
  createNativeOffer(fingerprint: string): Promise<RemoteDesktopStartInput>;
  createConfiguredNativeOffer(
    fingerprint: string,
    configuration: string,
  ): Promise<RemoteDesktopStartInput>;
  createNativeRestartOffer(configuration: string): Promise<RemoteDesktopRestartInput>;
  acceptNativeAnswer(answer: string): Promise<void>;
  closeNativeSession(): Promise<void>;
}
export interface DesktopSessionDependencies {
  readonly signalingReady?: (environmentId: EnvironmentId) => boolean;
  readonly trace?: (
    environmentId: EnvironmentId,
    event: Readonly<Record<string, string | boolean>>,
  ) => void;
  readonly native: () => NativeSession | null;
  readonly rpc: {
    readonly status: (environmentId: EnvironmentId) => Promise<RemoteDesktopStatus>;
    readonly start: (
      environmentId: EnvironmentId,
      input: RemoteDesktopStartInput,
    ) => Promise<RemoteDesktopAnswer>;
    readonly renew: (
      environmentId: EnvironmentId,
      input: RemoteDesktopSessionInput,
    ) => Promise<RemoteDesktopLease>;
    readonly restart: (
      environmentId: EnvironmentId,
      input: RemoteDesktopRestartInput,
    ) => Promise<RemoteDesktopAnswer>;
    readonly stop: (
      environmentId: EnvironmentId,
      input: RemoteDesktopSessionInput,
    ) => Promise<void>;
  };
}
interface Target {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}
interface Intent {
  readonly target: Target;
  hostFingerprint: string | null;
  canRecover: boolean;
  attempts: number;
  relayAvailable: boolean;
  preferRelay: boolean;
}
interface Lease {
  readonly sessionId: string;
  refreshAt: number;
}
interface Snapshot {
  readonly phase: "idle" | "connecting" | "connected" | "recovering";
  readonly host: string;
  readonly path: "direct" | "relayed" | null;
  readonly error: string | null;
}
export interface DesktopNativeState {
  readonly state:
    | "connected"
    | "connecting"
    | "closed"
    | "path"
    | "network"
    | "needsRestart"
    | "degraded"
    | "recovered";
  readonly path?: "direct" | "relayed";
  readonly available?: boolean;
}
class ConnectionLost extends Error {}
class SetupRequired extends Error {}
function tagged(error: unknown, tag: string): boolean {
  return typeof error === "object" && error !== null && "_tag" in error && error._tag === tag;
}
function transientSignaling(error: unknown): boolean {
  return (
    tagged(error, "ConnectionTransientError") || tagged(error, "EnvironmentRpcUnavailableError")
  );
}
function retryable(error: unknown): boolean {
  if (error instanceof ConnectionLost) return true;
  if (error instanceof RemoteDesktopError)
    return [
      "transport",
      "unavailable",
      "authorization_unavailable",
      "expired",
      "not_found",
    ].includes(error.reason);
  return transientSignaling(error);
}
const initialFailure =
  "Couldn't connect. Enable Remote Desktop on this Mac, pair it below, and grant Control desktop in its T3 connection permissions.";
const recoveryFailure =
  "The connection couldn't recover. Check the Mac's connection and reconnect.";
const refreshAt = (connectivity: RemoteDesktopStatus["connectivity"]) =>
  connectivity?.relayAvailable ? connectivity.expiresAt - 300_000 : Number.POSITIVE_INFINITY;

/** Owns one user-requested session. Native code owns every frame and input event. */
export class RemoteDesktopSession {
  private state: Snapshot = { phase: "idle", host: "", path: null, error: null };
  private readonly listeners = new Set<() => void>();
  private intent: Intent | null = null;
  private lease: Lease | null = null;
  private generation = 0;
  private networkAvailable = true;
  private pathVersion = 0;
  private handledPathVersion = 0;
  private busy = false;
  private attempting = false;
  private tickTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryDeadline: ReturnType<typeof setTimeout> | undefined;
  private healthyTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly dependencies: DesktopSessionDependencies) {}
  private trace(kind: string, error?: unknown) {
    if (!this.intent || !this.dependencies.trace) return;
    const detail: Record<string, string | boolean> = { kind, phase: this.state.phase };
    if (typeof error === "object" && error !== null) {
      for (const key of ["_tag", "reason", "requiredScope"]) {
        if (key in error) {
          const field = Reflect.get(error, key);
          if (typeof field === "string" && /^[\w:-]{1,80}$/.test(field))
            detail[key === "_tag" ? "tag" : key] = field;
        }
      }
    }
    this.dependencies.trace?.(this.intent.target.environmentId, detail);
  }
  snapshot = (): Snapshot => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<Snapshot>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  private current(run: number, intent: Intent) {
    return run === this.generation && intent === this.intent;
  }
  private releaseTransport() {
    this.generation++;
    clearTimeout(this.tickTimer);
    this.tickTimer = undefined;
    clearTimeout(this.healthyTimer);
    this.healthyTimer = undefined;
    this.busy = false;
    this.attempting = false;
    const active = this.lease;
    this.lease = null;
    void this.dependencies
      .native()
      ?.closeNativeSession()
      .catch(() => undefined);
    if (active && this.intent)
      void this.dependencies.rpc
        .stop(this.intent.target.environmentId, { sessionId: active.sessionId })
        .catch(() => undefined);
  }
  stop = () => {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    clearTimeout(this.recoveryDeadline);
    this.recoveryDeadline = undefined;
    this.releaseTransport();
    this.intent = null;
    this.update({ phase: "idle", path: null, error: null });
  };
  private fail(message: string) {
    this.stop();
    this.update({ error: message });
  }
  async connect(target: Target) {
    this.stop();
    const intent: Intent = {
      target,
      hostFingerprint: null,
      canRecover: false,
      attempts: 0,
      relayAvailable: false,
      preferRelay: false,
    };
    this.intent = intent;
    await this.attempt(intent, false);
  }
  private async attempt(intent: Intent, recovering: boolean) {
    if (recovering && this.dependencies.signalingReady?.(intent.target.environmentId) === false) {
      this.scheduleRetry();
      return;
    }
    if (this.intent !== intent) return;
    this.releaseTransport();
    this.attempting = true;
    const run = this.generation;
    this.handledPathVersion = this.pathVersion;
    this.update({
      phase: recovering ? "recovering" : "connecting",
      host: intent.target.label,
      path: null,
      error: null,
    });
    if (!recovering) this.recoveryDeadline = setTimeout(() => this.fail(initialFailure), 45_000);
    const environmentId = intent.target.environmentId;
    let mediaAttempted = false;
    try {
      this.trace("status-start");
      const status = await this.dependencies.rpc.status(environmentId);
      this.trace("status-done");
      if (!this.current(run, intent)) return;
      if (
        status.permissions &&
        (!status.permissions.screenRecording || !status.permissions.accessibility)
      )
        throw new SetupRequired(
          "On your Mac, choose Remote Desktop → Set up permissions to allow Screen Recording and Accessibility, then reconnect.",
        );
      if (
        !status.available ||
        !status.enabled ||
        !status.remoteEnabled ||
        !status.internetEnabled ||
        !status.hostFingerprint
      )
        throw new RemoteDesktopError({ reason: "disabled" });
      if (intent.hostFingerprint !== null && status.hostFingerprint !== intent.hostFingerprint)
        throw new RemoteDesktopError({ reason: "identity_mismatch" });
      intent.hostFingerprint = status.hostFingerprint;
      intent.relayAvailable = status.connectivity?.relayAvailable === true;
      const view = this.dependencies.native();
      if (!view) throw new Error("Native view unavailable");
      if (recovering) {
        intent.attempts++;
        mediaAttempted = true;
      }
      const offer = status.connectivity
        ? await view.createConfiguredNativeOffer(
            status.hostFingerprint,
            JSON.stringify({
              ...status.connectivity,
              relayOnly: status.connectivity.relayOnly || intent.preferRelay,
            }),
          )
        : await view.createNativeOffer(status.hostFingerprint);
      if (!this.current(run, intent)) return;
      const answer = await this.dependencies.rpc.start(environmentId, offer);
      if (!this.current(run, intent)) {
        void this.dependencies.rpc
          .stop(environmentId, { sessionId: answer.sessionId })
          .catch(() => undefined);
        return;
      }
      this.lease = { sessionId: answer.sessionId, refreshAt: refreshAt(status.connectivity) };
      await view.acceptNativeAnswer(JSON.stringify(answer));
      if (!this.current(run, intent)) return;
      this.attempting = false;
      this.scheduleTick(10_000);
    } catch (error) {
      this.trace("attempt-error", error);
      if (!this.current(run, intent)) return;
      if (error instanceof SetupRequired) {
        this.fail(error.message);
        return;
      }
      if (recovering) {
        if (!mediaAttempted && !transientSignaling(error)) intent.attempts++;
        this.recover(error);
      } else this.fail(initialFailure);
    }
  }
  private startRecoveryDeadline() {
    if (this.recoveryDeadline !== undefined) return;
    this.recoveryDeadline = setTimeout(() => this.fail(recoveryFailure), 30_000);
  }
  private recover(error: unknown) {
    this.trace("recover", error);
    const intent = this.intent;
    if (!intent?.canRecover || (!retryable(error) && !transientSignaling(error))) {
      this.fail(intent?.canRecover ? recoveryFailure : initialFailure);
      return;
    }
    this.releaseTransport();
    this.update({ phase: "recovering", path: null });
    this.startRecoveryDeadline();
    this.scheduleRetry();
  }
  private scheduleRetry() {
    const intent = this.intent;
    if (!intent || this.retryTimer !== undefined || this.attempting || !this.networkAvailable)
      return;
    const delay = [500, 1500, 4000][intent.attempts];
    if (delay === undefined) {
      this.fail(recoveryFailure);
      return;
    }
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      if (this.intent === intent && this.networkAvailable) void this.attempt(intent, true);
    }, delay);
  }
  private scheduleTick(delay: number) {
    clearTimeout(this.tickTimer);
    this.tickTimer = setTimeout(() => {
      this.tickTimer = undefined;
      void this.maintain();
    }, delay);
  }
  private async maintain() {
    const intent = this.intent,
      active = this.lease;
    if (!intent || !active || this.busy) return;
    this.busy = true;
    const run = this.generation;
    try {
      this.trace("renew-start");
      await this.dependencies.rpc.renew(intent.target.environmentId, {
        sessionId: active.sessionId,
      });
      this.trace("renew-done");
      if (!this.current(run, intent)) return;
      if (
        this.networkAvailable &&
        (Date.now() >= active.refreshAt || this.pathVersion > this.handledPathVersion)
      ) {
        const version = this.pathVersion;
        const status = await this.dependencies.rpc.status(intent.target.environmentId);
        if (!this.current(run, intent)) return;
        if (status.hostFingerprint !== intent.hostFingerprint)
          throw new RemoteDesktopError({ reason: "identity_mismatch" });
        if (!status.connectivity) throw new ConnectionLost();
        const view = this.dependencies.native();
        if (!view) throw new ConnectionLost();
        intent.relayAvailable = status.connectivity.relayAvailable;
        const offer = await view.createNativeRestartOffer(
          JSON.stringify({
            ...status.connectivity,
            relayOnly:
              status.connectivity.relayOnly || (intent.preferRelay && intent.relayAvailable),
          }),
        );
        if (!this.current(run, intent)) return;
        if (offer.sessionId !== active.sessionId)
          throw new RemoteDesktopError({ reason: "identity_mismatch" });
        const answer = await this.dependencies.rpc.restart(intent.target.environmentId, offer);
        if (!this.current(run, intent)) return;
        if (
          answer.sessionId !== active.sessionId ||
          answer.hostFingerprint !== intent.hostFingerprint
        )
          throw new RemoteDesktopError({ reason: "identity_mismatch" });
        await view.acceptNativeAnswer(JSON.stringify(answer));
        if (!this.current(run, intent)) return;
        active.refreshAt = refreshAt(status.connectivity);
        this.handledPathVersion = version;
      }
      if (this.current(run, intent)) {
        this.busy = false;
        this.scheduleTick(
          this.networkAvailable && this.pathVersion > this.handledPathVersion ? 0 : 10_000,
        );
      }
    } catch (error) {
      this.trace("maintain-error", error);
      if (this.current(run, intent)) this.recover(error);
    }
  }
  nativeState(event: DesktopNativeState) {
    this.trace(
      `native-${event.state}${event.state === "network" ? (event.available ? "-online" : "-offline") : ""}`,
    );
    if (event.state === "network") this.networkAvailable = event.available === true;
    const intent = this.intent;
    if (!intent) return;
    if (event.state === "network" && event.available) intent.preferRelay = false;
    if (event.state === "degraded") {
      if (
        !this.lease ||
        !intent.canRecover ||
        !intent.relayAvailable ||
        intent.preferRelay ||
        this.state.path !== "direct"
      )
        return;
      intent.preferRelay = true;
    }
    if (event.state === "closed") {
      this.recover(new ConnectionLost());
      return;
    }
    if (event.state === "path" && this.lease && event.path) this.update({ path: event.path });
    if (event.state === "connected" && this.lease) {
      intent.canRecover = true;
      this.connected();
      clearTimeout(this.healthyTimer);
      this.healthyTimer = setTimeout(() => {
        if (this.intent === intent) intent.attempts = 0;
      }, 60_000);
    }
    if (event.state === "recovered" && this.lease && this.networkAvailable) this.connected();
    if (
      (event.state === "network" || event.state === "needsRestart" || event.state === "degraded") &&
      intent.canRecover
    ) {
      this.pathVersion++;
      this.update({ phase: "recovering" });
      this.startRecoveryDeadline();
      if (this.lease) {
        if (!this.busy) this.scheduleTick(0);
      } else this.scheduleRetry();
    }
  }
  private connected() {
    clearTimeout(this.recoveryDeadline);
    this.recoveryDeadline = undefined;
    this.update({ phase: "connected", error: null });
  }
}
