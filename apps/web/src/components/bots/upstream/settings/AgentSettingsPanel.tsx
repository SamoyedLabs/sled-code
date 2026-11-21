/* oxlint-disable shadcn/no-unknown-classes -- Original AgentSettingsPanel selectors are supplied by source CSS. */
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { AgentAvatarEditor, type AgentAvatarValue } from "./AgentAvatarEditor";
import type { AvatarHue } from "./avatar-editor-model";
import type { AvatarImageInput } from "./avatar-image";
import {
  SettingsLinkGroup,
  SettingsLinkRow,
  SettingsPanelContent,
  SettingsPanelHeader,
} from "./SettingsPanel";
import "./agent-settings.css";
import { ResizableTextarea } from "./ResizableTextarea";
import { cn } from "../../../../lib/utils";

export interface AgentProfileSettings extends AgentAvatarValue {
  name: string;
  title: string;
  description: string;
}
export interface AgentProfilePatch {
  name?: string;
  title?: string;
  description?: string;
  avatarSeed?: string;
  avatarHue?: AvatarHue | null;
}
export interface AgentSettingsSection {
  id: string;
  label: string;
  icon?: ReactNode;
  value?: ReactNode;
  group: "Brain" | "Knows" | "Does" | "Rules";
  content: ReactNode | ((onBack: () => void) => ReactNode);
  fullPage?: boolean;
  onOpen?: (() => void) | undefined;
}
export interface AgentSettingsPanelProps {
  layout?: "page" | "panel" | undefined;
  agent: AgentProfileSettings;
  onClose: () => void;
  onUpdateAgent?: ((agentId: string, patch: AgentProfilePatch) => Promise<void>) | undefined;
  onSetAgentAvatar?:
    | ((agentId: string, image: AvatarImageInput | null) => Promise<void>)
    | undefined;
  brain?: ReactNode;
  backupModels?: ReactNode;
  notifications?: ReactNode;
  links?: ReactNode;
  sections?: readonly AgentSettingsSection[];
  detail?: ReactNode;
}
type TextFields = Pick<AgentProfileSettings, "name" | "title" | "description">;
type TextField = keyof TextFields;
interface SaveRequest {
  field: TextField;
  draft: string;
  stored: string;
}

