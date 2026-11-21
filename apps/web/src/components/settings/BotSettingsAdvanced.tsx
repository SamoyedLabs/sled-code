import { useEffect, useId, useState } from "react";
import {
  settingIsRead,
  settingsAdvanced,
  type SettingsActions,
  type SettingControl,
  type SettingSection,
} from "@t3tools/client-runtime/openbot/settings";
import { useStableCallback } from "../../hooks/useStableCallback";
import { useBotSettings } from "./useBotSettings";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { confirmed } from "./BotConnectionControls";
import { T, useGT } from "gt-react";

function initialRead(section: SettingSection) {
  return section.controls.find(
    (control) =>
      control.request &&
      settingIsRead(control.request) &&
      ["read", "refresh", "list", "disk", "models", "catalog", "options", "local-list"].includes(
        control.id,
      ),
  );
}

function controlGroups(controls: readonly SettingControl[]) {
  const groups: SettingControl[][] = [];
  for (const control of controls) {
    const previous = groups.at(-1);
    if (control.kind === "button" && previous?.[0]?.kind === "button") previous.push(control);
    else groups.push([control]);
  }
  return groups;
}

export function BotSettingsAdvanced({
  agentId,
  capabilities,
  actions,
  sectionIds,
}: {
  agentId?: string | undefined;
  capabilities: readonly string[];
  actions: SettingsActions;
  sectionIds?: readonly string[];
}) {
  const gt = useGT();
  const c = useBotSettings(actions);
  const id = useId();
  const [drafts, setDrafts] = useState<Readonly<Record<string, string>>>({});
  const [noticeSection, setNoticeSection] = useState<string | null>(null);
  const sections = settingsAdvanced(agentId, capabilities, c.results, drafts).filter(
    (section) => !sectionIds || sectionIds.includes(section.id),
  );
  const [attempted, setAttempted] = useState<readonly string[]>([]);
  const selectionKey = sections
    .map((section) => {
      const request = initialRead(section)?.request;
      return `${section.id}:${request ? actions.can(request) : true}`;
    })
    .join(":");
  const loadOnOpen = useStableCallback(async () => {
    for (const section of sections) {
      const request = initialRead(section)?.request;
      if (!request || !actions.can(request) || Object.hasOwn(c.results, request.operation))
        continue;
      const key = JSON.stringify(request);
      if (attempted.includes(key)) continue;
      setAttempted((current) => [...current, key]);
      setNoticeSection(section.id);
      await c.run(request.operation, request.parameters);
      return;
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- serializes initial reads from the host, including when navigation changes during a pending request
  useEffect(() => {
    if (selectionKey && !c.busy) void loadOnOpen();
  }, [selectionKey, c.busy, loadOnOpen]);
  const activate = async (control: SettingControl, section: SettingSection) => {
    if (control.inputKey) {
      setDrafts((current) => ({ ...current, [control.inputKey!]: control.value ?? "" }));
      return;
    }
    if (
      !control.request ||
      (control.confirm && !(await confirmed(`${control.label} on the selected host?`)))
    )
      return;
    setNoticeSection(section.id);
    const result = await c.run(control.request.operation, control.request.parameters);
    const read = initialRead(section)?.request;
    if (result !== null && !settingIsRead(control.request) && read)
      await c.run(read.operation, read.parameters);
  };
  return (
    <div className="space-y-6" aria-busy={c.busy}>
      {sections.map((section) => {
        const read = initialRead(section);
        const loaded = !read?.request || Object.hasOwn(c.results, read.request.operation);
        const canRead = !read?.request || actions.can(read.request);
        const controls = section.controls.filter((control) => control !== read);
        const writable = controls.filter(
          (control) => control.request && !settingIsRead(control.request),
        );
        return (
          <section key={section.id} aria-labelledby={`${id}-${section.id}`} className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 id={`${id}-${section.id}`} className="text-sm font-medium">
                {section.title}
              </h3>
              {read && (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={c.busy || !canRead}
                  onClick={() => void activate(read, section)}
                >
                  {loaded ? gt("Reload") : c.busy ? gt("Loading…") : gt("Retry")}
                </Button>
              )}
            </div>
            {!canRead ? (
              <p className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
                <T>You need permission to read this section on the connected host.</T>
              </p>
            ) : !loaded ? (
              <p role="status" className="rounded-xl bg-muted/30 p-4 text-sm text-muted-foreground">
                {c.busy
                  ? gt("Loading settings…")
                  : gt("This section hasn’t loaded. Try again to read it from the host.")}
              </p>
            ) : (
              <div className="space-y-3 rounded-xl bg-muted/30 p-4">
                {controlGroups(controls).map((group) => (
                  <div
                    key={group[0]!.id}
                    className={group[0]!.kind === "button" ? "flex flex-wrap gap-2" : "space-y-2"}
                  >
                    {group.map((control) =>
                      control.kind === "text" ? (
                        <p
                          key={control.id}
                          className="whitespace-pre-wrap wrap-anywhere text-sm leading-relaxed text-muted-foreground"
                        >
                          {control.label}
                        </p>
                      ) : control.kind === "input" ? (
                        <label key={control.id} className="flex flex-col gap-2 text-sm">
                          <span className="font-medium">{control.label}</span>
                          <Input
                            value={control.value ?? ""}
                            disabled={c.busy}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [control.inputKey!]: event.target.value,
                              }))
                            }
                          />
                        </label>
                      ) : (
                        <Button
                          key={control.id}
                          size="sm"
                          variant={control.confirm ? "outline" : "secondary"}
                          disabled={
                            c.busy ||
                            (!control.inputKey &&
                              (!control.request || !actions.can(control.request)))
                          }
                          onClick={() => void activate(control, section)}
                        >
                          {control.label}
                        </Button>
                      ),
                    )}
                  </div>
                ))}
                {controls.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    <T>No entries are available on this host.</T>
                  </p>
                )}
                {writable.length > 0 &&
                  writable.every((control) => control.request && !actions.can(control.request)) && (
                    <p className="text-xs text-muted-foreground">
                      <T>You can view this section. Host permission is required to make changes.</T>
                    </p>
                  )}
              </div>
            )}
          </section>
        );
      })}
      {sections.some((section) => section.id === noticeSection) && c.notice && (
        <p role="status" className="rounded-lg bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
          {c.notice}
        </p>
      )}
    </div>
  );
}
