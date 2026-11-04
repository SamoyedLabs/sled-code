import {
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
  OpenbotAttentionResponseInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Integration from "../../../openbot/Integration.ts";
import * as CodingBridge from "../../../openbot/CodingBridge.ts";
import * as UpstreamRuntime from "../../../openbot/UpstreamRuntime.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { OpenbotToolkit } from "./tools.ts";

const decodeRead = Schema.decodeUnknownEffect(OpenbotReadRequest);
const decodeWrite = Schema.decodeUnknownEffect(OpenbotWriteRequest);
const decodeAdmin = Schema.decodeUnknownEffect(OpenbotAdminRequest);
const decodeAttentionResponse = Schema.decodeUnknownEffect(OpenbotAttentionResponseInput);
const UpstreamCheckInput = Schema.Struct({ version: Schema.optional(OpenbotRuntimeVersion) });
const decodeUpstreamCheck = Schema.decodeUnknownEffect(UpstreamCheckInput);
const decodeUpstreamStage = Schema.decodeUnknownEffect(OpenbotUpstreamStageInput);
const description = {
  upstreamVersion: "0.60.0",
  read: Schema.toJsonSchemaDocument(OpenbotReadRequest),
  write: Schema.toJsonSchemaDocument(OpenbotWriteRequest),
  admin: Schema.toJsonSchemaDocument(OpenbotAdminRequest),
  "attention.respond": Schema.toJsonSchemaDocument(OpenbotAttentionResponseInput),
  "upstream.check": Schema.toJsonSchemaDocument(UpstreamCheckInput),
  "upstream.stage": Schema.toJsonSchemaDocument(OpenbotUpstreamStageInput),
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

export const layer = McpToolAccess.toLayer(OpenbotToolkit, {
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
        yield* check;
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
      }),
    ),
  ),
  openbot: McpToolAccess.either(
    (input) =>
      input.action === "describe" ||
      input.action === "status" ||
      input.action === "read" ||
      input.action === "attention" ||
      input.action === "upstream.status",
    McpToolAccess.reads((input) =>
      Effect.gen(function* () {
        if (input.action === "describe") return description;
        if (input.action === "upstream.status")
          return yield* (yield* upstream).getStatus.pipe(Effect.mapError(upstreamFailed));
        const service = yield* integration;
        if (input.action === "status") return yield* service.status;
        if (input.action === "attention") return yield* service.attentionSnapshot;
        return yield* service
          .apiRead(yield* decodeRead(input.request).pipe(Effect.mapError(invalidRequest)))
          .pipe(Effect.mapError(failed));
      }),
    ),
    McpToolAccess.writesEnvironment((input, check) =>
      Effect.gen(function* () {
        yield* check;
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
        const service = yield* integration;
        switch (input.action) {
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
              .pipe(Effect.mapError(failed));
          default:
            return yield* invalidRequest();
        }
      }),
    ),
  ),
});
