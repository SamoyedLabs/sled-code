import type { RemoteDesktopSession, ServerSummary } from "@openbot/contracts/ipc";
import { RemoteDesktopWorkspace } from "@openbot/ui/features/remote-desktop/RemoteDesktopWorkspace";
import { createStore, Show } from "solid-js";
import { z } from "zod";

const opened = z.object({
  id: z.string().uuid(),
  url: z.string().url(),
  capabilities: z.object({
    platform: z.enum(["darwin", "win32", "linux"]),
    selectedDisplayId: z.string().nullable(),
    displays: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        width: z.number(),
        height: z.number(),
        primary: z.boolean(),
      }),
    ),
  }),
});

export function createWorkspaceComputer(call: (method: string, args: unknown) => Promise<unknown>) {
  const [state, setState] = createStore<{
    server: ServerSummary | null;
    session: RemoteDesktopSession | undefined;
    platform: "darwin" | "win32" | "linux";
    connecting: boolean;
    error: string | null;
  }>({ server: null, session: undefined, platform: "darwin", connecting: false, error: null });
  let generation = 0;
  let lease: { id: string; hostId: string } | null = null;
  async function close() {
    generation++;
    const current = lease;
    if (current) await call("computer-close", current);
    if (lease === current) lease = null;
    setState((state) => {
      state.server = null;
      state.session = undefined;
      state.connecting = false;
      state.error = null;
    });
  }
  async function open(server: ServerSummary) {
    await close();
    const current = generation;
    setState((state) => {
      state.server = server;
      state.connecting = true;
      state.error = null;
    });
    try {
      const result = opened.parse(await call("computer-open", { hostId: server.id }));
      if (current !== generation) {
        await call("computer-close", { id: result.id, hostId: server.id });
        return;
      }
      lease = { id: result.id, hostId: server.id };
      const url = new URL(result.url);
      const viewerGrant = url.hash.slice(1);
      url.hash = "";
      setState((state) => {
        state.platform = result.capabilities.platform;
        state.connecting = false;
        state.session = {
          id: result.id,
          serverId: server.id,
          viewerUrl: url.href,
          viewerGrant,
          displays: result.capabilities.displays,
          selectedDisplayId: result.capabilities.selectedDisplayId,
          phase: "connecting",
          transport: "unknown",
          errorCode: null,
          message: null,
          createdAt: new Date().toISOString(),
          grantExpiresAt: new Date(Date.now() + 30_000).toISOString(),
        };
      });
    } catch (error) {
      if (current === generation)
        setState((state) => {
          state.connecting = false;
          state.error = error instanceof Error ? error.message : "Computer viewer unavailable";
        });
    }
  }
  function View() {
    return (
      <Show when={state.server}>
        {(server) => (
          <RemoteDesktopWorkspace
            visible={true}
            platform={state.platform}
            server={server()}
            session={state.session}
            connecting={state.connecting}
            connectionError={state.error}
            connectionErrorCode={null}
            onHide={() => {
              void close().catch((error) =>
                setState((state) => {
                  state.error = String(error);
                }),
              );
            }}
            onDisconnect={close}
            onRetry={() => open(server())}
            onSelectDisplay={async (hostId, displayId) => {
              await call("computer-display", { hostId, displayId });
              await open(server());
            }}
          />
        )}
      </Show>
    );
  }
  return { open, close, View };
}
