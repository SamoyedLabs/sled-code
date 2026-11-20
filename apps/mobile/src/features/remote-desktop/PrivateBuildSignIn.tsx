import { useGT } from "gt-react-native";
import { useHostedAuth } from "@clerk/expo/hosted-auth";
import * as Linking from "expo-linking";
import { useRef, useState } from "react";
import { View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";

export function PrivateBuildSignIn() {
  const gt = useGT();
  const { startHostedAuth } = useHostedAuth();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await startHostedAuth({ redirectUrl: Linking.createURL("callback"), mode: "sign-in" });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : gt("Sign-in could not complete. Try again."),
      );
    }
    pending.current = false;
    setBusy(false);
  }

  return (
    <View className="flex-1 justify-center gap-5 px-6">
      <AppText className="text-2xl font-t3-bold">{gt("Sign in to Sled")}</AppText>
      <AppText>{gt("Continue securely in your browser to connect your development Mac.")}</AppText>
      <Button label={gt("Sign in")} tone="primary" loading={busy} onPress={() => void signIn()} />
      {error ? <AppText accessibilityRole="alert">{error}</AppText> : null}
    </View>
  );
}
