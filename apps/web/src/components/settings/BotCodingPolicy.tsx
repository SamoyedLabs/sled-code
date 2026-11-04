import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import {
  AuthOrchestrationOperateScope,
  type EnvironmentId,
  type OpenbotCodingPolicyState,
  type RuntimeMode,
} from "@t3tools/contracts";
import {
  botCodingPolicyChoice,
  botCodingPolicyDefaults,
  botCodingPolicyView,
} from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useEnvironments } from "../../state/environments";
import { useEnvironmentsWithScope } from "../../state/session";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type Props = { environmentId: EnvironmentId; hostId: string; agentId: string };
const modes: readonly { id: RuntimeMode; label: string }[] = [
  { id: "approval-required", label: "Ask before actions" },
  { id: "auto-accept-edits", label: "Allow edits" },
  { id: "auto", label: "Automatic" },
  { id: "full-access", label: "Full access" },
];
export function BotCodingPolicy(props: Props) {
  const query = useEnvironmentQuery(
    openbot.codingPolicy({
      environmentId: props.environmentId,
      input: { hostId: props.hostId, agentId: props.agentId },
    }),
  );
  const state = botCodingPolicyView(query.data);
  return (
    <section className="space-y-3" aria-label="Coding delegation">
      <p className="text-sm font-medium">Coding delegation</p>
      <p className="text-sm text-muted-foreground">
        Send coding assignments to Sled. Browsing, reminders and other general tasks stay with this
        bot. Enabling installs managed guidance in the bot's instructions; disabling removes that
        guidance.
      </p>
      <Button size="sm" variant="outline" disabled={query.isPending} onClick={query.refresh}>
        Refresh coding policy
      </Button>
      {query.isPending && (
        <p role="status" className="text-sm">
          Checking coding policy…
        </p>
      )}
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error}
        </p>
      )}
      {state && (
        <PolicyForm
          key={`${props.environmentId}:${props.hostId}:${props.agentId}:${state.revision}:${state.status}`}
          {...props}
          state={state}
          refresh={query.refresh}
        />
      )}
    </section>
  );
}
function PolicyForm({
  environmentId,
  hostId,
  agentId,
  state,
  refresh,
}: Props & { state: OpenbotCodingPolicyState; refresh: () => void }) {
  const [choice, setChoice] = useState(() =>
    botCodingPolicyChoice(environmentId, state.pending?.defaults ?? state.defaults),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { environments } = useEnvironments();
  const authorized = useEnvironmentsWithScope(environments, AuthOrchestrationOperateScope);
  const destinations = environments.filter(
    (row) => authorized.has(row.environmentId) && row.connection.phase === "connected",
  );
  const destination = destinations.find((row) => row.environmentId === choice.destinationId);
  const projects = useProjects();
  const providers =
    useAtomValue(
      serverEnvironment.providersValueAtom(destination?.environmentId ?? environmentId),
    ) ?? [];
  const visibleProjects = projects.filter(
    (row) => row.environmentId === destination?.environmentId && !row.archivedAt,
  );
  const visibleProviders = providers.filter(
    (row) => row.enabled && row.installed && (row.status === "ready" || row.status === "warning"),
  );
  const provider = visibleProviders.find((row) => row.instanceId === choice.instanceId);
  const defaults = botCodingPolicyDefaults(environmentId, choice, {
    authorizedEnvironmentIds: new Set(destinations.map((row) => row.environmentId)),
    projects,
    providers,
  });
  const allowed = useAtomValue(openbot.codingPolicyEnable.permissionAtom(environmentId));
  const disableAllowed = useAtomValue(openbot.codingPolicyDisable.permissionAtom(environmentId));
  const enable = useAtomCommand(openbot.codingPolicyEnable, { reportFailure: false });
  const disable = useAtomCommand(openbot.codingPolicyDisable, { reportFailure: false });
  const locked = busy || !allowed || state.status === "pending";
  const save = async () => {
    const target = state.pending?.action === "enable" ? state.pending.defaults : defaults;
    if (!target || !allowed || busy) return;
    setBusy(true);
    setError(null);
    const result = await enable({
      environmentId,
      input: { hostId, agentId, expectedRevision: state.revision, defaults: target },
    });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    setBusy(false);
    refresh();
  };
  const remove = async () => {
    if (!disableAllowed || busy) return;
    setBusy(true);
    setError(null);
    const result = await disable({
      environmentId,
      input: { hostId, agentId, expectedRevision: state.revision },
    });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    setBusy(false);
    refresh();
  };
  const select = (
    label: string,
    value: string,
    options: readonly { id: string; label: string }[],
    onChange: (value: string) => void,
  ) => (
    <label className="block space-y-1 text-sm">
      <span>{label}</span>
      <Select
        value={value}
        disabled={locked}
        onValueChange={(value) => {
          if (value) onChange(value);
        }}
      >
        <SelectTrigger aria-label={label}>
          <SelectValue placeholder={`Choose ${label.toLowerCase()}`} />
        </SelectTrigger>
        <SelectContent>
          {options.map((row) => (
            <SelectItem key={row.id} value={row.id}>
              {row.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
  return (
    <div className="space-y-3">
      <p role="status" className="text-sm">
        Policy: {state.status}
      </p>
      {select(
        "Destination machine",
        choice.destinationId,
        destinations.map((row) => ({ id: row.environmentId, label: row.label })),
        (value) =>
          setChoice({ ...choice, destinationId: value, projectId: "", instanceId: "", model: "" }),
      )}
      {select(
        "Project",
        choice.projectId,
        visibleProjects.map((row) => ({ id: row.id, label: row.title })),
        (value) => setChoice({ ...choice, projectId: value }),
      )}
      {select(
        "Provider",
        choice.instanceId,
        visibleProviders.map((row) => ({
          id: row.instanceId,
          label: row.displayName ?? row.driver,
        })),
        (value) => setChoice({ ...choice, instanceId: value, model: "" }),
      )}
      {select(
        "Model",
        choice.model,
        provider?.models.map((row) => ({ id: row.slug, label: row.name })) ?? [],
        (value) => setChoice({ ...choice, model: value }),
      )}
      {select("Permissions", choice.runtimeMode, modes, (value) => {
        const mode = modes.find((row) => row.id === value);
        if (mode) setChoice({ ...choice, runtimeMode: mode.id });
      })}
      {select(
        "Mode",
        choice.interactionMode,
        [
          { id: "default", label: "Work" },
          ...(destination?.environmentId === environmentId &&
          provider?.showInteractionModeToggle === true
            ? [{ id: "plan", label: "Plan" }]
            : []),
        ],
        (value) => {
          if (value === "default" || value === "plan")
            setChoice({ ...choice, interactionMode: value });
        },
      )}
      {select(
        "Workspace",
        choice.workspaceMode,
        [
          { id: "worktree", label: "New worktree" },
          { id: "root", label: "Project checkout" },
        ],
        (value) => {
          if (value === "worktree" || value === "root")
            setChoice({ ...choice, workspaceMode: value });
        },
      )}
      {choice.workspaceMode === "worktree" && (
        <label className="block space-y-1 text-sm">
          <span>Base branch or revision</span>
          <Input
            value={choice.baseRef}
            disabled={locked}
            onChange={(event) => setChoice({ ...choice, baseRef: event.target.value })}
          />
        </label>
      )}
      <p className="text-xs text-muted-foreground">
        The bot needs an existing full-access Sled connection. This policy does not expand grants.
        Destination and launch permissions are checked again when work starts.
      </p>
      {state.status === "conflict" && (
        <p role="alert" className="text-sm text-destructive">
          The managed guidance was edited or moved ambiguously. Review the bot's instructions and
          restore the managed block before changing this policy. Other instructions have been
          preserved.
        </p>
      )}
      {state.pending && (
        <p className="text-sm">
          A previous {state.pending.action} is unsettled. Retry that action to reconcile it before
          changing its intent.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={
            !allowed ||
            busy ||
            state.status === "conflict" ||
            state.pending?.action === "disable" ||
            (!defaults && state.pending?.action !== "enable")
          }
          onClick={() => void save()}
        >
          {state.pending?.action === "enable"
            ? "Retry enabling"
            : state.status === "enabled"
              ? "Update coding policy"
              : "Enable coding delegation"}
        </Button>
        {state.status !== "disabled" && (
          <Button
            size="sm"
            variant="outline"
            disabled={
              !disableAllowed ||
              busy ||
              state.status === "conflict" ||
              state.pending?.action === "enable"
            }
            onClick={() => void remove()}
          >
            {state.pending?.action === "disable" ? "Retry disabling" : "Disable coding delegation"}
          </Button>
        )}
      </div>
      {state.managedBlock && (
        <details>
          <summary className="text-sm">Managed guidance for review</summary>
          <Textarea value={state.managedBlock} readOnly aria-label="Managed coding guidance" />
        </details>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
