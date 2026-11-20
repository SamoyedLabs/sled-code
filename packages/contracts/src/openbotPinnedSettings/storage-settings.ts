import { storageRequest, storageResponse } from "./storage-v1.ts";
import type { OptionalRouteCodec } from "./admin-wire.ts";
export function storageSettingCodec(
  path: "/v1/storage/usage" | "/v1/storage/delete-file" | "/v1/storage/clear",
): OptionalRouteCodec {
  return {
    request: (value) => storageRequest(path, value),
    response(status, value) {
      const result = storageResponse(path, status, value);
      if (
        result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        Array.isArray(result.files)
      ) {
        return {
          ...result,
          files: result.files.map((file) =>
            file && typeof file === "object" && !Array.isArray(file)
              ? { ...file, previewUrl: null }
              : file,
          ),
        };
      }
      return result;
    },
  };
}
