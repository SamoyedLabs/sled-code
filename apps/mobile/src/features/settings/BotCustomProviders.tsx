import { useRef, useState } from "react";
import { View } from "react-native";
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
import * as Dialog from "../../components/ui/Dialog";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";

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
  const remove = (kind: "endpoint" | "acp", id: string, name: string) =>
    Dialog.alert(`Remove ${name}?`, "Bots using it will move to another available provider.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          void execute([
            {
              operation:
                kind === "endpoint" ? "provider.custom.delete" : "provider.customAgent.delete",
              id,
            },
          ]),
      },
    ]);
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
    <View className="gap-3">
      <Text textRole="headline">Custom providers and ACP agents</Text>
      <Text className="text-foreground-muted">
        Connect an OpenAI-compatible endpoint, or an ACP command installed on this bot host.
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Load custom providers"
          tone="secondary"
          size="compact"
          disabled={!allowed || busy}
          onPress={() =>
            void execute([
              { operation: "provider.custom.list" },
              { operation: "provider.customAgent.list" },
            ])
          }
        />
        <Button
          label="Add endpoint"
          tone="secondary"
          size="compact"
          disabled={!allowed || busy || draft !== null}
          onPress={() =>
            setDraft({
              kind: "endpoint",
              value: { id: "", name: "", baseUrl: "", apiKey: "", models: "", headers: [] },
            })
          }
        />
        <Button
          label="Add ACP agent"
          tone="secondary"
          size="compact"
          disabled={!allowed || busy || draft !== null}
          onPress={() =>
            setDraft({
              kind: "acp",
              editing: false,
              value: { id: "", name: "", command: "", args: "", usagePrompt: "", env: [] },
            })
          }
        />
      </View>
      {error && (
        <Text accessibilityRole="alert" className="text-danger">
          {error}
        </Text>
      )}
      {notice && (
        <Text accessibilityLiveRegion="polite" className="text-foreground-muted">
          {notice}
        </Text>
      )}
      {endpoints?.length === 0 && (
        <Text className="text-foreground-muted">No custom endpoints saved.</Text>
      )}
      {endpoints?.map((endpoint) => (
        <View key={endpoint.id} className="gap-2">
          <Text>{endpoint.name}</Text>
          <Text selectable className="text-foreground-muted">
            {endpoint.baseUrl} · {endpoint.models.length} models · {endpoint.harness}
            {endpoint.hasApiKey ? " · Key saved" : ""}
          </Text>
          <Button
            label={`Remove ${endpoint.name}`}
            tone="secondary"
            size="compact"
            disabled={!allowed || busy || draft !== null}
            onPress={() => remove("endpoint", endpoint.id, endpoint.name)}
          />
        </View>
      ))}
      {endpoints && (
        <Text className="text-foreground-muted">
          This engine supports adding and removing endpoints through Sled. Editing an existing
          endpoint and choosing its harness require a newer upstream interface.
        </Text>
      )}
      {agents?.length === 0 && (
        <Text className="text-foreground-muted">No custom ACP agents saved.</Text>
      )}
      {agents?.map((agent) => (
        <View key={agent.id} className="gap-2">
          <Text>{agent.name}</Text>
          <Text selectable className="text-foreground-muted">
            {agent.command} ·{" "}
            {agent.resolvedCommand ? "Command found" : "Command not found on host"}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={`Edit ${agent.name}`}
              tone="secondary"
              size="compact"
              disabled={!allowed || busy || draft !== null}
              onPress={() =>
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
            />
            <Button
              label={`Remove ${agent.name}`}
              tone="secondary"
              size="compact"
              disabled={!allowed || busy || draft !== null}
              onPress={() => remove("acp", agent.id, agent.name)}
            />
          </View>
        </View>
      ))}
      {draft && (
        <View className="gap-3">
          <Text>
            {draft.kind === "endpoint"
              ? "New endpoint"
              : draft.editing
                ? "Edit ACP agent"
                : "New ACP agent"}
          </Text>
          <Field
            label="ID"
            value={draft.value.id}
            maxLength={64}
            disabled={busy || (draft.kind === "acp" && draft.editing)}
            onChange={(id) => editIdentity("id", id)}
          />
          <Field
            label="Display name"
            value={draft.value.name}
            maxLength={80}
            disabled={busy}
            onChange={(name) => editIdentity("name", name)}
          />
          {draft.kind === "endpoint" ? (
            <>
              <Field
                label="Base URL"
                value={draft.value.baseUrl}
                maxLength={2048}
                disabled={busy}
                onChange={(baseUrl) => setDraft({ ...draft, value: { ...draft.value, baseUrl } })}
              />
              <Field
                label="API key (optional)"
                value={draft.value.apiKey}
                maxLength={4096}
                disabled={busy}
                secret
                onChange={(apiKey) => setDraft({ ...draft, value: { ...draft.value, apiKey } })}
              />
              <Field
                label="Models · one ID | display name per line"
                value={draft.value.models}
                maxLength={22000}
                disabled={busy}
                multiline
                onChange={(models) => setDraft({ ...draft, value: { ...draft.value, models } })}
              />
              <SecretEntries
                kind="Header"
                values={draft.value.headers}
                limit={32}
                disabled={busy}
                onChange={(headers) => setDraft({ ...draft, value: { ...draft.value, headers } })}
              />
              <Text className="text-foreground-muted">
                New endpoints use OpenCode. Install its runtime in Provider setup. Stored keys and
                headers are never displayed.
              </Text>
            </>
          ) : (
            <>
              <Field
                label="Command on host"
                value={draft.value.command}
                maxLength={1024}
                disabled={busy}
                onChange={(command) => setDraft({ ...draft, value: { ...draft.value, command } })}
              />
              <Field
                label="Arguments · one literal argument per line"
                value={draft.value.args}
                maxLength={32799}
                disabled={busy}
                multiline
                onChange={(args) =>
                  setDraft({ ...draft, value: { ...draft.value, args, originalArgs: undefined } })
                }
              />
              <Field
                label="Usage command (optional)"
                value={draft.value.usagePrompt}
                maxLength={256}
                disabled={busy}
                onChange={(usagePrompt) =>
                  setDraft({ ...draft, value: { ...draft.value, usagePrompt } })
                }
              />
              <SecretEntries
                kind="Environment variable"
                values={draft.value.env}
                limit={16}
                disabled={busy}
                onChange={(env) => setDraft({ ...draft, value: { ...draft.value, env } })}
              />
              <Text className="text-foreground-muted">
                Arguments run directly, without shell expansion. Unchanged saved environment values
                are kept. Remove a row to remove that variable. Saving does not run a test command.
              </Text>
            </>
          )}
          <View className="flex-row flex-wrap gap-2">
            <Button
              label={`Save ${draft.kind === "endpoint" ? "endpoint" : "ACP agent"}`}
              disabled={!allowed || busy}
              onPress={save}
            />
            <Button
              label="Cancel"
              tone="secondary"
              disabled={busy}
              onPress={() => {
                setDraft(null);
                setError(null);
              }}
            />
          </View>
        </View>
      )}
    </View>
  );
}

