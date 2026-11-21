import { useEffect, useEffectEvent, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useIsFocused, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { Button } from "../../components/ui/Button";
import { Sheet } from "../../components/ui/Sheet";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { SymbolView } from "../../components/ui/AppSymbol";
import { useAppForeground } from "../../lib/appState";
import { openbot } from "../../state/openbot";
import { BotGlass, BotIconButton, useBotPalette } from "../bots/upstream/BotChrome";
import { OpenBotText as Text } from "../bots/upstream/OpenBotTypography";
import { BotBrowserProfiles } from "./BotBrowserProfiles";
import { BotBrowserView } from "./BotBrowserView";
import { SettingsScreen } from "./components/SettingsScreen";
import { useBotBrowser } from "./useBotBrowser";
import { useBotBrowserViewer } from "./useBotBrowserViewer";
import { T, useGT } from "gt-react-native";

type Props = { environmentId: EnvironmentId; hostId: string; agentId?: string; threadId?: string };

export function BotBrowserRoute({ route }: StaticScreenProps<Props>) {
  const gt = useGT();
  return (
    <SettingsScreen title={gt("Browser")}>
      <ScreenScrollView
        contentContainerClassName="gap-3 px-4 pb-8"
        keyboardShouldPersistTaps="handled"
      >
        <BotBrowserWorkspace {...route.params} />
      </ScreenScrollView>
    </SettingsScreen>
  );
}

export function BotBrowser(props: Props) {
  const gt = useGT();
  const navigation = useNavigation();
  return <Button label={gt("Browser")} onPress={() => navigation.navigate("BotBrowser", props)} />;
}

export function BotBrowserWorkspace(props: Props) {
  return <BrowserPanel key={JSON.stringify(props)} {...props} />;
}

function BrowserPanel({ environmentId, hostId, agentId, threadId }: Props) {
  const gt = useGT();
  const browser = useBotBrowser(environmentId, hostId);
  const p = useBotPalette();
  const [address, setAddress] = useState("");
  const [sheet, setSheet] = useState<"tabs" | "profiles" | null>(null);
  const [tabId, setTabId] = useState<string | null>(null);
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const refresh = useEffectEvent(browser.refresh);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Refresh the host snapshot when the browser comes back into view.
  useEffect(() => {
    if (focused && foreground && browser.canControl) refresh();
  }, [focused, foreground, browser.canControl]);
  const tabs =
    browser.display?.tabs.filter(
      (tab) =>
        (!agentId || tab.ownerAgentId === agentId) && (!threadId || tab.ownerThreadId === threadId),
    ) ?? [];
  const active =
    tabs.find((tab) => tab.id === tabId) ??
    tabs.find((tab) => tab.id === browser.display?.activeTabId) ??
    tabs[0];
  const locked = browser.busy || !browser.canControl;
  function open(url: string) {
    const ownerThreadId = threadId ?? active?.ownerThreadId;
    void browser
      .act({
        operation: "browser.open",
        url,
        focus: false,
        ...(agentId ? { ownerAgentId: agentId } : {}),
        ...(ownerThreadId ? { ownerThreadId } : {}),
      })
      .then((tab) => {
        if (tab && typeof tab === "object" && "id" in tab && typeof tab.id === "string")
          setTabId(tab.id);
      });
  }
  function go() {
    const value = address.trim();
    if (!value || locked) return;
    if (active) void browser.act({ operation: "browser.load", tabId: active.id, url: value });
    else open(value);
    setAddress("");
  }
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <BotGlass style={{ flex: 1, borderRadius: 26 }}>
          <View
            style={{ flexDirection: "row", alignItems: "center", minHeight: 46, paddingLeft: 12 }}
          >
            <SymbolView name="globe" size={16} tintColor={p.muted} />
            <TextInput
              accessibilityLabel={gt("Browser address")}
              placeholder={active?.url || gt("Address")}
              placeholderTextColor={p.muted}
              style={{ flex: 1, color: p.text, fontSize: 14, paddingHorizontal: 8 }}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="go"
              editable={!locked}
              value={address}
              maxLength={2048}
              onChangeText={setAddress}
              onSubmitEditing={go}
            />
            <BotIconButton
              label={gt("Go to address")}
              icon="arrow.right"
              onPress={go}
              disabled={locked || !address.trim()}
            />
          </View>
        </BotGlass>
        <BotGlass>
          <BotIconButton
            label={gt("Tabs, {length} open", { length: tabs.length })}
            icon="square.on.square"
            onPress={() => setSheet("tabs")}
          />
        </BotGlass>
      </View>
      {browser.error && (
        <Text accessibilityRole="alert" style={{ color: p.muted }}>
          {browser.error}
        </Text>
      )}
      {!browser.canControl ? (
        <Text style={{ color: p.muted, padding: 10 }}>
          <T>This connection cannot control the bot browser.</T>
        </Text>
      ) : active ? (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <BotIconButton
              label={gt("Back")}
              icon="chevron.left"
              disabled={locked || !active.canGoBack}
              onPress={() =>
                void browser.act({
                  operation: "browser.navigate",
                  direction: "back",
                  tabId: active.id,
                })
              }
            />
            <BotIconButton
              label={gt("Forward")}
              icon="chevron.right"
              disabled={locked || !active.canGoForward}
              onPress={() =>
                void browser.act({
                  operation: "browser.navigate",
                  direction: "forward",
                  tabId: active.id,
                })
              }
            />
            <BotIconButton
              label={active.loading ? gt("Stop loading") : gt("Reload")}
              icon={active.loading ? "xmark" : "arrow.clockwise"}
              disabled={locked}
              onPress={() =>
                void browser.act({
                  operation: active.loading ? "browser.stop" : "browser.reload",
                  tabId: active.id,
                })
              }
            />
            <View style={{ flex: 1 }} />
            <Button
              size="compact"
              label={active.userControl ? gt("Return to bot") : gt("Take control")}
              disabled={locked}
              onPress={() =>
                void browser.act({
                  operation: active.userControl ? "browser.release" : "browser.take",
                  tabId: active.id,
                })
              }
            />
            <BotIconButton
              label={gt("Close tab")}
              icon="xmark"
              disabled={locked}
              onPress={() => void browser.act({ operation: "browser.close", tabId: active.id })}
            />
          </View>
          {focused && foreground && (
            <TabViewer
              key={active.id}
              environmentId={environmentId}
              hostId={hostId}
              tabId={active.id}
              interactive={Boolean(active.userControl)}
            />
          )}
        </>
      ) : (
        <View style={{ minHeight: 260, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <SymbolView name="globe" size={30} tintColor={p.muted} />
          <Text style={{ color: p.muted }}>
            {browser.busy ? gt("Loading tabs…") : gt("No open tabs")}
          </Text>
          <View>
            <Button
              label={gt("New tab")}
              disabled={locked}
              onPress={() => open("https://www.google.com")}
            />
          </View>
        </View>
      )}
      {sheet && (
        <Sheet
          title={sheet === "profiles" ? gt("Browser profiles") : gt("Tabs")}
          onClose={() => setSheet(null)}
        >
          {sheet === "profiles" ? (
            <BotBrowserProfiles
              environmentId={environmentId}
              hostId={hostId}
              {...(agentId ? { agentId } : {})}
              profiles={browser.profiles}
              busy={browser.busy}
              act={browser.act}
            />
          ) : (
            <ScreenScrollView
              contentInsetAdjustmentBehavior="automatic"
              contentContainerClassName="gap-3 px-5 pb-10"
            >
              {tabs.map((tab) => (
                <Pressable
                  key={tab.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: tab.id === active?.id }}
                  onPress={() => {
                    setTabId(tab.id);
                    setAddress("");
                    setSheet(null);
                    void browser.act({ operation: "browser.activate", tabId: tab.id });
                  }}
                  style={{ backgroundColor: p.control, padding: 14, borderRadius: 16, gap: 4 }}
                >
                  <Text numberOfLines={1} style={{ color: p.text, fontWeight: "600" }}>
                    {tab.title || gt("Untitled tab")}
                  </Text>
                  <Text numberOfLines={1} style={{ color: p.muted, fontSize: 13 }}>
                    {tab.url}
                  </Text>
                </Pressable>
              ))}
              <Button
                label={gt("New tab")}
                disabled={locked}
                onPress={() => {
                  setSheet(null);
                  open("https://www.google.com");
                }}
              />
              <Button
                label={gt("Browser profiles")}
                disabled={locked}
                onPress={() => {
                  setSheet("profiles");
                  void browser.act({ operation: "browser.profiles.list" });
                }}
              />
              <Button
                label={gt("Refresh tabs")}
                tone="text"
                disabled={locked}
                onPress={browser.refresh}
              />
            </ScreenScrollView>
          )}
        </Sheet>
      )}
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
  const p = useBotPalette();
  const canView = useAtomValue(
    openbot.browserViewCommand.permissionAtom(environmentId, { operation: "open", hostId, tabId }),
  );
  const connect = useBotBrowserViewer(environmentId, hostId, tabId);
  return canView ? (
    <BotBrowserView connect={connect} interactive={interactive} />
  ) : (
    <Text style={{ color: p.muted }}>
      <T>Live view is unavailable on this connection.</T>
    </Text>
  );
}
