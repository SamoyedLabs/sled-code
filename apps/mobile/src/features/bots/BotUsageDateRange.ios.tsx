import { DatePicker, Host, VStack } from "@expo/ui/swift-ui";
import { datePickerStyle } from "@expo/ui/swift-ui/modifiers";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";

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
  const { themeAppearance } = useAppearancePreferences();
  return (
    <Host colorScheme={themeAppearance} matchContents={{ vertical: true }}>
      <VStack spacing={12}>
        <DatePicker
          title="Start date"
          selection={start}
          range={{ end: today }}
          onDateChange={onStart}
          modifiers={[datePickerStyle("compact")]}
        />
        <DatePicker
          title="End date"
          selection={end}
          range={{ end: today }}
          onDateChange={onEnd}
          modifiers={[datePickerStyle("compact")]}
        />
      </VStack>
    </Host>
  );
}
