import { useAtomValue } from "@effect/atom-react";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import { useEffect, useRef, useState } from "react";
import * as Schema from "effect/Schema";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/reactivity";
import {
  queueAttachmentInitial,
  type QueueAttachmentState,
  type QueueAttachmentPorts,
  type QueueAttachmentScope,
} from "@t3tools/client-runtime/openbot/queue-attachments";
import { QueueAttachmentStateSchema } from "@t3tools/client-runtime/openbot/queue-attachments-storage";
import { QueueAttachmentTarget } from "@t3tools/contracts/openbot-queue-attachments";
import { BotQueueAttachments } from "./BotQueueAttachments";
import { pickQueueAttachment } from "./queueAttachmentPicker";
import { openbot } from "../../state/openbot";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import type { useBotConversationPanel } from "./useBotConversationPanel";
import { appAtomRegistry } from "../../state/atom-registry";
import { Button } from "../../components/ui/Button";
import { AppText as Text } from "../../components/ui/AppText";
import { View } from "react-native";
import storage from "expo-sqlite/kv-store";
import { randomUUID as newId } from "expo-crypto";
const Acquiring = Schema.Struct({
  kind: Schema.Literal("acquiring"),
  scope: Schema.Struct({ ...QueueAttachmentTarget.fields, principal: Schema.String }),
});
const decode = Schema.decodeSync(
  Schema.fromJsonString(Schema.Union([Acquiring, QueueAttachmentStateSchema])),
);
function ok<T>(result: { _tag: "Success"; value: T } | { _tag: "Failure" }): T {
  if (result._tag === "Failure")
    throw new Error("The host refused the operation or the result is unknown.");
  return result.value;
}
type Props = {
  controller: ReturnType<typeof useBotConversationPanel>;
  legacyEditing: boolean;
  onActiveChange: (active: boolean) => void;
};
export function BotQueueAttachmentsEnvironment({
  controller: c,
  legacyEditing,
  onActiveChange,
}: Props) {
  const canEdit = useAtomValue(openbot.queueAttachmentSave.permissionAtom(c.environmentId));
  const allowed = c.permission && canEdit;
  const fileContext = useAtomQueryRunner(openbot.fileContext, {
    refresh: true,
    reportFailure: false,
  });
  const context = useAtomCommand(openbot.queueAttachmentContext, { reportFailure: false });
  const save = useAtomCommand(openbot.queueAttachmentSave, { reportFailure: false });
  const result = useAtomCommand(openbot.queueAttachmentResult, { reportFailure: false });
  const upload = useAtomCommand(openbot.fileOriginalUpload, { reportFailure: false });
  const recover = useAtomCommand(openbot.fileRecoverUpload, { reportFailure: false });
  const cancel = useAtomCommand(openbot.fileCancelUpload, { reportFailure: false });
  const latest = useRef(c);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Keep the authority predicate held by in-flight upload/receipt callbacks aligned with the mounted conversation.
  useEffect(() => {
    latest.current = c;
  }, [c]);
  const alive = useRef(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Invalidate original-scope asynchronous actions on unmount; never release an uncertain edit.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [panel, setPanel] = useState<{
    initial: QueueAttachmentState;
    ports: QueueAttachmentPorts;
    pick: () => Promise<import("@t3tools/contracts").OpenbotOriginalUploadIdentity | null>;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<QueueAttachmentScope | null>(null);
  const choices = c.queueAttachmentChoices;
  const open = async (deliveryId?: string) => {
    const threadId = c.snapshot?.threadId;
    if (!allowed || busy || legacyEditing || !threadId) return;
    setBusy(true);
    setNotice("");
    const opened = await settlePromise(async () => {
      const environmentId = c.environmentId,
        hostId = c.hostId,
        agentId = c.agentId,
        taskId = c.taskId;
      const identity = ok(await fileContext({ environmentId, input: { hostId } }));
      const principal = identity.principalId;
      const connection = Option.getOrNull(
        appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)),
      );
      if (!connection) throw new Error("Connection unavailable.");
      const key = `sled.queue-file-edit.v1:${JSON.stringify([principal, environmentId, hostId, agentId, threadId, taskId])}`;
      const raw = await storage.getItem(key);
      const record = raw === null ? null : decode(raw, { onExcessProperty: "error" });
      let initial: QueueAttachmentState;
      const unfinished =
        record && ("kind" in record || (record.phase !== "saved" && record.phase !== "cancelled"));
      const scope: QueueAttachmentScope = unfinished
        ? record.scope
        : {
            principal,
            environmentId,
            hostId,
            agentId,
            threadId,
            taskId,
            deliveryId: deliveryId ?? "",
            editId: newId(),
          };
      if (
        scope.principal !== principal ||
        scope.environmentId !== environmentId ||
        scope.hostId !== hostId ||
        scope.agentId !== agentId ||
        scope.threadId !== threadId ||
        scope.taskId !== taskId
      )
        throw new Error("The saved edit belongs to another destination.");
      if (!unfinished && !deliveryId)
        throw new Error("No unfinished file edit is stored for this conversation.");
      const current = () => {
        const auth = appAtomRegistry.get(environmentSession.sessionStateAtom(environmentId));
        const session = AsyncResult.getOrElse(auth, () => null);
        const selected = Option.getOrNull(
          appAtomRegistry.get(environmentSession.preparedConnectionValueAtom(environmentId)),
        );
        return alive.current &&
          latest.current.snapshot?.threadId === threadId &&
          latest.current.environmentId === environmentId &&
          latest.current.hostId === hostId &&
          latest.current.agentId === agentId &&
          latest.current.taskId === taskId &&
          latest.current.permission &&
          selected === connection &&
          auth._tag !== "Failure" &&
          session?.authenticated &&
          (!session.expiresAt || session.expiresAt.epochMilliseconds > Date.now()) &&
          appAtomRegistry.get(openbot.queueAttachmentSave.permissionAtom(environmentId))
          ? scope
          : null;
      };
      const check = async () => {
        if (!current()) throw new Error("Original session unavailable.");
        const fresh = ok(await fileContext({ environmentId, input: { hostId } }));
        if (fresh.principalId !== principal || !current())
          throw new Error("Original session changed.");
      };
      const persist = async (state: QueueAttachmentState) => {
        await storage.setItem(key, JSON.stringify(state));
      };
      if (unfinished && !("kind" in record)) {
        initial = record;
      } else {
        await storage.setItem(key, JSON.stringify({ kind: "acquiring", scope }));
        setPending(scope);
        onActiveChange(true);
        await check();
        const { principal: _principal, ...target } = scope;
        const revision = ok(
          await context({ environmentId, input: { ...target, principalId: principal } }),
        );
        initial = queueAttachmentInitial(
          scope,
          revision.expectedRevision,
          revision.text,
          revision.keepAttachmentIds,
        );
        await persist(initial);
      }
      const sources = new Map<string, string>();
      const ports: QueueAttachmentPorts = {
        current,
        persist,
        upload: async (original) => {
          await check();
          const attachmentId = sources.get(original.operationId);
          if (!attachmentId) throw new Error("Original source is unavailable; recover the upload.");
          const value = ok(
            await upload({
              environmentId,
              input: { ...original, principalId: principal, attachmentId },
            }),
          );
          return value.state === "ready" && value.draft
            ? { draftId: value.draft.attachment.id, sha256: value.draft.sha256 }
            : null;
        },
        recoverUpload: async (original) => {
          await check();
          const value = ok(
            await recover({ environmentId, input: { ...original, principalId: principal } }),
          );
          return value.state === "ready" && value.draft
            ? { draftId: value.draft.attachment.id, sha256: value.draft.sha256 }
            : null;
        },
        cancelUpload: async (original) => {
          await check();
          const value = ok(
            await cancel({ environmentId, input: { ...original, principalId: principal } }),
          );
          if (value.state !== "released") throw new Error("Removal is unconfirmed.");
        },
        execute: async (edit, lookup) => {
          await check();
          return ok(
            await (lookup ? result : save)({
              environmentId,
              input: { ...edit, principalId: principal },
            }),
          );
        },
        releaseEdit: async () => {
          await check();
          if (
            !(await c.act({
              operation: "queue.edit",
              agentId,
              deliveryId: scope.deliveryId,
              editId: scope.editId,
              action: "cancel",
            }))
          )
            throw new Error("Release is unconfirmed.");
        },
      };
      const pick = async () => {
        await check();
        const selected = await pickQueueAttachment(environmentId, {
          hostId,
          agentId,
          threadId,
          taskId,
        });
        if (!selected) return null;
        sources.set(selected.identity.operationId, selected.attachmentId);
        return selected.identity;
      };
      setPending(null);
      setPanel({ initial, ports, pick });
      onActiveChange(true);
    });
    if (opened._tag === "Failure")
      setNotice(
        "File edit unavailable or unconfirmed. Resume or release the original edit before continuing.",
      );
    setBusy(false);
  };
  const release = async () => {
    if (!pending || busy || !allowed) return;
    if (
      !alive.current ||
      c.environmentId !== pending.environmentId ||
      c.hostId !== pending.hostId ||
      c.agentId !== pending.agentId ||
      c.taskId !== pending.taskId ||
      c.snapshot?.threadId !== pending.threadId
    ) {
      setNotice("Return to the original conversation to release this edit.");
      return;
    }
    setBusy(true);
    const fresh = await settlePromise(() =>
      fileContext({ environmentId: c.environmentId, input: { hostId: c.hostId } }),
    );
    if (
      fresh._tag !== "Success" ||
      fresh.value._tag !== "Success" ||
      fresh.value.value.principalId !== pending.principal
    ) {
      setBusy(false);
      setNotice("Original session unavailable.");
      return;
    }
    if (
      await c.act({
        operation: "queue.edit",
        agentId: pending.agentId,
        deliveryId: pending.deliveryId,
        editId: pending.editId,
        action: "cancel",
      })
    ) {
      await storage.setItem(
        `sled.queue-file-edit.v1:${JSON.stringify([pending.principal, pending.environmentId, pending.hostId, pending.agentId, pending.threadId, pending.taskId])}`,
        JSON.stringify({
          ...queueAttachmentInitial(pending, "0".repeat(64), "", []),
          phase: "cancelled",
        }),
      );
      setPending(null);
      onActiveChange(false);
      setNotice("Edit released.");
    }
    setBusy(false);
  };
  return (
    <View className="gap-2">
      {panel ? (
        <BotQueueAttachments
          initial={panel.initial}
          ports={panel.ports}
          available={allowed}
          pick={panel.pick}
          onComplete={() => {
            setPanel(null);
            onActiveChange(false);
            c.refresh();
          }}
        />
      ) : (
        <>
          <Button
            disabled={!allowed || busy || legacyEditing}
            onPress={() => void open()}
            label="Resume file edit"
          />
          {!pending &&
            choices.map((d) => (
              <Button
                key={d.id}
                disabled={!allowed || busy || legacyEditing}
                onPress={() => void open(d.id)}
                label={`Edit with files: ${d.text.slice(0, 60) || "Queued message"}`}
              />
            ))}
          {pending && (
            <Button
              disabled={!allowed || busy}
              onPress={() => void release()}
              label="Release unconfirmed file edit"
            />
          )}
        </>
      )}
      <Text accessibilityLiveRegion="polite">{notice}</Text>
    </View>
  );
}
