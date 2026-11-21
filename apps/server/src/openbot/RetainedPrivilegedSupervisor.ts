// @effect-diagnostics globalTimers:off -- retained OS owner protocol runs outside Effect fibers.
// @effect-diagnostics nodeBuiltinImport:off -- process owner retains handles across controller reconnects.
import * as NodeNet from "node:net";
import * as NodeFS from "node:fs";
import type * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import { DurablePrivilegedCommitAuthority } from "./DurablePrivilegedCommitAuthority.ts";
import { attachSupervisedPrivilegedCommitTransport } from "./SupervisedPrivilegedCommitTransport.ts";

/** Runs in the task-private owner process, not the reconnecting server process. */
export class RetainedPrivilegedSupervisor {
  readonly #authority: DurablePrivilegedCommitAuthority;
  readonly #channel: ReturnType<DurablePrivilegedCommitAuthority["bindChild"]>;
  readonly #server: NodeNet.Server;
  readonly #timer: ReturnType<typeof setInterval>;
  readonly #reconciled: Promise<unknown>;
  #draining = false;
  #closing: Promise<void> | undefined;
  constructor(options: {
    child: NodeChildProcess.ChildProcess;
    database: string;
    environmentId: string;
    hostId: string;
    socketPath: string;
    controllerKey: string;
    validateTarget: ConstructorParameters<typeof DurablePrivilegedCommitAuthority>[1];
    status?: () => object;
    activationAllowed?: () => boolean;
    onExited?: (incarnation: string) => Promise<void>;
    validateQueue?: ConstructorParameters<typeof DurablePrivilegedCommitAuthority>[2];
  }) {
    if (options.controllerKey.length < 32) throw new Error("Privileged supervisor unavailable");
    this.#authority = new DurablePrivilegedCommitAuthority(
      options.database,
      options.validateTarget,
      options.validateQueue,
    );
    this.#channel = this.#authority.bindChild(options.child, options.environmentId, options.hostId);
    const transport = attachSupervisedPrivilegedCommitTransport(options.child, this.#channel, {
      environmentId: options.environmentId,
      hostId: options.hostId,
      allowed: options.activationAllowed ?? (() => false),
    });
    const reconciled = this.#channel.exited.then(() =>
      options.onExited?.(this.#channel.incarnation),
    );
    this.#reconciled = reconciled;
    void reconciled.catch(() => {});
    const expected = Buffer.from(options.controllerKey);
    this.#server = NodeNet.createServer((socket) => {
      let buffer = "";
      socket.setEncoding("utf8");
      socket.on("error", () => socket.destroy());
      socket.on("data", (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 2048) {
          socket.destroy();
          return;
        }
        if (!buffer.includes("\n")) return;
        socket.pause();
        void (async () => {
          try {
            const request = JSON.parse(buffer.trim());
            const supplied = Buffer.from(typeof request.key === "string" ? request.key : "");
            if (
              supplied.length !== expected.length ||
              !NodeCrypto.timingSafeEqual(expected, supplied) ||
              request.incarnation !== this.#channel.incarnation ||
              Object.keys(request).sort().join() !== "incarnation,key,operation" ||
              !["status", "fence"].includes(request.operation)
            )
              throw new Error();
            if (request.operation === "fence") {
              await this.#channel.fence();
              await reconciled;
            }
            socket.end(
              JSON.stringify({
                ok: true,
                incarnation: this.#channel.incarnation,
                ...(request.operation === "fence"
                  ? { exited: true }
                  : { status: { ...options.status?.(), bridgeNegotiated: transport.negotiated } }),
              }) + "\n",
            );
          } catch {
            socket.destroy();
          }
        })();
      });
    });
    this.#server.listen(options.socketPath, () => NodeFS.chmodSync(options.socketPath, 0o600));
    // This requests fencing; the timer never marks a lease complete or proves exit.
    this.#timer = setInterval(() => {
      if (this.#draining) return;
      this.#draining = true;
      void this.#authority
        .drainInvalidated()
        .catch(() => {})
        .finally(() => {
          this.#draining = false;
        });
    }, 250);
  }
  get incarnation(): string {
    return this.#channel.incarnation;
  }
  close(): Promise<void> {
    return (this.#closing ??= this.#close());
  }
  async #close(): Promise<void> {
    clearInterval(this.#timer);
    await this.#channel.fence();
    await this.#reconciled;
    await new Promise<void>((resolve, reject) =>
      this.#server.close((error) => (error ? reject(error) : resolve())),
    );
    this.#authority.close();
  }
}
