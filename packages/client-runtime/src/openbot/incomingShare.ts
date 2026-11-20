import { OpenbotOriginalUploadIdentity } from "../../../contracts/src/openbotFiles.ts";
import * as Schema from "effect/Schema";
import { OpenbotDraftFile, OpenbotFileTarget, type OpenbotFileSendInput } from "@t3tools/contracts";
import { acceptedDraft } from "./richConversation.ts";

export const BotShareDestination = Schema.Struct({
  environmentId: Schema.String,
  principalId: Schema.String,
  hostId: Schema.String,
  agentId: Schema.String,
  threadId: Schema.String,
  target: OpenbotFileTarget,
});
export type BotShareDestination = typeof BotShareDestination.Type;
export const BotShareTransfer = Schema.Struct({
  destination: BotShareDestination,
  phase: Schema.Literals(["staging", "ready", "sending", "sent"]),
  text: Schema.String,
  sourceIds: Schema.Array(Schema.String),
  drafts: Schema.Array(OpenbotDraftFile),
  pendingSourceId: Schema.NullOr(Schema.String),
  pendingUpload: Schema.optional(OpenbotOriginalUploadIdentity),
  uploadOutcome: Schema.optional(Schema.Literals(["released", "absent"])),
});
export type BotShareTransfer = typeof BotShareTransfer.Type;
export function botShareDestinationKey(d: BotShareDestination) {
  return JSON.stringify([
    d.environmentId,
    d.principalId,
    d.hostId,
    d.agentId,
    d.threadId,
    d.target.kind,
    d.target.kind === "task" ? d.target.taskId : null,
  ]);
}
export function botShareRecovery(
  state: BotShareTransfer | null | undefined,
  destination: BotShareDestination,
) {
  const reason =
    state && botShareDestinationKey(state.destination) !== botShareDestinationKey(destination)
      ? state.destination.principalId !== destination.principalId
        ? "session-mismatch"
        : "destination-mismatch"
      : state?.uploadOutcome === "released"
        ? "cancelled"
        : state?.pendingUpload || state?.phase === "sending" || state?.phase === "sent"
          ? "unknown"
          : "not-pending";
  const mismatch = reason === "session-mismatch" || reason === "destination-mismatch";
  return {
    reason,
    canStage: !mismatch && reason !== "cancelled" && (!state || state.phase === "staging"),
    canSend: !mismatch && state?.phase === "ready",
    canReconcile: !mismatch && reason === "unknown",
    message:
      reason === "session-mismatch"
        ? "This retained share belongs to the original signed-in session. Reconnect that session to recover; this session cannot resend or cancel it. Copies remain in the inbox."
        : reason === "destination-mismatch"
          ? "Return to the original environment and bot conversation to recover this share. Copies remain in the inbox."
          : reason === "cancelled"
            ? "The original upload was cancelled. Copies remain in the inbox. Cancel staging to confirm release of this reservation before starting a new upload."
            : state?.uploadOutcome === "absent"
              ? "No committed upload established. Copies remain in the inbox. Retry staging with the original upload identity or cancel staging."
              : reason === "unknown"
                ? "The original operation is unconfirmed. Reconcile its receipt; do not resend or change destination. Copies remain in the inbox."
                : "No pending upload or send receipt is recorded. Copies remain in the inbox. Retry staging in this destination or cancel staging.",
  };
}
export interface BotShareSource {
  readonly id: string;
  readonly text: string;
  readonly sourceIds: readonly string[];
  readonly transfer: BotShareTransfer | null;
}
export interface BotSharePorts {
  read(): Promise<BotShareSource>;
  /** Atomic compare-and-swap inside the existing inbox serialization. */
  save(expected: BotShareTransfer | null, next: BotShareTransfer | null): Promise<void>;
  prepareUpload?(sourceId: string): Promise<OpenbotOriginalUploadIdentity>;
  cancelUpload?(
    identity: OpenbotOriginalUploadIdentity,
  ): Promise<{ state: "absent" | "released" | "ready"; draft: OpenbotDraftFile | null }>;
  recoverUpload?(
    identity: OpenbotOriginalUploadIdentity,
  ): Promise<{ state: "absent" | "released" | "ready"; draft: OpenbotDraftFile | null }>;
  upload(sourceId: string, identity?: OpenbotOriginalUploadIdentity): Promise<OpenbotDraftFile>;
  list(): Promise<readonly OpenbotDraftFile[]>;
  send(input: OpenbotFileSendInput): Promise<OpenbotDraftFile>;
  discard(attachmentId: string): Promise<void>;
  consume(expected: BotShareTransfer): Promise<void>;
  /** Must reflect current authenticated selection, including after every await. */
  current(): BotShareDestination | null;
}
/** User-driven bridge to the existing Files journal, never an automatic delivery worker. */
export function createBotShareTransfer(destination: BotShareDestination, ports: BotSharePorts) {
  let running = false;
  let stopped = false;
  function guard() {
    if (
      stopped ||
      !ports.current() ||
      botShareDestinationKey(ports.current()!) !== botShareDestinationKey(destination)
    )
      throw new Error("Share destination changed. Return to the selected destination to recover.");
  }
  async function read() {
    guard();
    const source = await ports.read();
    guard();
    if (
      source.transfer &&
      botShareDestinationKey(source.transfer.destination) !== botShareDestinationKey(destination)
    )
      throw new Error(botShareRecovery(source.transfer, destination).message);
    if (
      source.transfer &&
      JSON.stringify(source.sourceIds) !== JSON.stringify(source.transfer.sourceIds)
    )
      throw new Error("Shared attachment identity changed.");
    return source;
  }
  async function run(action: () => Promise<void>) {
    if (running) throw new Error("A share operation is already running.");
    running = true;
    try {
      await action();
    } finally {
      running = false;
    }
  }
  function matching(record: OpenbotDraftFile, original: OpenbotDraftFile) {
    return (
      record.hostId === destination.hostId &&
      record.agentId === destination.agentId &&
      record.attachment.id === original.attachment.id &&
      record.sha256 === original.sha256
    );
  }
  async function finish(state: BotShareTransfer, records: readonly OpenbotDraftFile[]) {
    const ids = state.drafts.map((d) => d.attachment.id);
    if (
      !ids.length ||
      !state.drafts.every((original) =>
        records.some(
          (record) =>
            matching(record, original) &&
            acceptedDraft(destination, destination.target, original.attachment.id, record) &&
            record.expectedThreadId === destination.threadId &&
            record.sendText === state.text &&
            JSON.stringify(record.batchAttachmentIds ?? [record.attachment.id]) ===
              JSON.stringify(ids),
        ),
      )
    )
      throw new Error("Delivery is not confirmed. Shared content is retained.");
    guard();
    const sent = { ...state, phase: "sent" as const };
    await ports.save(state, sent);
    guard();
    await ports.consume(sent);
  }
  return {
    stop() {
      stopped = true;
    },
    resume() {
      stopped = false;
    },
    stage: () =>
      run(async () => {
        const source = await read();
        if (
          !source.sourceIds.length ||
          source.sourceIds.length > 10 ||
          new Set(source.sourceIds).size !== source.sourceIds.length
        )
          throw new Error("Choose between one and ten distinct attachments.");
        if (destination.target.kind !== "main" && destination.target.kind !== "task")
          throw new Error("Choose an existing bot conversation.");
        let state = source.transfer;
        if (!state) {
          state = {
            destination,
            phase: "staging",
            text: source.text,
            sourceIds: [...source.sourceIds],
            drafts: [],
            pendingSourceId: null,
          };
          await ports.save(null, state);
        }
        if (state.phase !== "staging") return;
        if (state.uploadOutcome === "released")
          throw new Error(botShareRecovery(state, destination).message);
        for (const sourceId of state.sourceIds.slice(state.drafts.length)) {
          guard();
          if (!ports.prepareUpload || !ports.recoverUpload)
            throw new Error("Authenticated upload recovery is unavailable.");
          if (state.pendingSourceId && (state.pendingSourceId !== sourceId || !state.pendingUpload))
            throw new Error("Original upload identity is unavailable. Keep the source.");
          const pendingUpload = state.pendingUpload ?? (await ports.prepareUpload(sourceId));
          guard();
          if (
            pendingUpload.hostId !== destination.hostId ||
            pendingUpload.agentId !== destination.agentId ||
            pendingUpload.threadId !== destination.threadId ||
            pendingUpload.taskId !==
              (destination.target.kind === "task" ? destination.target.taskId : null)
          )
            throw new Error("Upload destination changed.");
          const pending: BotShareTransfer = { ...state, pendingSourceId: sourceId, pendingUpload };
          await ports.save(state, pending);
          guard();
          const recovered: {
            state: "absent" | "released" | "ready";
            draft: OpenbotDraftFile | null;
          } | null = state.pendingSourceId ? await ports.recoverUpload(pendingUpload) : null;
          guard();
          if (recovered?.state === "ready" && !recovered.draft)
            throw new Error("Original upload outcome is unknown. Keep the source.");
          if (recovered?.state === "released") {
            const cancelled = { ...pending, uploadOutcome: "released" as const };
            await ports.save(pending, cancelled);
            throw new Error(botShareRecovery(cancelled, destination).message);
          }
          const draft: OpenbotDraftFile =
            recovered?.state === "ready" && recovered.draft
              ? recovered.draft
              : await ports.upload(sourceId, pendingUpload);
          // Retain an authoritative receipt even if the view was detached during upload.
          if (
            draft.hostId !== destination.hostId ||
            draft.agentId !== destination.agentId ||
            draft.sha256 !== pendingUpload.sha256 ||
            draft.state !== "ready" ||
            draft.target !== null ||
            pending.drafts.some((d) => d.attachment.id === draft.attachment.id)
          )
            throw new Error("Upload receipt identity does not match.");
          state = {
            ...pending,
            drafts: [...pending.drafts, draft],
            pendingSourceId: null,
            pendingUpload: undefined,
            uploadOutcome: undefined,
          };
          await ports.save(pending, state);
        }
        guard();
        if (!state) throw new Error("Missing share reservation.");
        await ports.save(state, { ...state, phase: "ready" });
      }),
    send: () =>
      run(async () => {
        const { transfer: state } = await read();
        if (!state || state.phase !== "ready")
          throw new Error("Stage attachments before sending. Reconcile an earlier send first.");
        const sending = { ...state, phase: "sending" as const };
        await ports.save(state, sending);
        guard();
        const ids = sending.drafts.map((d) => d.attachment.id);
        await ports.send({
          hostId: destination.hostId,
          agentId: destination.agentId,
          target: destination.target,
          expectedThreadId: destination.threadId,
          attachmentId: ids[0]!,
          attachmentIds: ids,
          text: state.text,
        });
        guard();
        await finish(sending, await ports.list());
      }),
    reconcile: () =>
      run(async () => {
        const { transfer: state } = await read();
        if (state?.phase === "staging" && state.pendingSourceId) {
          if (!state.pendingUpload || !ports.recoverUpload)
            throw new Error("Original upload identity is unavailable. Keep the source.");
          const outcome = await ports.recoverUpload(state.pendingUpload);
          guard();
          if (outcome.state !== "ready" || !outcome.draft) {
            if (outcome.state === "released" || outcome.state === "absent") {
              const checked = { ...state, uploadOutcome: outcome.state };
              await ports.save(state, checked);
              throw new Error(botShareRecovery(checked, destination).message);
            }
            throw new Error("Original upload outcome is unknown. Keep the source.");
          }
          const draft = outcome.draft;
          if (
            draft.hostId !== destination.hostId ||
            draft.agentId !== destination.agentId ||
            draft.sha256 !== state.pendingUpload.sha256 ||
            draft.attachment.size !== state.pendingUpload.size ||
            draft.state !== "ready" ||
            state.drafts.some((d) => d.attachment.id === draft.attachment.id)
          )
            throw new Error("Original upload receipt differs.");
          await ports.save(state, {
            ...state,
            drafts: [...state.drafts, draft],
            pendingSourceId: null,
            pendingUpload: undefined,
            uploadOutcome: undefined,
            phase: state.drafts.length + 1 === state.sourceIds.length ? "ready" : "staging",
          });
          return;
        }
        if (!state || (state.phase !== "sending" && state.phase !== "sent"))
          throw new Error("No send to reconcile.");
        await finish(state, await ports.list());
      }),
    cancel: () =>
      run(async () => {
        let { transfer: state } = await read();
        if (!state) return;
        if (state.pendingSourceId && state.pendingUpload && ports.cancelUpload) {
          const result = await ports.cancelUpload(state.pendingUpload);
          guard();
          if (result.state === "ready")
            throw new Error("Original upload cancellation is not confirmed.");
          const cleared = { ...state, pendingSourceId: null, pendingUpload: undefined };
          await ports.save(state, cleared);
          state = cleared;
        }
        if (state.phase === "sending" || state.phase === "sent" || state.pendingSourceId)
          throw new Error(
            "The outcome is unknown or already sent. Reconcile before releasing this destination.",
          );
        const records = await ports.list();
        guard();
        for (const original of state.drafts) {
          const record = records.find((d) => d.attachment.id === original.attachment.id);
          if (record && !matching(record, original))
            throw new Error("Draft identity changed. Keep the reservation.");
          if (record && record.state !== "ready")
            throw new Error("A draft is already being sent. Keep the reservation.");
          if (record) {
            await ports.discard(record.attachment.id);
            guard();
          }
        }
        await ports.save(state, null);
      }),
  };
}
