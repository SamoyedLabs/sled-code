import { OpenbotMaintenanceCommand } from "@t3tools/contracts";
import * as Maintenance from "../../../openbot/Maintenance.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import {
  AuthSessionId,
  OpenbotReadRequest,
  OpenbotWriteRequest,
  OpenbotAdminRequest,
  OrchestratorMcpFailure,
  OpenbotCodingLaunchInput,
  OpenbotCodingReference,
  OpenbotCodingListInput,
  OpenbotCodingSendInput,
  OpenbotCodingCancelInput,
  OpenbotRuntimeVersion,
  OpenbotUpstreamStageInput,
  OpenbotUpstreamInstallInput,
  OpenbotAttentionResponseInput,
  OpenbotHostAdminInput,
  OpenbotHostReadInput,
  OpenbotWorkspaceListInput,
  OpenbotConversationFileSearchInput,
  OpenbotFileMaterializeInput,
  OpenbotFileScope,
  OpenbotFileUploadInput,
  OpenbotFileSendInput,
  OpenbotFileDiscardInput,
  type OpenbotFilesError,
  OpenbotCodingPolicyScope,
  OpenbotCodingPolicyEnableInput,
  OpenbotCodingPolicyDisableInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Integration from "../../../openbot/Integration.ts";
import * as CodingBridge from "../../../openbot/CodingBridge.ts";
import * as RemoteCoding from "../../../openbot/RemoteCoding.ts";
import * as UpstreamRuntime from "../../../openbot/UpstreamRuntime.ts";
import * as Files from "../../../openbot/Files.ts";
import * as CodingPolicy from "../../../openbot/CodingPolicy.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { OpenbotToolkit } from "./tools.ts";

const decodeMaintenance = Schema.decodeUnknownEffect(OpenbotMaintenanceCommand);
const decodeRead = Schema.decodeUnknownEffect(OpenbotReadRequest);
const decodeWrite = Schema.decodeUnknownEffect(OpenbotWriteRequest);
const decodeAdmin = Schema.decodeUnknownEffect(OpenbotAdminRequest);
const decodeHostAdmin = Schema.decodeUnknownEffect(OpenbotHostAdminInput);
const decodeHostRead = Schema.decodeUnknownEffect(OpenbotHostReadInput);
const decodeAttentionResponse = Schema.decodeUnknownEffect(OpenbotAttentionResponseInput);
const UpstreamCheckInput = Schema.Struct({ version: Schema.optional(OpenbotRuntimeVersion) });
const decodeUpstreamCheck = Schema.decodeUnknownEffect(UpstreamCheckInput);
const decodeUpstreamStage = Schema.decodeUnknownEffect(OpenbotUpstreamStageInput);
const decodeUpstreamInstall = Schema.decodeUnknownEffect(OpenbotUpstreamInstallInput);
const description = {
  maintenance: Schema.toJsonSchemaDocument(OpenbotMaintenanceCommand),
  upstreamVersion: "0.60.0",
  read: Schema.toJsonSchemaDocument(OpenbotReadRequest),
  write: Schema.toJsonSchemaDocument(OpenbotWriteRequest),
  admin: Schema.toJsonSchemaDocument(OpenbotAdminRequest),
  "admin.host": Schema.toJsonSchemaDocument(OpenbotHostAdminInput),
  "read.host": Schema.toJsonSchemaDocument(OpenbotHostReadInput),
  "attention.respond": Schema.toJsonSchemaDocument(OpenbotAttentionResponseInput),
  "upstream.check": Schema.toJsonSchemaDocument(UpstreamCheckInput),
  "upstream.stage": Schema.toJsonSchemaDocument(OpenbotUpstreamStageInput),
  "upstream.install": Schema.toJsonSchemaDocument(OpenbotUpstreamInstallInput),
  "runtime.activate": Schema.toJsonSchemaDocument(OpenbotUpstreamInstallInput),
};
const integration = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(Integration.Integration);
  if (Option.isNone(service)) {
    return yield* new OrchestratorMcpFailure({
      code: "orchestration_error",
      message: "Openbot is unavailable on this environment.",
    });
  }
  return service.value;
});
const invalidRequest = () =>
  new OrchestratorMcpFailure({
    code: "invalid_request",
    message: "The Openbot request does not match its action. Use describe for request schemas.",
  });
