import { useRef, useState } from "react";
import { View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { botModelVisibility } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ThemedSwitch } from "../../components/ui/ThemedSwitch";

export function BotModelVisibility({
  environmentId,
  hostId,
  provider,
  onChange,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  provider: string;
  onChange: () => void;
}) {
  const allowed = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "provider.modelVisibility.read", provider },
    }),
  );
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<ReturnType<typeof botModelVisibility>>(null);
  const [draft, setDraft] = useState<readonly string[] | null>(null);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const selected = draft ?? settings?.shown ?? [];
  const filtered =
    settings?.models.filter((model) =>
      `${model.id} ${model.name}`.toLowerCase().includes(search.trim().toLowerCase()),
    ) ?? [];
  const run = async (shown?: readonly string[] | null) => {
    if (lock.current || !allowed) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const result = await admin({
      environmentId,
      input: {
        hostId,
        request:
          shown === undefined
            ? { operation: "provider.modelVisibility.read", provider }
            : { operation: "provider.modelVisibility.update", provider, shown },
      },
    });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else {
      const value = botModelVisibility(result.value, provider);
      if (!value) setError("This engine returned unsupported model visibility settings.");
      else {
        setSettings(value);
        setDraft(null);
        if (shown !== undefined) onChange();
      }
    }
    setBusy(false);
    lock.current = false;
  };
  return (
    <View className="gap-3">
      <Text>Models shown in pickers</Text>
      <Button
        label="Load model visibility"
        tone="secondary"
        size="compact"
        disabled={!allowed || busy}
        onPress={() => void run()}
      />
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
      {settings && (
        <>
          <Text className="text-foreground-muted">
            {selected.length} selected · {settings.models.length} available. This changes this bot
            host's model pickers.
          </Text>
          <AppTextInput
            accessibilityLabel="Filter bot models"
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setLimit(50);
            }}
            placeholder="Filter by name or model ID"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {filtered.slice(0, limit).map((model) => (
            <View key={model.id} className="flex-row items-center gap-3">
              <View className="min-w-0 flex-1">
                <Text>{model.name}</Text>
                <Text selectable textRole="footnote" className="text-foreground-muted">
                  {model.id}
                </Text>
              </View>
              <ThemedSwitch
                accessibilityLabel={`Show ${model.name}`}
                value={selected.includes(model.id)}
                disabled={!allowed || busy}
                onValueChange={(checked) =>
                  setDraft(
                    checked ? [...selected, model.id] : selected.filter((id) => id !== model.id),
                  )
                }
              />
            </View>
          ))}
          {filtered.length === 0 && <Text className="text-foreground-muted">No models match.</Text>}
          {filtered.length > limit && (
            <Button
              label="Show more models"
              tone="secondary"
              size="compact"
              onPress={() => setLimit(limit + 50)}
            />
          )}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Save model visibility"
              disabled={!allowed || busy || draft === null}
              onPress={() => void run(selected)}
            />
            <Button
              label="Restore host defaults"
              tone="secondary"
              disabled={!allowed || busy || !settings.changed}
              onPress={() => void run(null)}
            />
            {draft !== null && (
              <Button
                label="Discard selection"
                tone="secondary"
                disabled={busy}
                onPress={() => setDraft(null)}
              />
            )}
          </View>
        </>
      )}
    </View>
  );
}
