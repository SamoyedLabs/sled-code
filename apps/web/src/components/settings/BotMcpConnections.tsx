import { useState } from "react";
import type { OpenbotAdminRequest } from "@t3tools/contracts";
import {
  botMcpRequest,
  botMcpPatchRequest,
  EMPTY_BOT_MCP_DRAFT,
  type BotMcpDraft,
} from "@t3tools/client-runtime/openbot/presentation";
import type { BotConnectionPanelProps as PanelProps } from "./useBotConnections";
import { confirmed } from "./BotConnectionControls";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

export function McpPanel({ controller: { state, run, busy, setError }, allowed }: PanelProps) {
  const [draft, setDraft] = useState<BotMcpDraft | null>(null);
  const [editing, setEditing] = useState<{ id: string; patch: string } | null>(null);
  const savePatch = async () => {
    if (!editing) return;
    const request = botMcpPatchRequest(editing.id, editing.patch);
    if (!request) {
      setError("Enter a JSON object containing MCP configuration fields to replace.");
      return;
    }
    setEditing(null);
    await run([request]);
  };
  const update = (key: keyof BotMcpDraft, value: string) => {
    if (draft && key !== "transport") setDraft({ ...draft, [key]: value });
  };
  const save = async (test: boolean) => {
    if (!draft) return;
    const request = botMcpRequest(draft);
    if (!request || request.operation !== "mcp.save") {
      setError(
        "Enter a name and address or command, a JSON argument array, and JSON objects for environment variables and headers.",
      );
      return;
    }
    setDraft(null);
    await run(test ? [{ operation: "mcp.test", config: request.config }] : [request]);
  };
  const remove = async (id: string) => {
    if (
      !(await confirmed(
        "Delete this MCP server connection? Its saved configuration will be removed.",
      ))
    )
      return;
    const requests: OpenbotAdminRequest[] =
      state.activeMcpId === id ? [{ operation: "mcp.signIn.cancelById", mcpServerId: id }] : [];
    await run([...requests, { operation: "mcp.delete", mcpServerId: id }]);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Connect tools on this host. Saved credentials stay on the host.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!allowed || busy}
          onClick={() => void run([{ operation: "mcp.list" }, { operation: "mcp.signIn.list" }])}
        >
          Load MCP servers
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!allowed || busy}
          onClick={() => setDraft({ ...EMPTY_BOT_MCP_DRAFT })}
        >
          Add MCP server
        </Button>
      </div>
      {state.mcps?.length === 0 && (
        <p className="text-sm text-muted-foreground">No MCP servers connected.</p>
      )}
      {state.mcps?.map((row) => (
        <div key={row.id} className="space-y-2 border-t pt-3">
          <p className="text-sm font-medium">
            {row.name} · {row.enabled ? "Enabled" : "Disabled"}
          </p>
          <p className="break-all text-sm text-muted-foreground">
            {row.transport === "http" ? row.url : "Command on this host"}
            {state.signIns?.find((signIn) => signIn.mcpServerId === row.id)?.signedIn
              ? " · Signed in"
              : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!allowed || busy}
              onClick={() => setEditing({ id: row.id, patch: "{}" })}
            >
              Edit configuration
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!allowed || busy}
              onClick={() =>
                void run([{ operation: "mcp.toggle", mcpServerId: row.id, enabled: !row.enabled }])
              }
            >
              {row.enabled ? "Disable" : "Enable"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!allowed || busy}
              onClick={() => void run([{ operation: "mcp.testById", mcpServerId: row.id }])}
            >
              Test connection
            </Button>
            {row.transport === "http" && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!allowed || busy}
                  onClick={() =>
                    void run([{ operation: "mcp.signIn.startById", mcpServerId: row.id }])
                  }
                >
                  Sign in on host
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!allowed || busy}
                  onClick={() =>
                    void run([
                      { operation: "mcp.signIn.statusById", mcpServerId: row.id },
                      { operation: "mcp.signIn.list" },
                    ])
                  }
                >
                  Check sign-in
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!allowed || busy}
                  onClick={() => void run([{ operation: "mcp.signOut", mcpServerId: row.id }])}
                >
                  Sign out
                </Button>
              </>
            )}
            {state.activeMcpId === row.id && (
              <Button
                size="sm"
                variant="outline"
                disabled={!allowed || busy}
                onClick={() =>
                  void run([{ operation: "mcp.signIn.cancelById", mcpServerId: row.id }])
                }
              >
                Cancel sign-in
              </Button>
            )}
            <Button
              size="sm"
              variant="destructive"
              disabled={!allowed || busy}
              onClick={() => void remove(row.id)}
            >
              Delete
            </Button>
          </div>
        </div>
      ))}
      {editing && (
        <div className="space-y-2 border-t pt-3">
          <label className="block space-y-1 text-sm">
            <span>Configuration changes (JSON object)</span>
            <Input
              type="password"
              autoComplete="off"
              value={editing.patch}
              disabled={busy || !allowed}
              onChange={(event) => setEditing({ ...editing, patch: event.target.value })}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Omitted fields keep their saved values. Use an empty array to clear headers or
            environment variables. Changes clear after submission.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={!allowed || busy} onClick={() => void savePatch()}>
              Save changes
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(null)}>
              Cancel changes
            </Button>
          </div>
        </div>
      )}
      {draft && (
        <form
          className="space-y-3 border-t pt-3"
          onSubmit={(event) => {
            event.preventDefault();
            void save(false);
          }}
        >
          <label className="block space-y-1 text-sm">
            <span>Name</span>
            <Input
              value={draft.name}
              disabled={busy || !allowed}
              onChange={(event) => update("name", event.target.value)}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Transport</span>
            <Select
              value={draft.transport}
              disabled={busy || !allowed}
              onValueChange={(value) => {
                if (value === "http" || value === "stdio") setDraft({ ...draft, transport: value });
              }}
            >
              <SelectTrigger aria-label="MCP transport">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="http">HTTP</SelectItem>
                <SelectItem value="stdio">Command (stdio)</SelectItem>
              </SelectContent>
            </Select>
          </label>
          {(draft.transport === "http"
            ? (["url", "headers"] as const)
            : (["command", "args", "env", "workingDirectory"] as const)
          ).map((key) => (
            <label key={key} className="block space-y-1 text-sm">
              <span>
                {
                  {
                    url: "Server URL",
                    headers: "Headers (JSON object)",
                    command: "Command",
                    args: "Arguments (JSON array)",
                    env: "Environment variables (JSON object)",
                    workingDirectory: "Working directory",
                  }[key]
                }
              </span>
              <Input
                type={key === "env" || key === "headers" ? "password" : "text"}
                autoComplete="off"
                value={draft[key]}
                disabled={busy || !allowed}
                onChange={(event) => update(key, event.target.value)}
              />
            </label>
          ))}
          <p className="text-xs text-muted-foreground">
            Arguments are literal JSON strings. Private fields clear after testing, saving or
            cancelling.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={busy || !allowed}>
              Save MCP server
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !allowed}
              onClick={() => void save(true)}
            >
              Test draft
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
