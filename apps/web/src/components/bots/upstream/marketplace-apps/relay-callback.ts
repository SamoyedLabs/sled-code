// Source ipc-mcp-servers.ts: forward only the query; the host validates its retained flow.
export function relayCallbackQuery(address: string, state: string | null): string | null {
  try {
    const url = new URL(address.trim());
    const params = url.searchParams;
    if (!params.has("code") && !params.has("error")) return null;
    if (state !== null && params.get("state") !== state) return null;
    return url.search.slice(1);
  } catch {
    return null;
  }
}
