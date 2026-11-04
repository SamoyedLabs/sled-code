import type { EnvironmentId } from "@t3tools/contracts";
import { MessagingOrchestrators } from "./BotMessagingOrchestrators";
import { View } from "react-native";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import type { BotConnectionPanelProps as PanelProps } from "./useBotConnections";
import { useState } from "react";
import { Linking } from "react-native";
import { openAuthSessionAsync } from "expo-web-browser";
import {
  botConnectionUrl,
  botMessagingGrant,
  type BotMessagingPlatform,
} from "@t3tools/client-runtime/openbot/presentation";
import { AppTextInput } from "../../components/ui/AppText";
import { confirm, Picker } from "./BotConnectionControls";

export function MessagingPanel({
  controller,
  allowed,
  environmentId,
  hostId,
}: PanelProps & { environmentId: EnvironmentId; hostId: string }) {
  const { state, run, busy, setError } = controller;
  const [platform, setPlatform] = useState<BotMessagingPlatform>("slack");
  const [callback, setCallback] = useState("");
  const [authorizing, setAuthorizing] = useState(false);
  const page = state.page?.platform === platform ? state.page : null;
  const rows = state.messaging[platform]?.connections;
  const complete = async (value: string) => {
    if (!page?.nonce || platform === "telegram") return;
    const request = botMessagingGrant(platform, value, page.nonce);
    setCallback("");
    if (!request) {
      setError("The return link must match this platform and pending connection.");
      return;
    }
    await run([request, { operation: "connector.messaging.overview", platform }]);
  };
  const openPage = async () => {
    const url = botConnectionUrl(page?.url ?? null);
    if (!url) return;
    if (platform === "telegram") {
      await Linking.openURL(url).catch(() => setError("Could not open Telegram."));
      return;
    }
    if (!page?.nonce || authorizing) return;
    setAuthorizing(true);
    const result = await openAuthSessionAsync(
      url,
      platform === "slack" ? "openbot://slack-workspace" : "openbot://discord-guild",
    ).catch(() => null);
    if (result?.type === "success") await complete(result.url);
    if (result === null)
      setError(
        "Could not open the connection page. Use its return link below to complete sign-in.",
      );
    setAuthorizing(false);
  };
  const disabled = !allowed || busy || authorizing;
  return (
    <View className="gap-3">
      <Picker
        label="Messaging platform"
        value={platform}
        options={[
          { id: "slack", name: "Slack" },
          { id: "discord", name: "Discord" },
          { id: "telegram", name: "Telegram" },
        ]}
        disabled={busy || authorizing}
        onChange={(value) => {
          if (value === "slack" || value === "discord" || value === "telegram") {
            setPlatform(value);
            setCallback("");
          }
        }}
      />
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Load connections"
          disabled={disabled}
          onPress={() => void run([{ operation: "connector.messaging.overview", platform }])}
        />
        <Button
          label={platform === "telegram" ? "Connect group chat" : "Connect workspace"}
          disabled={disabled}
          onPress={() =>
            void run([{ operation: "connector.messaging.connect", platform, place: "group" }])
          }
        />
        {platform === "telegram" && (
          <Button
            label="Connect direct chat"
            disabled={disabled}
            onPress={() =>
              void run([{ operation: "connector.messaging.connect", platform, place: "direct" }])
            }
          />
        )}
      </View>
      {page && (
        <View className="gap-2">
          <Button
            label={authorizing ? "Waiting for sign-in…" : "Open connection page"}
            disabled={disabled || !page.url}
            onPress={() => void openPage()}
          />
          {page.nonce && platform !== "telegram" && (
            <>
              <Text>Return link from the connection page</Text>
              <AppTextInput
                accessibilityLabel="Connection return link"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                value={callback}
                editable={!busy && !authorizing && allowed}
                onChangeText={setCallback}
              />
              <Button
                label="Complete connection"
                disabled={disabled || !callback.trim()}
                onPress={() => void complete(callback)}
              />
              <Text textRole="footnote" className="text-foreground-muted">
                If the browser cannot hand the result back to Sled, paste its return link. The
                sealed grant clears after submission.
              </Text>
            </>
          )}
        </View>
      )}
      {rows && (
        <MessagingOrchestrators
          controller={controller}
          allowed={allowed}
          environmentId={environmentId}
          hostId={hostId}
          platform={platform}
        />
      )}
      {rows?.length === 0 && (
        <Text className="text-foreground-muted">No connections for this platform.</Text>
      )}
      {rows?.map((row) => (
        <View key={row.workspaceId} className="gap-2 border-t border-border pt-3">
          <Text className="font-t3-medium">
            {row.workspaceName} · {row.state}
          </Text>
          {row.missingScopes.length > 0 && (
            <Text className="text-foreground-muted">
              Missing permissions: {row.missingScopes.join(", ")}
            </Text>
          )}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={row.enabled ? "Disable" : "Enable"}
              disabled={disabled}
              onPress={() =>
                void run([
                  {
                    operation: "connector.messaging.enabled",
                    platform,
                    workspaceId: row.workspaceId,
                    enabled: !row.enabled,
                  },
                  { operation: "connector.messaging.overview", platform },
                ])
              }
            />
            <Button
              label="Reconnect"
              disabled={disabled}
              onPress={() =>
                void run([
                  {
                    operation: "connector.messaging.reconnect",
                    platform,
                    workspaceId: row.workspaceId,
                  },
                ])
              }
            />
            <Button
              label="Disconnect"
              tone="danger"
              disabled={disabled}
              onPress={() =>
                confirm(
                  "Disconnect this workspace or chat from the host? If no other linked place uses its orchestrator, Openbot also deletes that bot. Active work may need to finish first.",
                  () =>
                    void run([
                      {
                        operation: "connector.messaging.disconnect",
                        platform,
                        workspaceId: row.workspaceId,
                      },
                      { operation: "connector.messaging.overview", platform },
                    ]),
                )
              }
            />
          </View>
        </View>
      ))}
    </View>
  );
}
