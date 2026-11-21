import { View } from "react-native";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import type { BotConnectionPanelProps as PanelProps } from "./useBotConnections";
import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { botConnectionAgents } from "@t3tools/client-runtime/openbot/presentation";
import { useEnvironmentQuery } from "../../state/query";
import { openbot } from "../../state/openbot";
import { AppTextInput } from "../../components/ui/AppText";
import { confirm, Picker } from "./BotConnectionControls";
import { T, useGT } from "gt-react-native";

export function SkillsPanel({
  controller: { state, run, busy, clearSkills },
  allowed,
  environmentId,
  hostId,
}: PanelProps & { environmentId: EnvironmentId; hostId: string }) {
  const gt = useGT();
  const query = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const agents = botConnectionAgents(query.data);
  const [agentId, setAgentId] = useState("");
  const [skillId, setSkillId] = useState("");
  const [visible, setVisible] = useState(40);
  const remove = (id: string, modified: boolean) =>
    confirm(
      modified
        ? gt("Remove this skill, including its local modifications?")
        : gt("Remove this skill from the bot?"),
      () =>
        void run([
          {
            operation: "skill.uninstall",
            agentId,
            skillId: id,
            ...(modified ? { removeModified: true } : {}),
          },
          { operation: "skill.list", agentId },
        ]),
    );
  return (
    <View className="gap-3">
      <Button label={gt("Refresh bots")} disabled={busy} onPress={query.refresh} />
      {query.error && (
        <Text accessibilityRole="alert" className="text-danger">
          {query.error}
        </Text>
      )}
      {agents && (
        <Picker
          label={gt("Bot for skills")}
          value={agentId}
          options={agents.map((agent) => ({ id: agent.id, name: agent.name }))}
          disabled={busy}
          onChange={(value) => {
            setAgentId(value);
            setVisible(40);
            clearSkills();
          }}
        />
      )}
      <Button
        label={gt("Load installed skills")}
        disabled={!allowed || busy || !agentId}
        onPress={() => void run([{ operation: "skill.list", agentId }])}
      />
      {agentId && (
        <View className="gap-2">
          <Text>
            <T>Marketplace skill ID</T>
          </Text>
          <AppTextInput
            accessibilityLabel={gt("Marketplace skill ID")}
            value={skillId}
            editable={!busy && allowed}
            onChangeText={setSkillId}
          />
          <Button
            label={gt("Install skill")}
            disabled={!allowed || busy || !skillId.trim()}
            onPress={() =>
              void run([
                { operation: "skill.install", agentId, skillId: skillId.trim() },
                { operation: "skill.list", agentId },
              ])
            }
          />
        </View>
      )}
      {state.skills?.length === 0 && (
        <Text className="text-foreground-muted">
          <T>No installed skills for this bot.</T>
        </Text>
      )}
      {state.skills?.slice(0, visible).map((skill) => (
        <View key={skill.skillId} className="gap-2 border-t border-border pt-3">
          <Text className="font-t3-medium">
            {skill.name} · {skill.state} · v{skill.installedVersion}
          </Text>
          {skill.description && <Text className="text-foreground-muted">{skill.description}</Text>}
          {skill.problem && (
            <Text accessibilityRole="alert" className="text-danger">
              {skill.problem}
            </Text>
          )}
          {skill.origin === "workspace" ? (
            <Text className="text-foreground-muted">
              <T>Workspace skills are managed in the bot's files.</T>
            </Text>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={skill.enabled === false ? gt("Enable") : gt("Disable")}
                disabled={!allowed || busy}
                onPress={() =>
                  void run([
                    {
                      operation: "skill.toggle",
                      agentId,
                      skillId: skill.skillId,
                      enabled: skill.enabled === false,
                    },
                    { operation: "skill.list", agentId },
                  ])
                }
              />
              {skill.state === "update-available" && (
                <Button
                  label={gt("Update skill")}
                  disabled={!allowed || busy}
                  onPress={() =>
                    void run([
                      { operation: "skill.install", agentId, skillId: skill.skillId },
                      { operation: "skill.list", agentId },
                    ])
                  }
                />
              )}
              <Button
                label={gt("Uninstall")}
                tone="danger"
                disabled={!allowed || busy}
                onPress={() => remove(skill.skillId, skill.state === "modified")}
              />
            </View>
          )}
        </View>
      ))}
      {state.skills && state.skills.length > visible && (
        <Button label={gt("Show more skills")} onPress={() => setVisible(visible + 40)} />
      )}
    </View>
  );
}
