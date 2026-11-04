import { openbotMaintenanceProgress } from "@t3tools/client-runtime/openbot/presentation";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type OpenbotMaintenanceCommand,
  type OpenbotMaintenanceState,
  ProjectId,
  ProviderInstanceId,
  OpenbotMaintenancePolicy,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useProjects } from "../../state/entities";
import { serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const decodePolicy = Schema.decodeUnknownResult(OpenbotMaintenancePolicy);

export function OpenbotMaintenance({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(openbot.maintenance({ environmentId, input: {} }));
  return (
    <section className="space-y-3" aria-label="Upstream maintenance">
      <h3 className="text-sm font-medium">Upstream maintenance</h3>
      <p className="text-sm text-muted-foreground">
        Check new bot engine releases and review changes in a separate workspace. Your decision is
        required before staging. Activation remains a separate step.
      </p>
      <Button variant="outline" size="sm" onClick={query.refresh} disabled={query.isPending}>
        Refresh maintenance
      </Button>
      {query.error && <p role="alert">{query.error}</p>}
      {query.isPending && <p role="status">Loading maintenance…</p>}
      {query.data && (
        <MaintenanceForm
          key={`${environmentId}:${query.data.revision}`}
          environmentId={environmentId}
          state={query.data}
        />
      )}
    </section>
  );
}
function MaintenanceForm({
  environmentId,
  state,
}: {
  environmentId: EnvironmentId;
  state: OpenbotMaintenanceState;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState(state.policy?.enabled ?? false);
  const [projectId, setProjectId] = useState<string>(state.policy?.projectId ?? "");
  const [providerId, setProviderId] = useState<string>(
    state.policy?.modelSelection.instanceId ?? "",
  );
  const [model, setModel] = useState(state.policy?.modelSelection.model ?? "");
  const [baseRef, setBaseRef] = useState(state.policy?.baseRef ?? "HEAD");
  const [interval, setInterval] = useState(String(state.policy?.intervalHours ?? 24));
  const [authority, setAuthority] = useState<string>(state.policy?.authority ?? "check");
  const [platform, setPlatform] = useState<string>(state.policy?.platform ?? "darwin-arm64");
  const [note, setNote] = useState("");
  const projects = useProjects().filter((p) => p.environmentId === environmentId && !p.archivedAt);
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId)) ?? [];
  const command = useAtomCommand(openbot.maintenanceCommand, { reportFailure: false });
  const allowed = useAtomValue(openbot.maintenanceCommand.permissionAtom(environmentId));
  const locked = busy || !allowed;
  async function send(input: OpenbotMaintenanceCommand) {
    if (locked) return;
    setBusy(true);
    setError(null);
    const result = await command({ environmentId, input });
    if (result._tag === "Failure") setError(String(squashAtomCommandFailure(result)));
    setBusy(false);
  }
  function save() {
    if (!enabled && !state.policy) return;
    const decoded = decodePolicy({
      enabled,
      projectId: ProjectId.make(projectId),
      modelSelection: { instanceId: ProviderInstanceId.make(providerId), model },
      baseRef,
      intervalHours: Number(interval),
      authority,
      platform,
    });
    if (Result.isFailure(decoded)) {
      setError(
        "Choose a project, provider, model, platform and check interval from 1 to 720 hours.",
      );
      return;
    }
    void send({ action: "configure", expectedRevision: state.revision, policy: decoded.success });
  }
  return (
    <div className="space-y-3">
      <label className="flex gap-2">
        <input
          type="checkbox"
          checked={enabled}
          disabled={locked}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Enable maintenance
      </label>
      <label className="block text-sm">
        Integration project
        <select
          className="block w-full rounded border p-2"
          value={projectId}
          disabled={locked}
          onChange={(e) => setProjectId(e.target.value)}
        >
          <option value="">Choose project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        Review provider
        <select
          className="block w-full rounded border p-2"
          value={providerId}
          disabled={locked}
          onChange={(e) => {
            setProviderId(e.target.value);
            setModel("");
          }}
        >
          <option value="">Choose provider</option>
          {providers
            .filter((p) => p.enabled && p.installed && p.showInteractionModeToggle)
            .map((p) => (
              <option key={p.instanceId} value={p.instanceId}>
                {p.instanceId}
              </option>
            ))}
        </select>
      </label>
      <label className="block text-sm">
        Review model
        <select
          className="block w-full rounded border p-2"
          value={model}
          disabled={locked}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">Choose model</option>
          {providers
            .find((p) => p.instanceId === providerId)
            ?.models.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}
              </option>
            ))}
        </select>
      </label>
      <label className="block text-sm">
        Integration base branch
        <Input value={baseRef} disabled={locked} onChange={(e) => setBaseRef(e.target.value)} />
      </label>
      <label className="block text-sm">
        Check every (hours)
        <Input
          type="number"
          min={1}
          max={720}
          value={interval}
          disabled={locked}
          onChange={(e) => setInterval(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        Allowed work
        <select
          className="block w-full rounded border p-2"
          value={authority}
          disabled={locked}
          onChange={(e) => setAuthority(e.target.value)}
        >
          <option value="check">Check releases</option>
          <option value="review">Check and review source</option>
          <option value="stage">Check, review and stage after my decision</option>
        </select>
      </label>
      <label className="block text-sm">
        Target platform
        <select
          className="block w-full rounded border p-2"
          value={platform}
          disabled={locked}
          onChange={(e) => setPlatform(e.target.value)}
        >
          {["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"].map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Reviews use plan mode and ask before actions. They cannot authorize activation, profile
        changes, pushes, merges or deployment. Source patches require a separate implementation
        step.
      </p>
      <Button size="sm" onClick={save} disabled={locked}>
        Save policy
      </Button>{" "}
      <Button
        size="sm"
        variant="outline"
        disabled={locked || !state.policy?.enabled}
        onClick={() => void send({ action: "check" })}
      >
        Check now
      </Button>
      {state.policy && (
        <Button
          size="sm"
          variant="outline"
          disabled={locked}
          onClick={() =>
            void send({ action: "configure", expectedRevision: state.revision, policy: null })
          }
        >
          Disable and clear policy
        </Button>
      )}
      {error && <p role="alert">{error}</p>}
      {state.lastError && <p role="alert">{state.lastError}</p>}
      {state.nextCheckAt && <p className="text-xs">Next check: {state.nextCheckAt}</p>}
      <label className="block text-sm">
        Decision note
        <Input value={note} onChange={(e) => setNote(e.target.value)} disabled={locked} />
      </label>
      {state.proposals.map((p) => (
        <article className="space-y-2 rounded border p-3" key={p.id}>
          <p className="font-medium">
            {p.release.version} · {openbotMaintenanceProgress(p)}
          </p>
          <p className="text-xs break-all">Source: {p.release.releaseCommit}</p>
          <p className="text-xs break-all">
            Download: {p.release.assets.find((a) => a.platform === p.platform)?.sha256}
          </p>
          <p className="text-xs">
            Compatibility still requires validation.{" "}
            {p.stagedAt ? `Staged ${p.stagedAt}` : "Not staged"}
          </p>
          {p.reviewThreadId && (
            <Link
              to="/$environmentId/$threadId"
              params={{ environmentId, threadId: p.reviewThreadId }}
              className="text-sm text-primary underline underline-offset-4"
            >
              Open review thread
            </Link>
          )}
          {p.report && (
            <>
              <p className="whitespace-pre-wrap text-sm">{p.report.sourceComparison}</p>
              <p className="whitespace-pre-wrap text-sm">{p.report.findings}</p>
              {p.report.evidence.map((e) => (
                <p className="text-xs break-all" key={`${e.kind}:${e.artifact}`}>
                  {e.kind}: {e.outcome} · {e.artifact}
                </p>
              ))}
              <p className="text-sm">{p.report.decisionRequest}</p>
            </>
          )}
          {p.decision && <p className="text-sm">Your decision: {p.decision.note}</p>}
          {(p.state === "proposed" || p.state === "review-queued") && (
            <Button
              size="sm"
              disabled={locked || !state.policy?.enabled || state.policy.authority === "check"}
              onClick={() => void send({ action: "review", proposalId: p.id })}
            >
              {p.state === "proposed" ? "Review source" : "Retry review launch"}
            </Button>
          )}
          {p.state === "decision-required" && (
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={locked || !note.trim()}
                onClick={() =>
                  void send({
                    action: "decide",
                    proposalId: p.id,
                    expectedRevision: state.revision,
                    accept: true,
                    note,
                  })
                }
              >
                Accept review
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={locked || !note.trim()}
                onClick={() =>
                  void send({
                    action: "decide",
                    proposalId: p.id,
                    expectedRevision: state.revision,
                    accept: false,
                    note,
                  })
                }
              >
                Reject release
              </Button>
            </div>
          )}
          {p.state === "accepted" && !p.stagedAt && (
            <Button
              size="sm"
              disabled={locked || !state.policy?.enabled || state.policy.authority !== "stage"}
              onClick={() => void send({ action: "stage", proposalId: p.id })}
            >
              Stage reviewed release
            </Button>
          )}
        </article>
      ))}
    </div>
  );
}
