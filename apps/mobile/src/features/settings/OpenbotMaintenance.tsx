import { openbotMaintenanceProgress } from "@t3tools/client-runtime/openbot/presentation";
import { useState } from "react";
import { StackActions, useNavigation } from "@react-navigation/native";
import { View, Switch } from "react-native";
import { useAtomValue } from "@effect/atom-react";
import {
  type EnvironmentId,
  type OpenbotMaintenanceCommand,
  type OpenbotMaintenanceState,
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
import { Button } from "../../components/ui/Button";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Picker } from "./BotConnectionControls";

const decodePolicy = Schema.decodeUnknownResult(OpenbotMaintenancePolicy);

export function OpenbotMaintenance({ environmentId }: { environmentId: EnvironmentId }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Button
        label={expanded ? "Close upstream maintenance" : "Upstream maintenance"}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && <MaintenancePanel key={environmentId} environmentId={environmentId} />}
    </View>
  );
}
function MaintenancePanel({ environmentId }: { environmentId: EnvironmentId }) {
  const query = useEnvironmentQuery(openbot.maintenance({ environmentId, input: {} }));
  return (
    <View className="gap-3">
      <Text className="font-semibold">Upstream maintenance</Text>
      <Text>
        Review new bot engine releases in a separate workspace. Your decision is required before
        staging; activation is separate.
      </Text>
      <Button label="Refresh maintenance" onPress={query.refresh} disabled={query.isPending} />
      {query.error && <Text accessibilityRole="alert">{query.error}</Text>}
      {query.data && (
        <MaintenanceForm
          key={`${environmentId}:${query.data.revision}`}
          environmentId={environmentId}
          state={query.data}
        />
      )}
    </View>
  );
}
function MaintenanceForm({
  environmentId,
  state,
}: {
  environmentId: EnvironmentId;
  state: OpenbotMaintenanceState;
}) {
  const navigation = useNavigation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    const decoded = decodePolicy({
      enabled,
      projectId,
      modelSelection: { instanceId: providerId, model },
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
  const pick = (
    label: string,
    value: string,
    options: readonly { id: string; name: string }[],
    onChange: (v: string) => void,
  ) => (
    <Picker label={label} value={value} options={options} disabled={locked} onChange={onChange} />
  );
  return (
    <View className="gap-3">
      <Text>Enable maintenance</Text>
      <Switch
        accessibilityLabel="Enable maintenance"
        value={enabled}
        onValueChange={setEnabled}
        disabled={locked}
      />
      {pick(
        "Integration project",
        projectId,
        projects.map((p) => ({ id: p.id, name: p.title })),
        setProjectId,
      )}
      {pick(
        "Review provider",
        providerId,
        providers
          .filter((p) => p.enabled && p.installed && p.showInteractionModeToggle)
          .map((p) => ({ id: p.instanceId, name: p.displayName ?? p.driver })),
        (v) => {
          setProviderId(v);
          setModel("");
        },
      )}
      {pick(
        "Review model",
        model,
        providers
          .find((p) => p.instanceId === providerId)
          ?.models.map((m) => ({ id: m.slug, name: m.name })) ?? [],
        setModel,
      )}
      <Text>Integration base branch</Text>
      <AppTextInput
        accessibilityLabel="Integration base branch"
        value={baseRef}
        onChangeText={setBaseRef}
        editable={!locked}
      />
      <Text>Check every (hours)</Text>
      <AppTextInput
        accessibilityLabel="Check every (hours)"
        keyboardType="numeric"
        value={interval}
        onChangeText={setInterval}
        editable={!locked}
      />
      {pick(
        "Allowed work",
        authority,
        [
          { id: "check", name: "Check releases" },
          { id: "review", name: "Check and review source" },
          { id: "stage", name: "Stage after my decision" },
        ],
        setAuthority,
      )}
      {pick(
        "Target platform",
        platform,
        ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win32-x64"].map((id) => ({
          id,
          name: id,
        })),
        setPlatform,
      )}
      <Text>
        Reviews use plan mode and ask before actions. Source patches need a separate implementation
        step. Reviews cannot authorize activation or profile changes.
      </Text>
      <Button label="Save policy" onPress={save} disabled={locked} />
      <Button
        label="Check now"
        disabled={locked || !state.policy?.enabled}
        onPress={() => void send({ action: "check" })}
      />
      {state.policy && (
        <Button
          label="Disable and clear policy"
          disabled={locked}
          onPress={() =>
            void send({ action: "configure", expectedRevision: state.revision, policy: null })
          }
        />
      )}
      {error && <Text accessibilityRole="alert">{error}</Text>}
      {state.lastError && <Text accessibilityRole="alert">{state.lastError}</Text>}
      {state.nextCheckAt && <Text>Next check: {state.nextCheckAt}</Text>}
      <Text>Decision note</Text>
      <AppTextInput
        accessibilityLabel="Decision note"
        value={note}
        onChangeText={setNote}
        editable={!locked}
      />
      {state.proposals.map((p) => (
        <View key={p.id} className="gap-2 rounded border p-3">
          <Text className="font-semibold">
            {p.release.version} · {openbotMaintenanceProgress(p)}
          </Text>
          <Text selectable>Source: {p.release.releaseCommit}</Text>
          <Text selectable>
            Download: {p.release.assets.find((a) => a.platform === p.platform)?.sha256}
          </Text>
          <Text>
            Compatibility still requires validation.{" "}
            {p.stagedAt ? `Staged ${p.stagedAt}` : "Not staged"}
          </Text>
          {p.reviewThreadId && (
            <Button
              label="Open review thread"
              onPress={() =>
                navigation.dispatch(
                  StackActions.push("Thread", { environmentId, threadId: p.reviewThreadId }),
                )
              }
            />
          )}
          {p.report && (
            <>
              <Text>{p.report.sourceComparison}</Text>
              <Text>{p.report.findings}</Text>
              {p.report.evidence.map((e) => (
                <Text key={`${e.kind}:${e.artifact}`} selectable>
                  {e.kind}: {e.outcome} · {e.artifact}
                </Text>
              ))}
              <Text>{p.report.decisionRequest}</Text>
            </>
          )}
          {p.decision && <Text>Your decision: {p.decision.note}</Text>}
          {(p.state === "proposed" || p.state === "review-queued") && (
            <Button
              label={p.state === "proposed" ? "Review source" : "Retry review launch"}
              disabled={locked || !state.policy?.enabled || state.policy.authority === "check"}
              onPress={() => void send({ action: "review", proposalId: p.id })}
            />
          )}
          {p.state === "decision-required" && (
            <>
              <Button
                label="Accept review"
                disabled={locked || !note.trim()}
                onPress={() =>
                  void send({
                    action: "decide",
                    proposalId: p.id,
                    expectedRevision: state.revision,
                    accept: true,
                    note,
                  })
                }
              />
              <Button
                label="Reject release"
                disabled={locked || !note.trim()}
                onPress={() =>
                  void send({
                    action: "decide",
                    proposalId: p.id,
                    expectedRevision: state.revision,
                    accept: false,
                    note,
                  })
                }
              />
            </>
          )}
          {p.state === "accepted" && !p.stagedAt && (
            <Button
              label="Stage reviewed release"
              disabled={locked || !state.policy?.enabled || state.policy.authority !== "stage"}
              onPress={() => void send({ action: "stage", proposalId: p.id })}
            />
          )}
        </View>
      ))}
    </View>
  );
}
