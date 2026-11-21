type StoragePort = Pick<Storage, "getItem" | "setItem">;
export type WorkspaceBotSelection = { hostId: string; agentId: string };
const key = (environmentId: string) => `sled:openbot:last-agent:v1:${environmentId}`;
export function readWorkspaceBot(
  environmentId: string,
  storage: StoragePort,
): WorkspaceBotSelection | null {
  try {
    const text = storage.getItem(key(environmentId));
    if (!text || text.length > 4096) return null;
    const value: unknown = JSON.parse(text);
    if (
      value &&
      typeof value === "object" &&
      "hostId" in value &&
      "agentId" in value &&
      typeof value.hostId === "string" &&
      typeof value.agentId === "string" &&
      value.hostId.length > 0 &&
      value.hostId.length <= 512 &&
      value.agentId.length > 0 &&
      value.agentId.length <= 512
    )
      return { hostId: value.hostId, agentId: value.agentId };
  } catch {
    /* Storage is optional for opening a conversation. */
  }
  return null;
}
export function retainWorkspaceBot(
  environmentId: string,
  selection: WorkspaceBotSelection,
  storage: StoragePort,
) {
  try {
    storage.setItem(key(environmentId), JSON.stringify(selection));
  } catch {
    /* Storage is optional for opening a conversation. */
  }
}
