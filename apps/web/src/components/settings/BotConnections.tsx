import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useBotConnections } from "./useBotConnections";
import { McpPanel } from "./BotMcpConnections";
import { GitHubPanel } from "./BotGitHubConnection";
import { MessagingPanel } from "./BotMessagingConnections";
import { SkillsPanel } from "./BotSkillConnections";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

const choices = [
  { id: "mcp", name: "MCP servers" },
  { id: "github", name: "GitHub" },
  { id: "messaging", name: "Messaging" },
  { id: "skills", name: "Agent skills" },
] as const;

export function BotConnections(props: { environmentId: EnvironmentId; hostId: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="space-y-3" aria-label="Bot connections">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Close connected tools" : "Connected tools"}
      </Button>
      {expanded && <ConnectionsPanel key={`${props.environmentId}:${props.hostId}`} {...props} />}
    </section>
  );
}
function ConnectionsPanel({
  environmentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
}) {
  const allowed = useAtomValue(openbot.adminToHost.permissionAtom(environmentId));
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const controller = useBotConnections(async (request) => {
    if (!allowed)
      return { ok: false, error: "Settings permission is required to manage connected tools." };
    const result = await admin({ environmentId, input: { hostId, request } });
    return result._tag === "Failure"
      ? { ok: false, error: String(squashAtomCommandFailure(result)) }
      : { ok: true, value: result.value };
  });
  const [selected, setSelected] = useState<string>("mcp");
  return (
    <div className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span>Connection type</span>
        <Select
          value={selected}
          disabled={controller.busy}
          onValueChange={(value) => {
            if (value) {
              setSelected(value);
              controller.clearFeedback();
            }
          }}
        >
          <SelectTrigger aria-label="Connection type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {choices.map((choice) => (
              <SelectItem key={choice.id} value={choice.id}>
                {choice.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {!allowed && (
        <p className="text-sm text-muted-foreground">
          Settings permission is required to manage these connections.
        </p>
      )}
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
        <p role="status" className="text-sm">
          Updating connection…
        </p>
      )}
      {controller.state.notice && (
        <p role="status" className="text-sm">
          {controller.state.notice}
        </p>
      )}
      {controller.error && (
        <p role="alert" className="text-sm text-destructive">
          {controller.error}
        </p>
      )}
    </div>
  );
}