function Field({
  label,
  value,
  maxLength,
  disabled,
  onChange,
  multiline = false,
  secret = false,
}: {
  label: string;
  value: string;
  maxLength: number;
  disabled: boolean;
  onChange: (value: string) => void;
  multiline?: boolean;
  secret?: boolean;
}) {
  return (
    <View className="gap-1">
      <Text>{label}</Text>
      <AppTextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        maxLength={maxLength}
        editable={!disabled}
        multiline={multiline}
        secureTextEntry={secret}
        autoCapitalize="none"
        autoCorrect={false}
        textAlignVertical={multiline ? "top" : "center"}
      />
    </View>
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
    <View className="gap-2">
      <Text>{kind}s</Text>
      {values.map((entry, index) => (
        <View key={entry.key} className="gap-2">
          <Field
            label={`${kind} ${index + 1} name`}
            value={entry.name}
            maxLength={128}
            disabled={disabled || entry.value === null}
            onChange={(name) =>
              onChange(values.map((row) => (row.key === entry.key ? { ...row, name } : row)))
            }
          />
          <View className="gap-1">
            <Text>{entry.value === null ? "Keep saved value" : "Value"}</Text>
            <AppTextInput
              accessibilityLabel={`${kind} ${index + 1} value`}
              value={entry.value ?? ""}
              onChangeText={(value) =>
                onChange(values.map((row) => (row.key === entry.key ? { ...row, value } : row)))
              }
              maxLength={4096}
              editable={!disabled}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              placeholder={entry.value === null ? "Keep saved value" : "Value"}
            />
          </View>
          <View className="flex-row flex-wrap gap-2">
            {entry.value === null && (
              <Button
                label="Use empty value"
                tone="secondary"
                size="compact"
                disabled={disabled}
                onPress={() =>
                  onChange(
                    values.map((row) => (row.key === entry.key ? { ...row, value: "" } : row)),
                  )
                }
              />
            )}
            <Button
              label={`Remove ${kind.toLowerCase()} ${index + 1}`}
              tone="secondary"
              size="compact"
              disabled={disabled}
              onPress={() => onChange(values.filter((row) => row.key !== entry.key))}
            />
          </View>
        </View>
      ))}
      <Button
        label={`Add ${kind.toLowerCase()}`}
        tone="secondary"
        size="compact"
        disabled={disabled || values.length >= limit}
        onPress={() => onChange([...values, { key: nextKey.current++, name: "", value: "" }])}
      />
    </View>
  );
}
