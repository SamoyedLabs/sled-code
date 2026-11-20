import { OPENBOT_LIVE_VOICES } from "@t3tools/contracts";
import { Pressable } from "react-native";
import { AppText } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { Menu } from "../../components/ui/Menu";
import {
  saveBotGptVoiceSettings,
  useBotGptVoiceSettings,
} from "../bots/upstream/voice/botGptVoice";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";

const choices = [
  { id: "automatic", title: "Automatic" },
  ...OPENBOT_LIVE_VOICES.map((id) => ({ id, title: id[0]!.toUpperCase() + id.slice(1) })),
];

export function BotGptVoiceSettings({ disabled }: { disabled: boolean }) {
  const settings = useBotGptVoiceSettings();
  function save(next: typeof settings) {
    try {
      saveBotGptVoiceSettings(next);
    } catch {
      Dialog.alert("Could not save GPT live voice settings", "Try again.");
    }
  }
  return (
    <SettingsSection footer="Uses the Codex sign-in on your bot computer for live voice in direct bot chats.">
      <SettingsSwitchRow
        icon="mic"
        label="GPT live voice"
        value={settings.enabled}
        disabled={disabled}
        onValueChange={(enabled) => save({ ...settings, enabled })}
      />
      {settings.enabled && (
        <Menu
          actions={choices.map((choice) => ({
            ...choice,
            state: choice.id === (settings.voice ?? "automatic") ? "on" : "off",
          }))}
          onPressAction={({ nativeEvent }) => {
            if (disabled) return;
            const voice = OPENBOT_LIVE_VOICES.find((entry) => entry === nativeEvent.event) ?? null;
            save({ ...settings, voice });
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="GPT live voice selection"
            disabled={disabled}
            className="min-h-11 flex-row items-center justify-between px-4"
          >
            <AppText>Voice</AppText>
            <AppText className="text-foreground-muted">
              {choices.find((choice) => choice.id === settings.voice)?.title ?? "Automatic"}
            </AppText>
          </Pressable>
        </Menu>
      )}
    </SettingsSection>
  );
}
