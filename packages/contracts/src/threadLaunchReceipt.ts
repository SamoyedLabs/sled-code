import * as Schema from "effect/Schema";
import { ProjectId, ThreadId } from "./baseSchemas.ts";

export const ThreadLaunchReceipt = Schema.Struct({
  state: Schema.Literals(["unknown", "pending", "accepted", "cancelled"]),
  threadId: Schema.NullOr(ThreadId),
  projectId: Schema.NullOr(ProjectId),
  cancelRequested: Schema.Boolean,
  stopState: Schema.NullOr(Schema.Literals(["not-needed", "pending", "requested"])),
});
export type ThreadLaunchReceipt = typeof ThreadLaunchReceipt.Type;
