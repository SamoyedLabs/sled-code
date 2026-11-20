import { SourceProgress } from "../provider/SourceProgress";
/* oxlint-disable shadcn/no-unknown-classes, t3code/no-native-title-tooltip -- Pinned StorageOverview and StorageUsageBar DOM and source filename titles. */
import { useId, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, HardDrive, RefreshCw, TriangleAlert } from "lucide-react";
import { SourceButton } from "../settings/SettingsParts";
import { SourceConfirmDialog } from "../data/SourceConfirmDialog";
import { BotAvatar } from "../../avatar/BotAvatar";
import { FileList } from "./FileList";
import {
  fileCountLabel,
  chatCountLabel,
  storageTotal,
  storageGroupTotals,
  sharePercent,
  sharePercentLabel,
  STORAGE_CATEGORY_LABELS,
  type StorageGroup,
  type StorageGroupTotal,
} from "./files-view";
import type { StorageUsage, StoredFileRow, StoredFileAction } from "./types";
import { format } from "./format";
import { t } from "../data/source-text";
import "./Files.css";
export function StorageUsageBar({
  groups,
  label,
}: {
  groups: readonly StorageGroupTotal[];
  label: string;
}) {
  const [active, setActive] = useState<StorageGroup | null>(null);
  return (
    <div className="storage-usage" data-hovering={active ? "true" : undefined}>
      <div
        className="storage-usage-bar"
        role="img"
        aria-label={`${label}: ${groups.map((entry) => `${entry.label} ${format.fileSize(entry.bytes)}`).join(", ")}`}
      >
        {groups.map((entry) => (
          <span
            key={entry.group}
            className="storage-usage-segment"
            data-group={entry.group}
            data-active={active === entry.group ? "true" : undefined}
            style={{ flexGrow: String(entry.bytes) }}
            onPointerEnter={() => setActive(entry.group)}
            onPointerLeave={() => setActive(null)}
          />
        ))}
      </div>
      <ul className="storage-usage-legend" aria-label={label}>
        {groups.map((entry) => (
          <li
            key={entry.group}
            className="storage-usage-legend-row"
            data-group={entry.group}
            data-active={active === entry.group ? "true" : undefined}
            onPointerEnter={() => setActive(entry.group)}
            onPointerLeave={() => setActive(null)}
          >
            <span className="storage-usage-swatch" aria-hidden="true" />
            <span className="storage-usage-legend-label">{entry.label}</span>
            <span className="storage-usage-legend-value">{format.fileSize(entry.bytes)}</span>
            <span className="storage-usage-legend-percent">
              {sharePercentLabel(entry.percent, format)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
export interface StorageOverviewProps {
  hostName: string;
  state: "scanning" | "ready" | "error";
  error?: string | null;
  usage: StorageUsage | null;
  agents: readonly { id: string; name: string }[];
  renderAvatar?: (agentId: string) => ReactNode;
  machine?: ReactNode;
  now?: Date;
  canManage: boolean;
  onRescan: () => void;
  onOpenAgent?: ((id: string) => void) | undefined;
  onOpenConversation?: ((id: string) => void) | undefined;
  onClear: (category: "caches" | "logs") => Promise<void>;
  onFileAction: (file: StoredFileRow, action: StoredFileAction) => Promise<void>;
}
export function StorageOverview(props: StorageOverviewProps) {
  const [mountedAt] = useState(() => new Date());
  const heading = useId(),
    [showFiles, setShowFiles] = useState(false),
    [pending, setPending] = useState<{ category: "caches" | "logs"; bytes: number } | null>(null),
    [clearError, setClearError] = useState<string | null>(null);
  const usage = props.usage,
    total = storageTotal(usage?.breakdown ?? []),
    groups = storageGroupTotals(usage?.breakdown ?? [], t),
    agents = [...(usage?.agents ?? [])].sort((a, b) => b.bytes - a.bytes),
    largest = agents[0]?.bytes ?? 0,
    chats = [...(usage?.conversations ?? [])].sort((a, b) => b.bytes - a.bytes).slice(0, 5),
    files = usage?.files ?? [];
  const removable = (usage?.breakdown ?? []).flatMap((entry) =>
    entry.removable && entry.bytes > 0 && (entry.category === "caches" || entry.category === "logs")
      ? [{ category: entry.category, bytes: entry.bytes }]
      : [],
  );
  const agentName = (id: string) =>
    props.agents.find((a) => a.id === id)?.name ?? t("files.storage.removedAgent");
  const captions = [];
  if (props.state === "scanning") captions.push(t("files.storage.measuringFolder"));
  else if (usage?.scannedAt) {
    const minutes = Math.round(
      ((props.now ?? mountedAt).getTime() - Date.parse(usage.scannedAt)) / 60000,
    );
    const hours = Math.round(minutes / 60);
    const time =
      minutes < 1
        ? t("files.storage.justNow")
        : minutes < 60
          ? t("files.storage.minutesAgo", { minutes })
          : hours < 24
            ? t("files.storage.hoursAgo", { hours })
            : format.date(new Date(usage.scannedAt), { month: "short", day: "numeric" });
    captions.push(t("files.storage.measured", { time }));
  }
  if (usage?.freeBytes != null)
    captions.push(t("files.storage.free", { size: format.fileSize(usage.freeBytes) }));
  if (showFiles)
    return (
      <div className="storage-overview" data-view="files">
        <header className="storage-subview-header">
          <SourceButton
            variant="ghost"
            className="storage-subview-back ui-icon-button"
            aria-label={t("files.storage.back")}
            onClick={() => setShowFiles(false)}
          >
            <ChevronLeft />
          </SourceButton>
          <h3>{t("files.storage.allFiles")}</h3>
        </header>
        <FileList
          label={t("files.storage.allFilesOn", { host: props.hostName })}
          files={files}
          agents={props.agents}
          showConversation
          groupByDay
          canDelete={props.canManage}
          onPreview={(file) => void props.onFileAction(file, "open")}
          onAction={props.onFileAction}
        />
      </div>
    );
  return (
    <div className="storage-overview" aria-busy={props.state === "scanning" ? true : undefined}>
      {props.machine}
      <section className="storage-summary" aria-labelledby={`${heading}-summary`}>
        <div className="storage-summary-heading">
          <div>
            <h3 id={`${heading}-summary`} className="storage-summary-label">
              {t("files.storage.openBotOn", { host: props.hostName })}
            </h3>
            {props.state === "scanning" && total === 0 ? (
              <div className="ui-skeleton storage-summary-total-skeleton" />
            ) : props.state !== "error" || total > 0 ? (
              <p className="storage-summary-total">{format.fileSize(total)}</p>
            ) : null}
            <p className="storage-summary-caption">{captions.join(" · ")}</p>
          </div>
          <SourceButton
            variant="secondary"
            disabled={props.state === "scanning"}
            onClick={props.onRescan}
          >
            <RefreshCw className="files-button-icon" aria-hidden="true" />
            {t(
              props.state === "scanning" ? "files.storage.measuring" : "files.storage.measureAgain",
            )}
          </SourceButton>
        </div>
        {props.state === "scanning" && (
          <SourceProgress
            className="storage-scan-progress"
            label={t("files.storage.measuringStorage")}
          />
        )}{" "}
        {props.state === "error" && (
          <div className="storage-message" role="alert">
            <TriangleAlert className="storage-message-icon" />
            <div>
              <p className="storage-message-title">{t("files.storage.measureFailedTitle")}</p>
              <p className="storage-message-description">{props.error}</p>
            </div>
          </div>
        )}
        {groups.length > 0 && <StorageUsageBar groups={groups} label={t("files.storage.byType")} />}{" "}
        {props.state === "ready" && total === 0 && (
          <div className="storage-message">
            <HardDrive className="storage-message-icon" />
            <div>
              <p className="storage-message-title">{t("files.storage.emptyTitle")}</p>
              <p className="storage-message-description">{t("files.storage.emptyDescription")}</p>
            </div>
          </div>
        )}
      </section>
      {agents.length > 0 && (
        <section className="storage-section" aria-labelledby={`${heading}-agents`}>
          <h3 id={`${heading}-agents`} className="storage-section-heading">
            {t("files.storage.agents")}
          </h3>
          <ul className="storage-rows">
            {agents.map((row) => (
              <li key={row.agentId}>
                <SourceButton
                  variant="ghost"
                  className="storage-row"
                  aria-label={t("files.storage.rowLabel", {
                    name: agentName(row.agentId),
                    size: format.fileSize(row.bytes),
                  })}
                  disabled={!props.onOpenAgent}
                  onClick={() => props.onOpenAgent?.(row.agentId)}
                >
                  <span className="storage-row-avatar">
                    {props.renderAvatar?.(row.agentId) ?? (
                      <BotAvatar seed={row.agentId} size={28} />
                    )}
                  </span>
                  <span className="storage-row-copy">
                    <span className="storage-row-title">{agentName(row.agentId)}</span>
                    <span className="storage-row-meta">
                      {fileCountLabel(row.fileCount, t)} ·{" "}
                      {chatCountLabel(row.conversationCount, t)}
                    </span>
                  </span>
                  <span className="storage-row-share" aria-hidden="true">
                    <span
                      className="storage-row-share-fill"
                      style={{ width: `${largest > 0 ? (row.bytes / largest) * 100 : 0}%` }}
                    />
                  </span>
                  <span className="storage-row-size">
                    {format.fileSize(row.bytes)}
                    <span className="storage-row-percent">
                      {sharePercentLabel(sharePercent(row.bytes, total), format)}
                    </span>
                  </span>
                </SourceButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      {chats.length > 0 && (
        <section className="storage-section" aria-labelledby={`${heading}-chats`}>
          <h3 id={`${heading}-chats`} className="storage-section-heading">
            {t("files.storage.largestChats")}
          </h3>
          <ul className="storage-rows">
            {chats.map((chat) => (
              <li key={chat.id}>
                <SourceButton
                  variant="ghost"
                  className="storage-row"
                  aria-label={t("files.storage.rowLabel", {
                    name: chat.title,
                    size: format.fileSize(chat.bytes),
                  })}
                  disabled={!props.onOpenConversation}
                  onClick={() => props.onOpenConversation?.(chat.id)}
                >
                  <span className="storage-row-copy">
                    <span className="storage-row-title" title={chat.title}>
                      {chat.title}
                    </span>
                    <span className="storage-row-meta">
                      {agentName(chat.agentId)} · {fileCountLabel(chat.fileCount, t)} ·{" "}
                      {t("files.messageCount", { count: chat.messageCount })}
                    </span>
                  </span>
                  <span className="storage-row-size">{format.fileSize(chat.bytes)}</span>
                </SourceButton>
              </li>
            ))}
          </ul>
        </section>
      )}
      {files.length > 0 && (
        <section className="storage-section" aria-labelledby={`${heading}-files`}>
          <h3 id={`${heading}-files`} className="storage-section-heading">
            {t("files.storage.files")}
          </h3>
          <ul className="storage-rows">
            <li>
              <SourceButton
                variant="ghost"
                className="storage-row"
                onClick={() => setShowFiles(true)}
              >
                <span className="storage-row-copy">
                  <span className="storage-row-title">{t("files.storage.allFiles")}</span>
                  <span className="storage-row-meta">{t("files.storage.allFilesDescription")}</span>
                </span>
                <span className="storage-row-size">
                  {format.fileSize(files.reduce((sum, file) => sum + file.size, 0))}
                  <span className="storage-row-percent">{fileCountLabel(files.length, t)}</span>
                </span>
                <ChevronRight className="storage-row-chevron" />
              </SourceButton>
            </li>
          </ul>
        </section>
      )}
      {props.canManage && removable.length > 0 && (
        <section className="storage-section" aria-labelledby={`${heading}-cleanup`}>
          <div className="storage-section-heading-row">
            <h3 id={`${heading}-cleanup`} className="storage-section-heading">
              {t("files.cleanup.title")}
            </h3>
            <span className="storage-section-aside">
              {t("files.cleanup.canBeCleared", {
                size: format.fileSize(removable.reduce((sum, row) => sum + row.bytes, 0)),
              })}
            </span>
          </div>
          <ul className="storage-rows storage-cleanup-rows">
            {removable.map((entry) => (
              <li className="storage-cleanup-row" key={entry.category}>
                <span className="storage-row-copy">
                  <span className="storage-row-title">
                    {t(STORAGE_CATEGORY_LABELS[entry.category])}
                  </span>
                  <span className="storage-row-meta">
                    {t(`files.cleanup.description.${entry.category}`)}
                  </span>
                </span>
                <span className="storage-row-size">{format.fileSize(entry.bytes)}</span>
                <SourceButton
                  variant="secondary"
                  disabled={props.state === "scanning"}
                  aria-label={t("files.cleanup.clearCategory", {
                    category: t(STORAGE_CATEGORY_LABELS[entry.category]),
                  })}
                  onClick={() => {
                    setClearError(null);
                    setPending(entry);
                  }}
                >
                  {t("files.cleanup.clear")}
                </SourceButton>
              </li>
            ))}
          </ul>
          <SourceConfirmDialog
            open={pending !== null}
            title={t(`files.cleanup.confirm.${pending?.category ?? "caches"}`)}
            description={t("files.cleanup.confirmDescription", {
              size: format.fileSize(pending?.bytes ?? 0),
              description: t(`files.cleanup.description.${pending?.category ?? "caches"}`),
            })}
            confirmLabel={t("files.cleanup.clear")}
            pendingLabel={t("files.cleanup.clearing")}
            error={clearError}
            onCancel={() => setPending(null)}
            onConfirm={async () => {
              if (!pending) return;
              setClearError(null);
              try {
                await props.onClear(pending.category);
                setPending(null);
              } catch (cause) {
                setClearError(cause instanceof Error ? cause.message : t("files.cleanup.failed"));
              }
            }}
          />
        </section>
      )}
    </div>
  );
}
