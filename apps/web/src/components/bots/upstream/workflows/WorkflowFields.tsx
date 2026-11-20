import { WorkflowWebhookSettings } from "./WorkflowWebhookSettings";
/* oxlint-disable shadcn/no-unknown-classes -- Source node fields, pills and setting rows use workflow-nodes.css. */
import { useRef, useState, type ReactNode } from "react";
import * as Schema from "effect/Schema";
import type { EnvironmentId, OpenbotWorkflowDetail } from "@t3tools/contracts";
import { Menu } from "@base-ui/react/menu";
import { Check, ChevronDown } from "lucide-react";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../../../state/openbot";
import { useEnvironmentQuery } from "../../../../state/query";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { randomUUID } from "../../../../lib/utils";
import { MenuPopup } from "../OpenbotMenu";
import { BotAvatar } from "../../avatar/BotAvatar";
import type { useBotWorkflows } from "../../../settings/useBotWorkflows";
import { decoded, GithubOptions, type WorkflowCatalogs } from "./useWorkflowCatalogs";
import type { CanvasNode, Graph } from "./workflowCanvasModel";
import { WorkflowSchedulePicker } from "./WorkflowSchedulePicker";
const GithubHistory = Schema.Struct({
  deliveries: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      nodeId: Schema.String,
      event: Schema.String,
      receivedAt: Schema.String,
      outcome: Schema.String,
      reason: Schema.NullOr(Schema.String),
    }),
  ),
});
type Fields = CanvasNode["fields"];
type Choice = { value: string; label: string; detail?: string };
export function WorkflowChoice({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly Choice[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [search, setSearch] = useState("");
  const selected = choices.find((choice) => choice.value === value);
  return (
    <Menu.Root
      onOpenChange={(open) => {
        if (!open) setSearch("");
      }}
    >
      <Menu.Trigger className="wfn-row-value wfn-row-choice" disabled={disabled} aria-label={label}>
        <span>{selected?.label ?? (value || `Choose ${label.toLowerCase()}`)}</span>
        <ChevronDown size={12} />
      </Menu.Trigger>
      <MenuPopup align="end">
        <div data-wfn-portal="">
          <input
            className="wfn-picker-search"
            aria-label={`Search ${label}`}
            value={search}
            placeholder="Search…"
            onChange={(event) => setSearch(event.target.value)}
          />
          {choices
            .filter((choice) =>
              `${choice.label} ${choice.detail ?? ""}`.toLowerCase().includes(search.toLowerCase()),
            )
            .map((choice) => (
              <Menu.Item key={choice.value} onClick={() => onChange(choice.value)}>
                <span>
                  {choice.label}
                  {choice.detail && <small>{choice.detail}</small>}
                </span>
                {choice.value === value && <Check size={12} />}
              </Menu.Item>
            ))}
          {choices.length === 0 && <p role="status">No choices available.</p>}
        </div>
      </MenuPopup>
    </Menu.Root>
  );
}
const choices = (values: readonly string[]): Choice[] =>
  values.map((value) => ({
    value,
    label: value
      .split(/[.-]/)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" "),
  }));
const GITHUB_EVENTS = [
  "issue.opened",
  "issue.closed",
  "issue.labeled",
  "pr.opened",
  "pr.updated",
  "pr.reviewRequested",
  "pr.reviewSubmitted",
  "pr.checksFailed",
  "pr.merged",
  "comment",
  "mention",
  "assigned",
];
const GITHUB_ACTIONS = [
  "comment",
  "label.add",
  "label.remove",
  "assign",
  "review.request",
  "review.approve",
  "review.changes",
  "close",
  "reopen",
  "issue.create",
];
const list = (value: unknown) =>
  typeof value === "string"
    ? value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
const label = (name: string, child: ReactNode) => (
  <div className="wfn-row">
    <span className="wfn-row-name">{name}</span>
    {child}
  </div>
);
export function WorkflowFields({
  node,
  graph,
  agents,
  catalogs,
  disabled,
  environmentId,
  hostId,
  workflowId,
  saved,
  onFields,
  onSchedule,
  canRun,
  onRunAccepted,
  savedGraph,
}: {
  node: CanvasNode;
  graph: Graph;
  agents: ReturnType<typeof useBotWorkflows>["agents"];
  catalogs: WorkflowCatalogs;
  disabled: boolean;
  environmentId: EnvironmentId;
  hostId: string;
  workflowId: string;
  saved?: OpenbotWorkflowDetail["triggers"][number] | undefined;
  onFields: (fields: Fields) => void;
  onSchedule: (schedule: Schema.Json) => void;
  canRun: boolean;
  savedGraph: boolean;
  onRunAccepted: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const pending = useRef(false),
    runReceipt = useRef<string | null>(null);
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const set = (key: string, value: string | boolean | number) => onFields({ [key]: value });
  const field = (key: string, fallback = "") => String(node.fields[key] ?? fallback);
  const target = field(
    node.kind === "trigger" ? "trigger" : "target",
    node.kind === "trigger" ? "manual" : "notify",
  );
  const upstream = (() => {
    const visited = new Set<string>(),
      waiting = [node.id];
    while (waiting.length) {
      const id = waiting.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      for (const edge of graph.edges.filter((edge) => edge.to === id)) waiting.push(edge.from);
    }
    return graph.nodes.find(
      (item) => visited.has(item.id) && item.kind === "trigger" && item.fields.trigger === "github",
    );
  })();
  const repository =
    field("repository") === "trigger"
      ? String(upstream?.fields.repository ?? "")
      : field("repository");
  const optionsQuery = useEnvironmentQuery(
    target === "github" && repository
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "settings.workflows-github.options", parameters: { repository } },
          },
        })
      : null,
  );
  const options = decoded(GithubOptions, optionsQuery.data);
  const historyQuery = useEnvironmentQuery(
    node.kind === "trigger" && target === "github"
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "settings.workflows-github.history", parameters: { workflowId } },
          },
        })
      : null,
  );
  const history =
    decoded(GithubHistory, historyQuery.data)?.deliveries.filter(
      (item) => item.nodeId === node.id,
    ) ?? [];
  const pick = (
    key: string,
    name: string,
    values: readonly Choice[],
    fallback = "",
    custom?: (value: string) => void,
  ) =>
    label(
      name,
      <WorkflowChoice
        label={name}
        value={field(key, fallback)}
        choices={values}
        disabled={disabled}
        onChange={custom ?? ((value) => set(key, value))}
      />,
    );
  const input = (key: string, name: string, placeholder = "", maxLength = 20000) =>
    label(
      name,
      <input
        className="wfn-row-value wfn-row-input"
        aria-label={name}
        value={field(key)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        onChange={(event) => set(key, event.target.value)}
      />,
    );
  const multi = (key: string, name: string, values: readonly string[]) => {
    const chosen = list(node.fields[key]);
    return (
      <fieldset className="wfn-settings-block" disabled={disabled}>
        <legend>{name}</legend>
        {[...new Set([...values, ...chosen])].map((value) => (
          <label key={value} className="wfn-row">
            <span>{value}</span>
            <input
              type="checkbox"
              checked={chosen.includes(value)}
              onChange={() =>
                set(
                  key,
                  (chosen.includes(value)
                    ? chosen.filter((item) => item !== value)
                    : [...chosen, value]
                  ).join("\n"),
                )
              }
            />
          </label>
        ))}
      </fieldset>
    );
  };
  const runGithub = async () => {
    if (pending.current || !canRun) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    const requestId = runReceipt.current ?? randomUUID();
    runReceipt.current = requestId;
    try {
      const result = await admin({
        environmentId,
        input: {
          hostId,
          request: {
            operation: "settings.workflows-github.runLastEvent",
            parameters: { workflowId, nodeId: node.id, requestId },
          },
        },
      });
      if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
      else {
        runReceipt.current = null;
        onRunAccepted();
        historyQuery.refresh();
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const model = catalogs.models.find(
    (item) => item.id === field("model") && item.provider === field("provider"),
  );
  const offeredModels = catalogs.models.filter(
    (item) =>
      item.provider === field("provider") ||
      !catalogs.providers.length ||
      catalogs.providers.some(
        (provider) =>
          provider.id === item.provider && !["unavailable", "disabled"].includes(provider.state),
      ),
  );
  const modelPill = (
    <WorkflowChoice
      label="Model"
      value={JSON.stringify([field("provider"), field("model")])}
      choices={offeredModels.map((item) => ({
        value: JSON.stringify([item.provider, item.id]),
        label: item.name,
        detail: item.provider,
      }))}
      disabled={disabled}
      onChange={(value) => {
        const selected = offeredModels.find(
          (item) => JSON.stringify([item.provider, item.id]) === value,
        );
        if (selected)
          onFields({
            model: selected.id,
            provider: selected.provider,
            ...(selected.supportedReasoningEfforts.includes(field("effort"))
              ? {}
              : { effort: selected.defaultReasoningEffort }),
          });
      }}
    />
  );
  const primary =
    node.kind === "agent"
      ? "task"
      : ["llm", "image"].includes(node.kind)
        ? "prompt"
        : node.kind === "condition"
          ? "rule"
          : node.kind === "approval"
            ? "question"
            : "text";
  const specialized = node.kind === "trigger" || node.kind === "output";
  const integrationUnavailable = ["discord", "telegram", "slack", "message", "file"].includes(
    target,
  );
  const supported =
    node.kind === "trigger"
      ? ["manual", "schedule", "webhook", ...(catalogs.github?.connected ? ["github"] : [])]
      : [
          "notify",
          ...(catalogs.connections.some((connection) => connection.places.length)
            ? ["channel"]
            : []),
          ...(catalogs.github?.connected ? ["github"] : []),
        ];
  return (
    <>
      {!specialized && node.kind !== "asset" && (
        <div className="wfn-field wfn-field-task">
          {node.kind === "shape" && (
            <ShapeSurface shape={field("shape", "rectangle")} color={field("color", "ink")} />
          )}
          <textarea
            className={
              node.kind === "text"
                ? "wfn-input wfn-text-input"
                : node.kind === "note"
                  ? "wfn-input wfn-note-input"
                  : node.kind === "shape"
                    ? "wfn-input wfn-shape-input"
                    : "wfn-input"
            }
            data-font={field("font", "sans")}
            data-text-size={field("size", node.kind === "note" ? "2xl" : "lg")}
            data-bold={node.fields.bold ? "" : undefined}
            aria-label={primary}
            placeholder={
              node.kind === "agent"
                ? "What should this agent do?"
                : node.kind === "prompt"
                  ? "Write a prompt…"
                  : primary
            }
            value={field(primary)}
            disabled={disabled}
            maxLength={20000}
            style={{
              ...(node.size?.font ? { fontSize: node.size.font } : {}),
              ...(node.fields.bold ? { fontWeight: 700 } : {}),
              ...(node.fields.align === "center" ||
              node.fields.align === "end" ||
              node.fields.align === "justify"
                ? { textAlign: node.fields.align }
                : {}),
            }}
            onChange={(event) => set(primary, event.target.value)}
          />
          {node.kind === "agent" && (
            <div className="wfn-field-foot">
              <BotAvatar seed={field("agentId", node.id)} size={20} />
              <WorkflowChoice
                label="Agent"
                value={field("agentId")}
                choices={agents.map((agent) => ({ value: agent.id, label: agent.name }))}
                disabled={disabled}
                onChange={(id) => {
                  const agent = agents.find((item) => item.id === id);
                  onFields({ agentId: id, ...(agent ? { provider: agent.provider } : {}) });
                }}
              />
              {modelPill}
            </div>
          )}
          {node.kind === "llm" && (
            <div className="wfn-field-foot">
              {modelPill}
              <WorkflowChoice
                label="Effort"
                value={field("effort")}
                choices={choices(model?.supportedReasoningEfforts ?? [])}
                disabled={disabled || !model?.supportedReasoningEfforts.length}
                onChange={(value) => set("effort", value)}
              />
            </div>
          )}
        </div>
      )}
      {node.kind === "llm" && (
        <div className="wfn-field wfn-field-system">
          <textarea
            className="wfn-input"
            aria-label="System prompt"
            placeholder="Optional system prompt…"
            value={field("system")}
            disabled={disabled}
            maxLength={20000}
            onChange={(event) => set("system", event.target.value)}
          />
        </div>
      )}
      {["text", "note", "shape"].includes(node.kind) && (
        <div className="wfn-toolbar wfn-react-style-tools" data-wfn-portal="">
          {node.kind === "shape" &&
            pick(
              "shape",
              "Shape",
              choices(["rectangle", "circle", "diamond", "triangle", "inverted", "oval", "star"]),
              "rectangle",
            )}
          {pick(
            node.kind === "note" ? "ink" : "color",
            "Color",
            choices(["ink", "yellow", "orange", "red", "pink", "blue", "teal", "green"]),
            "ink",
          )}
          {node.kind === "note" &&
            pick(
              "tone",
              "Paper",
              choices(["yellow", "orange", "red", "pink", "blue", "teal", "green"]),
              "yellow",
            )}
          {node.kind !== "shape" &&
            pick(
              "size",
              "Size",
              choices(node.kind === "note" ? ["lg", "2xl", "3xl", "display"] : ["sm", "lg", "xl"]),
              node.kind === "note" ? "2xl" : "lg",
            )}
          {pick("font", "Font", choices(["sans", "mono"]), "sans")}
          {pick("align", "Align", choices(["start", "center", "end", "justify"]), "start")}
          {label(
            "Bold",
            <input
              type="checkbox"
              checked={Boolean(node.fields.bold)}
              disabled={disabled}
              onChange={(event) => set("bold", event.target.checked)}
            />,
          )}
        </div>
      )}
      {specialized && (
        <div className="wfn-settings-body">
          {pick(
            node.kind === "trigger" ? "trigger" : "target",
            node.kind === "trigger" ? "Trigger" : "Send to",
            choices([...new Set([...supported, target])]),
            target,
            (value) =>
              onFields({
                [node.kind === "trigger" ? "trigger" : "target"]: value,
                ...(value === "github"
                  ? node.kind === "trigger"
                    ? { event: "issue.opened", filters: "notBot" }
                    : { action: "comment", repository: "trigger", item: "event" }
                  : {}),
                ...(value === "schedule"
                  ? {
                      timezone: field("timezone", Intl.DateTimeFormat().resolvedOptions().timeZone),
                    }
                  : {}),
              }),
          )}
          {target === "schedule" && (
            <>
              <WorkflowSchedulePicker
                value={node.schedule}
                disabled={disabled}
                onChange={onSchedule}
              />
              {input("timezone", "Time zone", "America/Chicago")}
              {saved?.nextDueAt &&
                label(
                  "Next run",
                  <time className="wfn-row-value">
                    {new Date(saved.nextDueAt).toLocaleString()}
                  </time>,
                )}
            </>
          )}
          {target === "webhook" && (
            <WorkflowWebhookSettings
              environmentId={environmentId}
              hostId={hostId}
              workflowId={workflowId}
              nodeId={node.id}
              disabled={disabled}
              savedGraph={savedGraph}
              onChanged={onRunAccepted}
            />
          )}
          {target === "notify" && input("title", "Title", "Workflow completed")}
          {target === "channel" && (
            <>
              {label(
                "Channel",
                <WorkflowChoice
                  label="Channel"
                  value={JSON.stringify([field("connectionId"), field("placeId")])}
                  choices={catalogs.connections.flatMap((connection) =>
                    connection.places.map((place) => ({
                      value: JSON.stringify([connection.connectionId, place.id]),
                      label: `${connection.connectionName} · ${place.name}`,
                    })),
                  )}
                  disabled={disabled}
                  onChange={(value) => {
                    for (const connection of catalogs.connections) {
                      const place = connection.places.find(
                        (item) => JSON.stringify([connection.connectionId, item.id]) === value,
                      );
                      if (place)
                        onFields({ connectionId: connection.connectionId, placeId: place.id });
                    }
                  }}
                />,
              )}
              {catalogs.placesError && <p role="alert">{catalogs.placesError}</p>}
            </>
          )}
          {target === "github" && (
            <>
              {pick(
                "repository",
                "Repository",
                [
                  ...(node.kind === "output" ? [{ value: "trigger", label: "From trigger" }] : []),
                  ...(catalogs.github?.repositories.map((item) => ({
                    value: item.fullName,
                    label: item.fullName,
                  })) ?? []),
                ],
                "",
                (value) => onFields({ repository: value, labels: "", person: "" }),
              )}
              {node.kind === "trigger" ? (
                <>
                  {pick("event", "Event", choices(GITHUB_EVENTS), "issue.opened")}
                  {multi(
                    "labels",
                    field("event") === "issue.labeled" ? "Label added" : "Has label",
                    options?.labels.map((item) => item.name) ?? [],
                  )}
                  {multi("filters", "Only when", [
                    "notBot",
                    "firstTime",
                    "title",
                    ...(field("event").startsWith("pr.") ? ["branch"] : []),
                  ])}
                  {list(node.fields.filters).includes("title") &&
                    input("titleText", "Title contains")}
                  {list(node.fields.filters).includes("branch") && input("branch", "Base branch")}
                  <button
                    className="wfn-run"
                    disabled={!canRun || busy || !repository}
                    onClick={() => void runGithub()}
                  >
                    Run last matching event
                  </button>
                  <div className="wfn-settings-block">
                    <h4>Recent events</h4>
                    {history.slice(0, 10).map((item) => (
                      <p key={item.id}>
                        {item.event} · {item.outcome}
                        {item.reason ? ` · ${item.reason}` : ""}{" "}
                        <time>{new Date(item.receivedAt).toLocaleString()}</time>
                      </p>
                    ))}
                    {!history.length && <p>No matching events yet.</p>}
                  </div>
                </>
              ) : (
                <>
                  {pick("item", "On", choices(["event", "input"]), "event")}
                  {pick("action", "Action", choices(GITHUB_ACTIONS), "comment")}
                  {field("action") === "issue.create" && input("title", "Issue title")}
                  {["label.add", "label.remove", "issue.create"].includes(field("action")) && (
                    <>
                      {pick("labelsFrom", "Labels from", choices(["list", "agent"]), "list")}
                      {field("labelsFrom", "list") === "list" &&
                        multi("labels", "Labels", options?.labels.map((item) => item.name) ?? [])}
                    </>
                  )}
                  {["assign", "review.request"].includes(field("action")) &&
                    pick("person", "Person", choices(options?.people ?? []))}
                  {field("action") === "close" &&
                    pick("reason", "Reason", choices(["completed", "notPlanned"]), "completed")}
                  {!upstream &&
                    (field("repository") === "trigger" || field("item", "event") === "event") && (
                      <p role="status">Connect a GitHub trigger to use its repository or item.</p>
                    )}
                </>
              )}
              {(catalogs.githubError || optionsQuery.error || historyQuery.error) && (
                <p role="alert">
                  {catalogs.githubError ?? optionsQuery.error ?? historyQuery.error}
                </p>
              )}
            </>
          )}
          {integrationUnavailable && (
            <>
              <p role="status">These settings are managed on the host computer.</p>
              {Object.entries(node.fields)
                .filter(([key]) => !["trigger", "target"].includes(key))
                .map(([key, value]) => (
                  <div className="wfn-row" data-static="" key={key}>
                    <span className="wfn-row-name">{key}</span>
                    <span className="wfn-row-value">{String(value)}</span>
                  </div>
                ))}
            </>
          )}
        </div>
      )}
      {catalogs.modelsError && ["agent", "llm"].includes(node.kind) && (
        <p role="alert">{catalogs.modelsError}</p>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

// ShapeSurface geometry from WorkflowShapeNode.tsx.
const star = Array.from({ length: 10 }, (_, index) => {
  const reach = index % 2 === 0 ? 1 : 0.4,
    angle = -Math.PI / 2 + (index * Math.PI) / 5;
  return `${(50 + 50 * reach * Math.cos(angle)).toFixed(1)},${(55 + 55 * reach * Math.sin(angle)).toFixed(1)}`;
}).join(" ");
const polygons: Record<string, string> = {
  diamond: "50,0 100,50 50,100 0,50",
  triangle: "50,0 100,100 0,100",
  inverted: "0,0 100,0 50,100",
  star,
};
function ShapeSurface({ shape, color }: { shape: string; color: string }) {
  return polygons[shape] ? (
    <svg
      className="wfn-shape-surface"
      data-shape={shape}
      data-color={color}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon points={polygons[shape]} vectorEffect="non-scaling-stroke" />
    </svg>
  ) : (
    <span className="wfn-shape-surface" data-shape={shape} data-color={color} aria-hidden="true" />
  );
}
