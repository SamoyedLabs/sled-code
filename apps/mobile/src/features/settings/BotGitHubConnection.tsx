import { useState } from "react";
import { View } from "react-native";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import type { BotConnectionPanelProps as PanelProps } from "./useBotConnections";
import { confirm, ExternalLink } from "./BotConnectionControls";
import { T, Var, useGT } from "gt-react-native";

export function GitHubPanel({ controller: { state, run, busy, setError }, allowed }: PanelProps) {
  const gt = useGT();
  const [visible, setVisible] = useState(40);
  const status = state.github;
  const failed = () => setError(gt("Could not open the connection page."));
  return (
    <View className="gap-3">
      <Text className="text-foreground-muted">
        <T>The GitHub connection is shared by bots on this host.</T>
      </Text>
      <Button
        label={gt("Check GitHub connection")}
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
            <Text className="text-foreground-muted">
              <T>This host has no GitHub App configured.</T>
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {status.state !== "connected" && (
                <Button
                  label={gt("Connect GitHub")}
                  disabled={!allowed || busy || status.state === "pending"}
                  onPress={() => void run([{ operation: "connector.github.connect" }])}
                />
              )}
              {status.state === "pending" && (
                <Button
                  label={gt("Cancel sign-in")}
                  disabled={!allowed || busy}
                  onPress={() => void run([{ operation: "connector.github.cancel" }])}
                />
              )}
              {status.state === "connected" && (
                <>
                  <Button
                    label={gt("Load repositories")}
                    disabled={!allowed || busy}
                    onPress={() => void run([{ operation: "connector.github.repositories" }])}
                  />
                  <Button
                    label={gt("Disconnect GitHub")}
                    tone="danger"
                    disabled={!allowed || busy}
                    onPress={() =>
                      confirm(
                        gt("Disconnect GitHub from every bot on this host?"),
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
              <T>
                Enter code <Var>{status.userCode}</Var> on GitHub, then check the connection again.
              </T>
            </Text>
          )}
          <ExternalLink
            disabled={!allowed || busy}
            address={status.verificationUri}
            label={gt("Open GitHub sign-in")}
            onFailure={failed}
          />
          <ExternalLink
            disabled={!allowed || busy}
            address={status.installUrl}
            label={gt("Manage repository access")}
            onFailure={failed}
          />
          <ExternalLink
            disabled={!allowed || busy}
            address={status.revokeUrl}
            label={gt("Manage GitHub authorization")}
            onFailure={failed}
          />
          {status.error && (
            <Text accessibilityRole="alert" className="text-danger">
              <T>GitHub sign-in failed. Reconnect to try again.</T>
            </Text>
          )}
        </>
      )}
      {state.repositories && (
        <View className="gap-1">
          <Text>
            <T>
              <Var>{state.repositories.total}</Var> accessible repositories
            </T>
          </Text>
          {state.repositories.repositories.slice(0, visible).map((row) => (
            <Text key={row.fullName}>
              {row.fullName}
              {row.private ? gt(" · Private") : ""}
            </Text>
          ))}
          {state.repositories.repositories.length > visible && (
            <Button label={gt("Show more repositories")} onPress={() => setVisible(visible + 40)} />
          )}
        </View>
      )}
    </View>
  );
}
