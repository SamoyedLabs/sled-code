/* oxlint-disable shadcn/no-unknown-classes -- File text geometry is ported from OpenBot file-preview.css. */
import {
  FileIcon,
  CodeIcon,
  WrapTextIcon,
  CopyIcon,
  CheckIcon,
  DownloadIcon,
  XIcon,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./upstream/OpenbotTooltip";
import { useContext, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { watchBotQuotedText } from "./upstream/conversation/quotedText";
import { SourceFileText } from "./upstream/conversation/SourceFileText";
import ChatMarkdown from "../ChatMarkdown";
import { AttachmentFilePreview } from "../files/AttachmentFilePreview";
import { BotFileSelectionContext } from "../settings/BotFileSelectionContext";
import { BotSelectionActions } from "../settings/BotSelectionActions";
import { botFileQuoteId, type BotFileQuoteTarget } from "../settings/botSelectionModel";
import "./upstream/files/FileSelectionPreview.css";

export type BotQuotedFilePreview = {
  file: import("@t3tools/contracts").OpenbotMaterializedFile;
  target: BotFileQuoteTarget;
  text: string;
};
type Props = ComponentProps<typeof AttachmentFilePreview> & {
  quoteTarget: BotFileQuoteTarget;
  revealText?: string | undefined;
};
export function BotFilePreview({ quoteTarget, revealText, ...props }: Props) {
  const actions = useContext(BotFileSelectionContext);
  const root = useRef<HTMLDivElement>(null);
  const id = botFileQuoteId({ ...quoteTarget, lines: undefined });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- A quoted file loads and tokenizes asynchronously; retain its original line hint and highlight through text-node replacement, then release on pointer/Escape.
  useEffect(() => {
    if (root.current && revealText)
      return watchBotQuotedText(
        root.current,
        `[data-selection-file-quote="${CSS.escape(id)}"]`,
        revealText,
        quoteTarget.lines,
      );
  }, [id, revealText, quoteTarget.lines]);
  return (
    <div ref={root} className="openbot-react ob-file-selection-preview">
      <AttachmentFilePreview
        key={`preview:${props.asset && "attachmentId" in props.asset ? props.asset.attachmentId : id}`}
        {...props}
        renderHeader={(actions) => (
          <header className="file-preview-header">
            <FileIcon className="file-preview-file-icon" aria-hidden="true" />
            <h2>{props.name}</h2>
            {actions.source && (
              <HeaderAction
                label={actions.source.label}
                pressed={actions.source.pressed}
                onClick={actions.source.toggle}
              >
                <CodeIcon />
              </HeaderAction>
            )}
            {actions.wrap && (
              <HeaderAction
                label="Wrap lines"
                pressed={actions.wrap.pressed}
                onClick={actions.wrap.toggle}
              >
                <WrapTextIcon />
              </HeaderAction>
            )}
            {actions.copy && (
              <HeaderAction
                label={actions.copy.copied ? "Copied" : "Copy contents"}
                onClick={actions.copy.run}
              >
                {actions.copy.copied ? <CheckIcon /> : <CopyIcon />}
              </HeaderAction>
            )}
            {actions.download && (
              <HeaderAction
                label={actions.download.saving ? "Preparing file…" : "Download file"}
                disabled={actions.download.saving}
                onClick={actions.download.run}
              >
                <DownloadIcon />
              </HeaderAction>
            )}
            {props.onClose && (
              <HeaderAction label="Close file" onClick={props.onClose}>
                <XIcon />
              </HeaderAction>
            )}
          </header>
        )}
        renderTextPreview={({ text, renderedMarkdown, wordWrap }) => (
          <div className="file-preview-content">
            {renderedMarkdown ? (
              <div className="markdown-file-preview file-preview-markdown">
                <article data-selection-file-quote={id}>
                  <ChatMarkdown text={text} cwd={undefined} className="message-markdown" />
                </article>
              </div>
            ) : (
              <SourceFileText name={props.name} text={text} wrap={wordWrap} quoteId={id} />
            )}
          </div>
        )}
      />
      {actions && (
        <BotSelectionActions
          key={`selection:${id}`}
          includeFiles
          root={root}
          {...actions}
          onQuote={(id, text) => {
            const quote = actions.onQuote;
            props.onClose?.();
            requestAnimationFrame(() => quote(id, text));
          }}
        />
      )}
    </div>
  );
}

function HeaderAction({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className="browser-toolbar-button"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  );
}
