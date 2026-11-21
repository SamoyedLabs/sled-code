import * as Schema from "effect/Schema";
import { NonNegativeInt } from "./baseSchemas.ts";
import { OpenbotCodingLaunchInput } from "./openbotCoding.ts";

const Identity = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
export const OpenbotCodingPolicyScope = Schema.Struct({ hostId: Identity, agentId: Identity });
export type OpenbotCodingPolicyScope = typeof OpenbotCodingPolicyScope.Type;
export const OpenbotCodingPolicyDefaults = Schema.Struct({
  environmentId: OpenbotCodingLaunchInput.fields.environmentId,
  projectId: OpenbotCodingLaunchInput.fields.projectId,
  modelSelection: OpenbotCodingLaunchInput.fields.modelSelection,
  runtimeMode: OpenbotCodingLaunchInput.fields.runtimeMode,
  interactionMode: OpenbotCodingLaunchInput.fields.interactionMode,
  workspaceStrategy: OpenbotCodingLaunchInput.fields.workspaceStrategy,
});
export type OpenbotCodingPolicyDefaults = typeof OpenbotCodingPolicyDefaults.Type;
export const OpenbotCodingPolicyEnableInput = Schema.Struct({
  ...OpenbotCodingPolicyScope.fields,
  expectedRevision: NonNegativeInt,
  defaults: OpenbotCodingPolicyDefaults,
});
export type OpenbotCodingPolicyEnableInput = typeof OpenbotCodingPolicyEnableInput.Type;
export const OpenbotCodingPolicyDisableInput = Schema.Struct({
  ...OpenbotCodingPolicyScope.fields,
  expectedRevision: NonNegativeInt,
});
export type OpenbotCodingPolicyDisableInput = typeof OpenbotCodingPolicyDisableInput.Type;
export const OpenbotCodingPolicyState = Schema.Struct({
  ...OpenbotCodingPolicyScope.fields,
  revision: NonNegativeInt,
  status: Schema.Literals(["disabled", "enabled", "pending", "conflict"]),
  defaults: Schema.NullOr(OpenbotCodingPolicyDefaults),
  pending: Schema.NullOr(
    Schema.Struct({
      action: Schema.Literals(["enable", "disable"]),
      defaults: Schema.NullOr(OpenbotCodingPolicyDefaults),
    }),
  ),
  managedBlock: Schema.NullOr(Schema.String.check(Schema.isMaxLength(32000))),
});
export type OpenbotCodingPolicyState = typeof OpenbotCodingPolicyState.Type;