const failed = (error: Integration.IntegrationError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
const decodeLaunch = Schema.decodeUnknownEffect(OpenbotCodingLaunchInput);
const decodeReference = Schema.decodeUnknownEffect(OpenbotCodingReference);
const decodeList = Schema.decodeUnknownEffect(OpenbotCodingListInput);
const decodeSend = Schema.decodeUnknownEffect(OpenbotCodingSendInput);
const decodeCancel = Schema.decodeUnknownEffect(OpenbotCodingCancelInput);
const codingDescription = {
  launch: Schema.toJsonSchemaDocument(OpenbotCodingLaunchInput),
  get: Schema.toJsonSchemaDocument(OpenbotCodingReference),
  list: Schema.toJsonSchemaDocument(OpenbotCodingListInput),
  send: Schema.toJsonSchemaDocument(OpenbotCodingSendInput),
  cancel: Schema.toJsonSchemaDocument(OpenbotCodingCancelInput),
};
const bridge = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(CodingBridge.CodingBridge);
  if (Option.isNone(service))
    return yield* new OrchestratorMcpFailure({
      code: "orchestration_error",
      message: "The coding bridge is unavailable on this environment.",
    });
  return service.value;
});
const codingFailed = (error: CodingBridge.CodingBridgeError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
const upstream = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(UpstreamRuntime.UpstreamRuntime);
  if (Option.isNone(service))
    return yield* new OrchestratorMcpFailure({
      code: "orchestration_error",
      message: "Openbot release staging is unavailable on this environment.",
    });
  return service.value;
});
const upstreamFailed = (error: UpstreamRuntime.UpstreamRuntimeError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
const decodeFileList = Schema.decodeUnknownEffect(OpenbotWorkspaceListInput);
const decodeFileSearch = Schema.decodeUnknownEffect(OpenbotConversationFileSearchInput);
const decodeFileDownload = Schema.decodeUnknownEffect(OpenbotFileMaterializeInput);
const decodeFileDrafts = Schema.decodeUnknownEffect(OpenbotFileScope);
const decodeFileUpload = Schema.decodeUnknownEffect(OpenbotFileUploadInput);
const decodeFileSend = Schema.decodeUnknownEffect(OpenbotFileSendInput);
const decodeFileDiscard = Schema.decodeUnknownEffect(OpenbotFileDiscardInput);
const fileDescription = {
  delivery: {
    messageId: "Queued-message receipt ID, not a conversation entry or attachment ID.",
    conversationMessageId:
      "Use this exact entry ID as download source.messageId with committedAttachments[].id. The original attachment.id remains an upload draft ID.",
    committedAttachments:
      "Null means unresolved. Repeating send with the saved text and target on a sent row with a known conversationMessageId refreshes metadata without resending.",
    newTask:
      "An uncertain new-task start requires manual reconciliation; released public reads cannot identify its operation safely.",
  },
  list: Schema.toJsonSchemaDocument(OpenbotWorkspaceListInput),
  search: Schema.toJsonSchemaDocument(OpenbotConversationFileSearchInput),
  download: Schema.toJsonSchemaDocument(OpenbotFileMaterializeInput),
  drafts: Schema.toJsonSchemaDocument(OpenbotFileScope),
  upload: Schema.toJsonSchemaDocument(OpenbotFileUploadInput),
  send: Schema.toJsonSchemaDocument(OpenbotFileSendInput),
  discard: Schema.toJsonSchemaDocument(OpenbotFileDiscardInput),
};
const files = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(Files.Files);
  if (Option.isNone(service))
    return yield* new OrchestratorMcpFailure({
      code: "orchestration_error",
      message: "Bot files are unavailable on this environment.",
    });
  return service.value;
});
const fileFailed = (error: OpenbotFilesError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });
const decodePolicyScope = Schema.decodeUnknownEffect(OpenbotCodingPolicyScope);
const decodePolicyEnable = Schema.decodeUnknownEffect(OpenbotCodingPolicyEnableInput);
const decodePolicyDisable = Schema.decodeUnknownEffect(OpenbotCodingPolicyDisableInput);
const policyDescription = {
  get: Schema.toJsonSchemaDocument(OpenbotCodingPolicyScope),
  enable: Schema.toJsonSchemaDocument(OpenbotCodingPolicyEnableInput),
  disable: Schema.toJsonSchemaDocument(OpenbotCodingPolicyDisableInput),
};
const codingPolicy = Effect.gen(function* () {
  const service = yield* Effect.serviceOption(CodingPolicy.CodingPolicy);
  if (Option.isNone(service))
    return yield* new OrchestratorMcpFailure({
      code: "orchestration_error",
      message: "Bot coding policy is unavailable.",
    });
  return service.value;
});
const policyFailed = (error: CodingPolicy.CodingPolicyError) =>
  new OrchestratorMcpFailure({ code: "orchestration_error", message: error.message });

