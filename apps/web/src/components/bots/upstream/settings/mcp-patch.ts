import * as Schema from "effect/Schema";
import { OpenbotMcpPatch } from "@t3tools/contracts";
import { normalizeMcpConfig, type McpServerConfig } from "./mcp-model";
const decodePatch = Schema.decodeUnknownSync(OpenbotMcpPatch);
export function retainedMcpPatch(config: McpServerConfig, baseline: McpServerConfig) {
  const normalized = normalizeMcpConfig(config),
    old = normalizeMcpConfig(baseline);
  const { id: _id, retained: _retained, ...fields } = normalized;
  return decodePatch(
    Object.fromEntries(
      Object.entries(fields).filter(([field, value]) => {
        if (
          (field === "args" || field === "env" || field === "headers") &&
          config.retained?.[field] !== undefined
        )
          return false;
        return (
          JSON.stringify(value) !== JSON.stringify(old[field as keyof typeof old]) ||
          ((field === "args" || field === "env" || field === "headers") &&
            baseline.retained?.[field] !== undefined)
        );
      }),
    ),
  );
}
