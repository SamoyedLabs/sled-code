import type {
  BotProvider,
  BotProviderChoice as Choice,
  BotProviderModel,
} from "@t3tools/client-runtime/openbot/presentation";
import {
  providerOptions,
  selectedProviderModel,
} from "@t3tools/client-runtime/openbot/presentation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

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
  const options = providerOptions(models, providers);
  const modelOptions = models.filter((model) => model.provider === value.provider);
  const selected = selectedProviderModel(models, value);
  const provider = providers.find((provider) => provider.id === value.provider);
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm">Provider</p>
        <Select
          value={value.provider || null}
          disabled={disabled}
          onValueChange={(provider) => {
            if (provider) onChange({ provider, model: "", reasoningEffort: null });
          }}
        >
          <SelectTrigger aria-label="Bot provider">
            <SelectValue placeholder="Choose a provider" />
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
          {provider.message ? ` · ${provider.message}` : ""}
        </p>
      )}
      <div className="space-y-1">
        <p className="text-sm">Model</p>
        <Select
          value={value.model || null}
          disabled={disabled || !value.provider || modelOptions.length === 0}
          onValueChange={(model) => {
            if (model) onChange({ ...value, model, reasoningEffort: null });
          }}
        >
          <SelectTrigger aria-label="Bot model">
            <SelectValue placeholder="Choose a model" />
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
          No models are available. Complete this provider's setup, then refresh.
        </p>
      )}
      {selected?.description && (
        <p className="text-sm text-muted-foreground">{selected.description}</p>
      )}
      {selected && selected.supportedReasoningEfforts.length > 1 && (
        <div className="space-y-1">
          <p className="text-sm">Reasoning effort</p>
          <Select
            value={value.reasoningEffort ?? HOST_DEFAULT}
            disabled={disabled}
            onValueChange={(effort) => {
              if (effort)
                onChange({ ...value, reasoningEffort: effort === HOST_DEFAULT ? null : effort });
            }}
          >
            <SelectTrigger aria-label="Bot reasoning effort">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={HOST_DEFAULT}>
                Host default ({selected.defaultReasoningEffort})
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
