// @effect-diagnostics globalTimers:off -- retained OS owner protocol runs outside Effect fibers.
// @effect-diagnostics nodeBuiltinImport:off -- isolated owner process bootstrap.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeEvents from "node:events";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";
import { RetainedPrivilegedSupervisor } from "./RetainedPrivilegedSupervisor.ts";
import type { ManagedHostConfig, HostReady } from "./ManagedHost.ts";

import { validateUpstreamCommitOwnership } from "./PrivilegedUpstreamOwnership.ts";
import { readPrivilegedActivation } from "./PrivilegedActivationConfig.ts";

export interface PrivilegedOwnerConfiguration {
  activationConfigPath?: string | undefined;
  host: ManagedHostConfig & { executablePath: string; sledEnvironmentId: string };
  authDatabase: string;
  controllerKey: string;
  socketPath: string;
  descriptorPath: string;
}
export async function runPrivilegedOwner(): Promise<void> {
  // Only the spawning server owns fd3. Configuration is never an argv/log payload.
  let raw = "";
  for await (const chunk of NodeFS.createReadStream("", { fd: 3 })) {
    raw += chunk.toString();
    if (Buffer.byteLength(raw) > 65536) throw new Error("Privileged owner unavailable");
  }
  const config = JSON.parse(raw) as PrivilegedOwnerConfiguration;
  const environment = { ...process.env };
  for (const key of Object.keys(environment))
    if (
      key === "ELECTRON_RUN_AS_NODE" ||
      key.startsWith("OPENBOT_DEV_") ||
      key.startsWith("OPENBOT_LOCAL_SERVER_")
    )
      delete environment[key];
  Object.assign(environment, {
    OPENBOT_LOCAL_SERVER_CHILD: "1",
    OPENBOT_LOCAL_SERVER_ROOT: config.host.agentRoot,
    OPENBOT_LOCAL_SERVER_NAME: config.host.serverName,
    OPENBOT_LOCAL_SERVER_SECRET: config.host.ownerSecret,
    OPENBOT_LOCAL_SERVER_SLED_ENVIRONMENT_ID: config.host.sledEnvironmentId,
    OPENBOT_LOCAL_SERVER_PRIVILEGED_BRIDGE: "fd4-v2",
    ...(config.host.runtimeRoot ? { OPENBOT_LOCAL_SERVER_RUNTIMES: config.host.runtimeRoot } : {}),
  });
  const child = NodeChildProcess.spawn(
    config.host.executablePath,
    [...(config.host.args ?? []), `--user-data-dir=${config.host.userDataDirectory}`],
    {
      env: environment,
      stdio: ["pipe", "pipe", "ignore", "ignore", "pipe"],
      windowsHide: true,
    },
  );
  const exited = NodeEvents.EventEmitter.once(child, "exit");
  child.stdin?.on("error", () => {});
  const persist = (value: object) => {
    const temporary = config.descriptorPath + ".tmp";
    NodeFS.writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 });
    NodeFS.renameSync(temporary, config.descriptorPath);
  };
  let supervisor: RetainedPrivilegedSupervisor | undefined;
  const stop = () => {
    void (async () => {
      if (supervisor) await supervisor.close();
      else {
        child.kill("SIGKILL");
        await exited;
        persist({ state: "exited" });
      }
    })().catch(() => {});
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  try {
    const ready = await new Promise<HostReady>((resolve, reject) => {
      let buffer = "";
      const timer = setTimeout(
        () => reject(new Error("Privileged owner readiness pending")),
        config.host.startupTimeoutMs ?? 90000,
      );
      child.once("error", reject);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Privileged owner exited"));
      });
      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        buffer += chunk;
        if (Buffer.byteLength(buffer) > 65536) {
          clearTimeout(timer);
          reject(new Error("Privileged owner readiness invalid"));
          return;
        }
        while (buffer.includes("\n")) {
          const index = buffer.indexOf("\n");
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          if (!line.startsWith("OPENBOT_LOCAL_SERVER_READY ")) continue;
          try {
            const value = JSON.parse(line.slice("OPENBOT_LOCAL_SERVER_READY ".length));
            const url = new URL(value.apiUrl);
            if (url.hostname === "localhost") url.hostname = "127.0.0.1";
            if (
              url.protocol !== "http:" ||
              !["127.0.0.1", "[::1]"].includes(url.hostname) ||
              !url.port ||
              url.username ||
              url.password ||
              url.pathname !== "/" ||
              url.search ||
              url.hash
            )
              throw new Error();
            for (const key of [
              "serverId",
              "serverName",
              "apiUrl",
              "fingerprint",
              "publicKey",
              "ownerMemberId",
            ])
              if (typeof value[key] !== "string" || !value[key] || value[key].length > 4096)
                throw new Error();
            clearTimeout(timer);
            resolve({ ...value, apiUrl: url.origin });
          } catch {
            clearTimeout(timer);
            reject(new Error("Privileged owner readiness invalid"));
          }
        }
      });
    });
    const upstreamPath = NodePath.join(config.host.userDataDirectory, "openbot.db");
    const upstream = new NodeSqlite.DatabaseSync(upstreamPath, { readOnly: true });
    const validate = (agentId: string, threadId: string, nonce: string, incarnation: string) =>
      validateUpstreamCommitOwnership(upstream, agentId, threadId, nonce, incarnation);
    supervisor = new RetainedPrivilegedSupervisor({
      child,
      database: config.authDatabase,
      environmentId: config.host.sledEnvironmentId,
      hostId: ready.serverId,
      activationAllowed: () =>
        readPrivilegedActivation(config.activationConfigPath, {
          environmentId: config.host.sledEnvironmentId,
          hostId: ready.serverId,
          profileDirectory: config.host.userDataDirectory,
        }),
      socketPath: config.socketPath,
      controllerKey: config.controllerKey,
      status: () => ({ ready, executablePath: config.host.executablePath }),
      validateTarget: (i) =>
        validate(i.target.agentId, i.target.threadId, i.nonce, i.engineIncarnation),
      validateQueue: (i) =>
        validate(
          i.effect.agentId,
          i.effect.threadId,
          JSON.stringify(["queue-attachments", i.effect.editId]),
          i.engineIncarnation,
        ),
      onExited: async (incarnation) => {
        upstream.close();
        const db = new NodeSqlite.DatabaseSync(upstreamPath);
        try {
          db.prepare(
            "UPDATE privileged_response_ownership SET state='exited' WHERE incarnation=? AND state='outstanding'",
          ).run(incarnation);
        } finally {
          db.close();
        }
        persist({ state: "exited", incarnation });
      },
    });
    persist({
      state: "ready",
      socketPath: config.socketPath,
      incarnation: supervisor.incarnation,
      ready,
      executablePath: config.host.executablePath,
    });
    await exited;
    await supervisor.close();
  } catch {
    child.kill("SIGKILL");
    await exited;
    if (supervisor) await supervisor.close();
    else persist({ state: "exited" });
  } finally {
    try {
      NodeFS.rmdirSync(NodePath.dirname(config.socketPath));
    } catch {}
  }
}
