import { useState } from "react";
import type { EnvironmentId } from "@t3tools/contracts";
import { botConnectionAgents } from "@t3tools/client-runtime/openbot/presentation";
import type { BotConnectionPanelProps as PanelProps } from "./useBotConnections";
import { confirmed } from "./BotConnectionControls";
import { useEnvironmentQuery } from "../../state/query";
import { openbot } from "../../state/openbot";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export function SkillsPanel({
  controller: { state, run, busy, clearSkills },
  allowed,
  environmentId,
  hostId,
}: PanelProps & { environmentId: EnvironmentId; hostId: string }) {
  const query = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "agent.list" } },
    }),
  );
  const agents = botConnectionAgents(query.data);
  const [agentId, setAgentId] = useState("");
  const [skillId, setSkillId] = useState("");
  const remove = async (id: string, modified: boolean) => {
    if (
      await confirmed(
        modified
          ? "Remove this skill, including its local modifications?"
          : "Remove this skill from the bot?",
      )
    )
      await run([
        {
          operation: "skill.uninstall",
          agentId,
          skillId: id,
          ...(modified ? { removeModified: true } : {}),
        },
        { operation: "skill.list", agentId },
      ]);
  };
  return (
    <div className="space-y-3">
      <Button size="sm" variant="outline" disabled={busy} onClick={query.refresh}>
        Refresh bots
      </Button>
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error}
        </p>
      )}
      {agents && (
        <label className="block space-y-1 text-sm">
          <span>Bot</span>
          <Select
            value={agentId}
            disabled={busy}
            onValueChange={(value) => {
              if (value) {
                setAgentId(value);
                clearSkills();
              }
            }}
          >
            <SelectTrigger aria-label="Bot for skills">
              <SelectValue placeholder="Choose a bot" />
            </SelectTrigger>
            <SelectContent>
              {agents.map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      )}
      <Button
        size="sm"
        variant="outline"
        disabled={!allowed || busy || !agentId}
        onClick={() => void run([{ operation: "skill.list", agentId }])}
      >
        Load installed skills
      </Button>
      {agentId && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void run([
              { operation: "skill.install", agentId, skillId: skillId.trim() },
              { operation: "skill.list", agentId },
            ]);
          }}
        >
          <label className="min-w-0 flex-1 space-y-1 text-sm">
            <span>Marketplace skill ID</span>
            <Input
              value={skillId}
              disabled={busy || !allowed}
              onChange={(event) => setSkillId(event.target.value)}
            />
          </label>
          <Button size="sm" type="submit" disabled={!allowed || busy || !skillId.trim()}>
            Install skill
          </Button>
        </form>
      )}
      {state.skills?.length === 0 && (
        <p className="text-sm text-muted-foreground">No installed skills for this bot.</p>
      )}
      {state.skills?.map((skill) => (
        <div key={skill.skillId} className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">
            {skill.name} · {skill.state} · v{skill.installedVersion}
          </p>
          {skill.description && (
            <p className="text-sm text-muted-foreground">{skill.description}</p>
          )}
          {skill.problem && (
            <p role="alert" className="text-sm text-destructive">
              {skill.problem}
            </p>
          )}
          {skill.origin === "workspace" ? (
            <p className="text-sm text-muted-foreground">
              Workspace skills are managed in the bot's files.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!allowed || busy}
                onClick={() =>
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
              >
                {skill.enabled === false ? "Enable" : "Disable"}
              </Button>
              {skill.state === "update-available" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!allowed || busy}
                  onClick={() =>
                    void run([
                      { operation: "skill.install", agentId, skillId: skill.skillId },
                      { operation: "skill.list", agentId },
                    ])
                  }
                >
                  Update skill
                </Button>
              )}
              <Button
                size="sm"
                variant="destructive"
                disabled={!allowed || busy}
                onClick={() => void remove(skill.skillId, skill.state === "modified")}
              >
                Uninstall
              </Button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
