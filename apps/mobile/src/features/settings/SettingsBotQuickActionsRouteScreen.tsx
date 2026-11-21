import { useState } from "react";
import { View, Pressable } from "react-native";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import { BOT_QUICK_ACTION_LIMIT, BOT_QUICK_ACTIONS } from "../shortcuts/botQuickActions";
import { setBotQuickAction, useBotQuickActionChoices } from "../shortcuts/botQuickActionsRuntime";
import { AppText as Text } from "../../components/ui/AppText";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import { T, useGT } from "gt-react-native";

export function SettingsBotQuickActionsRouteScreen() {
  const gt = useGT();
  const choices = useBotQuickActionChoices();
  const [failed, setFailed] = useState(false);
  return (
    <SettingsScreen title={gt("Quick actions")}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 py-4"
      >
        {failed && (
          <Text accessibilityRole="alert" className="text-destructive">
            <T>Could not save quick actions.</T>
          </Text>
        )}
        <SettingsSection
          title={gt("App icon")}
          footer="Touch and hold the Sled app icon to use these shortcuts. iOS shows up to four."
        >
          {BOT_QUICK_ACTIONS.map(({ kind, title }) => {
            const checked = choices.includes(kind);
            const disabled = !checked && choices.length === BOT_QUICK_ACTION_LIMIT;
            return (
              <Pressable
                key={kind}
                accessibilityRole="switch"
                accessibilityLabel={title}
                accessibilityState={{ checked, disabled }}
                disabled={disabled}
                onPress={() => {
                  try {
                    setBotQuickAction(kind, !checked);
                    setFailed(false);
                  } catch {
                    setFailed(true);
                  }
                }}
              >
                <ListRowLayout
                  label={title}
                  accessory={
                    <View pointerEvents="none" accessibilityElementsHidden>
                      <ThemedSwitch value={checked} disabled={disabled} />
                    </View>
                  }
                />
              </Pressable>
            );
          })}
        </SettingsSection>
      </ScreenScrollView>
    </SettingsScreen>
  );
}
