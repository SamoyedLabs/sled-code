// Exact start-run codec excerpt from Openbot 0.60.0 workflows-v1; see LICENSE.upstream.
import { isString } from "./runtime-values.ts";
import {
  type AdminDecoder,
  adminRoute,
  fields,
  identifier,
  list,
  nullable,
  oneOf,
  string,
} from "./admin-wire.ts";
export const WORKFLOWS_ROUTES = { startRun: "/v1/workflows/start-run" } as const;
const timestamp = string(64);
const stepText = string(32_000);
const WORKFLOW_RUN_STEP_LIMIT = 2_000;
const token: AdminDecoder = (value) => {
  if (!isString(value) || !/^[a-z][a-z0-9-]{0,31}$/u.test(value))
    throw new Error("Invalid workflow value.");
  return value;
};
/** A whole number from 1, such as a run number, an attempt or a page size. */
const ordinal =
  (maximum: number): AdminDecoder =>
  (value) => {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > maximum)
      throw new Error("Invalid workflow number.");
    return value;
  };

const runStatus = token;
const run = fields({
  id: identifier,
  workflowId: identifier,
  number: ordinal(Number.MAX_SAFE_INTEGER),
  triggerNodeId: nullable(identifier),
  source: token,
  status: runStatus,
  error: nullable(stepText),
  startedAt: timestamp,
  endedAt: nullable(timestamp),
});
const step = fields({
  id: identifier,
  workflowId: identifier,
  runId: nullable(identifier),
  nodeId: identifier,
  attempt: ordinal(Number.MAX_SAFE_INTEGER),
  agentId: nullable(identifier),
  status: token,
  output: nullable(stepText),
  branch: nullable(oneOf("yes", "no")),
  error: nullable(stepText),
  startedAt: nullable(timestamp),
  endedAt: nullable(timestamp),
});
const runDetail = fields({ run, steps: list(step, WORKFLOW_RUN_STEP_LIMIT) });

export const WORKFLOWS_CODECS = new Map([
  [
    WORKFLOWS_ROUTES.startRun,
    adminRoute(
      fields({ workflowId: identifier, requestId: identifier }, { fromNodeId: identifier }),
      runDetail,
    ),
  ],
]);
