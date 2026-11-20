/* oxlint-disable shadcn/no-unknown-classes -- Original diagram creation card selectors come from diagrams.css. */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type CSSProperties,
} from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { SourceCreateAgent } from "../../SourceCreateAgent";
import { BotAvatar } from "../../avatar/BotAvatar";
import { SourceButton } from "../settings/SettingsParts";
import { BotModelPicker } from "../../BotModelPicker";
import {
  createFirstAgentDraft,
  selectCreationModel,
  updateAgentDraft,
} from "../create-agent/agent-draft";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { observeResize } from "../../../../lib/observeResize";
import type { FirstAgentSetup } from "../create-agent/FirstAgentSetup";
import type { DiagramPoint } from "./diagram-model";
type Form = ComponentProps<typeof FirstAgentSetup>;
export function DiagramNewAgentCard({
  environmentId,
  hostId,
  at,
  onCreate,
  onCancel,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  at: DiagramPoint;
  onCreate: (id: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [initialDraft] = useState(() => ({ ...createFirstAgentDraft(), name: "" }));
  return (
    <SourceCreateAgent
      environmentId={environmentId}
      hostId={hostId}
      initialDraft={initialDraft}
      onCreated={onCreate}
      onCancel={onCancel}
      render={(form) => <Card form={form} at={at} />}
    />
  );
}
function Card({ form, at }: { form: Form; at: DiagramPoint }) {
  const element = useRef<HTMLFormElement>(null),
    name = useRef<HTMLInputElement>(null),
    [height, setHeight] = useState<number | null>(null);
  const busy = form.busy || form.blocked;
  const dismiss = useStableCallback((event: globalThis.PointerEvent) => {
    const target = event.target;
    if (
      form.busy ||
      !(target instanceof Element) ||
      element.current?.contains(target) ||
      target.closest(".provider-model-popover,[data-popper-positioner],[data-openbot-positioner]")
    )
      return;
    form.onCancel?.();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Own source card initial focus and outside dismissal without refocusing fields during text or model edits.
  useEffect(() => {
    name.current?.focus();
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [dismiss]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Clamp the source floating form to its actual height, including errors and model selection.
  useLayoutEffect(() => {
    const v = element.current;
    if (!v) return;
    return observeResize(v, () => setHeight(v.offsetHeight));
  }, []);
  const draft = form.value,
    data = form.providerData,
    selected = data?.modelOptions.find(
      (m) => m.provider === draft.provider && m.id === draft.model,
    );
  const effort = draft.reasoningEffort ?? selected?.defaultReasoningEffort;
  return (
    <form
      ref={element}
      className="diagram-new-agent"
      aria-label="New agent"
      data-diagram-overlay=""
      style={
        {
          "--diagram-new-agent-x": `${at.x}px`,
          "--diagram-new-agent-y": `${at.y}px`,
          ...(height ? { "--diagram-new-agent-height": `${height}px` } : {}),
        } as CSSProperties
      }
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy) void form.onSubmit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !form.busy) {
          e.preventDefault();
          e.stopPropagation();
          form.onCancel?.();
        }
      }}
    >
      <header className="diagram-new-agent-header">
        <BotAvatar seed={draft.avatarSeed} hue={draft.avatarHue} size={28} />
        <span>New agent</span>
      </header>
      <input
        ref={name}
        className="ui-input"
        aria-label="Agent name"
        placeholder="Name"
        maxLength={120}
        value={draft.name}
        disabled={busy}
        onChange={(e) => form.onChange(updateAgentDraft(draft, { name: e.target.value }))}
      />
      <input
        className="ui-input"
        aria-label="What the agent does"
        placeholder="What should this agent do?"
        value={draft.purpose}
        disabled={busy}
        aria-invalid={draft.purpose.length > 2000}
        onChange={(e) => form.onChange(updateAgentDraft(draft, { purpose: e.target.value }))}
      />
      {draft.purpose.length > 1800 && (
        <p className="diagram-inspector-muted">{draft.purpose.length}/2000 characters</p>
      )}
      {form.modelSupported && data?.status && (
        <BotModelPicker
          variant="field"
          ariaLabel="Agent model"
          provider={draft.provider}
          value={draft.model}
          modelOptions={data.modelOptions}
          agentStatus={data.status}
          runtimeStatuses={data.runtimeStatuses}
          customProviders={data.customProviders}
          customAgents={data.customAgents}
          disabled={busy}
          {...(effort ? { reasoningEffort: effort } : {})}
          onReasoningEffortChange={(reasoningEffort) =>
            form.onChange(updateAgentDraft(draft, { reasoningEffort }))
          }
          onChange={(model, provider, _accountId, effort) =>
            form.onChange(selectCreationModel(draft, model, provider, data.modelOptions, effort))
          }
        />
      )}
      {form.error && <p role="alert">{form.error}</p>}
      <div className="diagram-new-agent-actions">
        <SourceButton variant="ghost" size="xs" disabled={form.busy} onClick={form.onCancel}>
          Cancel
        </SourceButton>
        {form.onOpenCreated ? (
          <SourceButton size="xs" disabled={form.busy} onClick={() => void form.onOpenCreated?.()}>
            Place created agent
          </SourceButton>
        ) : (
          <SourceButton
            type="submit"
            size="xs"
            disabled={busy || !form.canCreate || !draft.name.trim() || draft.purpose.length > 2000}
          >
            {form.busy ? "Creating…" : "Create"}
          </SourceButton>
        )}
      </div>
    </form>
  );
}
