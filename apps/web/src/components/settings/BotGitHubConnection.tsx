import type { BotConnectionPanelProps as PanelProps } from "./useBotConnections";
import { confirmed, ExternalLink } from "./BotConnectionControls";
import { Button } from "../ui/button";

export function GitHubPanel({ controller: { state, run, busy }, allowed }: PanelProps) {
  const status = state.github;
  const disconnect = async () => {
    if (await confirmed("Disconnect GitHub from every bot on this host?"))
      await run([{ operation: "connector.github.disconnect" }]);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        The GitHub connection is shared by bots on this host.
      </p>
      <Button
        size="sm"
        variant="outline"
        disabled={!allowed || busy}
        onClick={() => void run([{ operation: "connector.github.status" }])}
      >
        Check GitHub connection
      </Button>
      {status && (
        <>
          <p className="text-sm">
            {status.state}
            {status.login ? ` · ${status.login}` : ""}
          </p>
          {!status.available ? (
            <p className="text-sm text-muted-foreground">This host has no GitHub App configured.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {status.state !== "connected" && (
                <Button
                  size="sm"
                  disabled={!allowed || busy || status.state === "pending"}
                  onClick={() => void run([{ operation: "connector.github.connect" }])}
                >
                  Connect GitHub
                </Button>
              )}
              {status.state === "pending" && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!allowed || busy}
                  onClick={() => void run([{ operation: "connector.github.cancel" }])}
                >
                  Cancel sign-in
                </Button>
              )}
              {status.state === "connected" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!allowed || busy}
                    onClick={() => void run([{ operation: "connector.github.repositories" }])}
                  >
                    Load repositories
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={!allowed || busy}
                    onClick={() => void disconnect()}
                  >
                    Disconnect GitHub
                  </Button>
                </>
              )}
            </div>
          )}
          {status.userCode && (
            <p className="text-sm">
              Enter code <code>{status.userCode}</code> on GitHub, then check the connection again.
            </p>
          )}
          <div className="flex flex-wrap gap-3">
            <ExternalLink disabled={!allowed || busy} address={status.verificationUri}>
              Open GitHub sign-in
            </ExternalLink>
            <ExternalLink disabled={!allowed || busy} address={status.installUrl}>
              Manage repository access
            </ExternalLink>
            <ExternalLink disabled={!allowed || busy} address={status.revokeUrl}>
              Manage GitHub authorization
            </ExternalLink>
          </div>
          {status.error && (
            <p role="alert" className="text-sm text-destructive">
              GitHub sign-in failed. Reconnect to try again.
            </p>
          )}
        </>
      )}
      {state.repositories && (
        <>
          <p className="text-sm">{state.repositories.total} accessible repositories</p>
          <ul className="space-y-1 text-sm">
            {state.repositories.repositories.map((row) => (
              <li key={row.fullName}>
                {row.fullName}
                {row.private ? " · Private" : ""}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
