import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import { DownloadIcon, FileTextIcon } from "lucide-react";
import {
  OpenbotFileSummary,
  type EnvironmentId,
  type OpenbotMaterializedFile,
} from "@t3tools/contracts";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { openbot } from "../../state/openbot";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { readPreparedConnection } from "../../state/session";
import { assetEnvironment } from "../../state/assets";
import { downloadMedia } from "../media/mediaContent";
import { BotFilePreview } from "./BotFilePreview";
import { Button } from "../ui/button";

const decodeFiles = Schema.decodeUnknownResult(Schema.Array(OpenbotFileSummary));

export function BotMessageFiles({
  environmentId,
  hostId,
  agentId,
  taskId,
  channelId,
  beforeSequence,
  messageId,
  attachments,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  taskId: string | null;
  channelId?: string;
  beforeSequence?: number;
  messageId: string;
  attachments: unknown;
}) {
  const materialize = useAtomCommand(openbot.fileMaterialize, { reportFailure: false });
  const canRead = useAtomValue(openbot.fileMaterialize.permissionAtom(environmentId));
  const asset = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const [preview, setPreview] = useState<
    (OpenbotMaterializedFile & { originalAttachmentId: string }) | null
  >(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decoded = decodeFiles(attachments ?? []);
  if (Result.isFailure(decoded))
    return <p className="text-xs text-muted-foreground">Attachment unavailable.</p>;
  if (!decoded.success.length) return null;
  const open = async (attachmentId: string, download: boolean) => {
    if (busy || !canRead) return;
    setBusy(attachmentId);
    setError(null);
    const settled = await settlePromise(async () => {
      const file = await materialize({
        environmentId,
        input: {
          hostId,
          agentId,
          source: {
            kind: "attachment",
            attachmentId,
            messageId,
            ...(channelId ? { channelId, beforeSequence } : taskId ? { taskId } : {}),
          },
        },
      });
      if (file._tag === "Failure") throw squashAtomCommandFailure(file);
      if (!download) {
        setPreview({ ...file.value, originalAttachmentId: attachmentId });
        return;
      }
      const minted = await asset({
        environmentId,
        input: {
          resource: {
            _tag: "attachment",
            attachmentId: file.value.attachmentId,
            fileName: file.value.name,
            mimeType: file.value.mimeType,
            disposition: "attachment",
          },
        },
      });
      if (minted._tag === "Failure") throw squashAtomCommandFailure(minted);
      const connection = readPreparedConnection(environmentId);
      const url = connection && resolveAssetUrl(connection.httpBaseUrl, minted.value.relativeUrl);
      if (!url) throw new Error("Reconnect to open this file.");
      await downloadMedia(url, file.value.name);
    });
    if (settled._tag === "Failure") {
      const cause = squashAtomCommandFailure(settled);
      setError(cause instanceof Error ? cause.message : "Could not open this file.");
    }
    setBusy(null);
  };
  return (
    <div className="space-y-2">
      {decoded.success.map((file) => (
        <div
          key={file.id}
          className="flex max-w-sm items-center gap-3 rounded-xl border bg-muted/30 p-3"
        >
          <FileTextIcon className="size-6 shrink-0 text-muted-foreground" />
          <button
            type="button"
            className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:-outline-offset-2"
            disabled={!canRead || busy !== null}
            onClick={() => void open(file.id, false)}
          >
            <span className="block truncate text-sm font-medium">{file.name}</span>
            <span className="text-xs text-muted-foreground">
              {busy === file.id ? "Opening…" : formatAttachmentSize(file.size)}
            </span>
          </button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={`Download ${file.name}`}
            disabled={!canRead || busy !== null}
            onClick={() => void open(file.id, true)}
          >
            <DownloadIcon />
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {preview && (
        <BotFilePreview
          quoteTarget={{
            source: "attachment",
            attachmentId: preview.originalAttachmentId,
            name: preview.name,
          }}
          name={preview.name}
          mimeType={preview.mimeType}
          sizeBytes={preview.size}
          asset={{ environmentId, attachmentId: preview.attachmentId }}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}
