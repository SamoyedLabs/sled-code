/* oxlint-disable shadcn/no-unknown-classes, t3code/no-native-title-tooltip -- Exact AgentFilesView source DOM/CSS and conversation title. */
import { useId } from "react";
import { FolderOpen } from "lucide-react";
import { SourceButton } from "../settings/SettingsParts";
import { SettingsPanelHeader } from "../settings/SettingsPanel";
import { t } from "../data/source-text";
import { FileList, type FileListProps } from "./FileList";
import { format } from "./format";
import { fileCountLabel, storageBytes, storageTotal } from "./files-view";
import type { StorageBreakdown, ConversationStorageRow } from "./types";
export interface AgentFilesViewProps extends Omit<FileListProps, "label" | "onPreview"> {
  agentName: string;
  breakdown: readonly StorageBreakdown[];
  conversations: readonly ConversationStorageRow[];
  onBack: () => void;
  onClose: () => void;
  onOpenWorkspace?: (() => void) | undefined;
  onOpenConversation: (conversationId: string) => void;
  onPreviewFile: FileListProps["onPreview"];
}
export function AgentFilesView(props: AgentFilesViewProps) {
  const heading = useId();
  const tiles = [
    {
      label: t("files.agent.workspace"),
      bytes: storageBytes(props.breakdown, "workspaces"),
      openable: Boolean(props.onOpenWorkspace),
    },
    { label: t("files.category.attachments"), bytes: storageBytes(props.breakdown, "attachments") },
    { label: t("files.category.generated"), bytes: storageBytes(props.breakdown, "generated") },
    { label: t("files.category.chats"), bytes: storageBytes(props.breakdown, "chats") },
  ];
  const chats = [...props.conversations].sort((a, b) => b.bytes - a.bytes).slice(0, 4);
  return (
    <div className="agent-files-view">
      <SettingsPanelHeader
        title={t("files.agent.title")}
        onBack={props.onBack}
        backLabel={t("files.agent.back")}
        onClose={props.onClose}
        closeLabel={t("files.agent.close")}
      />
      <div className="agent-files-body">
        <section className="agent-files-summary" aria-labelledby={`${heading}-total`}>
          <div>
            <h3 id={`${heading}-total`} className="agent-files-total-label">
              {t("files.agent.uses", { name: props.agentName })}
            </h3>
            {props.loading ? (
              <div className="ui-skeleton agent-files-total-skeleton" />
            ) : (
              <p className="agent-files-total">{format.fileSize(storageTotal(props.breakdown))}</p>
            )}
          </div>
          <dl className="agent-files-tiles">
            {tiles.map((tile) => (
              <div className="agent-files-tile" key={tile.label}>
                <dt>
                  <span className="agent-files-tile-label">{tile.label}</span>
                  {tile.openable && (
                    <SourceButton
                      variant="ghost"
                      size="xs"
                      className="agent-files-tile-action"
                      aria-label={t("files.agent.openWorkspace")}
                      onClick={props.onOpenWorkspace}
                    >
                      <FolderOpen aria-hidden="true" />
                    </SourceButton>
                  )}
                </dt>
                <dd>
                  {props.loading ? (
                    <div className="ui-skeleton agent-files-tile-skeleton" />
                  ) : (
                    format.fileSize(tile.bytes)
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>
        {!props.loading && chats.length > 0 && (
          <section className="agent-files-section" aria-labelledby={`${heading}-chats`}>
            <h3 id={`${heading}-chats`} className="storage-section-heading">
              {t("files.agent.chatsBySize")}
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
                    onClick={() => props.onOpenConversation(chat.id)}
                  >
                    <span className="storage-row-copy">
                      <span className="storage-row-title" title={chat.title}>
                        {chat.title}
                      </span>
                      <span className="storage-row-meta">
                        {fileCountLabel(chat.fileCount, t)} ·{" "}
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
        <FileList
          {...props}
          label={t("files.agent.listLabel", { name: props.agentName })}
          compact
          emptyTitle={t("files.list.emptyTitle")}
          emptyDescription={t("files.agent.emptyDescription", { name: props.agentName })}
          onPreview={props.onPreviewFile}
        />
      </div>
    </div>
  );
}
