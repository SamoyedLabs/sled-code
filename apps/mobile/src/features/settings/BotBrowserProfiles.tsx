import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import { Pressable, View } from "react-native";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useBotPalette } from "../bots/upstream/BotChrome";
import { OpenBotText as Text } from "../bots/upstream/OpenBotTypography";
import { BotBrowserProxies } from "./BotBrowserProxies";

type Profile = {
  id: string;
  name: string;
  hue: number;
  agentIds: readonly string[];
  tabCount: number;
};
const colors = [0, 30, 55, 100, 150, 185, 215, 245, 280, 320] as const;
const colorLabels = [
  "Red",
  "Orange",
  "Yellow",
  "Lime",
  "Green",
  "Teal",
  "Blue",
  "Indigo",
  "Purple",
  "Pink",
];

export function BotBrowserProfiles({
  environmentId,
  hostId,
  agentId,
  profiles,
  busy,
  act,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId?: string;
  profiles: readonly Profile[] | null;
  busy: boolean;
  act: (request: OpenbotAdminRequest) => Promise<unknown>;
}) {
  const p = useBotPalette();
  const clearOrDelete = (profile: Profile, remove: boolean) =>
    Dialog.confirm({
      title: remove ? "Delete browser profile?" : "Clear browser data?",
      message: remove
        ? "This closes its tabs and moves its bots to the shared profile."
        : "This closes its tabs and signs it out of every site.",
      confirmText: remove ? "Delete profile" : "Clear data",
      destructive: true,
      onConfirm: () =>
        void act({
          operation: remove ? "browser.profiles.delete" : "browser.profiles.clear",
          profileId: profile.id,
        }),
    });
  const assign = (
    profile: { kind: "shared" | "agent" } | { kind: "profile"; profileId: string },
  ) => {
    if (!agentId) return;
    Dialog.confirm({
      title: "Switch browser profile?",
      message: "This closes the bot’s current tabs.",
      confirmText: "Switch profile",
      onConfirm: () => void act({ operation: "browser.profile.assign", agentId, profile }),
    });
  };
  const named = (profile?: Profile) =>
    Dialog.prompt({
      title: profile ? "Rename browser profile" : "New browser profile",
      initialValue: profile?.name ?? "",
      placeholder: "Profile name",
      confirmText: profile ? "Save" : "Create",
      onConfirm: (value) => {
        const name = value.trim().slice(0, 60);
        if (name)
          void act(
            profile
              ? { operation: "browser.profiles.update", name, profileId: profile.id }
              : { operation: "browser.profiles.create", name },
          );
      },
    });
  return (
    <ScreenScrollView
      contentInsetAdjustmentBehavior="automatic"
      contentContainerClassName="gap-4 px-5 pb-10"
      keyboardShouldPersistTaps="handled"
    >
      {profiles === null ? (
        <Button
          label={busy ? "Loading profiles…" : "Load profiles"}
          disabled={busy}
          onPress={() => void act({ operation: "browser.profiles.list" })}
        />
      ) : (
        <>
          {profiles.map((profile) => (
            <Menu
              key={profile.id}
              actions={[
                { id: "rename", title: "Rename" },
                {
                  id: "color",
                  title: "Color",
                  subactions: colors.map((hue, index) => ({
                    id: `color:${hue}`,
                    title: colorLabels[index]!,
                    state: hue === profile.hue ? "on" : "off",
                  })),
                },
                ...(agentId ? [{ id: "assign", title: "Use for this bot" }] : []),
                { id: "clear", title: "Clear browser data", attributes: { destructive: true } },
                { id: "delete", title: "Delete profile", attributes: { destructive: true } },
              ]}
              onPressAction={({ nativeEvent }) => {
                const event = nativeEvent.event;
                if (event === "rename") named(profile);
                else if (event === "assign") assign({ kind: "profile", profileId: profile.id });
                else if (event === "clear" || event === "delete")
                  clearOrDelete(profile, event === "delete");
                else if (event.startsWith("color:")) {
                  const hue = colors.find((color) => String(color) === event.slice(6));
                  if (hue !== undefined)
                    void act({
                      operation: "browser.profiles.update",
                      profileId: profile.id,
                      hue,
                    });
                }
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${profile.name}, browser profile`}
                style={{
                  padding: 13,
                  borderRadius: 14,
                  backgroundColor: p.control,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                }}
              >
                <View
                  style={{
                    height: 10,
                    width: 10,
                    borderRadius: 5,
                    backgroundColor: `hsl(${profile.hue}, 74%, 59%)`,
                  }}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text numberOfLines={1} style={{ color: p.text, fontWeight: "600" }}>
                    {profile.name}
                  </Text>
                  <Text style={{ color: p.muted, fontSize: 13 }}>
                    {profile.agentIds.length} bots · {profile.tabCount} tabs
                  </Text>
                </View>
              </Pressable>
            </Menu>
          ))}
          <Button label="New profile" onPress={() => named()} disabled={busy} />
          {agentId && (
            <Menu
              actions={[
                { id: "shared", title: "Shared profile" },
                { id: "agent", title: "Bot-only profile" },
                {
                  id: "clear-agent",
                  title: "Clear bot browser data",
                  attributes: { destructive: true },
                },
              ]}
              onPressAction={({ nativeEvent }) => {
                const event = nativeEvent.event;
                if (event === "shared" || event === "agent") assign({ kind: event });
                else if (event === "clear-agent")
                  Dialog.confirm({
                    title: "Clear this bot’s browser data?",
                    message: "This closes its private tabs and signs it out.",
                    confirmText: "Clear data",
                    destructive: true,
                    onConfirm: () => void act({ operation: "browser.profile.clearAgent", agentId }),
                  });
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Choose bot browser profile"
                style={{ padding: 13, borderRadius: 14, backgroundColor: p.control }}
              >
                <Text style={{ color: p.text }}>Bot browser profile</Text>
              </Pressable>
            </Menu>
          )}
          <BotBrowserProxies
            environmentId={environmentId}
            hostId={hostId}
            profiles={profiles}
            onChanged={() => void act({ operation: "browser.profiles.list" })}
          />
        </>
      )}
    </ScreenScrollView>
  );
}
