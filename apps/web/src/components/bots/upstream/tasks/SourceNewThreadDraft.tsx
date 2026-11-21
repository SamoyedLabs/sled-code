import {
  BotMessageComposer,
  BotComposerInput,
  BotComposerFooter,
  BotComposerSend,
  BotComposerVoice,
  BotComposerVoiceStatus,
} from "../../../settings/BotMessageComposer";
import { ComposerControl } from "../../../chat/ComposerControl";
import { SourceModelPicker } from "../../SourceProviderEnvironment";
import { useAtomQueryRunner } from "../../../../state/use-atom-query-runner";
import { useNewThreadAttachments } from "./useNewThreadAttachments";
import { BotComposerAttachments } from "../../../settings/BotComposerAttachments";
import { useEnvironmentQuery } from "../../../../state/query";
import { readPreparedConnection } from "../../../../state/session";
/* oxlint-disable shadcn/no-unknown-classes -- The source composer uses the existing scoped bot-conversation styles. */
import { useEffect, useRef, useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import type { EnvironmentId, OpenbotDraftFile } from "@t3tools/contracts";
import { settlePromise, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { X, Paperclip } from "lucide-react";
import { openbot } from "../../../../state/openbot";
import { useAtomCommand } from "../../../../state/use-atom-command";
import { useStableCallback } from "../../../../hooks/useStableCallback";
import { randomUUID } from "../../../../lib/utils";
import { BotComposerEditor } from "../../../settings/BotComposerEditor";
import { useBotDictation } from "../../../settings/BotDictation";
import {
  readNewThreadAttempt,
  retainNewThreadAttempt,
  clearNewThreadAttempt,
  type NewThreadAttempt,
} from "./newThreadDraft";
import "../../../settings/bot-conversation.css";
import { T, useGT } from "gt-react";
const decodeCreated = Schema.decodeUnknownResult(
  Schema.Struct({
    id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
    agentId: Schema.String,
  }),
);
export type SourceNewThreadDraftProps = {
  environmentId: EnvironmentId;
  hostId: string;
  agentId: string;
  initialDraft?: string;
  onDraftChange?: (text: string) => void;
  onCreated: (taskId: string) => void;
  onCancel?: () => void;
  onOutcomePendingChange?: (pending: boolean) => void;
};
export function SourceNewThreadDraft(props: SourceNewThreadDraftProps) {
  return (
    <NewThreadDraft
      key={JSON.stringify([props.environmentId, props.hostId, props.agentId])}
      {...props}
    />
  );
}
function NewThreadDraft({
  environmentId,
  hostId,
  agentId,
  initialDraft = "",
  onDraftChange,
  onCreated,
  onCancel,
  onOutcomePendingChange,
}: SourceNewThreadDraftProps) {
  const gt = useGT();
  const scope = JSON.stringify([environmentId, hostId, agentId]);
  const [attempt, setAttempt] = useState<NewThreadAttempt | null>(() => {
    try {
      return readNewThreadAttempt(scope, window.sessionStorage);
    } catch {
      return null;
    }
  });
  const [text, setText] = useState(attempt?.text ?? initialDraft);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(
      attempt
        ? "The previous start was not confirmed. Retry to check whether the thread started."
        : null,
    );
  const lock = useRef(false),
    alive = useRef(true);
  const publish = useStableCallback((value: string) => {
    setText(value);
    onDraftChange?.(value);
  });
  const pendingChanged = useStableCallback((pending: boolean) => onOutcomePendingChange?.(pending));
  const voice = useBotDictation(scope, text, publish);
  const send = useAtomCommand(openbot.newTaskStart, { reportFailure: false });
  const fileContext = useAtomQueryRunner(openbot.fileContext, {
    reportFailure: false,
    reportDefect: false,
    refresh: true,
  });
  const fileSend = useAtomCommand(openbot.fileSendDraft, { reportFailure: false });
  const canSendFiles = useAtomValue(openbot.fileSendDraft.permissionAtom(environmentId));
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<readonly OpenbotDraftFile[]>([]);
  const [selectedIds, setSelectedIds] = useState<readonly string[]>(attempt?.attachmentIds ?? []);
  const staged = useEnvironmentQuery(
    openbot.fileDrafts({ environmentId, input: { hostId, agentId } }),
  );
  const selectedFiles = selectedIds.flatMap((id) => {
    const file =
      files.find((draft) => draft.attachment.id === id) ??
      staged.data?.find((draft) => draft.attachment.id === id);
    return file ? [file.attachment] : [];
  });
  const uploads = useNewThreadAttachments(
    environmentId,
    hostId,
    agentId,
    busy || attempt !== null,
    (draft) => {
      setFiles((items) => [...items, draft]);
      setSelectedIds((ids) => [...ids, draft.attachment.id]);
    },
  );

  const permission = useAtomValue(openbot.newTaskStart.permissionAtom(environmentId));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Async completion must not navigate a workspace that has changed scope.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Inform the owning workspace when a persisted receipt must keep this draft open.
  useEffect(() => {
    pendingChanged(attempt !== null);
  }, [attempt, pendingChanged]);
  async function submit() {
    if (
      lock.current ||
      !permission ||
      (!attempt && !text.trim() && !selectedIds.length) ||
      voice.busy ||
      uploads.busy ||
      (selectedIds.length > 0 && !canSendFiles)
    )
      return;
    lock.current = true;
    setBusy(true);
    setError(null);
    const connection = readPreparedConnection(environmentId);
    const boundSettled = await settlePromise(async () => {
      const bound = await fileContext({ environmentId, input: { hostId } });
      if (bound._tag === "Failure") throw squashAtomCommandFailure(bound);
      if (!alive.current || readPreparedConnection(environmentId) !== connection) return null;
      const pid = bound.value.principalId;
      if (attempt && attempt.principalId !== pid)
        throw Error(
          "This start belongs to an earlier sign-in. Check its original task list; it will not be started again from this session.",
        );
      return pid;
    });
    if (boundSettled._tag === "Failure") {
      const cause = squashAtomCommandFailure(boundSettled);
      if (alive.current) {
        setError(
          cause instanceof Error
            ? cause.message
            : gt("The original sign-in could not be verified. No task was started."),
        );
        setBusy(false);
      }
      lock.current = false;
      return;
    }
    if (boundSettled.value === null) {
      lock.current = false;
      if (alive.current) setBusy(false);
      return;
    }
    const principalId = boundSettled.value;
    const current = attempt ?? {
      principalId,
      clientMessageId: randomUUID(),
      text: text.trim(),
      ...(selectedIds.length ? { attachmentIds: selectedIds } : {}),
    };
    if (!attempt) {
      let saved = false;
      try {
        saved = retainNewThreadAttempt(scope, current, window.sessionStorage);
      } catch {
        /* Browser storage access itself can be refused. */
      }
      if (!saved) {
        setError(gt("The start request could not be saved for recovery. No task was started."));
        lock.current = false;
        setBusy(false);
        return;
      }
      setAttempt(current);
    }
    const settled = await settlePromise(async () => {
      if (current.attachmentIds?.length) {
        if (!canSendFiles) throw Error("Permission to send files is required.");
        const result = await fileSend({
          environmentId,
          input: {
            hostId,
            agentId,
            attachmentId: current.attachmentIds[0]!,
            attachmentIds: [...current.attachmentIds],
            text: current.text,
            target: { kind: "new-task" },
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        if (!alive.current || readPreparedConnection(environmentId) !== connection) return;
        if (result.value.state !== "sent" || !result.value.taskId)
          throw Error(
            "The host has not confirmed the task. The original file delivery remains retained in Files.",
          );
        try {
          clearNewThreadAttempt(scope, window.sessionStorage);
        } catch {
          /* An accepted task keeps its host identity even if storage closes. */
        }
        setAttempt(null);
        setSelectedIds([]);
        publish("");
        pendingChanged(false);
        onCreated(result.value.taskId);
        return;
      }
      const result = await send({
        environmentId,
        input: {
          hostId,
          agentId,
          text: current.text,
          clientMessageId: current.clientMessageId,
        },
      });
      if (result._tag === "Failure") {
        if (alive.current)
          setError(
            gt("{String} Retry to check whether the thread started.", {
              String: String(squashAtomCommandFailure(result)),
            }),
          );
        return;
      }
      const created = decodeCreated(result.value);
      if (!Result.isSuccess(created) || created.success.agentId !== agentId) {
        if (alive.current)
          setError(
            gt("The host did not confirm the new thread. Retry to check whether it started."),
          );
        return;
      }
      if (!alive.current || readPreparedConnection(environmentId) !== connection) return;
      try {
        clearNewThreadAttempt(scope, window.sessionStorage);
      } catch {
        /* The accepted host identity remains authoritative. */
      }
      if (alive.current) {
        setAttempt(null);
        publish("");
        pendingChanged(false);
        onCreated(created.success.id);
      }
    });
    if (settled._tag === "Failure" && alive.current) {
      const cause = squashAtomCommandFailure(settled);
      setError(
        gt("{value} Retry checks the same request.", {
          value:
            cause instanceof Error
              ? cause.message
              : "The connection ended before the start was confirmed.",
        }),
      );
    }
    lock.current = false;
    if (alive.current) setBusy(false);
  }
  return (
    <section className="ob-chat" data-workspace aria-label={gt("New thread")} aria-busy={busy}>
      <div className="ob-chat-utilities">
        {onCancel && (
          <button
            type="button"
            className="ob-chat-action-button"
            aria-label={gt("Close new thread")}
            disabled={busy || attempt !== null}
            onClick={onCancel}
          >
            <X size={16} />
          </button>
        )}
      </div>
      <div className="ob-chat-scroll">
        <p className="ob-chat-history-status">
          <T>Start a new thread with this agent.</T>
        </p>
      </div>
      {(error || uploads.error) && (
        <p role="alert" className="ob-chat-history-status">
          {error ?? uploads.error}
        </p>
      )}
      {!permission && (
        <p role="status" className="ob-chat-history-status">
          <T>Chat permission is required to start a thread.</T>
        </p>
      )}
      <div className="ob-chat-composer-wrap">
        <BotMessageComposer
          onDragOver={(event) => {
            if (uploads.available && event.dataTransfer.types.includes("Files"))
              event.preventDefault();
          }}
          onDrop={(event) => {
            if (uploads.available && event.dataTransfer.files.length) {
              event.preventDefault();
              void uploads.add(Array.from(event.dataTransfer.files), selectedIds.length);
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              void uploads.add(Array.from(event.currentTarget.files ?? []), selectedIds.length);
              event.currentTarget.value = "";
            }}
          />
          <BotComposerAttachments
            files={selectedFiles}
            uploads={[]}
            disabled={busy || attempt !== null}
            reorderDisabled={uploads.busy}
            onReorder={setSelectedIds}
            onRemove={(id) => setSelectedIds((ids) => ids.filter((item) => item !== id))}
            onRemoveUpload={() => {}}
            onRetry={() => {}}
          />
          {uploads.busy && (
            <p role="status" className="ob-chat-history-status">
              <T>Uploading files…</T>
            </p>
          )}
          <BotComposerInput>
            <BotComposerEditor
              environmentId={environmentId}
              hostId={hostId}
              agentId={agentId}
              value={text}
              onChange={publish}
              onSubmit={() => void submit()}
              disabled={!permission || busy || attempt !== null}
              placeholder={gt("Message…")}
              attachments={selectedFiles.map((file) => ({ id: file.id, name: file.name }))}
              onFiles={
                uploads.available
                  ? (files) => void uploads.add(files, selectedIds.length)
                  : undefined
              }
            />
          </BotComposerInput>
          <BotComposerFooter
            actions={
              <>
                <SourceModelPicker
                  environmentId={environmentId}
                  hostId={hostId}
                  agentId={agentId}
                  disabled={busy || attempt !== null}
                />
                <BotComposerVoice
                  voice={voice}
                  disabled={!permission || busy || attempt !== null}
                />
                <BotComposerSend
                  aria-label={attempt ? gt("Retry thread start") : gt("Start thread")}
                  busy={busy}
                  disabled={
                    !permission ||
                    busy ||
                    voice.busy ||
                    uploads.busy ||
                    (selectedIds.length > 0 && !canSendFiles) ||
                    (!attempt && !text.trim() && !selectedIds.length)
                  }
                />
              </>
            }
          >
            <ComposerControl
              type="button"
              className="size-8 px-0"
              aria-label={gt("Attach files")}
              disabled={!permission || !uploads.available || !canSendFiles}
              onClick={() => fileInput.current?.click()}
            >
              <Paperclip size={16} />
            </ComposerControl>
          </BotComposerFooter>
          <BotComposerVoiceStatus voice={voice} />
        </BotMessageComposer>
      </div>
    </section>
  );
}
