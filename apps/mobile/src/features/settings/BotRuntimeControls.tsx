import { useRef, useState } from "react";
import { View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotUpstreamInstallInput } from "@t3tools/contracts";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";

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
    <View className="gap-3">
      <Button
        label={expanded ? "Hide engine releases" : "Manage engine releases"}
        tone="secondary"
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && <RuntimePanel environmentId={environmentId} />}
    </View>
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
    <View className="gap-3">
      <Text className="text-foreground-muted">
        Download and install a release, then activate it on this machine. Activation restarts the
        bot engine; running work may be interrupted.
      </Text>
      <Text accessibilityLiveRegion="polite">
        {busy
          ? actionStatus[busy]
          : query.isPending
            ? "Loading engine releases…"
            : status?.installation?.active
              ? `Active: ${status.installation.active.version}`
              : "No managed release is active."}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Check supported release"
          disabled={busy !== null || !status || !canCheck}
          onPress={() => void act("supported")}
        />
        <Button
          label="Check latest release"
          disabled={busy !== null || !status || !canCheck}
          onPress={() => void act("latest")}
        />
        <Button label="Refresh releases" disabled={busy !== null} onPress={query.refresh} />
      </View>
      {release && asset && (
        <View className="gap-2">
          <Text>
            {release.version} · {asset.platform} · {Math.ceil(asset.size / 1_048_576)} MB
          </Text>
          {release.compatibility === "requires-validation" && (
            <Text className="text-foreground-muted">
              This release needs compatibility validation before activation.
            </Text>
          )}
          <Button
            label="Download release"
            disabled={busy !== null || !canCheck}
            onPress={() =>
              void act("download", { version: release.version, platform: asset.platform })
            }
          />
          <Button
            label="Install downloaded release"
            disabled={
              busy !== null ||
              platform === "win32-x64" ||
              !status?.staged.some(
                (entry) => entry.version === release.version && entry.platform === platform,
              )
            }
            onPress={() =>
              void act("install", { version: release.version, platform: asset.platform })
            }
          />
        </View>
      )}
      {(!platform || platform === "win32-x64") && status && (
        <Text className="text-foreground-muted">
          Automatic installation is not available for this host yet.
        </Text>
      )}
      {installed.map((entry) => (
        <View key={`${entry.version}:${entry.platform}:${entry.sha256}`} className="gap-2">
          <Text>
            {entry.version}
            {status?.installation?.active?.sha256 === entry.sha256 ? " · active" : " · installed"}
          </Text>
          <Button
            label={`Activate ${entry.version}`}
            disabled={
              busy !== null ||
              !canActivate ||
              !status?.activationAllowed ||
              entry.compatibility !== "pinned-baseline" ||
              status.installation?.active?.sha256 === entry.sha256
            }
            onPress={() =>
              void act("activate", { version: entry.version, platform: entry.platform })
            }
          />
        </View>
      ))}
      {installed.length > 0 && (
        <Text className="text-foreground-muted">
          Only validated releases for this host can be activated. A configured executable override
          takes precedence.
        </Text>
      )}
      {status?.installation?.previous && (
        <Button
          label={`Roll back to ${status.installation.previous.version}`}
          disabled={busy !== null || !canRollback || !status.activationAllowed}
          onPress={() => void act("rollback")}
        />
      )}
      {(error || query.error) && (
        <Text accessibilityRole="alert" className="text-danger">
          {error ?? query.error}
        </Text>
      )}
    </View>
  );
}
