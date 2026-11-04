import { BotEnvironment } from "./BotEnvironment";
import { useSettingsScope } from "../settings/SettingsScopeContext";
import { SettingsPageContainer } from "../settings/settingsLayout";

export function BotWorkspace() {
  const { connectedEnvironments, scope } = useSettingsScope();
  return (
    <SettingsPageContainer width="wide">
      <p className="text-sm text-muted-foreground">
        Talk to persistent bots, follow their tasks, and open the coding threads they delegate.
      </p>
      {scope.kind === "unavailable" ? (
        <p role="status">{scope.message}</p>
      ) : connectedEnvironments.length === 0 ? (
        <p role="status">Connect or reconnect an environment to work with its bots.</p>
      ) : (
        connectedEnvironments.map((environment) => (
          <BotEnvironment
            key={environment.environmentId}
            environmentId={environment.environmentId}
            label={environment.label}
            workspace
          />
        ))
      )}
    </SettingsPageContainer>
  );
}
