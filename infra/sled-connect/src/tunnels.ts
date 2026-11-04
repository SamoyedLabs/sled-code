import { workerFetch } from "./platform.ts";
import type { RelayManagedEndpointOrigin } from "@t3tools/contracts/relay";
import { RelayError, type RelayBindings } from "./config.ts";
import { hash } from "./security.ts";
import type { EnvironmentRow, RelayStore } from "./store.ts";

interface CloudflareResult<T> {
  success: boolean;
  result: T;
}
interface Tunnel {
  id: string;
  name: string;
  deleted_at?: string | null;
}
interface DnsRecord {
  id: string;
  content: string;
  name: string;
  type: string;
}

export function validateOrigin(origin: RelayManagedEndpointOrigin): void {
  if (
    !["127.0.0.1", "localhost", "::1"].includes(origin.localHttpHost) ||
    !Number.isInteger(origin.localHttpPort) ||
    origin.localHttpPort < 1 ||
    origin.localHttpPort > 65535
  )
    throw new RelayError(400, "origin_not_allowed");
}

export function endpoint(row: EnvironmentRow) {
  return {
    httpBaseUrl: `https://${row.hostname}`,
    wsBaseUrl: `wss://${row.hostname}`,
    providerKind: "cloudflare_tunnel" as const,
  };
}

export class Tunnels {
  readonly env: RelayBindings;
  readonly store: RelayStore;
  constructor(env: RelayBindings, store: RelayStore) {
    this.env = env;
    this.store = store;
  }

  async api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const response = await workerFetch(`https://api.cloudflare.com/client/v4${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.env.CLOUDFLARE_API_TOKEN}`,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(8000),
      redirect: "manual",
    });
    if (!response.ok)
      throw new RelayError(
        response.status === 429 ? 429 : 502,
        response.status === 404 ? "cloudflare_resource_missing" : "cloudflare_request_failed",
      );
    const data: CloudflareResult<T> = await response.json();
    if (!data.success) throw new RelayError(502, "cloudflare_request_failed");
    return data.result;
  }

  async identity(environmentId: string, userId: string) {
    const suffix = (await hash(`${this.env.RELAY_URL}:${userId}:${environmentId}`)).slice(0, 16);
    return {
      hostname: `sled-${suffix}.${this.env.TUNNEL_DOMAIN}`,
      tunnelName: `sled-managedendpoint-${suffix}`,
    };
  }

  async provision(row: EnvironmentRow, origin: RelayManagedEndpointOrigin) {
    validateOrigin(origin);
    const base = `/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel`;
    let tunnelId = row.tunnel_id;
    // Adopt a partially provisioned tunnel by its deterministic name after an interrupted request.
    const matches = await this.api<Tunnel[]>(
      `${base}?name=${encodeURIComponent(row.tunnel_name)}&is_deleted=false`,
    );
    const tunnel =
      matches.find((item) => item.name === row.tunnel_name && !item.deleted_at) ??
      (await this.api<Tunnel>(base, "POST", { name: row.tunnel_name, config_src: "cloudflare" }));
    tunnelId = tunnel.id;
    await this.store.db
      .prepare("UPDATE environments SET tunnel_id=? WHERE id=?")
      .bind(tunnelId, row.id)
      .run();
    const host = origin.localHttpHost === "::1" ? "[::1]" : origin.localHttpHost;
    await this.api(`${base}/${tunnelId}/configurations`, "PUT", {
      config: {
        ingress: [
          { hostname: row.hostname, service: `http://${host}:${origin.localHttpPort}` },
          { service: "http_status:404" },
        ],
      },
    });
    const dnsBase = `/zones/${this.env.CLOUDFLARE_ZONE_ID}/dns_records`;
    const records = await this.api<DnsRecord[]>(
      `${dnsBase}?name=${encodeURIComponent(row.hostname)}`,
    );
    const existing = records.find((item) => item.name === row.hostname);
    const content = `${tunnelId}.cfargotunnel.com`;
    if (
      existing &&
      (existing.type !== "CNAME" || !existing.content.endsWith(".cfargotunnel.com"))
    ) {
      throw new RelayError(409, "dns_record_conflict");
    }
    const record = await this.api<DnsRecord>(
      existing ? `${dnsBase}/${existing.id}` : dnsBase,
      existing ? "PUT" : "POST",
      {
        type: "CNAME",
        name: row.hostname,
        content,
        proxied: true,
        ttl: 1,
      },
    );
    await this.store.db
      .prepare("UPDATE environments SET dns_id=?,origin_json=? WHERE id=?")
      .bind(record.id, JSON.stringify(origin), row.id)
      .run();
    const connectorToken = await this.api<string>(`${base}/${tunnelId}/token`);
    return {
      endpoint: endpoint(row),
      runtime: {
        providerKind: "cloudflare_tunnel" as const,
        connectorToken,
        tunnelId,
        tunnelName: row.tunnel_name,
      },
    };
  }

  private async deleteIfPresent(path: string): Promise<void> {
    try {
      await this.api(path, "DELETE");
    } catch (error) {
      if (!(error instanceof RelayError) || error.reason !== "cloudflare_resource_missing")
        throw error;
    }
  }

  async release(row: EnvironmentRow, removeDns: boolean): Promise<void> {
    const base = `/accounts/${this.env.CLOUDFLARE_ACCOUNT_ID}/cfd_tunnel`;
    const live = await this.api<Tunnel[]>(
      `${base}?name=${encodeURIComponent(row.tunnel_name)}&is_deleted=false`,
    );
    for (const tunnel of live) {
      if (tunnel.id !== row.tunnel_id) continue;
      await this.deleteIfPresent(`${base}/${tunnel.id}/connections`);
      await this.deleteIfPresent(`${base}/${tunnel.id}`);
    }
    if (removeDns && row.dns_id) {
      await this.deleteIfPresent(`/zones/${this.env.CLOUDFLARE_ZONE_ID}/dns_records/${row.dns_id}`);
    }
    await this.store.db
      .prepare(
        "UPDATE environments SET tunnel_id=NULL,dns_id=CASE WHEN ? THEN NULL ELSE dns_id END WHERE id=?",
      )
      .bind(removeDns ? 1 : 0, row.id)
      .run();
  }
}
