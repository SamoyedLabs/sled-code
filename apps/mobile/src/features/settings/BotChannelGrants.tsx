import { View } from "react-native";
import { useBotChannelGrants, type ChannelGrantsProps } from "./useBotChannelGrants";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Picker } from "./BotConnectionControls";
import { T, Var, useGT } from "gt-react-native";
export function BotChannelGrants(props: ChannelGrantsProps) {
  const gt = useGT();
  const vm = useBotChannelGrants(props);
  const disabled = vm.busy || !vm.canManage;
  return (
    <View
      className="gap-3 rounded-xl border border-border p-3"
      accessibilityLabel={gt("Background coding permission")}
    >
      <Text className="font-t3-medium">
        <T>Background coding permission</T>
      </Text>
      <Text className="text-foreground-muted">
        <T>
          Allow this bot to delegate a specific channel routine or bot request to Sled while you are
          away. It uses this bot's current coding destination, model and permission limits.
        </T>
      </Text>
      {!vm.defaults && (
        <Text>
          <T>Configure this bot's coding delegation before approving background work.</T>
        </Text>
      )}
      <Picker
        label={gt("Request source")}
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
        label={vm.kind === "routine" ? gt("Channel routine") : gt("Requesting bot")}
        value={vm.requester}
        disabled={disabled}
        options={vm.choices}
        onChange={vm.setRequester}
      />
      <Text>
        <T>Expires after hours (up to 720)</T>
      </Text>
      <AppTextInput
        accessibilityLabel={gt("Permission duration in hours")}
        keyboardType="numeric"
        value={vm.hours}
        editable={!disabled}
        onChangeText={vm.setHours}
      />
      <Button
        label={gt("Approve background coding")}
        disabled={disabled || !vm.valid || !vm.defaults}
        onPress={vm.approve}
      />
      <Button
        label={gt("Refresh permissions")}
        disabled={disabled}
        onPress={() => void vm.refresh()}
      />
      {vm.error && (
        <Text accessibilityRole="alert" className="text-danger">
          {vm.error}
        </Text>
      )}
      {vm.grants.map((grant) => (
        <View key={grant.id} className="gap-2">
          <Text>
            {grant.requesterKind}: {grant.requesterId} ·{" "}
            {grant.revoked
              ? gt("Revoked")
              : gt("Expires {value}", { value: new Date(grant.expiresAt).toLocaleString() })}
          </Text>
          <Text className="text-foreground-muted">
            <T>
              Project <Var>{grant.defaults.projectId}</Var> ·{" "}
              <Var>{grant.defaults.modelSelection.model}</Var> ·<Var> </Var>
              <Var>{grant.defaults.runtimeMode}</Var>
            </T>
          </Text>
          <Button
            label={gt("Revoke permission")}
            disabled={disabled || grant.revoked}
            onPress={() => void vm.revoke(grant.id)}
          />
        </View>
      ))}
    </View>
  );
}
