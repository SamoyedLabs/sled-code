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
import { m } from "../../i18n/messages";
import { T, msg, useGT } from "gt-react-native";

const choices = [
  { id: "automatic", title: m(msg("Automatic")) },
  ...OPENBOT_LIVE_VOICES.map((id) => ({ id, title: id[0]!.toUpperCase() + id.slice(1) })),
];

export function BotGptVoiceSettings({ disabled }: { disabled: boolean }) {
  const gt = useGT();
  const settings = useBotGptVoiceSettings();
  function save(next: typeof settings) {
    try {
      saveBotGptVoiceSettings(next);
    } catch {
      Dialog.alert(gt("Could not save GPT live voice settings"), gt("Try again."));
    }
  }
  return (
    <SettingsSection footer="Uses the Codex sign-in on your bot computer for live voice in direct bot chats.">
      <SettingsSwitchRow
        icon="mic"
        label={gt("GPT live voice")}
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
            accessibilityLabel={gt("GPT live voice selection")}
            disabled={disabled}
            className="min-h-11 flex-row items-center justify-between px-4"
          >
            <AppText>
              <T>Voice</T>
            </AppText>
            <AppText className="text-foreground-muted">
              {choices.find((choice) => choice.id === settings.voice)?.title ?? gt("Automatic")}
            </AppText>
          </Pressable>
        </Menu>
      )}
    </SettingsSection>
  );
}
