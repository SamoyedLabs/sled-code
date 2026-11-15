import { DeviceOperationError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import type { DeviceHostReady, DeviceOpenContext } from "./DeviceHost.ts";
import { simulatorMemoryScript } from "./simulatorMemoryScript.ts";

const Result = Schema.Struct({
  ok: Schema.Boolean,
  reason: Schema.optional(Schema.Literals(["install_failed", "reboot_required", "command_failed"])),
});
const decodeResult = Schema.decodeUnknownEffect(Schema.fromJsonString(Result));

export const makeSimulatorMemory = (options: {
  readonly run: DeviceHostReady["run"];
  readonly nodePath: string;
  readonly baseDir: string | null;
}) =>
  Effect.fn("SimulatorMemory.prepare")(function* (deviceId: string, context?: DeviceOpenContext) {
    if (context?.reduceSimulatorMemory === undefined) return;
    const result = yield* options.run(
      options.nodePath,
      [
        "-e",
        simulatorMemoryScript({
          baseDir: options.baseDir,
          deviceId,
          enabled: context.reduceSimulatorMemory,
          ...(context.fullServices === undefined ? {} : { fullServices: context.fullServices }),
        }),
      ],
      { timeoutMs: 1_300_000 },
    );
    const output = yield* decodeResult(result.stdout).pipe(
      Effect.mapError(
        (cause) =>
          new DeviceOperationError({
            operation: "prepare simulator services",
            reason: "command_failed",
            exitCode: result.code,
            cause,
          }),
      ),
    );
    if (result.code !== 0 || !output.ok) {
      return yield* new DeviceOperationError({
        operation: "prepare simulator services",
        reason:
          output.reason === "reboot_required"
            ? "simulator_reboot_required"
            : output.reason === "install_failed"
              ? "simulator_install_failed"
              : "command_failed",
        exitCode: result.code,
        cause: result,
      });
    }
  });
