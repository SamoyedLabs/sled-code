import { useEffect, useState } from "react";
import { TextInput, View, Pressable } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";
import {
  confirmMobileAppOwner,
  confirmWithMobileDevice,
  mobileAppUnlockKind,
  saveMobileAppLock,
  setMobileAppPin,
  useMobileAppLock,
} from "../app-lock/appLockRuntime";
import { APP_LOCK_DELAYS, type AppLockDelay } from "../app-lock/appLockPolicy";
import { SettingsScreen } from "./components/SettingsScreen";
import { SettingsSection } from "./components/SettingsSection";
import * as Dialog from "../../components/ui/Dialog";
import { T, useGT } from "gt-react-native";

const delayNames: Record<AppLockDelay, string> = {
  0: "Immediately",
  60_000: "After 1 minute",
  300_000: "After 5 minutes",
  900_000: "After 15 minutes",
  3_600_000: "After 1 hour",
};

function LockToggle({
  label,
  checked,
  disabled,
  onPress,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      <ListRowLayout
        label={label}
        accessory={
          <View pointerEvents="none" accessibilityElementsHidden>
            <ThemedSwitch value={checked} />
          </View>
        }
      />
    </Pressable>
  );
}

export function SettingsAppLockRouteScreen() {
  const gt = useGT();
  const { config, status } = useMobileAppLock();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [edit, setEdit] = useState(false);
  const [device, setDevice] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reads the native authentication method for the Settings row.
  useEffect(() => {
    let active = true;
    void mobileAppUnlockKind().then((next) => {
      if (active) setDevice(next);
    });
    return () => {
      active = false;
    };
  }, []);
  const act = async (change: () => void | Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      if (await confirmMobileAppOwner()) await change();
    } catch {
      setFailure("Could not update App Lock.");
    }
    setBusy(false);
  };
  const disabled = busy || status !== "ready";
  return (
    <SettingsScreen title={gt("App Lock")}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-5 px-5 py-4"
      >
        {failure && (
          <Text className="text-destructive" accessibilityRole="alert">
            {failure}
          </Text>
        )}
        <SettingsSection title={gt("Unlock Sled")}>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={() => void act(() => setEdit(true))}
          >
            <ListRowLayout label={config.pin ? gt("Change PIN") : gt("Set a PIN")} />
          </Pressable>
          {!!config.pin && (
            <Pressable
              accessibilityRole="button"
              disabled={disabled}
              onPress={() =>
                void act(() =>
                  Dialog.confirm({
                    title: gt("Remove PIN?"),
                    confirmText: gt("Remove PIN"),
                    destructive: true,
                    onConfirm: () => void act(() => setMobileAppPin(null)),
                  }),
                )
              }
            >
              <ListRowLayout label={gt("Remove PIN")} />
            </Pressable>
          )}
          <LockToggle
            label={device ? gt("Unlock with {device}", { device }) : gt("Device authentication")}
            checked={config.useDevice}
            disabled={disabled || (!device && !config.useDevice)}
            onPress={() =>
              void act(async () => {
                if (
                  config.useDevice ||
                  (await confirmWithMobileDevice("Allow device authentication to unlock Sled"))
                )
                  await saveMobileAppLock({ useDevice: !config.useDevice });
              })
            }
          />
        </SettingsSection>
        {(config.pin || config.useDevice) && (
          <SettingsSection title={gt("Automatic lock")}>
            <Menu
              actions={APP_LOCK_DELAYS.map((delay) => ({
                id: String(delay),
                title: delayNames[delay],
                state: config.delay === delay ? "on" : "off",
              }))}
              onPressAction={({ nativeEvent }) => {
                const delay = APP_LOCK_DELAYS.find((value) => String(value) === nativeEvent.event);
                if (delay !== undefined) void act(() => saveMobileAppLock({ delay }));
              }}
            >
              <ListRowLayout
                label={gt("Lock after leaving")}
                description={delayNames[config.delay]}
              />
            </Menu>
            <LockToggle
              label={gt("Lock when the phone locks")}
              checked={config.lockWithPhone}
              disabled={disabled}
              onPress={() =>
                void act(() => saveMobileAppLock({ lockWithPhone: !config.lockWithPhone }))
              }
            />
          </SettingsSection>
        )}
      </ScreenScrollView>
      {edit && <AppPinSheet onClose={() => setEdit(false)} />}
    </SettingsScreen>
  );
}

function AppPinSheet({ onClose }: { onClose: () => void }) {
  const gt = useGT();
  const [pin, setPin] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const submit = async () => {
    if (busy || pin.length !== 4 || repeat.length !== 4) return;
    if (pin !== repeat) {
      setFailure("The PINs do not match.");
      return;
    }
    setBusy(true);
    try {
      await setMobileAppPin(pin);
      onClose();
    } catch {
      setFailure("Could not save the PIN.");
    }
    setBusy(false);
  };
  const inputStyle = "min-h-12 rounded-xl border border-border bg-card px-4 text-foreground";
  return (
    <Sheet title={gt("App Lock PIN")} onClose={onClose}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 py-4"
      >
        <Text className="text-foreground-muted">
          <T>Choose four digits and enter them again to confirm.</T>
        </Text>
        <TextInput
          accessibilityLabel={gt("New PIN")}
          placeholder={gt("New PIN")}
          className={inputStyle}
          value={pin}
          onChangeText={(value) => setPin(value.replace(/[^0-9]/gu, ""))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
        />
        <TextInput
          accessibilityLabel={gt("Confirm PIN")}
          placeholder={gt("Confirm PIN")}
          className={inputStyle}
          value={repeat}
          onChangeText={(value) => setRepeat(value.replace(/[^0-9]/gu, ""))}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={4}
        />
        {failure && (
          <Text accessibilityRole="alert" className="text-destructive">
            {failure}
          </Text>
        )}
        <Button
          label={gt("Save PIN")}
          onPress={() => void submit()}
          disabled={busy || pin.length !== 4 || repeat.length !== 4}
        />
      </ScreenScrollView>
    </Sheet>
  );
}
