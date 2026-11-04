import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";

const OpenbotTool = Tool.make("openbot", {
  description:
    "Manage persistent bots on this Sled environment. Use describe for request schemas, status for engine state, attention for pending decisions, read for history/tasks/memory/routines, write for messages/tasks, admin for configuration. start/stop control the engine. upstream.status/check/stage manage verified release archives without activation. Writes require full-access/default authority. Coding assignments use Sled coding threads.",
  parameters: Schema.Struct({
    action: Schema.Literals([
      "describe",
      "status",
      "attention",
      "attention.respond",
      "start",
      "stop",
      "read",
      "write",
      "admin",
      "upstream.status",
      "upstream.check",
      "upstream.stage",
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
    "Delegate a persistent bot's coding assignment to a real Sled thread. Use describe for request schemas. launch needs stable origin and operationId; retry the same request after uncertain delivery. get/list report actual execution, send follows up, cancel stops linked work. Writes require full-access/default authority. Origin is attribution, never an authorization grant.",
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

export const OpenbotToolkit = Toolkit.make(OpenbotTool, CodingTool);
