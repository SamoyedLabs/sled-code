import { useState } from "react";
import { Modal, ScrollView, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  browserActionLabel,
  browserTabActions,
} from "@t3tools/client-runtime/openbot/presentation";
import * as Dialog from "../../components/ui/Dialog";
import { useBotBrowser } from "./useBotBrowser";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { useAppForeground } from "../../lib/appState";
import { openbot } from "../../state/openbot";
import { BotBrowserView } from "./BotBrowserView";
import { useBotBrowserViewer } from "./useBotBrowserViewer";

type Props = { environmentId: EnvironmentId; hostId: string; agentId?: string };
export function BotBrowser(props: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Button
        label={expanded ? "Close browser" : "Browser"}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && (
        <BrowserPanel
          key={`${props.environmentId}:${props.hostId}:${props.agentId ?? "host"}`}
          {...props}
        />
      )}
    </View>
  );
}
function BrowserPanel({
  environmentId,
  hostId,
  agentId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId?: string;
}) {
  const browser = useBotBrowser(environmentId, hostId);
  const [url, setUrl] = useState("");
  const [profileName, setProfileName] = useState("");
  const confirm = (message: string, action: () => void) =>
    Dialog.alert("Browser profile", message, [
      { text: "Cancel", style: "cancel" },
      { text: "Continue", style: "destructive", onPress: action },
    ]);
  return (
    <View className="gap-3">
      <Text className="text-foreground">Bot browser</Text>
      <Button label="Refresh browser" onPress={browser.refresh} />
      {browser.error && <Text accessibilityRole="alert">{browser.error}</Text>}
      <Text>
        Taking control pauses bot interaction until you return control. Open the live viewer to
        interact with the page. OS permission requests must be completed on the host.
      </Text>
      <AppTextInput
        accessibilityLabel="Browser address"
        value={url}
        onChangeText={setUrl}
        maxLength={2048}
        autoCapitalize="none"
        className="rounded-xl border border-border p-3 text-foreground"
      />
      <Button
        label="Open tab"
        disabled={browser.busy || !browser.canControl || !url.trim()}
        onPress={() => void browser.act({ operation: "browser.open", url, focus: true })}
      />
      {browser.display?.tabs.map((tab) => (
        <View key={tab.id} className="gap-2 rounded-xl border border-border p-3">
          <Text>{tab.title || "Untitled tab"}</Text>
          <Text>{tab.url}</Text>
          <Text>{tab.userControl ? "Human control" : "Bot control"}</Text>
          {browserTabActions(tab).map((request) => (
            <Button
              key={JSON.stringify(request)}
              label={browserActionLabel(request)}
              disabled={browser.busy || !browser.canControl}
              onPress={() => void browser.act(request)}
            />
          ))}
          <Button
            label="Load address here"
            disabled={browser.busy || !browser.canControl || !url.trim()}
            onPress={() => void browser.act({ operation: "browser.load", tabId: tab.id, url })}
          />
          <TabViewer
            environmentId={environmentId}
            hostId={hostId}
            tabId={tab.id}
            interactive={Boolean(tab.userControl)}
          />
        </View>
      ))}
      <Button
        label="Load profiles"
        disabled={browser.busy || !browser.canControl}
        onPress={() => void browser.act({ operation: "browser.profiles.list" })}
      />
      {browser.profiles && (
        <View className="gap-2">
          <AppTextInput
            accessibilityLabel="Profile name for create or rename"
            value={profileName}
            maxLength={60}
            onChangeText={setProfileName}
            className="rounded-xl border border-border p-3 text-foreground"
          />
          <Button
            label="Create profile"
            disabled={browser.busy || !browser.canControl || !profileName.trim()}
            onPress={() =>
              void browser.act({ operation: "browser.profiles.create", name: profileName })
            }
          />
          {agentId &&
            (["shared", "agent"] as const).map((kind) => (
              <Button
                key={kind}
                label={kind === "shared" ? "Use shared profile" : "Use bot-only profile"}
                disabled={browser.busy || !browser.canControl}
                onPress={() =>
                  confirm(
                    "Closes the bot's existing tabs.",
                    () =>
                      void browser.act({
                        operation: "browser.profile.assign",
                        agentId,
                        profile: { kind },
                      }),
                  )
                }
              />
            ))}
        </View>
      )}
      {browser.profiles?.map((profile) => (
        <View key={profile.id} className="gap-2">
          <Text>
            {profile.name} · {profile.tabCount} tabs
          </Text>
          <Button
            label="Rename to entered name"
            disabled={browser.busy || !browser.canControl || !profileName.trim()}
            onPress={() =>
              void browser.act({
                operation: "browser.profiles.update",
                profileId: profile.id,
                name: profileName,
              })
            }
          />
          <Button
            label="Clear sign-ins"
            disabled={browser.busy || !browser.canControl}
            onPress={() =>
              confirm(
                "Closes this profile's tabs and signs out every site.",
                () =>
                  void browser.act({ operation: "browser.profiles.clear", profileId: profile.id }),
              )
            }
          />
          <Button
            label="Delete profile"
            disabled={browser.busy || !browser.canControl}
            onPress={() =>
              confirm(
                "Closes tabs and moves bots to the shared profile.",
                () =>
                  void browser.act({ operation: "browser.profiles.delete", profileId: profile.id }),
              )
            }
          />
          {agentId && (
            <Button
              label="Assign to bot"
              disabled={browser.busy || !browser.canControl}
              onPress={() =>
                confirm(
                  "Closes the bot's existing tabs.",
                  () =>
                    void browser.act({
                      operation: "browser.profile.assign",
                      agentId,
                      profile: { kind: "profile", profileId: profile.id },
                    }),
                )
              }
            />
          )}
        </View>
      ))}
    </View>
  );
}

function TabViewer({
  environmentId,
  hostId,
  tabId,
  interactive,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  tabId: string;
  interactive: boolean;
}) {
  const [opened, setOpened] = useState(false);
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const canView = useAtomValue(
    openbot.browserViewCommand.permissionAtom(environmentId, { operation: "open", hostId, tabId }),
  );
  const connect = useBotBrowserViewer(environmentId, hostId, tabId);
  return (
    <View>
      <Button label="View page" disabled={!canView} onPress={() => setOpened(true)} />
      {opened && canView && focused && foreground && (
        <Modal
          visible
          presentationStyle="fullScreen"
          onRequestClose={() => setOpened(false)}
          supportedOrientations={["portrait", "landscape"]}
        >
          <SafeAreaView className="flex-1 bg-screen" accessibilityViewIsModal>
            <ScrollView
              contentInsetAdjustmentBehavior="automatic"
              keyboardShouldPersistTaps="handled"
              contentContainerClassName="gap-3 p-4"
            >
              <Button label="Close browser viewer" onPress={() => setOpened(false)} />
              <BotBrowserView connect={connect} interactive={interactive} />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </View>
  );
}
