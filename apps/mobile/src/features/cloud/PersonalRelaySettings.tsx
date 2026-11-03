import { useAuth } from "@clerk/expo";
import { reloadAppAsync } from "expo";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { validatePersonalRelay } from "@t3tools/shared/sledConnect";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { removeCloudEnvironments } from "./cloud-drafts";
import { appAtomRegistry } from "../../state/atom-registry";
import { resolveCloudPublicConfig } from "./publicConfig";
import { savePersonalRelayUrl } from "./personalRelay";

export function PersonalRelaySettings() {
  const { userId } = useAuth();
  const config = resolveCloudPublicConfig();
  const [address, setAddress] = useState(config.relay.url ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const save = async () => {
    setError(null);
    setPending(true);
    if (!config.clerk.publishableKey) {
      setError("Sled sign-in is not configured in this build.");
      setPending(false);
      return;
    }
    const accountId = userId ?? null;
    try {
      const url = await validatePersonalRelay(address, config.clerk.publishableKey);
      if (url !== config.relay.url) {
        const result = await runAtomCommand(appAtomRegistry, removeCloudEnvironments, accountId, {
          reportFailure: false,
        });
        if (result._tag !== "Success") {
          setError("Could not disconnect the previous relay. Try again.");
          setPending(false);
          return;
        }
      }
      savePersonalRelayUrl(url);
      await reloadAppAsync();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the relay.");
      setPending(false);
    }
  };
  return (
    <View className="gap-3 px-6 py-4">
      <Text className="text-base text-clerk-foreground">Your Sled Connect relay</Text>
      <TextInput
        accessibilityLabel="Sled Connect relay address"
        value={address}
        onChangeText={setAddress}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        placeholder="https://connect.example.com"
        className="rounded-lg border border-clerk-border px-3 py-3 text-base text-clerk-foreground"
      />
      {userId ? (
        <Text selectable className="text-sm text-clerk-foreground-muted">
          Your Sled user ID: {userId}
        </Text>
      ) : null}
      <Text className="text-sm text-clerk-foreground-muted">
        Changing relays reconnects this app. Background push notifications are not available yet.
      </Text>
      {error ? (
        <Text accessibilityRole="alert" className="text-sm text-destructive">
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: pending || !address.trim() }}
        disabled={pending || !address.trim()}
        onPress={() => void save()}
        className="py-3"
      >
        <Text className="text-base font-semibold text-clerk-foreground">
          {pending ? "Checking relay…" : "Save and reconnect"}
        </Text>
      </Pressable>
    </View>
  );
}
