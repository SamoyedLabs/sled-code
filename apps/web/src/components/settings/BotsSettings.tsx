import { Link } from "@tanstack/react-router";
import { BotEnvironment } from "../bots/BotEnvironment";
import { useSettingsScope } from "./SettingsScopeContext";
import { SettingsPageContainer } from "./settingsLayout";

export function BotsSettings() {
  const { connectedEnvironments, search } = useSettingsScope();
  return (
    <SettingsPageContainer>
      <div className="space-y-8">
        <p className="text-sm text-muted-foreground">
          Configure bot engines, providers and maintenance here.{" "}
          <Link to="/bots" search={search}>
            Open the bot workspace
          </Link>{" "}
          for conversations, tasks and approvals.
        </p>
        {connectedEnvironments.length === 0 ? (
          <p>Connect an environment to manage its bots.</p>
        ) : (
          connectedEnvironments.map((environment) => (
            <BotEnvironment
              key={environment.environmentId}
              environmentId={environment.environmentId}
              label={environment.label}
            />
          ))
        )}
      </div>
    </SettingsPageContainer>
  );
}
