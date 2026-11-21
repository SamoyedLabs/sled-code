import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotSettingsAdminRequest } from "@t3tools/contracts";
import { settingsCapabilities } from "@t3tools/client-runtime/openbot/settings";
import * as Schema from "effect/Schema";
import { useRef, useState, type ComponentProps } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { ListRowLayout } from "../../components/ui/ListRowLayout";
import { Menu } from "../../components/ui/Menu";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { Sheet } from "../../components/ui/Sheet";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { BotAvatar } from "../bots/upstream/BotAvatar";
import * as Dialog from "../../components/ui/Dialog";
import { SettingsSection } from "./components/SettingsSection";
import { m } from "../../i18n/messages";
import { T, msg, useGT } from "gt-react-native";

type Scope = { environmentId: EnvironmentId; hostId: string };
const modes = Schema.Literals(["queue", "steer"]);
const overview = Schema.decodeUnknownOption(
  Schema.Struct({
    defaults: Schema.Struct({
      allowAutomation: Schema.Boolean,
      allowNewChat: Schema.Boolean,
      quickAcknowledgement: Schema.Boolean,
      planStartAfterMs: Schema.NullOr(Schema.Int),
      automationRunsPerHour: Schema.Int,
      commitCoAuthor: Schema.Boolean,
    }),
    busyMessageMode: modes,
    agents: Schema.Array(
      Schema.Struct({
        agentId: Schema.String,
        allowAutomation: Schema.NullOr(Schema.Boolean),
        allowNewChat: Schema.NullOr(Schema.Boolean),
        quickAcknowledgement: Schema.NullOr(Schema.Boolean),
        busyMessageMode: Schema.NullOr(modes),
      }),
    ),
  }),
);
const background = Schema.decodeUnknownOption(
  Schema.Struct({
    processes: Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          pid: Schema.Int,
          command: Schema.String,
          startedAt: Schema.Int,
          ports: Schema.Array(Schema.Int),
          agentId: Schema.NullOr(Schema.String),
        }),
      ),
    ),
  }),
);
const settings = [
  { key: "allowAutomation", title: m(msg("Local automation")) },
  { key: "allowNewChat", title: m(msg("Let bots start new chats")) },
  { key: "quickAcknowledgement", title: m(msg("Show a plan before working")) },
  { key: "busyMessageMode", title: m(msg("Messages while working")) },
] as const;
const choices = ["default", "on", "off"] as const;
const planStartPresets = [10_000, 30_000, 60_000, 300_000];
const automationLimitPresets = [30, 60, 120, 300, 1_000];

function withSavedValue(presets: readonly number[], saved: number | null) {
  return saved === null || presets.includes(saved) ? presets : [...presets, saved];
}

function planStartLabel(time: number | null) {
  if (time === null) return m(msg("Wait for Start"));
  const seconds = Math.round(time / 1_000);
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  if (minutes === 0) return `${seconds} sec`;
  return remaining === 0 ? `${minutes} min` : `${minutes} min ${remaining} sec`;
}

type Setting = (typeof settings)[number]["key"];
type Choice = (typeof choices)[number];
function AdminMenu({
  disabled,
  actions,
  onPressAction,
  ...props
}: ComponentProps<typeof Menu> & { disabled: boolean }) {
  return (
    <Menu
      {...props}
      actions={
        disabled
          ? actions.map((action) => ({
              ...action,
              attributes: { ...action.attributes, disabled: true },
            }))
          : actions
      }
      onPressAction={disabled ? undefined : onPressAction}
    />
  );
}

function useHostAdmin({ environmentId, hostId }: Scope) {
  const gt = useGT();
  const set = useAtomCommand(openbot.adminToHost, { reportFailure: false });
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (request: typeof OpenbotSettingsAdminRequest.Type, refresh: () => void) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    await (async () => {
      const result = await set({ environmentId, input: { hostId, request } });
      if (result._tag === "Failure") setError(gt("The bot computer did not confirm the change."));
      refresh();
    })().finally(() => {
      pending.current = false;
      setBusy(false);
    });
  };
  return { run, busy, error };
}

