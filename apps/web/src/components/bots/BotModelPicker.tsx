import { useMemo, useState } from "react";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { ComposerEffortColumn, describeComposerEffort } from "../chat/ComposerModelEffort";
import type { TraitsSelectionInput } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { botModelPickerCatalog } from "./botModelPickerCatalog";
import type { OpenbotProviderModelPickerProps } from "./upstream/provider/ProviderModelPicker";
import { isReasoningEffort } from "./upstream/provider/types";

/** Uses the actual Threads picker and effort column; host writes retain their bot identities. */
export function BotModelPicker(props: OpenbotProviderModelPickerProps & { scope?: string }) {
  const [open, setOpen] = useState(false);
  // oxlint-disable-next-line t3code/no-manual-memo -- Stable entries prevent the shared picker from resetting provider focus while the composer draft rerenders.
  const catalog = useMemo(
    () =>
      botModelPickerCatalog({
        scope: props.scope ?? "draft",
        status: props.agentStatus,
        models: props.modelOptions,
        runtimes: props.runtimeStatuses,
        accountChoice: props.accountChoice,
      }),
    [
      props.scope,
      props.agentStatus,
      props.modelOptions,
      props.runtimeStatuses,
      props.accountChoice,
    ],
  );
  const active = catalog.entries.find((entry) => {
    const target = catalog.destinations.get(entry.instanceId);
    return (
      target?.provider === props.provider && target.accountId === (props.providerAccountId ?? null)
    );
  });
  if (!active) return <span className="text-xs text-muted-foreground">Model unavailable</span>;
  const traits: TraitsSelectionInput = {
    provider: active.driverKind,
    instanceId: active.instanceId,
    models: active.models,
    model: props.value,
    planModeEnabled: false,
    allowPromptInjectedEffort: false,
    modelOptions: props.reasoningEffort
      ? [{ id: "reasoningEffort", value: props.reasoningEffort }]
      : [],
    onModelOptionsChange: (options) => {
      if (props.disabled) return;
      const effort = options?.find((option) => option.id === "reasoningEffort")?.value;
      if (isReasoningEffort(effort)) props.onReasoningEffortChange?.(effort);
    },
  };
  const effort = describeComposerEffort(traits, "label", "sm");
  return (
    <ProviderModelPicker
      environmentId={null}
      activeInstanceId={active.instanceId}
      model={props.value}
      lockedProvider={null}
      instanceEntries={catalog.entries}
      modelOptionsByInstance={catalog.options}
      isComposerOwned
      {...(props.variant === "field"
        ? { triggerClassName: "w-full max-w-none justify-start" }
        : {})}
      disabled={props.disabled ?? false}
      open={open}
      onOpenChange={setOpen}
      triggerAriaLabel={props.ariaLabel ?? "Choose bot model"}
      triggerSuffix={effort.suffix}
      triggerDetail={effort.detail}
      effortColumn={<ComposerEffortColumn traits={traits} />}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          {props.onManageProviders ? (
            <Button
              size="xs"
              variant="ghost"
              onClick={(event) => {
                setOpen(false);
                props.onManageProviders?.(event.currentTarget);
              }}
            >
              Models & accounts
            </Button>
          ) : (
            <span />
          )}
          {props.onFastModeChange ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Fast
              <Switch
                checked={props.fastMode ?? false}
                disabled={props.disabled ?? false}
                onCheckedChange={props.onFastModeChange}
              />
            </label>
          ) : null}
        </div>
      }
      onOpenProviderSetup={() =>
        props.onManageProviders?.(
          document.activeElement instanceof HTMLElement ? document.activeElement : document.body,
        )
      }
      onInstanceModelChange={(instanceId, model) => {
        if (props.disabled) return;
        const entry = catalog.entries.find((item) => item.instanceId === instanceId);
        const target = catalog.destinations.get(instanceId);
        const option = props.modelOptions.find(
          (item) => item.provider === target?.provider && item.id === model,
        );
        if (!entry || entry.status !== "ready" || !entry.enabled || !target || !option) return;
        const effort =
          props.reasoningEffort && option.supportedReasoningEfforts.includes(props.reasoningEffort)
            ? props.reasoningEffort
            : option.defaultReasoningEffort;
        props.onChange(
          model,
          target.provider,
          props.accountChoice ? target.accountId : undefined,
          effort,
        );
      }}
    />
  );
}
