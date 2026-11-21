import { useEffect, useId, useState, type ReactNode } from "react";
import type { Json } from "effect/Schema";
import {
  SETTING_FORMS,
  settingRecord,
  settingOptions,
  settingRequest,
  settingsAdvanced,
  type SettingsActions,
  type SettingsField,
} from "@t3tools/client-runtime/openbot/settings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { cn } from "../../lib/utils";
import { useBotSettings } from "./useBotSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { BotSettingsAdvanced } from "./BotSettingsAdvanced";
import { botSettingDescriptions, botSettingsSections } from "./botSettingsSections";
import { T, Var, useGT } from "gt-react";

export function BotSettings({
  agentId,
  capabilities,
  actions,
  content,
}: {
  agentId?: string | undefined;
  capabilities: readonly string[];
  actions: SettingsActions;
  content?: Readonly<Partial<Record<string, ReactNode>>>;
}) {
  const gt = useGT();
  const [selected, setSelected] = useState("general");
  const forms = SETTING_FORMS.filter(
    (form) => form.agent === Boolean(agentId) && capabilities.includes(`${form.id}-v1`),
  );
  const advanced = settingsAdvanced(agentId, capabilities, {}, {});
  const sections = botSettingsSections.filter(
    (section) =>
      content?.[section.id] !== undefined ||
      forms.some((form) => (section.forms as readonly string[]).includes(form.id)) ||
      advanced.some((item) => (section.advanced as readonly string[]).includes(item.id)),
  );
  const current = sections.find((section) => section.id === selected) ?? sections[0];
  if (!current)
    return (
      <div role="status" className="rounded-xl bg-muted/30 p-6 text-sm text-muted-foreground">
        <T>
          This host does not expose <Var>{agentId ? "bot" : "host"}</Var> settings yet.
        </T>
      </div>
    );
  return (
    <section
      aria-label={agentId ? gt("Bot settings") : gt("Host settings")}
      className="grid min-w-0 gap-6 md:grid-cols-[196px_minmax(0,1fr)] md:gap-8"
    >
      <aside className="min-w-0">
        <p className="mb-3 px-3 text-xs font-medium text-muted-foreground">
          {agentId ? gt("Bot settings") : gt("Host settings")}
        </p>
        <nav
          aria-label={agentId ? gt("Bot settings sections") : gt("Host settings sections")}
          className="flex gap-1 overflow-x-auto md:flex-col"
        >
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.id}
                type="button"
                aria-current={current.id === section.id ? "page" : undefined}
                onClick={() => setSelected(section.id)}
                className={cn(
                  "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  current.id === section.id && "bg-muted font-medium text-foreground",
                )}
              >
                <Icon aria-hidden className="size-4 shrink-0" />
                {section.label}
              </button>
            );
          })}
        </nav>
      </aside>
      <div className="min-w-0 space-y-6">
        <header>
          <h2 className="text-balance text-xl font-semibold">{current.label}</h2>
          <p className="mt-1 text-pretty text-sm text-muted-foreground">{current.description}</p>
          {!agentId && (
            <p className="mt-2 text-xs text-muted-foreground">
              <T>Applies to the connected host.</T>
            </p>
          )}
        </header>
        {forms.map((form) => (
          <BotSettingForm
            key={form.id}
            form={form}
            agentId={agentId}
            actions={actions}
            active={(current.forms as readonly string[]).includes(form.id)}
          />
        ))}
        {content?.[current.id]}
        <BotSettingsAdvanced
          agentId={agentId}
          capabilities={capabilities}
          actions={actions}
          sectionIds={current.advanced}
        />
      </div>
    </section>
  );
}

