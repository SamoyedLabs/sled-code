import { useState } from "react";
import type { EnvironmentId, OpenbotWorkflowGraph } from "@t3tools/contracts";
import {
  workflowCanRunNode,
  workflowExecutable,
  workflowFieldLabel,
  workflowDraft,
  workflowEditable,
  workflowSetField,
  workflowAddNode,
  workflowRemoveNode,
  workflowConnect,
  workflowNodeTitle,
  workflowRunCanStop,
  WORKFLOW_NODE_CHOICES,
} from "@t3tools/client-runtime/openbot/presentation";
import { randomUUID } from "../../lib/utils";
import { useBotWorkflows } from "./useBotWorkflows";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { requestConfirmDialog } from "../../confirmDialog";

type Props = { environmentId: EnvironmentId; hostId: string };
export function BotWorkflows(props: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="space-y-3" aria-label="Bot workflows">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Close workflows" : "Workflows"}
      </Button>
      {expanded && <WorkflowPanel key={`${props.environmentId}:${props.hostId}`} {...props} />}
    </section>
  );
}
function Choice({
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { id: string; name: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <Select
        value={value || "__none"}
        disabled={disabled}
        onValueChange={(next) => {
          if (next) onChange(next === "__none" ? "" : next);
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Choose…</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
async function confirm(message: string) {
  return (
    (await requestConfirmDialog(message, { variant: "destructive" })) ?? window.confirm(message)
  );
}
function WorkflowPanel({ environmentId, hostId }: Props) {
  const controller = useBotWorkflows(environmentId, hostId, () => randomUUID());
  const [title, setTitle] = useState("");
  const [rename, setRename] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [kind, setKind] = useState("prompt");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [port, setPort] = useState("text");
  const [branch, setBranch] = useState("");
  const [shownSteps, setShownSteps] = useState(25);
  const graph = controller.graph;
  const detail = controller.detail;
  const versionGraph = controller.versionGraph;
  const node = graph?.nodes.find((item) => item.id === nodeId);
  const editing = Boolean(controller.draft && graph && workflowEditable(graph));
  const disabled = controller.busy || !controller.canManage;
  const changeGraph = (next: OpenbotWorkflowGraph) => {
    if (controller.draft) controller.setDraft({ ...controller.draft, graph: next });
  };
  const addConnection = () => {
    if (!graph) return;
    const next = workflowConnect(graph, {
      id: randomUUID(),
      from,
      to,
      type: port,
      ...(branch === "yes" || branch === "no" ? { branch } : {}),
    });
    if (next) changeGraph(next);
    else
      controller.reportError(
        "Choose compatible steps and content. A condition needs a Yes or No branch.",
      );
  };
  return (
    <div className="space-y-4" aria-busy={controller.busy}>
      <p className="text-sm text-muted-foreground">
        Workflows connect bots, models and decisions. Runs and schedules stay with this bot engine.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={controller.busy} onClick={controller.refresh}>
          Refresh workflows
        </Button>
      </div>
      {controller.loading && <p role="status">Loading workflows…</p>}
      {controller.error && (
        <p role="alert" className="text-sm text-destructive">
          {controller.error}
        </p>
      )}
      {controller.notice && (
        <p role="status" className="text-sm">
          {controller.notice}
        </p>
      )}
      {!controller.canManage && (
        <p className="text-sm text-muted-foreground">
          Settings permission is required to change workflows.
        </p>
      )}
      <label className="block space-y-1 text-sm">
        <span>New workflow name</span>
        <Input
          value={title}
          maxLength={160}
          disabled={disabled}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      <Button
        size="sm"
        disabled={disabled || !title.trim() || Boolean(controller.draft)}
        onClick={() => void controller.act({ operation: "workflow.create", title: title.trim() })}
      >
        Create workflow
      </Button>
      {controller.workflows?.length === 0 && (
        <p className="text-sm text-muted-foreground">No workflows yet.</p>
      )}
      <ul className="space-y-2">
        {controller.workflows?.map((workflow) => (
          <li key={workflow.id}>
            <Button
              variant={controller.selected === workflow.id ? "default" : "outline"}
              size="sm"
              disabled={controller.busy || Boolean(controller.draft)}
              onClick={() => {
                controller.select(workflow.id);
                setNodeId("");
              }}
            >
              {workflow.title} · {workflow.steps} steps
              {workflow.lastRun ? ` · ${workflow.lastRun.status}` : ""}
            </Button>
          </li>
        ))}
      </ul>
      {detail && graph && (
        <div className="space-y-4">
          <h3 className="text-base font-medium">{detail.summary.title}</h3>
          <p className="text-sm text-muted-foreground">
            Revision {detail.revision} · {graph.nodes.length} nodes · {graph.edges.length}{" "}
            connections
          </p>
          {!workflowEditable(graph) && (
            <p role="status" className="text-sm">
              This workflow includes a newer node or connection type. Inspect it here; update Sled
              before editing.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!controller.draft && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || !workflowEditable(graph)}
                onClick={() => controller.setDraft(workflowDraft(detail))}
              >
                Edit workflow
              </Button>
            )}
            {controller.draft && (
              <>
                <Button
                  size="sm"
                  disabled={disabled || !editing || Boolean(controller.draft.conflict)}
                  onClick={controller.save}
                >
                  Save workflow
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={controller.busy}
                  onClick={() => controller.setDraft(null)}
                >
                  Discard draft
                </Button>
              </>
            )}
            <Button
              size="sm"
              disabled={
                controller.busy ||
                !controller.canRun ||
                Boolean(controller.draft) ||
                !workflowExecutable(graph)
              }
              onClick={() => controller.start("workflow.startRun")}
            >
              Run workflow
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={disabled || Boolean(controller.draft)}
              onClick={() => {
                void confirm(`Delete ${detail.summary.title} and its workflow history?`).then(
                  (approved) => {
                    if (approved)
                      void controller.act({
                        operation: "workflow.delete",
                        workflowId: detail.summary.id,
                      });
                  },
                );
              }}
            >
              Delete workflow
            </Button>
          </div>
          {!workflowExecutable(graph) && workflowEditable(graph) && (
            <p role="status" className="text-sm">
              This graph includes a step that this upstream engine cannot run yet.
            </p>
          )}
          {controller.draft && controller.draft.baseRevision !== detail.revision && (
            <p role="status" className="text-sm">
              The server has a newer revision. Your draft is retained.
            </p>
          )}
          {controller.draft?.conflict && (
            <Button
              variant="outline"
              size="sm"
              disabled={controller.busy}
              onClick={() => {
                const conflict = controller.draft?.conflict;
                if (conflict) controller.setDraft(workflowDraft(conflict));
              }}
            >
              Discard my changes and use server revision {controller.draft.conflict.revision}
            </Button>
          )}
          <Choice
            label="Workflow step"
            value={nodeId}
            options={graph.nodes.map((item) => ({
              id: item.id,
              name: workflowNodeTitle(graph, item.id),
            }))}
            disabled={controller.busy}
            onChange={setNodeId}
          />
          {node && (
            <div className="space-y-3">
              {node.locked && <p className="text-sm text-muted-foreground">This step is locked.</p>}
              {Object.entries(node.fields).map(([field, value]) => (
                <div key={field} className="block space-y-1 text-sm">
                  <span>{workflowFieldLabel(field)}</span>
                  {field === "agentId" && typeof value === "string" ? (
                    <Choice
                      label="Assigned bot"
                      value={value}
                      options={controller.agents.map((bot) => ({ id: bot.id, name: bot.name }))}
                      disabled={!editing || disabled || Boolean(node.locked)}
                      onChange={(next) =>
                        changeGraph(workflowSetField(graph, node.id, field, next))
                      }
                    />
                  ) : typeof value === "boolean" ? (
                    <input
                      aria-label={workflowFieldLabel(field)}
                      type="checkbox"
                      checked={value}
                      disabled={!editing || disabled || Boolean(node.locked)}
                      onChange={(event) =>
                        changeGraph(workflowSetField(graph, node.id, field, event.target.checked))
                      }
                    />
                  ) : typeof value === "number" ? (
                    <Input
                      aria-label={workflowFieldLabel(field)}
                      type="number"
                      value={value}
                      disabled={!editing || disabled || Boolean(node.locked)}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next))
                          changeGraph(workflowSetField(graph, node.id, field, next));
                      }}
                    />
                  ) : (
                    <Textarea
                      aria-label={workflowFieldLabel(field)}
                      value={value}
                      rows={3}
                      maxLength={20_000}
                      disabled={!editing || disabled || Boolean(node.locked)}
                      onChange={(event) =>
                        changeGraph(workflowSetField(graph, node.id, field, event.target.value))
                      }
                    />
                  )}
                </div>
              ))}
              {editing && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    changeGraph({
                      ...graph,
                      nodes: graph.nodes.map((item) =>
                        item.id === node.id ? { ...item, locked: !item.locked } : item,
                      ),
                    })
                  }
                >
                  {node.locked ? "Unlock step" : "Lock step"}
                </Button>
              )}
              {node.schedule !== undefined && (
                <p className="text-sm text-muted-foreground">
                  This trigger has a saved schedule. Its complete settings are retained when editing
                  other fields.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    controller.busy ||
                    !controller.canRun ||
                    Boolean(controller.draft) ||
                    !workflowCanRunNode(node)
                  }
                  onClick={() => controller.start("workflow.runStep", node.id)}
                >
                  Run this step
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!editing || disabled || Boolean(node.locked)}
                  onClick={() => changeGraph(workflowRemoveNode(graph, node.id))}
                >
                  Remove step
                </Button>
              </div>
            </div>
          )}
          {editing && (
            <div className="space-y-3">
              <Choice
                label="New step type"
                value={kind}
                options={WORKFLOW_NODE_CHOICES.filter(
                  (value) => value !== "asset" && value !== "image",
                ).map((value) => ({
                  id: value,
                  name: value === "llm" ? "Model" : value === "agent" ? "Bot" : value,
                }))}
                disabled={disabled}
                onChange={setKind}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => {
                  const id = randomUUID();
                  changeGraph(workflowAddNode(graph, kind, id));
                  setNodeId(id);
                }}
              >
                Add step
              </Button>
            </div>
          )}
          <ul className="space-y-2 text-sm">
            {graph.edges.map((edge) => (
              <li key={edge.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span>
                    {workflowNodeTitle(graph, edge.from)} → {workflowNodeTitle(graph, edge.to)} ·{" "}
                    {edge.type}
                    {edge.branch ? ` · ${edge.branch}` : ""}
                  </span>
                  {editing && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        changeGraph({
                          ...graph,
                          edges: graph.edges.filter((item) => item.id !== edge.id),
                        })
                      }
                    >
                      Disconnect
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {editing && (
            <div className="space-y-3">
              <Choice
                label="Connect from"
                value={from}
                options={graph.nodes.map((item) => ({
                  id: item.id,
                  name: workflowNodeTitle(graph, item.id),
                }))}
                disabled={disabled}
                onChange={setFrom}
              />
              <Choice
                label="Connect to"
                value={to}
                options={graph.nodes.map((item) => ({
                  id: item.id,
                  name: workflowNodeTitle(graph, item.id),
                }))}
                disabled={disabled}
                onChange={setTo}
              />
              <Choice
                label="Connection content"
                value={port}
                options={["text", "image", "file"].map((value) => ({ id: value, name: value }))}
                disabled={disabled}
                onChange={setPort}
              />
              <Choice
                label="Condition branch"
                value={branch}
                options={[
                  { id: "yes", name: "Yes" },
                  { id: "no", name: "No" },
                ]}
                disabled={disabled}
                onChange={setBranch}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={disabled || !from || !to}
                onClick={addConnection}
              >
                Connect steps
              </Button>
            </div>
          )}
          {detail.triggers.map((trigger) => (
            <p key={trigger.nodeId} className="break-words text-sm">
              {workflowNodeTitle(graph, trigger.nodeId)} · {trigger.type}
              {trigger.nextDueAt ? ` · next ${trigger.nextDueAt}` : ""}
              {trigger.webhookUrl ? ` · ${trigger.webhookUrl}` : ""}
            </p>
          ))}
          <h3 className="text-base font-medium">Runs</h3>
          <ul className="space-y-2">
            {controller.runs?.runs.map((run) => (
              <li key={run.run.id}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={controller.busy}
                  onClick={() => {
                    controller.inspectRun(run.run.id);
                    setShownSteps(25);
                  }}
                >
                  Run {run.run.number} · {run.run.status} · {run.run.startedAt}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={controller.busy}
              onClick={controller.newest}
            >
              Newest runs
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={controller.busy || !controller.runs?.nextBefore}
              onClick={controller.older}
            >
              Older runs
            </Button>
          </div>
          {controller.activeRun && (
            <div className="space-y-3">
              <p className="text-sm">
                Run {controller.activeRun.run.number} · {controller.activeRun.run.status}
              </p>
              {controller.activeRun.run.error && (
                <p role="alert" className="text-sm text-destructive">
                  {controller.activeRun.run.error}
                </p>
              )}
              {workflowRunCanStop(controller.activeRun.run.status) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={controller.busy || !controller.canRun}
                  onClick={() => {
                    if (controller.activeRun)
                      void controller.act({
                        operation: "workflow.stopRun",
                        runId: controller.activeRun.run.id,
                      });
                  }}
                >
                  Stop run
                </Button>
              )}
              <ol className="space-y-4">
                {controller.activeRun.steps.slice(0, shownSteps).map((step) => (
                  <li key={step.id} className="space-y-2">
                    <p className="text-sm">
                      {workflowNodeTitle(graph, step.nodeId)} · {step.status} · attempt{" "}
                      {step.attempt}
                    </p>
                    {step.output && (
                      <p className="whitespace-pre-wrap break-words text-sm">{step.output}</p>
                    )}
                    {step.error && (
                      <p className="whitespace-pre-wrap break-words text-sm text-destructive">
                        {step.error}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {step.status === "approval" && (
                        <>
                          <Button
                            size="sm"
                            disabled={controller.busy || !controller.canRun}
                            onClick={() =>
                              void controller.act({
                                operation: "workflow.decide",
                                stepId: step.id,
                                approved: true,
                              })
                            }
                          >
                            Approve step
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={controller.busy || !controller.canRun}
                            onClick={() =>
                              void controller.act({
                                operation: "workflow.decide",
                                stepId: step.id,
                                approved: false,
                              })
                            }
                          >
                            Decline step
                          </Button>
                        </>
                      )}
                      {workflowRunCanStop(step.status) && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={controller.busy || !controller.canRun}
                          onClick={() =>
                            void controller.act({ operation: "workflow.stopStep", stepId: step.id })
                          }
                        >
                          Stop step
                        </Button>
                      )}
                      {["failed", "stopped"].includes(step.status) && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={controller.busy || !controller.canRun}
                          onClick={() => controller.start("workflow.retryStep", step.id)}
                        >
                          Retry step
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {controller.activeRun.steps.length > shownSteps && (
                <Button variant="outline" size="sm" onClick={() => setShownSteps(shownSteps + 25)}>
                  Show more steps
                </Button>
              )}
            </div>
          )}
          {Boolean(controller.runs?.soloSteps.length) && (
            <div className="space-y-3">
              <h3 className="text-base font-medium">Individual steps</h3>
              {controller.runs?.soloSteps.map((step) => (
                <div key={step.id} className="space-y-2">
                  <p className="text-sm">
                    {workflowNodeTitle(graph, step.nodeId)} · {step.status} · attempt {step.attempt}
                  </p>
                  {step.output && (
                    <p className="whitespace-pre-wrap break-words text-sm">{step.output}</p>
                  )}
                  {step.error && (
                    <p className="whitespace-pre-wrap break-words text-sm text-destructive">
                      {step.error}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {step.status === "approval" && (
                      <>
                        <Button
                          size="sm"
                          disabled={controller.busy || !controller.canRun}
                          onClick={() =>
                            void controller.act({
                              operation: "workflow.decide",
                              stepId: step.id,
                              approved: true,
                            })
                          }
                        >
                          Approve step
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={controller.busy || !controller.canRun}
                          onClick={() =>
                            void controller.act({
                              operation: "workflow.decide",
                              stepId: step.id,
                              approved: false,
                            })
                          }
                        >
                          Decline step
                        </Button>
                      </>
                    )}
                    {workflowRunCanStop(step.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={controller.busy || !controller.canRun}
                        onClick={() =>
                          void controller.act({ operation: "workflow.stopStep", stepId: step.id })
                        }
                      >
                        Stop step
                      </Button>
                    )}
                    {["failed", "stopped"].includes(step.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={controller.busy || !controller.canRun}
                        onClick={() => controller.start("workflow.retryStep", step.id)}
                      >
                        Retry step
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <label className="block space-y-1 text-sm">
            <span>Rename workflow</span>
            <Input
              value={rename}
              disabled={disabled || Boolean(controller.draft)}
              placeholder={detail.summary.title}
              maxLength={160}
              onChange={(event) => setRename(event.target.value)}
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled || Boolean(controller.draft) || !rename.trim()}
            onClick={() =>
              void controller.act({
                operation: "workflow.rename",
                workflowId: detail.summary.id,
                title: rename.trim(),
              })
            }
          >
            Rename workflow
          </Button>
          <h3 className="text-base font-medium">Saved versions</h3>
          <ul className="space-y-2">
            {controller.versions?.map((version) => (
              <li key={version.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">
                    Revision {version.revision} · {version.kind} · {version.at}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={controller.busy}
                    onClick={() => controller.inspectVersion(version.id)}
                  >
                    Inspect version
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled || Boolean(controller.draft)}
                    onClick={() => {
                      void confirm(
                        `Restore revision ${version.revision}? The current workflow will be kept in version history.`,
                      ).then((approved) => {
                        if (approved)
                          void controller.act({
                            operation: "workflow.restoreVersion",
                            workflowId: detail.summary.id,
                            versionId: version.id,
                          });
                      });
                    }}
                  >
                    Restore version
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          {versionGraph && (
            <div className="space-y-2" aria-label="Saved version preview">
              <p className="text-sm">
                Saved version · {versionGraph.nodes.length} nodes · {versionGraph.edges.length}{" "}
                connections
              </p>
              <ul className="space-y-1 text-sm">
                {versionGraph.nodes.map((item) => (
                  <li key={item.id}>
                    {workflowNodeTitle(versionGraph, item.id)} ·{" "}
                    {Object.entries(item.fields)
                      .map(([name, value]) => `${workflowFieldLabel(name)}: ${String(value)}`)
                      .join(" · ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
