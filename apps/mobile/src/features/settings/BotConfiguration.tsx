import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import { permissionView, instructionView } from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../../components/ui/Button";
import { View } from "react-native";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { T, Var, useGT } from "gt-react-native";
export function BotConfiguration({
  environmentId,
  agentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  agentId: string;
  hostId: string;
}) {
  const gt = useGT();
  const canAdmin = useAtomValue(openbot.adminToHost.permissionAtom(environmentId));
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<ReturnType<typeof permissionView>>(null);
  const [instructions, setInstructions] = useState<ReturnType<typeof instructionView>>(null);
  const [text, setText] = useState("");
  const [revision, setRevision] = useState(0);
  const load = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const permissionResult = await admin({
      environmentId,
      input: { hostId, request: { operation: "agent.permissions.read", agentId } },
    });
    const instructionResult = await admin({
      environmentId,
      input: { hostId, request: { operation: "agent.instructions.read", agentId } },
    });
    if (permissionResult._tag === "Failure")
      setError(String(squashAtomCommandFailure(permissionResult)));
    else {
      const value = permissionView(permissionResult.value);
      setPermissions(value);
      if (value === null) setError(gt("This host returned unsupported permission settings."));
    }
    if (instructionResult._tag === "Failure")
      setError(String(squashAtomCommandFailure(instructionResult)));
    else {
      const value = instructionView(instructionResult.value);
      setInstructions(value);
      if (value === null) setError(gt("This host returned unsupported instructions."));
      else {
        setText(value.text);
        setRevision((value) => value + 1);
      }
    }
    setBusy(false);
  };
  const update = async (input: OpenbotAdminRequest) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await admin({ environmentId, input: { hostId, request: input } });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    else if (input.operation === "agent.permissions.update") {
      const value = permissionView(result.value);
      setPermissions(value);
      if (value === null) setError(gt("Reload settings before making another change."));
    } else if (input.operation === "agent.instructions.save") {
      const value = instructionView(result.value);
      setInstructions(value);
      if (value === null) setError(gt("Reload instructions before making another change."));
    }
    setBusy(false);
  };

  return (
    <View className="gap-3 rounded-xl bg-grouped-card p-3">
      <Text>
        <T>Permissions and instructions</T>
      </Text>
      <Button
        label={gt("Load settings")}
        size="compact"
        disabled={busy || !canAdmin}
        onPress={() => void load()}
      />
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
      {permissions && (
        <View className="gap-2">
          <Text>
            <T>
              Access:<Var> </Var>
              <Var>
                {permissions.access === "workspace"
                  ? gt("Workspace only")
                  : permissions.autoApprove
                    ? gt("Full access")
                    : gt("Ask first")}
              </Var>
            </T>
          </Text>
          {permissions.autoApproveLocked && (
            <Text>
              <T>Approval settings are locked by this host.</T>
            </Text>
          )}
          <View className="flex-row flex-wrap gap-2">
            {(["workspace", "ask", "full"] as const).map((level) => (
              <Button
                key={level}
                label={
                  level === "workspace"
                    ? gt("Workspace only")
                    : level === "ask"
                      ? gt("Ask first")
                      : gt("Full access")
                }
                size="compact"
                tone="secondary"
                disabled={busy || !canAdmin || permissions.autoApproveLocked}
                onPress={() =>
                  void update({
                    operation: "agent.permissions.update",
                    agentId,
                    ...(level === "workspace"
                      ? { access: "workspace" as const }
                      : { access: "full" as const, autoApprove: level === "full" }),
                  })
                }
              />
            ))}
          </View>
        </View>
      )}
      {instructions && (
        <View className="gap-2">
          <Text>
            <T>Instructions</T>
          </Text>
          <AppTextInput
            key={revision}
            accessibilityLabel={gt("Bot instructions")}
            defaultValue={text}
            onChangeText={setText}
            multiline
            textAlignVertical="top"
            maxLength={32000}
            editable={!busy && canAdmin}
            className="min-h-32 rounded-xl bg-grouped-card p-3"
          />
          <Button
            label={gt("Save instructions")}
            disabled={busy || !canAdmin || text === instructions.text}
            onPress={() =>
              void update({
                operation: "agent.instructions.save",
                agentId,
                text,
                expected: instructions.text,
              })
            }
          />
        </View>
      )}
    </View>
  );
}
