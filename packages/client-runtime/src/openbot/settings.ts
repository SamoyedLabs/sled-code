import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import {
  OpenbotSettingsReadRequest,
  OpenbotSettingsAdminRequest,
  pinnedSetting,
  type OpenbotSettingsRequest,
} from "@t3tools/contracts/openbot-settings";
export type SettingsActions = {
  readonly can: (request: OpenbotSettingsRequest) => boolean;
  readonly execute: (request: OpenbotSettingsRequest) => Promise<unknown>;
};
export function settingRequest(
  operation: OpenbotSettingsRequest["operation"],
  parameters: Schema.Json,
) {
  const entry = pinnedSetting(operation);
  const decoded = Schema.decodeUnknownResult(
    entry?.kind === "read" ? OpenbotSettingsReadRequest : OpenbotSettingsAdminRequest,
  )({ operation, parameters });
  return Result.isSuccess(decoded) ? decoded.success : null;
}
export function settingResult(operation: OpenbotSettingsRequest["operation"], value: unknown) {
  try {
    return pinnedSetting(operation)?.codec.response(200, value) ?? null;
  } catch {
    return null;
  }
}
export function settingIsRead(
  request: OpenbotSettingsRequest,
): request is typeof OpenbotSettingsReadRequest.Type {
  return pinnedSetting(request.operation)?.kind === "read";
}
const decodeCapabilitiesResult = Schema.decodeUnknownResult(
  Schema.Struct({ capabilities: Schema.Array(Schema.String).check(Schema.isMaxLength(512)) }),
);
const decodeSettingRecordResult = Schema.decodeUnknownResult(
  Schema.Record(Schema.String, Schema.Json),
);
export function settingsCapabilities(value: unknown): readonly string[] {
  const decoded = decodeCapabilitiesResult(value);
  return Result.isSuccess(decoded) ? decoded.success.capabilities : [];
}
export type SettingsField = {
  readonly key: string;
  readonly label: string;
  readonly choices?: readonly {
    readonly label: string;
    readonly value: string | number | boolean | null;
  }[];
  readonly hostChoices?: boolean;
  readonly text?: boolean;
  readonly nullable?: boolean;
};
const bool = [
  { label: "On", value: true },
  { label: "Off", value: false },
] as const;
export const SETTING_FORMS = [
  {
    id: "agent-host-settings",
    label: "Host tools and incoming messages",
    agent: true,
    read: "settings.agent-host-settings.settings",
    update: "settings.agent-host-settings.update",
    fields: [
      { key: "computerUse", label: "Computer use", choices: bool },
      { key: "allowAutomation", label: "Allow local automation", choices: bool },
      {
        key: "busyMessageMode",
        label: "Messages while busy",
        choices: [
          { label: "Follow host default", value: null },
          { label: "Queue", value: "queue" },
          { label: "Steer current work", value: "steer" },
        ],
      },
    ],
  },
  {
    id: "agent-fast-mode",
    label: "Fast mode",
    agent: true,
    read: "settings.agent-fast-mode.settings",
    update: "settings.agent-fast-mode.update",
    fields: [{ key: "fastMode", label: "Use provider fast tier", choices: bool }],
  },
  {
    id: "agent-task-limit",
    label: "Concurrent tasks",
    agent: true,
    read: "settings.agent-task-limit.settings",
    update: "settings.agent-task-limit.update",
    fields: [
      {
        key: "taskLimit",
        label: "Tasks at once",
        choices: [
          { label: "Host default", value: null },
          ...[1, 2, 3, 4].map((value) => ({ label: String(value), value })),
        ],
      },
    ],
  },
  {
    id: "agent-new-chat",
    label: "Automatic new chats",
    agent: true,
    read: "settings.agent-new-chat.settings",
    update: "settings.agent-new-chat.update",
    fields: [
      { key: "allowNewChat", label: "Allow the agent to begin a fresh chat", choices: bool },
    ],
  },
  {
    id: "agent-plan-card",
    label: "Plan before long work",
    agent: true,
    read: "settings.agent-plan-card.settings",
    update: "settings.agent-plan-card.update",
    fields: [{ key: "quickAcknowledgement", label: "Show a plan before starting", choices: bool }],
  },
  {
    id: "agent-memory-limit",
    label: "Memory capacity",
    agent: false,
    read: "settings.agent-memory-limit.settings",
    update: "settings.agent-memory-limit.update",
    fields: [{ key: "limit", label: "Memories per agent", hostChoices: true }],
  },
  {
    id: "memory-review",
    label: "Background memory review",
    agent: false,
    read: "settings.memory-review.settings",
    update: "settings.memory-review.update",
    fields: [
      {
        key: "interval",
        label: "Completed turns between reviews (0 turns it off)",
        hostChoices: true,
      },
    ],
  },
  {
    id: "prompt-cache-ttl",
    label: "Prompt cache",
    agent: false,
    read: "settings.prompt-cache-ttl.settings",
    update: "settings.prompt-cache-ttl.update",
    fields: [
      {
        key: "ttl",
        label: "Requested cache duration",
        choices: [
          { label: "Provider default (5 minutes)", value: "5m" },
          { label: "One hour", value: "1h" },
        ],
      },
    ],
  },
  {
    id: "host-timezone",
    label: "Default routine timezone",
    agent: false,
    read: "settings.host-timezone.settings",
    update: "settings.host-timezone.update",
    fields: [
      {
        key: "timezone",
        label: "Timezone (blank follows this machine)",
        text: true,
        nullable: true,
      },
    ],
  },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly agent: boolean;
  readonly read: OpenbotSettingsRequest["operation"];
  readonly update: OpenbotSettingsRequest["operation"];
  readonly fields: readonly SettingsField[];
}[];
export function settingRecord(value: unknown): Record<string, Schema.Json> {
  const decoded = decodeSettingRecordResult(value);
  return Result.isSuccess(decoded) ? decoded.success : {};
}
export function settingOptions(
  field: SettingsField,
  result: unknown,
): readonly { readonly label: string; readonly value: Schema.Json }[] {
  if (field.choices) return field.choices;
  const choices = settingRecord(result).choices;
  return field.hostChoices && Array.isArray(choices)
    ? choices
        .filter((value) => typeof value === "number")
        .map((value) => ({ label: String(value), value }))
    : [];
}

export { settingsAdvanced, type SettingControl, type SettingSection } from "./settingsAdvanced.ts";

export function invalidateSettingGroup(
  values: Readonly<Record<string, Schema.Json>>,
  operation: OpenbotSettingsRequest["operation"],
): Readonly<Record<string, Schema.Json>> {
  const group = operation.split(".")[1];
  return Object.fromEntries(
    Object.entries(values).filter(
      ([key]) =>
        !key.startsWith(`settings.${group}.`) &&
        !key.startsWith(`parameters:settings.${group}.`) &&
        key !== `latest:${group}` &&
        key !== `latest-parameters:${group}`,
    ),
  );
}
