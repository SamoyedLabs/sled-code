import { useState } from "react";
import type {
  EnvironmentId,
  OpenbotRoutineFlowCommand,
  OpenbotRoutineFlowLink,
} from "@t3tools/contracts";
import { routineTriggerDescription } from "@t3tools/client-runtime/openbot/presentation";
import { useBotRoutineFlows, useBotRoutineDiscovery } from "./useBotRoutines";
import {
  RoutineGroup,
  RoutineText,
  RoutineHeading,
  RoutineAction,
  RoutineDisclosure,
  RoutineField,
  RoutineChoice,
} from "./BotEvents";
type Props = { environmentId: EnvironmentId; hostId: string };
type Agent = { id: string; name: string };
export function BotRoutineFlows(props: Props) {
  return (
    <RoutineDisclosure label="Inter-agent routine flows">
      <CanvasPicker key={`${props.environmentId}:${props.hostId}`} {...props} />
    </RoutineDisclosure>
  );
}
function CanvasPicker(props: Props) {
  const discovery = useBotRoutineDiscovery(props.environmentId, props.hostId);
  const [agentId, setAgentId] = useState("");
  return (
    <RoutineGroup>
      <RoutineText>
        Choose a bot to view its routines and connect answers to another bot.
      </RoutineText>
      <RoutineAction label="Refresh bots" onClick={discovery.refresh} />
      {discovery.error && <RoutineText alert>{discovery.error}</RoutineText>}
      <RoutineChoice
        label="Canvas bot"
        value={agentId}
        options={discovery.agents.map((agent) => ({ id: agent.id, name: agent.name }))}
        disabled={false}
        onChange={setAgentId}
      />
      {discovery.agents.length === 0 && (
        <RoutineText>
          No visible bots. Create one in the workspace before connecting routine answers.
        </RoutineText>
      )}
      {discovery.agents.some((agent) => agent.id === agentId) && (
        <FlowPanel
          key={`${props.hostId}:${agentId}`}
          {...props}
          agentId={agentId}
          agents={discovery.agents}
        />
      )}
    </RoutineGroup>
  );
}
function FlowPanel({
  environmentId,
  hostId,
  agentId,
  agents,
}: Props & { agentId: string; agents: readonly Agent[] }) {
  const c = useBotRoutineFlows(environmentId, hostId, agentId);
  const [routineId, setRoutineId] = useState("");
  const [from, setFrom] = useState(agentId);
  const [to, setTo] = useState("");
  const [instruction, setInstruction] = useState("");
  const [nodeKey, setNodeKey] = useState(`agent:${agentId}`);
  const [x, setX] = useState("0");
  const [y, setY] = useState("0");
  const disabled = c.busy || !c.canWrite;
  const canvas = c.canvas;
  const agentName = (id: string) =>
    agents.find((agent) => agent.id === id)?.name || "Unavailable bot";
  const selected = canvas?.routines.find((flow) => flow.routine.id === routineId);
  const nodeOptions = [
    ...agents.map((agent) => ({ id: `agent:${agent.id}`, name: `Bot · ${agent.name}` })),
    ...(canvas?.routines ?? []).map((flow) => ({
      id: `routine:${flow.routine.id}`,
      name: `Routine · ${flow.routine.name || "Untitled routine"}`,
    })),
  ];
  const positionValid =
    x.trim() !== "" &&
    y.trim() !== "" &&
    Number.isFinite(Number(x)) &&
    Number.isFinite(Number(y)) &&
    Math.abs(Number(x)) <= 1000000 &&
    Math.abs(Number(y)) <= 1000000;
  return (
    <RoutineGroup>
      <RoutineHeading>{agentName(agentId)} routine flows</RoutineHeading>
      <RoutineText>
        Changes require permission to manage every bot in the flow. Cycles and unavailable bots are
        rejected by the host.
      </RoutineText>
      <RoutineAction label="Refresh canvas" onClick={c.refresh} disabled={c.busy} />
      {c.error && <RoutineText alert>{c.error}</RoutineText>}
      {!canvas && (
        <RoutineText>
          Canvas unavailable. Check the engine connection and bot visibility.
        </RoutineText>
      )}
      {canvas && (
        <RoutineGroup>
          <RoutineText>
            Placed bots: {canvas.placedAgentIds.map(agentName).join(", ") || "None"}
          </RoutineText>
          {canvas.routines.length === 0 && (
            <RoutineText>
              No routines on this canvas. Create a bot-owned event routine first.
            </RoutineText>
          )}
          <RoutineChoice
            label="Routine"
            value={routineId}
            options={canvas.routines.map((flow) => ({
              id: flow.routine.id,
              name: `${flow.routine.name || "Untitled routine"} · ${agentName(flow.routine.agentId)}`,
            }))}
            disabled={c.busy}
            onChange={(id) => {
              const flow = canvas.routines.find((entry) => entry.routine.id === id);
              setRoutineId(id);
              setFrom(flow?.routine.agentId || agentId);
              setTo("");
              setInstruction("");
            }}
          />
          <RoutineChoice
            label="Send answer from"
            value={from}
            options={agents}
            disabled={c.busy}
            onChange={setFrom}
          />
          <RoutineChoice
            label="Send answer to"
            value={to}
            options={agents.filter((agent) => agent.id !== from)}
            disabled={c.busy}
            onChange={setTo}
          />
          <RoutineField
            label="Handoff instructions"
            value={instruction}
            onChange={setInstruction}
            multiline
            disabled={disabled}
          />
          <RoutineAction
            label="Connect answer handoff"
            disabled={
              disabled ||
              !selected ||
              !agents.some((agent) => agent.id === from) ||
              !agents.some((agent) => agent.id === to) ||
              from === to
            }
            onClick={() =>
              void c.act({
                operation: "routineFlow.connect",
                routineId,
                fromAgentId: from,
                toAgentId: to,
                instruction,
              })
            }
          />
          <RoutineHeading>Answer handoffs</RoutineHeading>
          {canvas.links.length === 0 && <RoutineText>No answer handoffs connected.</RoutineText>}
          {canvas.links.map((link) => (
            <AnswerLink
              key={`${link.id}:${link.instruction}`}
              name={`${agentName(link.fromAgentId)} → ${agentName(link.toAgentId)}`}
              link={link}
              disabled={disabled}
              act={c.act}
            />
          ))}
          <RoutineHeading>Runs and results</RoutineHeading>
          {canvas.routines.map((flow) => (
            <RoutineGroup key={flow.routine.id}>
              <RoutineText>
                {flow.routine.name || "Untitled routine"} ·{" "}
                {flow.routine.active ? "Active" : "Paused"} ·{" "}
                {routineTriggerDescription(flow.routine.trigger)}
              </RoutineText>
              <RoutineText>
                Upcoming: {flow.upcomingRuns.slice(0, 5).join(", ") || "None scheduled"}
              </RoutineText>
              {flow.recentRuns.length === 0 && <RoutineText>No recent runs.</RoutineText>}
              {flow.recentRuns.map((run) => (
                <RoutineGroup key={run.id}>
                  <RoutineText>
                    {run.status} · {run.scheduledFor}
                  </RoutineText>
                  {run.error && <RoutineText alert>{run.error}</RoutineText>}
                </RoutineGroup>
              ))}
              {flow.steps.map((step) => (
                <RoutineGroup key={step.id}>
                  <RoutineText>
                    {agentName(step.agentId)} · {step.status}
                  </RoutineText>
                  <RoutineText>Input: {step.input || "No input"}</RoutineText>
                  <RoutineText>Answer: {step.output ?? "Pending"}</RoutineText>
                  {step.error && <RoutineText alert>{step.error}</RoutineText>}
                </RoutineGroup>
              ))}
            </RoutineGroup>
          ))}
          <RoutineDisclosure label="Canvas positions">
            <RoutineGroup>
              <RoutineChoice
                label="Position a bot or routine"
                value={nodeKey}
                options={nodeOptions}
                disabled={c.busy}
                onChange={(key) => {
                  setNodeKey(key);
                  const position = canvas.positions.find((entry) => entry.nodeKey === key);
                  setX(String(position?.x ?? 0));
                  setY(String(position?.y ?? 0));
                }}
              />
              <RoutineField
                label="Horizontal position"
                value={x}
                onChange={setX}
                disabled={disabled}
              />
              <RoutineField
                label="Vertical position"
                value={y}
                onChange={setY}
                disabled={disabled}
              />
              {!positionValid && (
                <RoutineText alert>
                  Use finite coordinates between −1,000,000 and 1,000,000.
                </RoutineText>
              )}
              <RoutineAction
                label="Save position"
                disabled={
                  disabled || !positionValid || !nodeOptions.some((option) => option.id === nodeKey)
                }
                onClick={() =>
                  void c.act({
                    operation: "routineFlow.savePosition",
                    agentId,
                    nodeKey,
                    x: Number(x),
                    y: Number(y),
                  })
                }
              />
              <RoutineAction
                label="Remove saved position"
                disabled={
                  disabled || !canvas.positions.some((position) => position.nodeKey === nodeKey)
                }
                onClick={() =>
                  void c.act({ operation: "routineFlow.removePosition", agentId, nodeKey })
                }
              />
            </RoutineGroup>
          </RoutineDisclosure>
        </RoutineGroup>
      )}
    </RoutineGroup>
  );
}
function AnswerLink({
  name,
  link,
  disabled,
  act,
}: {
  name: string;
  link: typeof OpenbotRoutineFlowLink.Type;
  disabled: boolean;
  act: (request: OpenbotRoutineFlowCommand) => Promise<void>;
}) {
  const [text, setText] = useState(link.instruction);
  return (
    <RoutineGroup>
      <RoutineText>{name}</RoutineText>
      <RoutineField
        label={`Instructions for ${name}`}
        value={text}
        onChange={setText}
        multiline
        disabled={disabled}
      />
      <RoutineAction
        label={`Save handoff from ${name}`}
        disabled={disabled || text === link.instruction}
        onClick={() =>
          void act({ operation: "routineFlow.updateLink", linkId: link.id, instruction: text })
        }
      />
      <RoutineAction
        label={`Disconnect ${name}`}
        disabled={disabled}
        onClick={() => void act({ operation: "routineFlow.disconnect", linkId: link.id })}
      />
    </RoutineGroup>
  );
}
