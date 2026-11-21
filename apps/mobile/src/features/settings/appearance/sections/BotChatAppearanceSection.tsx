import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText as Text } from "../../../../components/ui/AppText";
import { SymbolView } from "../../../../components/ui/AppSymbol";
import {
  botChatCanvas,
  botMessageColors,
  isBotChatColor,
  readableOnBotColor,
  saveBotChatAppearance,
  useBotChatAppearance,
  type MessageColorMode,
} from "../../../bots/botChatAppearance";
import { useBotPalette } from "../../../bots/upstream/BotChrome";
import {
  CHAT_BACKGROUND_PRESETS,
  CHAT_COLOR_PRESETS,
  type AvatarColor,
} from "../../../bots/upstream/chat-colors";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { m } from "../../../../i18n/messages";
import { T, msg, useGT } from "gt-react-native";

const modes: { value: MessageColorMode; label: string }[] = [
  { value: "none", label: m(msg("None")) },
  { value: "agent", label: m(msg("Bot color")) },
  { value: "custom", label: m(msg("Custom")) },
];

export function BotChatAppearanceSection() {
  const gt = useGT();
  const appearance = useBotChatAppearance();
  const palette = useBotPalette();
  const [error, setError] = useState<string | null>(null);
  const outgoing = botMessageColors(appearance, "#3b93f0");
  const background = appearance.background[palette.scheme];
  const save = (update: Parameters<typeof saveBotChatAppearance>[0]) => {
    try {
      saveBotChatAppearance(update);
      setError(null);
    } catch {
      setError(gt("Could not save your chat appearance."));
    }
  };
  const setBackground = (color: AvatarColor | null) =>
    save({ background: { ...appearance.background, [palette.scheme]: color } });

  return (
    <View className="gap-6">
      <SettingsSection title={gt("Bot message color")} footer={error ?? undefined}>
        <View
          className="gap-2 px-4 py-3"
          style={{ backgroundColor: botChatCanvas(appearance, palette.scheme, palette.canvas) }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Text
            className="self-end rounded-2xl px-3 py-2"
            style={{
              color: outgoing?.text ?? palette.text,
              backgroundColor: outgoing?.fill ?? palette.control,
            }}
          >
            <T>Can you summarize this?</T>
          </Text>
          <Text
            className="self-start rounded-2xl px-3 py-2"
            style={{ color: palette.text, backgroundColor: palette.surface }}
          >
            <T>Of course.</T>
          </Text>
        </View>
        <View
          className="flex-row gap-2 p-3"
          accessibilityRole="radiogroup"
          accessibilityLabel={gt("Message color")}
        >
          {modes.map(({ value, label }) => {
            const checked = appearance.messageColor === value;
            return (
              <Pressable
                key={value}
                accessibilityRole="radio"
                accessibilityState={{ checked }}
                onPress={() => save({ messageColor: value })}
                className={
                  checked
                    ? "flex-1 items-center rounded-xl bg-grouped-inset px-2 py-3"
                    : "flex-1 items-center rounded-xl px-2 py-3"
                }
                style={checked ? { backgroundColor: palette.control } : undefined}
              >
                <Text className={checked ? "font-t3-semibold" : "text-foreground-muted"}>
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {appearance.messageColor === "custom" && (
          <>
            <Swatches
              label={gt("Message color presets")}
              choices={CHAT_COLOR_PRESETS}
              selected={appearance.customColor}
              onSelect={(color) => save({ customColor: color })}
            />
            <HexColorField
              key={appearance.customColor}
              label={gt("Custom message color")}
              value={appearance.customColor}
              onSelect={(color) => save({ customColor: color })}
            />
          </>
        )}
      </SettingsSection>
      <SettingsSection
        title={gt("Bot chat background")}
        footer={`Applies to ${palette.scheme} mode.`}
      >
        <Swatches
          label={gt("Chat background presets")}
          choices={CHAT_BACKGROUND_PRESETS[palette.scheme]}
          selected={background}
          onSelect={setBackground}
        />
        <HexColorField
          key={background ?? "default"}
          label={gt("Custom chat background")}
          value={background}
          onSelect={setBackground}
        />
        {background && (
          <Pressable
            accessibilityRole="button"
            className="px-4 py-3"
            onPress={() => setBackground(null)}
          >
            <Text>
              <T>Use theme background</T>
            </Text>
          </Pressable>
        )}
      </SettingsSection>
      <SettingsSection title={gt("Bot chat details")}>
        <SettingsSwitchRow
          label={gt("Show activity")}
          subtitle={gt("Show expandable tool activity in bot replies.")}
          value={appearance.showActivity}
          onValueChange={(showActivity) => save({ showActivity })}
        />
        <SettingsSwitchRow
          label={gt("Show subagents")}
          value={appearance.showSubagents}
          onValueChange={(showSubagents) => save({ showSubagents })}
        />
        <SettingsSwitchRow
          label={gt("Show saved memories")}
          value={appearance.showMemoryChanges}
          onValueChange={(showMemoryChanges) => save({ showMemoryChanges })}
        />
      </SettingsSection>
    </View>
  );
}

function Swatches({
  label,
  choices,
  selected,
  onSelect,
}: {
  label: string;
  choices: readonly { id: string; value: AvatarColor }[];
  selected: AvatarColor | null;
  onSelect: (value: AvatarColor) => void;
}) {
  const palette = useBotPalette();
  return (
    <View
      className="flex-row flex-wrap gap-2 px-4 py-3"
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {choices.map(({ id, value }) => {
        const checked = selected === value;
        return (
          <Pressable
            key={id}
            accessibilityRole="radio"
            accessibilityLabel={id[0]!.toUpperCase() + id.slice(1)}
            accessibilityState={{ checked }}
            onPress={() => onSelect(value)}
            className="size-10 items-center justify-center rounded-full border"
            style={{ backgroundColor: value, borderColor: palette.border }}
          >
            {checked && (
              <SymbolView name="checkmark" size={17} tintColor={readableOnBotColor(value)} />
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function HexColorField({
  label,
  value,
  onSelect,
}: {
  label: string;
  value: AvatarColor | null;
  onSelect: (value: AvatarColor) => void;
}) {
  const [draft, setDraft] = useState<string>(value ?? "");
  const palette = useBotPalette();
  const color = `#${draft.trim().replace(/^#/u, "").toLowerCase()}`;
  const valid = isBotChatColor(color);
  return (
    <View className="flex-row items-center gap-3 px-4 py-2">
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        className="min-h-11 flex-1 text-foreground"
        inputMode="text"
        maxLength={7}
        onChangeText={setDraft}
        onSubmitEditing={() => {
          if (valid) onSelect(color);
        }}
        placeholder="#RRGGBB"
        placeholderTextColor={palette.muted}
        value={draft}
      />
      <Pressable
        accessibilityRole="button"
        className="min-h-11 justify-center"
        disabled={!valid}
        onPress={() => {
          if (valid) onSelect(color);
        }}
      >
        <Text style={{ color: valid ? palette.text : palette.muted }}>
          <T>Apply color</T>
        </Text>
      </Pressable>
    </View>
  );
}
