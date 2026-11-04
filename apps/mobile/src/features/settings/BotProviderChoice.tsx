import { View } from "react-native";
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
import { AppText as Text } from "../../components/ui/AppText";
import { ControlPill } from "../../components/ui/ControlPill";
import { Menu } from "../../components/ui/Menu";

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
    <View className="gap-3">
      <Text>Provider</Text>
      <Menu
        title="Bot provider"
        accessibilityLabel="Choose bot provider"
        actions={options.map((option) => ({
          id: option.id,
          title: option.name,
          state: option.id === value.provider ? "on" : undefined,
          attributes: { disabled },
        }))}
        onPressAction={({ nativeEvent }) => {
          if (!disabled && options.some((option) => option.id === nativeEvent.event))
            onChange({ provider: nativeEvent.event, model: "", reasoningEffort: null });
        }}
      >
        <ControlPill
          label={
            options.find((option) => option.id === value.provider)?.name ?? "Choose a provider"
          }
          disabled={disabled || options.length === 0}
          variant="pill"
        />
      </Menu>
      {provider && (
        <Text className="text-foreground-muted">
          {provider.state}
          {botProviderSetupMessage(provider) ? ` · ${botProviderSetupMessage(provider)}` : ""}
        </Text>
      )}
      <Text>Model</Text>
      <Menu
        title="Bot model"
        accessibilityLabel="Choose bot model"
        actions={modelOptions.map((model) => ({
          id: model.id,
          title: model.name,
          state: model.id === value.model ? "on" : undefined,
          attributes: { disabled },
        }))}
        onPressAction={({ nativeEvent }) => {
          if (!disabled && modelOptions.some((model) => model.id === nativeEvent.event))
            onChange({ ...value, model: nativeEvent.event, reasoningEffort: null });
        }}
      >
        <ControlPill
          label={selected?.name ?? "Choose a model"}
          disabled={disabled || !value.provider || modelOptions.length === 0}
          variant="pill"
        />
      </Menu>
      {value.provider && modelOptions.length === 0 && (
        <Text className="text-foreground-muted">
          No models are available. Complete this provider's setup, then refresh.
        </Text>
      )}
      {selected?.description && (
        <Text className="text-foreground-muted">{selected.description}</Text>
      )}
      {selected && selected.supportedReasoningEfforts.length > 1 && (
        <>
          <Text>Reasoning effort</Text>
          <Menu
            title="Reasoning effort"
            accessibilityLabel="Choose bot reasoning effort"
            actions={[
              {
                id: HOST_DEFAULT,
                title: `Host default (${selected.defaultReasoningEffort})`,
                state: value.reasoningEffort === null ? "on" : undefined,
                attributes: { disabled },
              },
              ...selected.supportedReasoningEfforts.map((effort) => ({
                id: effort,
                title: effort,
                state: effort === value.reasoningEffort ? ("on" as const) : undefined,
                attributes: { disabled },
              })),
            ]}
            onPressAction={({ nativeEvent }) => {
              const effort = nativeEvent.event;
              if (
                !disabled &&
                (effort === HOST_DEFAULT || selected.supportedReasoningEfforts.includes(effort))
              )
                onChange({ ...value, reasoningEffort: effort === HOST_DEFAULT ? null : effort });
            }}
          >
            <ControlPill
              label={value.reasoningEffort ?? `Host default (${selected.defaultReasoningEffort})`}
              disabled={disabled}
              variant="pill"
            />
          </Menu>
        </>
      )}
    </View>
  );
}
