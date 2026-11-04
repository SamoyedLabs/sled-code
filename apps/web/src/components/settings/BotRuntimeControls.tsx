import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotUpstreamInstallInput } from "@t3tools/contracts";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";

type Action = "supported" | "latest" | "download" | "install" | "activate" | "rollback";
const actionStatus: Record<Action, string> = {
  supported: "Checking supported release…",
  latest: "Checking latest release…",
  download: "Downloading release…",
  install: "Installing release…",
  activate: "Activating release…",
  rollback: "Restoring previous release…",
};

export function BotRuntimeControls({ environmentId }: { environmentId: EnvironmentId }) {
  const allowed = useAtomValue(openbot.installRuntime.permissionAtom(environmentId));
  const [expanded, setExpanded] = useState(false);
  if (!allowed) return null;
  return (
    <section className="space-y-3" aria-label="Bot engine releases">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Hide engine releases" : "Manage engine releases"}
      </Button>
      {expanded && <RuntimePanel environmentId={environmentId} />}
    </section>
  );
}

function RuntimePanel({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(openbot.upstream({ environmentId, input: {} }));
  const check = useAtomCommand(openbot.checkRuntime, { reportFailure: false });
  const stage = useAtomCommand(openbot.stageRuntime, { reportFailure: false });
  const install = useAtomCommand(openbot.installRuntime, { reportFailure: false });
  const activate = useAtomCommand(openbot.activateRuntime, { reportFailure: false });
  const rollback = useAtomCommand(openbot.rollbackRuntime, { reportFailure: false });
  const canCheck = useAtomValue(openbot.checkRuntime.permissionAtom(environmentId));
  const canActivate = useAtomValue(openbot.activateRuntime.permissionAtom(environmentId));
  const canRollback = useAtomValue(openbot.rollbackRuntime.permissionAtom(environmentId));
  const [busy, setBusy] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const status = query.data;
  const platform = status?.hostPlatform;
  const release = status?.available;
  const asset = release?.assets.find((entry) => entry.platform === platform);
  const installed =
    status?.installation?.installed.filter((entry) => entry.platform === platform) ?? [];
  const act = async (action: Action, input?: OpenbotUpstreamInstallInput) => {
    if (lock.current || !status) return;
    lock.current = true;
    setBusy(action);
    setError(null);
    const settled = await settlePromise(async () => {
      return action === "supported"
        ? await check({ environmentId, input: { version: status.baselineVersion } })
        : action === "latest"
          ? await check({ environmentId, input: {} })
          : action === "rollback"
            ? await rollback({ environmentId, input: {} })
            : input === undefined
              ? null
              : action === "download"
                ? await stage({ environmentId, input })
                : action === "install"
                  ? await install({ environmentId, input })
                  : await activate({ environmentId, input });
    });
    if (settled._tag === "Failure") {
      setError("Could not finish the engine update. Refresh and try again.");
    } else if (settled.value?._tag === "Failure") {
      setError(String(squashAtomCommandFailure(settled.value)));
    }
    query.refresh();
    lock.current = false;
    setBusy(null);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Download and install a release, then activate it on this machine. Activation restarts the
        bot engine; running work may be interrupted.
      </p>
      <p role="status" className="text-sm">
        {busy
          ? actionStatus[busy]
          : query.isPending
            ? "Loading engine releases…"
            : status?.installation?.active
              ? `Active: ${status.installation.active.version}`
              : "No managed release is active."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null || !status || !canCheck}
          onClick={() => void act("supported")}
        >
          Check supported release
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={busy !== null || !status || !canCheck}
          onClick={() => void act("latest")}
        >
          Check latest release
        </Button>
        <Button variant="ghost" size="sm" disabled={busy !== null} onClick={query.refresh}>
          Refresh releases
        </Button>
      </div>
      {release && asset && (
        <div className="space-y-2">
          <p className="text-sm">
            {release.version} · {asset.platform} · {Math.ceil(asset.size / 1_048_576)} MB
          </p>
          {release.compatibility === "requires-validation" && (
            <p className="text-sm text-muted-foreground">
              This release needs compatibility validation before activation.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy !== null || !canCheck}
              onClick={() =>
                void act("download", { version: release.version, platform: asset.platform })
              }
            >
              Download release
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy !== null ||
                platform === "win32-x64" ||
                !status?.staged.some(
                  (entry) => entry.version === release.version && entry.platform === platform,
                )
              }
              onClick={() =>
                void act("install", { version: release.version, platform: asset.platform })
              }
            >
              Install downloaded release
            </Button>
          </div>
        </div>
      )}
      {(!platform || platform === "win32-x64") && status && (
        <p className="text-sm text-muted-foreground">
          Automatic installation is not available for this host yet.
        </p>
      )}
      <ul className="space-y-2">
        {installed.map((entry) => (
          <li
            key={`${entry.version}:${entry.platform}:${entry.sha256}`}
            className="flex flex-wrap items-center gap-2"
          >
            <span className="text-sm">
              {entry.version}
              {status?.installation?.active?.sha256 === entry.sha256 ? " · active" : " · installed"}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy !== null ||
                !canActivate ||
                !status?.activationAllowed ||
                entry.compatibility !== "pinned-baseline" ||
                status.installation?.active?.sha256 === entry.sha256
              }
              onClick={() =>
                void act("activate", { version: entry.version, platform: entry.platform })
              }
            >
              Activate {entry.version}
            </Button>
          </li>
        ))}
      </ul>
      {installed.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Only validated releases for this host can be activated. A configured executable override
          takes precedence.
        </p>
      )}
      {status?.installation?.previous && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null || !canRollback || !status.activationAllowed}
          onClick={() => void act("rollback")}
        >
          Roll back to {status.installation.previous.version}
        </Button>
      )}
      {(error || query.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? query.error}
        </p>
      )}
    </div>
  );
}
