/* oxlint-disable shadcn/no-unknown-classes -- Pinned OpenBot selectors are supplied by source CSS. */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Schema from "effect/Schema";
import {
  settingRequest,
  settingResult,
  type SettingsActions,
} from "@t3tools/client-runtime/openbot/settings";
import type { OpenbotSettingsRequest } from "@t3tools/contracts/openbot-settings";
import type { Json } from "effect/Schema";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { SettingsCard, SettingsRow, SettingsSection, SourceButton } from "./SettingsParts";
import { T, Var, useGT } from "gt-react";
const memory = Schema.Struct({ limit: Schema.Number, choices: Schema.Array(Schema.Number) });
const review = Schema.Struct({ interval: Schema.Number, choices: Schema.Array(Schema.Number) });
const timezone = Schema.Struct({
  timezone: Schema.NullOr(Schema.String),
  systemTimezone: Schema.String,
});
export function HostGeneralSettings({
  actions,
  capabilities,
  identity,
  danger,
}: {
  actions: SettingsActions;
  capabilities: readonly string[];
  identity?: ReactNode;
  danger?: ReactNode;
}) {
  const gt = useGT();
  return (
    <>
      {identity}
      {capabilities.some((capability) =>
        ["host-timezone-v1", "agent-memory-limit-v1", "memory-review-v1"].includes(capability),
      ) && (
        <SettingsSection title={gt("Bot defaults")}>
          <SettingsCard>
            {capabilities.includes("host-timezone-v1") && <TimezoneSetting actions={actions} />}
            {capabilities.includes("agent-memory-limit-v1") && <MemorySetting actions={actions} />}
            {capabilities.includes("memory-review-v1") && <MemoryReviewSetting actions={actions} />}
          </SettingsCard>
        </SettingsSection>
      )}
      {danger}
    </>
  );
}
function useSetting<T>(
  actions: SettingsActions,
  operation: OpenbotSettingsRequest["operation"],
  decode: (input: unknown) => T,
) {
  const gt = useGT();
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const run = useStableCallback(
    async (next: OpenbotSettingsRequest["operation"], parameters: Json) => {
      if (lock.current) return;
      const request = settingRequest(next, parameters);
      if (!request || !actions.can(request)) {
        setError(gt("You need permission to manage this server setting."));
        return;
      }
      lock.current = true;
      setBusy(true);
      setError(null);
      const settled = await settlePromise(async () => {
        const response = settingResult(next, await actions.execute(request));
        setValue(decode(response));
      });
      if (settled._tag === "Failure") {
        const cause = squashAtomCommandFailure(settled);
        setError(cause instanceof Error ? cause.message : gt("Could not load the server setting."));
      }
      lock.current = false;
      setBusy(false);
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The selected server owns the persisted preference; read it before offering an edit.
  useEffect(() => {
    void run(operation, {});
  }, [operation, run]);
  return { value, error, busy, run, retry: () => void run(operation, {}) };
}
function TimezoneSetting({ actions }: { actions: SettingsActions }) {
  const gt = useGT();
  const c = useSetting(
    actions,
    "settings.host-timezone.settings",
    Schema.decodeUnknownSync(timezone),
  );
  const id = useId();
  const zones = ["UTC", ...Intl.supportedValuesOf("timeZone").filter((zone) => zone !== "UTC")];
  if (c.value?.timezone && !zones.includes(c.value.timezone)) zones.unshift(c.value.timezone);
  return (
    <SettingsRow
      title={gt("Timezone")}
      id={id}
      description={
        c.error ??
        gt("New routines use this timezone when the message does not give the sender's timezone.")
      }
    >
      {c.value && (
        <select
          className="ui-native-select"
          data-size="sm"
          aria-labelledby={id}
          value={c.value.timezone ?? "automatic"}
          disabled={c.busy}
          onChange={(event) =>
            void c.run("settings.host-timezone.update", {
              timezone: event.target.value === "automatic" ? null : event.target.value,
            })
          }
        >
          <option value="automatic">
            <T>
              Automatic (<Var>{c.value.systemTimezone}</Var>)
            </T>
          </option>
          {zones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      )}
      {c.error && (
        <SourceButton onClick={c.retry}>
          <T>Retry</T>
        </SourceButton>
      )}
    </SettingsRow>
  );
}
function MemorySetting({ actions }: { actions: SettingsActions }) {
  const gt = useGT();
  const c = useSetting(
    actions,
    "settings.agent-memory-limit.settings",
    Schema.decodeUnknownSync(memory),
  );
  const id = useId();
  const choices = c.value ? [...new Set([c.value.limit, ...c.value.choices])] : [];
  return (
    <SettingsRow
      title={gt("Memories per agent")}
      id={id}
      description={c.error ?? gt("How many memories each agent on this server can keep.")}
    >
      {c.value && (
        <select
          className="ui-native-select"
          data-size="sm"
          aria-labelledby={id}
          value={c.value.limit}
          disabled={c.busy}
          onChange={(event) =>
            void c.run("settings.agent-memory-limit.update", { limit: Number(event.target.value) })
          }
        >
          {choices.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      )}
      {c.error && (
        <SourceButton onClick={c.retry}>
          <T>Retry</T>
        </SourceButton>
      )}
    </SettingsRow>
  );
}
function MemoryReviewSetting({ actions }: { actions: SettingsActions }) {
  const gt = useGT();
  const c = useSetting(
    actions,
    "settings.memory-review.settings",
    Schema.decodeUnknownSync(review),
  );
  const id = useId();
  const choices = c.value ? [...new Set([c.value.interval, ...c.value.choices])] : [];
  return (
    <SettingsRow
      title={gt("Memory review")}
      id={id}
      description={
        c.error ??
        gt("How often agents on this server save lasting facts from their chats in the background.")
      }
    >
      {c.value && (
        <select
          className="ui-native-select"
          data-size="sm"
          aria-labelledby={id}
          value={c.value.interval}
          disabled={c.busy}
          onChange={(event) =>
            void c.run("settings.memory-review.update", { interval: Number(event.target.value) })
          }
        >
          {choices.map((value) => (
            <option key={value} value={value}>
              {value === 0
                ? gt("Off")
                : gt("Every {value} {value2}", { value, value2: value === 1 ? "turn" : "turns" })}
            </option>
          ))}
        </select>
      )}
      {c.error && (
        <SourceButton onClick={c.retry}>
          <T>Retry</T>
        </SourceButton>
      )}
    </SettingsRow>
  );
}
