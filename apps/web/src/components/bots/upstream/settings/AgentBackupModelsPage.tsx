/* oxlint-disable shadcn/no-unknown-classes -- Original BackupModelsPage selectors are supplied by source CSS. */
import * as Schema from "effect/Schema";
import { ArrowLeftRight, ChevronDown, ChevronUp, X } from "lucide-react";
import { useSourceProviderData } from "../../SourceProviderEnvironment";
import { useAgentSettingsValue, type AgentSettingsApi } from "./agent-settings-api";
import { SettingsReadState } from "./AgentConfigurationPages";
import { SettingsLinkGroup } from "./SettingsPanel";
import { SourceSwitch } from "./SourceSwitch";
import { SourceButton } from "./SettingsParts";
import { ProviderLogo } from "../provider/ProviderLogo";
import "./backup-models.css";
const Choice = Schema.Struct({
  provider: Schema.String,
  model: Schema.String,
  providerAccountId: Schema.optional(Schema.String),
});
const Backup = Schema.Struct({
  backupModels: Schema.NullOr(
    Schema.Struct({ automatic: Schema.Boolean, order: Schema.Array(Choice) }),
  ),
});
const decodeBackup = Schema.decodeUnknownSync(Backup);
type Choice = typeof Choice.Type;
const choiceKey = (choice: Choice) =>
  JSON.stringify([choice.provider, choice.model, choice.providerAccountId ?? null]);
export function AgentBackupModelsPage({
  api,
  agentName,
  ownProvider,
}: {
  api: AgentSettingsApi;
  agentName: string;
  ownProvider: string;
}) {
  const data = useSourceProviderData();
  const c = useAgentSettingsValue(
    async () => decodeBackup(await api.setting("settings.agent-backup-models.settings")),
    api.agentId,
  );
  const automatic = c.value?.backupModels?.automatic ?? false,
    order = c.value?.backupModels?.order ?? [];
  const save = (nextAutomatic: boolean, nextOrder: readonly Choice[]) =>
    c.change(() =>
      api.setting("settings.agent-backup-models.update", {
        agentId: api.agentId,
        backupModels:
          nextAutomatic || nextOrder.length
            ? {
                automatic: nextAutomatic,
                order: nextOrder.map((choice) => ({
                  provider: choice.provider,
                  model: choice.model,
                  ...(choice.providerAccountId
                    ? { providerAccountId: choice.providerAccountId }
                    : {}),
                })),
              }
            : null,
      }),
    );
  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    void save(automatic, next);
  };
  const models = data?.modelOptions ?? [];
  return (
    <div className="backup-models-page">
      <SettingsReadState
        busy={c.busy && !c.value}
        error={c.error}
        onRetry={() => void c.refresh()}
      />
      {c.value && (
        <>
          <p className="ui-text backup-models-intro" data-variant="body-sm" data-tone="secondary">
            When {ownProvider} reaches its usage limit
            {automatic ? " or fails with a provider error" : ""} before {agentName} starts to write,{" "}
            {automatic
              ? `${agentName} switches to the first available model in the order.`
              : `${agentName} asks you which model to use.`}
          </p>
          <SettingsLinkGroup inset className="agent-settings-runtime-rows">
            <div className="agent-settings-switch-row">
              <span className="settings-link-label">
                <span className="settings-link-icon">
                  <ArrowLeftRight aria-hidden="true" />
                </span>
                Ask before switching
              </span>
              <SourceSwitch
                label="Ask before switching"
                checked={!automatic}
                disabled={c.busy}
                onChange={(ask) => void save(!ask, order)}
              />
            </div>
          </SettingsLinkGroup>
          <SettingsLinkGroup title="Order" inset className="agent-settings-runtime-rows">
            {order.length === 0 ? (
              <p className="ui-text backup-models-empty" data-variant="body-sm" data-tone="muted">
                No order set. {agentName} offers each available model.
              </p>
            ) : (
              <ol className="backup-models-list" aria-label="Backup models, in order">
                {order.map((choice, index) => {
                  const model = models.find(
                    (model) => model.provider === choice.provider && model.id === choice.model,
                  );
                  return (
                    <li
                      key={choiceKey(choice)}
                      className="backup-models-row"
                      data-state={model ? "ready" : "unavailable"}
                    >
                      <span className="backup-models-number" aria-hidden="true">
                        {index + 1}
                      </span>
                      <span className="backup-model-logo">
                        <ProviderLogo provider={choice.provider} />
                      </span>
                      <span className="backup-models-text">
                        <span className="backup-models-name">
                          {model?.name ?? choice.model}
                          {choice.providerAccountId ? ` · ${choice.providerAccountId}` : ""}
                        </span>
                        {!model && <span className="backup-models-state">Unavailable</span>}
                      </span>
                      <span className="backup-models-actions">
                        <SourceButton
                          variant="ghost"
                          size="xs"
                          aria-label={`Move ${choice.model} up`}
                          disabled={c.busy || index === 0}
                          onClick={() => move(index, -1)}
                        >
                          <ChevronUp aria-hidden="true" />
                        </SourceButton>
                        <SourceButton
                          variant="ghost"
                          size="xs"
                          aria-label={`Move ${choice.model} down`}
                          disabled={c.busy || index === order.length - 1}
                          onClick={() => move(index, 1)}
                        >
                          <ChevronDown aria-hidden="true" />
                        </SourceButton>
                        <SourceButton
                          variant="ghost"
                          size="xs"
                          aria-label={`Remove ${choice.model}`}
                          disabled={c.busy}
                          onClick={() =>
                            void save(
                              automatic,
                              order.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <X aria-hidden="true" />
                        </SourceButton>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            <select
              className="ui-native-select"
              aria-label="Add backup model"
              value=""
              disabled={c.busy || order.length >= 8 || models.length === 0}
              onChange={(event) => {
                const choice = models.find(
                  (model) => JSON.stringify([model.provider, model.id]) === event.target.value,
                );
                if (choice)
                  void save(automatic, [...order, { provider: choice.provider, model: choice.id }]);
              }}
            >
              <option value="">Add backup model</option>
              {models
                .filter(
                  (model) =>
                    !order.some(
                      (choice) =>
                        choice.provider === model.provider &&
                        choice.model === model.id &&
                        !choice.providerAccountId,
                    ),
                )
                .map((model) => (
                  <option
                    key={JSON.stringify([model.provider, model.id])}
                    value={JSON.stringify([model.provider, model.id])}
                  >
                    {model.name} · {model.provider}
                  </option>
                ))}
            </select>
          </SettingsLinkGroup>
        </>
      )}
    </div>
  );
}
