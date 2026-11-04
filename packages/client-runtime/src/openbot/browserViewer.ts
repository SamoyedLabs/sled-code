import type { OpenbotBrowserViewerGrant } from "@t3tools/contracts";
import { withDeviceHubQuery, type DeviceHubAccess } from "../device/hubAccess.ts";

type DrawFrame = { readonly uri: string; readonly sequence: number };
export class BrowserFrameDraw {
  #drawn: DrawFrame | undefined;
  #pending: DrawFrame | undefined;
  offer(frame: DrawFrame): boolean {
    if (this.#drawn?.uri === frame.uri) {
      this.#drawn = frame;
      this.#pending = undefined;
      return true;
    }
    this.#pending = frame;
    return false;
  }
  loaded(sequence: number): number | undefined {
    if (this.#pending?.sequence !== sequence) return;
    this.#drawn = this.#pending;
    this.#pending = undefined;
    return sequence;
  }
  reset() {
    this.#drawn = undefined;
    this.#pending = undefined;
  }
}

export function browserViewerConnection(
  access: DeviceHubAccess,
  grant: OpenbotBrowserViewerGrant,
  destination: { readonly hostId: string; readonly tabId: string },
  now: number,
) {
  if (
    grant.hostId !== destination.hostId ||
    grant.tabId !== destination.tabId ||
    !grant.id ||
    grant.id.length > 128 ||
    !/^[a-f0-9]{64}$/.test(grant.token) ||
    !Number.isFinite(grant.expiresAt) ||
    grant.expiresAt <= now
  )
    throw new Error("The browser viewer grant is unavailable for this tab.");
  const url = new URL(access.wsBase);
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    !url.pathname.endsWith("/api/openbot/browser-view") ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("The selected environment cannot open a browser viewer.");
  url.pathname += `/${encodeURIComponent(grant.hostId)}/${encodeURIComponent(grant.id)}`;
  return {
    url: withDeviceHubQuery(url.href, access),
    protocol: `sled-browser-view.${grant.token}`,
  };
}
