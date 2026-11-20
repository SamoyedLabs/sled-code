import { useRef } from "react";
/* oxlint-disable shadcn/no-unknown-classes -- Exact FirstAgentSetup hierarchy and scoped source selectors. */
import { BotAvatar } from "../../avatar/BotAvatar";
import { SourceButton } from "../settings/SettingsParts";
import {
  AVATAR_HUE_CHOICES,
  avatarHeadColor,
  avatarHueSwatch,
} from "../settings/avatar-editor-model";
import { BotModelPicker } from "../../BotModelPicker";
import type { useSourceProviderData } from "../../SourceProviderEnvironment";
import {
  FIRST_AGENT_AVATAR_SEEDS,
  FIRST_AGENT_SUGGESTIONS,
  applySuggestion,
  updateAgentDraft,
  selectCreationModel,
  type FirstAgentDraft,
} from "./agent-draft";
import { useSuggestionScroll } from "./useSuggestionScroll";
import { t } from "./text";
import "./first-agent-setup.css";
const COLORS = {
  0: "Red",
  30: "Orange",
  55: "Yellow",
  100: "Lime",
  150: "Green",
  185: "Cyan",
  215: "Blue",
  245: "Indigo",
  280: "Violet",
  320: "Magenta",
};
export function FirstAgentSetup(props: {
  value: FirstAgentDraft;
  first: boolean;
  busy: boolean;
  blocked: boolean;
  error: string | null;
  canCreate: boolean;
  modelSupported: boolean;
  providerData: ReturnType<typeof useSourceProviderData>;
  onChange: (draft: FirstAgentDraft) => void;
  onSubmit: () => Promise<void>;
  onOpenCreated?: (() => Promise<void>) | undefined;
  onCancel?: undefined | (() => void);
  onManageProviders?: undefined | (() => void);
}) {
  const suggestionList = useRef<HTMLUListElement>(null);
  const value = props.value,
    disabled = props.busy || props.blocked,
    scroll = useSuggestionScroll(
      suggestionList,
      disabled,
      !props.first ? props.onCancel : undefined,
    ),
    data = props.providerData;
  const change = (patch: Partial<FirstAgentDraft>) => {
    if (!disabled) props.onChange(updateAgentDraft(value, patch));
  };
  const selected = data?.modelOptions.find(
      (model) => model.provider === value.provider && model.id === value.model,
    ),
    effort = value.reasoningEffort ?? selected?.defaultReasoningEffort;
  const canSubmit =
    Boolean(value.name.trim()) && value.purpose.length <= 2000 && !disabled && props.canCreate;
  return (
    <main
      className="conversation-panel first-agent-setup-panel"
      aria-labelledby="first-agent-setup-title"
    >
      <header className="window-drag first-agent-setup-header">
        <div
          className="first-agent-header-identity"
          data-avatar-seed={value.avatarSeed}
          data-avatar-hue={value.avatarHue ?? "automatic"}
        >
          <span className="agent-avatar">
            <BotAvatar seed={value.avatarSeed} hue={value.avatarHue} size={18} />
          </span>
          <h1 aria-live="polite">{value.name.trim() || t("agent.setup.nameFallback")}</h1>
        </div>
        {!props.first && props.onCancel && (
          <SourceButton
            variant="ghost"
            className="first-agent-cancel no-drag"
            disabled={props.busy}
            onClick={props.onCancel}
          >
            Cancel
          </SourceButton>
        )}
      </header>
      <div className="first-agent-setup-content">
        <form
          className="first-agent-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (canSubmit) void props.onSubmit();
          }}
        >
          <h2 id="first-agent-setup-title" className="marketplace-visually-hidden">
            {t(props.first ? "agent.setup.titleFirst" : "agent.setup.titleAdditional")}
          </h2>
          <div
            className="first-agent-live-avatar"
            data-avatar-seed={value.avatarSeed}
            data-avatar-hue={value.avatarHue ?? "automatic"}
          >
            <span className="agent-avatar">
              <BotAvatar seed={value.avatarSeed} hue={value.avatarHue} size={72} />
            </span>
          </div>
          <fieldset
            className="first-agent-avatar-fieldset first-agent-color-fieldset"
            disabled={disabled}
          >
            <legend className="marketplace-visually-hidden">{t("agent.setup.color")}</legend>
            <div className="first-agent-color-options">
              <SourceButton
                variant="ghost"
                className="first-agent-color-choice"
                aria-label={t("agent.setup.colorAutomatic")}
                aria-pressed={value.avatarHue === null}
                onClick={() => change({ avatarHue: null })}
              >
                <span
                  className="first-agent-color-swatch"
                  style={{ background: avatarHeadColor(value.avatarSeed, null) }}
                />
              </SourceButton>
              {AVATAR_HUE_CHOICES.map((option) => (
                <SourceButton
                  key={option.hue}
                  variant="ghost"
                  className="first-agent-color-choice"
                  aria-label={t("agent.setup.colorOption", { color: COLORS[option.hue] })}
                  aria-pressed={value.avatarHue === option.hue}
                  onClick={() => change({ avatarHue: option.hue })}
                >
                  <span
                    className="first-agent-color-swatch"
                    style={{ background: avatarHueSwatch(option.hue) }}
                  />
                </SourceButton>
              ))}
            </div>
          </fieldset>
          <fieldset
            className="first-agent-avatar-fieldset first-agent-face-fieldset"
            disabled={disabled}
          >
            <legend className="marketplace-visually-hidden">{t("agent.setup.face")}</legend>
            <div className="first-agent-face-options">
              {FIRST_AGENT_AVATAR_SEEDS.map((seed, index) => (
                <SourceButton
                  key={seed}
                  variant="ghost"
                  className="first-agent-face-choice"
                  aria-label={t("agent.setup.faceOption", { number: index + 1 })}
                  aria-pressed={value.avatarSeed === seed}
                  onClick={() => change({ avatarSeed: seed })}
                >
                  <span className="agent-avatar">
                    <BotAvatar seed={seed} hue={value.avatarHue} size={24} />
                  </span>
                </SourceButton>
              ))}
            </div>
          </fieldset>
          <div className="first-agent-fields">
            <label className="ui-field">
              <span className="ui-label">{t("agent.setup.name")}</span>
              <input
                className="ui-input"
                value={value.name}
                maxLength={80}
                autoComplete="off"
                disabled={disabled}
                required
                onChange={(event) => change({ name: event.target.value })}
              />
            </label>
            <label className="ui-field">
              <span className="ui-label">{t("agent.setup.purpose")}</span>
              <textarea
                className="ui-textarea"
                value={value.purpose}
                rows={2}
                aria-invalid={value.purpose.length > 2000}
                placeholder={t("agent.setup.purposePlaceholder")}
                disabled={disabled}
                onChange={(event) => change({ purpose: event.target.value })}
              />
              {value.purpose.length >= 1800 && (
                <span className="ui-field-limit">
                  <span className="ui-field-description">
                    {t("agent.instructions.length", {
                      length: value.purpose.length.toLocaleString(),
                      limit: "2,000",
                    })}
                  </span>
                  {value.purpose.length > 2000 && (
                    <span className="ui-field-error" role="alert">
                      {t("agent.instructions.tooLong", { limit: "2,000" })}
                    </span>
                  )}
                </span>
              )}
            </label>
            {props.modelSupported && data?.status && data.modelOptions.length > 0 && (
              <BotModelPicker
                variant="field"
                ariaLabel={t("agent.setup.model")}
                provider={value.provider}
                value={value.model}
                modelOptions={data.modelOptions}
                agentStatus={data.status}
                runtimeStatuses={data.runtimeStatuses}
                customProviders={data.customProviders}
                customAgents={data.customAgents}
                disabled={disabled}
                {...(effort ? { reasoningEffort: effort } : {})}
                onReasoningEffortChange={(reasoningEffort) => change({ reasoningEffort })}
                onChange={(model, provider, _accountId, reasoningEffort) =>
                  props.onChange(
                    selectCreationModel(value, model, provider, data.modelOptions, reasoningEffort),
                  )
                }
                {...(props.onManageProviders
                  ? {
                      onManageProviders: props.onManageProviders,
                      onAddCustomProvider: props.onManageProviders,
                      onConnectProvider: props.onManageProviders,
                    }
                  : {})}
              />
            )}
          </div>
          {(props.error || !props.canCreate) && (
            <p className="first-agent-error" role="alert">
              {props.error ?? "You do not have permission to create an agent on this host."}
            </p>
          )}
          {props.onOpenCreated && (
            <SourceButton disabled={props.busy} onClick={() => void props.onOpenCreated?.()}>
              Open created agent
            </SourceButton>
          )}
          <div className="first-agent-submit-actions">
            <SourceButton
              type="submit"
              variant="default"
              size="default"
              className="first-agent-submit"
              disabled={!canSubmit}
            >
              {t(props.busy ? "agent.setup.creating" : "agent.setup.create")}
            </SourceButton>
          </div>
        </form>
        <section
          className="first-agent-suggestions"
          aria-labelledby="first-agent-suggestions-title"
        >
          <h2 id="first-agent-suggestions-title">{t("agent.setup.suggestions")}</h2>
          <div
            className={`first-agent-suggestion-viewport${scroll.fades.back ? " can-scroll-back" : ""}${scroll.fades.forward ? " can-scroll-forward" : ""}${scroll.dragging ? " is-dragging" : ""}`}
          >
            <ul
              ref={suggestionList}
              className="first-agent-suggestion-list"
              onScroll={() => scroll.onScroll()}
              onPointerDown={scroll.onPointerDown}
              onPointerMove={scroll.onPointerMove}
              onPointerUp={scroll.onPointerUp}
              onPointerCancel={scroll.onPointerCancel}
            >
              {FIRST_AGENT_SUGGESTIONS.map((suggestion) => (
                <li key={suggestion.id} className="first-agent-suggestion-item">
                  <SourceButton
                    variant="ghost"
                    className="first-agent-suggestion-card"
                    data-animation-offset={suggestion.animationOffset}
                    aria-label={t("agent.setup.suggestion.label", {
                      name: t(suggestion.nameKey),
                      description: t(suggestion.descriptionKey),
                    })}
                    aria-pressed={value.suggestionId === suggestion.id}
                    disabled={disabled}
                    onClick={() => {
                      if (scroll.canClick()) props.onChange(applySuggestion(value, suggestion));
                    }}
                  >
                    <span className="agent-avatar">
                      <BotAvatar
                        seed={suggestion.avatarSeed}
                        hue={suggestion.avatarHue}
                        size={48}
                      />
                    </span>
                    <span>
                      <strong>{t(suggestion.nameKey)}</strong>
                      <small>{t(suggestion.descriptionKey)}</small>
                    </span>
                  </SourceButton>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
