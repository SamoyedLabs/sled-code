import { useState } from "react";
import { Alert, View } from "react-native";
import {
  settingsAdvanced,
  type SettingsActions,
  type SettingControl,
} from "@t3tools/client-runtime/openbot/settings";
import { useBotSettings } from "./useBotSettings";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { useGT } from "gt-react-native";
export function BotSettingsAdvanced({
  agentId,
  capabilities,
  actions,
}: {
  agentId?: string | undefined;
  capabilities: readonly string[];
  actions: SettingsActions;
}) {
  const gt = useGT();
  const c = useBotSettings(actions);
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const activate = (control: SettingControl) => {
    const key = control.inputKey;
    if (key) {
      setDrafts((current) => ({ ...current, [key]: control.value ?? "" }));
      return;
    }
    const request = control.request;
    if (!request) return;
    const run = () => {
      void c.run(request.operation, request.parameters);
    };
    if (control.confirm)
      Alert.alert(control.label, gt("Apply this change on the selected host?"), [
        { text: gt("Cancel"), style: "cancel" },
        { text: gt("Confirm"), onPress: run },
      ]);
    else run();
  };
  return (
    <View className="gap-3">
      {settingsAdvanced(agentId, capabilities, c.results, drafts).map((section) => (
        <View key={section.id} className="gap-2 rounded border p-3">
          <Button
            label={section.title}
            onPress={() => setExpanded((value) => (value === section.id ? null : section.id))}
          />
          {expanded === section.id &&
            section.controls.map((control) => {
              const inputKey = control.inputKey;
              return control.kind === "text" ? (
                <Text key={control.id}>{control.label}</Text>
              ) : control.kind === "input" ? (
                <View key={control.id}>
                  <Text>{control.label}</Text>
                  <AppTextInput
                    accessibilityLabel={control.label}
                    value={control.value ?? ""}
                    onChangeText={(value) => {
                      if (inputKey) setDrafts((current) => ({ ...current, [inputKey]: value }));
                    }}
                  />
                </View>
              ) : (
                <Button
                  key={control.id}
                  label={control.label}
                  disabled={
                    c.busy ||
                    (!control.inputKey && (!control.request || !actions.can(control.request)))
                  }
                  onPress={() => activate(control)}
                />
              );
            })}
        </View>
      ))}
      {c.notice && <Text accessibilityLiveRegion="polite">{c.notice}</Text>}
    </View>
  );
}
