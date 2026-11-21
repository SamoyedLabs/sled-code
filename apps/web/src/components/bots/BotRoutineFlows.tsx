/* oxlint-disable shadcn/no-unknown-classes -- Pinned DiagramView selectors come from the imported diagram stylesheet. */
import { useState } from "react";
import type {
  EnvironmentId,
  OpenbotRoutineFlowCommand,
  OpenbotRoutineFlowLink,
} from "@t3tools/contracts";
import { routineTriggerDescription } from "@t3tools/client-runtime/openbot/presentation";
import { useBotRoutineFlows, useBotRoutineDiscovery } from "./useBotRoutines";
import { RoutineFlowWorkspace } from "./upstream/diagrams/RoutineFlowWorkspace";
import { BotRoutineCanvas } from "./BotRoutineCanvas";
import {
  RoutineGroup,
  RoutineText,
  RoutineHeading,
  RoutineAction,
  RoutineDisclosure,
  RoutineField,
  RoutineChoice,
} from "./BotEvents";
import { T, Var, useGT } from "gt-react";
type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  workspace?: boolean;
  agentId?: string;
  onCreateRoutine?: (agentId: string) => void;
  onEditRoutine?: (agentId: string, routineId: string) => void;
};
type Agent = { id: string; name: string };
export function BotRoutineFlows(props: Props) {
  const gt = useGT();
  if (props.workspace)
    return props.agentId ? (
      <RoutineFlowWorkspace
        key={`${props.environmentId}:${props.hostId}:${props.agentId}`}
        environmentId={props.environmentId}
        hostId={props.hostId}
        agentId={props.agentId}
        onCreateRoutine={props.onCreateRoutine ?? (() => undefined)}
        onEditRoutine={props.onEditRoutine ?? (() => undefined)}
      />
    ) : (
      <div className="diagram-view diagram-flows-notice">
        <T>Choose an agent in the sidebar to view its routines.</T>
      </div>
    );
  return (
    <RoutineDisclosure label={gt("Inter-agent routine flows")}>
      <CanvasPicker key={`${props.environmentId}:${props.hostId}`} {...props} />
    </RoutineDisclosure>
  );
}
function CanvasPicker(props: Props) {
  const gt = useGT();
  const discovery = useBotRoutineDiscovery(props.environmentId, props.hostId);
  const [selectedAgent, setAgentId] = useState("");
  const agentId =
    discovery.agents.find((agent) => agent.id === selectedAgent)?.id ??
    (props.workspace ? (discovery.agents[0]?.id ?? "") : "");
  return (
    <RoutineGroup>
      <RoutineText>
        <T>Choose a bot to view its routines and connect answers to another bot.</T>
      </RoutineText>
      <RoutineAction label={gt("Refresh bots")} onClick={discovery.refresh} />
      {discovery.error && <RoutineText alert>{discovery.error}</RoutineText>}
      <RoutineChoice
        label={gt("Bot")}
        value={agentId}
        options={discovery.agents.map((agent) => ({ id: agent.id, name: agent.name }))}
        disabled={false}
        onChange={setAgentId}
      />
      {discovery.agents.length === 0 && (
        <RoutineText>
          <T>No visible bots. Create one in the workspace before connecting routine answers.</T>
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
  const gt = useGT();
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
      <RoutineHeading>
        <T>
          <Var>{agentName(agentId)}</Var> routine flows
        </T>
      </RoutineHeading>
      <RoutineAction label={gt("Refresh canvas")} onClick={c.refresh} disabled={c.busy} />
      {c.error && <RoutineText alert>{c.error}</RoutineText>}
      {!canvas && (
        <RoutineText>
          {c.loading ? gt("Loading routine flows…") : gt("No routine flows available.")}
        </RoutineText>
      )}
      {canvas && (
        <RoutineGroup>
          <BotRoutineCanvas
            canvas={canvas}
            agents={agents}
            selected={nodeKey}
            disabled={disabled}
            onSelect={(key) => {
              setNodeKey(key);
              if (key.startsWith("routine:")) {
                const id = key.slice(8);
                setRoutineId(id);
                setFrom(
                  canvas.routines.find((flow) => flow.routine.id === id)?.routine.agentId ??
                    agentId,
                );
              }
              const position = canvas.positions.find((p) => p.nodeKey === key);
              setX(String(position?.x ?? 0));
              setY(String(position?.y ?? 0));
            }}
            onMove={(key, point) => {
              setNodeKey(key);
              setX(String(point.x));
              setY(String(point.y));
              void c.act({
                operation: "routineFlow.savePosition",
                agentId,
                nodeKey: key,
                ...point,
              });
            }}
          />
          <RoutineText>
            <T>
              Placed bots:{" "}
              <Var>{canvas.placedAgentIds.map(agentName).join(", ") || gt("None")}</Var>
            </T>
          </RoutineText>
          {canvas.routines.length === 0 && (
            <RoutineText>
              <T>No routines on this canvas. Create a bot-owned event routine first.</T>
            </RoutineText>
          )}
          <RoutineChoice
            label={gt("Routine")}
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
            label={gt("Send answer from")}
            value={from}
            options={agents}
            disabled={c.busy}
            onChange={setFrom}
          />
          <RoutineChoice
            label={gt("Send answer to")}
            value={to}
            options={agents.filter((agent) => agent.id !== from)}
            disabled={c.busy}
            onChange={setTo}
          />
          <RoutineField
            label={gt("Handoff instructions")}
            value={instruction}
            onChange={setInstruction}
            multiline
            disabled={disabled}
          />
          <RoutineAction
            label={gt("Connect answer handoff")}
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
          <RoutineHeading>
            <T>Answer handoffs</T>
          </RoutineHeading>
          {canvas.links.length === 0 && (
            <RoutineText>
              <T>No answer handoffs connected.</T>
            </RoutineText>
          )}
          {canvas.links.map((link) => (
            <AnswerLink
              key={`${link.id}:${link.instruction}`}
              name={`${agentName(link.fromAgentId)} → ${agentName(link.toAgentId)}`}
              link={link}
              disabled={disabled}
              act={c.act}
            />
          ))}
          <RoutineHeading>
            <T>Runs and results</T>
          </RoutineHeading>
          {canvas.routines.map((flow) => (
            <RoutineGroup key={flow.routine.id}>
              <RoutineText>
                {flow.routine.name || gt("Untitled routine")} ·{" "}
                {flow.routine.active ? gt("Active") : gt("Paused")} ·{" "}
                {routineTriggerDescription(flow.routine.trigger)}
              </RoutineText>
              <RoutineText>
                <T>
                  Upcoming:{" "}
                  <Var>{flow.upcomingRuns.slice(0, 5).join(", ") || gt("None scheduled")}</Var>
                </T>
              </RoutineText>
              {flow.recentRuns.length === 0 && (
                <RoutineText>
                  <T>No recent runs.</T>
                </RoutineText>
              )}
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
                  <RoutineText>
                    <T>
                      Input: <Var>{step.input || gt("No input")}</Var>
                    </T>
                  </RoutineText>
                  <RoutineText>
                    <T>
                      Answer: <Var>{step.output ?? gt("Pending")}</Var>
                    </T>
                  </RoutineText>
                  {step.error && <RoutineText alert>{step.error}</RoutineText>}
                </RoutineGroup>
              ))}
            </RoutineGroup>
          ))}
          <RoutineDisclosure label={gt("Canvas positions")}>
            <RoutineGroup>
              <RoutineChoice
                label={gt("Position a bot or routine")}
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
                label={gt("Horizontal position")}
                value={x}
                onChange={setX}
                disabled={disabled}
              />
              <RoutineField
                label={gt("Vertical position")}
                value={y}
                onChange={setY}
                disabled={disabled}
              />
              {!positionValid && (
                <RoutineText alert>
                  <T>Use finite coordinates between −1,000,000 and 1,000,000.</T>
                </RoutineText>
              )}
              <RoutineAction
                label={gt("Save position")}
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
                label={gt("Remove saved position")}
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
  act: (request: OpenbotRoutineFlowCommand) => Promise<unknown>;
}) {
  const gt = useGT();
  const [text, setText] = useState(link.instruction);
  return (
    <RoutineGroup>
      <RoutineText>{name}</RoutineText>
      <RoutineField
        label={gt("Instructions for {name}", { name })}
        value={text}
        onChange={setText}
        multiline
        disabled={disabled}
      />
      <RoutineAction
        label={gt("Save handoff from {name}", { name })}
        disabled={disabled || text === link.instruction}
        onClick={() =>
          void act({ operation: "routineFlow.updateLink", linkId: link.id, instruction: text })
        }
      />
      <RoutineAction
        label={gt("Disconnect {name}", { name })}
        disabled={disabled}
        onClick={() => void act({ operation: "routineFlow.disconnect", linkId: link.id })}
      />
    </RoutineGroup>
  );
}
