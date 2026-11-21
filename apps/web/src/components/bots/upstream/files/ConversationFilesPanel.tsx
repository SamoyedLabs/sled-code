/* oxlint-disable shadcn/no-unknown-classes -- Original ConversationFilesPanel selectors. */
import { Folder, X } from "lucide-react";
import type { CSSProperties } from "react";
import { SourceButton } from "../settings/SettingsParts";
import { useSourceScrollFades } from "../data/useSourceScrollFades";
import { t } from "../data/source-text";
import { FileList, type FileListProps } from "./FileList";
import { format } from "./format";
import { fileCountLabel } from "./files-view";
export interface ConversationFilesPanelProps extends Omit<FileListProps, "label" | "onPreview"> {
  conversationTitle: string;
  chatBytes: number;
  width?: number;
  onClose: () => void;
  onPreviewFile: FileListProps["onPreview"];
}
export function ConversationFilesPanel(props: ConversationFilesPanelProps) {
  const { scroll, content } = useSourceScrollFades();
  return (
    <aside
      className="browser-panel conversation-files-panel"
      aria-label={t("files.conversation.label", { title: props.conversationTitle })}
      style={
        props.width ? ({ "--browser-panel-width": `${props.width}px` } as CSSProperties) : undefined
      }
    >
      <header className="file-preview-header conversation-files-header">
        <Folder className="file-preview-file-icon side-panel-pane-title" aria-hidden="true" />
        <h2 className="side-panel-pane-title">{t("files.conversation.title")}</h2>
        {!props.loading && (
          <span className="conversation-files-summary">
            {t("files.conversation.summary", {
              files: fileCountLabel(props.files.length, t),
              size: format.fileSize(props.chatBytes),
            })}
          </span>
        )}
        <SourceButton
          variant="ghost"
          className="browser-toolbar-button side-panel-pane-close"
          aria-label={t("files.conversation.close")}
          onClick={props.onClose}
        >
          <X className="browser-toolbar-icon" />
        </SourceButton>
      </header>
      <div className="conversation-files-content" ref={scroll}>
        <div ref={content}>
          <FileList
            {...props}
            label={t("files.conversation.label", { title: props.conversationTitle })}
            showConversation={false}
            compact
            groupByDay
            groupHeadingLevel={3}
            emptyTitle={t("files.conversation.emptyTitle")}
            emptyDescription={t("files.conversation.emptyDescription")}
            onPreview={props.onPreviewFile}
          />
        </div>
      </div>
    </aside>
  );
}
