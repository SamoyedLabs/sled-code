import { useAtomValue } from "@effect/atom-react";
import { AuthFilesystemReadScope, type EnvironmentId } from "@t3tools/contracts";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import { File } from "expo-file-system";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { ListRow } from "../../components/ui/ListRow";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { type EnvironmentPresentation, useEnvironments } from "../../state/environments";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useEnvironmentScope } from "../../state/session";
import { chooseBotFile } from "./useBotFileUpload";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import {
  bindBotTransfer,
  type BotTransferHost,
  type BotTransferSummary,
} from "./bot-instance-transfer-client";
import { T, Var, useGT } from "gt-react-native";

type Tab = "home" | "export" | "import" | "copy";
type Transfer = Awaited<ReturnType<typeof bindBotTransfer>>;
type Recovery = NonNullable<Awaited<ReturnType<Transfer["recover"]>>>;
type Target = BotTransferHost & { label: string };
const titles: Record<Tab, string> = {
  home: "Transfer",
  export: "Export to a file",
  import: "Import from a file",
  copy: "Copy to another server",
};

function useCanTransfer(environmentId: EnvironmentId, hostId: string | null) {
  const permission = useAtomValue(openbot.instanceTransfer.permissionAtom(environmentId));
  const filePermission = useEnvironmentScope(environmentId, AuthFilesystemReadScope);
  const compatibility = useEnvironmentQuery(
    hostId
      ? openbot.readFromHost({
          environmentId,
          input: { hostId, request: { operation: "compatibility.read" } },
        })
      : null,
  );
  return Boolean(
    permission &&
    filePermission &&
    settingsCapabilities(compatibility.data).includes("instance-transfer-v1"),
  );
}

export function BotInstanceTransfer(scope: BotTransferHost) {
  const gt = useGT();
  const [open, setOpen] = useState(false);
  const available = useCanTransfer(scope.environmentId, scope.hostId);
  if (!available) return null;
  return (
    <>
      <SettingsSection title={gt("Transfer")}>
        <ListRow
          icon="square.and.arrow.up"
          label={gt("Transfer agents and settings")}
          onPress={() => setOpen(true)}
        />
      </SettingsSection>
      {open && <TransferSheet {...scope} onClose={() => setOpen(false)} />}
    </>
  );
}

function TransferTarget({
  environment,
  selected,
  disabled,
  onChoose,
}: {
  environment: EnvironmentPresentation;
  selected: Target | null;
  disabled: boolean;
  onChoose: (target: Target) => void;
}) {
  const gt = useGT();
  const { environmentId, label, displayUrl } = environment;
  const status = useEnvironmentQuery(openbot.status({ environmentId, input: {} }));
  const hostId = status.data?.state === "ready" ? (status.data.hostId ?? null) : null;
  const available = useCanTransfer(environmentId, hostId);
  if (!available || !hostId) return null;
  return (
    <ListRow
      icon="desktopcomputer"
      label={label}
      description={displayUrl ?? undefined}
      detail={selected?.environmentId === environmentId ? gt("Selected") : undefined}
      disabled={disabled}
      onPress={() => onChoose({ environmentId, hostId, label })}
    />
  );
}

