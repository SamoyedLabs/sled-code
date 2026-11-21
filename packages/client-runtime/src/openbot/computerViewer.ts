import type { OpenbotComputerViewerGrant } from "@t3tools/contracts";
import type { DeviceHubAccess } from "../device/hubAccess.ts";
export function computerViewerUrl(
  access: DeviceHubAccess,
  grant: OpenbotComputerViewerGrant,
  hostId: string,
  now: number,
) {
  const url = new URL(access.httpBase);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith("/api/openbot/computer-view") ||
    grant.hostId !== hostId ||
    !/^[a-f0-9-]{36}$/.test(grant.id) ||
    !/^[a-f0-9]{64}$/.test(grant.ticket) ||
    !Number.isFinite(grant.expiresAt) ||
    grant.expiresAt <= now
  )
    throw new Error("Computer viewer unavailable");
  url.pathname += `/v1/remote-screen/sessions/${grant.id}/claim`;
  url.hash = grant.ticket;
  return url.href;
}
