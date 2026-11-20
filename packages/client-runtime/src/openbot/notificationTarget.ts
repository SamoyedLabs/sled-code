import { OpenbotRoutineRun } from "@t3tools/contracts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
const decode = Schema.decodeUnknownResult(Schema.Array(OpenbotRoutineRun));
export function notificationRoutineRuns(value: unknown, routineId: string, runId?: string) {
  const result = decode(value);
  return Result.isFailure(result)
    ? null
    : result.success.filter(
        (run) => run.routineId === routineId && (runId === undefined || run.id === runId),
      );
}
