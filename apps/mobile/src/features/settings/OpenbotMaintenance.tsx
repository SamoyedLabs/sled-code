import { OpenbotContinuity } from "./OpenbotContinuity";
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
import { T, Var, useGT } from "gt-react-native";

const decodePolicy = Schema.decodeUnknownResult(OpenbotMaintenancePolicy);

export function OpenbotMaintenance({ environmentId }: { environmentId: EnvironmentId }) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Button
        label={expanded ? gt("Close upstream maintenance") : gt("Upstream maintenance")}
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && <MaintenancePanel key={environmentId} environmentId={environmentId} />}
    </View>
  );
}
function MaintenancePanel({ environmentId }: { environmentId: EnvironmentId }) {
  const gt = useGT();
  const query = useEnvironmentQuery(openbot.maintenance({ environmentId, input: {} }));
  return (
    <View className="gap-3">
      <Text className="font-semibold">
        <T>Upstream maintenance</T>
      </Text>
      <OpenbotContinuity environmentId={environmentId} />
      <Text>
        <T>
          Review new bot engine releases in a separate workspace. Your decision is required before
          staging; activation is separate.
        </T>
      </Text>
      <Button
        label={gt("Refresh maintenance")}
        onPress={query.refresh}
        disabled={query.isPending}
      />
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
  const gt = useGT();
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
        gt("Choose a project, provider, model, platform and check interval from 1 to 720 hours."),
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
      <Text>
        <T>Enable maintenance</T>
      </Text>
      <Switch
        accessibilityLabel={gt("Enable maintenance")}
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
      <Text>
        <T>Integration base branch</T>
      </Text>
      <AppTextInput
        accessibilityLabel={gt("Integration base branch")}
        value={baseRef}
        onChangeText={setBaseRef}
        editable={!locked}
      />
      <Text>
        <T>Check every (hours)</T>
      </Text>
      <AppTextInput
        accessibilityLabel={gt("Check every (hours)")}
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
        <T>
          Reviews use plan mode and ask before actions. Source patches need a separate
          implementation step. Reviews cannot authorize activation or profile changes.
        </T>
      </Text>
      <Button label={gt("Save policy")} onPress={save} disabled={locked} />
      <Button
        label={gt("Check now")}
        disabled={locked || !state.policy?.enabled}
        onPress={() => void send({ action: "check" })}
      />
      {state.policy && (
        <Button
          label={gt("Disable and clear policy")}
          disabled={locked}
          onPress={() =>
            void send({ action: "configure", expectedRevision: state.revision, policy: null })
          }
        />
      )}
      {error && <Text accessibilityRole="alert">{error}</Text>}
      {state.lastError && <Text accessibilityRole="alert">{state.lastError}</Text>}
      {state.nextCheckAt && (
        <Text>
          <T>
            Next check: <Var>{state.nextCheckAt}</Var>
          </T>
        </Text>
      )}
      <Text>
        <T>Decision note</T>
      </Text>
      <AppTextInput
        accessibilityLabel={gt("Decision note")}
        value={note}
        onChangeText={setNote}
        editable={!locked}
      />
      {state.proposals.map((p) => (
        <View key={p.id} className="gap-2 rounded border p-3">
          <Text className="font-semibold">
            {p.release.version} · {openbotMaintenanceProgress(p)}
          </Text>
          <Text selectable>
            <T>
              Source: <Var>{p.release.releaseCommit}</Var>
            </T>
          </Text>
          <Text selectable>
            <T>
              Download: <Var>{p.release.assets.find((a) => a.platform === p.platform)?.sha256}</Var>
            </T>
          </Text>
          <Text>
            <T>
              Compatibility: <Var>{p.compatibility}</Var>.{" "}
              <Var>
                {p.stagedAt ? gt("Staged {stagedAt}", { stagedAt: p.stagedAt }) : gt("Not staged")}
              </Var>
            </T>
          </Text>
          {p.reviewThreadId && (
            <Button
              label={gt("Open review thread")}
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
          {p.decision && (
            <Text>
              <T>
                Your decision: <Var>{p.decision.note}</Var>
              </T>
            </Text>
          )}
          {(p.state === "proposed" || p.state === "review-queued") && (
            <Button
              label={p.state === "proposed" ? gt("Review source") : gt("Retry review launch")}
              disabled={locked || !state.policy?.enabled || state.policy.authority === "check"}
              onPress={() => void send({ action: "review", proposalId: p.id })}
            />
          )}
          {p.state === "decision-required" && (
            <>
              <Button
                label={gt("Accept review")}
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
                label={gt("Reject release")}
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
          {p.state === "accepted" && (
            <>
              <Button
                label={
                  p.preparationThreadId
                    ? gt("Resume source preparation")
                    : gt("Prepare source and patches")
                }
                disabled={locked || !state.policy?.enabled || state.policy.authority !== "stage"}
                onPress={() => void send({ action: "prepare", proposalId: p.id })}
              />
              {p.preparationThreadId && (
                <>
                  <Button
                    label={gt("Open preparation thread")}
                    onPress={() =>
                      navigation.dispatch(
                        StackActions.push("Thread", {
                          environmentId,
                          threadId: p.preparationThreadId,
                        }),
                      )
                    }
                  />
                  <Button
                    label={gt("Run compatibility checks")}
                    disabled={
                      locked || !state.policy?.enabled || state.policy.authority !== "stage"
                    }
                    onPress={() => void send({ action: "validate-prepared", proposalId: p.id })}
                  />
                </>
              )}
              {p.validation?.state === "eligible" &&
                p.validationRunId &&
                p.compatibility !== "validated" && (
                  <Button
                    label={gt("Accept verified artifact")}
                    disabled={
                      locked || !state.policy?.enabled || state.policy.authority !== "stage"
                    }
                    onPress={() =>
                      void send({ action: "promote", proposalId: p.id, runId: p.validationRunId! })
                    }
                  />
                )}
            </>
          )}
          {p.validation?.state === "running" && (
            <Button
              label={gt("Cancel compatibility checks")}
              disabled={locked}
              onPress={() => void send({ action: "cancel-validation", proposalId: p.id })}
            />
          )}
          {p.validation && (
            <View className="gap-1">
              <Text>
                <T>
                  Checks: <Var>{p.validation.state}</Var>
                </T>
              </Text>
              {p.validation.checks.map((check) => (
                <Text key={`${check.kind}:${check.outcome}:${check.detail}`}>
                  {check.kind}: {check.outcome} · {check.detail}
                </Text>
              ))}
            </View>
          )}
          {p.state === "accepted" && !p.stagedAt && (
            <Button
              label={gt("Stage reviewed release")}
              disabled={locked || !state.policy?.enabled || state.policy.authority !== "stage"}
              onPress={() => void send({ action: "stage", proposalId: p.id })}
            />
          )}
        </View>
      ))}
    </View>
  );
}
