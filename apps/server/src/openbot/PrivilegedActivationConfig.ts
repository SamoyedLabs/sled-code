// @effect-diagnostics nodeBuiltinImport:off -- local retained-owner configuration boundary.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
export interface PrivilegedActivationIdentity {
  environmentId: string;
  hostId: string;
  profileDirectory: string;
}
/** Only a local owner-controlled file can authorize activation. No HTTP/WS input reaches this reader. */
export function readPrivilegedActivation(path: string | undefined, expected: PrivilegedActivationIdentity): boolean {
  if (!path || !NodePath.isAbsolute(path) || !process.getuid) return false;
  let fd: number | undefined;
  try {
    const parent = NodeFS.lstatSync(NodePath.dirname(path));
    if (!parent.isDirectory() || parent.uid !== process.getuid() || (parent.mode & 0o077) !== 0) return false;
    fd = NodeFS.openSync(path, NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW);
    const stat = NodeFS.fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.size > 4096) return false;
    const bytes = Buffer.alloc(4097);
    const length = NodeFS.readSync(fd, bytes, 0, bytes.length, 0);
    if (length > 4096) return false;
    const value = JSON.parse(bytes.subarray(0, length).toString("utf8"));
    return value !== null && typeof value === "object"
      && Object.keys(value).sort().join() === "capabilities,environmentId,hostId,profileDirectory,version"
      && value.version === 1 && value.environmentId === expected.environmentId
      && value.hostId === expected.hostId && value.profileDirectory === expected.profileDirectory
      && Array.isArray(value.capabilities) && value.capabilities.length === 2
      && value.capabilities[0] === "sled-privileged-responses-v1"
      && value.capabilities[1] === "sled-queue-attachments-v1";
  } catch { return false; }
  finally { if (fd !== undefined) NodeFS.closeSync(fd); }
}
