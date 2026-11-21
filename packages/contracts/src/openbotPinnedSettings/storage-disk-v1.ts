// Adapted from pinned Openbot 0.60.0; see LICENSE.upstream.
// Frozen optional storage-disk-v1 wire contract: single statfs read (free/total bytes, no paths).
// Bounds stay literal and independent of IPC changes; widening needs a new capability string.
import {
  adminRoute,
  count,
  empty,
  fields,
  nullable,
  type OptionalRouteCodec,
} from "./admin-wire.ts";

export const STORAGE_DISK_CAPABILITY = "storage-disk-v1";
export const STORAGE_DISK_ROUTES = { disk: "/v1/storage/disk" } as const;

export const STORAGE_DISK_CODECS: ReadonlyMap<string, OptionalRouteCodec> = new Map([
  [
    STORAGE_DISK_ROUTES.disk,
    adminRoute(empty, fields({ freeBytes: nullable(count), totalBytes: nullable(count) })),
  ],
]);