export function BotHostAgentDefaults(scope: Scope) {
  const gt = useGT();
  const { environmentId, hostId } = scope;
  const access = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.agent-defaults.settings", parameters: {} },
    }),
  );
  const write = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "settings.agent-defaults.update",
        parameters: { commitCoAuthor: true },
      },
    }),
  );
  const compat = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const available = settingsCapabilities(compat.data).includes("agent-defaults-v1");
  const query = useEnvironmentQuery(
    available && access
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "settings.agent-defaults.settings", parameters: {} },
          },
        })
      : null,
  );
  const agents = useEnvironmentQuery(
    available && access ? openbot.agents({ environmentId, input: {} }) : null,
  );
  const decoded = overview(query.data);
  const data = decoded._tag === "Some" ? decoded.value : null;
  const { run, busy, error } = useHostAdmin(scope);
  const [selectedKey, setSelectedKey] = useState<Setting | null>(null);
  const selected = settings.find(({ key }) => key === selectedKey);
  if (!available || !access) return null;
  const change = (patch: Record<string, boolean | number | string | null>) =>
    void run({ operation: "settings.agent-defaults.update", parameters: patch }, query.refresh);
  const setChoice = (key: Setting, choice: Choice, ids: readonly string[]) =>
    void run(
      {
        operation: "settings.agent-defaults.choice",
        parameters: { setting: key, choice, agentIds: [...ids] },
      },
      query.refresh,
    );
  const canChange = Boolean(data && write && !busy);
  const label = (key: Setting, choice: Choice) =>
    choice === "default"
      ? "Follow host default"
      : key === "busyMessageMode"
        ? choice === "on"
          ? "Steer current work"
          : "Queue"
        : choice === "on"
          ? "On"
          : "Off";
  const defaultOn = (key: Setting) =>
    key === "busyMessageMode" ? data?.busyMessageMode === "steer" : data?.defaults[key] === true;
  const own = (key: Setting, value: null | string | boolean): Choice =>
    value === null
      ? "default"
      : value === true || (value === "steer" && key === "busyMessageMode")
        ? "on"
        : "off";
  const known = new Map((agents.data ?? []).map((agent) => [agent.id, agent]));
  const listed = data?.agents.filter(({ agentId }) => known.has(agentId)) ?? [];
  return (
    <>
      <SettingsSection title={gt("Bot defaults")}>
        {(query.error || error) && (
          <Text accessibilityRole="alert" className="px-4 py-2 text-destructive">
            {error || query.error}
          </Text>
        )}
        {query.isPending && !data && (
          <Text className="px-4 py-3 text-foreground-muted">
            <T>Loading bot defaults…</T>
          </Text>
        )}
        {data &&
          settings.map(({ key, title }) => {
            const enabled = listed.filter((agent) => {
              const choice = own(key, agent[key]);
              return choice === "default" ? defaultOn(key) : choice === "on";
            }).length;
            return (
              <Pressable key={key} accessibilityRole="button" onPress={() => setSelectedKey(key)}>
                <ListRowLayout
                  label={title}
                  description={label(key, defaultOn(key) ? "on" : "off")}
                  detail={`${enabled} of ${listed.length}`}
                />
              </Pressable>
            );
          })}
        {data && (
          <AdminMenu
            actions={[true, false].map((enabled) => ({
              id: String(enabled),
              title: enabled ? gt("On") : gt("Off"),
              state: data.defaults.commitCoAuthor === enabled ? "on" : "off",
            }))}
            onPressAction={({ nativeEvent }) =>
              change({ commitCoAuthor: nativeEvent.event === "true" })
            }
            disabled={!canChange}
          >
            <ListRowLayout
              label={gt("Add a bot co-author to commits")}
              detail={data.defaults.commitCoAuthor ? gt("On") : gt("Off")}
            />
          </AdminMenu>
        )}
      </SettingsSection>
      {selected && data && (
        <Sheet title={selected.title} onClose={() => setSelectedKey(null)}>
          <ScreenScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-4 px-5 py-4"
          >
            {error && (
              <Text accessibilityRole="alert" className="text-destructive">
                {error}
              </Text>
            )}
            <SettingsSection title={gt("Host default")}>
              <AdminMenu
                disabled={!canChange}
                actions={choices.slice(1).map((choice) => ({
                  id: choice,
                  title: label(selected.key, choice),
                  state: (choice === "on") === defaultOn(selected.key) ? "on" : "off",
                }))}
                onPressAction={({ nativeEvent }) => {
                  const on = nativeEvent.event === "on";
                  change({
                    [selected.key]:
                      selected.key === "busyMessageMode" ? (on ? "steer" : "queue") : on,
                  });
                }}
              >
                <ListRowLayout
                  label={selected.title}
                  detail={label(selected.key, defaultOn(selected.key) ? "on" : "off")}
                />
              </AdminMenu>
              {selected.key === "quickAcknowledgement" && (
                <AdminMenu
                  disabled={!canChange}
                  actions={[
                    null,
                    ...withSavedValue(planStartPresets, data.defaults.planStartAfterMs),
                  ].map((time) => ({
                    id: String(time),
                    title: planStartLabel(time),
                    state: time === data.defaults.planStartAfterMs ? "on" : "off",
                  }))}
                  onPressAction={({ nativeEvent }) =>
                    change({
                      planStartAfterMs:
                        nativeEvent.event === "null" ? null : Number(nativeEvent.event),
                    })
                  }
                >
                  <ListRowLayout
                    label={gt("Start a plan after")}
                    detail={planStartLabel(data.defaults.planStartAfterMs)}
                  />
                </AdminMenu>
              )}
              {selected.key === "allowAutomation" && (
                <AdminMenu
                  disabled={!canChange}
                  actions={[
                    ...withSavedValue(automationLimitPresets, data.defaults.automationRunsPerHour),
                  ]
                    .sort((a, b) => a - b)
                    .map((count) => ({
                      id: String(count),
                      title: String(count),
                      state: count === data.defaults.automationRunsPerHour ? "on" : "off",
                    }))}
                  onPressAction={({ nativeEvent }) =>
                    change({ automationRunsPerHour: Number(nativeEvent.event) })
                  }
                >
                  <ListRowLayout
                    label={gt("Runs per hour")}
                    detail={String(data.defaults.automationRunsPerHour)}
                  />
                </AdminMenu>
              )}
            </SettingsSection>
            <SettingsSection title={gt("Bot overrides")}>
              {listed.length > 0 && (
                <AdminMenu
                  disabled={!canChange}
                  actions={choices.map((choice) => ({
                    id: choice,
                    title: label(selected.key, choice),
                  }))}
                  onPressAction={({ nativeEvent }) => {
                    const choice = choices.find((candidate) => candidate === nativeEvent.event);
                    if (choice)
                      setChoice(
                        selected.key,
                        choice,
                        listed.map(({ agentId }) => agentId),
                      );
                  }}
                >
                  <ListRowLayout label={gt("Set all")} />
                </AdminMenu>
              )}
              {listed.map((entry) => {
                const agent = known.get(entry.agentId)!;
                const checked = own(selected.key, entry[selected.key]);
                return (
                  <AdminMenu
                    key={entry.agentId}
                    disabled={!canChange}
                    actions={choices.map((choice) => ({
                      id: choice,
                      title: label(selected.key, choice),
                      state: choice === checked ? "on" : "off",
                    }))}
                    onPressAction={({ nativeEvent }) => {
                      const choice = choices.find((candidate) => candidate === nativeEvent.event);
                      if (choice && choice !== checked)
                        setChoice(selected.key, choice, [entry.agentId]);
                    }}
                  >
                    <ListRowLayout
                      label={agent.name}
                      detail={label(selected.key, checked)}
                      accessory={
                        <BotAvatar
                          seed={agent.avatarSeed ?? agent.id}
                          hue={agent.avatarHue}
                          size={28}
                        />
                      }
                    />
                  </AdminMenu>
                );
              })}
            </SettingsSection>
          </ScreenScrollView>
        </Sheet>
      )}
    </>
  );
}

