import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";

const OpenbotTool = Tool.make("openbot", {
  description:
    "Manage persistent bots on this Sled environment. describe gives request schemas; status engine state; attention pending decisions; read history/tasks/memory/routines; write messages/tasks; admin configuration. start/stop control the engine. upstream.status/check/stage/install prepare verified releases; runtime.activate/rollback switch installed compatible releases. Writes need full-access/default authority. Coding assignments use Sled threads. maintenance.status/check/review/report/stage track upstream proposals; queued review is not completion. Policy and decisions belong to the user. Reports never certify compatibility.",
  parameters: Schema.Struct({
    action: Schema.Literals([
      "describe",
      "status",
      "attention",
      "attention.respond",
      "start",
      "stop",
      "read",
      "read.host",
      "write",
      "admin",
      "admin.host",
      "maintenance.status",
      "maintenance.check",
      "maintenance.review",
      "maintenance.report",
      "maintenance.stage",
      "upstream.status",
      "upstream.check",
      "upstream.stage",
      "upstream.install",
      "runtime.activate",
      "runtime.rollback",
    ]),
    request: Schema.optional(Schema.Unknown),
  }),
  success: Schema.Unknown,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
})
  .annotate(Tool.Title, "Manage persistent bots")
  .annotate(Tool.Destructive, true);

const CodingTool = Tool.make("openbot_coding", {
  description:
    "Delegate a bot's coding assignment to a real Sled thread. describe gives schemas. origin.taskId is null for main chat, otherwise the Openbot task ID. launch needs stable origin and operationId; retry the same request after uncertain delivery. get/list show execution, send follows up, cancel stops work. Writes need full-access/default authority. Origin is attribution, never a grant.",
  parameters: Schema.Struct({
    action: Schema.Literals(["describe", "launch", "get", "list", "send", "cancel"]),
    request: Schema.optional(Schema.Unknown),
  }),
  success: Schema.Unknown,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
})
  .annotate(Tool.Title, "Delegate bot coding work")
  .annotate(Tool.Destructive, true);

const FilesTool = Tool.make("openbot_files", {
  description:
    "Work with bot files. describe gives schemas; list/search find workspace and conversation/task files; download copies one to a Sled attachment. drafts lists uploads; upload uses a Sled pending attachment; send attaches its owned draft to main chat, an existing task, or a new task. Retry the same immutable send after uncertainty; inspect reconciliation-required instead of starting again. discard removes an unsent draft. Writes need full-access/default authority; requests bind host and agent.",
  parameters: Schema.Struct({
    action: Schema.Literals([
      "describe",
      "list",
      "search",
      "download",
      "drafts",
      "upload",
      "send",
      "discard",
    ]),
    request: Schema.optional(Schema.Unknown),
  }),
  success: Schema.Unknown,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
})
  .annotate(Tool.Title, "Work with bot files")
  .annotate(Tool.Destructive, true);

const CodingPolicyTool = Tool.make("openbot_coding_policy", {
  description:
    "Inspect or configure a bot's Sled coding delegation defaults. describe gives schemas; get shows current policy. enable installs reversible guidance for the selected machine/project/model without creating a grant; disable removes only unchanged owned guidance. Writes need full-access/default authority; existing Sled tools must already be connected. Preserve revision and resolve conflicts before retrying.",
  parameters: Schema.Struct({
    action: Schema.Literals(["describe", "get", "enable", "disable"]),
    request: Schema.optional(Schema.Unknown),
  }),
  success: Schema.Unknown,
  failure: OrchestratorMcpFailure,
  failureMode: "return",
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagement.ThreadManagementService,
  ],
})
  .annotate(Tool.Title, "Configure bot coding delegation")
  .annotate(Tool.Destructive, true);

export const OpenbotToolkit = Toolkit.make(OpenbotTool, CodingTool, FilesTool, CodingPolicyTool);
