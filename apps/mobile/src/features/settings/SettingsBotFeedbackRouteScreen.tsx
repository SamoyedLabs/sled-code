import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import {
  type BotMotionPreference,
  saveBotFeedback,
  useBotFeedback,
  useBotReducedMotion,
} from "../bots/botFeedback";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsPictureChoice } from "./components/BotSettingsPictureChoice";
import { MotionPicture } from "./components/BotSettingsPictures";

function FeedbackToggle({
  title,
  description,
  enabled,
  disabled,
  onPress,
}: {
  title: string;
  description?: string;
  enabled: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={title}
      accessibilityHint={description}
      accessibilityState={{ checked: enabled, disabled }}
      onPress={onPress}
      disabled={disabled}
    >
      <ListRowLayout
        label={title}
        description={description}
        accessory={
          <View pointerEvents="none" accessibilityElementsHidden>
            <ThemedSwitch value={enabled} />
          </View>
        }
      />
    </Pressable>
  );
}
const motionOptions = [
  ["agentFaces", "Bot faces", "Animate the selected bot’s expression."],
  ["textReveal", "Text reveal", "Reveal a bot’s reply as it is written."],
  ["searchTransitions", "Search transitions", "Animate the search bar as it opens and closes."],
] as const satisfies readonly (readonly [BotMotionPreference, string, string])[];
const motionPictures = [
  {
    value: true,
    label: "Full motion",
    picture: (play: number) => <MotionPicture full play={play} />,
  },
  {
    value: false,
    label: "Reduced",
    picture: (play: number) => <MotionPicture full={false} play={play} />,
  },
];

export function SettingsBotMotionRouteScreen() {
  return <BotFeedbackSettings hapticsPage={false} />;
}
export function SettingsBotHapticsRouteScreen() {
  return <BotFeedbackSettings hapticsPage />;
}
function BotFeedbackSettings({ hapticsPage }: { hapticsPage: boolean }) {
  const preferences = useBotFeedback();
  const reduced = useBotReducedMotion();
  const [failed, setFailed] = useState(false);
  const save = (name: keyof typeof preferences, value: boolean) => {
    try {
      saveBotFeedback(name, value);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  return (
    <SettingsScreen title={hapticsPage ? "Haptics" : "Animations"}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 py-4"
      >
        {failed && (
          <Text accessibilityRole="alert" className="text-destructive">
            Could not save this setting.
          </Text>
        )}
        {hapticsPage ? (
          <SettingsSection title="Touch feedback">
            <FeedbackToggle
              title="Haptics"
              description="Feel feedback from bot controls and gestures."
              enabled={preferences.haptics}
              onPress={() => save("haptics", !preferences.haptics)}
            />
            <FeedbackToggle
              title="Reply feedback"
              description="Feel the rhythm of a bot’s reply as text appears."
              enabled={preferences.haptics && preferences.replyHaptics}
              disabled={!preferences.haptics}
              onPress={() => save("replyHaptics", !preferences.replyHaptics)}
            />
          </SettingsSection>
        ) : (
          <>
            <SettingsSection
              title="Motion"
              footer="Sled also follows the device’s Reduce Motion setting."
            >
              <SettingsPictureChoice
                label="Motion"
                value={preferences.animations}
                options={motionPictures}
                onChange={(enabled) => save("animations", enabled)}
              />
            </SettingsSection>
            <SettingsSection>
              {motionOptions.map(([name, title, description]) => (
                <FeedbackToggle
                  key={name}
                  title={title}
                  description={description}
                  enabled={preferences[name] && !reduced}
                  disabled={reduced}
                  onPress={() => save(name, !preferences[name])}
                />
              ))}
            </SettingsSection>
          </>
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}
