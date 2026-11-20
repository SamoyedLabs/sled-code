/* oxlint-disable shadcn/no-unknown-classes -- React translation of source ComposerAttachmentRow and composer.css. */
import { useRef } from "react";
import { moveBotDraft } from "./botComposerAttachmentOrder";
import type { OpenbotFileSummary } from "@t3tools/contracts";
import { CircleAlertIcon, LoaderCircleIcon, RotateCcwIcon, XIcon } from "lucide-react";
import type { ComposerUpload } from "./useBotComposerUploads";

function sizeLabel(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
export function BotComposerAttachments(props: {
  files: readonly OpenbotFileSummary[];
  uploads: readonly ComposerUpload[];
  disabled: boolean;
  onRemove: (id: string) => void;
  reorderDisabled: boolean;
  onReorder: (ids: readonly string[]) => void;
  onRemoveUpload: (key: string) => void;
  onRetry: (key: string) => void;
}) {
  const dragging = useRef<string | null>(null);
  const ids = props.files.map((file) => file.id);
  const canReorder = !props.disabled && !props.reorderDisabled && props.files.length > 1;
  if (!props.files.length && !props.uploads.length) return null;
  return (
    <div className="ob-chat-attachments">
      {props.files.map((file) => (
        <div
          key={file.id}
          className="ob-chat-attachment"
          data-kind="file"
          draggable={canReorder}
          tabIndex={canReorder ? 0 : undefined}
          role="group"
          aria-label={
            canReorder ? `${file.name}. Use Alt and arrow keys to move this attachment.` : file.name
          }
          aria-keyshortcuts={canReorder ? "Alt+ArrowLeft Alt+ArrowRight" : undefined}
          onDragStart={(event) => {
            if (!canReorder) return;
            dragging.current = file.id;
            event.dataTransfer.setData("application/x-openbot-draft", file.id);
            event.dataTransfer.effectAllowed = "move";
          }}
          onDragEnd={() => {
            dragging.current = null;
          }}
          onDragOver={(event) => {
            if (canReorder && dragging.current) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }
          }}
          onDrop={(event) => {
            const id = dragging.current;
            if (!canReorder || !id) return;
            event.preventDefault();
            event.stopPropagation();
            dragging.current = null;
            props.onReorder(moveBotDraft(ids, id, file.id));
          }}
          onKeyDown={(event) => {
            if (
              event.target !== event.currentTarget ||
              !canReorder ||
              !event.altKey ||
              event.ctrlKey ||
              event.metaKey
            )
              return;
            const offset = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
            if (!offset) return;
            event.preventDefault();
            const next = ids[ids.indexOf(file.id) + offset];
            if (next) props.onReorder(moveBotDraft(ids, file.id, next));
          }}
        >
          <span className="ob-chat-attachment-preview">
            {file.name.includes(".")
              ? file.name.split(".").at(-1)?.slice(0, 4).toUpperCase()
              : "FILE"}
          </span>
          <span className="ob-chat-attachment-copy">
            <strong>{file.name}</strong>
            <small>{sizeLabel(file.size)}</small>
          </span>
          <button
            type="button"
            className="ob-chat-attachment-remove"
            aria-label={`Remove ${file.name}`}
            disabled={props.disabled}
            onClick={() => props.onRemove(file.id)}
          >
            <XIcon />
          </button>
        </div>
      ))}
      {props.uploads.map((upload) => (
        <div
          key={upload.key}
          className="ob-chat-attachment"
          data-kind="file"
          data-upload={upload.error ? "failed" : "uploading"}
        >
          <span className="ob-chat-attachment-preview">
            {upload.error ? (
              <CircleAlertIcon className="ob-chat-upload-failed-icon" />
            ) : (
              <LoaderCircleIcon
                className="ob-chat-spinner"
                aria-label={`Uploading ${upload.name}`}
              />
            )}
          </span>
          <span className="ob-chat-attachment-copy">
            <strong>{upload.name}</strong>
            <small>
              {upload.removing ? "Removing…" : (upload.error ?? sizeLabel(upload.size))}
            </small>
          </span>
          {upload.error && (
            <button
              type="button"
              className="ob-chat-upload-retry"
              aria-label={`Retry ${upload.name}`}
              disabled={upload.removing || props.disabled}
              onClick={() => props.onRetry(upload.key)}
            >
              <RotateCcwIcon />
            </button>
          )}
          <button
            type="button"
            className="ob-chat-attachment-remove"
            aria-label={`Remove ${upload.name}`}
            disabled={upload.removing || props.disabled}
            onClick={() => props.onRemoveUpload(upload.key)}
          >
            <XIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
