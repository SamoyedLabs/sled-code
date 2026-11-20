import { useState } from "react";
import { Switch, View } from "react-native";
import * as Crypto from "expo-crypto";
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
import { useBotWorkflows } from "./useBotWorkflows";
import { Picker } from "./BotConnectionControls";
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { Sheet } from "../../components/ui/Sheet";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { ListActionRow } from "../../components/ui/ListActionRow";
import { BotWorkflowFlow } from "../bots/BotWorkflowFlow";
import type { GraphPlace } from "../bots/upstream/workflow-flow-tree";
import {
  addableKinds,
  insertAtPlace,
  placeAfter,
  placeKinds,
  type AddableKind,
} from "../bots/upstream/workflow-flow-edit";

type Props = { environmentId: EnvironmentId; hostId: string };
export function BotWorkflows(props: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Button
        label={expanded ? "Close workflows" : "Workflows"}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && <WorkflowPanel key={`${props.environmentId}:${props.hostId}`} {...props} />}
    </View>
  );
}
function confirm(title: string, message: string, action: () => void) {
  Dialog.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: "Continue", style: "destructive", onPress: action },
  ]);
}
function WorkflowPanel({ environmentId, hostId }: Props) {
  const controller = useBotWorkflows(environmentId, hostId, Crypto.randomUUID);
  const [title, setTitle] = useState("");
  const [rename, setRename] = useState("");
  const [nodeId, setNodeId] = useState("");
  const [kind, setKind] = useState("prompt");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [port, setPort] = useState("text");
  const [branch, setBranch] = useState("none");
  const [shownSteps, setShownSteps] = useState(25);
  const [view, setView] = useState<"flow" | "list">("flow");
  const [place, setPlace] = useState<GraphPlace | null>(null);
  const [moving, setMoving] = useState<string | null>(null);
  const [runNodeId, setRunNodeId] = useState("");
  const graph = controller.graph;
  const detail = controller.detail;
  const versionGraph = controller.versionGraph;
  const node = graph?.nodes.find((item) => item.id === nodeId);
  const editing = Boolean(controller.draft && graph && workflowEditable(graph));
  const disabled = controller.busy || !controller.canManage;
  const changeGraph = (next: OpenbotWorkflowGraph) => {
    if (controller.draft) controller.setDraft({ ...controller.draft, graph: next });
  };
  const insert = (kind: AddableKind) => {
    if (!graph || !place || !editing || disabled) return;
    const id = Crypto.randomUUID();
    const created = workflowAddNode(graph, kind, id).nodes.find((item) => item.id === id);
    const next = created && insertAtPlace(graph, place, kind, created, Crypto.randomUUID);
    if (!next) {
      controller.reportError("This step can no longer be added here.");
      return;
    }
    changeGraph(next);
    setNodeId(id);
    setPlace(null);
  };
  const editFlowStep = (id: string, action: "duplicate" | "move") => {
    if (!graph || !editing || disabled) return;
    const source = graph.nodes.find((item) => item.id === id);
    if (!source || source.locked) return;
    const kind = addableKinds.find((item) => item === source.kind);
    if (action === "move" && kind) {
      setMoving(id);
      return;
    }
    if (action !== "duplicate" || graph.nodes.length >= 200) return;
    const copy = {
      ...source,
      id: Crypto.randomUUID(),
      locked: false,
      at: { x: source.at.x + 48, y: source.at.y + 48 },
    };
    const position = placeAfter(graph, source.id);
    const next =
      kind && placeKinds(graph, position, [kind]).length > 0
        ? insertAtPlace(graph, position, kind, copy, Crypto.randomUUID)
        : null;
    changeGraph(next ?? { ...graph, nodes: [...graph.nodes, copy] });
    setNodeId(copy.id);
  };
  const chooseFlowPlace = (target: GraphPlace) => {
    if (!graph || !editing || disabled) return;
    if (!moving) {
      setPlace(target);
      return;
    }
    const source = graph.nodes.find((item) => item.id === moving);
    const kind = addableKinds.find((item) => item === source?.kind);
    const before = graph.edges.filter((edge) => edge.to === moving);
    const after = graph.edges.filter((edge) => edge.from === moving);
    if (
      !source ||
      !kind ||
      source.locked ||
      kind === "condition" ||
      before.length > 1 ||
      after.length > 1
    ) {
      controller.reportError("Move is available for unlocked steps on a single path.");
      setMoving(null);
      return;
    }
    const without = workflowRemoveNode(graph, moving);
    const first = before[0];
    const next = after[0];
    const rejoined = first && next ? workflowConnect(without, { ...first, to: next.to }) : without;
    const moved =
      rejoined && placeKinds(rejoined, target, [kind]).length > 0
        ? insertAtPlace(rejoined, target, kind, source, Crypto.randomUUID)
        : null;
    if (moved) {
      changeGraph(moved);
      setNodeId(source.id);
      setMoving(null);
    } else controller.reportError("Choose a compatible connection or path for this step.");
  };
  const addConnection = () => {
    if (!graph) return;
    const next = workflowConnect(graph, {
      id: Crypto.randomUUID(),
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
    <View className="gap-4">
      {graph && place && editing && (
        <Sheet title="Add a step" onClose={() => setPlace(null)}>
          <ScreenScrollView contentContainerClassName="gap-2 px-5 py-4">
            {placeKinds(graph, place, addableKinds).map((option) => (
              <ListActionRow
                key={option}
                icon="plus"
                label={
                  option === "llm"
                    ? "Model"
                    : option === "agent"
                      ? "Bot"
                      : option[0]!.toUpperCase() + option.slice(1)
                }
                disabled={disabled}
                onPress={() => insert(option)}
              />
            ))}
            {placeKinds(graph, place, addableKinds).length === 0 && (
              <Text className="text-foreground-muted">No supported steps fit here.</Text>
            )}
          </ScreenScrollView>
        </Sheet>
      )}
      <Text className="text-foreground-muted">
        Workflows connect bots, models and decisions. Runs and schedules stay with this bot engine.
      </Text>
      <Button label="Refresh workflows" disabled={controller.busy} onPress={controller.refresh} />
      {controller.loading && <Text accessibilityLiveRegion="polite">Loading workflows…</Text>}
      {controller.error && (
        <Text accessibilityRole="alert" className="text-danger">
          {controller.error}
        </Text>
      )}
      {controller.notice && <Text accessibilityLiveRegion="polite">{controller.notice}</Text>}
      {!controller.canManage && (
        <Text className="text-foreground-muted">
          Settings permission is required to change workflows.
        </Text>
      )}
      <View className="gap-2">
        <Text>New workflow name</Text>
        <AppTextInput
          accessibilityLabel="New workflow name"
          value={title}
          maxLength={160}
          editable={!disabled}
          onChangeText={setTitle}
          className="rounded-xl border border-border bg-grouped-card p-3 text-foreground"
        />
      </View>
      <Button
        label="Create workflow"
        disabled={disabled || !title.trim() || Boolean(controller.draft)}
        onPress={() => void controller.act({ operation: "workflow.create", title: title.trim() })}
      />
      {controller.workflows?.length === 0 && (
        <Text className="text-foreground-muted">No workflows yet.</Text>
      )}
      {controller.workflows?.map((workflow) => (
        <Button
          key={workflow.id}
          label={`${workflow.title} · ${workflow.steps} steps${workflow.lastRun ? ` · ${workflow.lastRun.status}` : ""}`}
          tone={controller.selected === workflow.id ? "primary" : "secondary"}
          disabled={controller.busy || Boolean(controller.draft)}
          onPress={() => {
            controller.select(workflow.id);
            setNodeId("");
            setRunNodeId("");
            setMoving(null);
            setPlace(null);
          }}
        />
      ))}
      {detail && graph && (
        <View className="gap-4">
          <Text accessibilityRole="header" className="font-t3-medium">
            {detail.summary.title}
          </Text>
          <Text className="text-foreground-muted">
            Revision {detail.revision} · {graph.nodes.length} nodes · {graph.edges.length}{" "}
            connections
          </Text>
          {!workflowEditable(graph) && (
            <Text accessibilityLiveRegion="polite">
              This workflow includes a newer node or connection type. Inspect it here; update Sled
              before editing.
            </Text>
          )}
          {!controller.draft && (
            <Button
              label="Edit workflow"
              disabled={disabled || !workflowEditable(graph)}
              onPress={() => controller.setDraft(workflowDraft(detail))}
            />
          )}
          {controller.draft && (
            <View className="gap-2">
              <Button
                label="Save workflow"
                disabled={disabled || !editing || Boolean(controller.draft.conflict)}
                onPress={controller.save}
              />
              <Button
                label="Discard draft"
                disabled={controller.busy}
                onPress={() => controller.setDraft(null)}
              />
            </View>
          )}
          <Button
            label="Run workflow"
            disabled={
              controller.busy ||
              !controller.canRun ||
              Boolean(controller.draft) ||
              !workflowExecutable(graph)
            }
            onPress={() => controller.start("workflow.startRun")}
          />
          <Button
            label="Delete workflow"
            tone="danger"
            disabled={disabled || Boolean(controller.draft)}
            onPress={() =>
              confirm(
                `Delete ${detail.summary.title}?`,
                "This removes the workflow and its history.",
                () =>
                  void controller.act({
                    operation: "workflow.delete",
                    workflowId: detail.summary.id,
                  }),
              )
            }
          />
          {!workflowExecutable(graph) && workflowEditable(graph) && (
            <Text accessibilityLiveRegion="polite">
              This graph includes a step that this upstream engine cannot run yet.
            </Text>
          )}
          {controller.draft && controller.draft.baseRevision !== detail.revision && (
            <Text accessibilityLiveRegion="polite">
              The server has a newer revision. Your draft is retained.
            </Text>
          )}
          {controller.draft?.conflict && (
            <Button
              label={`Discard my changes and use server revision ${controller.draft.conflict.revision}`}
              disabled={controller.busy}
              onPress={() => {
                const conflict = controller.draft?.conflict;
                if (conflict) controller.setDraft(workflowDraft(conflict));
              }}
            />
          )}
          <View className="flex-row gap-2">
            <Button
              label="Flow"
              tone={view === "flow" ? "primary" : "secondary"}
              onPress={() => setView("flow")}
            />
            <Button
              label="List"
              tone={view === "list" ? "primary" : "secondary"}
              onPress={() => setView("list")}
            />
          </View>
          {view === "flow" && (
            <>
              {moving && (
                <View className="flex-row items-center gap-2">
                  <Text className="flex-1">
                    Choose where to move {workflowNodeTitle(graph, moving)}.
                  </Text>
                  <Button label="Cancel move" onPress={() => setMoving(null)} />
                </View>
              )}
              <BotWorkflowFlow
                graph={graph}
                selected={nodeId}
                onSelect={setNodeId}
                onAdd={editing && !disabled ? chooseFlowPlace : undefined}
                onEdit={editing && !disabled ? editFlowStep : undefined}
                onRemove={
                  editing && !disabled
                    ? (id) => {
                        changeGraph(workflowRemoveNode(graph, id));
                        if (nodeId === id) setNodeId("");
                      }
                    : undefined
                }
              />
            </>
          )}
          {view === "list" && (
            <Picker
              label="Workflow step"
              value={nodeId}
              options={graph.nodes.map((item) => ({
                id: item.id,
                name: workflowNodeTitle(graph, item.id),
              }))}
              disabled={controller.busy}
              onChange={setNodeId}
            />
          )}
          {node && (
            <View className="gap-3">
              {node.locked && <Text className="text-foreground-muted">This step is locked.</Text>}
              {Object.entries(node.fields).map(([field, value]) => (
                <View key={field} className="gap-2">
                  {field === "agentId" && typeof value === "string" ? (
                    <Picker
                      label="Assigned bot"
                      value={value}
                      options={controller.agents.map((bot) => ({ id: bot.id, name: bot.name }))}
                      disabled={!editing || disabled || Boolean(node.locked)}
                      onChange={(next) =>
                        changeGraph(workflowSetField(graph, node.id, field, next))
                      }
                    />
                  ) : typeof value === "boolean" ? (
                    <View className="flex-row items-center justify-between gap-3">
                      <Text>{workflowFieldLabel(field)}</Text>
                      <Switch
                        accessibilityLabel={workflowFieldLabel(field)}
                        value={value}
                        disabled={!editing || disabled || Boolean(node.locked)}
                        onValueChange={(next) =>
                          changeGraph(workflowSetField(graph, node.id, field, next))
                        }
                      />
                    </View>
                  ) : (
                    <>
                      <Text>{workflowFieldLabel(field)}</Text>
                      <AppTextInput
                        accessibilityLabel={workflowFieldLabel(field)}
                        value={String(value)}
                        multiline={typeof value === "string"}
                        keyboardType={
                          typeof value === "number" ? "numbers-and-punctuation" : "default"
                        }
                        maxLength={20_000}
                        editable={editing && !disabled && !node.locked}
                        onChangeText={(text) => {
                          const next = typeof value === "number" ? Number(text) : text;
                          if (typeof next === "string" || Number.isFinite(next))
                            changeGraph(workflowSetField(graph, node.id, field, next));
                        }}
                        className="rounded-xl border border-border bg-grouped-card p-3 text-foreground"
                      />
                    </>
                  )}
                </View>
              ))}
              {editing && (
                <Button
                  label={node.locked ? "Unlock step" : "Lock step"}
                  disabled={disabled}
                  onPress={() =>
                    changeGraph({
                      ...graph,
                      nodes: graph.nodes.map((item) =>
                        item.id === node.id ? { ...item, locked: !item.locked } : item,
                      ),
                    })
                  }
                />
              )}
              {node.schedule !== undefined && (
                <Text className="text-foreground-muted">
                  This trigger has a saved schedule. Its complete settings are retained when editing
                  other fields.
                </Text>
              )}
              <Button
                label="Run this step"
                disabled={
                  controller.busy ||
                  !controller.canRun ||
                  Boolean(controller.draft) ||
                  !workflowCanRunNode(node)
                }
                onPress={() => controller.start("workflow.runStep", node.id)}
              />
              <Button
                label="Remove step"
                tone="danger"
                disabled={!editing || disabled || Boolean(node.locked)}
                onPress={() => changeGraph(workflowRemoveNode(graph, node.id))}
              />
            </View>
          )}
          {editing && (
            <View className="gap-3">
              <Picker
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
                label="Add step"
                disabled={disabled}
                onPress={() => {
                  const id = Crypto.randomUUID();
                  changeGraph(workflowAddNode(graph, kind, id));
                  setNodeId(id);
                }}
              />
            </View>
          )}
          {graph.edges.map((edge) => (
            <View key={edge.id} className="gap-2">
              <Text>
                {workflowNodeTitle(graph, edge.from)} → {workflowNodeTitle(graph, edge.to)} ·{" "}
                {edge.type}
                {edge.branch ? ` · ${edge.branch}` : ""}
              </Text>
              {editing && (
                <Button
                  label="Disconnect"
                  disabled={disabled}
                  onPress={() =>
                    changeGraph({
                      ...graph,
                      edges: graph.edges.filter((item) => item.id !== edge.id),
                    })
                  }
                />
              )}
            </View>
          ))}
          {editing && (
            <View className="gap-3">
              <Picker
                label="Connect from"
                value={from}
                options={graph.nodes.map((item) => ({
                  id: item.id,
                  name: workflowNodeTitle(graph, item.id),
                }))}
                disabled={disabled}
                onChange={setFrom}
              />
              <Picker
                label="Connect to"
                value={to}
                options={graph.nodes.map((item) => ({
                  id: item.id,
                  name: workflowNodeTitle(graph, item.id),
                }))}
                disabled={disabled}
                onChange={setTo}
              />
              <Picker
                label="Connection content"
                value={port}
                options={["text", "image", "file"].map((value) => ({ id: value, name: value }))}
                disabled={disabled}
                onChange={setPort}
              />
              <Picker
                label="Condition branch"
                value={branch}
                options={[
                  { id: "none", name: "No condition" },
                  { id: "yes", name: "Yes" },
                  { id: "no", name: "No" },
                ]}
                disabled={disabled}
                onChange={setBranch}
              />
              <Button
                label="Connect steps"
                disabled={disabled || !from || !to}
                onPress={addConnection}
              />
            </View>
          )}
          {detail.triggers.map((trigger) => (
            <Text key={trigger.nodeId} selectable>
              {workflowNodeTitle(graph, trigger.nodeId)} · {trigger.type}
              {trigger.nextDueAt ? ` · next ${trigger.nextDueAt}` : ""}
              {trigger.webhookUrl ? ` · ${trigger.webhookUrl}` : ""}
            </Text>
          ))}
          <Text accessibilityRole="header" className="font-t3-medium">
            Runs
          </Text>
          {controller.runs?.runs.map((run) => (
            <Button
              key={run.run.id}
              label={`Run ${run.run.number} · ${run.run.status} · ${run.run.startedAt}`}
              disabled={controller.busy}
              onPress={() => {
                controller.inspectRun(run.run.id);
                setShownSteps(25);
                setRunNodeId("");
              }}
            />
          ))}
          <View className="gap-2">
            <Button label="Newest runs" disabled={controller.busy} onPress={controller.newest} />
            <Button
              label="Older runs"
              disabled={controller.busy || !controller.runs?.nextBefore}
              onPress={controller.older}
            />
          </View>
          {controller.activeRun && (
            <View className="gap-3">
              <Text>
                Run {controller.activeRun.run.number} · {controller.activeRun.run.status}
              </Text>
              {controller.activeRun.run.error && (
                <Text accessibilityRole="alert" className="text-danger">
                  {controller.activeRun.run.error}
                </Text>
              )}
              {workflowRunCanStop(controller.activeRun.run.status) && (
                <Button
                  label="Stop run"
                  disabled={controller.busy || !controller.canRun}
                  onPress={() => {
                    if (controller.activeRun)
                      void controller.act({
                        operation: "workflow.stopRun",
                        runId: controller.activeRun.run.id,
                      });
                  }}
                />
              )}
              {view === "flow" && (
                <BotWorkflowFlow
                  graph={detail.graph}
                  selected={runNodeId}
                  steps={controller.activeRun.steps}
                  onSelect={setRunNodeId}
                />
              )}
              {(view === "flow"
                ? controller.activeRun.steps.filter((step) => step.nodeId === runNodeId)
                : controller.activeRun.steps.slice(0, shownSteps)
              ).map((step) => (
                <View key={step.id} className="gap-2">
                  <Text>
                    {workflowNodeTitle(graph, step.nodeId)} · {step.status} · attempt {step.attempt}
                  </Text>
                  {step.output && <Text selectable>{step.output}</Text>}
                  {step.error && (
                    <Text selectable className="text-danger">
                      {step.error}
                    </Text>
                  )}
                  {step.status === "approval" && (
                    <View className="gap-2">
                      <Button
                        label="Approve step"
                        disabled={controller.busy || !controller.canRun}
                        onPress={() =>
                          void controller.act({
                            operation: "workflow.decide",
                            stepId: step.id,
                            approved: true,
                          })
                        }
                      />
                      <Button
                        label="Decline step"
                        disabled={controller.busy || !controller.canRun}
                        onPress={() =>
                          void controller.act({
                            operation: "workflow.decide",
                            stepId: step.id,
                            approved: false,
                          })
                        }
                      />
                    </View>
                  )}
                  {workflowRunCanStop(step.status) && (
                    <Button
                      label="Stop step"
                      disabled={controller.busy || !controller.canRun}
                      onPress={() =>
                        void controller.act({ operation: "workflow.stopStep", stepId: step.id })
                      }
                    />
                  )}
                  {["failed", "stopped"].includes(step.status) && (
                    <Button
                      label="Retry step"
                      disabled={controller.busy || !controller.canRun}
                      onPress={() => controller.start("workflow.retryStep", step.id)}
                    />
                  )}
                </View>
              ))}
              {view === "list" && controller.activeRun.steps.length > shownSteps && (
                <Button label="Show more steps" onPress={() => setShownSteps(shownSteps + 25)} />
              )}
            </View>
          )}
          {Boolean(controller.runs?.soloSteps.length) && (
            <View className="gap-3">
              <Text accessibilityRole="header">Individual steps</Text>
              {controller.runs?.soloSteps.map((step) => (
                <View key={step.id} className="gap-2">
                  <Text>
                    {workflowNodeTitle(graph, step.nodeId)} · {step.status} · attempt {step.attempt}
                  </Text>
                  {step.output && <Text selectable>{step.output}</Text>}
                  {step.error && (
                    <Text selectable className="text-danger">
                      {step.error}
                    </Text>
                  )}
                  {step.status === "approval" && (
                    <View className="gap-2">
                      <Button
                        label="Approve step"
                        disabled={controller.busy || !controller.canRun}
                        onPress={() =>
                          void controller.act({
                            operation: "workflow.decide",
                            stepId: step.id,
                            approved: true,
                          })
                        }
                      />
                      <Button
                        label="Decline step"
                        disabled={controller.busy || !controller.canRun}
                        onPress={() =>
                          void controller.act({
                            operation: "workflow.decide",
                            stepId: step.id,
                            approved: false,
                          })
                        }
                      />
                    </View>
                  )}
                  {workflowRunCanStop(step.status) && (
                    <Button
                      label="Stop step"
                      disabled={controller.busy || !controller.canRun}
                      onPress={() =>
                        void controller.act({ operation: "workflow.stopStep", stepId: step.id })
                      }
                    />
                  )}
                  {["failed", "stopped"].includes(step.status) && (
                    <Button
                      label="Retry step"
                      disabled={controller.busy || !controller.canRun}
                      onPress={() => controller.start("workflow.retryStep", step.id)}
                    />
                  )}
                </View>
              ))}
            </View>
          )}
          <View className="gap-2">
            <Text>Rename workflow</Text>
            <AppTextInput
              accessibilityLabel="Rename workflow"
              value={rename}
              editable={!disabled && !controller.draft}
              placeholder={detail.summary.title}
              maxLength={160}
              onChangeText={setRename}
              className="rounded-xl border border-border bg-grouped-card p-3 text-foreground"
            />
            <Button
              label="Rename workflow"
              disabled={disabled || Boolean(controller.draft) || !rename.trim()}
              onPress={() =>
                void controller.act({
                  operation: "workflow.rename",
                  workflowId: detail.summary.id,
                  title: rename.trim(),
                })
              }
            />
          </View>
          <Text accessibilityRole="header" className="font-t3-medium">
            Saved versions
          </Text>
          {controller.versions?.map((version) => (
            <View key={version.id} className="gap-2">
              <Text>
                Revision {version.revision} · {version.kind} · {version.at}
              </Text>
              <Button
                label="Inspect version"
                disabled={controller.busy}
                onPress={() => controller.inspectVersion(version.id)}
              />
              <Button
                label="Restore version"
                disabled={disabled || Boolean(controller.draft)}
                onPress={() =>
                  confirm(
                    `Restore revision ${version.revision}?`,
                    "The current workflow will be kept in version history.",
                    () =>
                      void controller.act({
                        operation: "workflow.restoreVersion",
                        workflowId: detail.summary.id,
                        versionId: version.id,
                      }),
                  )
                }
              />
            </View>
          ))}
          {versionGraph && (
            <View className="gap-2">
              <Text accessibilityRole="header">
                Saved version · {versionGraph.nodes.length} nodes · {versionGraph.edges.length}{" "}
                connections
              </Text>
              {versionGraph.nodes.map((item) => (
                <Text key={item.id} selectable>
                  {workflowNodeTitle(versionGraph, item.id)} ·{" "}
                  {Object.entries(item.fields)
                    .map(([name, value]) => `${workflowFieldLabel(name)}: ${String(value)}`)
                    .join(" · ")}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}
