import { BotVault } from "./BotVault";
import { useState } from "react";
import { View } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useBotConnections } from "./useBotConnections";
import { McpPanel } from "./BotMcpConnections";
import { GitHubPanel } from "./BotGitHubConnection";
import { MessagingPanel } from "./BotMessagingConnections";
import { SkillsPanel } from "./BotSkillConnections";
import { Picker } from "./BotConnectionControls";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import { T, useGT } from "gt-react-native";

const choices = [
  { id: "vault", name: "Vault and password managers" },
  { id: "mcp", name: "MCP servers" },
  { id: "github", name: "GitHub" },
  { id: "messaging", name: "Messaging" },
  { id: "skills", name: "Agent skills" },
];
export function BotConnections(props: { environmentId: EnvironmentId; hostId: string }) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Button
        label={expanded ? gt("Close connected tools") : gt("Connected tools")}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && <ConnectionsPanel key={`${props.environmentId}:${props.hostId}`} {...props} />}
    </View>
  );
}
function ConnectionsPanel({
  environmentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
}) {
  const gt = useGT();
  const allowed = useAtomValue(openbot.adminToHost.permissionAtom(environmentId));
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const controller = useBotConnections(async (request) => {
    if (!allowed)
      return { ok: false, error: gt("Settings permission is required to manage connected tools.") };
    const result = await admin({ environmentId, input: { hostId, request } });
    return result._tag === "Failure"
      ? { ok: false, error: String(squashAtomCommandFailure(result)) }
      : { ok: true, value: result.value };
  });
  const [selected, setSelected] = useState("mcp");
  return (
    <View className="gap-4">
      <Picker
        label={gt("Connection type")}
        value={selected}
        options={choices}
        disabled={controller.busy}
        onChange={(value) => {
          setSelected(value);
          controller.clearFeedback();
        }}
      />
      {!allowed && (
        <Text className="text-foreground-muted">
          <T>Settings permission is required to manage these connections.</T>
        </Text>
      )}
      {selected === "vault" && <BotVault environmentId={environmentId} hostId={hostId} />}
      {selected === "mcp" && <McpPanel controller={controller} allowed={allowed} />}
      {selected === "github" && <GitHubPanel controller={controller} allowed={allowed} />}
      {selected === "messaging" && (
        <MessagingPanel
          controller={controller}
          allowed={allowed}
          environmentId={environmentId}
          hostId={hostId}
        />
      )}
      {selected === "skills" && (
        <SkillsPanel
          controller={controller}
          allowed={allowed}
          environmentId={environmentId}
          hostId={hostId}
        />
      )}
      {controller.busy && (
        <Text accessibilityLiveRegion="polite">
          <T>Updating connection…</T>
        </Text>
      )}
      {controller.state.notice && (
        <Text accessibilityLiveRegion="polite">{controller.state.notice}</Text>
      )}
      {controller.error && (
        <Text accessibilityRole="alert" className="text-danger">
          {controller.error}
        </Text>
      )}
    </View>
  );
}
