import { View } from "react-native";
import { useBotChannelGrants, type ChannelGrantsProps } from "./useBotChannelGrants";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Picker } from "./BotConnectionControls";
export function BotChannelGrants(props: ChannelGrantsProps) {
  const vm = useBotChannelGrants(props);
  const disabled = vm.busy || !vm.canManage;
  return (
    <View
      className="gap-3 rounded-xl border border-border p-3"
      accessibilityLabel="Background coding permission"
    >
      <Text className="font-t3-medium">Background coding permission</Text>
      <Text className="text-foreground-muted">
        Allow this bot to delegate a specific channel routine or bot request to Sled while you are
        away. It uses this bot's current coding destination, model and permission limits.
      </Text>
      {!vm.defaults && (
        <Text>Configure this bot's coding delegation before approving background work.</Text>
      )}
      <Picker
        label="Request source"
        value={vm.kind}
        disabled={disabled}
        options={[
          { id: "routine", name: "Channel routine" },
          { id: "agent", name: "Another bot" },
        ]}
        onChange={(value) => {
          if (value === "routine" || value === "agent") vm.setKind(value);
        }}
      />
      <Picker
        label={vm.kind === "routine" ? "Channel routine" : "Requesting bot"}
        value={vm.requester}
        disabled={disabled}
        options={vm.choices}
        onChange={vm.setRequester}
      />
      <Text>Expires after hours (up to 720)</Text>
      <AppTextInput
        accessibilityLabel="Permission duration in hours"
        keyboardType="numeric"
        value={vm.hours}
        editable={!disabled}
        onChangeText={vm.setHours}
      />
      <Button
        label="Approve background coding"
        disabled={disabled || !vm.valid || !vm.defaults}
        onPress={vm.approve}
      />
      <Button label="Refresh permissions" disabled={disabled} onPress={() => void vm.refresh()} />
      {vm.error && (
        <Text accessibilityRole="alert" className="text-danger">
          {vm.error}
        </Text>
      )}
      {vm.grants.map((grant) => (
        <View key={grant.id} className="gap-2">
          <Text>
            {grant.requesterKind}: {grant.requesterId} ·{" "}
            {grant.revoked ? "Revoked" : `Expires ${new Date(grant.expiresAt).toLocaleString()}`}
          </Text>
          <Text className="text-foreground-muted">
            Project {grant.defaults.projectId} · {grant.defaults.modelSelection.model} ·{" "}
            {grant.defaults.runtimeMode}
          </Text>
          <Button
            label="Revoke permission"
            disabled={disabled || grant.revoked}
            onPress={() => void vm.revoke(grant.id)}
          />
        </View>
      ))}
    </View>
  );
}