function BotSettingForm({
  form,
  agentId,
  actions,
  active,
}: {
  active: boolean;
  form: (typeof SETTING_FORMS)[number];
  agentId: string | undefined;
  actions: SettingsActions;
}) {
  const gt = useGT();
  const c = useBotSettings(actions);
  const id = useId();
  const [drafts, setDrafts] = useState<Readonly<Record<string, Json>>>({});
  const [saved, setSaved] = useState(false);
  const value = c.results[form.read] ?? c.results[form.update];
  const data = settingRecord(value);
  const fields: readonly SettingsField[] = form.fields;
  const fieldValue = (field: SettingsField) =>
    Object.hasOwn(drafts, field.key) ? (drafts[field.key] ?? null) : (data[field.key] ?? null);
  const parameters = form.agent && agentId ? { agentId } : {};
  const body: Record<string, Json> = { ...parameters };
  for (const field of fields) body[field.key] = fieldValue(field);
  const read = settingRequest(form.read, parameters);
  const save = settingRequest(form.update, body);
  const canRead = read !== null && actions.can(read);
  const canSave = save !== null && actions.can(save);
  const dirty = fields.some(
    (field) => Object.hasOwn(drafts, field.key) && drafts[field.key] !== data[field.key],
  );
  const load = async () => {
    const result = await c.run(form.read, parameters);
    if (result !== null) setDrafts({});
  };
  const loadOnOpen = useStableCallback(() => {
    if (value === undefined) void load();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the selected setting from the connected host when its panel opens or read access changes
  useEffect(() => {
    if (active && canRead) loadOnOpen();
  }, [active, canRead, loadOnOpen]);
  const update = async () => {
    setSaved(false);
    const result = await c.run(form.update, body);
    if (result !== null) {
      const refreshed = await c.run(form.read, parameters);
      if (refreshed !== null) {
        setDrafts({});
        setSaved(true);
      }
    }
  };
  return (
    <section
      hidden={!active}
      aria-labelledby={`${id}-title`}
      aria-busy={c.busy}
      className="space-y-2"
    >
      <h3 id={`${id}-title`} className="text-sm font-medium">
        {form.label}
      </h3>
      {!canRead ? (
        <p className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
          <T>You need permission to read these settings on this host.</T>
        </p>
      ) : value === undefined ? (
        <div className="rounded-xl bg-muted/30 p-4">
          <p role="status" className="text-sm text-muted-foreground">
            {c.busy ? gt("Loading settings…") : gt("Settings haven’t loaded.")}
          </p>
          {!c.busy && (
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={() => void load()}>
                <T>Try again</T>
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="divide-y divide-border/60 overflow-hidden rounded-xl bg-muted/30">
          {fields.map((field) => {
            const options = settingOptions(field, value);
            const boolean =
              options.length === 2 && options.every((option) => typeof option.value === "boolean");
            const fieldId = `${id}-${field.key}`;
            const disabled = c.busy || !canSave;
            const change = (next: Json) => {
              setSaved(false);
              setDrafts((current) => ({ ...current, [field.key]: next }));
            };
            return (
              <div
                key={field.key}
                className="flex min-h-16 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1 basis-48">
                  <label htmlFor={fieldId} className="text-sm font-medium">
                    {field.label}
                  </label>
                  <p
                    id={`${fieldId}-description`}
                    className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground"
                  >
                    {botSettingDescriptions[field.key]}
                  </p>
                </div>
                {boolean ? (
                  <Switch
                    id={fieldId}
                    aria-describedby={`${fieldId}-description`}
                    checked={fieldValue(field) === true}
                    disabled={disabled}
                    onCheckedChange={change}
                  />
                ) : (
                  <div className="w-52 max-w-full">
                    {field.text ? (
                      <Input
                        id={fieldId}
                        aria-describedby={`${fieldId}-description`}
                        disabled={disabled}
                        value={
                          typeof fieldValue(field) === "string" ? String(fieldValue(field)) : ""
                        }
                        placeholder={gt("System default")}
                        onChange={(event) =>
                          change(event.target.value || (field.nullable ? null : ""))
                        }
                      />
                    ) : (
                      <Select
                        value={JSON.stringify(fieldValue(field))}
                        disabled={disabled || options.length === 0}
                        items={options.map((option) => ({
                          value: JSON.stringify(option.value),
                          label: option.label,
                        }))}
                        onValueChange={(next) => {
                          const option = options.find(
                            (item) => JSON.stringify(item.value) === next,
                          );
                          if (option) change(option.value);
                        }}
                      >
                        <SelectTrigger
                          id={fieldId}
                          aria-label={field.label}
                          aria-describedby={`${fieldId}-description`}
                        >
                          <SelectValue placeholder={gt("No options available")} />
                        </SelectTrigger>
                        <SelectPopup>
                          {options.map((option) => (
                            <SelectItem
                              key={JSON.stringify(option.value)}
                              value={JSON.stringify(option.value)}
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectPopup>
                      </Select>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {value !== undefined && (
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
          {!canSave && (
            <p className="mr-auto text-xs text-muted-foreground">
              <T>Host settings permission is required to make changes.</T>
            </p>
          )}
          {saved && (
            <p role="status" className="mr-auto text-xs text-muted-foreground">
              <T>Saved</T>
            </p>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={c.busy || !canRead}
            onClick={() => {
              setSaved(false);
              void load();
            }}
          >
            {dirty ? gt("Discard changes") : gt("Reload")}
          </Button>
          <Button size="sm" disabled={c.busy || !dirty || !canSave} onClick={() => void update()}>
            {c.busy ? gt("Working…") : gt("Save changes")}
          </Button>
        </div>
      )}
      {c.notice && (
        <p role="status" className="text-sm text-muted-foreground">
          {c.notice}
        </p>
      )}
    </section>
  );
}
