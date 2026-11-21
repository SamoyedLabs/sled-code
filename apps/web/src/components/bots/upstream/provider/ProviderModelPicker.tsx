/* oxlint-disable shadcn/no-unknown-classes -- Exact scoped OpenBot source selectors. */
import { Popover } from "@base-ui/react/popover";
import { Tabs } from "@base-ui/react/tabs";
import { SourceSwitch } from "./SourceSwitch";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CheckIcon, ChevronDownIcon, PlusIcon, SlidersHorizontalIcon, ZapIcon } from "lucide-react";
import { renderClosingPositioner } from "~/components/ui/closing-positioner";
import { observeResize } from "~/lib/observeResize";
import { menuMotionRef } from "../openbotMenuMotion";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../OpenbotTooltip";
import { ProviderLogo } from "./ProviderLogo";
import { SourceSelect } from "./SourceSelect";
import { currentText } from "./text";
import {
  agentProviderName,
  agentProviderCliName,
  customAgentIdOfModel,
  DEFAULT_PROVIDER_ACCOUNT_ID,
  defaultProviderModel,
  isAgentProvider,
  PICKER_PROVIDERS,
  type AgentProviderId,
} from "./identity";
import {
  customProviderIds,
  groupPickerModels,
  isCustomModel,
  isCustomEndpointModel,
  pickerModels,
  providerAvailability,
  providerTurnedOff,
  providerUsable,
  type PickerModel,
} from "./provider-model-options";
import { providerAccountName } from "./provider-accounts";
import { spentUsageWindow } from "./plan-limits";
import { formatUsageReset, usageWindowLabel } from "./account-usage-view";
import {
  isReasoningEffort,
  type AccountUsage,
  type AccountUsageWindow,
  type AgentStatus,
  type AgentReasoningEffort,
  type ClientAgentModelOption,
  type CustomProviderSummary,
  type CustomAgentSummary,
  type ProviderRuntimeStatus,
} from "./types";
import "./ProviderModelPicker.css";
import "./SourceControls.css";
import { useGT } from "gt-react";

export interface OpenbotProviderModelPickerProps {
  provider: string;
  value: string;
  modelOptions: ClientAgentModelOption[];
  agentStatus: AgentStatus;
  variant?: "pill" | "field";
  ariaLabel?: string;
  label?: string;
  icon?: ReactNode;
  reasoningEffort?: AgentReasoningEffort;
  onReasoningEffortChange?: (effort: AgentReasoningEffort) => void;
  fastMode?: boolean;
  onFastModeChange?: (fast: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
  runtimeStatuses?: Partial<Record<AgentProviderId, ProviderRuntimeStatus>>;
  onDownloadProvider?: (provider: AgentProviderId) => void | Promise<void>;
  onCancelProviderDownload?: (provider: AgentProviderId) => void | Promise<void>;
  onConnectProvider?: (provider: AgentProviderId) => void | Promise<void>;
  canConnectProvider?: (provider: AgentProviderId) => boolean;
  customProviders?: readonly CustomProviderSummary[];
  customAgents?: readonly CustomAgentSummary[];
  onAddCustomProvider?: (trigger: HTMLElement) => void;
  onManageProviders?: (trigger: HTMLElement) => void;
  accountChoice?: boolean;
  providerAccountId?: string | null;
  accountUsage?: AccountUsage | null;
  foreignProvider?: string;
  onChange: (
    model: string,
    provider: AgentProviderId,
    accountId?: string | null,
    reasoningEffort?: AgentReasoningEffort,
  ) => void;
}
type RailId = AgentProviderId | "custom";
interface Entry {
  key: string;
  rail: RailId;
  accountId: string | null;
  number?: number;
  name: string;
}
type QueuedEffort =
  | { key: string; effort: AgentReasoningEffort }
  | { key: string; variant: string };
const text = currentText();
const { t } = text;
export function reasoningLabel(effort: AgentReasoningEffort) {
  return t(`provider.effort.${effort}`);
}
function modelName(name: string | undefined, fallback: string) {
  return (name ?? fallback).replace(/^[\s:–—-]+/, "") || fallback;
}
export function fixedModelSettings(model: ClientAgentModelOption | undefined) {
  if (model?.provider !== "cursor") return null;
  const params = /\[([^\]]*)\]$/u.exec(model.id)?.[1];
  if (!params) return null;
  const settings: { context: string | null; effort: AgentReasoningEffort | null; fast: boolean } = {
    context: null,
    effort: null,
    fast: false,
  };
  for (const pair of params.split(",")) {
    const [key, value = ""] = pair.split("=");
    if (key === "context" && /^\d+(?:\.\d+)?[km]$/iu.test(value)) settings.context = value;
    else if (
      (key === "reasoning" || key === "effort") &&
      model.reasoningEffortConfigurable === false &&
      isReasoningEffort(value)
    )
      settings.effort = value;
    else if (key === "fast") settings.fast = value === "true";
  }
  return settings;
}
function railName(rail: RailId) {
  return rail === "custom" ? t("provider.picker.custom") : agentProviderName(rail);
}
function Mark({ rail, large = false }: { rail: string; large?: boolean }) {
  const className = `provider-model-mark${large ? " provider-model-mark-large" : ""}`;
  return rail === "custom" ? (
    <SlidersHorizontalIcon className={className} />
  ) : (
    <ProviderLogo provider={rail} className={className} />
  );
}
function SwapLabel({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const previous = useRef(value);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Source SwapLabel animates the outgoing DOM copy and the incoming label on a real label change.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || previous.current === value) return;
    const old = previous.current;
    previous.current = value;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const copy = document.createElement("span");
    copy.className = "ui-swap-leaving";
    copy.textContent = old;
    copy.setAttribute("aria-hidden", "true");
    node.parentElement?.append(copy);
    const leave = copy.animate(
      [
        { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
        { opacity: 0, transform: "translateY(-6px)", filter: "blur(6px)" },
      ],
      { duration: 180, easing: "ease", fill: "forwards" },
    );
    const enter = node.animate(
      [
        { opacity: 0, transform: "translateY(6px)", filter: "blur(6px)" },
        { opacity: 1, transform: "translateY(0)", filter: "blur(0)" },
      ],
      { duration: 320, easing: "cubic-bezier(0.33, 1, 0.68, 1)" },
    );
    void leave.finished.then(
      () => copy.remove(),
      () => copy.remove(),
    );
    return () => {
      leave.cancel();
      enter.cancel();
      copy.remove();
    };
  }, [value]);
  return (
    <span className="provider-model-trigger-name ui-swap">
      <span ref={ref}>{value}</span>
    </span>
  );
}

