import { useAtomValue } from "@effect/atom-react";
import { PROVIDER_SEND_TURN_MAX_FILE_BYTES } from "@t3tools/contracts";
import type {
  EnvironmentId,
  OpenbotFileMaterializeInput,
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
import { View } from "react-native";
import * as Option from "effect/Option";
import { FilePreviewModal, type FilePreviewSource } from "../../components/FilePreviewModal";
import { AppText as Text, AppTextInput } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { ControlPill } from "../../components/ui/ControlPill";
import { beginForegroundHandoff } from "../../lib/foreground-handoff";
import { downloadAndShareAttachment } from "../../lib/attachmentDownload";
import { appAtomRegistry } from "../../state/atom-registry";
import { attachmentEnvironment } from "../../state/attachments";
import { environmentSession } from "../../state/session";
import { refreshAssetUrl } from "../../state/assets";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

async function pickBotFile() {
  const { getDocumentAsync } = await import("expo-document-picker");
  const endHandoff = beginForegroundHandoff();
  const picked = await getDocumentAsync({ multiple: false, copyToCacheDirectory: true }).finally(
    endHandoff,
  );
  if (picked.canceled) return null;
  const selected = picked.assets[0];
  if (!selected) return null;
  const { File, UploadType } = await import("expo-file-system");
  const file = new File(selected.uri);
  const size = file.size;
  if (!file.exists || size === null || size <= 0 || size > PROVIDER_SEND_TURN_MAX_FILE_BYTES)
    throw new Error(
      `Choose an available, nonempty file up to ${formatAttachmentSize(PROVIDER_SEND_TURN_MAX_FILE_BYTES)}.`,
    );
  return {
    file,
    size,
    name: selected.name || "file",
    mimeType: selected.mimeType || "application/octet-stream",
    uploadType: UploadType.BINARY_CONTENT,
  };
}

type Props = { environmentId: EnvironmentId; hostId: string; agentId: string };
export function BotFiles(props: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Button
        label={expanded ? "Close files" : "Files"}
        size="compact"
        onPress={() => setExpanded(!expanded)}
      />
      {expanded && (
        <FilesPanel key={`${props.environmentId}:${props.hostId}:${props.agentId}`} {...props} />
      )}
    </View>
  );
}
function FilesPanel({ environmentId, hostId, agentId }: Props) {
  const scope = { hostId, agentId };
  const [path, setPath] = useState(".");
  const [visible, setVisible] = useState(25);
  const [visibleSearch, setVisibleSearch] = useState(25);
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const [cursors, setCursors] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<OpenbotFileTarget>({ kind: "main" });
  const [preview, setPreview] = useState<FilePreviewSource | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
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
      const file = result.value;
      const resource = {
        _tag: "attachment" as const,
        attachmentId: file.attachmentId,
        fileName: file.name,
        mimeType: file.mimeType,
        disposition: "inline" as const,
      };
      if (!save) {
        setPreview({
          environmentId,
          resource,
          name: file.name,
          mimeType: file.mimeType,
          kind: file.mimeType.startsWith("image/")
            ? "image"
            : file.mimeType === "application/pdf"
              ? "pdf"
              : "document",
        });
        return;
      }
      const signal = new AbortController().signal;
      const url = await refreshAssetUrl(
        environmentId,
        { ...resource, disposition: "attachment" },
        signal,
      );
      if (!url) throw new Error("Reconnect to this environment and try again.");
      await downloadAndShareAttachment({
        url,
        attachment: { name: file.name, mimeType: file.mimeType },
        signal,
      });
    });
  const pick = () =>
    act(async () => {
      const picked = await pickBotFile();
      if (!picked) return;
      const { file, size, name, mimeType, uploadType } = picked;
      const controller = new AbortController();
      const pending = await runAttachmentUploadCycle({
        registry: appAtomRegistry,
        createUploadUrl: attachmentEnvironment.createUploadUrl,
        remove: attachmentEnvironment.remove,
        environmentId,
        upload: { type: "file", name, sizeBytes: size, mimeType },
        resolveUploadUrl: (relativeUrl) => {
          const connection = appAtomRegistry.get(
            environmentSession.preparedConnectionValueAtom(environmentId),
          );
          return Option.isSome(connection)
            ? resolveAssetUrl(connection.value.httpBaseUrl, relativeUrl)
            : null;
        },
        transport: (url) => ({
          abort: () => controller.abort(),
          done: file
            .upload(url, {
              httpMethod: "POST",
              uploadType,
              headers: { "Content-Type": mimeType },
              signal: controller.signal,
            })
            .then((response) => {
              if (response.status < 200 || response.status >= 300)
                throw new Error("Could not upload this file to the environment.");
            }),
        }),
      });
      const delivered = await settlePromise(async () => {
        if (pending.status === "cancelled") return;
        if (pending.status === "failed") throw pending.error;
        const result = await upload({
          environmentId,
          input: { ...scope, attachmentId: pending.attachmentId, name, mimeType, size },
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
    <View className="gap-4 rounded-xl bg-grouped-card p-3">
      <Text className="font-t3-medium">Workspace files</Text>
      <Text selectable textRole="footnote" className="text-foreground-muted">
        {workspace.data?.path ?? path}
      </Text>
      <View className="flex-row flex-wrap gap-2">
        <Button
          label="Refresh files"
          size="compact"
          disabled={busy}
          onPress={() => {
            workspace.refresh();
            taskQuery.refresh();
            search.refresh();
            drafts.refresh();
          }}
        />
        {workspace.data?.parentPath && (
          <Button
            label="Parent folder"
            size="compact"
            disabled={busy}
            onPress={() => {
              setPath(workspace.data!.parentPath!);
              setVisible(25);
            }}
          />
        )}
      </View>
      {workspace.isPending && !workspace.data && (
        <Text accessibilityLiveRegion="polite">Loading files…</Text>
      )}
      {workspace.data?.entries.length === 0 && (
        <Text className="text-foreground-muted">No files in this folder.</Text>
      )}
      {workspace.data?.entries.slice(0, visible).map((entry) => (
        <View key={entry.path} className="gap-2 border-b border-border py-2">
          <Text selectable>{entry.name}</Text>
          {entry.kind === "file" && (
            <Text textRole="footnote" className="text-foreground-muted">
              {formatAttachmentSize(entry.size)}
            </Text>
          )}
          <View className="flex-row flex-wrap gap-2">
            {entry.kind === "directory" ? (
              <Button
                label="Open folder"
                size="compact"
                disabled={busy}
                onPress={() => {
                  setPath(entry.path);
                  setVisible(25);
                }}
              />
            ) : (
              <>
                <Button
                  label="Preview"
                  accessibilityLabel={`Preview ${entry.name}`}
                  size="compact"
                  disabled={busy || !canRead}
                  onPress={() => void open({ kind: "workspace", path: entry.path }, agentId, false)}
                />
                <Button
                  label="Save or share"
                  accessibilityLabel={`Save or share ${entry.name}`}
                  size="compact"
                  disabled={busy || !canRead}
                  onPress={() => void open({ kind: "workspace", path: entry.path }, agentId, true)}
                />
              </>
            )}
          </View>
        </View>
      ))}
      {(workspace.data?.entries.length ?? 0) > visible && (
        <Button label="Show more files" size="compact" onPress={() => setVisible(visible + 25)} />
      )}
      {workspace.data?.truncated && (
        <Text textRole="footnote" className="text-foreground-muted">
          This engine returned the first 500 entries. Open a subfolder to narrow the list.
        </Text>
      )}
      <View className="gap-2">
        <Text>Conversation for files</Text>
        <Menu
          title="Conversation for files"
          accessibilityLabel="Choose conversation for files"
          actions={[
            { id: "main", title: "Main conversation" },
            { id: "new-task", title: "Start a new task" },
            ...(tasks?.map((task) => ({
              id: `task:${task.id}`,
              title: (task.title || task.id) + (task.state === "closed" ? " (closed)" : ""),
            })) ?? []),
          ].map((choice) => ({
            ...choice,
            state: choice.id === targetValue ? ("on" as const) : undefined,
            attributes: { disabled: busy },
          }))}
          onPressAction={({ nativeEvent }) => {
            if (!busy) selectTarget(nativeEvent.event);
          }}
        >
          <ControlPill label={targetLabel} disabled={busy} variant="pill" />
        </Menu>
      </View>
      <Text className="font-t3-medium">
        {target.kind === "task"
          ? "Search files in this task"
          : "Search files across main bot conversations"}
      </Text>
      <AppTextInput
        accessibilityLabel="Conversation file name"
        value={query}
        maxLength={255}
        onChangeText={setQuery}
        placeholder="File name"
        className="min-h-12 rounded-xl bg-subtle p-3"
        returnKeyType="search"
        onSubmitEditing={() => {
          setSubmitted(query);
          setCursors([]);
          setVisibleSearch(25);
        }}
      />
      <Button
        label="Search"
        size="compact"
        disabled={busy}
        onPress={() => {
          setSubmitted(query);
          setCursors([]);
          setVisibleSearch(25);
        }}
      />
      {search.isPending && submitted !== null && (
        <Text accessibilityLiveRegion="polite">Searching files…</Text>
      )}
      {search.data?.results.length === 0 && (
        <Text className="text-foreground-muted">No matching conversation files.</Text>
      )}
      {search.data?.results.slice(0, visibleSearch).map((hit) => (
        <View
          key={`${hit.agentId}:${hit.messageId}:${hit.attachment.id}`}
          className="gap-2 border-b border-border py-2"
        >
          <Text selectable>{hit.attachment.name}</Text>
          <Text textRole="footnote" className="text-foreground-muted">
            {hit.agentId} · {formatAttachmentSize(hit.attachment.size)}
          </Text>
          <View className="flex-row flex-wrap gap-2">
            <Button
              label="Preview"
              size="compact"
              disabled={busy || !canRead}
              onPress={() =>
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
            />
            <Button
              label="Save or share"
              size="compact"
              disabled={busy || !canRead}
              onPress={() =>
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
            />
          </View>
        </View>
      ))}
      {(search.data?.results.length ?? 0) > visibleSearch && (
        <Button
          label="Show more results"
          size="compact"
          onPress={() => setVisibleSearch(visibleSearch + 25)}
        />
      )}
      <View className="flex-row flex-wrap gap-2">
        {cursors.length > 0 && (
          <Button
            label="Previous results"
            size="compact"
            onPress={() => {
              setCursors(cursors.slice(0, -1));
              setVisibleSearch(25);
            }}
          />
        )}
        {search.data?.nextCursor && (
          <Button
            label="Next results"
            size="compact"
            onPress={() => {
              setCursors([...cursors, search.data!.nextCursor!]);
              setVisibleSearch(25);
            }}
          />
        )}
      </View>
      <Text className="font-t3-medium">Send a file to this bot</Text>
      <Text textRole="footnote" className="text-foreground-muted">
        Send files to {targetLabel}.{" "}
        {target.kind === "task"
          ? "Task file search covers the latest conversation snapshot."
          : "Choose an existing task or start a new one above."}
      </Text>
      {targetClosed && (
        <Text textRole="footnote" className="text-foreground-muted">
          Reopen this task from its task controls before sending another file.
        </Text>
      )}
      <Button
        label="Choose file"
        size="compact"
        disabled={busy || !canUpload}
        onPress={() => void pick()}
      />
      <AppTextInput
        accessibilityLabel="Message to send with a file"
        placeholder="Tell the bot what to do with this file"
        value={text}
        onChangeText={setText}
        multiline
        textAlignVertical="top"
        maxLength={100_000}
        editable={!busy}
        className="min-h-24 rounded-xl bg-subtle p-3"
      />
      {drafts.data?.map((draft) => (
        <View key={draft.attachment.id} className="gap-2 border-t border-border py-2">
          <Text selectable>{draft.attachment.name}</Text>
          <Text textRole="footnote" className="text-foreground-muted">
            {formatAttachmentSize(draft.attachment.size)} · {draft.state}
          </Text>
          {draft.state === "sending" && (
            <Text textRole="footnote" className="text-foreground-muted">
              {draft.target?.kind === "new-task"
                ? "Creation could not be confirmed. Check task conversations before starting another task."
                : "Delivery was not confirmed. Retry sends the same file and original message using its saved receipt."}
            </Text>
          )}
          {draft.state === "reconciliation-required" && (
            <Text textRole="footnote" className="text-foreground-muted">
              Check the target conversation before sending again. Delivery could not be safely
              confirmed.
            </Text>
          )}
          {draft.state === "sent" && (
            <Text textRole="footnote" className="text-foreground-muted">
              {draft.taskId
                ? `Delivered to task ${draft.taskId}.`
                : "Delivered to the main conversation."}
            </Text>
          )}
          {draft.state === "sent" &&
            draft.conversationMessageId &&
            draft.committedAttachments === null && (
              <Button
                label="Refresh sent file"
                size="compact"
                disabled={busy || !canSend}
                onPress={() =>
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
              />
            )}
          {draft.state === "sent" &&
            draft.conversationMessageId &&
            draft.committedAttachments?.map((file) => (
              <View key={file.id} className="gap-2">
                <Text selectable>{file.name}</Text>
                <View className="flex-row flex-wrap gap-2">
                  <Button
                    label="Preview sent file"
                    size="compact"
                    disabled={busy || !canRead}
                    onPress={() =>
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
                  />
                  <Button
                    label="Save sent file"
                    size="compact"
                    disabled={busy || !canRead}
                    onPress={() =>
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
                  />
                </View>
              </View>
            ))}
          {draft.state === "sent" && !draft.conversationMessageId && (
            <Text textRole="footnote" className="text-foreground-muted">
              File details are available through conversation file search.
            </Text>
          )}
          {draft.state === "sent" && draft.taskId && (
            <Button
              label="Task files"
              size="compact"
              disabled={busy}
              onPress={() => {
                selectTarget(`task:${draft.taskId}`);
                setQuery(draft.attachment.name);
                setSubmitted(draft.attachment.name);
              }}
            />
          )}
          {(draft.state === "ready" || draft.state === "sending") && (
            <View className="flex-row flex-wrap gap-2">
              <Button
                label={
                  draft.state === "sending"
                    ? draft.target?.kind === "new-task"
                      ? "Review delivery"
                      : "Retry delivery"
                    : target.kind === "new-task"
                      ? "Start task with file"
                      : "Send file"
                }
                size="compact"
                disabled={busy || !canSend || (draft.state === "ready" && targetClosed)}
                onPress={() =>
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
              />
              {draft.state === "ready" && (
                <Button
                  label="Discard draft"
                  size="compact"
                  tone="danger"
                  disabled={busy || !canSend || (draft.state === "ready" && targetClosed)}
                  onPress={() =>
                    void act(async () => {
                      const result = await discard({
                        environmentId,
                        input: { ...scope, attachmentId: draft.attachment.id },
                      });
                      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
                    })
                  }
                />
              )}
            </View>
          )}
        </View>
      ))}
      {busy && (
        <Text accessibilityLiveRegion="polite" className="text-foreground-muted">
          Transferring file…
        </Text>
      )}
      {(error || workspace.error || search.error || drafts.error || taskQuery.error) && (
        <Text accessibilityRole="alert" className="text-danger">
          {error ?? workspace.error ?? search.error ?? drafts.error ?? taskQuery.error}
        </Text>
      )}
      {!canRead && (
        <Text textRole="footnote" className="text-foreground-muted">
          File read permission is required to preview or download bot files.
        </Text>
      )}
      <FilePreviewModal
        source={preview}
        onRequestClose={() => setPreview(null)}
        onOpenError={() => {
          setError("Could not preview this file. Try saving it instead.");
          setPreview(null);
        }}
      />
    </View>
  );
}
