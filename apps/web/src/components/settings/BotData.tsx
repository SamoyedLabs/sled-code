import { useState } from "react";
import {
  hostedSiteLink,
  tableOwner,
  type DataActions,
} from "@t3tools/client-runtime/openbot/presentation";
import { Button } from "../ui/button";
import { useBotData } from "./useBotData";
export function BotData({
  actions,
  agents,
}: {
  actions: DataActions;
  agents: readonly { id: string; name: string }[];
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section aria-label="Shared tables and hosted sites" className="space-y-3">
      <Button variant="outline" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        Tables and sites
      </Button>
      {expanded && <DataPanel actions={actions} agents={agents} />}
    </section>
  );
}
function DataPanel({
  actions,
  agents,
}: {
  actions: DataActions;
  agents: readonly { id: string; name: string }[];
}) {
  const data = useBotData(actions);
  return (
    <div className="space-y-3" aria-busy={data.busy}>
      <h3>Shared tables</h3>
      <p>
        Agents share one database. Ask an agent to create, query or update a table with its table
        tools. This released API lists summaries and deletes tables; it does not expose rows or
        editing.
      </p>
      <Button
        variant="outline"
        disabled={data.busy || !actions.canReadTables}
        onClick={data.refreshTables}
      >
        Refresh tables
      </Button>
      {!actions.canReadTables && (
        <p>Table summaries require settings access and orchestration read permission.</p>
      )}
      {data.tables !== null && <p>{data.tables.length} tables on this host</p>}
      {data.tables?.map((table) => (
        <div key={table.name} className="space-y-2 break-words">
          <h4>{table.name}</h4>
          <p>
            {table.rowCount === null ? "Row count unavailable" : `${table.rowCount} rows`} ·{" "}
            {tableOwner(table.ownerAgentId, agents)}
          </p>
          <Button
            variant="outline"
            disabled={
              data.busy || !actions.canDelete({ operation: "tables.delete", name: table.name })
            }
            onClick={() => data.setPending({ operation: "tables.delete", name: table.name })}
          >
            Delete table {table.name}
          </Button>
        </div>
      ))}
      <h3>Hosted sites</h3>
      <p>
        Ask an agent to publish a site using its hosting tools. Publishing uses the host account.
        This panel cannot publish or edit site files. Sites may expire.
      </p>
      <Button
        variant="outline"
        disabled={data.busy || !actions.canReadSites}
        onClick={data.refreshSites}
      >
        Refresh sites
      </Button>
      {!actions.canReadSites && <p>Site summaries require orchestration read permission.</p>}
      {data.sites && (
        <p>
          {data.sites.used} / {data.sites.limit} site slots used
          {data.sites.used >= data.sites.limit ? " · Limit reached" : ""}
        </p>
      )}
      {data.sites?.sites.length === 0 && <p>No hosted sites returned by this host.</p>}
      {data.sites?.sites.map((site) => (
        <div key={site.id} className="space-y-2 break-words">
          <h4>{site.title || site.hostname}</h4>
          <p>{site.description}</p>
          <p>
            {site.status} · {site.framework} · {site.fileCount} files · {site.size} bytes
          </p>
          <p>
            Updated: {site.updatedAt} · Expires: {site.expiresAt ?? "Unavailable"}
          </p>
          <p>
            {site.serverId === null
              ? "Not linked to a server; account quota applies"
              : `Server: ${site.serverId}`}
          </p>
          {hostedSiteLink(site) ? (
            <a href={hostedSiteLink(site) ?? undefined} target="_blank" rel="noopener noreferrer">
              {site.url}
            </a>
          ) : (
            <p>{site.hostname} · Link unavailable for this site</p>
          )}
          <Button
            variant="outline"
            disabled={
              data.busy || !actions.canDelete({ operation: "sites.delete", siteId: site.id })
            }
            onClick={() => data.setPending({ operation: "sites.delete", siteId: site.id })}
          >
            Delete site {site.hostname}
          </Button>
        </div>
      ))}
      {data.error && <p role="alert">{data.error}</p>}
      {data.pending && (
        <div role="group" aria-label="Confirm deletion" className="space-y-2">
          <p>
            Delete{" "}
            {data.pending.operation === "tables.delete"
              ? `table “${data.pending.name}” and all its rows`
              : `site “${data.sites?.sites.find((site) => site.id === (data.pending?.operation === "sites.delete" ? data.pending.siteId : ""))?.hostname ?? data.pending.siteId}”`}
            ? This affects every user of this host and cannot be undone here.
          </p>
          <Button
            variant="destructive"
            disabled={data.busy || !actions.canDelete(data.pending)}
            onClick={data.confirmDelete}
          >
            Confirm delete
          </Button>
          <Button variant="outline" disabled={data.busy} onClick={() => data.setPending(null)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
