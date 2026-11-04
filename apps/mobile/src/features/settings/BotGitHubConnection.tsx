import { useState } from "react";
import { View } from "react-native";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import type { BotConnectionPanelProps as PanelProps } from "./useBotConnections";
import { confirm, ExternalLink } from "./BotConnectionControls";

export function GitHubPanel({ controller: { state, run, busy, setError }, allowed }: PanelProps) {
  const [visible, setVisible] = useState(40);
  const status = state.github;
  const failed = () => setError("Could not open the connection page.");
  return (
    <View className="gap-3">
      <Text className="text-foreground-muted">
        The GitHub connection is shared by bots on this host.
      </Text>
      <Button
        label="Check GitHub connection"
        disabled={!allowed || busy}
        onPress={() => void run([{ operation: "connector.github.status" }])}
      />
      {status && (
        <>
          <Text>
            {status.state}
            {status.login ? ` · ${status.login}` : ""}
          </Text>
          {!status.available ? (
            <Text className="text-foreground-muted">This host has no GitHub App configured.</Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {status.state !== "connected" && (
                <Button
                  label="Connect GitHub"
                  disabled={!allowed || busy || status.state === "pending"}
                  onPress={() => void run([{ operation: "connector.github.connect" }])}
                />
              )}
              {status.state === "pending" && (
                <Button
                  label="Cancel sign-in"
                  disabled={!allowed || busy}
                  onPress={() => void run([{ operation: "connector.github.cancel" }])}
                />
              )}
              {status.state === "connected" && (
                <>
                  <Button
                    label="Load repositories"
                    disabled={!allowed || busy}
                    onPress={() => void run([{ operation: "connector.github.repositories" }])}
                  />
                  <Button
                    label="Disconnect GitHub"
                    tone="danger"
                    disabled={!allowed || busy}
                    onPress={() =>
                      confirm(
                        "Disconnect GitHub from every bot on this host?",
                        () => void run([{ operation: "connector.github.disconnect" }]),
                      )
                    }
                  />
                </>
              )}
            </View>
          )}
          {status.userCode && (
            <Text selectable>
              Enter code {status.userCode} on GitHub, then check the connection again.
            </Text>
          )}
          <ExternalLink
            disabled={!allowed || busy}
            address={status.verificationUri}
            label="Open GitHub sign-in"
            onFailure={failed}
          />
          <ExternalLink
            disabled={!allowed || busy}
            address={status.installUrl}
            label="Manage repository access"
            onFailure={failed}
          />
          <ExternalLink
            disabled={!allowed || busy}
            address={status.revokeUrl}
            label="Manage GitHub authorization"
            onFailure={failed}
          />
          {status.error && (
            <Text accessibilityRole="alert" className="text-danger">
              GitHub sign-in failed. Reconnect to try again.
            </Text>
          )}
        </>
      )}
      {state.repositories && (
        <View className="gap-1">
          <Text>{state.repositories.total} accessible repositories</Text>
          {state.repositories.repositories.slice(0, visible).map((row) => (
            <Text key={row.fullName}>
              {row.fullName}
              {row.private ? " · Private" : ""}
            </Text>
          ))}
          {state.repositories.repositories.length > visible && (
            <Button label="Show more repositories" onPress={() => setVisible(visible + 40)} />
          )}
        </View>
      )}
    </View>
  );
}
