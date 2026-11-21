/* oxlint-disable react/no-array-index-key -- Source filter rows retain positional identity while their text is edited. */
/* oxlint-disable shadcn/no-unknown-classes -- Source diagram and settings field selectors. */
import { useState } from "react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, OpenbotRoutineFlowCanvas } from "@t3tools/contracts";
import { Plus, X, Copy } from "lucide-react";
import { SourceButton } from "../settings/SettingsParts";
import { useSourceSettingsAdmin } from "../settings/useSourceSettingsAdmin";
import {
  eventFilterDraft,
  eventFiltersFromDrafts,
  eventFilterDraftsValid,
} from "../settings/routine-event-filter";
import { confirmed } from "../../../settings/BotConnectionControls";
import { namedClipboardTarget, useCopyToClipboard } from "../../../../hooks/useCopyToClipboard";
import { Link } from "@tanstack/react-router";
import { useAgentSettingsValue } from "../settings/agent-settings-api";
type Routine = (typeof OpenbotRoutineFlowCanvas.Type)["routines"][number]["routine"];
const obj = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
export function DiagramWebhookConfig({
  environmentId,
  hostId,
  routine,
  onRefresh,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  routine: Routine;
  onRefresh: () => void;
}) {
  const api = useSourceSettingsAdmin(environmentId, hostId),
    owner = { kind: "agent" as const, id: routine.agentId };
  const [eventType, setEventType] = useState(
      routine.trigger.kind === "webhook" ? (routine.trigger.eventType ?? "") : "",
    ),
    [filters, setFilters] = useState(() =>
      routine.trigger.kind === "webhook" ? routine.trigger.filters.map(eventFilterDraft) : [],
    ),
    [secret, setSecret] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const { copyToClipboard } = useCopyToClipboard({
    target: namedClipboardTarget("webhook details"),
    onError: (error) => setError(error.message),
  });
  const endpoint = useAgentSettingsValue(async () => {
    if (!api.can({ operation: "events.configuration", owner, id: routine.id }))
      throw new Error("Webhook settings permission is required on this host.");
    const configuration = await api.execute({
      operation: "events.configuration",
      owner,
      id: routine.id,
    });
    const value = obj(configuration);
    const actualOwner = obj(value?.owner);
    if (
      value?.id !== routine.id ||
      actualOwner?.kind !== "agent" ||
      actualOwner.id !== routine.agentId
    )
      throw new Error("The endpoint belongs to another routine.");
    const url = typeof value?.webhookUrl === "string" ? value.webhookUrl : null;
    const usesSledConnect = value?.relayService === "sled-connect";
    return { url, usesSledConnect };
  }, `${environmentId}:${hostId}:${routine.id}:${routine.updatedAt}`);
  const { url = null, usesSledConnect = false } = endpoint.value ?? {};
  if (routine.trigger.kind !== "webhook") return null;
  const changed =
    (eventType.trim() || null) !== routine.trigger.eventType ||
    JSON.stringify(eventFiltersFromDrafts(filters)) !== JSON.stringify(routine.trigger.filters);
  const input = {
    owner,
    id: routine.id,
    name: routine.name,
    instruction: routine.instruction,
    active: routine.active,
    timezone: routine.timezone,
    trigger: {
      kind: "webhook" as const,
      eventType: eventType.trim() || null,
      filters: eventFiltersFromDrafts(filters),
    },
    ...(routine.limitPolicy ? { limitPolicy: routine.limitPolicy } : {}),
  };
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      await action();
      onRefresh();
    });
    if (settled._tag === "Failure") {
      const e = squashAtomCommandFailure(settled);
      setError(e instanceof Error ? e.message : "The webhook change failed.");
    }
    setBusy(false);
  };
  return (
    <section className="diagram-inspector-section">
      <h3 className="diagram-inspector-section-title">Webhook</h3>
      <p className="diagram-inspector-muted">
        {endpoint.busy && !endpoint.value
          ? "Checking connection…"
          : usesSledConnect
            ? url
              ? "Public webhook URL provided by Sled Connect."
              : "Connect this hosting computer to Sled Connect to receive external webhooks."
            : "Update this bot host to enable Sled Connect webhooks."}
      </p>
      {!url && (
        <p className="diagram-inspector-muted">
          Scheduled routines and manual tests remain available.
        </p>
      )}
      {usesSledConnect && !url && (
        <Link to="/settings/connections">Open Sled Connect settings</Link>
      )}
      <SourceButton
        variant="ghost"
        disabled={busy || endpoint.busy}
        aria-label="Check webhook connection"
        onClick={() => void endpoint.refresh()}
      >
        Check connection
      </SourceButton>
      {url && (
        <div className="routine-connection-row">
          <code className="diagram-webhook-url">{url}</code>
          <SourceButton
            variant="ghost"
            aria-label="Copy webhook URL"
            onClick={() => copyToClipboard(url, undefined)}
          >
            <Copy />
          </SourceButton>
        </div>
      )}
      <label className="diagram-inspector-section">
        Event type
        <input
          className="ui-input"
          value={eventType}
          placeholder="Any event"
          disabled={busy}
          onChange={(e) => setEventType(e.target.value)}
        />
      </label>
      {filters.map((filter, index) => (
        <div className="diagram-inspector-section" key={index}>
          <label>
            JSON pointer
            <input
              className="ui-input"
              value={filter.pointer}
              disabled={busy}
              onChange={(e) =>
                setFilters((old) =>
                  old.map((f, i) => (i === index ? { ...f, pointer: e.target.value } : f)),
                )
              }
            />
          </label>
          <label>
            Value
            <input
              className="ui-input"
              value={filter.value}
              disabled={busy}
              onChange={(e) =>
                setFilters((old) =>
                  old.map((f, i) => (i === index ? { ...f, value: e.target.value } : f)),
                )
              }
            />
          </label>
          <SourceButton
            variant="ghost"
            disabled={busy}
            aria-label="Remove filter"
            onClick={() => setFilters((old) => old.filter((_, i) => i !== index))}
          >
            <X />
          </SourceButton>
        </div>
      ))}
      <SourceButton
        variant="ghost"
        disabled={busy || filters.length >= 32}
        onClick={() => setFilters((old) => [...old, { pointer: "", value: "" }])}
      >
        <Plus />
        Add filter
      </SourceButton>
      {changed && (
        <SourceButton
          disabled={
            busy ||
            !eventFilterDraftsValid(filters) ||
            !api.can({ operation: "events.save", ...input })
          }
          onClick={() => void run(() => api.execute({ operation: "events.save", ...input }))}
        >
          Save webhook
        </SourceButton>
      )}
      <SourceButton
        variant="ghost"
        disabled={busy || !api.can({ operation: "events.rotateSecret", owner, id: routine.id })}
        onClick={() =>
          void run(async () => {
            if (
              !(await confirmed(
                "Regenerate the webhook signing secret? Existing senders must use the new secret.",
              ))
            )
              return;
            const result = obj(
              await api.execute({ operation: "events.rotateSecret", owner, id: routine.id }),
            );
            if (typeof result?.secret !== "string")
              throw new Error("The host did not return the new signing secret.");
            setSecret(result.secret);
          })
        }
      >
        Regenerate secret
      </SourceButton>
      {secret && (
        <div>
          <p>Copy this secret now. The host will not return it again.</p>
          <code>{secret}</code>
          <SourceButton
            aria-label="Copy webhook secret"
            onClick={() => copyToClipboard(secret, undefined)}
          >
            Copy secret
          </SourceButton>
          <SourceButton variant="ghost" onClick={() => setSecret(null)}>
            Dismiss secret
          </SourceButton>
        </div>
      )}
      {(error || endpoint.error) && <p role="alert">{error ?? endpoint.error}</p>}
    </section>
  );
}
