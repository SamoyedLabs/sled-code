import * as Schema from "effect/Schema";
import {
  CommandId,
  EnvironmentId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";
import {
  OrchestrationV2RunStatus,
  OrchestrationV2ThreadLaunchWorkspaceStrategy,
} from "./orchestrationV2.ts";

const ExternalId = TrimmedNonEmptyString.check(
  Schema.isMaxLength(512),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,511}$/),
);
export const OpenbotCodingOrigin = Schema.Struct({
  hostId: ExternalId,
  agentId: ExternalId,
  /** Present only for channel tasks; never reinterpret this taskId as an agent side task. */
  channelId: Schema.optional(ExternalId),
  taskId: Schema.NullOr(ExternalId),
});
export type OpenbotCodingOrigin = typeof OpenbotCodingOrigin.Type;
export const OpenbotCodingReference = Schema.Struct({
  origin: OpenbotCodingOrigin,
  operationId: ExternalId,
});
export type OpenbotCodingReference = typeof OpenbotCodingReference.Type;
export const OpenbotCodingLaunchInput = Schema.Struct({
  ...OpenbotCodingReference.fields,
  environmentId: Schema.optional(EnvironmentId),
  projectId: ProjectId,
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
  prompt: TrimmedNonEmptyString.check(Schema.isMaxLength(200_000)),
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  workspaceStrategy: OrchestrationV2ThreadLaunchWorkspaceStrategy,
});
export type OpenbotCodingLaunchInput = typeof OpenbotCodingLaunchInput.Type;
export const OpenbotCodingSendInput = Schema.Struct({
  ...OpenbotCodingReference.fields,
  commandId: CommandId,
  text: TrimmedNonEmptyString.check(Schema.isMaxLength(200_000)),
});
export type OpenbotCodingSendInput = typeof OpenbotCodingSendInput.Type;
export const OpenbotCodingCancelInput = Schema.Struct({
  ...OpenbotCodingReference.fields,
  commandId: CommandId,
});
export type OpenbotCodingCancelInput = typeof OpenbotCodingCancelInput.Type;
export const OpenbotCodingListInput = Schema.Struct({
  hostId: ExternalId,
  agentId: ExternalId,
  taskId: Schema.optional(Schema.NullOr(ExternalId)),
});
export type OpenbotCodingListInput = typeof OpenbotCodingListInput.Type;
export const OpenbotCodingDeliveryStatus = Schema.Struct({
  state: Schema.Literals(["pending", "accepted", "reconciliation-required"]),
  firstAttemptAt: Schema.NullOr(IsoDateTime),
  acceptedAt: Schema.NullOr(IsoDateTime),
});
export type OpenbotCodingDeliveryStatus = typeof OpenbotCodingDeliveryStatus.Type;
export const OpenbotCodingTask = Schema.Struct({
  ...OpenbotCodingReference.fields,
  projectId: ProjectId,
  threadId: ThreadId,
  state: Schema.Union([Schema.Literals(["launch_pending", "idle"]), OrchestrationV2RunStatus]),
  runId: Schema.NullOr(RunId),
  cancelRequested: Schema.Boolean,
  pendingRequestIds: Schema.Array(RuntimeRequestId),
  result: Schema.NullOr(Schema.String),
  delivery: Schema.optional(OpenbotCodingDeliveryStatus),
  environmentId: Schema.optional(EnvironmentId),
  link: Schema.optional(Schema.String),
  pendingRequestCount: Schema.optional(NonNegativeInt),
  remoteState: Schema.optional(
    Schema.Literals([
      "following",
      "settled",
      "unavailable",
      "authorization-required",
      "reconciliation-required",
    ]),
  ),
});
export type OpenbotCodingTask = typeof OpenbotCodingTask.Type;
export const OpenbotCodingTaskList = Schema.Array(OpenbotCodingTask);
