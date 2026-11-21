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
import { T, Var, useGT } from "gt-react-native";

export function MessagingPanel({
  controller,
  allowed,
  environmentId,
  hostId,
}: PanelProps & { environmentId: EnvironmentId; hostId: string }) {
  const gt = useGT();
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
      setError(gt("The return link must match this platform and pending connection."));
      return;
    }
    await run([request, { operation: "connector.messaging.overview", platform }]);
  };
  const openPage = async () => {
    const url = botConnectionUrl(page?.url ?? null);
    if (!url) return;
    if (platform === "telegram") {
      await Linking.openURL(url).catch(() => setError(gt("Could not open Telegram.")));
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
        gt("Could not open the connection page. Use its return link below to complete sign-in."),
      );
    setAuthorizing(false);
  };
  const disabled = !allowed || busy || authorizing;
  return (
    <View className="gap-3">
      <Picker
        label={gt("Messaging platform")}
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
          label={gt("Load connections")}
          disabled={disabled}
          onPress={() => void run([{ operation: "connector.messaging.overview", platform }])}
        />
        <Button
          label={platform === "telegram" ? gt("Connect group chat") : gt("Connect workspace")}
          disabled={disabled}
          onPress={() =>
            void run([{ operation: "connector.messaging.connect", platform, place: "group" }])
          }
        />
        {platform === "telegram" && (
          <Button
            label={gt("Connect direct chat")}
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
            label={authorizing ? gt("Waiting for sign-in…") : gt("Open connection page")}
            disabled={disabled || !page.url}
            onPress={() => void openPage()}
          />
          {page.nonce && platform !== "telegram" && (
            <>
              <Text>
                <T>Return link from the connection page</T>
              </Text>
              <AppTextInput
                accessibilityLabel={gt("Connection return link")}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                value={callback}
                editable={!busy && !authorizing && allowed}
                onChangeText={setCallback}
              />
              <Button
                label={gt("Complete connection")}
                disabled={disabled || !callback.trim()}
                onPress={() => void complete(callback)}
              />
              <Text textRole="footnote" className="text-foreground-muted">
                <T>
                  If the browser cannot hand the result back to Sled, paste its return link. The
                  sealed grant clears after submission.
                </T>
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
        <Text className="text-foreground-muted">
          <T>No connections for this platform.</T>
        </Text>
      )}
      {rows?.map((row) => (
        <View key={row.workspaceId} className="gap-2 border-t border-border pt-3">
          <Text className="font-t3-medium">
            {row.workspaceName} · {row.state}
          </Text>
          {row.missingScopes.length > 0 && (
            <Text className="text-foreground-muted">
              <T>
                Missing permissions: <Var>{row.missingScopes.join(", ")}</Var>
              </T>
            </Text>
          )}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={row.enabled ? gt("Disable") : gt("Enable")}
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
              label={gt("Reconnect")}
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
              label={gt("Disconnect")}
              tone="danger"
              disabled={disabled}
              onPress={() =>
                confirm(
                  gt(
                    "Disconnect this workspace or chat from the host? If no other linked place uses its orchestrator, Openbot also deletes that bot. Active work may need to finish first.",
                  ),
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
