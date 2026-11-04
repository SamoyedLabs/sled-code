import { workerNow, workerUuid, workerIsoDate, workerFetch } from "./platform.ts";
import { RelayError } from "./config.ts";
import type { PersonalRelay } from "./relay.ts";
import type { EnvironmentRow } from "./store.ts";

interface HeldHook {
  id: string;
  environment_id: string;
  hook_id: string;
  token: string;
  method: string;
  query: string;
  headers_json: string;
  body: ArrayBuffer;
  received_at: string;
}

export class RelayHooks {
  readonly relay: PersonalRelay;
  constructor(relay: PersonalRelay) {
    this.relay = relay;
  }

  async deliver(row: EnvironmentRow, hook: HeldHook): Promise<Response> {
    const headers = new Headers(JSON.parse(hook.headers_json));
    for (const name of headers.keys()) {
      if (
        /^(?:host|connection|content-length|forwarded|x-forwarded-.*|x-t3-relay-.*|traceparent|tracestate)$/iu.test(
          name,
        )
      )
        headers.delete(name);
    }
    headers.set("x-t3-relay-delivery-id", hook.id);
    headers.set("x-t3-relay-received-at", hook.received_at);
    headers.set(
      "x-t3-relay-delivery",
      await this.relay.security.sign("t3-relay-hook-delivery+jwt", {
        ...this.relay.security.claims(row.id, 120, `t3-env:${row.id}`),
        environmentId: row.id,
        deliveryId: hook.id,
        receivedAt: hook.received_at,
        hookId: hook.hook_id,
      }),
    );
    return workerFetch(
      `https://${row.hostname}/api/hooks/${encodeURIComponent(hook.hook_id)}/${encodeURIComponent(hook.token)}${hook.query}`,
      {
        method: hook.method,
        headers,
        ...(hook.method === "GET" ? {} : { body: hook.body }),
        redirect: "manual",
        signal: AbortSignal.timeout(8000),
      },
    );
  }

  async forward(request: Request, endpointKey: string, hookId: string, token: string) {
    const row = await this.relay.store.db
      .prepare("SELECT * FROM environments WHERE substr(tunnel_name,-16)=? AND revoked=0")
      .bind(endpointKey)
      .first<EnvironmentRow>();
    if (!row) throw new RelayError(404, "hook_not_found");
    const declared = request.headers.get("content-length");
    if (declared && Number(declared) > 1024 * 1024) throw new RelayError(413, "body_too_large");
    const chunks: Uint8Array[] = [];
    let length = 0;
    const reader = request.body?.getReader();
    if (reader) {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 1024 * 1024) {
          await reader.cancel();
          throw new RelayError(413, "body_too_large");
        }
        chunks.push(chunk.value);
      }
    }
    const body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const hook: HeldHook = {
      id: workerUuid(),
      environment_id: row.id,
      hook_id: hookId,
      token,
      method: request.method,
      query: new URL(request.url).search,
      headers_json: JSON.stringify(Object.fromEntries(request.headers)),
      body: body.buffer,
      received_at: workerIsoDate(),
    };
    try {
      const response = await this.deliver(row, hook);
      // Retry only a host that did not answer; never retry a host's authentication rejection.
      if (response.status < 500 && response.status !== 429) return response;
      if (!("hold_offline" in row) || row.hold_offline !== 1) return response;
    } catch {
      if (!("hold_offline" in row) || row.hold_offline !== 1)
        throw new RelayError(503, "environment_offline");
    }
    const result = await this.relay.store.db
      .prepare(
        "INSERT INTO held_hooks(id,environment_id,hook_id,token,method,query,headers_json,body,received_at) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT count(*) FROM held_hooks WHERE environment_id=?) < 20 AND (SELECT coalesce(sum(length(body)),0) FROM held_hooks) + ? <= 10485760",
      )
      .bind(
        hook.id,
        row.id,
        hookId,
        token,
        hook.method,
        hook.query,
        hook.headers_json,
        hook.body,
        hook.received_at,
        row.id,
        length,
      )
      .run();
    if (result.meta.changes !== 1) throw new RelayError(429, "hook_inbox_full");
    return Response.json({ queued: true }, { status: 202 });
  }

  async drain(id?: string): Promise<void> {
    const expired = workerIsoDate(workerNow() - 24 * 60 * 60 * 1000);
    await this.relay.store.db
      .prepare(
        "DELETE FROM held_hooks WHERE received_at < ? OR environment_id IN (SELECT id FROM environments WHERE revoked=1)",
      )
      .bind(expired)
      .run();
    const { results } = await this.relay.store.db
      .prepare(
        `SELECT * FROM held_hooks ${id ? "WHERE environment_id=?" : ""} ORDER BY received_at LIMIT 2`,
      )
      .bind(...(id ? [id] : []))
      .all<HeldHook>();
    for (const hook of results) {
      const row = await this.relay.store.environment(
        hook.environment_id,
        this.relay.env.OWNER_USER_ID,
      );
      try {
        const response = await this.deliver(row, hook);
        if (response.status >= 500 || response.status === 429) break;
        await response.body?.cancel();
        await this.relay.store.db.prepare("DELETE FROM held_hooks WHERE id=?").bind(hook.id).run();
      } catch {
        break;
      }
    }
  }
}
