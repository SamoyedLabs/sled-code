import { useState } from "react";
import type {
  OpenbotConversationMessage,
  OpenbotConversationSnapshot,
  EnvironmentId,
} from "@t3tools/contracts";
import { privilegedTarget } from "@t3tools/client-runtime/openbot/privileged-target";
import * as Schema from "effect/Schema";
import { useBotConversationPanel } from "../../settings/useBotConversationPanel";
import { BotQueueAttachmentsEnvironment } from "../../settings/BotQueueAttachmentsEnvironment";
import { BotResponseBlock } from "../../settings/BotResponseBlock";
import { Dialog, DialogPopup, DialogHeader, DialogTitle } from "../../ui/dialog";
import { randomUUID } from "../../../lib/utils";

const destination = {
  agentId: Schema.NonEmptyString,
  taskId: Schema.NullOr(Schema.NonEmptyString),
};
export const WorkspaceGuardedRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("queue"), ...destination }),
  Schema.Struct({
    kind: Schema.Literal("response"),
    ...destination,
    turnId: Schema.NonEmptyString,
    blockId: Schema.NonEmptyString,
    requestId: Schema.Union([Schema.String, Schema.Number]),
  }),
]);

export function WorkspaceGuardedDialog({
  environmentId,
  hostId,
  request,
  close,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  request: typeof WorkspaceGuardedRequest.Type;
  close: () => void;
}) {
  const c = useBotConversationPanel(
    environmentId,
    hostId,
    request.agentId,
    request.taskId,
    randomUUID,
  );
  const message =
    request.kind === "response"
      ? c.snapshot?.messages.find((message) => {
          const binding = privilegedTarget(c.snapshot, message);
          return (
            binding?.target.turnId === request.turnId &&
            binding.target.blockId === request.blockId &&
            binding.target.requestId === request.requestId
          );
        })
      : null;
  // Retain the original controller through producer completion so its reply/result can settle.
  const [original, setOriginal] = useState<{
    message: OpenbotConversationMessage;
    snapshot: typeof OpenbotConversationSnapshot.Type;
  } | null>(null);
  if (!original && message && c.snapshot) setOriginal({ message, snapshot: c.snapshot });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {request.kind === "queue" ? "Edit queued files" : "Secure response"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 overflow-y-auto px-6 pb-6">
          {c.loading && !c.snapshot && !original ? (
            <p role="status">Loading the original conversation…</p>
          ) : c.error && !original ? (
            <p role="alert">{c.error}</p>
          ) : request.kind === "queue" ? (
            <BotQueueAttachmentsEnvironment
              controller={c}
              legacyEditing={false}
              onActiveChange={() => {}}
            />
          ) : original ? (
            <BotResponseBlock
              environmentId={environmentId}
              hostId={hostId}
              message={original.message}
              snapshot={original.snapshot}
              taskId={request.taskId}
              disabled={!c.permission}
              respond={c.act}
            />
          ) : (
            <p role="status">
              This secure request is no longer pending. Reopen the current request from its
              conversation.
            </p>
          )}
        </div>
      </DialogPopup>
    </Dialog>
  );
}
