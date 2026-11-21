import { useState } from "react";
import { Pressable, View } from "react-native";
import { StackActions, useNavigation } from "@react-navigation/native";
import { AppText as Text } from "../../components/ui/AppText";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import {
  saveBotChatAppearance,
  useBotChatAppearance,
  type BotChatSwipeAction,
} from "../bots/botChatAppearance";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsPictureChoice } from "./components/BotSettingsPictureChoice";
import { ComposerPicture, SwipePicture } from "./components/BotSettingsPictures";
import { saveBotFeedback, useBotFeedback, useBotReducedMotion } from "../bots/botFeedback";
import { m } from "../../i18n/messages";
import { T, msg, useGT } from "gt-react-native";

const swipeActions: readonly { value: BotChatSwipeAction; label: string }[] = [
  { value: "threads", label: m(msg("Threads")) },
  { value: "browser", label: m(msg("Browser")) },
  { value: "off", label: m(msg("Off")) },
];
const swipePictures = swipeActions.map(({ value, label }) => ({
  value,
  label,
  picture: (play: number) => <SwipePicture target={value} play={play} />,
}));
const composerPictures = [
  {
    value: true,
    label: m(msg("Compact")),
    picture: (play: number) => <ComposerPicture compact play={play} />,
  },
  {
    value: false,
    label: m(msg("Always full")),
    picture: (play: number) => <ComposerPicture compact={false} play={play} />,
  },
];

function ConversationToggle({
  label,
  description,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  description: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
    >
      <ListRowLayout
        label={label}
        description={description}
        accessory={
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <ThemedSwitch value={value} />
          </View>
        }
      />
    </Pressable>
  );
}

export function SettingsBotConversationsRouteScreen() {
  const gt = useGT();
  const navigation = useNavigation();
  const appearance = useBotChatAppearance();
  const [failed, setFailed] = useState(false);
  const feedback = useBotFeedback();
  const reducedMotion = useBotReducedMotion();
  const save = (update: Parameters<typeof saveBotChatAppearance>[0]) => {
    try {
      saveBotChatAppearance(update);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  return (
    <SettingsScreen title={gt("Bot conversations")}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-6 px-5 py-4"
      >
        <SettingsSection>
          <SettingsRow
            icon="eye.slash"
            label={gt("Hidden chats")}
            onPress={() =>
              navigation.dispatch(
                StackActions.push("Bots", { openRoster: true, showHiddenChats: true }),
              )
            }
          />
        </SettingsSection>
        <SettingsSection
          title={gt("Message field")}
          footer="Compact expands as the keyboard opens."
        >
          <SettingsPictureChoice
            label={gt("Message field")}
            value={feedback.compactComposer && !reducedMotion}
            disabled={reducedMotion}
            options={composerPictures}
            onChange={(enabled) => {
              try {
                saveBotFeedback("compactComposer", enabled);
                setFailed(false);
              } catch {
                setFailed(true);
              }
            }}
          />
        </SettingsSection>
        <SettingsSection
          title={gt("Swipe left")}
          footer="Choose what opens from a direct bot chat."
        >
          <SettingsPictureChoice
            label={gt("Swipe left")}
            value={appearance.swipeAction}
            options={swipePictures}
            onChange={(swipeAction) => save({ swipeAction })}
          />
        </SettingsSection>
        <SettingsSection>
          <ConversationToggle
            label={gt("Pull up for chat info")}
            description={gt("Pull past the latest message to open details for the bot or group.")}
            value={appearance.pullInfo}
            onValueChange={(pullInfo) => save({ pullInfo })}
          />
        </SettingsSection>
        <SettingsSection title={gt("Media")}>
          <ConversationToggle
            label={gt("Download large files automatically")}
            description={gt(
              "Download visible attachments from 10 to 100 MB while the chat is open.",
            )}
            value={appearance.automaticLargeFiles}
            onValueChange={(automaticLargeFiles) => save({ automaticLargeFiles })}
          />
          <ConversationToggle
            label={gt("Send photos at full quality")}
            description={gt("Keep the original size and format of photos you attach.")}
            value={appearance.fullQualityPhotos}
            onValueChange={(fullQualityPhotos) => save({ fullQualityPhotos })}
          />
        </SettingsSection>
        {failed && (
          <Text accessibilityRole="alert">
            <T>Could not save your conversation setting.</T>
          </Text>
        )}
      </ScreenScrollView>
    </SettingsScreen>
  );
}
