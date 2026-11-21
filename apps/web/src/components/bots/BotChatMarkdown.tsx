/* oxlint-disable shadcn/no-unknown-classes -- Quote chip selectors come from the pinned source ReferenceChip CSS imported here. */
import { useState, type ComponentProps, type ReactNode } from "react";
import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, OpenbotMaterializedFile } from "@t3tools/contracts";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { TextQuoteIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./upstream/OpenbotTooltip";
import {
  botQuoteReference,
  botQuoteReferencesPlugin,
} from "./upstream/conversation/quoteReferences";
import "./upstream/conversation/QuoteReference.css";
import { SourceCodeBlock } from "./upstream/conversation/SourceCodeBlock";
import ChatMarkdown from "../ChatMarkdown";
import { BotFilePreview } from "./BotFilePreview";
import { Dialog, DialogPopup, DialogTitle, DialogHeader } from "../ui/dialog";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { botSharedFilePath } from "./botSharedFileLink";
import { useGT } from "gt-react";

const STATIC_BOT_REMARK_PLUGINS = [botQuoteReferencesPlugin];
const renderBotCodeBlock: NonNullable<ComponentProps<typeof ChatMarkdown>["renderCodeBlock"]> = (
  block,
) => <SourceCodeBlock {...block} />;

type Scope = { environmentId: EnvironmentId; hostId: string; agentId: string | null };
export function BotChatMarkdown({
  environmentId,
  hostId,
  agentId,
  onOpenQuote,
  extraRemarkPlugins = [],
  ...props
}: Scope &
  Omit<ComponentProps<typeof ChatMarkdown>, "cwd" | "renderLink"> & {
    onOpenQuote?: ((id: string, text: string) => void) | undefined;
  }) {
  const plugins = extraRemarkPlugins.length
    ? [...STATIC_BOT_REMARK_PLUGINS, ...extraRemarkPlugins]
    : STATIC_BOT_REMARK_PLUGINS;
  const renderLink = (href: string, children: ReactNode) => {
    const quote = botQuoteReference(href);
    if (quote) return <QuoteReference {...quote} onOpen={onOpenQuote} />;
    const path = botSharedFilePath(href);
    return path && agentId ? (
      <SharedFileLink
        key={JSON.stringify([environmentId, hostId, agentId, path])}
        environmentId={environmentId}
        hostId={hostId}
        agentId={agentId}
        path={path}
      >
        {children}
      </SharedFileLink>
    ) : null;
  };
  return (
    <ChatMarkdown
      {...props}
      cwd={undefined}
      extraRemarkPlugins={plugins}
      renderCodeBlock={renderBotCodeBlock}
      renderLink={renderLink}
    />
  );
}
function SharedFileLink({
  environmentId,
  hostId,
  agentId,
  path,
  children,
}: Scope & { agentId: string; path: string; children: ReactNode }) {
  const gt = useGT();
  const materialize = useAtomCommand(openbot.fileMaterialize, { reportFailure: false });
  const canRead = useAtomValue(openbot.fileMaterialize.permissionAtom(environmentId));
  const [file, setFile] = useState<OpenbotMaterializedFile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = async () => {
    if (!canRead || busy) return;
    setBusy(true);
    setError(null);
    const settled = await settlePromise(async () => {
      const result = await materialize({
        environmentId,
        input: { hostId, agentId, source: { kind: "shared", path } },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      setFile(result.value);
    });
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : gt("Could not open this file."));
    }
    setBusy(false);
  };
  return (
    <>
      <button
        type="button"
        className="cursor-pointer text-primary underline underline-offset-2 disabled:cursor-default disabled:opacity-50"
        disabled={!canRead || busy}
        onClick={() => void open()}
      >
        {busy ? gt("Opening…") : children}
      </button>
      {error && (
        <span role="alert" className="ml-2 text-xs text-destructive">
          {error}
        </span>
      )}
      <Dialog
        open={file !== null}
        onOpenChange={(value) => {
          if (!value) setFile(null);
        }}
      >
        <DialogPopup className="max-w-3xl" bottomStickOnMobile={false}>
          <DialogHeader>
            <DialogTitle>{file?.name ?? gt("File preview")}</DialogTitle>
          </DialogHeader>
          {file && (
            <BotFilePreview
              quoteTarget={{ source: "shared", path }}
              onClose={() => setFile(null)}
              name={file.name}
              mimeType={file.mimeType}
              sizeBytes={file.size}
              asset={{ environmentId, attachmentId: file.attachmentId }}
            />
          )}
        </DialogPopup>
      </Dialog>
    </>
  );
}

function QuoteReference({
  id,
  text,
  onOpen,
}: {
  id: string;
  text: string;
  onOpen?: ((id: string, text: string) => void) | undefined;
}) {
  const gt = useGT();
  const content = (
    <>
      <span className="reference-chip-icon" aria-hidden="true">
        <TextQuoteIcon />
      </span>
      <span className="reference-chip-name" dir="auto">
        {text}
      </span>
    </>
  );
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          onOpen ? (
            <button
              type="button"
              className="reference-chip message-reference-chip message-quote-tag"
              data-kind="quote"
              aria-label={gt("Show quoted text: {text}", { text })}
              onClick={() => onOpen(id, text)}
            />
          ) : (
            <span
              className="reference-chip message-reference-chip message-quote-tag"
              data-kind="quote"
            />
          )
        }
      >
        {content}
      </TooltipTrigger>
      <TooltipPopup>{text}</TooltipPopup>
    </Tooltip>
  );
}
