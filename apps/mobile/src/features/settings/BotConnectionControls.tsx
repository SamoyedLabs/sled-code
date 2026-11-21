import { Linking, View } from "react-native";
import { botConnectionUrl } from "@t3tools/client-runtime/openbot/presentation";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import { Menu } from "../../components/ui/Menu";
import { ControlPill } from "../../components/ui/ControlPill";
import * as Dialog from "../../components/ui/Dialog";
import { m } from "../../i18n/messages";
import { msg, useGT } from "gt-react-native";

export function Picker({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; name: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const gt = useGT();
  return (
    <View className="gap-2">
      <Text>{label}</Text>
      <Menu
        title={label}
        accessibilityLabel={label}
        actions={options.map((option) => ({
          id: option.id,
          title: option.name,
          state: option.id === value ? "on" : undefined,
          attributes: { disabled },
        }))}
        onPressAction={({ nativeEvent }) => {
          if (!disabled && options.some((option) => option.id === nativeEvent.event))
            onChange(nativeEvent.event);
        }}
      >
        <ControlPill
          label={options.find((option) => option.id === value)?.name ?? gt("Choose an option")}
          disabled={disabled || options.length === 0}
          variant="pill"
        />
      </Menu>
    </View>
  );
}

export function confirm(message: string, action: () => void) {
  Dialog.alert(m(msg("Remove connection?")), message, [
    { text: m(msg("Cancel")), style: "cancel" },
    { text: m(msg("Remove")), style: "destructive", onPress: action },
  ]);
}

export function ExternalLink({
  address,
  label,
  onFailure,
  disabled = false,
}: {
  address: string | null;
  label: string;
  onFailure: () => void;
  disabled?: boolean;
}) {
  const url = botConnectionUrl(address);
  return url ? (
    <Button
      label={label}
      tone="text"
      disabled={disabled}
      onPress={() => void Linking.openURL(url).catch(onFailure)}
    />
  ) : null;
}
