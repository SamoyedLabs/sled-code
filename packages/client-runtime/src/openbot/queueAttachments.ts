import * as Schema from "effect/Schema";
import * as Result from "effect/Result";
import type {
  QueueAttachmentEdit,
  QueueAttachmentReceipt,
  QueueAttachmentTarget,
} from "@t3tools/contracts/openbot-queue-attachments";
import type { OpenbotOriginalUploadIdentity } from "@t3tools/contracts";
export type QueueAttachmentScope = QueueAttachmentTarget & { readonly principal: string };
export type QueueAttachmentState = {
  readonly scope: QueueAttachmentScope;
  readonly edit: QueueAttachmentEdit;
  readonly phase: "ready" | "saving" | "unknown" | "saved" | "cancelled";
  readonly pendingUpload: OpenbotOriginalUploadIdentity | null;
  readonly receipt: QueueAttachmentReceipt | null;
};
export interface QueueAttachmentPorts {
  current(): QueueAttachmentScope | null;
  persist(state: QueueAttachmentState): Promise<void>;
  upload(
    identity: OpenbotOriginalUploadIdentity,
  ): Promise<{ draftId: string; sha256: string } | null>;
  recoverUpload(
    identity: OpenbotOriginalUploadIdentity,
  ): Promise<{ draftId: string; sha256: string } | null>;
  cancelUpload(identity: OpenbotOriginalUploadIdentity): Promise<void>;
  execute(edit: QueueAttachmentEdit, resultOnly: boolean): Promise<QueueAttachmentReceipt | null>;
  releaseEdit(): Promise<void>;
}
const same = (a: QueueAttachmentScope | null, b: QueueAttachmentScope) =>
  a !== null &&
  Object.keys(b).every(
    (key) => a[key as keyof QueueAttachmentScope] === b[key as keyof QueueAttachmentScope],
  );
/** One acquired queue edit. The Files journal is authoritative; persisted attempts only reconcile. */
export function createQueueAttachments(initial: QueueAttachmentState, ports: QueueAttachmentPorts) {
  let state = structuredClone(initial),
    busy = false;
  if (state.phase === "saving") state = { ...state, phase: "unknown" };
  const owned = () => same(ports.current(), state.scope);
  const write = async (next: QueueAttachmentState) => {
    await ports.persist(next);
    state = next;
  };
  const run = async (task: () => Promise<boolean>) => {
    if (busy || !owned()) return false;
    busy = true;
    try {
      return await task();
    } finally {
      busy = false;
    }
  };
  const acceptUpload = async (
    identity: OpenbotOriginalUploadIdentity,
    result: { draftId: string; sha256: string } | null,
  ) => {
    if (!result || result.sha256 !== identity.sha256) return false;
    // A late upload receipt is retained in the original scope, never moved to current selection.
    await write({
      ...state,
      pendingUpload: null,
      edit: {
        ...state.edit,
        uploads: [...state.edit.uploads, { identity, draftId: result.draftId }],
      },
    });
    return owned();
  };
  const accept = async (receipt: QueueAttachmentReceipt | null) => {
    if (
      !receipt ||
      receipt.deliveryId !== state.edit.deliveryId ||
      receipt.editId !== state.edit.editId ||
      receipt.expectedRevision !== state.edit.expectedRevision
    )
      return false;
    await write({ ...state, phase: "saved", receipt });
    return true;
  };
  return {
    get state() {
      return state;
    },
    get busy() {
      return busy;
    },
    change(text: string, keepAttachmentIds: readonly string[]) {
      return run(async () => {
        if (
          state.phase !== "ready" ||
          state.pendingUpload ||
          keepAttachmentIds.some((id) => !state.edit.keepAttachmentIds.includes(id))
        )
          return false;
        await write({
          ...state,
          edit: { ...state.edit, text, keepAttachmentIds: [...keepAttachmentIds] },
        });
        return true;
      });
    },
    attach(identity: OpenbotOriginalUploadIdentity) {
      return run(async () => {
        if (
          state.phase !== "ready" ||
          state.pendingUpload ||
          state.edit.uploads.length + state.edit.keepAttachmentIds.length >= 10 ||
          identity.hostId !== state.scope.hostId ||
          identity.agentId !== state.scope.agentId ||
          identity.threadId !== state.scope.threadId ||
          identity.taskId !== state.scope.taskId ||
          state.edit.uploads.some((u) => u.identity.operationId === identity.operationId)
        )
          return false;
        await write({ ...state, pendingUpload: identity });
        if (!owned()) return false;
        try {
          return await acceptUpload(identity, await ports.upload(identity));
        } catch {
          return false;
        }
      });
    },
    recoverUpload() {
      return run(async () => {
        const identity = state.pendingUpload;
        if (!identity) return false;
        try {
          return await acceptUpload(identity, await ports.recoverUpload(identity));
        } catch {
          return false;
        }
      });
    },
    remove(operationId: string) {
      return run(async () => {
        if (state.phase !== "ready") return false;
        const pending =
          state.pendingUpload?.operationId === operationId ? state.pendingUpload : null;
        const upload = state.edit.uploads.find((u) => u.identity.operationId === operationId);
        if (!pending && !upload) return false;
        await ports.cancelUpload(pending ?? upload!.identity);
        await write({
          ...state,
          pendingUpload: pending ? null : state.pendingUpload,
          edit: { ...state.edit, uploads: state.edit.uploads.filter((u) => u !== upload) },
        });
        return true;
      });
    },
    save() {
      return run(async () => {
        if (state.phase !== "ready" || state.pendingUpload || !state.edit.uploads.length)
          return false;
        await write({ ...state, phase: "saving" });
        if (!owned()) return false;
        try {
          if (await accept(await ports.execute(state.edit, false))) return true;
        } catch {
          /* Missing receipt is not permission to replay. */
        }
        await write({ ...state, phase: "unknown" });
        return false;
      });
    },
    reconcile() {
      return run(async () => {
        if (state.phase !== "unknown" && state.phase !== "saving") return false;
        try {
          return await accept(await ports.execute(state.edit, true));
        } catch {
          return false;
        }
      });
    },
    cancel() {
      return run(async () => {
        if (state.phase !== "ready") return false;
        const identities = [
          ...state.edit.uploads.map((u) => u.identity),
          ...(state.pendingUpload ? [state.pendingUpload] : []),
        ];
        for (const identity of identities) {
          if (!owned()) return false;
          await ports.cancelUpload(identity);
        }
        if (!owned()) return false;
        await ports.releaseEdit();
        await write({ ...state, phase: "cancelled", pendingUpload: null });
        return true;
      });
    },
  };
}

