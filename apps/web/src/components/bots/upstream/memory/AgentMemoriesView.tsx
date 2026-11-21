import { useStableCallback } from "../../../../hooks/useStableCallback";
/* oxlint-disable shadcn/no-unknown-classes -- Source AgentMemoriesView layout, search and editor state. */
import { useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import {
  SettingsPanelHeader,
  SettingsPanelContent,
  SettingsLinkGroup,
  SettingsLinkRow,
} from "../settings/SettingsPanel";
import { SourceButton } from "../settings/SettingsParts";
import { SourceSwitch } from "../provider/SourceSwitch";
import { t } from "../data/source-text";
import { AgentMemoriesEmpty } from "./AgentMemoriesEmpty";
import { memoryMatches, splitMemory, type MemoryEntry } from "./memory-model";
import "./AgentMemories.css";
export interface AgentMemoriesViewProps {
  ownerNoun: "agent" | "channel";
  ownerLabel: string;
  memories: readonly MemoryEntry[];
  inclusion?: ReadonlyMap<string, "essential" | "searchable"> | undefined;
  userControlled?: ReadonlySet<string> | undefined;
  loading: boolean;
  error: string | null;
  reachedLimit: number | null;
  savingId: string | null;
  canEdit?: boolean;
  canSetInclusion?: boolean;
  onBack: () => void;
  onClose: () => void;
  onCreate: (text: string) => Promise<boolean>;
  onUpdate: (memory: MemoryEntry, text: string) => Promise<boolean>;
  onDelete: (memory: MemoryEntry) => void;
  onSetEveryChat: (memory: MemoryEntry, everyChat: boolean) => void;
  onLetAgentDecide: (memory: MemoryEntry) => void;
  onClearAll: () => void;
}
export function AgentMemoriesView(props: AgentMemoriesViewProps) {
  const [openId, setOpenId] = useState<string | null>(null),
    [editing, setEditing] = useState(false),
    [adding, setAdding] = useState(false),
    [query, setQuery] = useState("");
  const rows = useRef(new Map<string, HTMLButtonElement>()),
    newRow = useRef<HTMLButtonElement>(null);
  const current = props.memories.find((memory) => memory.id === openId),
    matches = memoryMatches(props.memories, query),
    searching = query.trim() !== "";
  const groups = props.inclusion
    ? (["essential", "searchable"] as const)
        .map((inclusion) => ({
          title: t(inclusion === "essential" ? "memory.group.always" : "memory.group.relevant"),
          memories: matches.filter(
            (memory) => (props.inclusion!.get(memory.id) ?? "searchable") === inclusion,
          ),
        }))
        .filter((group) => group.memories.length)
    : [{ title: null, memories: matches }];
  const split = current ? splitMemory(current.text) : null;
  const editable = props.canEdit !== false;
  const stopAdding = () => {
    setAdding(false);
    queueMicrotask(() => newRow.current?.focus());
  };
  const startAdding = () => {
    setQuery("");
    setOpenId(null);
    setAdding(true);
  };
  const back = () => {
    if (!current || openId === null) {
      setOpenId(null);
      props.onBack();
      return;
    }
    const id = openId;
    setOpenId(null);
    setEditing(false);
    queueMicrotask(() => rows.current.get(id)?.focus());
  };
  return (
    <div className="agent-memories-view">
      <SettingsPanelHeader
        title={current ? (split?.body ? split.title : t("memory.single")) : t("memory.title")}
        onBack={back}
        backLabel={t(current ? "memory.backToList" : "memory.backToSettings")}
        onClose={props.onClose}
        closeLabel={t("memory.closePane")}
      />
      <SettingsPanelContent>
        <div className="agent-memories-page">
          {props.reachedLimit !== null && (
            <p className="agent-memory-limit" role="status">
              {t(props.ownerNoun === "agent" ? "memory.limitAgent" : "memory.limitChannel", {
                limit: props.reachedLimit,
              })}
            </p>
          )}
          {props.error && (
            <p className="agent-memory-error" role="alert">
              {props.error}
            </p>
          )}
          {current ? (
            <>
              {editing ? (
                <MemoryEditor
                  key={current.id}
                  initial={current.text}
                  label={t("memory.edit")}
                  saveLabel={t("common.save")}
                  saving={props.savingId === current.id}
                  onSave={async (text) => {
                    if (text === current.text || (await props.onUpdate(current, text)))
                      setEditing(false);
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <div className="agent-memories-reading">
                  <p className="agent-memories-text">{current.text}</p>
                  <p className="agent-memories-meta">
                    {t(current.origin === "automatic" ? "memory.learned" : "memory.manual")} ·{" "}
                    {memoryDate(current.updatedAt)}
                  </p>
                </div>
              )}
              {props.inclusion?.get(current.id) && (
                <SettingsLinkGroup inset className="agent-settings-runtime-rows">
                  <div className="agent-settings-switch-row">
                    <span className="settings-link-label">{t("memory.everyChat")}</span>
                    <SourceSwitch
                      label={t("memory.everyChat")}
                      checked={props.inclusion.get(current.id) === "essential"}
                      disabled={props.savingId !== null || props.canSetInclusion === false}
                      onChange={(checked) => props.onSetEveryChat(current, checked)}
                    />
                  </div>
                </SettingsLinkGroup>
              )}
              {!editing && editable && (
                <div className="agent-memories-actions">
                  <SourceButton variant="secondary" onClick={() => setEditing(true)}>
                    {t("memory.editAction")}
                  </SourceButton>
                  {props.userControlled?.has(current.id) && (
                    <SourceButton
                      variant="ghost"
                      disabled={props.savingId !== null || props.canSetInclusion === false}
                      onClick={() => props.onLetAgentDecide(current)}
                    >
                      {t("memory.inclusion.automatic")}
                    </SourceButton>
                  )}
                  <SourceButton
                    variant="ghost"
                    onClick={() => {
                      setOpenId(null);
                      setEditing(false);
                      props.onDelete(current);
                      queueMicrotask(() => newRow.current?.focus());
                    }}
                  >
                    {t("memory.deleteAction")}
                  </SourceButton>
                </div>
              )}
            </>
          ) : props.loading ? (
            <p className="agent-memory-state">{t("memory.loading")}</p>
          ) : !props.memories.length && !adding ? (
            !props.error && (
              <div className="agent-memories-view-empty">
                <AgentMemoriesEmpty
                  ownerNoun={props.ownerNoun}
                  ownerLabel={props.ownerLabel}
                  addDisabled={props.reachedLimit !== null || !editable}
                  onAdd={startAdding}
                />
              </div>
            )
          ) : (
            <>
              {props.memories.length > 0 && (
                <div className="agent-memories-search">
                  <Search className="agent-memories-search-icon" aria-hidden="true" />
                  <input
                    type="search"
                    className="ui-input agent-memories-search-input"
                    data-size="sm"
                    placeholder={t("memory.search")}
                    aria-label={t("memory.search")}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape" && query) {
                        event.preventDefault();
                        event.stopPropagation();
                        setQuery("");
                      }
                    }}
                  />
                </div>
              )}
              {adding ? (
                <MemoryEditor
                  initial=""
                  label={t("memory.new")}
                  placeholder={t("memory.newPlaceholder")}
                  saveLabel={t("memory.save")}
                  saving={props.savingId === "new"}
                  onSave={async (text) => {
                    if (await props.onCreate(text)) stopAdding();
                  }}
                  onCancel={stopAdding}
                />
              ) : (
                props.reachedLimit === null &&
                editable && (
                  <SettingsLinkGroup inset>
                    <SettingsLinkRow
                      ref={newRow}
                      icon={<Plus aria-hidden="true" />}
                      label={t("memory.new")}
                      onClick={startAdding}
                    />
                  </SettingsLinkGroup>
                )
              )}
              {groups.map((group) => (
                <SettingsLinkGroup inset key={group.title ?? "all"} title={group.title}>
                  {group.memories.map((memory) => (
                    <SettingsLinkRow
                      key={memory.id}
                      ref={(element) => {
                        if (element) rows.current.set(memory.id, element);
                        else rows.current.delete(memory.id);
                      }}
                      label={splitMemory(memory.text).title}
                      onClick={() => {
                        setAdding(false);
                        setEditing(false);
                        setOpenId(memory.id);
                      }}
                    />
                  ))}
                </SettingsLinkGroup>
              ))}
              {searching && !matches.length && (
                <p className="agent-memory-state" role="status">
                  {t("memory.noMatches")}
                </p>
              )}
              {props.memories.length > 0 && !searching && editable && (
                <div className="agent-memories-clear">
                  <SourceButton
                    variant="destructive-ghost"
                    disabled={props.savingId !== null}
                    onClick={props.onClearAll}
                  >
                    {t("memory.clearAll")}
                  </SourceButton>
                </div>
              )}
            </>
          )}
        </div>
      </SettingsPanelContent>
    </div>
  );
}
function memoryDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? t("memory.unknownDate")
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}
function MemoryEditor(props: {
  initial: string;
  label: string;
  placeholder?: string;
  saveLabel: string;
  saving: boolean;
  onSave: (text: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [text, setText] = useState(props.initial);
  const focus = useStableCallback((element: HTMLTextAreaElement | null) => {
    if (element)
      queueMicrotask(() => {
        if (!element.isConnected) return;
        element.focus();
        element.setSelectionRange(element.value.length, element.value.length);
      });
  });
  const save = () => {
    if (text.trim() && !props.saving) void props.onSave(text.trim());
  };
  return (
    <div className="agent-memories-editor">
      <textarea
        ref={focus}
        className="ui-textarea agent-memories-field"
        rows={2}
        maxLength={500}
        value={text}
        placeholder={props.placeholder}
        aria-label={props.label}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            props.onCancel();
          }
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="agent-memories-editor-actions">
        <SourceButton variant="ghost" onClick={props.onCancel}>
          {t("common.cancel")}
        </SourceButton>
        <SourceButton variant="default" disabled={!text.trim() || props.saving} onClick={save}>
          {props.saveLabel}
        </SourceButton>
      </div>
    </div>
  );
}
