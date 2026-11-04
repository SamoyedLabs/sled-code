import { useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotAdminRequest } from "@t3tools/contracts";
import {
  customProviderEndpoints,
  customAcpAgents,
  customEndpointRequest,
  customAcpRequest,
  customRuntimeNotice,
  type BotCustomEndpointDraft,
  type BotCustomAcpDraft,
  type BotCustomSecret,
} from "@t3tools/client-runtime/openbot/presentation";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { requestConfirmDialog } from "../../confirmDialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";

type Draft =
  | { kind: "endpoint"; value: BotCustomEndpointDraft }
  | { kind: "acp"; editing: boolean; value: BotCustomAcpDraft };

export function BotCustomProviders({
  environmentId,
  hostId,
  onChange,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  onChange: () => void;
}) {
  const allowed = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: { operation: "provider.custom.list" },
    }),
  );
  const admin = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [endpoints, setEndpoints] = useState<ReturnType<typeof customProviderEndpoints>>(null);
  const [agents, setAgents] = useState<ReturnType<typeof customAcpAgents>>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const execute = async (requests: readonly OpenbotAdminRequest[]) => {
    if (lock.current || !allowed) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    setNotice(null);
    let saved = false;
    for (const request of requests) {
      const result = await admin({ environmentId, input: { hostId, request } });
      if (result._tag === "Failure") {
        setError(String(squashAtomCommandFailure(result)));
        break;
      }
      const endpointAction = request.operation.startsWith("provider.custom.");
      const rows = endpointAction
        ? customProviderEndpoints(result.value)
        : customAcpAgents(result.value);
      if (rows === null) {
        setError(
          "This engine returned unsupported custom provider settings. Reload before editing.",
        );
        break;
      }
      if (endpointAction) setEndpoints(customProviderEndpoints(result.value));
      else setAgents(customAcpAgents(result.value));
      if (request.operation.endsWith(".save") || request.operation.endsWith(".delete")) {
        saved = true;
        setDraft(null);
        setNotice(customRuntimeNotice(result.value));
      }
    }
    if (saved) onChange();
    setBusy(false);
    lock.current = false;
  };
  const remove = async (kind: "endpoint" | "acp", id: string, name: string) => {
    const question = `Remove ${name}? Bots using it will move to another available provider.`;
    const confirmed =
      (await requestConfirmDialog(question, { variant: "destructive" })) ??
      window.confirm(question);
    if (confirmed)
      void execute([
        {
          operation: kind === "endpoint" ? "provider.custom.delete" : "provider.customAgent.delete",
          id,
        },
      ]);
  };
  const save = () => {
    if (!draft) return;
    const request =
      draft.kind === "endpoint"
        ? customEndpointRequest(draft.value)
        : customAcpRequest(draft.value);
    if (!request) {
      setError(
        "Complete the required fields. Use one model or argument per line; model labels follow |. Check the field limits and endpoint URL.",
      );
      return;
    }
    void execute([request]);
  };
  const editIdentity = (field: "id" | "name", value: string) => {
    if (draft?.kind === "endpoint")
      setDraft({ ...draft, value: { ...draft.value, [field]: value } });
    else if (draft) setDraft({ ...draft, value: { ...draft.value, [field]: value } });
  };
  return (
    <section className="space-y-3" aria-label="Custom bot providers" aria-busy={busy}>
      <h5 className="text-sm font-medium">Custom providers and ACP agents</h5>
      <p className="text-sm text-muted-foreground">
        Connect an OpenAI-compatible endpoint, or an ACP command installed on this bot host.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={!allowed || busy}
          onClick={() =>
            void execute([
              { operation: "provider.custom.list" },
              { operation: "provider.customAgent.list" },
            ])
          }
        >
          Load custom providers
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!allowed || busy || draft !== null}
          onClick={() =>
            setDraft({
              kind: "endpoint",
              value: { id: "", name: "", baseUrl: "", apiKey: "", models: "", headers: [] },
            })
          }
        >
          Add endpoint
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!allowed || busy || draft !== null}
          onClick={() =>
            setDraft({
              kind: "acp",
              editing: false,
              value: { id: "", name: "", command: "", args: "", usagePrompt: "", env: [] },
            })
          }
        >
          Add ACP agent
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
        </p>
      )}
      {endpoints?.length === 0 && (
        <p className="text-sm text-muted-foreground">No custom endpoints saved.</p>
      )}
      {endpoints?.map((endpoint) => (
        <div key={endpoint.id} className="space-y-1">
          <p className="text-sm font-medium">{endpoint.name}</p>
          <p className="break-all text-sm text-muted-foreground">
            {endpoint.baseUrl} · {endpoint.models.length} models · {endpoint.harness}
            {endpoint.hasApiKey ? " · Key saved" : ""}
          </p>
          <Button
            variant="outline"
            size="sm"
            disabled={!allowed || busy || draft !== null}
            onClick={() => void remove("endpoint", endpoint.id, endpoint.name)}
          >
            Remove {endpoint.name}
          </Button>
        </div>
      ))}
      {endpoints && (
        <p className="text-sm text-muted-foreground">
          This engine supports adding and removing endpoints through Sled. Editing an existing
          endpoint and choosing its harness require a newer upstream interface.
        </p>
      )}
      {agents?.length === 0 && (
        <p className="text-sm text-muted-foreground">No custom ACP agents saved.</p>
      )}
      {agents?.map((agent) => (
        <div key={agent.id} className="space-y-1">
          <p className="text-sm font-medium">{agent.name}</p>
          <p className="break-all text-sm text-muted-foreground">
            {agent.command} ·{" "}
            {agent.resolvedCommand ? "Command found" : "Command not found on host"}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!allowed || busy || draft !== null}
              onClick={() =>
                setDraft({
                  kind: "acp",
                  editing: true,
                  value: {
                    id: agent.id,
                    name: agent.name,
                    command: agent.command,
                    args: agent.args.join("\n"),
                    originalArgs: agent.args,
                    usagePrompt: agent.usagePrompt ?? "",
                    env: agent.envNames.map((name, key) => ({ key, name, value: null })),
                  },
                })
              }
            >
              Edit {agent.name}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!allowed || busy || draft !== null}
              onClick={() => void remove("acp", agent.id, agent.name)}
            >
              Remove {agent.name}
            </Button>
          </div>
        </div>
      ))}
      {draft && (
        <div className="space-y-3">
          <h5 className="text-sm font-medium">
            {draft.kind === "endpoint"
              ? "New endpoint"
              : draft.editing
                ? "Edit ACP agent"
                : "New ACP agent"}
          </h5>
          <label className="block space-y-1 text-sm">
            <span>ID</span>
            <Input
              value={draft.value.id}
              maxLength={64}
              disabled={busy || (draft.kind === "acp" && draft.editing)}
              onChange={(event) => editIdentity("id", event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Display name</span>
            <Input
              value={draft.value.name}
              maxLength={80}
              disabled={busy}
              onChange={(event) => editIdentity("name", event.target.value)}
            />
          </label>
          {draft.kind === "endpoint" ? (
            <>
              <label className="block space-y-1 text-sm">
                <span>Base URL</span>
                <Input
                  type="url"
                  value={draft.value.baseUrl}
                  maxLength={2048}
                  disabled={busy}
                  placeholder="https://example.com/v1"
                  onChange={(event) =>
                    setDraft({ ...draft, value: { ...draft.value, baseUrl: event.target.value } })
                  }
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>API key (optional)</span>
                <Input
                  type="password"
                  autoComplete="off"
                  value={draft.value.apiKey}
                  maxLength={4096}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({ ...draft, value: { ...draft.value, apiKey: event.target.value } })
                  }
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Models · one ID | display name per line</span>
                <Textarea
                  value={draft.value.models}
                  maxLength={22000}
                  disabled={busy}
                  placeholder="vendor/model | My model"
                  onChange={(event) =>
                    setDraft({ ...draft, value: { ...draft.value, models: event.target.value } })
                  }
                />
              </label>
              <SecretEntries
                kind="Header"
                values={draft.value.headers}
                limit={32}
                disabled={busy}
                onChange={(headers) => setDraft({ ...draft, value: { ...draft.value, headers } })}
              />
              <p className="text-sm text-muted-foreground">
                New endpoints use OpenCode. Install its runtime in Provider setup. Stored keys and
                headers are never displayed.
              </p>
            </>
          ) : (
            <>
              <label className="block space-y-1 text-sm">
                <span>Command on host</span>
                <Input
                  value={draft.value.command}
                  maxLength={1024}
                  disabled={busy}
                  placeholder="/path/to/agent"
                  onChange={(event) =>
                    setDraft({ ...draft, value: { ...draft.value, command: event.target.value } })
                  }
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Arguments · one literal argument per line</span>
                <Textarea
                  value={draft.value.args}
                  maxLength={32799}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      value: { ...draft.value, args: event.target.value, originalArgs: undefined },
                    })
                  }
                />
              </label>
              <label className="block space-y-1 text-sm">
                <span>Usage command (optional)</span>
                <Input
                  value={draft.value.usagePrompt}
                  maxLength={256}
                  disabled={busy}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      value: { ...draft.value, usagePrompt: event.target.value },
                    })
                  }
                />
              </label>
              <SecretEntries
                kind="Environment variable"
                values={draft.value.env}
                limit={16}
                disabled={busy}
                onChange={(env) => setDraft({ ...draft, value: { ...draft.value, env } })}
              />
              <p className="text-sm text-muted-foreground">
                Arguments run directly, without shell expansion. Unchanged saved environment values
                are kept. Remove a row to remove that variable. Saving does not run a test command.
              </p>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!allowed || busy} onClick={save}>
              Save {draft.kind === "endpoint" ? "endpoint" : "ACP agent"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

function SecretEntries({
  kind,
  values,
  limit,
  disabled,
  onChange,
}: {
  kind: string;
  values: readonly BotCustomSecret[];
  limit: number;
  disabled: boolean;
  onChange: (values: BotCustomSecret[]) => void;
}) {
  const nextKey = useRef(Math.max(-1, ...values.map((entry) => entry.key)) + 1);
  return (
    <div className="space-y-2">
      <p className="text-sm">{kind}s</p>
      {values.map((entry, index) => (
        <div key={entry.key} className="space-y-2">
          <Input
            aria-label={`${kind} ${index + 1} name`}
            value={entry.name}
            maxLength={128}
            disabled={disabled || entry.value === null}
            onChange={(event) =>
              onChange(
                values.map((row) =>
                  row.key === entry.key ? { ...row, name: event.target.value } : row,
                ),
              )
            }
          />
          <Input
            aria-label={`${kind} ${index + 1} value`}
            type="password"
            autoComplete="off"
            value={entry.value ?? ""}
            maxLength={4096}
            disabled={disabled}
            placeholder={entry.value === null ? "Keep saved value" : "Value"}
            onChange={(event) =>
              onChange(
                values.map((row) =>
                  row.key === entry.key ? { ...row, value: event.target.value } : row,
                ),
              )
            }
          />
          <div className="flex flex-wrap gap-2">
            {entry.value === null && (
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    values.map((row) => (row.key === entry.key ? { ...row, value: "" } : row)),
                  )
                }
              >
                Use empty value
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={() => onChange(values.filter((row) => row.key !== entry.key))}
            >
              Remove {kind.toLowerCase()} {index + 1}
            </Button>
          </div>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || values.length >= limit}
        onClick={() => onChange([...values, { key: nextKey.current++, name: "", value: "" }])}
      >
        Add {kind.toLowerCase()}
      </Button>
    </div>
  );
}