/** React translation of ProviderModelPicker.tsx; the host owns catalog and selection state. */
export function OpenbotProviderModelPicker(props: OpenbotProviderModelPickerProps) {
  const gt = useGT();
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [openedKeys, setOpenedKeys] = useState<string[]>([]);
  const [queued, setQueued] = useState<QueuedEffort>();
  const [now, setNow] = useState(Date.now);
  const ids = customProviderIds(props.customProviders ?? []);
  const foreign =
    props.foreignProvider ?? (!isAgentProvider(props.provider) ? props.provider : undefined);
  const activeRail: RailId =
    props.provider === "acp" || isCustomEndpointModel(props.provider, props.value, ids)
      ? "custom"
      : isAgentProvider(props.provider)
        ? props.provider
        : "custom";
  const accountsOf = (rail: RailId) => {
    const accounts =
      props.accountChoice && rail !== "custom"
        ? (props.agentStatus.providers?.find((provider) => provider.id === rail)?.accounts ?? [])
        : [];
    return accounts.length > 1 ? accounts : [];
  };
  const currentAccount =
    props.providerAccountId &&
    props.providerAccountId !== DEFAULT_PROVIDER_ACCOUNT_ID &&
    accountsOf(activeRail).some((account) => account.id === props.providerAccountId)
      ? props.providerAccountId
      : null;
  const activeKey =
    currentAccount && activeRail !== "custom" ? `${activeRail}:${currentAccount}` : activeRail;
  const [selectedRail, setSelectedRail] = useState<string>(activeKey);
  const optionsOf = (rail: RailId) =>
    props.modelOptions.filter((model) =>
      rail === "custom"
        ? isCustomModel(model, ids)
        : model.provider === rail && !isCustomModel(model, ids),
    );
  const customAgentCount = props.agentStatus.providers?.some((provider) => provider.id === "acp")
    ? (props.customAgents?.length ??
      new Set(
        props.modelOptions
          .filter((model) => model.provider === "acp")
          .map((model) => customAgentIdOfModel(model.id) ?? model.id),
      ).size)
    : 0;
  const statusOf = (entry: Entry) => {
    const endpointHarnesses = [...new Set(ids.values())];
    const harness =
      endpointHarnesses.find(
        (provider) =>
          providerAvailability(props.agentStatus, props.modelOptions, provider, t).state ===
          "available",
      ) ??
      endpointHarnesses[0] ??
      "opencode";
    let status = providerAvailability(
      props.agentStatus,
      props.modelOptions,
      entry.rail === "custom" ? harness : entry.rail,
      t,
    );
    if (entry.rail === "custom" && customAgentCount) {
      const agents = providerAvailability(props.agentStatus, props.modelOptions, "acp", t);
      if (
        !props.customProviders?.length ||
        (status.state !== "available" && agents.state === "available")
      )
        status = agents;
    }
    const account = accountsOf(entry.rail).find((account) => account.id === entry.accountId);
    if (account && account.id !== DEFAULT_PROVIDER_ACCOUNT_ID && account.state !== "connected")
      return {
        ...status,
        connectionState: undefined,
        state:
          account.state === "checking" || account.state === "connecting"
            ? "checking"
            : "sign-in-required",
        message: account.message,
      };
    return status;
  };
  const entries: Entry[] = [...PICKER_PROVIDERS, "custom" as const]
    .filter((rail) => rail === "custom" || !providerTurnedOff(props.agentStatus, rail))
    .flatMap((rail): Entry[] => {
      const accounts = accountsOf(rail);
      return accounts.length
        ? accounts.map((account, index) => ({
            key: account.id === DEFAULT_PROVIDER_ACCOUNT_ID ? rail : `${rail}:${account.id}`,
            rail,
            accountId: account.id === DEFAULT_PROVIDER_ACCOUNT_ID ? null : account.id,
            number: index + 1,
            name: `${railName(rail)} · ${providerAccountName(t, accounts, account.id)}`,
          }))
        : [{ key: rail, rail, accountId: null, name: railName(rail) }];
    });
  const usable = (entry: Entry) =>
    entry.key === activeKey ||
    (entry.rail === "custom" &&
    !props.customProviders?.length &&
    !customAgentCount &&
    !optionsOf("custom").length
      ? false
      : providerUsable(statusOf(entry), props.runtimeStatuses?.[statusOf(entry).id]));
  const available = entries.filter(
    (entry) => usable(entry) || (open && openedKeys.includes(entry.key)),
  );
  const visible = available.length ? available : entries;
  const railKey = visible.some((entry) => entry.key === selectedRail)
    ? selectedRail
    : (visible[0]?.key ?? "custom");
  const selectedOption = props.modelOptions.find(
    (model) => model.provider === props.provider && model.id === props.value,
  );
  const fixed = fixedModelSettings(selectedOption);
  const selectedVariants =
    props.provider === "opencode" &&
    pickerModels(optionsOf(activeRail)).some(
      (model) =>
        model.variants.length &&
        (model.id === props.value || model.variants.some((variant) => variant.id === props.value)),
    );
  const showsEffort =
    props.reasoningEffort !== undefined && props.onReasoningEffortChange !== undefined;
  const effort =
    foreign || selectedVariants
      ? null
      : fixed?.effort
        ? reasoningLabel(fixed.effort)
        : showsEffort &&
            props.reasoningEffort &&
            selectedOption?.reasoningEffortConfigurable !== false &&
            selectedOption?.supportedReasoningEfforts.includes(props.reasoningEffort)
          ? reasoningLabel(props.reasoningEffort)
          : null;
  const fast =
    !foreign &&
    (fixed?.fast || (props.fastMode && props.onFastModeChange && selectedOption?.fastServiceTier));
  const accountName =
    !foreign && accountsOf(activeRail).length
      ? providerAccountName(
          t,
          accountsOf(activeRail),
          currentAccount ?? DEFAULT_PROVIDER_ACCOUNT_ID,
        )
      : null;
  const name = modelName(selectedOption?.name, props.value);
  const summary = [name, effort, fast ? t("provider.picker.fast") : null, accountName]
    .filter(Boolean)
    .join(" · ");
  const spent = (entry: Entry, model: string) => {
    if (entry.rail === "custom") return;
    const value = spentUsageWindow(
      props.accountUsage?.limits,
      entry.rail,
      entry.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID,
      model,
      now,
    );
    return value?.covers ? value.window : undefined;
  };
  const resets = visible.flatMap((entry) =>
    optionsOf(entry.rail).map((model) => spent(entry, model.id)?.resetsAt ?? Infinity),
  );
  const nextReset = Math.min(...resets);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A spent quota expires by wall clock while the picker remains open; the host reading itself stays unchanged.
  useEffect(() => {
    if (!open || !Number.isFinite(nextReset)) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(1, nextReset * 1000 - Date.now()), 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [open, nextReset]);
  const changeOpen = (next: boolean) => {
    if (props.disabled || foreign) return;
    if (next) {
      // oxlint-disable-next-line react/purity -- onOpenChange is an event callback; opening refreshes the quota clock.
      setNow(Date.now());
      setOpenedKeys(entries.filter(usable).map((entry) => entry.key));
      setSelectedRail(activeKey);
      setSearch("");
      setQueued(undefined);
    }
    setOpen(next);
  };
  const choose = (model: PickerModel, entry: Entry) => {
    if (
      props.disabled ||
      providerAvailability(props.agentStatus, props.modelOptions, model.provider, t).state !==
        "available" ||
      (entry.accountId && statusOf(entry).state !== "available")
    )
      return;
    const account = accountsOf(model.provider).length ? entry.accountId : undefined;
    let value = model.id;
    let reasoning: AgentReasoningEffort | undefined;
    if (queued?.key === entry.key) {
      if ("variant" in queued) {
        const variant = queued.variant ? `${model.id}/${queued.variant}` : model.id;
        value = model.variants.find((option) => option.id === variant)?.id ?? model.id;
      } else if (
        props.modelOptions
          .find((option) => option.id === model.id && option.provider === model.provider)
          ?.supportedReasoningEfforts.includes(queued.effort)
      )
        reasoning = queued.effort;
    }
    setQueued(undefined);
    props.onChange(value, model.provider, account, reasoning);
    if (!showsEffort && !model.variants.length) setOpen(false);
  };
  return (
    <div
      className={`provider-model-picker${props.variant === "field" ? " provider-model-picker-field" : ""}`}
    >
      <Popover.Root open={open && !props.disabled && !foreign} onOpenChange={changeOpen}>
        <Tooltip>
          <TooltipTrigger
            render={
              <Popover.Trigger
                ref={trigger}
                className={`provider-model-trigger${props.variant === "field" ? " provider-model-trigger-field" : ""}`}
                aria-label={props.ariaLabel ?? summary}
                disabled={props.disabled || Boolean(foreign)}
              />
            }
          >
            {props.variant === "field" && (
              <>
                {props.icon}
                <span className="provider-model-field-label">
                  {props.label ?? t("provider.picker.model")}
                </span>
              </>
            )}
            <span className="provider-model-trigger-value">
              <span key={activeRail} className="provider-model-trigger-mark" data-entering="">
                <Mark rail={foreign ? "unknown" : activeRail} />
              </span>
              <SwapLabel value={name} />
              {effort && <span className="provider-model-trigger-effort">{effort}</span>}
              {fast && (
                <span className="provider-model-trigger-effort provider-model-trigger-fast">
                  <ZapIcon />
                  {t("provider.picker.fast")}
                </span>
              )}
              {accountName && (
                <span className="provider-model-trigger-effort provider-model-trigger-account">
                  {accountName}
                </span>
              )}
            </span>
            <ChevronDownIcon className="provider-model-chevron" />
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {props.disabledReason ??
              (foreign
                ? gt("{value} requires a newer version of OpenBot.", {
                    value:
                      props.agentStatus.providers?.find((status) => status.id === foreign)
                        ?.displayName ?? foreign,
                  })
                : summary)}
          </TooltipPopup>
        </Tooltip>
        <Popover.Portal>
          <Popover.Positioner
            className="openbot-react openbot-popup-positioner"
            side="bottom"
            align="end"
            sideOffset={8}
            data-openbot-positioner=""
            render={renderClosingPositioner}
          >
            <Popover.Popup
              className="provider-model-popover"
              ref={menuMotionRef(undefined)}
              data-expanded={open ? "" : undefined}
            >
              <Popover.Title className="sr-only">{t("provider.picker.title")}</Popover.Title>
              <Tabs.Root
                className="provider-model-layout"
                value={railKey}
                onValueChange={(value) => {
                  setSelectedRail(String(value));
                  setSearch("");
                }}
                orientation="vertical"
              >
                <div className="provider-model-rail">
                  <Tabs.List
                    className="provider-model-rail-tabs"
                    aria-label={t("provider.picker.providers")}
                  >
                    {visible.map((entry) => (
                      <Tooltip key={entry.key}>
                        <TooltipTrigger
                          render={
                            <Tabs.Tab
                              value={entry.key}
                              className="provider-model-rail-button"
                              aria-label={entry.name}
                              data-selected={railKey === entry.key ? "" : undefined}
                              aria-controls={`${id}-${entry.key}`}
                            />
                          }
                        >
                          <Mark rail={entry.rail} large />
                          {entry.number !== undefined && (
                            <span className="provider-model-rail-account" aria-hidden="true">
                              {entry.number}
                            </span>
                          )}
                        </TooltipTrigger>
                        <TooltipPopup
                          side="left"
                          sideOffset={8}
                          className="provider-model-rail-tooltip"
                        >
                          {entry.name}
                        </TooltipPopup>
                      </Tooltip>
                    ))}
                  </Tabs.List>
                  {props.onManageProviders && (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <button
                            type="button"
                            className="provider-model-rail-button provider-model-rail-add"
                            aria-label={t("provider.picker.addProvider")}
                            onClick={() => {
                              setOpen(false);
                              if (trigger.current) props.onManageProviders?.(trigger.current);
                            }}
                          />
                        }
                      >
                        <PlusIcon />
                      </TooltipTrigger>
                      <TooltipPopup side="left">{t("provider.picker.addProvider")}</TooltipPopup>
                    </Tooltip>
                  )}
                </div>
                {visible.map((entry) => (
                  <PickerPanel
                    key={entry.key}
                    entry={entry}
                    panelId={`${id}-${entry.key}`}
                    active={railKey === entry.key}
                    props={props}
                    options={optionsOf(entry.rail)}
                    status={statusOf(entry)}
                    currentAccount={currentAccount}
                    selectedOption={selectedOption}
                    fixed={fixed}
                    search={search}
                    setSearch={setSearch}
                    showsEffort={showsEffort}
                    queued={queued}
                    setQueued={setQueued}
                    choose={(model) => choose(model, entry)}
                    spent={(model) => spent(entry, model)}
                    close={() => setOpen(false)}
                    trigger={trigger}
                    customAgentCount={customAgentCount}
                  />
                ))}
              </Tabs.Root>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
function PickerPanel({
  entry,
  panelId,
  active,
  props,
  options,
  status,
  currentAccount,
  selectedOption,
  fixed,
  search,
  setSearch,
  showsEffort,
  queued,
  setQueued,
  choose,
  spent,
  close,
  trigger,
  customAgentCount,
}: {
  entry: Entry;
  panelId: string;
  active: boolean;
  props: OpenbotProviderModelPickerProps;
  options: ClientAgentModelOption[];
  status: ReturnType<typeof providerAvailability>;
  currentAccount: string | null;
  selectedOption: ClientAgentModelOption | undefined;
  fixed: ReturnType<typeof fixedModelSettings>;
  search: string;
  setSearch: (value: string) => void;
  showsEffort: boolean;
  queued: QueuedEffort | undefined;
  setQueued: (value: QueuedEffort | undefined) => void;
  choose: (model: PickerModel) => void;
  spent: (model: string) => AccountUsageWindow | undefined;
  close: () => void;
  trigger: import("react").RefObject<HTMLButtonElement | null>;
  customAgentCount: number;
}) {
  const gt = useGT();
  const [olderOpen, setOlderOpen] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const models = pickerModels(options);
  const selected =
    entry.accountId === currentAccount
      ? models.find(
          (model) =>
            model.provider === props.provider &&
            (model.id === props.value ||
              model.variants.some((variant) => variant.id === props.value)),
        )
      : undefined;
  const older = models.filter((model) => model.listing === "older" && model !== selected);
  const main = models.filter((model) => model.listing !== "older" || model === selected);
  const folds = !search.trim() && older.length > 0 && main.length > 0;
  const groups = groupPickerModels(folds ? main : models, search);
  const olderGroups = folds && olderOpen ? groupPickerModels(older, "") : [];
  const available = status.state === "available";
  const enabled = (model: PickerModel) =>
    providerAvailability(props.agentStatus, props.modelOptions, model.provider, t).state ===
      "available" &&
    (!entry.accountId || available);
  const owns =
    entry.rail === "custom"
      ? selected?.provider === props.provider
      : entry.rail === props.provider &&
        entry.accountId === currentAccount &&
        ((props.provider !== "opencode" && props.provider !== "pi") || Boolean(selected));
  const defaultModel = entry.rail === "custom" ? null : defaultProviderModel(entry.rail);
  const effortModel = owns
    ? selected
    : (main.find((model) => enabled(model) && model.id === defaultModel) ?? main.find(enabled));
  const effortOption = owns
    ? selectedOption
    : options.find(
        (model) => model.id === effortModel?.id && model.provider === effortModel.provider,
      );
  const effortOptions = effortModel?.variants.length
    ? effortModel.variants
    : showsEffort && effortOption && effortOption.reasoningEffortConfigurable !== false
      ? effortOption.supportedReasoningEfforts.map((effort) => ({
          id: effort,
          name: reasoningLabel(effort),
        }))
      : [];
  const effortValue = effortModel?.variants.length
    ? owns
      ? props.value
      : queued?.key === entry.key && "variant" in queued
        ? queued.variant
          ? `${effortModel.id}/${queued.variant}`
          : effortModel.id
        : effortModel.id
    : owns
      ? props.reasoningEffort
      : queued?.key === entry.key && "effort" in queued
        ? queued.effort
        : props.reasoningEffort &&
            effortOption?.supportedReasoningEfforts.includes(props.reasoningEffort)
          ? props.reasoningEffort
          : effortOption?.defaultReasoningEffort;
  const chooseEffort = (value: string) => {
    if (props.disabled || !available || value === effortValue) return;
    if (effortModel?.variants.length) {
      if (owns)
        props.onChange(
          value,
          effortModel.provider,
          props.accountChoice &&
            (props.agentStatus.providers?.find((provider) => provider.id === effortModel.provider)
              ?.accounts?.length ?? 0) > 1
            ? entry.accountId
            : undefined,
        );
      else
        setQueued({
          key: entry.key,
          variant: value === effortModel.id ? "" : value.slice(effortModel.id.length + 1),
        });
    } else {
      const effort = effortOption?.supportedReasoningEfforts.find((effort) => effort === value);
      if (effort) {
        if (owns) props.onReasoningEffortChange?.(effort);
        else setQueued({ key: entry.key, effort });
      }
    }
  };
  let runtime = props.runtimeStatuses?.[status.id];
  if (runtime?.phase === "not-downloaded" && (available || status.state === "sign-in-required"))
    runtime = { ...runtime, phase: "ready", version: status.version };
  const action =
    runtime?.phase === "downloading"
      ? props.onCancelProviderDownload
        ? "Cancel"
        : null
      : available || status.connectionState === "connecting" || entry.accountId
        ? null
        : runtime?.phase === "download-error"
          ? props.onDownloadProvider
            ? "Retry"
            : null
          : runtime?.phase === "not-downloaded"
            ? props.onDownloadProvider
              ? "Download"
              : null
            : (runtime?.phase === "ready" ||
                  status.state === "sign-in-required" ||
                  status.state === "error") &&
                props.onConnectProvider &&
                (props.canConnectProvider?.(status.id) ?? true)
              ? "Connect"
              : null;
  const message =
    runtime?.phase === "downloading"
      ? t("provider.picker.downloading", {
          percent: text.format.percent(Math.round(runtime.progress ?? 0) / 100),
        })
      : runtime?.phase === "finishing"
        ? t("provider.status.settingUp")
        : status.connectionState === "connecting"
          ? t(
              status.signInPending === false
                ? "provider.status.connecting"
                : "provider.connecting.browserHint",
            )
          : (connectError ??
            runtime?.message ??
            status.message ??
            t("provider.picker.unavailable", { name: railName(entry.rail) }));
  const windows = models.map((model) => spent(model.id));
  const headingSpent =
    available && windows.length && windows.every(Boolean)
      ? windows.reduce<AccountUsageWindow | undefined>(
          (first, window) =>
            window && (!first || (window.resetsAt ?? Infinity) < (first.resetsAt ?? Infinity))
              ? window
              : first,
          undefined,
        )
      : undefined;
  const endpoints = props.customProviders?.length ?? 0;
  const customSummary = customAgentCount
    ? endpoints
      ? t("provider.picker.customCounts", {
          endpoints: t("provider.endpointCount", { count: endpoints }),
          agents: t("provider.customAgentCount", { count: customAgentCount }),
        })
      : t("provider.customAgentCount", { count: customAgentCount })
    : endpoints
      ? t("provider.endpointCount", { count: endpoints })
      : t("provider.picker.noEndpoints");
  const account = props.agentStatus.providers
    ?.find((provider) => provider.id === entry.rail)
    ?.accounts?.find((account) => account.id === (entry.accountId ?? DEFAULT_PROVIDER_ACCOUNT_ID));
  const heading = available
    ? (account?.email ??
      (entry.rail === "custom"
        ? customSummary
        : status.version
          ? `${status.version} (${agentProviderCliName(status.id)})`
          : t("provider.picker.cliReady", { cli: agentProviderCliName(status.id) })))
    : t(
        status.state === "sign-in-required"
          ? "provider.status.signInRequired"
          : status.state === "not-installed"
            ? "provider.status.notInstalled"
            : status.state === "outdated"
              ? "provider.status.updateRequired"
              : status.state === "error"
                ? "provider.status.unavailable"
                : "provider.status.checking",
      );
  const measure = () => {
    const node = scroll.current;
    if (!node) return;
    node.classList.toggle("scroll-fade-top", node.scrollTop > 2);
    node.classList.toggle(
      "scroll-fade-bottom",
      node.scrollHeight - node.clientHeight - node.scrollTop > 2,
    );
  };
  /* oxlint-disable t3code/no-unreasoned-state-sync, react/exhaustive-effect-dependencies -- Source scroll fade masks follow actual content and viewport measurements. */
  useLayoutEffect(() => {
    measure();
    const node = scroll.current;
    if (!node) return;
    return observeResize([node, ...Array.from(node.children)], measure);
  }, [active, search, olderOpen, options]);
  /* oxlint-enable t3code/no-unreasoned-state-sync, react/exhaustive-effect-dependencies */
  const list = (listGroups: ReturnType<typeof groupPickerModels>, label: string) => (
    <div
      className="provider-model-list"
      role="listbox"
      aria-label={label}
      onKeyDown={(event) => {
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'),
        );
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        let next: number | undefined;
        if (event.key === "ArrowDown") next = (index + 1) % items.length;
        else if (event.key === "ArrowUp") next = (index - 1 + items.length) % items.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = items.length - 1;
        else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
          const after = [...items.slice(index + 1), ...items.slice(0, index + 1)].find((item) =>
            item.textContent?.toLowerCase().startsWith(event.key.toLowerCase()),
          );
          after?.focus();
          return;
        }
        if (next !== undefined) {
          event.preventDefault();
          items[next]?.focus();
        }
      }}
    >
      {listGroups.map((group) => (
        <div key={group.name} role="group" aria-label={group.name || undefined}>
          {group.name && <div className="provider-model-group">{group.name}</div>}
          {group.models.map((model) => {
            const settings = fixedModelSettings(
              options.find(
                (option) => option.provider === model.provider && option.id === model.id,
              ),
            );
            const settingText = [
              settings?.context,
              settings?.effort && reasoningLabel(settings.effort),
              settings?.fast && t("provider.picker.fast"),
            ]
              .filter(Boolean)
              .join(" · ");
            const window = spent(model.id);
            const reset = window ? formatUsageReset(window.resetsAt) : null;
            const label = [
              modelName(model.name, model.id),
              settingText,
              model.id === defaultModel ? t("provider.model.default") : null,
              window ? (reset ? `Usage limit resets ${reset}` : "Usage limit") : null,
            ]
              .filter(Boolean)
              .join(", ");
            return (
              <button
                key={`${model.provider}:${model.id}`}
                type="button"
                role="option"
                aria-selected={selected === model}
                tabIndex={
                  selected
                    ? selected === model
                      ? 0
                      : -1
                    : listGroups.flatMap((group) => group.models).find(enabled) === model
                      ? 0
                      : -1
                }
                aria-label={label}
                className={`provider-model-option${selected === model ? " provider-model-option-selected" : ""}`}
                disabled={!enabled(model)}
                onClick={() => {
                  if (selected !== model) choose(model);
                }}
              >
                <span className="provider-model-option-name">
                  <span>{modelName(model.name, model.id)}</span>
                  {settingText && (
                    <span className="provider-model-option-settings">{settingText}</span>
                  )}
                  {model.free && <small>{t("provider.model.free")}</small>}
                  {model.listing === "new" && <small>{t("provider.model.new")}</small>}
                  {model.id === defaultModel && <small>{t("provider.model.default")}</small>}
                </span>
                {selected === model && <CheckIcon className="provider-model-check" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
  return (
    <Tabs.Panel
      value={entry.key}
      id={panelId}
      className="provider-model-panel"
      aria-label={t("provider.picker.models", { name: entry.name })}
      hidden={!active}
      data-selected={active ? "" : undefined}
    >
      <div className="provider-model-heading">
        <div
          className={`provider-model-heading-text${headingSpent ? " provider-model-heading-limited" : ""}`}
        >
          <strong>{entry.name}</strong>
          {headingSpent && (
            <small className="provider-model-limit">
              {usageWindowLabel(headingSpent.windowDurationMins)} limit
              {formatUsageReset(headingSpent.resetsAt)
                ? gt(" · Resets {formatUsageReset}", {
                    formatUsageReset: formatUsageReset(headingSpent.resetsAt),
                  })
                : ""}
            </small>
          )}
          <span>{heading}</span>
        </div>
        {entry.rail === "custom" && !props.onManageProviders && props.onAddCustomProvider && (
          <button
            type="button"
            className="ui-button"
            onClick={() => {
              close();
              if (trigger.current) props.onAddCustomProvider?.(trigger.current);
            }}
          >
            <PlusIcon />
            {t("provider.picker.addProvider")}
          </button>
        )}
      </div>
      {!available && (
        <div className="provider-model-empty" role="status">
          <span>{message}</span>
          {runtime?.phase === "downloading" && (
            <progress
              value={runtime.progress ?? 0}
              max={100}
              aria-label={t("provider.picker.download", { name: entry.name })}
            />
          )}{" "}
          {action && (
            <button
              type="button"
              className="ui-button"
              onClick={() => {
                setConnectError(null);
                const run =
                  action === "Cancel"
                    ? props.onCancelProviderDownload
                    : action === "Connect"
                      ? props.onConnectProvider
                      : props.onDownloadProvider;
                void Promise.resolve()
                  .then(() => run?.(status.id))
                  .catch((error: unknown) =>
                    setConnectError(
                      error instanceof Error
                        ? error.message
                        : gt("The provider action failed. Try again."),
                    ),
                  );
              }}
            >
              {action}
            </button>
          )}
        </div>
      )}
      <input
        className="provider-model-search"
        aria-label={t("provider.picker.search")}
        placeholder={t("provider.picker.search")}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            scroll.current
              ?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)')
              ?.focus();
          }
        }}
      />
      <div className="provider-model-scroll" ref={scroll} onScroll={measure}>
        {groups.length
          ? list(groups, t("provider.picker.models", { name: entry.name }))
          : available && (
              <div className="provider-model-empty" role="status">
                {search.trim()
                  ? t("provider.picker.noMatches")
                  : entry.rail === "custom"
                    ? t("provider.picker.customEmpty")
                    : t("provider.picker.noModels", { name: entry.name })}
              </div>
            )}
        {folds && (
          <button
            type="button"
            className="provider-model-option provider-model-older"
            aria-expanded={olderOpen}
            onClick={() => setOlderOpen(!olderOpen)}
          >
            <span className="provider-model-option-name">
              <span>{t("provider.picker.olderModels")}</span>
              <small>{older.length}</small>
            </span>
            <ChevronDownIcon className="provider-model-chevron" />
          </button>
        )}
        {olderGroups.length > 0 &&
          list(olderGroups, t("provider.picker.olderModelsList", { name: entry.name }))}
      </div>
      {effortOptions.length > 0 && (
        <div className="provider-model-effort">
          <span>{t("provider.picker.effort")}</span>
          <SourceSelect
            className="provider-model-effort-select"
            value={effortValue}
            onChange={chooseEffort}
            options={effortOptions}
            label={t("provider.picker.effortLabel")}
            disabled={!available || Boolean(props.disabled)}
          />
        </div>
      )}
      {owns && !effortOptions.length && fixed?.effort && (
        <div className="provider-model-effort">
          <span>{t("provider.picker.effort")}</span>
          <span>
            {t("provider.picker.effortFixed", {
              effort: reasoningLabel(fixed.effort),
              provider: entry.name,
            })}
          </span>
        </div>
      )}
      {owns && selectedOption?.fastServiceTier && props.onFastModeChange && (
        <div className="provider-model-effort">
          <span>{t("provider.picker.fast")}</span>
          <SourceSwitch
            label={t("provider.picker.fastLabel")}
            checked={props.fastMode === true}
            disabled={props.disabled || !available}
            onChange={props.onFastModeChange}
          />
        </div>
      )}
    </Tabs.Panel>
  );
}