export function BotBackgroundProcesses(scope: Scope) {
  const gt = useGT();
  const { environmentId, hostId } = scope;
  const access = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, {
      hostId,
      request: { operation: "settings.background-processes.list", parameters: {} },
    }),
  );
  const allowStop = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, {
      hostId,
      request: {
        operation: "settings.background-processes.stop",
        parameters: { id: "permission" },
      },
    }),
  );
  const compat = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const available = settingsCapabilities(compat.data).includes("background-processes-v1");
  const [open, setOpen] = useState(false);
  const query = useEnvironmentQuery(
    available && access && open
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: { operation: "settings.background-processes.list", parameters: {} },
          },
        })
      : null,
  );
  const { run, busy, error } = useHostAdmin(scope);
  const decoded = background(query.data);
  if (!available || !access) return null;
  const rows = decoded._tag === "Some" ? decoded.value.processes : null;
  return (
    <>
      <SettingsSection>
        <Pressable accessibilityRole="button" onPress={() => setOpen(true)}>
          <ListRowLayout label={gt("Background programs")} />
        </Pressable>
      </SettingsSection>
      {open && (
        <Sheet title={gt("Background programs")} onClose={() => setOpen(false)}>
          <ScreenScrollView
            contentInsetAdjustmentBehavior="automatic"
            contentContainerClassName="gap-3 px-5 py-4"
          >
            {(query.error || error) && (
              <Text accessibilityRole="alert" className="text-destructive">
                {error || query.error}
              </Text>
            )}
            {query.isPending && (
              <Text className="text-foreground-muted">
                <T>Looking for background programs…</T>
              </Text>
            )}
            {decoded._tag === "Some" &&
              (rows === null ? (
                <Text className="text-foreground-muted">
                  <T>This computer does not report background programs.</T>
                </Text>
              ) : rows.length === 0 ? (
                <Text className="text-foreground-muted">
                  <T>No background programs.</T>
                </Text>
              ) : (
                rows.map((row) => (
                  <AdminMenu
                    key={row.id}
                    disabled={!allowStop || busy}
                    actions={[
                      { id: "stop", title: gt("Stop program"), attributes: { destructive: true } },
                    ]}
                    onPressAction={() =>
                      Dialog.confirm({
                        title: gt("Stop background program?"),
                        message: gt("This stops PID {pid} and its children on this bot computer.", {
                          pid: row.pid,
                        }),
                        confirmText: gt("Stop program"),
                        destructive: true,
                        onConfirm: () =>
                          void run(
                            {
                              operation: "settings.background-processes.stop",
                              parameters: { id: row.id },
                            },
                            query.refresh,
                          ),
                      })
                    }
                  >
                    <View className="rounded-xl bg-grouped-card p-3">
                      <Text numberOfLines={2} className="font-mono text-sm">
                        {row.command}
                      </Text>
                      <Text className="text-xs text-foreground-muted">
                        PID {row.pid}
                        {row.ports.length
                          ? gt(" · Ports {value}", { value: row.ports.join(", ") })
                          : ""}
                      </Text>
                    </View>
                  </AdminMenu>
                ))
              ))}
          </ScreenScrollView>
        </Sheet>
      )}
    </>
  );
}

