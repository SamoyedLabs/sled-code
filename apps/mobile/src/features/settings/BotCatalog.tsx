import { useState } from "react";
import { Alert, View } from "react-native";
import type {
  OpenbotRegistryEntry,
  OpenbotCatalogAdminRequest,
} from "@t3tools/contracts/openbot-catalog";
import {
  registryInstall,
  registryConfirmation,
  type CatalogActions,
} from "@t3tools/client-runtime/openbot/catalog";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Picker } from "./BotConnectionControls";
import { useBotCatalog } from "./useBotCatalog";
export function BotCatalog({ actions }: { actions: CatalogActions }) {
  const catalog = useBotCatalog(actions);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<OpenbotRegistryEntry | null>(null);
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [distribution, setDistribution] = useState("");
  const [visible, setVisible] = useState(40);
  const entryCount = catalog.state.entries?.length ?? 0;
  const installedCount = catalog.state.installed?.length ?? 0;
  const showMore = Math.max(entryCount, installedCount) > visible;
  const install = selected ? registryInstall(selected, agentId, distribution, name) : null;
  const mutate = (request: OpenbotCatalogAdminRequest) =>
    Alert.alert("Registry change on selected host", registryConfirmation(request), [
      { text: "Cancel", style: "cancel" },
      { text: "Confirm", onPress: () => void catalog.run(request) },
    ]);
  return (
    <View className="gap-3">
      <Text accessibilityRole="header">ACP registry</Text>
      <Text>
        Commands download and run on the selected host. Host admin and provider-management
        permissions are required. Refresh to check installation progress.
      </Text>
      <Text>Search registry</Text>
      <AppTextInput
        accessibilityLabel="Search registry"
        value={query}
        maxLength={256}
        onChangeText={setQuery}
      />
      <Button
        label="Search registry"
        disabled={catalog.busy || !actions.can({ operation: "registry.search", query })}
        onPress={() => {
          setSelected(null);
          setVisible(40);
          void catalog.run({ operation: "registry.search", query });
        }}
      />
      <Button
        label="Refresh host status"
        disabled={catalog.busy || !actions.can({ operation: "registry.status" })}
        onPress={() => void catalog.run({ operation: "registry.status" })}
      />
      <Button
        label="Refresh installed agents"
        disabled={catalog.busy || !actions.can({ operation: "registry.installed" })}
        onPress={() => void catalog.run({ operation: "registry.installed" })}
      />
      {catalog.error && <Text accessibilityRole="alert">{catalog.error}</Text>}
      {catalog.state.notice && <Text accessibilityLiveRegion="polite">{catalog.state.notice}</Text>}
      {catalog.state.status?.length === 0 && (
        <Text>No in-progress or failed registry operations reported.</Text>
      )}
      {catalog.state.status?.map((item) => (
        <View key={item.registryId}>
          <Text>
            {item.registryId} · {item.state} · {item.message}
          </Text>
          {item.state === "installing" && (
            <Button
              label={`Cancel ${item.registryId}`}
              disabled={
                catalog.busy ||
                catalog.uncertain ||
                !actions.can({ operation: "registry.cancel", registryId: item.registryId })
              }
              onPress={() => mutate({ operation: "registry.cancel", registryId: item.registryId })}
            />
          )}
        </View>
      ))}
      {catalog.state.installed?.length === 0 && <Text>No registry agents installed.</Text>}
      {catalog.state.installed?.slice(0, visible).map((item) => (
        <View key={item.registryId}>
          <Text>
            {item.registryId} · {item.customAgentId} · v{item.version} · {item.distribution}
          </Text>
          <Button
            label={`Remove ${item.registryId}`}
            tone="danger"
            disabled={
              catalog.busy ||
              catalog.uncertain ||
              !actions.can({ operation: "registry.remove", registryId: item.registryId })
            }
            onPress={() => mutate({ operation: "registry.remove", registryId: item.registryId })}
          />
        </View>
      ))}
      {catalog.state.entries?.length === 0 && <Text>No matching registry entries.</Text>}
      {catalog.state.entries?.slice(0, visible).map((entry) => (
        <View key={entry.id} className="gap-2">
          <Text accessibilityRole="header">
            {entry.name} · {entry.id}
          </Text>
          <Text>{entry.description}</Text>
          <Text>
            Available {entry.version} · Installed {entry.installedVersion ?? "none"} · License{" "}
            {entry.license ?? "unspecified"}
          </Text>
          <Button
            label={`Select ${entry.name}`}
            disabled={catalog.busy}
            onPress={() => {
              setSelected(entry);
              setAgentId(entry.customAgentId ?? "");
              setName(entry.name.slice(0, 80));
              setDistribution(entry.distributions[0] ?? "");
            }}
          />
        </View>
      ))}
      {showMore && (
        <Button label="Show more registry entries" onPress={() => setVisible(visible + 40)} />
      )}
      {selected && (
        <View className="gap-2">
          <Text accessibilityRole="header">Install or update {selected.name}</Text>
          <Text>Custom provider ID</Text>
          <AppTextInput
            accessibilityLabel="Custom provider ID"
            value={agentId}
            maxLength={40}
            editable={!selected.customAgentId && !catalog.busy}
            onChangeText={setAgentId}
          />
          <Text>Provider name</Text>
          <AppTextInput
            accessibilityLabel="Provider name"
            value={name}
            maxLength={80}
            onChangeText={setName}
          />
          <Picker
            label="Installation distribution"
            value={distribution}
            options={selected.distributions.map((id) => ({ id, name: id }))}
            disabled={catalog.busy}
            onChange={setDistribution}
          />
          <Text>
            Use a unique lowercase provider ID with letters, digits or hyphens. The host validates
            provider collisions.
          </Text>
          <Button
            label="Confirm install or update"
            disabled={
              !install ||
              catalog.busy ||
              catalog.uncertain ||
              (install !== null && !actions.can(install))
            }
            onPress={() => {
              if (install) mutate(install);
            }}
          />
        </View>
      )}
    </View>
  );
}
