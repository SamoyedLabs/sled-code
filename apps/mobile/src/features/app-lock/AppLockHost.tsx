import { useEffect, useState } from "react";
import { Modal, TextInput, View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { AppText as Text } from "../../components/ui/AppText";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { Button } from "../../components/ui/Button";
import { SymbolView } from "../../components/ui/AppSymbol";
import {
  dismissMobileAppOwnerConfirmation,
  loadMobileAppLock,
  mobileAppUnlockKind,
  repairAppPinClock,
  unlockMobileAppWithDevice,
  unlockMobileAppWithPin,
  useMobileAppLock,
} from "./appLockRuntime";
import { nextAppPinAttempt } from "./appLockPolicy";

export function AppLockHost() {
  const state = useMobileAppLock();
  if (state.status === "ready" && !state.locked && !state.covered) return null;
  return (
    <Modal
      visible
      animationType="none"
      presentationStyle="fullScreen"
      onRequestClose={dismissMobileAppOwnerConfirmation}
    >
      <SafeAreaProvider>
        <SafeAreaView className="flex-1 items-center justify-center bg-background px-8">
          {state.status === "failed" ? (
            <View className="w-full max-w-80 items-center gap-4">
              <Text accessibilityRole="header" className="text-xl font-bold">
                Sled is locked
              </Text>
              <Text className="text-center text-foreground-muted">
                Unlock this device so Sled can read its App Lock settings.
              </Text>
              <Button label="Try again" onPress={() => void loadMobileAppLock()} />
            </View>
          ) : state.status === "loading" || !state.locked ? (
            <AppActivityIndicator />
          ) : (
            <AppLockControls />
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}

function AppLockControls() {
  const { config, confirming } = useMobileAppLock();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [device, setDevice] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const waitUntil = nextAppPinAttempt(config.failures, now);
  const blocked = waitUntil > now;
  const lastFailure = config.failures.last;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Reads the current native device authentication availability when the lock is presented.
  useEffect(() => {
    let present = true;
    void mobileAppUnlockKind().then((value) => {
      if (present) setDevice(value);
    });
    return () => {
      present = false;
    };
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Updates the visible cooldown until another PIN attempt is available.
  useEffect(() => {
    if (!blocked) return;
    const timer = setInterval(() => {
      const time = Date.now();
      if (time < lastFailure) void repairAppPinClock(time).catch(() => {});
      setNow(time);
    }, 1_000);
    return () => clearInterval(timer);
  }, [blocked, lastFailure]);
  const enterPin = async () => {
    if (busy || blocked || pin.length !== 4) return;
    setBusy(true);
    setFailure("");
    try {
      if (!(await unlockMobileAppWithPin(pin))) {
        setPin("");
        setNow(Date.now());
        setFailure("Incorrect PIN.");
      }
    } catch {
      setFailure("Sled could not read your PIN. Try again.");
    }
    setBusy(false);
  };
  const unlockDevice = async () => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      if (!(await unlockMobileAppWithDevice()))
        setFailure("Device authentication did not complete.");
    } catch {
      setFailure("Sled could not unlock. Try again.");
    }
    setBusy(false);
  };
  return (
    <View accessibilityViewIsModal className="w-full max-w-80 items-center gap-4">
      <SymbolView name="lock" size={36} />
      <Text accessibilityRole="header" className="text-2xl font-bold">
        {confirming ? "Confirm it’s you" : "Sled is locked"}
      </Text>
      {!!config.pin && (
        <>
          <TextInput
            accessibilityLabel="App Lock PIN"
            keyboardType="number-pad"
            secureTextEntry
            autoCorrect={false}
            autoCapitalize="none"
            maxLength={4}
            caretHidden={false}
            editable={!busy && !blocked}
            value={pin}
            onChangeText={(value) => setPin(value.replace(/[^0-9]/gu, "").slice(0, 4))}
            className="min-h-12 w-full rounded-xl border border-border bg-card px-4 text-center text-xl text-foreground"
          />
          <Button
            label="Unlock"
            onPress={() => void enterPin()}
            disabled={busy || blocked || pin.length !== 4}
          />
        </>
      )}
      {device && (config.useDevice || blocked) && (
        <Button label={`Use ${device}`} onPress={() => void unlockDevice()} disabled={busy} />
      )}
      {(blocked || failure) && (
        <Text accessibilityRole="alert" className="text-center text-foreground-muted">
          {blocked ? `Try again in ${Math.ceil((waitUntil - now) / 1_000)} seconds.` : failure}
        </Text>
      )}
      {confirming && <Button label="Cancel" onPress={dismissMobileAppOwnerConfirmation} />}
    </View>
  );
}