const learningSettings = [
  {
    capability: "agent-memory-limit-v1",
    read: "settings.agent-memory-limit.settings",
    write: "settings.agent-memory-limit.update",
    key: "limit",
    label: m(msg("Memory capacity")),
    description: m(msg("How many memories each bot can retain.")),
  },
  {
    capability: "memory-review-v1",
    read: "settings.memory-review.settings",
    write: "settings.memory-review.update",
    key: "interval",
    label: m(msg("Background memory review")),
    description: m(msg("How often a bot reviews what it learned from a chat.")),
  },
] as const;
const learningChoice = Schema.decodeUnknownOption(
  Schema.Struct({
    choices: Schema.Array(Schema.Int).check(Schema.isMaxLength(16)),
    limit: Schema.optional(Schema.Int),
    interval: Schema.optional(Schema.Int),
  }),
);

export function BotHostLearning(scope: Scope) {
  const gt = useGT();
  const { environmentId, hostId } = scope;
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const capabilities = settingsCapabilities(compatibility.data);
  const available = learningSettings.filter(({ capability }) => capabilities.includes(capability));
  if (!available.length) return null;
  return (
    <SettingsSection title={gt("Learning")}>
      {available.map((setting) => (
        <HostLearningSetting key={setting.key} scope={scope} setting={setting} />
      ))}
    </SettingsSection>
  );
}

function HostLearningSetting({
  scope,
  setting,
}: {
  scope: Scope;
  setting: (typeof learningSettings)[number];
}) {
  const { environmentId, hostId } = scope;
  const request = { operation: setting.read, parameters: {} };
  const canRead = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, { hostId, request }),
  );
  const write = (value: number): typeof OpenbotSettingsAdminRequest.Type => ({
    operation: setting.write,
    parameters: { [setting.key]: value },
  });
  const canWrite = useAtomValue(
    openbot.adminToHost.permissionAtom(environmentId, { hostId, request: write(0) }),
  );
  const query = useEnvironmentQuery(
    canRead ? openbot.readFromHost({ environmentId, input: { hostId, request } }) : null,
  );
  const { run, busy, error } = useHostAdmin(scope);
  if (!canRead) return null;
  const decoded = learningChoice(query.data);
  const data = decoded._tag === "Some" ? decoded.value : null;
  const value = data?.[setting.key];
  const values = data && value !== undefined ? withSavedValue(data.choices, value) : [];
  const format = (count: number) =>
    setting.key === "limit" ? String(count) : count === 0 ? "Off" : `${count} turns`;
  return (
    <>
      <AdminMenu
        disabled={!canWrite || !values.length || query.isPending || busy}
        actions={values.map((count) => ({
          id: String(count),
          title: format(count),
          state: count === value ? "on" : "off",
        }))}
        onPressAction={({ nativeEvent }) => {
          const count = values.find((value) => String(value) === nativeEvent.event);
          if (count !== undefined && count !== value) void run(write(count), query.refresh);
        }}
      >
        <ListRowLayout
          label={setting.label}
          description={setting.description}
          detail={value === undefined ? undefined : format(value)}
        />
      </AdminMenu>
      {(query.error || error) && (
        <Text accessibilityRole="alert" className="px-4 text-destructive">
          {error || query.error}
        </Text>
      )}
    </>
  );
}