export function AgentSettingsPanel(props: AgentSettingsPanelProps) {
  return <AgentSettingsContents key={props.agent.id} {...props} />;
}
function AgentSettingsContents({
  layout = "panel",
  agent,
  onClose,
  onUpdateAgent,
  onSetAgentAvatar,
  brain,
  backupModels,
  notifications,
  links,
  sections = [],
  detail,
}: AgentSettingsPanelProps) {
  const [fields, setFields] = useState<TextFields>({
    name: agent.name,
    title: agent.title,
    description: agent.description,
  });
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const current = sections.find((section) => section.id === selected);
  const draft = useRef(fields);
  const dirty = useRef<Record<TextField, boolean>>({
    name: false,
    title: false,
    description: false,
  });
  const pending = useRef(new Map<TextField, SaveRequest>());
  const active = useRef<SaveRequest | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const disposed = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<string | null>(null);
  const id = useId();
  const drain = useStableCallback(async () => {
    if (active.current || !onUpdateAgent) return;
    for (;;) {
      const request = pending.current.values().next().value;
      if (!request) return;
      pending.current.delete(request.field);
      active.current = request;
      if (!disposed.current) setError(null);
      const settled = await settlePromise(async () => {
        await onUpdateAgent(agent.id, { [request.field]: request.stored });
        if (draft.current[request.field] === request.draft) dirty.current[request.field] = false;
      });
      if (settled._tag === "Failure" && !disposed.current) {
        const cause = squashAtomCommandFailure(settled);
        setError(cause instanceof Error ? cause.message : "Could not save the agent settings.");
      }
      active.current = null;
    }
  });
  const queue = useStableCallback((field: TextField) => {
    if (!onUpdateAgent || !dirty.current[field]) return;
    const value = draft.current[field];
    if (field === "description" && value.length > 2000) return;
    if (active.current?.field === field && active.current.draft === value) return;
    pending.current.set(field, {
      field,
      draft: value,
      stored:
        field === "name" ? value.trim() || "New agent" : field === "title" ? value.trim() : value,
    });
    void drain();
  });
  const flush = useStableCallback(() => {
    clearTimeout(timer.current);
    for (const field of ["name", "title", "description"] as const) queue(field);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Live agent events refresh clean fields; a locally edited field keeps its draft until its exact queued save succeeds.
  useEffect(() => {
    const next = { ...draft.current };
    if (!dirty.current.name) next.name = agent.name;
    if (!dirty.current.title) next.title = agent.title;
    if (!dirty.current.description) next.description = agent.description;
    draft.current = next;
    setFields(next);
  }, [agent.name, agent.title, agent.description]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- The source panel flushes pending profile edits when the panel closes or the selected agent changes.
  useEffect(() => {
    disposed.current = false;
    return () => {
      flush();
      disposed.current = true;
    };
  }, [flush]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Restore the source navigation focus when its root rows remount, and move focus into an opened section.
  useLayoutEffect(() => {
    if (current)
      root.current
        ?.querySelector<HTMLElement>("button:not(:disabled),input,textarea,select")
        ?.focus();
    else if (returnFocus.current) {
      root.current
        ?.querySelector<HTMLButtonElement>(
          `[data-section="${CSS.escape(returnFocus.current)}"] button`,
        )
        ?.focus();
      returnFocus.current = null;
    }
  }, [current]);
  const change = (field: TextField, value: string) => {
    dirty.current[field] = true;
    draft.current = { ...draft.current, [field]: value };
    setFields(draft.current);
    if (field === "description") {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => queue(field), 400);
    }
  };
  const blur = (field: TextField) => {
    if (field !== "description") {
      const value =
        field === "name" ? draft.current[field].trim() || "New agent" : draft.current[field].trim();
      draft.current = { ...draft.current, [field]: value };
      setFields(draft.current);
    } else clearTimeout(timer.current);
    queue(field);
  };
  const back = useStableCallback(() => {
    returnFocus.current = selected;
    setSelected(null);
  });
  const close = () => {
    flush();
    onClose();
  };
  if (detail !== undefined) return detail;
  if (current?.fullPage)
    return typeof current.content === "function" ? current.content(back) : current.content;
  return (
    <>
      {(layout === "panel" || current) && (
        <SettingsPanelHeader
          title={current?.label ?? "Bot settings"}
          onBack={current ? back : undefined}
          onClose={close}
          paneRoot={!current}
        />
      )}
      <SettingsPanelContent embedded={layout === "page"}>
        <div ref={root} className="agent-settings-page min-w-0">
          {current ? (
            typeof current.content === "function" ? (
              current.content(back)
            ) : (
              current.content
            )
          ) : (
            <>
              <div
                className={cn(
                  "space-y-4",
                  layout === "page" &&
                    "grid min-w-0 gap-6 space-y-0 rounded-xl border border-border/60 bg-card/40 p-5 sm:grid-cols-[7rem_minmax(0,1fr)]",
                )}
              >
                <div>
                  <AgentAvatarEditor
                    agent={agent}
                    onUpdate={onUpdateAgent ? (patch) => onUpdateAgent(agent.id, patch) : undefined}
                    onSetAvatar={
                      onSetAgentAvatar ? (image) => onSetAgentAvatar(agent.id, image) : undefined
                    }
                  />
                  {layout === "page" && (
                    <p className="mt-2 text-center text-xs text-muted-foreground">Bot avatar</p>
                  )}
                </div>
                <div className="min-w-0 space-y-4 [&>.settings-field]:m-0">
                  <label className="settings-field" htmlFor={`${id}-name`}>
                    <span>Name</span>
                    <input
                      id={`${id}-name`}
                      className="ui-input"
                      aria-label="Agent name"
                      maxLength={80}
                      value={fields.name}
                      readOnly={!onUpdateAgent}
                      onChange={(event) => change("name", event.target.value)}
                      onBlur={() => blur("name")}
                    />
                  </label>
                  <label className="settings-field" htmlFor={`${id}-title`}>
                    <span>Title</span>
                    <input
                      id={`${id}-title`}
                      className="ui-input"
                      aria-label="Agent title"
                      placeholder="Describe what your agent does"
                      maxLength={120}
                      value={fields.title}
                      readOnly={!onUpdateAgent}
                      onChange={(event) => change("title", event.target.value)}
                      onBlur={() => blur("title")}
                    />
                  </label>
                  <label className="settings-field" htmlFor={`${id}-description`}>
                    <span>Description</span>
                    <ResizableTextarea
                      resizeLabel="Resize description"
                      id={`${id}-description`}
                      className="ui-textarea settings-instructions-input settings-description-input"
                      rows={3}
                      aria-label="Agent description"
                      placeholder="What this agent is for"
                      aria-invalid={fields.description.length > 2000}
                      value={fields.description}
                      readOnly={!onUpdateAgent}
                      onChange={(event) => change("description", event.target.value)}
                      onBlur={() => blur("description")}
                    />
                    {fields.description.length > 2000 && (
                      <span role="alert">Description must be 2,000 characters or fewer.</span>
                    )}
                  </label>
                </div>
              </div>
              <div
                className={cn(
                  "flex min-w-0 flex-col gap-4",
                  layout === "page" && "grid items-start gap-x-5 sm:grid-cols-2",
                )}
              >
                {(brain ||
                  backupModels ||
                  sections.some((section) => section.group === "Brain")) && (
                  <SettingsLinkGroup title="Brain" inset className="agent-settings-runtime-rows">
                    {brain}
                    {backupModels}
                    {sections
                      .filter((section) => section.group === "Brain")
                      .map((section) => (
                        <div key={section.id} data-section={section.id}>
                          <SettingsLinkRow
                            icon={section.icon}
                            label={section.label}
                            value={section.value}
                            onClick={() => {
                              flush();
                              setSelected(section.id);
                            }}
                          />
                        </div>
                      ))}
                  </SettingsLinkGroup>
                )}
                {links}
                {(["Knows", "Does", "Rules"] as const).map((group) => {
                  const rows = sections.filter((section) => section.group === group);
                  return rows.length > 0 ? (
                    <SettingsLinkGroup key={group} title={group} inset>
                      {rows.map((section) => (
                        <div key={section.id} data-section={section.id}>
                          <SettingsLinkRow
                            icon={section.icon}
                            label={section.label}
                            value={section.value}
                            onClick={() => {
                              flush();
                              if (section.onOpen) section.onOpen();
                              else setSelected(section.id);
                            }}
                          />
                        </div>
                      ))}
                    </SettingsLinkGroup>
                  ) : null;
                })}
                {notifications}
              </div>
            </>
          )}
          {error && (
            <p className="agent-settings-save-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </SettingsPanelContent>
    </>
  );
}
