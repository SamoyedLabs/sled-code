import type {
  BotProvider,
  BotProviderChoice as Choice,
  BotProviderModel,
} from "@t3tools/client-runtime/openbot/presentation";
import {
  providerOptions,
  selectedProviderModel,
  botProviderSetupMessage,
} from "@t3tools/client-runtime/openbot/presentation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { T, Var, useGT } from "gt-react";

const HOST_DEFAULT = "__host_default__";
export function BotProviderChoice({
  value,
  onChange,
  models,
  providers,
  disabled = false,
}: {
  value: Choice;
  onChange: (value: Choice) => void;
  models: readonly BotProviderModel[];
  providers: readonly BotProvider[];
  disabled?: boolean;
}) {
  const gt = useGT();
  const options = providerOptions(models, providers);
  const modelOptions = models.filter((model) => model.provider === value.provider);
  const selected = selectedProviderModel(models, value);
  const provider = providers.find((provider) => provider.id === value.provider);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm">
          <T>Provider</T>
        </p>
        <Select
          value={value.provider || null}
          disabled={disabled}
          onValueChange={(provider) => {
            if (provider) onChange({ provider, model: "", reasoningEffort: null });
          }}
        >
          <SelectTrigger aria-label={gt("Bot provider")}>
            <SelectValue placeholder={gt("Choose a provider")} />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {provider && (
        <p className="text-sm text-muted-foreground">
          {provider.state}
          {botProviderSetupMessage(provider) ? ` · ${botProviderSetupMessage(provider)}` : ""}
        </p>
      )}
      <div className="space-y-1">
        <p className="text-sm">
          <T>Model</T>
        </p>
        <Select
          value={value.model || null}
          disabled={disabled || !value.provider || modelOptions.length === 0}
          onValueChange={(model) => {
            if (model) onChange({ ...value, model, reasoningEffort: null });
          }}
        >
          <SelectTrigger aria-label={gt("Bot model")}>
            <SelectValue placeholder={gt("Choose a model")} />
          </SelectTrigger>
          <SelectContent>
            {modelOptions.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {value.provider && modelOptions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          <T>No models are available. Complete this provider's setup, then refresh.</T>
        </p>
      )}
      {selected?.description && (
        <p className="text-sm text-muted-foreground">{selected.description}</p>
      )}
      {selected && selected.supportedReasoningEfforts.length > 1 && (
        <div className="space-y-1">
          <p className="text-sm">
            <T>Reasoning effort</T>
          </p>
          <Select
            value={value.reasoningEffort ?? HOST_DEFAULT}
            disabled={disabled}
            onValueChange={(effort) => {
              if (effort)
                onChange({ ...value, reasoningEffort: effort === HOST_DEFAULT ? null : effort });
            }}
          >
            <SelectTrigger aria-label={gt("Bot reasoning effort")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={HOST_DEFAULT}>
                <T>
                  Host default (<Var>{selected.defaultReasoningEffort}</Var>)
                </T>
              </SelectItem>
              {selected.supportedReasoningEfforts.map((effort) => (
                <SelectItem key={effort} value={effort}>
                  {effort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
