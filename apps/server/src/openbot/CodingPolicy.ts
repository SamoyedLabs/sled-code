import {
  OpenbotCodingPolicyDefaults,
  OpenbotCodingPolicyScope,
  OpenbotCodingPolicyEnableInput,
  OpenbotCodingPolicyDisableInput,
  type OpenbotCodingPolicyState,
  Project,
  OrchestratorMcpCapabilitiesResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as SqlClient from "effect/sql/SqlClient";
import * as Integration from "./Integration.ts";
import * as SledTools from "./SledTools.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ProjectStore from "../orchestration-v2/ProjectStore.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as PeerLinks from "../peer/PeerLinks.ts";
import * as PeerMcpClient from "../peer/PeerMcpClient.ts";

export class CodingPolicyError extends Schema.TaggedError<CodingPolicyError>()(
  "OpenbotCodingPolicyError",
  {
    reason: Schema.Literals([
      "conflict",
      "stale-revision",
      "pending-operation",
      "storage",
      "upstream",
      "tools-unavailable",
      "destination",
      "too-large",
    ]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message() {
    return `Coding delegation policy could not complete (${this.reason}).`;
  }
}
export class CodingPolicy extends Context.Service<
  CodingPolicy,
  {
    readonly get: (
      scope: OpenbotCodingPolicyScope,
    ) => Effect.Effect<OpenbotCodingPolicyState, CodingPolicyError>;
    readonly enable: (
      input: OpenbotCodingPolicyEnableInput,
    ) => Effect.Effect<OpenbotCodingPolicyState, CodingPolicyError>;
    readonly disable: (
      input: OpenbotCodingPolicyDisableInput,
    ) => Effect.Effect<OpenbotCodingPolicyState, CodingPolicyError>;
  }
>()("t3/openbot/CodingPolicy") {}

const Instructions = Schema.Struct({
  fileName: Schema.Literals(["AGENTS.md", "CLAUDE.md"]),
  exists: Schema.Boolean,
  text: Schema.String,
});
const Pending = Schema.Struct({
  action: Schema.Literals(["enable", "disable"]),
  defaults: Schema.NullOr(OpenbotCodingPolicyDefaults),
  beforeBlock: Schema.NullOr(Schema.String),
  afterBlock: Schema.NullOr(Schema.String),
});
const decodeInstructions = Schema.decodeUnknownEffect(Instructions);
const decodeConfig = Schema.decodeUnknownEffect(Schema.fromJsonString(OpenbotCodingPolicyDefaults));
const encodeConfig = Schema.encodeEffect(Schema.fromJsonString(OpenbotCodingPolicyDefaults));
const decodePending = Schema.decodeUnknownEffect(Schema.fromJsonString(Pending));
const encodePending = Schema.encodeEffect(Schema.fromJsonString(Pending));
const encodeJson = Schema.encodeEffect(
  Schema.fromJsonString(Schema.Struct({ ...OpenbotCodingPolicyScope.fields, taskId: Schema.Null })),
);
const decodeScope = Schema.decodeUnknownEffect(OpenbotCodingPolicyScope);
const decodeEnable = Schema.decodeUnknownEffect(OpenbotCodingPolicyEnableInput);
const decodeDisable = Schema.decodeUnknownEffect(OpenbotCodingPolicyDisableInput);
const isPolicyError = Schema.is(CodingPolicyError);
const MARKER = "<!-- SLED-CODING-POLICY:";
interface Row {
  readonly host_id: string;
  readonly agent_id: string;
  readonly owner_id: string;
  readonly revision: number;
  readonly config_json: string | null;
  readonly managed_block: string | null;
  readonly pending_json: string | null;
}
const storageError = (cause: unknown) =>
  isPolicyError(cause) ? cause : new CodingPolicyError({ reason: "storage", cause });
const conflict = () => new CodingPolicyError({ reason: "conflict" });
function ownsExactly(text: string, block: string | null) {
  if (block === null) return !text.includes(MARKER);
  const index = text.indexOf(block);
  return (
    index !== -1 && !(text.slice(0, index) + text.slice(index + block.length)).includes(MARKER)
  );
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const integration = yield* Integration.Integration;
  const tools = yield* SledTools.SledTools;
  const identity = yield* ServerEnvironment.ServerEnvironment;
  const projects = yield* ProjectStore.ProjectStoreV2;
  const providers = yield* ProviderRegistry.ProviderRegistry;
  const links = yield* PeerLinks.PeerLinks;
  const peers = yield* PeerMcpClient.PeerMcpClient;
  const random = yield* SecureRandom.SecureRandom;
  const gate = yield* Semaphore.make(1);
  const load = Effect.fn("CodingPolicy.load")(function* (scope: OpenbotCodingPolicyScope) {
    return (
      (yield* sql<Row>`SELECT * FROM openbot_coding_policies WHERE host_id=${scope.hostId} AND agent_id=${scope.agentId}`).at(
        0,
      ) ?? null
    );
  }, Effect.mapError(storageError));
  const instructions = Effect.fn("CodingPolicy.instructions")(
    function* (scope: OpenbotCodingPolicyScope) {
      return yield* integration
        .apiAdminToHost(scope.hostId, {
          operation: "agent.instructions.read",
          agentId: scope.agentId,
        })
        .pipe(Effect.flatMap(decodeInstructions));
    },
    Effect.mapError((cause) => new CodingPolicyError({ reason: "upstream", cause })),
  );
  const view = Effect.fn("CodingPolicy.view")(function* (
    scope: OpenbotCodingPolicyScope,
    row: Row | null,
    status: OpenbotCodingPolicyState["status"],
  ) {
    const pending = row?.pending_json ? yield* decodePending(row.pending_json) : null;
    return {
      hostId: scope.hostId,
      agentId: scope.agentId,
      revision: row?.revision ?? 0,
      status,
      defaults: row?.config_json ? yield* decodeConfig(row.config_json) : null,
      pending: pending ? { action: pending.action, defaults: pending.defaults } : null,
      managedBlock: pending?.afterBlock ?? pending?.beforeBlock ?? row?.managed_block ?? null,
    } satisfies OpenbotCodingPolicyState;
  }, Effect.mapError(storageError));
  const finalize = Effect.fn("CodingPolicy.finalize")(function* (
    scope: OpenbotCodingPolicyScope,
    row: Row,
    pending: typeof Pending.Type,
  ) {
    const config = pending.defaults === null ? null : yield* encodeConfig(pending.defaults);
    const committed =
      yield* sql`UPDATE openbot_coding_policies SET config_json=${config}, managed_block=${pending.afterBlock}, pending_json=NULL, revision=revision+1
      WHERE host_id=${scope.hostId} AND agent_id=${scope.agentId} AND revision=${row.revision} AND pending_json=${row.pending_json} RETURNING host_id`;
    if (committed.length !== 1) return yield* new CodingPolicyError({ reason: "stale-revision" });
    return yield* load(scope);
  }, Effect.mapError(storageError));
  const observe = Effect.fn("CodingPolicy.observe")(function* (scope: OpenbotCodingPolicyScope) {
    const row = yield* load(scope);
    if (!row || (!row.config_json && !row.pending_json)) return yield* view(scope, row, "disabled");
    const current = yield* instructions(scope);
    if (row.pending_json) {
      const pending = yield* decodePending(row.pending_json).pipe(Effect.mapError(storageError));
      const applied =
        pending.afterBlock === null
          ? ownsExactly(current.text, null)
          : ownsExactly(current.text, pending.afterBlock);
      if (applied) {
        const completed = yield* finalize(scope, row, pending);
        return yield* view(scope, completed, pending.afterBlock === null ? "disabled" : "enabled");
      }
      return yield* view(
        scope,
        row,
        ownsExactly(current.text, pending.beforeBlock) ? "pending" : "conflict",
      );
    }
    return yield* view(
      scope,
      row,
      ownsExactly(current.text, row.managed_block) ? "enabled" : "conflict",
    );
  });
  const validate = Effect.fn("CodingPolicy.validate")(function* (
    scope: OpenbotCodingPolicyScope,
    input: OpenbotCodingPolicyDefaults,
  ) {
    const connected = yield* tools.status.pipe(
      Effect.mapError((cause) => new CodingPolicyError({ reason: "tools-unavailable", cause })),
    );
    if (
      connected.state !== "connected" ||
      connected.hostId !== scope.hostId ||
      connected.access !== "full-access"
    )
      return yield* new CodingPolicyError({ reason: "tools-unavailable" });
    const local = yield* identity.getEnvironmentId;
    if (input.environmentId === undefined || input.environmentId === local) {
      const project = yield* projects
        .get(input.projectId)
        .pipe(Effect.mapError((cause) => new CodingPolicyError({ reason: "destination", cause })));
      const provider = (yield* providers.getProviders).find(
        (row) => row.instanceId === input.modelSelection.instanceId,
      );
      if (
        Option.isNone(project) ||
        project.value.deletedAt !== null ||
        project.value.archivedAt !== null ||
        !provider ||
        !provider.enabled ||
        !provider.installed ||
        (input.interactionMode === "plan" && provider.showInteractionModeToggle !== true) ||
        (provider.status !== "ready" && provider.status !== "warning") ||
        !provider.models.some((model) => model.slug === input.modelSelection.model) ||
        (provider.supportedRuntimeModes?.length &&
          !provider.supportedRuntimeModes.includes(input.runtimeMode))
      )
        return yield* new CodingPolicyError({ reason: "destination" });
      const { environmentId: _environmentId, ...defaults } = input;
      return defaults;
    }
    const environmentId = input.environmentId;
    if (input.interactionMode !== "default")
      return yield* new CodingPolicyError({ reason: "destination" });
    if (!(yield* links.enabled)) return yield* new CodingPolicyError({ reason: "destination" });
    const link = yield* links
      .get(environmentId)
      .pipe(Effect.mapError((cause) => new CodingPolicyError({ reason: "destination", cause })));
    const now = yield* DateTime.now;
    if (
      Option.isNone(link) ||
      link.value.access !== "full-access" ||
      link.value.expiresAt.epochMilliseconds <= now.epochMilliseconds
    )
      return yield* new CodingPolicyError({ reason: "destination" });
    const limits = { runtimeMode: input.runtimeMode, interactionMode: input.interactionMode };
    yield* peers
      .call({
        environmentId,
        tool: "t3_project_read",
        arguments: { projectId: input.projectId },
        limits,
        success: Project,
      })
      .pipe(Effect.mapError((cause) => new CodingPolicyError({ reason: "destination", cause })));
    const capabilities = yield* peers
      .call({
        environmentId,
        tool: "orchestrator_capabilities",
        arguments: { search: input.modelSelection.model },
        limits,
        success: OrchestratorMcpCapabilitiesResult,
      })
      .pipe(Effect.mapError((cause) => new CodingPolicyError({ reason: "destination", cause })));
    const provider = capabilities.providers.find(
      (row) => row.providerInstanceId === input.modelSelection.instanceId,
    );
    if (
      !capabilities.features.threadManagement ||
      !provider ||
      !provider.models.some((model) => model.id === input.modelSelection.model) ||
      (provider.runtimeModes?.length && !provider.runtimeModes.includes(input.runtimeMode))
    )
      return yield* new CodingPolicyError({ reason: "destination" });
    return input;
  });
  const block = Effect.fn("CodingPolicy.block")(function* (
    scope: OpenbotCodingPolicyScope,
    ownerId: string,
    defaults: OpenbotCodingPolicyDefaults,
  ) {
    const config = yield* encodeConfig(defaults);
    const origin = yield* encodeJson({
      hostId: scope.hostId,
      agentId: scope.agentId,
      taskId: null,
    });
    return `\n\n${MARKER}${ownerId}:BEGIN -->\nSled coding delegation is enabled for this bot. Keep general tasks, browsing, reminders and scheduling in Openbot. Delegate repository changes, coding, pull requests, GitHub issue fixes and merge conflicts to Sled through the MCP tool named openbot_coding.\nCall openbot_coding with action describe to learn its current request schema. For launch, combine these defaults with a concise title, the user's complete coding assignment as prompt, and a stable operationId for this assignment:\n${config}\nUse this origin for the main Openbot conversation: ${origin}. Channel tasks have a separate identity and cannot delegate coding through the released interface yet. In a channel assignment, report this limitation to the user; do not reuse its channel task ID as a side-task ID or post results as a new channel message. Inside an Openbot side task, replace taskId:null with that actual Openbot side-task ID from your execution context. Never substitute a Sled thread ID or invent an Openbot task ID; if context is unavailable, ask for clarification.\nPersist the exact origin and operationId. Retry an uncertain launch with the same request and IDs; never start duplicate coding work. Use get/list to inspect actual progress, send for follow-up changes on the same task, and cancel to stop it. Accepted launch is not completion; report the returned coding result and route approvals/questions to the user.\nUse the selected destination, provider/model and permission defaults. If the user explicitly needs a different target or greater permission, ask them to update this policy or approve the change. This guidance grants no authority: existing Sled connection, destination and launch checks still apply. If tools or access are unavailable, explain the problem instead of silently performing coding work through another engine. Preserve all other user instructions and respect higher-priority instructions.\n${MARKER}${ownerId}:END -->`;
  }, Effect.mapError(storageError));
  const mutate = Effect.fn("CodingPolicy.mutate")(function* (
    scope: OpenbotCodingPolicyScope,
    expectedRevision: number,
    defaults: OpenbotCodingPolicyDefaults | null,
  ) {
    const action = defaults === null ? "disable" : "enable";
    let row = yield* load(scope);
    if (!row) {
      if (expectedRevision !== 0) return yield* new CodingPolicyError({ reason: "stale-revision" });
      const ownerId = yield* random.uuidV4().pipe(Effect.mapError(storageError));
      yield* sql`INSERT INTO openbot_coding_policies (host_id,agent_id,owner_id) VALUES (${scope.hostId},${scope.agentId},${ownerId}) ON CONFLICT(host_id,agent_id) DO NOTHING`.pipe(
        Effect.mapError(storageError),
      );
      row = yield* load(scope);
    }
    if (!row || row.revision !== expectedRevision)
      return yield* new CodingPolicyError({ reason: "stale-revision" });
    const config =
      defaults === null ? null : yield* encodeConfig(defaults).pipe(Effect.mapError(storageError));
    let pending = row.pending_json
      ? yield* decodePending(row.pending_json).pipe(Effect.mapError(storageError))
      : null;
    if (pending) {
      const desiredConfig =
        pending.defaults === null
          ? null
          : yield* encodeConfig(pending.defaults).pipe(Effect.mapError(storageError));
      if (pending.action !== action || desiredConfig !== config)
        return yield* new CodingPolicyError({ reason: "pending-operation" });
    } else if (config === row.config_json) {
      return yield* observe(scope);
    }
    const current = yield* instructions(scope);
    if (!pending) {
      if (!ownsExactly(current.text, row.managed_block)) return yield* conflict();
      const afterBlock = defaults === null ? null : yield* block(scope, row.owner_id, defaults);
      const text =
        row.managed_block === null
          ? current.text + (afterBlock ?? "")
          : current.text.replace(row.managed_block, afterBlock ?? "");
      if (text.length > 32000) return yield* new CodingPolicyError({ reason: "too-large" });
      pending = { action, defaults, beforeBlock: row.managed_block, afterBlock };
      const journal = yield* encodePending(pending).pipe(Effect.mapError(storageError));
      const claimed =
        yield* sql`UPDATE openbot_coding_policies SET pending_json=${journal} WHERE host_id=${scope.hostId} AND agent_id=${scope.agentId} AND revision=${expectedRevision} AND pending_json IS NULL RETURNING host_id`.pipe(
          Effect.mapError(storageError),
        );
      if (claimed.length !== 1) return yield* new CodingPolicyError({ reason: "stale-revision" });
      row = { ...row, pending_json: journal };
    }
    const alreadyApplied =
      pending.afterBlock === null
        ? ownsExactly(current.text, null)
        : ownsExactly(current.text, pending.afterBlock);
    if (!alreadyApplied) {
      if (!ownsExactly(current.text, pending.beforeBlock)) return yield* conflict();
      const text =
        pending.beforeBlock === null
          ? current.text + (pending.afterBlock ?? "")
          : current.text.replace(pending.beforeBlock, pending.afterBlock ?? "");
      if (text.length > 32000) return yield* new CodingPolicyError({ reason: "too-large" });
      const saved = yield* integration
        .apiAdminToHost(scope.hostId, {
          operation: "agent.instructions.save",
          agentId: scope.agentId,
          text,
          expected: current.text,
        })
        .pipe(Effect.flatMap(decodeInstructions), Effect.result);
      if (saved._tag === "Failure") {
        const observed = yield* instructions(scope);
        if (
          pending.afterBlock === null
            ? !ownsExactly(observed.text, null)
            : !ownsExactly(observed.text, pending.afterBlock)
        )
          return yield* conflict();
      } else if (saved.success.text !== text) return yield* conflict();
    }
    const completed = yield* finalize(scope, row, pending);
    return yield* view(scope, completed, action === "disable" ? "disabled" : "enabled");
  });
  const get = Effect.fn("CodingPolicy.get")(function* (input: OpenbotCodingPolicyScope) {
    return yield* observe(yield* decodeScope(input));
  }, Effect.mapError(storageError));
  const enable = Effect.fn("CodingPolicy.enable")(function* (
    input: OpenbotCodingPolicyEnableInput,
  ) {
    const decoded = yield* decodeEnable(input).pipe(
      Effect.mapError((cause) => new CodingPolicyError({ reason: "conflict", cause })),
    );
    const defaults = yield* validate(decoded, decoded.defaults);
    return yield* mutate(decoded, decoded.expectedRevision, defaults);
  }, Effect.mapError(storageError));
  const disable = Effect.fn("CodingPolicy.disable")(function* (
    input: OpenbotCodingPolicyDisableInput,
  ) {
    const decoded = yield* decodeDisable(input).pipe(
      Effect.mapError((cause) => new CodingPolicyError({ reason: "conflict", cause })),
    );
    return yield* mutate(decoded, decoded.expectedRevision, null);
  }, Effect.mapError(storageError));
  return {
    get: (input: OpenbotCodingPolicyScope) => gate.withPermit(get(input)),
    enable: (input: OpenbotCodingPolicyEnableInput) => gate.withPermit(enable(input)),
    disable: (input: OpenbotCodingPolicyDisableInput) => gate.withPermit(disable(input)),
  };
});
export const layer = Layer.effect(CodingPolicy, make);
