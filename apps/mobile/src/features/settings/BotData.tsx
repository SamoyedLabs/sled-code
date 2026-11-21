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
import { T, Var, useGT } from "gt-react-native";
export function BotData({
  actions,
  agents,
}: {
  actions: DataActions;
  agents: readonly { id: string; name: string }[];
}) {
  const gt = useGT();
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Button onPress={() => setExpanded(!expanded)} label={gt("Tables and sites")} />
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
  const gt = useGT();
  const data = useBotData(actions);
  return (
    <View className="gap-3">
      <Text>
        <T>Shared tables</T>
      </Text>
      <Text>
        <T>
          Agents share one database. Ask an agent to create, query or update a table with its table
          tools. This released API lists summaries and deletes tables; it does not expose rows or
          editing.
        </T>
      </Text>
      <Button
        disabled={data.busy || !actions.canReadTables}
        onPress={data.refreshTables}
        label={gt("Refresh tables")}
      />
      {!actions.canReadTables && (
        <Text>
          <T>Table summaries require settings access and orchestration read permission.</T>
        </Text>
      )}
      {data.tables !== null && (
        <Text>
          <T>
            <Var>{data.tables.length}</Var> tables on this host
          </T>
        </Text>
      )}
      {data.tables?.map((table) => (
        <View key={table.name} className="gap-2">
          <Text>{table.name}</Text>
          <Text>
            {table.rowCount === null ? gt("Row count unavailable") : `${table.rowCount} rows`} ·{" "}
            {tableOwner(table.ownerAgentId, agents)}
          </Text>
          <Button
            disabled={
              data.busy || !actions.canDelete({ operation: "tables.delete", name: table.name })
            }
            onPress={() => data.setPending({ operation: "tables.delete", name: table.name })}
            label={gt("Delete table {name}", { name: table.name })}
          />
        </View>
      ))}
      <Text>
        <T>Hosted sites</T>
      </Text>
      <Text>
        <T>
          Ask an agent to publish a site using its hosting tools. Publishing uses the host account.
          This panel cannot publish or edit site files. Sites may expire.
        </T>
      </Text>
      <Button
        disabled={data.busy || !actions.canReadSites}
        onPress={data.refreshSites}
        label={gt("Refresh sites")}
      />
      {!actions.canReadSites && (
        <Text>
          <T>Site summaries require orchestration read permission.</T>
        </Text>
      )}
      {data.sites && (
        <Text>
          <T>
            <Var>{data.sites.used}</Var> / <Var>{data.sites.limit}</Var> site slots used
            <Var>{data.sites.used >= data.sites.limit ? gt(" · Limit reached") : ""}</Var>
          </T>
        </Text>
      )}
      {data.sites?.sites.length === 0 && (
        <Text>
          <T>No hosted sites returned by this host.</T>
        </Text>
      )}
      {data.sites?.sites.map((site) => (
        <View key={site.id} className="gap-2">
          <Text>{site.title || site.hostname}</Text>
          <Text>{site.description}</Text>
          <Text>
            <T>
              <Var>{site.status}</Var> · <Var>{site.framework}</Var> · <Var>{site.fileCount}</Var>{" "}
              files · <Var>{site.size}</Var> bytes
            </T>
          </Text>
          <Text>
            <T>
              Updated: <Var>{site.updatedAt}</Var> · Expires:{" "}
              <Var>{site.expiresAt ?? gt("Unavailable")}</Var>
            </T>
          </Text>
          <Text>
            {site.serverId === null
              ? gt("Not linked to a server; account quota applies")
              : gt("Server: {serverId}", { serverId: site.serverId })}
          </Text>
          {hostedSiteLink(site) ? (
            <Button
              label={gt("Open {hostname}", { hostname: site.hostname })}
              onPress={() => {
                const url = hostedSiteLink(site);
                if (url) void Linking.openURL(url).catch(data.openFailed);
              }}
            />
          ) : (
            <Text>
              <T>
                <Var>{site.hostname}</Var> · Link unavailable for this site
              </T>
            </Text>
          )}
          <Button
            disabled={
              data.busy || !actions.canDelete({ operation: "sites.delete", siteId: site.id })
            }
            onPress={() => data.setPending({ operation: "sites.delete", siteId: site.id })}
            label={gt("Delete site {hostname}", { hostname: site.hostname })}
          />
        </View>
      ))}
      {data.error && <Text accessibilityRole="alert">{data.error}</Text>}
      {data.pending && (
        <View accessibilityLabel={gt("Confirm deletion")} className="gap-2">
          <Text>
            <T>
              Delete<Var> </Var>
              <Var>
                {data.pending.operation === "tables.delete"
                  ? gt("table “{name}” and all its rows", { name: data.pending.name })
                  : gt("site “{value}”", {
                      value:
                        data.sites?.sites.find(
                          (site) =>
                            site.id ===
                            (data.pending?.operation === "sites.delete" ? data.pending.siteId : ""),
                        )?.hostname ?? data.pending.siteId,
                    })}
              </Var>
              ? This affects every user of this host and cannot be undone here.
            </T>
          </Text>
          <Button
            tone="danger"
            disabled={data.busy || !actions.canDelete(data.pending)}
            onPress={data.confirmDelete}
            label={gt("Confirm delete")}
          />
          <Button disabled={data.busy} onPress={() => data.setPending(null)} label={gt("Cancel")} />
        </View>
      )}
    </View>
  );
}
