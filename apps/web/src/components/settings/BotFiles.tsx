import { useAtomValue } from "@effect/atom-react";
import { PROVIDER_SEND_TURN_MAX_FILE_BYTES } from "@t3tools/contracts";
import type {
  EnvironmentId,
  OpenbotAgentFileSource,
  OpenbotMaterializedFile,
  OpenbotFileTarget,
} from "@t3tools/contracts";
import {
  AttachmentTransferError,
  formatAttachmentSize,
  runAttachmentUploadCycle,
  deletePendingAttachmentUpload,
} from "@t3tools/client-runtime/state/attachments";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import { channelPage, channelList, taskViews } from "@t3tools/client-runtime/openbot/presentation";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { useRef, useState } from "react";
import {
  ChevronRight,
  Download,
  FileIcon,
  Folder,
  FolderOpen,
  RefreshCw,
  Search,
  Upload,
} from "lucide-react";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { readPreparedConnection } from "../../state/session";
import { attachmentEnvironment } from "../../state/attachments";
import { assetEnvironment } from "../../state/assets";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import * as Effect from "effect/Effect";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { AttachmentFilePreview } from "../files/AttachmentFilePreview";
import { downloadMedia } from "../media/mediaContent";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Textarea } from "../ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type Props = {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  initiallyExpanded?: boolean;
  workspace?: boolean;
  initialTarget?: OpenbotFileTarget;
};
export function BotFiles(props: Props) {
  const [expanded, setExpanded] = useState(props.initiallyExpanded ?? false);
  return (
    <section className="space-y-3" aria-label="Bot files">
      {!props.workspace && (
        <Button
          variant="outline"
          size="sm"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Close files" : "Files"}
        </Button>
      )}
      {(props.workspace || expanded) && (
        <FilesPanel
          key={`${props.environmentId}:${props.hostId}:${props.agentId}:${JSON.stringify(props.initialTarget)}`}
          {...props}
        />
      )}
    </section>
  );
}
function FilesPanel({ environmentId, hostId, agentId, initialTarget }: Props) {
  const scope = { hostId, agentId };
  const [path, setPath] = useState(".");
  const [trail, setTrail] = useState([{ path: ".", name: "Workspace" }]);
  const [view, setView] = useState<"workspace" | "conversation">("workspace");
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<"name" | "size">("name");
  const navigate = (nextPath: string, name: string) => {
    setPath(nextPath);
    setVisible(25);
    setFilter("");
    setTrail((current) => {
      const index = current.findIndex((part) => part.path === nextPath);
      return index < 0 ? [...current, { path: nextPath, name }] : current.slice(0, index + 1);
    });
  };
  const [visible, setVisible] = useState(25);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>("");
  const [cursors, setCursors] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [channelBefore, setChannelBefore] = useState<number | undefined>(undefined);
  const [target, setTarget] = useState<OpenbotFileTarget>(initialTarget ?? { kind: "main" });
  const [preview, setPreview] = useState<OpenbotMaterializedFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const workspace = useEnvironmentQuery(
    openbot.fileWorkspace({ environmentId, input: { ...scope, path } }),
  );
  const search = useEnvironmentQuery(
    submitted === null || target.kind === "channel" || target.kind === "new-task"
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
  const channelQuery = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "channel.list" } },
    }),
  );
  const channelFilesQuery = useEnvironmentQuery(
    target.kind === "channel"
      ? openbot.readFromHost({
          environmentId,
          input: {
            hostId,
            request: {
              operation: "channel.read",
              channelId: target.channelId,
              ...(channelBefore === undefined ? {} : { beforeSequence: channelBefore }),
            },
          },
        })
      : null,
  );
  const channelFiles = channelPage(channelFilesQuery.data);
  const channels = channelList(channelQuery.data)?.filter(
    (channel) => !channel.archived && channel.members.some((member) => member.agentId === agentId),
  );
  const tasks = taskViews(taskQuery.data);
  const targetClosed =
    target.kind === "task" &&
    tasks?.some((task) => task.id === target.taskId && task.state === "closed") === true;
  const targetValue =
    target.kind === "channel"
      ? `channel:${target.channelId}`
      : target.kind === "task"
        ? `task:${target.taskId}`
        : target.kind;
  const targetLabel =
    target.kind === "main"
      ? "Main conversation"
      : target.kind === "new-task"
        ? "New task"
        : target.kind === "channel"
          ? (channels?.find((channel) => channel.id === target.channelId)?.name ?? target.channelId)
          : (tasks?.find((task) => task.id === target.taskId)?.title ?? target.taskId);
  const selectTarget = (value: string) => {
    if (value === "main" || value === "new-task") setTarget({ kind: value });
    else if (value.startsWith("channel:")) {
      const channelId = value.slice("channel:".length);
      if (!channels?.some((channel) => channel.id === channelId)) return;
      setTarget({ kind: "channel", channelId });
    } else {
      const taskId = value.slice("task:".length);
      if (!value.startsWith("task:") || !tasks?.some((task) => task.id === taskId)) return;
      setTarget({ kind: "task", taskId });
    }
    setSubmitted("");
    setQuery("");
    setCursors([]);
    setChannelBefore(undefined);
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
    source: OpenbotAgentFileSource,
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
      const pending = await Effect.runPromise(
        runAttachmentUploadCycle({
          registry: appAtomRegistry,
          createUploadUrl: attachmentEnvironment.createUploadUrl,
          remove: attachmentEnvironment.remove,
          environmentId,
          upload: { type: "file", name: file.name, sizeBytes: file.size, mimeType },
          resolveUploadUrl: (relativeUrl) => {
            const connection = readPreparedConnection(environmentId);
            return connection ? resolveAssetUrl(connection.httpBaseUrl, relativeUrl) : null;
          },
          transport: (url) =>
            Effect.tryPromise({
              try: (signal) =>
                // @effect-diagnostics-next-line globalFetchInEffect:off
                fetch(url, {
                  method: "POST",
                  body: file,
                  headers: { "Content-Type": mimeType },
                  signal,
                }).then((response) => {
                  if (!response.ok)
                    throw new AttachmentTransferError({
                      cause: "Could not upload this file to the environment.",
                    });
                }),
              catch: (cause) => new AttachmentTransferError({ cause }),
            }),
        }),
      );
      const delivered = await settlePromise(async () => {
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
  const entries = workspace.data?.entries
    .filter((entry) => entry.name.toLowerCase().includes(filter.toLowerCase()))
    .toSorted((left, right) => {
      if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
      if (sort === "size" && left.kind === "file" && right.kind === "file")
        return right.size - left.size;
      return left.name.localeCompare(right.name, undefined, { numeric: true });
    });
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Files</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Browse the workspace and files shared in conversations.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              workspace.refresh();
              taskQuery.refresh();
              channelQuery.refresh();
              channelFilesQuery.refresh();
              search.refresh();
              drafts.refresh();
            }}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </header>
        <div className="flex gap-1 border-b pb-2" role="group" aria-label="File location">
          <Button
            size="sm"
            variant="ghost"
            data-pressed={view === "workspace" || undefined}
            aria-pressed={view === "workspace"}
            onClick={() => setView("workspace")}
          >
            <FolderOpen className="size-4" />
            Workspace
          </Button>
          <Button
            size="sm"
            variant="ghost"
            data-pressed={view === "conversation" || undefined}
            aria-pressed={view === "conversation"}
            onClick={() => setView("conversation")}
          >
            Conversation files
          </Button>
        </div>
        {view === "workspace" && (
          <>
            <nav
              aria-label="Folder breadcrumb"
              className="flex flex-wrap items-center gap-1 text-sm"
            >
              {trail.map((part, index) => (
                <span key={part.path} className="flex min-w-0 items-center gap-1">
                  {index > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="max-w-48"
                    disabled={busy}
                    aria-current={index === trail.length - 1 ? "page" : undefined}
                    onClick={() => navigate(part.path, part.name)}
                  >
                    <span className="truncate">{part.name}</span>
                  </Button>
                </span>
              ))}
            </nav>
            <div className="flex gap-2">
              <InputGroup>
                <InputGroupAddon>
                  <Search className="size-4" />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  aria-label="Find workspace files"
                  placeholder="Find a file…"
                  value={filter}
                  onChange={(event) => {
                    setFilter(event.target.value);
                    setVisible(25);
                  }}
                />
              </InputGroup>
              <Select
                value={sort}
                onValueChange={(value) => {
                  if (value === "name" || value === "size") setSort(value);
                }}
              >
                <SelectTrigger className="w-32" aria-label="Sort files">
                  <SelectValue>{sort === "name" ? "Name" : "Largest"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name">Name</SelectItem>
                  <SelectItem value="size">Largest</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {workspace.isPending && !workspace.data && (
              <p role="status" className="py-8 text-center text-sm text-muted-foreground">
                Loading files…
              </p>
            )}
            {entries?.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <FolderOpen className="mx-auto mb-3 size-6 text-muted-foreground" />
                <p className="text-sm font-medium">
                  {filter ? "No matching files" : "This folder is empty"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {filter
                    ? "Try a different file name."
                    : "Files your bot creates here will appear in this list."}
                </p>
              </div>
            )}
            {(entries?.length ?? 0) > 0 && (
              <div className="overflow-hidden rounded-xl border">
                <div className="flex items-center justify-between bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
                  <span>Name</span>
                  <span className="tabular-nums">{entries?.length} items</span>
                </div>
                <ul className="divide-y">
                  {entries?.slice(0, visible).map((entry) => (
                    <li
                      key={entry.path}
                      className="flex items-center gap-2 px-2 py-1 hover:bg-muted/30"
                    >
                      <Button
                        variant="ghost"
                        size="multiline"
                        className="min-w-0 flex-1 justify-start text-left"
                        disabled={busy || (entry.kind === "file" && !canRead)}
                        onClick={() =>
                          entry.kind === "directory"
                            ? navigate(entry.path, entry.name)
                            : void open({ kind: "workspace", path: entry.path }, agentId, false)
                        }
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                          {entry.kind === "directory" ? (
                            <Folder className="size-4 text-muted-foreground" />
                          ) : (
                            <FileIcon className="size-4 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{entry.name}</span>
                          <span className="block text-xs tabular-nums text-muted-foreground">
                            {entry.kind === "directory"
                              ? "Folder"
                              : formatAttachmentSize(entry.size)}
                          </span>
                        </span>
                        {entry.kind === "directory" && (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                      </Button>
                      {entry.kind === "file" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy || !canRead}
                          aria-label={`Download ${entry.name}`}
                          onClick={() =>
                            void open({ kind: "workspace", path: entry.path }, agentId, true)
                          }
                        >
                          <Download className="size-4" />
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {(entries?.length ?? 0) > visible && (
              <Button size="sm" variant="outline" onClick={() => setVisible(visible + 25)}>
                Show more files
              </Button>
            )}
            {workspace.data?.truncated && (
              <p className="text-xs text-muted-foreground">
                Showing the first 500 entries. Open a subfolder to see more.
              </p>
            )}
          </>
        )}
        {view === "conversation" && (
          <div className="space-y-4">
            <p className="text-sm font-medium">{targetLabel}</p>
            {target.kind !== "channel" && target.kind !== "new-task" && (
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
            )}
            {target.kind === "channel" && (
              <div className="space-y-2" aria-label="Channel message files">
                <p>Recent channel attachments</p>
                {channelFilesQuery.isPending && !channelFiles && (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading channel files…
                  </p>
                )}
                {channelFiles &&
                  !channelFiles.messages.some((message) => message.message.attachments?.length) && (
                    <p className="text-sm text-muted-foreground">
                      No attachments in these channel messages.
                    </p>
                  )}
                {channelFiles?.messages.flatMap((message) =>
                  (message.message.attachments ?? []).map((attachment) => {
                    const source = {
                      kind: "attachment" as const,
                      channelId: channelFiles.channel.id,
                      ...(channelBefore === undefined ? {} : { beforeSequence: channelBefore }),
                      messageId: message.id,
                      attachmentId: attachment.id,
                    };
                    return (
                      <ConversationFileRow
                        key={`${message.id}:${attachment.id}`}
                        name={attachment.name}
                        size={attachment.size}
                        disabled={busy || !canRead}
                        onPreview={() => void open(source, agentId, false)}
                        onDownload={() => void open(source, agentId, true)}
                      />
                    );
                  }),
                )}
                <Button
                  disabled={busy || channelFiles?.olderCursor == null}
                  onClick={() => setChannelBefore(channelFiles?.olderCursor ?? undefined)}
                >
                  Older channel files
                </Button>
                <Button
                  disabled={busy || channelBefore === undefined}
                  onClick={() => setChannelBefore(undefined)}
                >
                  Latest channel files
                </Button>
              </div>
            )}
            {target.kind !== "channel" &&
              target.kind !== "new-task" &&
              search.isPending &&
              submitted !== null && <p role="status">Searching files…</p>}
            {search.data?.results.length === 0 && (
              <p className="text-sm text-muted-foreground">No matching conversation files.</p>
            )}
            {search.data?.results.map((hit) => {
              const source = {
                kind: "attachment" as const,
                attachmentId: hit.attachment.id,
                messageId: hit.messageId,
                ...(hit.taskId ? { taskId: hit.taskId } : {}),
              };
              return (
                <ConversationFileRow
                  key={`${hit.agentId}:${hit.messageId}:${hit.attachment.id}`}
                  name={hit.attachment.name}
                  size={hit.attachment.size}
                  description={hit.agentId}
                  disabled={busy || !canRead}
                  onPreview={() => void open(source, hit.agentId, false)}
                  onDownload={() => void open(source, hit.agentId, true)}
                />
              );
            })}
            <div className="flex gap-2">
              {cursors.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setCursors(cursors.slice(0, -1))}
                >
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
            {target.kind === "new-task" && (
              <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                Choose a file and send it to start a new task.
              </p>
            )}
          </div>
        )}
        {(error ||
          workspace.error ||
          search.error ||
          drafts.error ||
          taskQuery.error ||
          channelQuery.error ||
          channelFilesQuery.error) && (
          <p
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error ??
              workspace.error ??
              search.error ??
              drafts.error ??
              taskQuery.error ??
              channelQuery.error ??
              channelFilesQuery.error}
          </p>
        )}
        {!canRead && (
          <p className="text-xs text-muted-foreground">
            File read permission is required to preview or download bot files.
          </p>
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
      <aside
        className="space-y-4 rounded-xl border bg-muted/15 p-4 xl:self-start"
        aria-label="Send files"
      >
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Upload className="size-4" />
          Send a file
        </h3>
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
              {channels?.map((channel) => (
                <SelectItem key={channel.id} value={`channel:${channel.id}`}>
                  Channel: {channel.name}
                </SelectItem>
              ))}
              {tasks?.map((task) => (
                <SelectItem key={task.id} value={`task:${task.id}`}>
                  {(task.title || task.id) + (task.state === "closed" ? " (closed)" : "")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <p className="text-xs text-muted-foreground">
          Send files to {targetLabel}.{" "}
          {target.kind === "task"
            ? "Task file search covers the latest conversation snapshot."
            : target.kind === "channel"
              ? "The group’s bots can use files sent here."
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
          <Upload className="size-4" />
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
          <div key={draft.attachment.id} className="space-y-2 border-t pt-4">
            <p className="break-all text-sm">
              {draft.attachment.name} · {formatAttachmentSize(draft.attachment.size)} ·{" "}
              {draft.state}
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
                {draft.target?.kind === "channel"
                  ? `Delivered to channel ${draft.target.channelId}.`
                  : draft.taskId
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
                          ...(draft.target?.kind === "channel"
                            ? { channelId: draft.target.channelId }
                            : draft.taskId
                              ? { taskId: draft.taskId }
                              : {}),
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
                          ...(draft.target?.kind === "channel"
                            ? { channelId: draft.target.channelId }
                            : draft.taskId
                              ? { taskId: draft.taskId }
                              : {}),
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
      </aside>
    </div>
  );
}

function ConversationFileRow({
  name,
  size,
  description,
  disabled,
  onPreview,
  onDownload,
}: {
  name: string;
  size: number;
  description?: string;
  disabled: boolean;
  onPreview: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-lg border p-2">
      <Button
        variant="ghost"
        size="multiline"
        className="min-w-0 flex-1 justify-start text-left"
        disabled={disabled}
        aria-label={`Preview ${name}`}
        onClick={onPreview}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
          <FileIcon className="size-4 text-muted-foreground" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{name}</span>
          <span className="block truncate text-xs tabular-nums text-muted-foreground">
            {formatAttachmentSize(size)}
            {description && ` · ${description}`}
          </span>
        </span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={disabled}
        aria-label={`Download ${name}`}
        onClick={onDownload}
      >
        <Download className="size-4" />
      </Button>
    </div>
  );
}
