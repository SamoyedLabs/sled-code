import { useState } from "react";
import { useAtomValue } from "@effect/atom-react";
import * as Schema from "effect/Schema";
import { OpenbotSettingsReadRequest } from "@t3tools/contracts/openbot-settings";
import type { EnvironmentId } from "@t3tools/contracts";
import { openbot } from "../../state/openbot";
import { useEnvironmentQuery } from "../../state/query";
import { settingsCapabilities, settingResult } from "@t3tools/client-runtime/openbot/settings";
import { BotDetail } from "./BotEnvironment";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

/** Exposes the existing per-agent task service; a cross-agent source Tasks page is still unported. */
export function BotRailTasks({
  environmentId,
  hostId,
  agents,
}: {
  environmentId: EnvironmentId;
  hostId: string;
  agents: readonly { id: string; name: string }[];
}) {
  const [selected, setSelected] = useState("");
  const agentId = agents.find((a) => a.id === selected)?.id ?? agents[0]?.id;
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Tasks">
      <label className="flex items-center gap-3 border-b p-3 text-sm">
        Agent
        <select
          aria-label="Tasks agent"
          value={agentId ?? ""}
          onChange={(event) => setSelected(event.target.value)}
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      {agentId ? (
        <BotDetail
          key={`${hostId}:${agentId}`}
          environmentId={environmentId}
          expectedHostId={hostId}
          agentId={agentId}
          workspaceView="task"
        />
      ) : (
        <p className="p-5">No agents available.</p>
      )}
    </section>
  );
}
const decodeCatalogRequest = Schema.decodeSync(OpenbotSettingsReadRequest);
const entry = Schema.Struct({ id: Schema.String, name: Schema.String, description: Schema.String });
const decodeAgents = Schema.decodeUnknownSync(Schema.Struct({ agents: Schema.Array(entry) }));
const decodeSkills = Schema.decodeUnknownSync(Schema.Struct({ skills: Schema.Array(entry) }));
export function BotRailMarketplace({
  environmentId,
  hostId,
}: {
  environmentId: EnvironmentId;
  hostId: string;
}) {
  const [kind, setKind] = useState<"agents" | "skills">("agents");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const request = decodeCatalogRequest({
    operation:
      kind === "agents"
        ? "settings.local-catalog.searchAgents"
        : "settings.local-catalog.searchSkills",
    parameters: { query: search, limit: 30 },
  });
  const canRead = useAtomValue(
    openbot.settingsRead.permissionAtom(environmentId, { hostId, request }),
  );
  const compatibility = useEnvironmentQuery(
    openbot.readFromHost({
      environmentId,
      input: { hostId, request: { operation: "compatibility.read" } },
    }),
  );
  const supported = settingsCapabilities(compatibility.data).includes("local-skill-catalog-v1");
  const query = useEnvironmentQuery(
    canRead && supported
      ? openbot.readFromHost({ environmentId, input: { hostId, request } })
      : null,
  );
  let entries: readonly { id: string; name: string; description: string }[] = [];
  let malformed = false;
  if (query.data !== null) {
    try {
      const data = settingResult(request.operation, query.data);
      entries = kind === "agents" ? decodeAgents(data).agents : decodeSkills(data).skills;
    } catch {
      malformed = true;
    }
  }
  return (
    <section aria-label="Marketplace" className="mx-auto max-w-5xl space-y-5">
      <div className="flex gap-2">
        <Button
          variant={kind === "agents" ? "default" : "outline"}
          onClick={() => setKind("agents")}
        >
          Agents
        </Button>
        <Button
          variant={kind === "skills" ? "default" : "outline"}
          onClick={() => setKind("skills")}
        >
          Skills
        </Button>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setSearch(draft.trim());
        }}
      >
        <Input
          aria-label="Search marketplace"
          placeholder="Search marketplace"
          maxLength={256}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit">Search</Button>
      </form>
      {!canRead ? (
        <p>
          This connection cannot browse this host’s marketplace. Connect with settings and
          provider-management access.
        </p>
      ) : compatibility.isPending ? (
        <p role="status">Checking marketplace…</p>
      ) : !supported ? (
        <p>This host does not expose marketplace browsing.</p>
      ) : query.error ? (
        <p role="alert">{query.error}</p>
      ) : malformed ? (
        <p role="alert">The host returned an unsupported catalog response.</p>
      ) : query.isPending ? (
        <p role="status">Loading marketplace…</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {entries.map((item) => (
            <li key={item.id} className="rounded-xl border p-4">
              <h2 className="font-medium">{item.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">{item.description}</p>
            </li>
          ))}
          {!entries.length && <li>No matching {kind}.</li>}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        This catalog view uses the existing host service. The full upstream marketplace detail and
        install interface is not ported yet.
      </p>
    </section>
  );
}