function TransferSheet({
  environmentId,
  hostId,
  onClose,
}: BotTransferHost & { onClose: () => void }) {
  const gt = useGT();
  const { environments } = useEnvironments();
  const [tab, setTab] = useState<Tab>("home");
  const [summary, setSummary] = useState<BotTransferSummary | null>(null);
  const [recovery, setRecovery] = useState<Recovery | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [includeFiles, setIncludeFiles] = useState(true);
  const [includeSettings, setIncludeSettings] = useState(false);
  const [busy, setBusy] = useState<string | null>("Reading server…");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const scope = { environmentId, hostId };
  const run = async (label: string, action: (signal: AbortSignal) => Promise<void>) => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action(controller.signal);
    } catch (cause) {
      if (!controller.signal.aborted)
        setError(cause instanceof Error ? cause.message : gt("The transfer did not complete."));
    }
    if (active.current === controller) {
      active.current = null;
      setBusy(null);
    }
  };
  const refresh = (openPending = true) =>
    run("Reading server…", async (signal) => {
      const source = await bindBotTransfer(scope, signal);
      const [agents, pending] = await Promise.all([source.summary(), source.recover()]);
      signal.throwIfAborted();
      setSummary(agents);
      setRecovery(pending);
      if (pending?.receipt?.state === "staged") {
        setSelected(new Set(pending.receipt.preview?.agents.map((agent) => agent.key)));
      }
      if (openPending && pending) setTab("import");
    });
  const load = useEffectEvent(() => void refresh());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Recover the original receipt from the pinned server when Transfer opens.
  useEffect(() => {
    let mounted = true;
    queueMicrotask(() => {
      if (mounted) load();
    });
    return () => {
      mounted = false;
      active.current?.abort();
      active.current = null;
    };
  }, []);

  const destination =
    target &&
    environments.find(
      (item) =>
        item.environmentId === target.environmentId && item.connection.phase === "connected",
    );
  const candidates = environments.filter(
    (item) => item.environmentId !== environmentId && item.connection.phase === "connected",
  );
  const include = (key: string, enabled: boolean) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (enabled) next.add(key);
      else next.delete(key);
      return next;
    });
  };
  const changeTab = (next: Tab) => {
    setTab(next);
    setSelected(
      new Set(next === "copy" || next === "export" ? summary?.agents.map((agent) => agent.id) : []),
    );
    setIncludeSettings(false);
    setError(null);
    setNotice(null);
    if (next === "import") void refresh(false);
  };
  const choose = () =>
    run("Reading archive…", async (signal) => {
      const source = await bindBotTransfer(scope, signal);
      const pending = await source.recover();
      if (pending) {
        setRecovery(pending);
        return;
      }
      const picked = await chooseBotFile("files");
      const pickedName = picked?.name;
      if (!picked || !pickedName) return;
      const archive = new File(picked.uri);
      await (async () => {
        const staged = await source.stage(archive, pickedName);
        setRecovery(staged);
        setSelected(new Set(staged.receipt.preview?.agents.map((agent) => agent.key)));
      })()
        .catch(async (cause) => {
          if (!signal.aborted) setRecovery(await source.recover().catch(() => null));
          throw cause;
        })
        .finally(() => {
          try {
            if (archive.exists) archive.delete();
          } catch {
            // The document picker owns this temporary cache file.
          }
        });
    });
  const exportArchive = () =>
    run("Exporting…", async (signal) => {
      const source = await bindBotTransfer(scope, signal);
      const { local } = await source.download({
        agentIds: [...selected],
        includeFiles,
        includeSettings,
      });
      await (async () => {
        await local.share(signal);
        signal.throwIfAborted();
        setNotice(gt("Export ready to save or share."));
      })().finally(() => {
        local.dispose();
      });
    });
  const receipt = recovery?.receipt ?? null;
  const review = receipt?.state === "staged" ? receipt.preview : null;
  const canClear = !receipt || receipt.state === "complete" || receipt.state === "discarded";
  const importArchive = () =>
    run("Importing…", async (signal) => {
      if (!review || !receipt) return;
      const source = await bindBotTransfer(scope, signal);
      try {
        const result = await source.apply(review.token, [...selected], includeSettings);
        setRecovery({ requestId: review.token, receipt: result });
      } catch (cause) {
        if (!signal.aborted) {
          setRecovery({ requestId: review.token, receipt: { ...receipt, state: "uncertain" } });
        }
        throw cause;
      }
    });
  const dismissReceipt = () =>
    run("Closing import…", async (signal) => {
      const source = await bindBotTransfer(scope, signal);
      if (review) {
        const discarded = await source.discard(review.token);
        if (discarded.state !== "discarded") throw new Error("The import could not be discarded.");
      } else if (!canClear) return;
      await source.forget();
      setRecovery(null);
      setSelected(new Set());
      setIncludeSettings(false);
    });
  const copy = () =>
    run("Copying…", async (signal) => {
      if (!target || !destination) return;
      const source = await bindBotTransfer(scope, signal);
      const to = await bindBotTransfer(target, signal);
      if (await to.recover())
        throw new Error(
          "This destination has a retained import. Open Transfer there to review it.",
        );
      const { local, archive, name } = await source.download({
        agentIds: [...selected],
        includeFiles: true,
        includeSettings: false,
      });
      await (async () => {
        const { receipt } = await to.stage(archive, name);
        const preview = receipt.state === "staged" ? receipt.preview : null;
        if (!preview) throw new Error("Open Transfer on the destination to recover the copy.");
        const finish = await to.apply(
          preview.token,
          preview.agents.map((agent) => agent.key),
          false,
        );
        if (finish.state !== "complete" || !finish.result)
          throw new Error("Check Transfer on the destination to recover the copy.");
        await to.forget();
        setSelected(new Set());
        const count = finish.result.agents.length;
        setNotice(
          [
            `Copied ${count} ${count === 1 ? "agent" : "agents"} to ${target.label}.`,
            ...finish.result.skipped.map((item) => `${item.name}: ${item.reason}`),
            ...new Set([...preview.warnings, ...finish.result.warnings]),
          ].join("\n"),
        );
      })().finally(() => {
        local.dispose();
      });
    });
  const openCopy = candidates.length > 0;
  const editable = busy === null;
  return (
    <Sheet title={titles[tab]} onClose={onClose}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-4 px-5 pb-6 pt-4"
      >
        {tab !== "home" && (
          <Button
            label={gt("Back to Transfer")}
            tone="text"
            disabled={!editable}
            onPress={() => changeTab("home")}
          />
        )}
        {busy && (
          <Text accessibilityRole="progressbar" className="text-foreground-muted">
            {busy}
          </Text>
        )}
        {error && <Text accessibilityRole="alert">{error}</Text>}
        {notice && <Text accessibilityRole="status">{notice}</Text>}
        {!summary && error && (
          <Button
            label={gt("Retry")}
            tone="secondary"
            disabled={!editable}
            onPress={() => void refresh()}
          />
        )}
        {tab === "home" && (
          <SettingsSection
            title={gt("Server transfer")}
            footer="Chat history and account sign-ins stay on their original server."
          >
            <ListRow
              icon="square.and.arrow.up"
              label={titles.export}
              disabled={!summary || !editable}
              onPress={() => changeTab("export")}
            />
            <ListRow
              icon="internaldrive"
              label={titles.import}
              disabled={!summary || !editable}
              onPress={() => changeTab("import")}
            />
            {openCopy && (
              <ListRow
                icon="desktopcomputer"
                label={titles.copy}
                disabled={!summary || !editable}
                onPress={() => changeTab("copy")}
              />
            )}
          </SettingsSection>
        )}
        {tab === "copy" && (
          <SettingsSection
            title={gt("Destination")}
            footer="Only connected servers that support transfers are listed."
          >
            {candidates.map((environment) => (
              <TransferTarget
                key={environment.environmentId}
                environment={environment}
                selected={target}
                disabled={!editable}
                onChoose={setTarget}
              />
            ))}
          </SettingsSection>
        )}
        {(tab === "export" || tab === "copy") && summary && (
          <SettingsSection
            title={gt("Agents")}
            footer={
              tab === "copy"
                ? "Copies include workspace files. Server settings stay on this server."
                : undefined
            }
          >
            {summary.agents.map((agent) => (
              <SettingsSwitchRow
                key={agent.id}
                icon="person.crop.circle"
                label={agent.name}
                value={selected.has(agent.id)}
                disabled={!editable}
                onValueChange={(value) => include(agent.id, value)}
              />
            ))}
            {summary.agents.length === 0 && (
              <Text className="px-4 py-3">
                <T>No agents to transfer.</T>
              </Text>
            )}
          </SettingsSection>
        )}
        {tab === "export" && (
          <>
            <SettingsSection title={gt("Include")}>
              <SettingsSwitchRow
                icon="folder"
                label={gt("Workspace files")}
                value={includeFiles}
                disabled={!editable}
                onValueChange={setIncludeFiles}
              />
              <SettingsSwitchRow
                icon="gearshape"
                label={gt("Server settings")}
                value={includeSettings}
                disabled={!editable}
                onValueChange={setIncludeSettings}
              />
            </SettingsSection>
            <Button
              label={gt("Export ZIP")}
              disabled={!editable || !selected.size}
              onPress={() => void exportArchive()}
            />
          </>
        )}
        {tab === "copy" && (
          <Button
            label={gt("Copy selected agents")}
            disabled={!editable || !selected.size || !destination}
            onPress={() => void copy()}
          />
        )}
        {tab === "import" && (
          <>
            {!recovery && (
              <Button label={gt("Choose ZIP")} disabled={!editable} onPress={() => void choose()} />
            )}
            {review && (
              <>
                <SettingsSection title={gt("Review agents")}>
                  {review.agents.map((agent) => (
                    <SettingsSwitchRow
                      key={agent.key}
                      icon="person.crop.circle"
                      label={agent.name}
                      value={selected.has(agent.key)}
                      disabled={!editable}
                      onValueChange={(value) => include(agent.key, value)}
                    />
                  ))}
                  {review.hasSettings && (
                    <SettingsSwitchRow
                      icon="gearshape"
                      label={gt("Import server settings")}
                      value={includeSettings}
                      disabled={!editable}
                      onValueChange={setIncludeSettings}
                    />
                  )}
                </SettingsSection>
                {[...new Set(review.warnings)].map((warning) => (
                  <Text key={warning}>{warning}</Text>
                ))}
                <Button
                  label={gt("Import selected")}
                  disabled={!editable || (!selected.size && !includeSettings)}
                  onPress={() => void importArchive()}
                />
              </>
            )}
            {receipt?.result && (
              <SettingsSection title={gt("Import complete")}>
                <View className="gap-2 px-4 py-3">
                  <Text>
                    <T>
                      <Var>{receipt.result.agents.length}</Var> agents imported
                    </T>
                  </Text>
                  {receipt.result.skipped.map((item) => (
                    <Text key={item.key}>
                      {item.name}: {item.reason}
                    </Text>
                  ))}
                  {[...new Set(receipt.result.warnings)].map((warning) => (
                    <Text key={warning}>{warning}</Text>
                  ))}
                </View>
              </SettingsSection>
            )}
            {recovery &&
              (!receipt || receipt.state === "uncertain" || receipt.state === "applying") && (
                <>
                  <Text>
                    <T>
                      The original import is unconfirmed. Check its status before starting another
                      transfer.
                    </T>
                  </Text>
                  <Button
                    label={gt("Recover transfer status")}
                    tone="secondary"
                    disabled={!editable}
                    onPress={() => void refresh()}
                  />
                </>
              )}
            {recovery && (review || canClear) && (
              <Button
                label={review ? gt("Discard staged import") : gt("Clear this receipt")}
                tone="secondary"
                disabled={!editable}
                onPress={() => void dismissReceipt()}
              />
            )}
          </>
        )}
      </ScreenScrollView>
    </Sheet>
  );
}
