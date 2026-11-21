/* oxlint-disable shadcn/no-unknown-classes, t3code/no-native-title-tooltip -- Pinned FileList source markup and filename titles. */
import { useState } from "react";
import { Menu } from "@base-ui/react/menu";
import {
  Download,
  Ellipsis,
  ExternalLink,
  FolderOpen,
  MessageCircle,
  RefreshCw,
  Search,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { MenuPopup } from "../OpenbotMenu";
import { SourceButton } from "../settings/SettingsParts";
import { SourceSelect } from "../provider/SourceSelect";
import { SourceConfirmDialog } from "../data/SourceConfirmDialog";
import { t } from "../data/source-text";
import {
  FILE_SORTS,
  FILE_TYPE_FILTERS,
  type FileQuery,
  fileCountLabel,
  fileDayLabel,
  fileTypeCounts,
  groupFilesByDay,
  queryFiles,
} from "./files-view";
import { canPreviewAttachment, type StoredFileRow, type StoredFileAction } from "./types";
import { format } from "./format";
import { fileReferenceBadge, fileReferenceTone } from "./file-reference";
import "../provider/SourceControls.css";
import "./Files.css";
export interface FileListProps {
  label: string;
  files: readonly StoredFileRow[];
  agents?: readonly { id: string; name: string }[] | undefined;
  showConversation?: boolean | undefined;
  compact?: boolean | undefined;
  groupByDay?: boolean | undefined;
  groupHeadingLevel?: 3 | 4 | undefined;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  initialQuery?: Partial<FileQuery> | undefined;
  now?: Date | undefined;
  emptyTitle?: string | undefined;
  emptyDescription?: string | undefined;
  canDelete?: boolean | undefined;
  /** Native reveal is absent when the client has no access to the host file manager. */
  canReveal?: boolean | undefined;
  onPreview: (file: StoredFileRow) => void;
  onAction: (file: StoredFileRow, action: StoredFileAction) => void | Promise<void>;
}
export function FileList(props: FileListProps) {
  const [query, setQuery] = useState<FileQuery>({
    search: props.initialQuery?.search ?? "",
    type: props.initialQuery?.type ?? "all",
    sort: props.initialQuery?.sort ?? "newest",
  });
  const [pendingDelete, setPendingDelete] = useState<StoredFileRow | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [clock] = useState(() => new Date());
  const now = props.now ?? clock;
  const counts = fileTypeCounts(queryFiles(props.files, { ...query, type: "all" }));
  const visible = queryFiles(props.files, query);
  const groups =
    props.groupByDay && query.sort === "newest"
      ? groupFilesByDay(visible, now, t, format)
      : [{ key: "all", label: "", files: visible }];
  const Heading = props.groupHeadingLevel === 3 ? "h3" : "h4";
  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleteError(null);
    try {
      await props.onAction(pendingDelete, "delete");
      setPendingDelete(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : t("files.delete.failed"));
    }
  };
  return (
    <section
      className="file-list"
      data-compact={props.compact ? "true" : undefined}
      aria-label={props.label}
    >
      <div className="file-list-toolbar">
        <div className="file-list-search">
          <Search className="file-list-search-icon" aria-hidden="true" />
          <input
            type="search"
            className="ui-input file-list-search-input"
            data-size="sm"
            placeholder={t("files.list.search")}
            aria-label={t("files.list.search")}
            value={query.search}
            onChange={(event) => setQuery({ ...query, search: event.target.value })}
          />
        </div>
        <SourceSelect
          className="file-list-sort"
          value={query.sort}
          label={t("files.list.sort")}
          options={FILE_SORTS.map((sort) => ({ id: sort.value, name: t(sort.label) }))}
          onChange={(value) => {
            const sort = FILE_SORTS.find((sort) => sort.value === value);
            if (sort) setQuery({ ...query, sort: sort.value });
          }}
        />
      </div>
      <fieldset className="file-list-filters" aria-label={t("files.list.type")}>
        {FILE_TYPE_FILTERS.filter(
          (filter) => filter.value === "all" || counts[filter.value] > 0,
        ).map((filter) => (
          <SourceButton
            key={filter.value}
            size="xs"
            variant="ghost"
            className="file-list-filter"
            aria-pressed={query.type === filter.value}
            onClick={() => setQuery({ ...query, type: filter.value })}
          >
            {t(filter.label)}
            <span className="file-list-filter-count">{counts[filter.value]}</span>
          </SourceButton>
        ))}
      </fieldset>
      {props.loading ? (
        <div
          className="file-list-rows"
          role="status"
          aria-busy="true"
          aria-label={t("files.list.loading")}
        >
          {[0, 1, 2, 3, 4].map((id) => (
            <div key={id} className="ui-skeleton file-list-skeleton" />
          ))}
        </div>
      ) : props.error ? (
        <div className="file-list-message" role="alert">
          <TriangleAlert className="file-list-message-icon" data-tone="danger" aria-hidden="true" />
          <p className="file-list-message-title">{t("files.list.loadFailed")}</p>
          <p className="file-list-message-description">{props.error}</p>
          {props.onRetry && (
            <SourceButton variant="secondary" onClick={props.onRetry}>
              <RefreshCw className="files-button-icon" aria-hidden="true" />
              {t("common.tryAgain")}
            </SourceButton>
          )}
        </div>
      ) : !props.files.length ? (
        <div className="file-list-message">
          <p className="file-list-message-title">
            {props.emptyTitle ?? t("files.list.emptyTitle")}
          </p>
          <p className="file-list-message-description">
            {props.emptyDescription ?? t("files.list.emptyDescription")}
          </p>
        </div>
      ) : !visible.length ? (
        <div className="file-list-message">
          <p className="file-list-message-title">{t("files.list.noMatches")}</p>
          {(query.search.trim() || query.type !== "all") && (
            <SourceButton
              variant="secondary"
              onClick={() => setQuery({ ...query, search: "", type: "all" })}
            >
              {t("files.list.clearFilters")}
            </SourceButton>
          )}
        </div>
      ) : (
        <>
          <p className="file-list-summary" aria-live="polite">
            {fileCountLabel(visible.length, t)} ·{" "}
            {format.fileSize(visible.reduce((sum, file) => sum + file.size, 0))}
          </p>
          {groups.map((group) => (
            <div className="file-list-group" key={group.key}>
              {group.label && <Heading className="file-list-group-heading">{group.label}</Heading>}
              <ul className="file-list-rows">
                {group.files.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    agentName={
                      props.agents?.find((agent) => agent.id === file.agentId)?.name ?? null
                    }
                    showConversation={props.showConversation !== false && !props.compact}
                    canDelete={props.canDelete === true && file.deletable}
                    canReveal={props.canReveal === true}
                    dateLabel={
                      group.label
                        ? format.date(new Date(file.createdAt), {
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : fileDayLabel(file.createdAt, now, t, format)
                    }
                    onPreview={() => props.onPreview(file)}
                    onAction={(action) => {
                      if (action === "delete") {
                        setDeleteError(null);
                        setPendingDelete(file);
                      } else void props.onAction(file, action);
                    }}
                  />
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
      <SourceConfirmDialog
        open={pendingDelete !== null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={confirmDelete}
        title={t(
          pendingDelete?.status === "available"
            ? "files.delete.titleAvailable"
            : "files.delete.titleRemoved",
        )}
        description={t(
          pendingDelete?.status === "available"
            ? "files.delete.descriptionAvailable"
            : "files.delete.descriptionRemoved",
          { name: pendingDelete?.name ?? "" },
        )}
        confirmLabel={t(pendingDelete?.status === "available" ? "common.delete" : "common.remove")}
        pendingLabel={t(
          pendingDelete?.status === "available" ? "files.delete.deleting" : "files.delete.removing",
        )}
        error={deleteError}
      />
    </section>
  );
}
function FileRow(props: {
  file: StoredFileRow;
  agentName: string | null;
  showConversation: boolean;
  canDelete: boolean;
  canReveal: boolean;
  dateLabel: string;
  onPreview: () => void;
  onAction: (action: StoredFileAction) => void;
}) {
  const file = props.file;
  const meta = [
    format.fileSize(file.size),
    props.showConversation ? file.conversation?.title : null,
    props.agentName,
    props.dateLabel,
  ].filter(Boolean);
  const badge =
    fileReferenceBadge(file.name) ??
    (file.previewKind === "pdf"
      ? "PDF"
      : file.previewKind === "text"
        ? "TXT"
        : file.name.split(".").at(-1)?.slice(0, 4).toUpperCase() || "FILE");
  return (
    <li className="file-row" data-status={file.status}>
      <SourceButton
        variant="ghost"
        className="file-row-main"
        disabled={file.status !== "available"}
        aria-label={t(canPreviewAttachment(file) ? "attachment.preview" : "attachment.open", {
          name: file.name,
        })}
        onClick={props.onPreview}
      >
        {file.previewKind === "image" && file.previewUrl && file.status === "available" ? (
          <span className="files-file-visual files-file-thumbnail" aria-hidden="true">
            <img src={file.previewUrl} alt="" />
          </span>
        ) : (
          <span
            className="files-file-visual"
            data-file-tone={fileReferenceTone(file.name)}
            data-status={file.status}
            aria-hidden="true"
          >
            {badge}
          </span>
        )}
        <span className="file-row-copy">
          <span className="file-row-name" title={file.name}>
            {file.name}
          </span>
          <span className="file-row-meta">
            {meta.map((part, index) => (
              <span key={part}>
                <span aria-hidden="true">{index > 0 ? " · " : ""}</span>
                <span className="file-row-meta-part">{part}</span>
              </span>
            ))}
          </span>
        </span>
      </SourceButton>
      {file.status !== "available" && (
        <span
          className={`z-badge z-badge-variant-${file.status === "missing" ? "warning-light" : file.status === "failed" ? "destructive-light" : "info-light"} file-row-status`}
          data-variant={
            file.status === "missing"
              ? "warning-light"
              : file.status === "failed"
                ? "destructive-light"
                : "info-light"
          }
        >
          {t(`files.status.${file.status}`)}
        </span>
      )}
      <Menu.Root>
        <Menu.Trigger
          className="ui-button ui-button-variant-ghost ui-button-size-icon-sm file-row-menu-trigger"
          aria-label={t("files.action.moreActions", { name: file.name })}
        >
          <Ellipsis aria-hidden="true" />
        </Menu.Trigger>
        <MenuPopup align="end">
          {file.status === "available" && (
            <Menu.Item className="ui-action-menu-item" onClick={() => props.onAction("open")}>
              <ExternalLink aria-hidden="true" />
              {t("common.open")}
            </Menu.Item>
          )}
          {file.status === "available" && props.canReveal && (
            <Menu.Item className="ui-action-menu-item" onClick={() => props.onAction("reveal")}>
              <FolderOpen aria-hidden="true" />
              {t("files.action.reveal")}
            </Menu.Item>
          )}
          {(file.status === "available" || file.status === "remote") && (
            <Menu.Item className="ui-action-menu-item" onClick={() => props.onAction("download")}>
              <Download aria-hidden="true" />
              {t("common.download")}
            </Menu.Item>
          )}
          {file.status === "failed" && (
            <Menu.Item className="ui-action-menu-item" onClick={() => props.onAction("retry")}>
              <RefreshCw aria-hidden="true" />
              {t("common.tryAgain")}
            </Menu.Item>
          )}
          {file.conversation && file.messageId && (
            <Menu.Item
              className="ui-action-menu-item"
              onClick={() => props.onAction("show-in-chat")}
            >
              <MessageCircle aria-hidden="true" />
              {t("files.action.showInChat")}
            </Menu.Item>
          )}
          {props.canDelete && (
            <>
              <Menu.Separator className="ui-action-menu-separator" />
              <Menu.Item
                className="ui-action-menu-item ui-action-menu-danger"
                onClick={() => props.onAction("delete")}
              >
                <Trash2 aria-hidden="true" />
                {t(file.status === "available" ? "common.delete" : "common.remove")}
              </Menu.Item>
            </>
          )}
        </MenuPopup>
      </Menu.Root>
    </li>
  );
}
