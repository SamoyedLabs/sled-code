import {
  OpenbotCodingPolicyDefaults,
  OpenbotCodingPolicyState,
  type EnvironmentId,
  type ServerProvider,
  type RuntimeMode,
  type ProviderInteractionMode,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Result from "effect/Result";

const decodeState = Schema.decodeUnknownResult(OpenbotCodingPolicyState);
const decodeDefaults = Schema.decodeUnknownResult(OpenbotCodingPolicyDefaults);
export function botCodingPolicyView(value: unknown) {
  const result = decodeState(value);
  return Result.isSuccess(result) ? result.success : null;
}
export interface BotCodingPolicyChoice {
  destinationId: string;
  projectId: string;
  instanceId: string;
  model: string;
  runtimeMode: RuntimeMode;
  interactionMode: ProviderInteractionMode;
  workspaceMode: "root" | "worktree";
  baseRef: string;
}
export function botCodingPolicyChoice(
  origin: EnvironmentId,
  defaults: OpenbotCodingPolicyDefaults | null,
): BotCodingPolicyChoice {
  return {
    destinationId: defaults?.environmentId ?? origin,
    projectId: defaults?.projectId ?? "",
    instanceId: defaults?.modelSelection.instanceId ?? "",
    model: defaults?.modelSelection.model ?? "",
    runtimeMode: defaults?.runtimeMode ?? "approval-required",
    interactionMode: defaults?.interactionMode ?? "default",
    workspaceMode: defaults?.workspaceStrategy.type === "root" ? "root" : "worktree",
    baseRef:
      defaults?.workspaceStrategy.type === "worktree" ? defaults.workspaceStrategy.baseRef : "HEAD",
  };
}
export function botCodingPolicyDefaults(
  origin: EnvironmentId,
  choice: BotCodingPolicyChoice,
  catalog: {
    authorizedEnvironmentIds: ReadonlySet<EnvironmentId>;
    projects: readonly {
      id: string;
      environmentId: EnvironmentId;
      archivedAt?: string | null | undefined;
    }[];
    providers: readonly ServerProvider[];
  },
): OpenbotCodingPolicyDefaults | null {
  const destination = [...catalog.authorizedEnvironmentIds].find(
    (id) => id === choice.destinationId,
  );
  const project = catalog.projects.find(
    (row) => row.id === choice.projectId && row.environmentId === destination && !row.archivedAt,
  );
  const provider = catalog.providers.find(
    (row) =>
      row.instanceId === choice.instanceId &&
      row.enabled &&
      row.installed &&
      (row.status === "ready" || row.status === "warning"),
  );
  if (
    !destination ||
    !project ||
    !provider ||
    !provider.models.some((row) => row.slug === choice.model) ||
    (provider.supportedRuntimeModes?.length &&
      !provider.supportedRuntimeModes.includes(choice.runtimeMode))
  )
    return null;
  if (
    choice.interactionMode === "plan" &&
    (destination !== origin || provider.showInteractionModeToggle !== true)
  )
    return null;
  const decoded = decodeDefaults({
    ...(destination === origin ? {} : { environmentId: destination }),
    projectId: project.id,
    modelSelection: { instanceId: provider.instanceId, model: choice.model },
    runtimeMode: choice.runtimeMode,
    interactionMode: choice.interactionMode,
    workspaceStrategy:
      choice.workspaceMode === "root"
        ? { type: "root" }
        : { type: "worktree", baseRef: choice.baseRef.trim() },
  });
  return Result.isSuccess(decoded) ? decoded.success : null;
}
