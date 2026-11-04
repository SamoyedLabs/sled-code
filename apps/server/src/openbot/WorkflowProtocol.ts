import {
  OpenbotWorkflowDetail,
  OpenbotWorkflowSummary,
  OpenbotWorkflowSaveResult,
  OpenbotWorkflowVersion,
  OpenbotWorkflowGraph,
  OpenbotWorkflowRunDetail,
  OpenbotWorkflowRunPage,
  OpenbotWorkflowStep,
  type OpenbotWorkflowReadRequest,
  type OpenbotWorkflowAdminRequest,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Effect from "effect/Effect";

type Request = OpenbotWorkflowReadRequest | OpenbotWorkflowAdminRequest;
export function isRequest(input: { readonly operation: string }): input is Request {
  return input.operation.startsWith("workflow.");
}
const paths: Readonly<Record<Request["operation"], string>> = {
  "workflow.list": "list",
  "workflow.get": "get",
  "workflow.create": "create",
  "workflow.rename": "rename",
  "workflow.delete": "delete",
  "workflow.saveGraph": "save-graph",
  "workflow.versions": "versions",
  "workflow.versionGraph": "version-graph",
  "workflow.restoreVersion": "restore-version",
  "workflow.startRun": "start-run",
  "workflow.runStep": "run-step",
  "workflow.stopStep": "stop-step",
  "workflow.stopRun": "stop-run",
  "workflow.retryStep": "retry-step",
  "workflow.decide": "decide",
  "workflow.runs": "runs",
  "workflow.run": "run",
};
export function route(request: Request) {
  const { operation, ...body } = request;
  return {
    method: "POST" as const,
    path: `/v1/workflows/${paths[operation]}`,
    body,
    workflowProjection: operation,
  };
}
const listing = Schema.decodeUnknownEffect(
  Schema.Struct({
    workflows: Schema.Array(OpenbotWorkflowSummary).check(Schema.isMaxLength(10_000)),
  }),
);
const publicDetail = (value: typeof OpenbotWorkflowDetail.Type) => ({
  ...value,
  triggers: value.triggers.map((trigger) => ({ ...trigger, webhookUrl: null })),
});
const decodeDetail = Schema.decodeUnknownEffect(OpenbotWorkflowDetail);
const detail = (value: unknown) => decodeDetail(value).pipe(Effect.map(publicDetail));
const summary = Schema.decodeUnknownEffect(OpenbotWorkflowSummary);
const decodeSave = Schema.decodeUnknownEffect(OpenbotWorkflowSaveResult);
const saved = (value: unknown) =>
  decodeSave(value).pipe(
    Effect.map((result) =>
      result.ok ? result : { ...result, conflict: publicDetail(result.conflict) },
    ),
  );
const versions = Schema.decodeUnknownEffect(
  Schema.Struct({ versions: Schema.Array(OpenbotWorkflowVersion).check(Schema.isMaxLength(100)) }),
);
const graph = Schema.decodeUnknownEffect(Schema.Struct({ graph: OpenbotWorkflowGraph }));
const run = Schema.decodeUnknownEffect(OpenbotWorkflowRunDetail);
const page = Schema.decodeUnknownEffect(OpenbotWorkflowRunPage);
const step = Schema.decodeUnknownEffect(OpenbotWorkflowStep);
const empty = Schema.decodeUnknownEffect(Schema.Struct({}));
export const project = Effect.fn("OpenbotWorkflowProtocol.project")((
  operation: Request["operation"],
  value: unknown,
) => {
  switch (operation) {
    case "workflow.list":
      return listing(value);
    case "workflow.get":
    case "workflow.create":
    case "workflow.restoreVersion":
      return detail(value);
    case "workflow.rename":
      return summary(value);
    case "workflow.saveGraph":
      return saved(value);
    case "workflow.versions":
      return versions(value);
    case "workflow.versionGraph":
      return graph(value);
    case "workflow.startRun":
    case "workflow.run":
      return run(value);
    case "workflow.runs":
      return page(value);
    case "workflow.runStep":
    case "workflow.retryStep":
      return step(value);
    default:
      return empty(value);
  }
});
