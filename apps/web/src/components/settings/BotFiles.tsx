import { useAtomValue } from "@effect/atom-react";
import { PROVIDER_SEND_TURN_MAX_FILE_BYTES } from "@t3tools/contracts";
import type {
  EnvironmentId,
  OpenbotFileMaterializeInput,
  OpenbotMaterializedFile,
  OpenbotFileTarget,
} from "@t3tools/contracts";
import {
  formatAttachmentSize,
  runAttachmentUploadCycle,
  deletePendingAttachmentUpload,
} from "@t3tools/client-runtime/state/attachments";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { taskViews } from "@t3tools/client-runtime/openbot/presentation";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readPreparedConnection } from "../../state/session";
import { attachmentEnvironment } from "../../state/attachments";
import { assetEnvironment } from "../../state/assets";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { AttachmentFilePreview } from "../files/AttachmentFilePreview";
import { downloadMedia } from "../media/mediaContent";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type Props = { environmentId: EnvironmentId; hostId: string; agentId: string };
export function BotFiles(props: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="space-y-3" aria-label="Bot files">
      <Button
        variant="outline"
        size="sm"
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Close files" : "Files"}
      </Button>
      {expanded && (
        <FilesPanel key={`${props.environmentId}:${props.hostId}:${props.agentId}`} {...props} />
      )}
    </section>
  );
}
function FilesPanel({ environmentId, hostId, agentId }: Props) {
  const scope = { hostId, agentId };
  const [path, setPath] = useState(".");
  const [visible, setVisible] = useState(25);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<OpenbotFileTarget>({ kind: "main" });
  const [preview, setPreview] = useState<OpenbotMaterializedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const workspace = useEnvironmentQuery(
    openbot.fileWorkspace({ environmentId, input: { ...scope, path } }),
  );
  const search = useEnvironmentQuery(
    submitted === null
      ? null
      : openbot.fileSearch({
          environmentId,
          input: {
            hostId,
            query: submitted,
            ...(target.kind === "task" ? { agentId, taskId: target.taskId } : {}),
            ...(cursors.at(-1) ? { cursor: cursors.at(-1)! } : {}),
          },
        }),
  );
  const drafts = useEnvironmentQuery(openbot.fileDrafts({ environmentId, input: scope }));
  const taskQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "task.list", agentId } },
    }),
  );
  const tasks = taskViews(taskQuery.data);
  const targetClosed =
    target.kind === "task" &&
    tasks?.some((task) => task.id === target.taskId && task.state === "closed") === true;
  const targetValue = target.kind === "task" ? `task:${target.taskId}` : target.kind;
  const targetLabel =
    target.kind === "main"
      ? "Main conversation"
      : target.kind === "new-task"
        ? "New task"
        : (tasks?.find((task) => task.id === target.taskId)?.title ?? target.taskId);
  const selectTarget = (value: string) => {
    if (value === "main" || value === "new-task") setTarget({ kind: value });
    else {
      const taskId = value.slice("task:".length);
      if (!value.startsWith("task:") || !tasks?.some((task) => task.id === taskId)) return;
      setTarget({ kind: "task", taskId });
    }
    setSubmitted(null);
    setCursors([]);
  };
  const canRead = useAtomValue(openbot.fileMaterialize.permissionAtom(environmentId));
  const canUpload = useAtomValue(openbot.fileUploadDraft.permissionAtom(environmentId));
  const canSend = useAtomValue(openbot.fileSendDraft.permissionAtom(environmentId));
  const materialize = useAtomCommand(openbot.fileMaterialize, { reportFailure: false });
  const upload = useAtomCommand(openbot.fileUploadDraft, { reportFailure: false });
  const send = useAtomCommand(openbot.fileSendDraft, { reportFailure: false });
  const discard = useAtomCommand(openbot.fileDiscardDraft, { reportFailure: false });
  const asset = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const act = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const result = await settlePromise(action);
    if (result._tag === "Failure") {
      const cause = squashAtomCommandFailure(result);
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not transfer this file. Refresh and try again.",
      );
    }
    lock.current = false;
    setBusy(false);
    drafts.refresh();
    taskQuery.refresh();
  };
  const open = (
    source: OpenbotFileMaterializeInput["source"],
    sourceAgentId: string,
    save: boolean,
  ) =>
    act(async () => {
      const result = await materialize({
        environmentId,
        input: { hostId, agentId: sourceAgentId, source },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      if (!save) {
        setPreview(result.value);
        return;
      }
      const minted = await asset({
        environmentId,
        input: {
          resource: {
            _tag: "attachment",
            attachmentId: result.value.attachmentId,
            fileName: result.value.name,
            mimeType: result.value.mimeType,
            disposition: "attachment",
          },
        },
      });
      if (minted._tag === "Failure") throw squashAtomCommandFailure(minted);
      const connection = readPreparedConnection(environmentId);
      const url = connection && resolveAssetUrl(connection.httpBaseUrl, minted.value.relativeUrl);
      if (!url) throw new Error("Reconnect to this environment and try again.");
      await downloadMedia(url, result.value.name);
    });
  const pick = (file: File) =>
    act(async () => {
      if (file.size <= 0 || file.size > PROVIDER_SEND_TURN_MAX_FILE_BYTES)
        throw new Error(
          `Choose a nonempty file up to ${formatAttachmentSize(PROVIDER_SEND_TURN_MAX_FILE_BYTES)}.`,
        );
      const mimeType = file.type || "application/octet-stream";
      const controller = new AbortController();
      const pending = await runAttachmentUploadCycle({
        registry: appAtomRegistry,
        createUploadUrl: attachmentEnvironment.createUploadUrl,
        remove: attachmentEnvironment.remove,
        environmentId,
        upload: { type: "file", name: file.name, sizeBytes: file.size, mimeType },
        resolveUploadUrl: (relativeUrl) => {
          const connection = readPreparedConnection(environmentId);
          return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
        },
        transport: (url) => ({
          abort: () => controller.abort(),
          done: fetch(url, {
            method: "POST",
            body: file,
            headers: { "Content-Type": mimeType },
            signal: controller.signal,
          }).then((response) => {
            if (!response.ok) throw new Error("Could not upload this file to the environment.");
          }),
        }),
      });
      const delivered = await settlePromise(async () => {
        if (pending.status === "cancelled") return;
        if (pending.status === "failed") throw pending.error;
        const result = await upload({
          environmentId,
          input: {
            ...scope,
            attachmentId: pending.attachmentId,
            name: file.name,
            mimeType,
            size: file.size,
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      });
      if (pending.attachmentId)
        deletePendingAttachmentUpload({
          registry: appAtomRegistry,
          remove: attachmentEnvironment.remove,
          environmentId,
          attachmentId: pending.attachmentId,
        });
      if (delivered._tag === "Failure") throw squashAtomCommandFailure(delivered);
    });
  return (
    <div className="space-y-4 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-medium">Workspace files</h3>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            workspace.refresh();
            taskQuery.refresh();
            search.refresh();
            drafts.refresh();
          }}
        >
          Refresh files
        </Button>
      </div>
      <p className="break-all text-xs text-muted-foreground">{workspace.data?.path ?? path}</p>
      {workspace.data?.parentPath && (
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setPath(workspace.data!.parentPath!);
            setVisible(25);
          }}
        >
          Parent folder
        </Button>
      )}
      {workspace.isPending && !workspace.data && <p role="status">Loading files…</p>}
      {workspace.data?.entries.length === 0 && (
        <p className="text-sm text-muted-foreground">No files in this folder.</p>
      )}
      {workspace.data?.entries.slice(0, visible).map((entry) => (
        <div key={entry.path} className="flex flex-wrap items-center gap-2 border-b py-2">
          <span className="min-w-0 flex-1 break-all text-sm">
            {entry.name}
            {entry.kind === "file" && (
              <span className="ml-2 text-xs text-muted-foreground">
                {formatAttachmentSize(entry.size)}
              </span>
            )}
          </span>
          {entry.kind === "directory" ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setPath(entry.path);
                setVisible(25);
              }}
            >
              Open folder
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !canRead}
                onClick={() => void open({ kind: "workspace", path: entry.path }, agentId, false)}
              >
                Preview
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !canRead}
                onClick={() => void open({ kind: "workspace", path: entry.path }, agentId, true)}
              >
                Download
              </Button>
            </>
          )}
        </div>
      ))}
      {(workspace.data?.entries.length ?? 0) > visible && (
        <Button size="sm" variant="outline" onClick={() => setVisible(visible + 25)}>
          Show more files
        </Button>
      )}
      {workspace.data?.truncated && (
        <p className="text-xs text-muted-foreground">
          This engine returned the first 500 entries. Open a subfolder to narrow the list.
        </p>
      )}
      <div className="space-y-2">
        <label htmlFor={`bot-file-target-${agentId}`} className="text-sm font-medium">
          Conversation for files
        </label>
        <Select
          value={targetValue}
          onValueChange={(value) => {
            if (value) selectTarget(value);
          }}
        >
          <SelectTrigger id={`bot-file-target-${agentId}`} disabled={busy}>
            <SelectValue>{targetLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="main">Main conversation</SelectItem>
            <SelectItem value="new-task">Start a new task</SelectItem>
            {tasks?.map((task) => (
              <SelectItem key={task.id} value={`task:${task.id}`}>
                {(task.title || task.id) + (task.state === "closed" ? " (closed)" : "")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <form
        className="space-y-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(query);
          setCursors([]);
        }}
      >
        <label className="text-sm font-medium" htmlFor={`bot-files-${agentId}`}>
          {target.kind === "task"
            ? "Search files in this task"
            : "Search files across main bot conversations"}
        </label>
        <div className="flex gap-2">
          <Input
            id={`bot-files-${agentId}`}
            value={query}
            maxLength={255}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="File name"
          />
          <Button type="submit" variant="outline" disabled={busy}>
            Search
          </Button>
        </div>
      </form>
      {search.isPending && submitted !== null && <p role="status">Searching files…</p>}
      {search.data?.results.length === 0 && (
        <p className="text-sm text-muted-foreground">No matching conversation files.</p>
      )}
      {search.data?.results.map((hit) => (
        <div
          key={`${hit.agentId}:${hit.messageId}:${hit.attachment.id}`}
          className="flex flex-wrap items-center gap-2 border-b py-2"
        >
          <span className="min-w-0 flex-1 break-all text-sm">
            {hit.attachment.name}
            <span className="block text-xs text-muted-foreground">
              {hit.agentId} · {formatAttachmentSize(hit.attachment.size)}
            </span>
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !canRead}
            onClick={() =>
              void open(
                {
                  kind: "attachment",
                  attachmentId: hit.attachment.id,
                  messageId: hit.messageId,
                  ...(hit.taskId ? { taskId: hit.taskId } : {}),
                },
                hit.agentId,
                false,
              )
            }
          >
            Preview
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || !canRead}
            onClick={() =>
              void open(
                {
                  kind: "attachment",
                  attachmentId: hit.attachment.id,
                  messageId: hit.messageId,
                  ...(hit.taskId ? { taskId: hit.taskId } : {}),
                },
                hit.agentId,
                true,
              )
            }
          >
            Download
          </Button>
        </div>
      ))}
      <div className="flex gap-2">
        {cursors.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setCursors(cursors.slice(0, -1))}>
            Previous results
          </Button>
        )}
        {search.data?.nextCursor && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setCursors([...cursors, search.data!.nextCursor!])}
          >
            Next results
          </Button>
        )}
      </div>
      {preview && (
        <AttachmentFilePreview
          name={preview.name}
          mimeType={preview.mimeType}
          sizeBytes={preview.size}
          asset={{ environmentId, attachmentId: preview.attachmentId }}
          onClose={() => setPreview(null)}
        />
      )}
      <h3 className="text-sm font-medium">Send a file to this bot</h3>
      <p className="text-xs text-muted-foreground">
        Send files to {targetLabel}.{" "}
        {target.kind === "task"
          ? "Task file search covers the latest conversation snapshot."
          : "Choose an existing task or start a new one above."}
      </p>
      {targetClosed && (
        <p className="text-xs text-muted-foreground">
          Reopen this task from its task controls before sending another file.
        </p>
      )}
      <input
        ref={picker}
        type="file"
        className="hidden"
        aria-label="Choose a file for this bot"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void pick(file);
        }}
      />
      <Button
        size="sm"
        variant="outline"
        disabled={busy || !canUpload}
        onClick={() => picker.current?.click()}
      >
        Choose file
      </Button>
      <Textarea
        aria-label="Message to send with a file"
        placeholder="Tell the bot what to do with this file"
        maxLength={100_000}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      {drafts.data?.map((draft) => (
        <div key={draft.attachment.id} className="space-y-2 border-t py-2">
          <p className="break-all text-sm">
            {draft.attachment.name} · {formatAttachmentSize(draft.attachment.size)} · {draft.state}
          </p>
          {draft.state === "sending" && (
            <p className="text-xs text-muted-foreground">
              {draft.target?.kind === "new-task"
                ? "Creation could not be confirmed. Check task conversations before starting another task."
                : "Delivery was not confirmed. Retry sends the same file and original message using its saved receipt."}
            </p>
          )}
          {draft.state === "reconciliation-required" && (
            <p className="text-xs text-muted-foreground">
              Check the target conversation before sending again. Delivery could not be safely
              confirmed.
            </p>
          )}
          {draft.state === "sent" && (
            <p className="text-xs text-muted-foreground">
              {draft.taskId
                ? `Delivered to task ${draft.taskId}.`
                : "Delivered to the main conversation."}
            </p>
          )}
          {draft.state === "sent" &&
            draft.conversationMessageId &&
            draft.committedAttachments === null && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !canSend}
                onClick={() =>
                  void act(async () => {
                    const result = await send({
                      environmentId,
                      input: {
                        ...scope,
                        attachmentId: draft.attachment.id,
                        text: draft.sendText ?? "",
                        target: draft.target ?? { kind: "main" },
                      },
                    });
                    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                  })
                }
              >
                Refresh sent file
              </Button>
            )}
          {draft.state === "sent" &&
            draft.conversationMessageId &&
            draft.committedAttachments?.map((file) => (
              <div key={file.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-all text-sm">{file.name}</span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !canRead}
                  onClick={() =>
                    void open(
                      {
                        kind: "attachment",
                        attachmentId: file.id,
                        messageId: draft.conversationMessageId!,
                        ...(draft.taskId ? { taskId: draft.taskId } : {}),
                      },
                      agentId,
                      false,
                    )
                  }
                >
                  Preview sent file
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !canRead}
                  onClick={() =>
                    void open(
                      {
                        kind: "attachment",
                        attachmentId: file.id,
                        messageId: draft.conversationMessageId!,
                        ...(draft.taskId ? { taskId: draft.taskId } : {}),
                      },
                      agentId,
                      true,
                    )
                  }
                >
                  Download sent file
                </Button>
              </div>
            ))}
          {draft.state === "sent" && !draft.conversationMessageId && (
            <p className="text-xs text-muted-foreground">
              File details are available through conversation file search.
            </p>
          )}
          {draft.state === "sent" && draft.taskId && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                selectTarget(`task:${draft.taskId}`);
                setQuery(draft.attachment.name);
                setSubmitted(draft.attachment.name);
              }}
            >
              Task files
            </Button>
          )}
          {(draft.state === "ready" || draft.state === "sending") && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={busy || !canSend || (draft.state === "ready" && targetClosed)}
                onClick={() =>
                  void act(async () => {
                    const result = await send({
                      environmentId,
                      input: {
                        ...scope,
                        attachmentId: draft.attachment.id,
                        text: draft.sendText ?? text,
                        target: draft.target ?? target,
                      },
                    });
                    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                  })
                }
              >
                {draft.state === "sending"
                  ? draft.target?.kind === "new-task"
                    ? "Review delivery"
                    : "Retry delivery"
                  : target.kind === "new-task"
                    ? "Start task with file"
                    : "Send file"}
              </Button>
              {draft.state === "ready" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !canSend || (draft.state === "ready" && targetClosed)}
                  onClick={() =>
                    void act(async () => {
                      const result = await discard({
                        environmentId,
                        input: { ...scope, attachmentId: draft.attachment.id },
                      });
                      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                    })
                  }
                >
                  Discard draft
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          Transferring file…
        </p>
      )}
      {(error || workspace.error || search.error || drafts.error || taskQuery.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error ?? workspace.error ?? search.error ?? drafts.error ?? taskQuery.error}
        </p>
      )}
      {!canRead && (
        <p className="text-xs text-muted-foreground">
          File read permission is required to preview or download bot files.
        </p>
      )}
    </div>
  );
}
