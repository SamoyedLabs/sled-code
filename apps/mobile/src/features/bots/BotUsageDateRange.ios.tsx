import { DatePicker, Host, VStack } from "@expo/ui/swift-ui";
import { datePickerStyle } from "@expo/ui/swift-ui/modifiers";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import { useGT } from "gt-react-native";

export function BotUsageDateRange({
  start,
  end,
  today,
  onStart,
  onEnd,
}: {
  start: Date;
  end: Date;
  today: Date;
  onStart: (day: Date) => void;
  onEnd: (day: Date) => void;
}) {
  const gt = useGT();
  const { themeAppearance } = useAppearancePreferences();
  return (
    <Host colorScheme={themeAppearance} matchContents={{ vertical: true }}>
      <VStack spacing={12}>
        <DatePicker
          title={gt("Start date")}
          selection={start}
          range={{ end: today }}
          onDateChange={onStart}
          modifiers={[datePickerStyle("compact")]}
        />
        <DatePicker
          title={gt("End date")}
          selection={end}
          range={{ end: today }}
          onDateChange={onEnd}
          modifiers={[datePickerStyle("compact")]}
        />
      </VStack>
    </Host>
  );
}
