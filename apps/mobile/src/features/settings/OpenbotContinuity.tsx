import { useState } from "react";
import { View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotContinuityCommand } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
export function OpenbotContinuity({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(openbot.continuity({ environmentId, input: {} }));
  const command = useAtomCommand(openbot.continuityCommand);
  const allowed = useAtomValue(openbot.continuityCommand.permissionAtom(environmentId));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function send(input: OpenbotContinuityCommand) {
    if (busy || !allowed) return;
    setBusy(true);
    setError(null);
    await (async () => {
      const result = await command({ environmentId, input });
      if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    })().finally(() => {
      setBusy(false);
    });
  }
  return (
    <View className="gap-2">
      <Text className="font-semibold">Bot background notifications</Text>
      <Text>
        Receive reminders, results and requests on your linked mobile account. Device notifications
        must also be enabled.
      </Text>
      {query.data && (
        <>
          <Text>
            {query.data.enabled ? "Enabled for this session" : "Disabled for this session"} ·{" "}
            {query.data.transport === "configured"
              ? "Relay configured"
              : query.data.transport === "unsupported"
                ? "This relay does not support bot notifications"
                : "A notification relay and linked account are required"}
          </Text>
          <Text>
            {query.data.pending} pending · {query.data.delivered} accepted by delivery transport ·{" "}
            {query.data.revoked} stopped after access changed
          </Text>
          <Button
            label={query.data.enabled ? "Disable notifications" : "Enable notifications"}
            disabled={busy || !allowed}
            onPress={() => void send({ action: "configure", enabled: !query.data?.enabled })}
          />
          <Button
            label="Retry pending"
            disabled={busy || !allowed}
            onPress={() => void send({ action: "retry" })}
          />
          {query.data.lastError && <Text>Delivery: {query.data.lastError}</Text>}
        </>
      )}
      {query.isPending && <Text accessibilityRole="status">Loading notification status…</Text>}
      {(error || query.error) && <Text accessibilityRole="alert">{error || query.error}</Text>}
      <Button label="Refresh notifications" onPress={query.refresh} disabled={query.isPending} />
    </View>
  );
}
