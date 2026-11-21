import {
  decodeImportReceipt,
  importApplyBody,
  importDiscardBody,
  type ImportRequest,
} from "@t3tools/contracts/openbot-agent-import";
export function importRoute(request: Exclude<ImportRequest, { operation: "import.stage" }>) {
  switch (request.operation) {
    case "import.status":
      return { method: "POST" as const, path: "/v1/sled-agent-import/status", body: {} };
    case "import.apply":
      return {
        method: "POST" as const,
        path: "/v1/sled-agent-import/apply",
        body: importApplyBody(request),
      };
    case "import.discard":
      return {
        method: "POST" as const,
        path: "/v1/sled-agent-import/discard",
        body: importDiscardBody(request),
      };
  }
}
export function importStageRoute(requestId: string) {
  if (!requestId || requestId.length > 128) throw new Error("Invalid import request identity");
  return {
    method: "POST" as const,
    path: `/v1/sled-agent-import/stage?${new URLSearchParams({ requestId })}`,
    contentType: "application/zip",
    maxBytes: 104857600,
  };
}
export const projectImportReceipt = decodeImportReceipt;
