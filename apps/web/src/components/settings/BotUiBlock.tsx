import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import { openbot } from "../../state/openbot";
import type { EnvironmentId } from "@t3tools/contracts";
import type { OpenbotConversationMessage, OpenbotConversationSnapshot } from "@t3tools/contracts";
import {
  blockAnswers,
  blockInitialValues,
  blockValuesAfterAttempt,
  normalizeConversationUiBlock,
  uiBlockActionIsPrivileged,
  type BlockCommand,
} from "@t3tools/client-runtime/openbot/rich-conversation";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
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
      <p>Unsupported UI block. Readonly data is available in the uiBlock details.</p>
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
    <fieldset disabled={frozen} className="space-y-2 rounded border p-3">
      <legend>
        {spec.title ?? "Choose a reply"} · {block.state.status}
      </legend>
      {block.state.outcome && <p>{block.state.outcome}</p>}
      {spec.type === "confirm" && (
        <>
          {spec.preview && <p className="whitespace-pre-wrap">{spec.preview}</p>}
          {spec.fields?.map((f) => (
            <div key={"select" in f ? f.select : f.label}>
              {f.label}
              {"value" in f ? (
                `: ${f.value}`
              ) : (
                <select
                  aria-label={f.label}
                  value={String(values[f.select] ?? "")}
                  onChange={(e) => update(f.select, e.target.value)}
                >
                  <option value="">Choose…</option>
                  {f.options.map((v) => (
                    <option key={v}>{v}</option>
                  ))}
                </select>
              )}
            </div>
          ))}
        </>
      )}
      {spec.type === "choice" &&
        spec.options.map((o) => (
          <label key={o.id} className="block">
            <input
              type={spec.multiple ? "checkbox" : "radio"}
              name={`${message.id}-choice`}
              checked={Array.isArray(values.selected) && values.selected.includes(o.id)}
              onChange={() =>
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
            {o.label} {o.meta}
          </label>
        ))}
      {spec.type === "form" &&
        spec.fields.map((f) => (
          <label key={f.id} className="block">
            {f.label ?? f.id}
            {f.required ? " (required)" : ""}
            {"options" in f ? (
              <select
                aria-label={f.label ?? f.id}
                value={String(values[f.id] ?? "")}
                onChange={(e) => update(f.id, e.target.value)}
              >
                <option value="">Choose…</option>
                {f.options.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            ) : (
              <Input
                aria-label={f.label}
                required={f.required}
                type={f.kind === "date" ? "date" : "secret" in f && f.secret ? "password" : "text"}
                autoComplete="off"
                maxLength={8000}
                value={String(values[f.id] ?? "")}
                onChange={(e) => update(f.id, e.target.value)}
              />
            )}
          </label>
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
            disabled={
              frozen || uiBlockActionIsPrivileged(spec, a.id) || !c || !blockAnswers(snapshot, c)
            }
            onPress={() => void send(a.id)}
            label={a.label}
          />
        );
      })}
      <p className="text-xs">
        Privileged actions require the original approval owner. Unknown or stale blocks cannot be
        answered here. Refresh after an uncertain answer; no answer is shown as accepted before the
        host updates it.
      </p>
    </fieldset>
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
  return (
    <Button type="button" disabled={disabled || !command || !permission} onClick={onPress}>
      {label}
    </Button>
  );
}
