import { useState } from "react";
import type {
  OpenbotRegistryEntry,
  OpenbotCatalogAdminRequest,
} from "@t3tools/contracts/openbot-catalog";
import {
  registryInstall,
  registryConfirmation,
  type CatalogActions,
} from "@t3tools/client-runtime/openbot/catalog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { confirmed } from "./BotConnectionControls";
import { useBotCatalog } from "./useBotCatalog";
export function BotCatalog({ actions }: { actions: CatalogActions }) {
  const catalog = useBotCatalog(actions);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<OpenbotRegistryEntry | null>(null);
  const [agentId, setAgentId] = useState("");
  const [name, setName] = useState("");
  const [distribution, setDistribution] = useState("");
  const [visible, setVisible] = useState(40);
  const entryCount = catalog.state.entries?.length ?? 0;
  const installedCount = catalog.state.installed?.length ?? 0;
  const showMore = Math.max(entryCount, installedCount) > visible;
  const install = selected ? registryInstall(selected, agentId, distribution, name) : null;
  const mutate = async (request: OpenbotCatalogAdminRequest) => {
    if (await confirmed(registryConfirmation(request))) await catalog.run(request);
  };
  return (
    <section
      aria-label="ACP registry on selected host"
      className="space-y-3"
      aria-busy={catalog.busy}
    >
      <h3>ACP registry</h3>
      <p>
        Install registry providers on the selected host. Commands can download and run there. Host
        admin and provider-management permissions are required. Refresh explicitly to check
        installation progress.
      </p>
      <label className="block space-y-1">
        <span>Search registry</span>
        <Input value={query} maxLength={256} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <Button
        variant="outline"
        disabled={catalog.busy || !actions.can({ operation: "registry.search", query })}
        onClick={() => {
          setSelected(null);
          setVisible(40);
          void catalog.run({ operation: "registry.search", query });
        }}
      >
        Search registry
      </Button>
      <Button
        variant="outline"
        disabled={catalog.busy || !actions.can({ operation: "registry.status" })}
        onClick={() => void catalog.run({ operation: "registry.status" })}
      >
        Refresh host status
      </Button>
      <Button
        variant="outline"
        disabled={catalog.busy || !actions.can({ operation: "registry.installed" })}
        onClick={() => void catalog.run({ operation: "registry.installed" })}
      >
        Refresh installed agents
      </Button>
      {catalog.error && <p role="alert">{catalog.error}</p>}
      {catalog.state.notice && <p role="status">{catalog.state.notice}</p>}
      {catalog.state.status?.length === 0 && (
        <p>No in-progress or failed registry operations reported.</p>
      )}
      {catalog.state.status?.map((item) => (
        <div key={item.registryId}>
          <p>
            {item.registryId} · {item.state} · {item.message}
          </p>
          {item.state === "installing" && (
            <Button
              variant="outline"
              disabled={
                catalog.busy ||
                catalog.uncertain ||
                !actions.can({ operation: "registry.cancel", registryId: item.registryId })
              }
              onClick={() =>
                void mutate({ operation: "registry.cancel", registryId: item.registryId })
              }
            >
              Cancel {item.registryId}
            </Button>
          )}
        </div>
      ))}
      {catalog.state.installed?.length === 0 && <p>No registry agents installed.</p>}
      {catalog.state.installed?.slice(0, visible).map((item) => (
        <div key={item.registryId}>
          <p>
            {item.registryId} · {item.customAgentId} · v{item.version} · {item.distribution}
          </p>
          <Button
            variant="destructive"
            disabled={
              catalog.busy ||
              catalog.uncertain ||
              !actions.can({ operation: "registry.remove", registryId: item.registryId })
            }
            onClick={() =>
              void mutate({ operation: "registry.remove", registryId: item.registryId })
            }
          >
            Remove {item.registryId}
          </Button>
        </div>
      ))}
      {catalog.state.entries?.length === 0 && <p>No matching registry entries.</p>}
      {catalog.state.entries?.slice(0, visible).map((entry) => (
        <div key={entry.id} className="space-y-2 break-words">
          <h4>
            {entry.name} · {entry.id}
          </h4>
          <p>{entry.description}</p>
          <p>
            Available {entry.version} · Installed {entry.installedVersion ?? "none"} · License{" "}
            {entry.license ?? "unspecified"}
          </p>
          <Button
            variant="outline"
            disabled={catalog.busy}
            onClick={() => {
              setSelected(entry);
              setAgentId(entry.customAgentId ?? "");
              setName(entry.name.slice(0, 80));
              setDistribution(entry.distributions[0] ?? "");
            }}
          >
            Select {entry.name}
          </Button>
        </div>
      ))}
      {showMore && (
        <Button variant="outline" onClick={() => setVisible(visible + 40)}>
          Show more registry entries
        </Button>
      )}
      {selected && (
        <div className="space-y-2">
          <h4>Install or update {selected.name}</h4>
          <label className="block">
            <span>Custom provider ID</span>
            <Input
              value={agentId}
              maxLength={40}
              disabled={!!selected.customAgentId || catalog.busy}
              onChange={(event) => setAgentId(event.target.value)}
            />
          </label>
          <label className="block">
            <span>Provider name</span>
            <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
          </label>
          <Select value={distribution} onValueChange={(value) => setDistribution(value ?? "")}>
            <SelectTrigger aria-label="Installation distribution">
              <SelectValue placeholder="Choose distribution" />
            </SelectTrigger>
            <SelectContent>
              {selected.distributions.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p>
            Use a unique lowercase provider ID with letters, digits or hyphens. The host validates
            provider collisions.
          </p>
          <Button
            disabled={
              !install ||
              catalog.busy ||
              catalog.uncertain ||
              (install !== null && !actions.can(install))
            }
            onClick={() => {
              if (install) void mutate(install);
            }}
          >
            Confirm install or update
          </Button>
        </div>
      )}
    </section>
  );
}
