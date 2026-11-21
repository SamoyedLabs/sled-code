import { connectionStatusText } from "@t3tools/client-runtime/connection";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { environmentCatalog } from "../../connection/catalog";
import type { EnvironmentPresentation } from "../../state/environments";
import { useEnvironmentQuery } from "../../state/query";
import { useBotPalette } from "./upstream/BotChrome";
import { OpenBotText as Text } from "./upstream/OpenBotTypography";

export function BotWorkspaceConnection({ environment }: { environment: EnvironmentPresentation }) {
  const p = useBotPalette();
  const { data: state } = useEnvironmentQuery(
    environmentCatalog.stateAtom(environment.environmentId),
  );
  const retrying = environment.connection.phase === "reconnecting";
  const title = retrying
    ? "Reconnecting"
    : environment.entry.enabled
      ? connectionStatusText({ ...environment.connection, error: null })
      : "Disconnected";
  return (
    <View style={{ flex: 1, justifyContent: "center", minWidth: 0 }}>
      <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>
        {title}
      </Text>
      {retrying ? (
        <RetryDetail attempt={state?.attempt ?? 0} retryAt={state?.retryAt ?? null} />
      ) : null}
    </View>
  );
}

function RetryDetail({ attempt, retryAt }: { attempt: number; retryAt: number | null }) {
  const p = useBotPalette();
  const [now, setNow] = useState(Date.now);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the displayed countdown in sync with the system clock during backoff.
  useEffect(() => {
    if (retryAt === null) return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [retryAt]);
  const seconds = retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12, fontVariant: ["tabular-nums"] }}>
      {[attempt > 0 ? `Attempt ${attempt}` : null, seconds > 0 ? clock : null]
        .filter(Boolean)
        .join(" · ")}
    </Text>
  );
}
