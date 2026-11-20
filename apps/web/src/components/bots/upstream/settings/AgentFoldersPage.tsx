/* oxlint-disable shadcn/no-unknown-classes -- Original AgentFolders page selectors are supplied by source CSS. */
import { useState } from "react";
import * as Schema from "effect/Schema";
import { Folder, Lock, Plus, X, ChevronUp } from "lucide-react";
import { useAgentSettingsValue, type AgentSettingsApi } from "./agent-settings-api";
import { SettingsReadState } from "./AgentConfigurationPages";
import { SettingsLinkGroup } from "./SettingsPanel";
import { SourceButton } from "./SettingsParts";
import "./agent-folders.css";
const FolderList = Schema.Struct({
  workspace: Schema.String,
  shared: Schema.String,
  folders: Schema.Array(Schema.Struct({ path: Schema.String, found: Schema.Boolean })),
  excluded: Schema.Array(Schema.String),
});
const Browse = Schema.Struct({
  path: Schema.String,
  parentPath: Schema.NullOr(Schema.String),
  entries: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String })),
  truncated: Schema.Boolean,
  home: Schema.String,
  volumes: Schema.Array(Schema.Struct({ name: Schema.String, path: Schema.String })),
});
const decodeFolders = Schema.decodeUnknownSync(FolderList);
const decodeBrowse = Schema.decodeUnknownSync(Browse);
const decodeChange = Schema.decodeUnknownSync(
  Schema.Struct({ outcome: Schema.String, refusal: Schema.optional(Schema.String) }),
);
const basename = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
export function AgentFoldersPage({ api }: { api: AgentSettingsApi }) {
  const c = useAgentSettingsValue(
    async () => decodeFolders(await api.setting("settings.agent-folders.read")),
    api.agentId,
  );
  const [picker, setPicker] = useState<{ kind: "add" | "exclude"; replace?: string } | null>(null);
  const change = async (
    operation: "add" | "remove" | "exclude" | "include",
    path: string,
    replace?: string,
  ) => {
    const result = decodeChange(
      await api.setting(`settings.agent-folders.${operation}`, {
        agentId: api.agentId,
        path,
        ...(replace ? { replace } : {}),
      }),
    );
    if (result.outcome === "refused")
      throw new Error(`The host refused this folder (${result.refusal ?? "not allowed"}).`);
  };
  if (picker)
    return (
      <HostFolderPicker
        api={api}
        title={picker.kind === "add" ? "Add folder" : "Exclude folder"}
        onCancel={() => setPicker(null)}
        onChoose={async (path) => {
          await change(picker.kind, path, picker.replace);
          setPicker(null);
          await c.refresh();
        }}
      />
    );
  return (
    <div className="agent-folders-page">
      <SettingsReadState
        busy={c.busy && !c.value}
        error={c.error}
        onRetry={() => void c.refresh()}
      />
      {c.value && (
        <>
          <SettingsLinkGroup inset title="Always available">
            <FolderRow path={c.value.workspace} name="Workspace" />
            <FolderRow path={c.value.shared} name="Shared folder" />
          </SettingsLinkGroup>
          <div className="agent-folders-drop-target">
            <SettingsLinkGroup inset title="Added folders">
              {c.value.folders.map((folder) => (
                <FolderRow
                  key={folder.path}
                  path={folder.path}
                  missing={!folder.found}
                  disabled={c.busy}
                  onLocate={() => setPicker({ kind: "add", replace: folder.path })}
                  onRemove={() => void c.change(() => change("remove", folder.path))}
                />
              ))}
              <SourceButton
                variant="ghost"
                className="settings-link agent-folders-add"
                disabled={c.busy}
                onClick={() => setPicker({ kind: "add" })}
              >
                <span className="settings-link-label">
                  <span className="settings-link-icon">
                    <Plus aria-hidden="true" />
                  </span>
                  Add folder
                </span>
              </SourceButton>
            </SettingsLinkGroup>
          </div>
          <SettingsLinkGroup inset title="Excluded folders">
            {c.value.excluded.map((path) => (
              <FolderRow
                key={path}
                path={path}
                excluded
                disabled={c.busy}
                onRemove={() => void c.change(() => change("include", path))}
              />
            ))}
            <SourceButton
              variant="ghost"
              className="settings-link agent-folders-add"
              disabled={c.busy}
              onClick={() => setPicker({ kind: "exclude" })}
            >
              <span className="settings-link-label">
                <span className="settings-link-icon">
                  <Plus aria-hidden="true" />
                </span>
                Exclude folder
              </span>
            </SourceButton>
          </SettingsLinkGroup>
        </>
      )}
    </div>
  );
}
function FolderRow({
  path,
  name,
  missing = false,
  excluded = false,
  disabled = false,
  onLocate,
  onRemove,
}: {
  path: string;
  name?: string;
  missing?: boolean;
  excluded?: boolean;
  disabled?: boolean;
  onLocate?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="agent-folders-row">
      <span className="settings-link-icon">
        {excluded ? <Lock aria-hidden="true" /> : <Folder aria-hidden="true" />}
      </span>
      <span className="agent-folders-text">
        <span className="agent-folders-name">{name ?? basename(path)}</span>
        <span className="agent-folders-path">
          {path}
          {missing ? " · Missing" : ""}
        </span>
      </span>
      {missing && onLocate && (
        <SourceButton disabled={disabled} onClick={onLocate}>
          Locate
        </SourceButton>
      )}
      {onRemove && (
        <SourceButton
          variant="ghost"
          className="agent-folders-remove"
          aria-label={`${excluded ? "Allow" : "Remove"} ${basename(path)}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </SourceButton>
      )}
    </div>
  );
}
function HostFolderPicker({
  api,
  title,
  onCancel,
  onChoose,
}: {
  api: AgentSettingsApi;
  title: string;
  onCancel: () => void;
  onChoose: (path: string) => Promise<void>;
}) {
  const [path, setPath] = useState<string | null>(null);
  const c = useAgentSettingsValue(
    async () =>
      decodeBrowse(
        await api.setting("settings.agent-folders.browse", { agentId: api.agentId, path }),
      ),
    path ?? "home",
  );
  return (
    <div className="agent-folders-page">
      <div className="ui-settings-section-header">
        <h3 className="ui-heading" data-size="sm">
          {title}
        </h3>
        <SourceButton variant="ghost" onClick={onCancel}>
          Cancel
        </SourceButton>
      </div>
      <SettingsReadState busy={c.busy} error={c.error} onRetry={() => void c.refresh()} />
      {c.value && (
        <>
          <div className="agent-folders-path">{c.value.path}</div>
          <SourceButton
            disabled={c.value.parentPath === null || c.busy}
            onClick={() => setPath(c.value!.parentPath)}
          >
            <ChevronUp aria-hidden="true" />
            Parent folder
          </SourceButton>
          <SettingsLinkGroup inset>
            <SourceButton
              variant="ghost"
              className="settings-link"
              onClick={() => setPath(c.value!.home)}
            >
              Home
            </SourceButton>
            {c.value.volumes.map((volume) => (
              <SourceButton
                key={volume.path}
                variant="ghost"
                className="settings-link"
                onClick={() => setPath(volume.path)}
              >
                {volume.name}
              </SourceButton>
            ))}
          </SettingsLinkGroup>
          <SettingsLinkGroup inset>
            {c.value.entries.map((entry) => (
              <SourceButton
                key={entry.path}
                variant="ghost"
                className="settings-link"
                onClick={() => setPath(entry.path)}
              >
                <Folder aria-hidden="true" />
                {entry.name}
              </SourceButton>
            ))}
          </SettingsLinkGroup>
          {c.value.truncated && (
            <p role="status">This folder has more entries than the host can show.</p>
          )}
          <SourceButton
            variant="default"
            disabled={c.busy}
            onClick={() => void c.change(() => onChoose(c.value!.path))}
          >
            Choose this folder
          </SourceButton>
        </>
      )}
    </div>
  );
}
