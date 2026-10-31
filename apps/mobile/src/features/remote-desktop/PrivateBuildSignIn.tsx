import { useHostedAuth } from "@clerk/expo/hosted-auth";
import { useRef, useState } from "react";
import { View } from "react-native";
import { AppText } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";

export function PrivateBuildSignIn() {
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
      // The private bundle ID is not registered with the production Clerk instance.
      await startHostedAuth({ redirectUrl: "com.t3tools.t3code://callback", mode: "sign-in" });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign-in could not complete. Try again.");
    }
    pending.current = false;
    setBusy(false);
  }

  return (
    <View className="flex-1 justify-center gap-5 px-6">
      <AppText className="text-2xl font-t3-bold">Sign in to Sled</AppText>
      <AppText>Continue securely in your browser to connect your development Mac.</AppText>
      <Button label="Sign in" tone="primary" loading={busy} onPress={() => void signIn()} />
      {error ? <AppText accessibilityRole="alert">{error}</AppText> : null}
    </View>
  );
}
