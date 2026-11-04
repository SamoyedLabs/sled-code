import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { AuthMcpClientAccess, EnvironmentId } from "@t3tools/contracts";
import { sledToolAccessOptions } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
export function SledToolsConnection({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(openbot.sledTools({ environmentId, input: {} }));
  const allowed = useAtomValue(openbot.connectSledTools.permissionAtom(environmentId));
  const connect = useAtomCommand(openbot.connectSledTools, { reportFailure: false });
  const disconnect = useAtomCommand(openbot.disconnectSledTools, { reportFailure: false });
  const [access, setAccess] = useState<AuthMcpClientAccess>("read-only");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (remove: boolean) => {
    if (busy || !allowed) return;
    setBusy(true);
    setError(null);
    const result = remove
      ? await disconnect({ environmentId, input: {} })
      : await connect({ environmentId, input: { access } });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    query.refresh();
    setBusy(false);
  };
  const status = query.data;
  return (
    <View className="gap-3 rounded-xl bg-grouped-card p-3">
      <Text>Connect bots to Sled</Text>
      <Text className="text-foreground-muted">
        Let this bot engine inspect Sled projects and delegate coding work. Choose its maximum
        authority; each bot keeps its own permissions.
      </Text>
      <Text>
        {query.isPending
          ? "Checking connection…"
          : status?.state === "connected"
            ? "Connected"
            : status?.state === "expired"
              ? "Access expired. Reconnect to renew it."
              : status?.state === "host-unavailable"
                ? "Start the bot engine to connect."
                : status?.state === "revocation-pending"
                  ? "Access revocation is pending. Retry disconnect to complete it."
                  : status?.state === "cleanup-pending"
                    ? "Upstream configuration cleanup is pending."
                    : "Not connected"}
      </Text>
      {status?.access && (
        <Text>
          Current ceiling:{" "}
          {sledToolAccessOptions.find((item) => item.value === status.access)?.label ??
            status.access}
        </Text>
      )}
      {status?.expiresAt && (
        <Text className="text-foreground-muted">
          Expires: {new Date(status.expiresAt).toLocaleString()}
        </Text>
      )}
      <Text>Authority to grant</Text>
      <View className="flex-row flex-wrap gap-2">
        {sledToolAccessOptions.map((item) => (
          <Button
            key={item.value}
            label={item.label}
            accessibilityLabel={`${item.label}${access === item.value ? ", selected" : ""}`}
            tone={access === item.value ? "primary" : "secondary"}
            size="compact"
            disabled={busy || !allowed}
            onPress={() => setAccess(item.value)}
          />
        ))}
      </View>
      {(error || query.error) && (
        <Text accessibilityRole="alert" className="text-danger">
          {error ?? query.error}
        </Text>
      )}
      <Button
        label={status?.state === "connected" ? "Update connection" : "Connect Sled tools"}
        loading={busy}
        disabled={!allowed || status?.state === "host-unavailable" || query.isPending}
        onPress={() => void act(false)}
      />
      {status?.state !== "disconnected" && (
        <Button
          label="Disconnect"
          disabled={busy || !allowed || !status}
          onPress={() => void act(true)}
        />
      )}
      <Button
        label="Refresh connection"
        size="compact"
        tone="text"
        onPress={query.refresh}
        disabled={busy}
      />
    </View>
  );
}
