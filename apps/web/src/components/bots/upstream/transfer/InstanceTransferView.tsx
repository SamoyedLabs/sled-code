/* oxlint-disable shadcn/no-unknown-classes, shadcn/no-restyle -- Pinned transfer selectors come from the scoped source styles. */
import { useState, useId, Fragment, type ReactNode, type ComponentProps } from "react";
import {
  ArrowRight,
  Blocks,
  Bot,
  Brain,
  CalendarClock,
  ChevronLeft,
  CircleCheck,
  Download,
  FolderOpen,
  Lock,
  Monitor,
  Settings,
  TriangleAlert,
  Upload,
} from "lucide-react";
import type {
  OpenbotTransferPreview,
  OpenbotTransferResult,
  OpenbotTransferSummary,
} from "@t3tools/contracts/openbot-instance-transfer";
import { BotAvatar } from "../../avatar/BotAvatar";
import { SourceButton } from "../settings/SettingsParts";
import { t } from "./text";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import "./instance-transfer.css";
import "./agent-import.css";
type InstanceTransferPreview = OpenbotTransferPreview;
type InstanceTransferResult = OpenbotTransferResult;
type InstanceTransferSummary = typeof OpenbotTransferSummary.Type;
type AgentImportPreviewAgent = InstanceTransferPreview["agents"][number];
type AgentProviderId = string;
type AppTranslate = typeof t;
type AppFormat = {
  date: (date: Date, options: Intl.DateTimeFormatOptions) => string;
  fileSize: typeof formatAttachmentSize;
};
const agentProviderName = (provider: string) => provider;
const readText = () => ({
  t,
  sourceText: (text: string) => text,
  format: {
    date: (date: Date, options: Intl.DateTimeFormatOptions) => date.toLocaleDateString([], options),
    fileSize: formatAttachmentSize,
  },
});
function Show<T>({
  when,
  children,
  fallback,
}: {
  when: T;
  keyed?: boolean;
  children: ReactNode | ((value: Exclude<T, false | null | undefined | 0 | "">) => ReactNode);
  fallback?: ReactNode;
}) {
  return when
    ? typeof children === "function"
      ? children(when as Exclude<T, false | null | undefined | 0 | "">)
      : children
    : fallback;
}
function For<T>({ each, children }: { each: readonly T[]; children: (value: T) => ReactNode }) {
  return each.map((value) => (
    <Fragment
      key={
        typeof value === "object" &&
        value !== null &&
        "key" in value &&
        typeof value.key === "string"
          ? value.key
          : typeof value === "object" &&
              value !== null &&
              "id" in value &&
              typeof value.id === "string"
            ? value.id
            : String(value)
      }
    >
      {children(value)}
    </Fragment>
  ));
}
function Button({
  loading,
  loadingLabel,
  ...props
}: Omit<ComponentProps<typeof SourceButton>, "variant"> & {
  loading?: boolean;
  loadingLabel?: string;
  variant?: ComponentProps<typeof SourceButton>["variant"] | "link";
}) {
  return (
    <SourceButton
      {...props}
      variant={props.variant === "link" ? "ghost" : (props.variant ?? "outline")}
      disabled={props.disabled || loading}
      aria-busy={loading}
    >
      {loading ? loadingLabel : props.children}
    </SourceButton>
  );
}
function ItemGroup({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={`ui-item-group ${className ?? ""}`}>{children}</div>;
}
function Checkbox(props: ComponentProps<"input">) {
  return <input {...props} type="checkbox" className="ui-checkbox" />;
}
function SwitchField({
  label,
  description,
  checked,
  disabled,
  onChange,
  className,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  className?: string;
}) {
  return (
    <label className={`ui-item ${className ?? ""}`}>
      <span className="ui-item-content">
        <span className="ui-item-title">{label}</span>
        <span className="ui-item-description">{description}</span>
      </span>
      <input
        className="ui-switch"
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
    </label>
  );
}
function AgentAvatar({
  agent,
  seed,
}: {
  agent?: InstanceTransferSummary["agents"][number];
  seed?: string;
  className?: string;
}) {
  return (
    <BotAvatar
      seed={agent?.avatarSeed ?? seed ?? "agent"}
      hue={agent?.avatarHue ?? null}
      size={28}
    />
  );
}
/** `home`: which computer is this. `export` and `import`: one screen for each direction. */
export type InstanceTransferScreen = "home" | "export" | "import";
export type InstanceExportPhase = "options" | "exporting" | "saved";
export type InstanceImportPhase = "idle" | "reading" | "review" | "importing" | "done";

export interface InstanceExportOptions {
  agentIds: string[];
  includeFiles: boolean;
  includeSettings: boolean;
}

export interface InstanceTransferViewProps {
  uncertain?: boolean;
  screen: InstanceTransferScreen;
  onScreenChange: (screen: InstanceTransferScreen) => void;
  /** This computer's agents, or null while main reads them. */
  summary: InstanceTransferSummary | null;
  exportPhase: InstanceExportPhase;
  exportFileName: string | null;
  /** What the saved file left out, such as files deleted while it was written. */
  exportWarnings: string[];
  exportError: string | null;
  onExport: (options: InstanceExportOptions) => void;
  onShowExport: () => void;
  onExportAgain: () => void;
  importPhase: InstanceImportPhase;
  preview: InstanceTransferPreview | null;
  result: InstanceTransferResult | null;
  importError: string | null;
  onChoose: () => void;
  onImport: (keys: string[], includeSettings: boolean) => void;
  onCancelImport: () => void;
  onImportDone: () => void;
  /** Absent for a joined server: its providers are signed in on that computer. */
  onSignIn?: ((provider: AgentProviderId) => void) | undefined;
}

/**
 * Settings > Transfer: move this computer's agents and app settings to another OpenBot computer.
 * The first screen asks which computer this is, so each direction is one focused screen.
 */
export function InstanceTransferView(props: InstanceTransferViewProps) {
  const { t } = readText();
  const busy = () =>
    props.exportPhase === "exporting" ||
    props.importPhase === "reading" ||
    props.importPhase === "importing";
  return (
    <div className="instance-transfer" aria-busy={busy() ? "true" : undefined}>
      <Show when={props.screen === "home"}>
        <header className="agent-import-intro">
          <h3 className="agent-import-heading">{t("settings.transfer.title")}</h3>
          <p className="agent-import-lede">{t("settings.transfer.lede")}</p>
        </header>
        <ol className="instance-transfer-flow" aria-label={t("settings.transfer.flow.label")}>
          <li className="instance-transfer-flow-item">
            <Monitor className="instance-transfer-flow-icon" aria-hidden="true" />
            <span>{t("settings.transfer.flow.export")}</span>
          </li>
          <ArrowRight className="instance-transfer-flow-arrow" aria-hidden="true" />
          <li className="instance-transfer-flow-item">
            <FolderOpen className="instance-transfer-flow-icon" aria-hidden="true" />
            <span>{t("settings.transfer.flow.copy")}</span>
          </li>
          <ArrowRight className="instance-transfer-flow-arrow" aria-hidden="true" />
          <li className="instance-transfer-flow-item">
            <Monitor className="instance-transfer-flow-icon" aria-hidden="true" />
            <span>{t("settings.transfer.flow.import")}</span>
          </li>
        </ol>
        <div className="instance-transfer-tiles">
          <Button
            type="button"
            variant="outline"
            className="instance-transfer-tile"
            onClick={() => props.onScreenChange("export")}
          >
            <Download className="instance-transfer-tile-icon" aria-hidden="true" />
            <span className="instance-transfer-tile-title">{t("settings.transfer.old.title")}</span>
            <span className="instance-transfer-tile-text">{t("settings.transfer.old.text")}</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="instance-transfer-tile"
            onClick={() => props.onScreenChange("import")}
          >
            <Upload className="instance-transfer-tile-icon" aria-hidden="true" />
            <span className="instance-transfer-tile-title">{t("settings.transfer.new.title")}</span>
            <span className="instance-transfer-tile-text">{t("settings.transfer.new.text")}</span>
          </Button>
        </div>
        <NotMoved />
      </Show>
      <Show when={props.screen === "export"}>
        <BackButton disabled={busy()} onBack={() => props.onScreenChange("home")} />
        <ExportScreen {...props} />
      </Show>
      <Show when={props.screen === "import"}>
        <BackButton disabled={busy()} onBack={() => props.onScreenChange("home")} />
        <ImportScreen {...props} />
      </Show>
    </div>
  );
}

function ExportScreen(props: InstanceTransferViewProps) {
  const { t } = readText();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [choosing, setChoosing] = useState(false);
  const [files, setFiles] = useState(true);
  const [settings, setSettings] = useState(true);
  const agents = () => props.summary?.agents ?? [];
  const selected = () => agents().filter((agent) => !excluded.has(agent.id));
  const busy = () => props.exportPhase === "exporting";
  const totals = () => ({
    agents: selected().length,
    skills: selected().reduce((total, agent) => total + agent.skillCount, 0),
    routines: selected().reduce((total, agent) => total + agent.routineCount, 0),
    memories: selected().reduce((total, agent) => total + agent.memoryCount, 0),
    fileBytes: files ? selected().reduce((total, agent) => total + agent.fileBytes, 0) : null,
    settings: settings,
  });

  return (
    <Show
      when={props.exportPhase !== "saved"}
      fallback={
        <ExportSaved
          fileName={props.exportFileName}
          warnings={props.exportWarnings}
          onShow={props.onShowExport}
          onAgain={props.onExportAgain}
        />
      }
    >
      <h3 className="agent-import-heading">{t("settings.transfer.export.title")}</h3>
      {/* Outside the summary, so a summary that fails is shown and not left loading. */}
      <Show when={props.exportError}>
        {(error) => <Alert title={t("settings.transfer.export.failed")} description={error} />}
      </Show>
      <Show
        when={props.summary}
        fallback={<p className="agent-import-lede">{t("settings.transfer.loading")}</p>}
      >
        <SetupSummary totals={totals()} label={t("settings.transfer.summary.label")} />
        <ItemGroup className="settings-modal-card">
          <SwitchField
            className="settings-modal-row"
            checked={files}
            disabled={busy()}
            onChange={setFiles}
            label={t("settings.transfer.export.files")}
            description={t("settings.transfer.export.filesDescription")}
          />
          <SwitchField
            className="settings-modal-row"
            checked={settings}
            disabled={busy()}
            onChange={setSettings}
            label={t("settings.transfer.export.settings")}
            description={t("settings.transfer.export.settingsDescription")}
          />
        </ItemGroup>
        <Button
          type="button"
          size="sm"
          variant="link"
          className="instance-transfer-link"
          aria-expanded={choosing ? "true" : "false"}
          onClick={() => setChoosing(!choosing)}
        >
          {choosing
            ? t("settings.transfer.export.hideAgents")
            : t("settings.transfer.export.chooseAgents", {
                selected: selected().length,
                total: agents().length,
              })}
        </Button>
        <Show when={choosing}>
          <AgentChecklist
            label={t("settings.transfer.export.agentsLabel")}
            agents={agents().map((agent) => ({
              key: agent.id,
              name: agent.name,
              avatar: <AgentAvatar agent={agent} className="storage-row-avatar" />,
              skillCount: agent.skillCount,
              routineCount: agent.routineCount,
              memoryCount: agent.memoryCount,
              fileCount: files ? agent.fileCount : 0,
              fileBytes: files ? agent.fileBytes : 0,
              nameExists: false,
            }))}
            excluded={excluded}
            disabled={busy()}
            onToggle={(key, include) => setExcluded(toggled(excluded, key, include))}
          />
        </Show>
        <NotMoved />
        <div className="agent-import-actions instance-transfer-start">
          <Button
            type="button"
            disabled={selected().length === 0}
            loading={busy()}
            loadingLabel={t("settings.transfer.export.saving")}
            onClick={() =>
              props.onExport({
                agentIds: selected().map((agent) => agent.id),
                includeFiles: files,
                includeSettings: settings,
              })
            }
          >
            <Download className="files-button-icon" aria-hidden="true" />
            {t("settings.transfer.export.save")}
          </Button>
        </div>
      </Show>
    </Show>
  );
}

function ExportSaved(props: {
  fileName: string | null;
  warnings: string[];
  onShow: () => void;
  onAgain: () => void;
}) {
  const { t } = readText();
  return (
    <>
      <p className="storage-summary-total agent-import-done" role="status">
        <CircleCheck className="agent-import-done-icon" aria-hidden="true" />
        {t("settings.transfer.export.saved")}
      </p>
      <Show when={props.fileName}>
        <p className="storage-message-description">{props.fileName}</p>
      </Show>
      <Show when={props.warnings.length > 0}>
        <Notes title={t("settings.transfer.result.warnings")} notes={props.warnings} />
      </Show>
      <ol className="agent-import-steps">
        <li className="agent-import-step">
          <span className="agent-import-marker" aria-hidden="true">
            1
          </span>
          <div className="agent-import-step-body">
            <p className="agent-import-step-title">{t("settings.transfer.export.step1")}</p>
            <p className="agent-import-step-note">{t("settings.transfer.export.step1Note")}</p>
          </div>
        </li>
        <li className="agent-import-step">
          <span className="agent-import-marker" aria-hidden="true">
            2
          </span>
          <div className="agent-import-step-body">
            <p className="agent-import-step-title">{t("settings.transfer.export.step2")}</p>
            <p className="agent-import-step-note">{t("settings.transfer.export.step2Note")}</p>
          </div>
        </li>
      </ol>
      <div className="agent-import-actions instance-transfer-start">
        <Button type="button" variant="secondary" onClick={() => props.onShow()}>
          <FolderOpen className="files-button-icon" aria-hidden="true" />
          {t("settings.transfer.export.show")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => props.onAgain()}>
          {t("settings.transfer.export.again")}
        </Button>
      </div>
    </>
  );
}

function ImportScreen(props: InstanceTransferViewProps) {
  const { t } = readText();
  return (
    <>
      <Show
        when={props.importPhase === "idle" || (props.importPhase === "reading" && !props.preview)}
      >
        <h3 className="agent-import-heading">{t("settings.transfer.import.title")}</h3>
        <p className="agent-import-lede">{t("settings.transfer.import.lede")}</p>
        <Show when={props.importError}>
          {(error) => (
            <Alert title={t("settings.transfer.import.openFailed")} description={error} />
          )}
        </Show>
        <div className="agent-import-actions instance-transfer-start">
          <Button
            type="button"
            loading={props.importPhase === "reading"}
            loadingLabel={t("settings.transfer.import.reading")}
            onClick={() => props.onChoose()}
          >
            <Upload className="files-button-icon" aria-hidden="true" />
            {t("settings.transfer.import.choose")}
          </Button>
        </div>
      </Show>
      {/* Keyed, so a newly chosen file starts with every agent selected again. */}
      <Show
        when={props.importPhase !== "idle" && props.importPhase !== "done" && props.preview}
        keyed
      >
        {(preview) => (
          <ImportReview
            key={preview.token}
            blocked={props.uncertain ?? false}
            preview={preview}
            importing={props.importPhase === "importing"}
            error={props.importError}
            onImport={props.onImport}
            onCancel={props.onCancelImport}
          />
        )}
      </Show>
      <Show when={props.importPhase === "done" && props.result}>
        {(result) => (
          <ImportResult result={result} onSignIn={props.onSignIn} onDone={props.onImportDone} />
        )}
      </Show>
    </>
  );
}

function ImportReview(props: {
  preview: InstanceTransferPreview;
  blocked: boolean;
  importing: boolean;
  error: string | null;
  onImport: (keys: string[], includeSettings: boolean) => void;
  onCancel: () => void;
}) {
  const { t, format } = readText();
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const [settings, setSettings] = useState(props.preview.hasSettings);
  const selected = () => props.preview.agents.filter((agent) => !excluded.has(agent.key));
  const totals = () => ({
    agents: selected().length,
    skills: selected().reduce((total, agent) => total + agent.skillCount, 0),
    routines: selected().reduce((total, agent) => total + agent.routineCount, 0),
    memories: selected().reduce((total, agent) => total + agent.memoryCount, 0),
    fileBytes: selected().reduce((total, agent) => total + agent.fileBytes, 0),
    settings: settings,
  });
  const source = () =>
    props.preview.exportedAt
      ? t("settings.transfer.import.source", {
          version: props.preview.appVersion,
          date: formatDate(props.preview.exportedAt, format),
        })
      : t("settings.transfer.import.sourceNoDate", { version: props.preview.appVersion });

  return (
    <>
      <h3 className="agent-import-heading">{t("settings.transfer.import.contains")}</h3>
      <p className="storage-summary-caption">{source()}</p>
      <SetupSummary totals={totals()} label={t("settings.transfer.summary.label")} />
      <Show when={props.error}>
        {(error) => <Alert title={t("settings.transfer.import.failed")} description={error} />}
      </Show>
      <Show when={props.preview.warnings.length > 0}>
        <Notes title={t("settings.transfer.import.warnings")} notes={props.preview.warnings} />
      </Show>
      <Show when={props.preview.agents.length > 0}>
        <AgentChecklist
          label={t("settings.transfer.import.agentsLabel")}
          agents={props.preview.agents.map((agent: AgentImportPreviewAgent) => ({
            key: agent.key,
            name: agent.name,
            avatar: <AgentAvatar seed={agent.key} className="storage-row-avatar" />,
            skillCount: agent.skillCount,
            routineCount: agent.routineCount,
            memoryCount: agent.memoryCount,
            fileCount: agent.fileCount,
            fileBytes: agent.fileBytes,
            nameExists: agent.nameExists,
          }))}
          excluded={excluded}
          disabled={props.importing || props.blocked}
          onToggle={(key, include) => setExcluded(toggled(excluded, key, include))}
        />
      </Show>
      <Show when={props.preview.hasSettings}>
        <ItemGroup className="settings-modal-card">
          <SwitchField
            className="settings-modal-row"
            checked={settings}
            disabled={props.importing || props.blocked}
            onChange={setSettings}
            label={t("settings.transfer.import.settings")}
            description={t("settings.transfer.import.settingsDescription")}
          />
        </ItemGroup>
      </Show>
      <div className="agent-import-actions instance-transfer-start">
        <Button
          type="button"
          disabled={props.blocked || (selected().length === 0 && !settings)}
          loading={props.importing}
          loadingLabel={t("settings.transfer.import.importing")}
          onClick={() =>
            props.onImport(
              selected().map((agent) => agent.key),
              settings,
            )
          }
        >
          {selected().length > 0
            ? t("settings.transfer.import.submit", { count: selected().length })
            : t("settings.transfer.import.submitSettings")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={props.importing || props.blocked}
          onClick={() => props.onCancel()}
        >
          {t("common.cancel")}
        </Button>
      </div>
    </>
  );
}

function ImportResult(props: {
  result: InstanceTransferResult;
  onSignIn?: ((provider: AgentProviderId) => void) | undefined;
  onDone: () => void;
}) {
  const { t } = readText();
  const headingId = `instance-transfer-${useId()}`;
  return (
    <>
      <p className="storage-summary-total agent-import-done" role="status">
        <Show when={props.result.agents.length > 0}>
          <CircleCheck className="agent-import-done-icon" aria-hidden="true" />
        </Show>
        {t("settings.transfer.result.imported", { count: props.result.agents.length })}
      </p>
      <p className="agent-import-lede">{t("settings.transfer.result.next")}</p>
      <Show when={props.result.signIn.length > 0}>
        <section className="storage-section" aria-labelledby={`${headingId}-sign-in`}>
          <h3 id={`${headingId}-sign-in`} className="storage-section-heading">
            {t("settings.transfer.result.signIn")}
          </h3>
          <p className="agent-import-step-note">{t("settings.transfer.result.signInText")}</p>
          <div className="agent-import-actions instance-transfer-start">
            <For each={props.result.signIn}>
              {(provider) => (
                <Show
                  when={props.onSignIn}
                  fallback={
                    <span className="instance-transfer-chip">{agentProviderName(provider)}</span>
                  }
                >
                  {(signIn) => (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => signIn(provider)}
                    >
                      {t("settings.transfer.result.signInButton", {
                        provider: agentProviderName(provider),
                      })}
                    </Button>
                  )}
                </Show>
              )}
            </For>
          </div>
        </section>
      </Show>
      <Show when={props.result.skipped.length > 0}>
        <Notes
          title={t("settings.transfer.result.notImported")}
          notes={props.result.skipped.map((entry) => `${entry.name}: ${entry.reason}`)}
        />
      </Show>
      <Show when={props.result.warnings.length > 0}>
        <Notes title={t("settings.transfer.result.warnings")} notes={props.result.warnings} />
      </Show>
      <div className="agent-import-actions instance-transfer-start">
        <Button type="button" variant="secondary" onClick={() => props.onDone()}>
          {t("common.done")}
        </Button>
      </div>
    </>
  );
}

interface Totals {
  agents: number;
  skills: number;
  routines: number;
  memories: number;
  /** Null when the file has no workspace files. */
  fileBytes: number | null;
  settings: boolean;
}

/** What moves, as counts with icons. Export and import show the same block. */
function SetupSummary(props: { totals: Totals; label: string }) {
  const { t, format } = readText();
  const items = () => [
    { icon: Bot, text: t("import.count.agent", { count: props.totals.agents }) },
    { icon: Blocks, text: t("import.count.skill", { count: props.totals.skills }) },
    { icon: CalendarClock, text: t("import.count.routine", { count: props.totals.routines }) },
    { icon: Brain, text: t("import.count.memory", { count: props.totals.memories }) },
    {
      icon: FolderOpen,
      text: props.totals.fileBytes
        ? t("settings.transfer.count.files", { size: format.fileSize(props.totals.fileBytes) })
        : t("settings.transfer.count.noFiles"),
    },
    {
      icon: Settings,
      text: props.totals.settings
        ? t("settings.transfer.count.settings")
        : t("settings.transfer.count.noSettings"),
    },
  ];
  return (
    <ul className="instance-transfer-summary" aria-label={props.label}>
      <For each={items()}>
        {(item) => {
          const Icon = item.icon;
          return (
            <li className="instance-transfer-summary-item">
              <Icon className="instance-transfer-summary-icon" aria-hidden="true" />
              <span>{item.text}</span>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

interface ChecklistAgent {
  key: string;
  name: string;
  avatar: ReactNode;
  skillCount: number;
  routineCount: number;
  memoryCount: number;
  fileCount: number;
  fileBytes: number;
  nameExists: boolean;
}

function AgentChecklist(props: {
  label: string;
  agents: ChecklistAgent[];
  excluded: ReadonlySet<string>;
  disabled: boolean;
  onToggle: (key: string, include: boolean) => void;
}) {
  const { t, format } = readText();
  const id = `instance-transfer-${useId()}`;
  return (
    <ul className="storage-rows" aria-label={props.label}>
      <For each={props.agents}>
        {(agent) => (
          <li>
            <label className="storage-row agent-import-row" htmlFor={`${id}-${agent.key}`}>
              <Checkbox
                id={`${id}-${agent.key}`}
                checked={!props.excluded.has(agent.key)}
                disabled={props.disabled}
                aria-label={t("settings.transfer.includeAgent", { name: agent.name })}
                onChange={(event) => props.onToggle(agent.key, event.currentTarget.checked)}
              />
              {agent.avatar}
              <span className="storage-row-copy">
                <span className="agent-import-row-title">
                  <span className="storage-row-title">{agent.name}</span>
                  <Show when={agent.nameExists}>
                    <span className="instance-transfer-chip">
                      {t("settings.transfer.import.nameExists")}
                    </span>
                  </Show>
                </span>
                <span className="storage-row-meta">{contentsLabel(agent, t)}</span>
              </span>
              <Show when={agent.fileBytes > 0}>
                <span className="storage-row-size">{format.fileSize(agent.fileBytes)}</span>
              </Show>
            </label>
          </li>
        )}
      </For>
    </ul>
  );
}

function NotMoved() {
  const { t } = readText();
  return (
    <p className="instance-transfer-not-moved">
      <Lock className="instance-transfer-not-moved-icon" aria-hidden="true" />
      <span>{t("settings.transfer.notMoved")}</span>
    </p>
  );
}

function BackButton(props: { onBack: () => void; disabled: boolean }) {
  const { t } = readText();
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="instance-transfer-back"
      disabled={props.disabled}
      onClick={() => props.onBack()}
    >
      <ChevronLeft aria-hidden="true" />
      {t("settings.transfer.back")}
    </Button>
  );
}

function Alert(props: { title: string; description: string }) {
  return (
    <div className="storage-message" role="alert">
      <TriangleAlert className="storage-message-icon" aria-hidden="true" />
      <div>
        <p className="storage-message-title">{props.title}</p>
        <p className="storage-message-description">{props.description}</p>
      </div>
    </div>
  );
}

function Notes(props: { title: string; notes: readonly string[] }) {
  const { sourceText } = readText();
  return (
    <div className="storage-message">
      <TriangleAlert className="storage-message-icon" aria-hidden="true" />
      <div>
        <p className="storage-message-title">{props.title}</p>
        <ul className="agent-import-notes">
          <For each={props.notes}>
            {(note) => <li className="storage-message-description">{sourceText(note)}</li>}
          </For>
        </ul>
      </div>
    </div>
  );
}

function contentsLabel(agent: ChecklistAgent, t: AppTranslate): string {
  const parts = [
    t("import.count.skill", { count: agent.skillCount }),
    t("import.count.routine", { count: agent.routineCount }),
    t("import.count.memory", { count: agent.memoryCount }),
  ];
  if (agent.fileCount > 0) parts.push(t("import.count.file", { count: agent.fileCount }));
  return parts.join(" · ");
}

function toggled(set: ReadonlySet<string>, key: string, include: boolean): ReadonlySet<string> {
  const next = new Set(set);
  if (include) next.delete(key);
  else next.add(key);
  return next;
}

function formatDate(value: string, format: AppFormat): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return format.date(date, { day: "numeric", month: "short", year: "numeric" });
}
