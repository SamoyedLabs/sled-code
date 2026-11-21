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
import { T, Var, useGT } from "gt-react-native";
export function OpenbotContinuity({ environmentId }: { environmentId: EnvironmentId }) {
  const gt = useGT();
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
      <Text className="font-semibold">
        <T>Bot background notifications</T>
      </Text>
      <Text>
        <T>
          Receive reminders, results and requests on your linked mobile account. Device
          notifications must also be enabled.
        </T>
      </Text>
      {query.data && (
        <>
          <Text>
            {query.data.enabled ? gt("Enabled for this session") : gt("Disabled for this session")}{" "}
            ·{" "}
            {query.data.transport === "configured"
              ? gt("Relay configured")
              : query.data.transport === "unsupported"
                ? gt("This relay does not support bot notifications")
                : gt("A notification relay and linked account are required")}
          </Text>
          <Text>
            <T>
              <Var>{query.data.pending}</Var> pending · <Var>{query.data.delivered}</Var> accepted
              by delivery transport ·<Var> </Var>
              <Var>{query.data.revoked}</Var> stopped after access changed
            </T>
          </Text>
          <Button
            label={query.data.enabled ? gt("Disable notifications") : gt("Enable notifications")}
            disabled={busy || !allowed}
            onPress={() => void send({ action: "configure", enabled: !query.data?.enabled })}
          />
          <Button
            label={gt("Retry pending")}
            disabled={busy || !allowed}
            onPress={() => void send({ action: "retry" })}
          />
          {query.data.lastError && (
            <Text>
              <T>
                Delivery: <Var>{query.data.lastError}</Var>
              </T>
            </Text>
          )}
        </>
      )}
      {query.isPending && (
        <Text accessibilityRole="status">
          <T>Loading notification status…</T>
        </Text>
      )}
      {(error || query.error) && <Text accessibilityRole="alert">{error || query.error}</Text>}
      <Button
        label={gt("Refresh notifications")}
        onPress={query.refresh}
        disabled={query.isPending}
      />
    </View>
  );
}
