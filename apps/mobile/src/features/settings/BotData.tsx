import { Linking, View } from "react-native";
import { AppText as Text } from "../../components/ui/AppText";
import { useState } from "react";
import {
  hostedSiteLink,
  tableOwner,
  type DataActions,
} from "@t3tools/client-runtime/openbot/presentation";
import { Button } from "../../components/ui/Button";
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
    <View className="gap-3">
      <Button onPress={() => setExpanded(!expanded)} label="Tables and sites" />
      {expanded && <DataPanel actions={actions} agents={agents} />}
    </View>
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
    <View className="gap-3">
      <Text>Shared tables</Text>
      <Text>
        Agents share one database. Ask an agent to create, query or update a table with its table
        tools. This released API lists summaries and deletes tables; it does not expose rows or
        editing.
      </Text>
      <Button
        disabled={data.busy || !actions.canReadTables}
        onPress={data.refreshTables}
        label="Refresh tables"
      />
      {!actions.canReadTables && (
        <Text>Table summaries require settings access and orchestration read permission.</Text>
      )}
      {data.tables !== null && <Text>{data.tables.length} tables on this host</Text>}
      {data.tables?.map((table) => (
        <View key={table.name} className="gap-2">
          <Text>{table.name}</Text>
          <Text>
            {table.rowCount === null ? "Row count unavailable" : `${table.rowCount} rows`} ·{" "}
            {tableOwner(table.ownerAgentId, agents)}
          </Text>
          <Button
            disabled={
              data.busy || !actions.canDelete({ operation: "tables.delete", name: table.name })
            }
            onPress={() => data.setPending({ operation: "tables.delete", name: table.name })}
            label={`Delete table ${table.name}`}
          />
        </View>
      ))}
      <Text>Hosted sites</Text>
      <Text>
        Ask an agent to publish a site using its hosting tools. Publishing uses the host account.
        This panel cannot publish or edit site files. Sites may expire.
      </Text>
      <Button
        disabled={data.busy || !actions.canReadSites}
        onPress={data.refreshSites}
        label="Refresh sites"
      />
      {!actions.canReadSites && <Text>Site summaries require orchestration read permission.</Text>}
      {data.sites && (
        <Text>
          {data.sites.used} / {data.sites.limit} site slots used
          {data.sites.used >= data.sites.limit ? " · Limit reached" : ""}
        </Text>
      )}
      {data.sites?.sites.length === 0 && <Text>No hosted sites returned by this host.</Text>}
      {data.sites?.sites.map((site) => (
        <View key={site.id} className="gap-2">
          <Text>{site.title || site.hostname}</Text>
          <Text>{site.description}</Text>
          <Text>
            {site.status} · {site.framework} · {site.fileCount} files · {site.size} bytes
          </Text>
          <Text>
            Updated: {site.updatedAt} · Expires: {site.expiresAt ?? "Unavailable"}
          </Text>
          <Text>
            {site.serverId === null
              ? "Not linked to a server; account quota applies"
              : `Server: ${site.serverId}`}
          </Text>
          {hostedSiteLink(site) ? (
            <Button
              label={`Open ${site.hostname}`}
              onPress={() => {
                const url = hostedSiteLink(site);
                if (url) void Linking.openURL(url).catch(data.openFailed);
              }}
            />
          ) : (
            <Text>{site.hostname} · Link unavailable for this site</Text>
          )}
          <Button
            disabled={
              data.busy || !actions.canDelete({ operation: "sites.delete", siteId: site.id })
            }
            onPress={() => data.setPending({ operation: "sites.delete", siteId: site.id })}
            label={`Delete site ${site.hostname}`}
          />
        </View>
      ))}
      {data.error && <Text accessibilityRole="alert">{data.error}</Text>}
      {data.pending && (
        <View accessibilityLabel="Confirm deletion" className="gap-2">
          <Text>
            Delete{" "}
            {data.pending.operation === "tables.delete"
              ? `table “${data.pending.name}” and all its rows`
              : `site “${data.sites?.sites.find((site) => site.id === (data.pending?.operation === "sites.delete" ? data.pending.siteId : ""))?.hostname ?? data.pending.siteId}”`}
            ? This affects every user of this host and cannot be undone here.
          </Text>
          <Button
            tone="danger"
            disabled={data.busy || !actions.canDelete(data.pending)}
            onPress={data.confirmDelete}
            label="Confirm delete"
          />
          <Button disabled={data.busy} onPress={() => data.setPending(null)} label="Cancel" />
        </View>
      )}
    </View>
  );
}
