// @effect-diagnostics nodeBuiltinImport:off -- Electron needs its native Keychain namespace synchronously, before its main loop starts.
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";

export function privateDesktopStorageName(profileDirectory: string | undefined) {
  if (!profileDirectory) return undefined;
  const suffix = NodeCrypto.createHash("sha256")
    .update(NodePath.resolve(profileDirectory))
    .digest("hex")
    .slice(0, 16);
  return `T3 Code Private ${suffix}`;
}