/** Call after signed queue context returns the acquired contents and revision. */
export function queueAttachmentInitial(
  scope: QueueAttachmentScope,
  expectedRevision: string,
  text: string,
  keepAttachmentIds: readonly string[],
): QueueAttachmentState {
  const { principal: _principal, ...target } = scope;
  return {
    scope,
    edit: {
      ...target,
      expectedRevision,
      text,
      keepAttachmentIds: [...keepAttachmentIds],
      uploads: [],
    },
    phase: "ready",
    pendingUpload: null,
    receipt: null,
  };
}

const decodeTaskQueue = Schema.decodeUnknownResult(
  Schema.Struct({
    agentId: Schema.String,
    tasks: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        agentId: Schema.String,
        threadId: Schema.String,
        closedAt: Schema.NullOr(Schema.String),
        queuedMessages: Schema.Array(
          Schema.Struct({
            deliveryId: Schema.String,
            text: Schema.String,
          }),
        ).check(Schema.isMaxLength(1000)),
      }),
    ).check(Schema.isMaxLength(50)),
  }),
);
// Task conversation snapshots omit pending deliveries; only task.list supplies these previews.
export function taskQueueAttachmentChoices(
  value: unknown,
  target: { readonly agentId: string; readonly taskId: string; readonly threadId: string | null },
) {
  const decoded = decodeTaskQueue(value);
  if (!Result.isSuccess(decoded) || decoded.success.agentId !== target.agentId || !target.threadId)
    return null;
  const matches = decoded.success.tasks.filter((task) => task.id === target.taskId);
  const task = matches[0];
  if (
    matches.length !== 1 ||
    !task ||
    task.agentId !== target.agentId ||
    task.threadId !== target.threadId
  )
    return null;
  if (task.closedAt !== null) return [];
  if (
    new Set(task.queuedMessages.map((message) => message.deliveryId)).size !==
    task.queuedMessages.length
  )
    return null;
  return task.queuedMessages.map((message) => ({ id: message.deliveryId, text: message.text }));
}
