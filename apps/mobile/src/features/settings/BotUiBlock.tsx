import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { openbot } from "../../state/openbot";
import type { EnvironmentId } from "@t3tools/contracts";
import { View } from "react-native";
import type { OpenbotConversationMessage, OpenbotConversationSnapshot } from "@t3tools/contracts";
import {
  blockAnswers,
  blockInitialValues,
  blockValuesAfterAttempt,
  normalizeConversationUiBlock,
  uiBlockActionIsPrivileged,
  type BlockCommand,
} from "@t3tools/client-runtime/openbot/rich-conversation";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  message: OpenbotConversationMessage;
  snapshot: typeof OpenbotConversationSnapshot.Type | null;
  taskId: string | null;
  disabled: boolean;
  respond: (command: BlockCommand) => Promise<boolean>;
};
export function BotUiBlock({
  environmentId,
  hostId,
  message,
  snapshot,
  taskId,
  disabled,
  respond,
}: Props) {
  const block = normalizeConversationUiBlock(message.uiBlock);
  const [values, setValues] = useState<Record<string, string | string[]>>(() =>
    blockInitialValues(message.uiBlock),
  );
  const [submitted, setSubmitted] = useState(false);
  if (!block)
    return message.uiBlock == null ? null : (
      <Text>Unsupported UI block. Readonly data is available in the uiBlock details.</Text>
    );
  if (!snapshot) return null;
  const { spec } = block;
  const prompt = message.questionPrompt;
  const requestId =
    prompt && typeof prompt === "object" && !Array.isArray(prompt) && "requestId" in prompt
      ? prompt.requestId
      : null;
  const command = (actionId: string): BlockCommand | null =>
    typeof requestId === "string" || typeof requestId === "number"
      ? {
          operation: "conversation.blockRespond",
          agentId: snapshot.agentId,
          taskId,
          threadId: snapshot.threadId,
          turnId: message.turnId ?? "",
          messageId: message.id,
          blockId: block.blockId,
          requestId,
          response: { actionId, ...(spec.type === "quick_replies" ? {} : { values }) },
        }
      : null;
  const send = async (action: string) => {
    const c = command(action);
    if (c && blockAnswers(snapshot, c)) {
      setSubmitted(true);
      const result = await settlePromise(() => respond(c));
      setValues((current) =>
        blockValuesAfterAttempt(
          message.uiBlock,
          current,
          result._tag === "Success" && result.value,
        ),
      );
      setSubmitted(false);
    }
  };
  const frozen = disabled || submitted || block.state.status !== "pending" || Boolean(block.vault);
  const update = (id: string, value: string | string[]) => setValues({ ...values, [id]: value });
  return (
    <View className="gap-2 rounded border border-border p-3">
      <Text>
        {spec.title ?? "Choose a reply"} · {block.state.status}
      </Text>
      {block.state.outcome && <Text>{block.state.outcome}</Text>}
      {spec.type === "confirm" && (
        <>
          {spec.preview && <Text>{spec.preview}</Text>}
          {spec.fields?.map((f) => (
            <View key={"select" in f ? f.select : f.label}>
              <Text>
                {f.label}
                {"value" in f ? `: ${f.value}` : ""}
              </Text>
              {"select" in f &&
                f.options.map((v) => (
                  <Button
                    key={v}
                    label={`${values[f.select] === v ? "Selected: " : ""}${v}`}
                    disabled={frozen}
                    onPress={() => update(f.select, v)}
                  />
                ))}
            </View>
          ))}
        </>
      )}
      {spec.type === "choice" &&
        spec.options.map((o) => (
          <Button
            key={o.id}
            disabled={frozen}
            label={`${Array.isArray(values.selected) && values.selected.includes(o.id) ? "Selected: " : ""}${o.label}${o.meta ? ` · ${o.meta}` : ""}`}
            onPress={() =>
              update(
                "selected",
                spec.multiple
                  ? Array.isArray(values.selected) && values.selected.includes(o.id)
                    ? values.selected.filter((v) => v !== o.id)
                    : [...(Array.isArray(values.selected) ? values.selected : []), o.id]
                  : [o.id],
              )
            }
          />
        ))}
      {spec.type === "form" &&
        spec.fields.map((f) => (
          <View key={f.id}>
            <Text>
              {f.label ?? f.id}
              {f.required ? " (required)" : ""}
            </Text>
            {"options" in f ? (
              f.options.map((v) => (
                <Button
                  key={v}
                  label={`${values[f.id] === v ? "Selected: " : ""}${v}`}
                  disabled={frozen}
                  onPress={() => update(f.id, v)}
                />
              ))
            ) : (
              <AppTextInput
                accessibilityLabel={f.label}
                editable={!frozen}
                multiline={f.kind === "textarea"}
                secureTextEntry={"secret" in f && f.secret}
                autoComplete="off"
                maxLength={8000}
                placeholder={f.kind === "date" ? "YYYY-MM-DD" : ""}
                value={String(values[f.id] ?? "")}
                onChangeText={(v) => update(f.id, v)}
              />
            )}
          </View>
        ))}
      {(spec.type === "confirm"
        ? spec.actions
        : spec.type === "quick_replies"
          ? spec.options
          : [{ id: "submit", label: spec.submit ?? "Submit" }]
      ).map((a) => {
        const c = command(a.id);
        return (
          <BlockAction
            key={a.id}
            environmentId={environmentId}
            hostId={hostId}
            command={c}
            label={a.label}
            disabled={
              frozen || uiBlockActionIsPrivileged(spec, a.id) || !c || !blockAnswers(snapshot, c)
            }
            onPress={() => void send(a.id)}
          />
        );
      })}
      <Text>
        Privileged actions require the original approval owner. Unknown or stale blocks cannot be
        answered here. Refresh after an uncertain answer; acceptance comes from the host.
      </Text>
    </View>
  );
}

function BlockAction({
  environmentId,
  hostId,
  command,
  disabled,
  label,
  onPress,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  command: BlockCommand | null;
  disabled: boolean;
  label: string;
  onPress: () => void;
}) {
  const permission = useAtomValue(
    openbot.writeToHost.permissionAtom(
      environmentId,
      command ? { hostId, request: command } : undefined,
    ),
  );
  return <Button label={label} disabled={disabled || !command || !permission} onPress={onPress} />;
}