export const layer = McpToolAccess.toLayer(OpenbotToolkit, {
  openbot_coding_policy: McpToolAccess.either(
    (input) => input.action === "describe" || input.action === "get",
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        if (input.action === "describe") return policyDescription;
        const service = yield* codingPolicy;
        return yield* service
          .get(yield* decodePolicyScope(input.request).pipe(Effect.mapError(invalidRequest)))
          .pipe(Effect.mapError(policyFailed));
      }),
    ),
    McpToolAccess.writesEnvironment((input, check) =>
      Effect.gen(function* () {
        yield* check;
        const service = yield* codingPolicy;
        switch (input.action) {
          case "enable":
            return yield* service
              .enable(
                yield* decodePolicyEnable(input.request).pipe(Effect.mapError(invalidRequest)),
              )
              .pipe(Effect.mapError(policyFailed));
          case "disable":
            return yield* service
              .disable(
                yield* decodePolicyDisable(input.request).pipe(Effect.mapError(invalidRequest)),
              )
              .pipe(Effect.mapError(policyFailed));
          default:
            return yield* invalidRequest();
        }
      }),
    ),
  ),
  openbot_files: McpToolAccess.either(
    (input) =>
      input.action === "describe" ||
      input.action === "list" ||
      input.action === "search" ||
      input.action === "download" ||
      input.action === "drafts",
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        if (input.action === "describe") return fileDescription;
        const service = yield* files;
        switch (input.action) {
          case "list":
            return yield* service
              .listWorkspace(
                yield* decodeFileList(input.request).pipe(Effect.mapError(invalidRequest)),
              )
              .pipe(Effect.mapError(fileFailed));
          case "search":
            return yield* service
              .search(yield* decodeFileSearch(input.request).pipe(Effect.mapError(invalidRequest)))
              .pipe(Effect.mapError(fileFailed));
          case "download":
            return yield* service
              .materialize(
                yield* decodeFileDownload(input.request).pipe(Effect.mapError(invalidRequest)),
              )
              .pipe(Effect.mapError(fileFailed));
          case "drafts":
            return yield* service
              .listDrafts(
                yield* decodeFileDrafts(input.request).pipe(Effect.mapError(invalidRequest)),
              )
              .pipe(Effect.mapError(fileFailed));
          default:
            return yield* invalidRequest();
        }
      }),
    ),
    McpToolAccess.writesEnvironment((input, check) =>
      Effect.gen(function* () {
        yield* check;
        const service = yield* files;
        switch (input.action) {
          case "upload":
            return yield* service
              .uploadDraft(
                yield* decodeFileUpload(input.request).pipe(Effect.mapError(invalidRequest)),
              )
              .pipe(Effect.mapError(fileFailed));
          case "send":
            return yield* service
              .sendDraft(yield* decodeFileSend(input.request).pipe(Effect.mapError(invalidRequest)))
              .pipe(Effect.mapError(fileFailed));
          case "discard":
            return yield* service
              .discardDraft(
                yield* decodeFileDiscard(input.request).pipe(Effect.mapError(invalidRequest)),
              )
              .pipe(Effect.as({ discarded: true }), Effect.mapError(fileFailed));
          default:
            return yield* invalidRequest();
        }
      }),
    ),
  ),
  openbot_coding: McpToolAccess.either(
    (input) => input.action === "describe" || input.action === "get" || input.action === "list",
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        if (input.action === "describe") return codingDescription;
        const service = yield* bridge;
        return yield* input.action === "get"
          ? service
              .get(yield* decodeReference(input.request).pipe(Effect.mapError(invalidRequest)))
              .pipe(Effect.mapError(codingFailed))
          : service
              .list(yield* decodeList(input.request).pipe(Effect.mapError(invalidRequest)))
              .pipe(Effect.mapError(codingFailed));
      }),
    ),
    McpToolAccess.writesEnvironment((input, check) =>
      Effect.gen(function* () {
        const service = yield* bridge;
        const caller = yield* check;
        const authority: RemoteCoding.Authority | undefined =
          caller.scope.thread !== undefined
            ? {
                kind: "thread",
                threadId: caller.scope.thread.threadId,
                providerInstanceId: caller.scope.thread.providerInstanceId,
                limits: caller.limits,
              }
            : caller.scope.client !== undefined
              ? {
                  kind: "session",
                  sessionId: AuthSessionId.make(caller.scope.client.sessionId),
                  linked: caller.scope.client.linked,
                  limits: caller.limits,
                }
              : undefined;
        return yield* Effect.gen(function* () {
          switch (input.action) {
            case "launch":
              return yield* service
                .launch(yield* decodeLaunch(input.request).pipe(Effect.mapError(invalidRequest)))
                .pipe(Effect.mapError(codingFailed));
            case "send":
              return yield* service
                .send(yield* decodeSend(input.request).pipe(Effect.mapError(invalidRequest)))
                .pipe(Effect.mapError(codingFailed));
            case "cancel":
              return yield* service
                .cancel(yield* decodeCancel(input.request).pipe(Effect.mapError(invalidRequest)))
                .pipe(Effect.mapError(codingFailed));
            default:
              return yield* invalidRequest();
          }
        }).pipe(Effect.provideService(RemoteCoding.Caller, authority));
      }),
    ),
  ),
  openbot: McpToolAccess.either(
    (input) =>
      input.action === "describe" ||
      input.action === "status" ||
      input.action === "read" ||
      input.action === "read.host" ||
      input.action === "attention" ||
      input.action === "upstream.status" ||
      input.action === "maintenance.status" ||
      input.action === "maintenance.report",
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        if (input.action === "describe") return description;
        if (input.action === "maintenance.status" || input.action === "maintenance.report") {
          const service = yield* Effect.serviceOption(Maintenance.Maintenance);
          if (Option.isNone(service)) return yield* invalidRequest();
          if (input.action === "maintenance.status")
            return yield* service.value.get.pipe(
              Effect.mapError(
                (e) =>
                  new OrchestratorMcpFailure({ code: "orchestration_error", message: e.message }),
              ),
            );
          const command = yield* decodeMaintenance(input.request).pipe(
            Effect.mapError(invalidRequest),
          );
          // Plan-mode reviewers may record their own report; this grants no environment action or decision authority.
          const caller = yield* Invocation.McpInvocationContext;
          if (
            command.action !== "report" ||
            !caller.thread ||
            caller.client ||
            caller.thread.threadId !== command.threadId
          )
            return yield* invalidRequest();
          return yield* service.value
            .execute(command)
            .pipe(
              Effect.mapError(
                (e) =>
                  new OrchestratorMcpFailure({ code: "orchestration_error", message: e.message }),
              ),
            );
        }

        if (input.action === "upstream.status")
          return yield* (yield* upstream).getStatus.pipe(Effect.mapError(upstreamFailed));
        const service = yield* integration;
        if (input.action === "status") return yield* service.status;
        if (input.action === "attention") return yield* service.attentionSnapshot;
        if (input.action === "read.host") {
          const request = yield* decodeHostRead(input.request).pipe(
            Effect.mapError(invalidRequest),
          );
          return yield* service
            .apiReadToHost(request.hostId, request.request)
            .pipe(Effect.mapError(failed));
        }
        return yield* service
          .apiRead(yield* decodeRead(input.request).pipe(Effect.mapError(invalidRequest)))
          .pipe(Effect.mapError(failed));
      }),
    ),
    McpToolAccess.writesEnvironment((input, check) =>
      Effect.gen(function* () {
        const checkedCaller = yield* check;
        const channelAuthority: RemoteCoding.Authority | undefined =
          checkedCaller.scope.client !== undefined && checkedCaller.scope.thread === undefined
            ? {
                kind: "session",
                sessionId: AuthSessionId.make(checkedCaller.scope.client.sessionId),
                linked: checkedCaller.scope.client.linked,
                limits: checkedCaller.limits,
              }
            : undefined;
        if (input.action.startsWith("maintenance.")) {
          const command = yield* decodeMaintenance(input.request ?? { action: "check" }).pipe(
            Effect.mapError(invalidRequest),
          );
          if (
            !["check", "review", "stage"].includes(command.action) ||
            input.action !== `maintenance.${command.action}`
          )
            return yield* invalidRequest();
          const service = yield* Effect.serviceOption(Maintenance.Maintenance);
          if (Option.isNone(service)) return yield* invalidRequest();
          return yield* service.value
            .execute(command)
            .pipe(
              Effect.mapError(
                (e) =>
                  new OrchestratorMcpFailure({ code: "orchestration_error", message: e.message }),
              ),
            );
        }
        if (input.action === "upstream.check") {
          const service = yield* upstream;
          const request = yield* decodeUpstreamCheck(input.request ?? {}).pipe(
            Effect.mapError(invalidRequest),
          );
          return yield* (
            request.version === undefined
              ? service.checkLatest
              : service.checkVersion(request.version)
          ).pipe(Effect.mapError(upstreamFailed));
        }
        if (input.action === "upstream.stage")
          return yield* (yield* upstream)
            .stage(yield* decodeUpstreamStage(input.request).pipe(Effect.mapError(invalidRequest)))
            .pipe(Effect.mapError(upstreamFailed));
        if (input.action === "upstream.install")
          return yield* (yield* upstream)
            .install(
              yield* decodeUpstreamInstall(input.request).pipe(Effect.mapError(invalidRequest)),
            )
            .pipe(Effect.mapError(upstreamFailed));
        const service = yield* integration;
        switch (input.action) {
          case "runtime.activate":
            return yield* service
              .activateRuntime(
                yield* decodeUpstreamInstall(input.request).pipe(Effect.mapError(invalidRequest)),
              )
              .pipe(Effect.mapError(failed));
          case "runtime.rollback":
            return yield* service.rollbackRuntime.pipe(Effect.mapError(failed));
          case "attention.respond": {
            const request = yield* decodeAttentionResponse(input.request).pipe(
              Effect.mapError(invalidRequest),
            );
            return yield* service
              .apiAdminToHost(request.hostId, request.request)
              .pipe(Effect.mapError(failed));
          }
          case "start":
            return yield* service.start.pipe(Effect.mapError(failed));
          case "stop":
            return yield* service.stop.pipe(Effect.mapError(failed));
          case "write":
            return yield* service
              .apiWrite(yield* decodeWrite(input.request).pipe(Effect.mapError(invalidRequest)))
              .pipe(Effect.mapError(failed));
          case "admin":
            return yield* service
              .apiAdmin(yield* decodeAdmin(input.request).pipe(Effect.mapError(invalidRequest)))
              .pipe(
                Effect.provideService(RemoteCoding.Caller, channelAuthority),
                Effect.mapError(failed),
              );
          case "admin.host": {
            const request = yield* decodeHostAdmin(input.request).pipe(
              Effect.mapError(invalidRequest),
            );
            return yield* service
              .apiAdminToHost(request.hostId, request.request)
              .pipe(
                Effect.provideService(RemoteCoding.Caller, channelAuthority),
                Effect.mapError(failed),
              );
          }
          default:
            return yield* invalidRequest();
        }
      }),
    ),
  ),
});
