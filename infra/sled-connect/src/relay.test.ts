import { workerNow, workerUuid } from "./platform.ts";
// @effect-diagnostics nodeBuiltinImport:off - SQLite is the real persistence boundary for the D1 adapter tests.
import * as NodeSqlite from "node:sqlite";
import * as NodeFS from "node:fs";
import {
  calculateJwkThumbprint,
  exportJWK,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  SignJWT,
} from "jose";
import { describe, expect, it, vi } from "vite-plus/test";
import { PersonalRelay } from "./relay.ts";
import { RelayStore } from "./store.ts";
import { RelayHooks } from "./hooks.ts";
import { type RelayBindings } from "./config.ts";
import { validateOrigin } from "./tunnels.ts";
import worker from "./worker.ts";

function sqliteD1() {
  const sqlite = new NodeSqlite.DatabaseSync(":memory:");
  sqlite.exec(
    NodeFS.readFileSync(new URL("../migrations/0001_connect.sql", import.meta.url), "utf8"),
  );
  const prepare = (sql: string) => {
    let bindings: Array<string | number | null | Uint8Array> = [];
    const statement = {
      bind: (...values: Array<string | number | null | ArrayBuffer>) => {
        bindings = values.map((value) =>
          value instanceof ArrayBuffer ? new Uint8Array(value) : value,
        );
        return statement;
      },
      first: async () => sqlite.prepare(sql).get(...bindings) ?? null,
      all: async () => ({ success: true, results: sqlite.prepare(sql).all(...bindings) }),
      run: async () => ({
        success: true,
        results: [],
        meta: { changes: Number(sqlite.prepare(sql).run(...bindings).changes) },
      }),
    };
    return statement;
  };
  // This boundary exposes the subset of D1 used by the relay over real SQLite.
  const db = {
    prepare,
    batch: async (statements: ReturnType<typeof prepare>[]) => {
      sqlite.exec("BEGIN");
      try {
        const results = await Promise.all(statements.map((statement) => statement.run()));
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  return { db, [Symbol.dispose]: () => sqlite.close() };
}

async function fixture(db: D1Database) {
  const mint = await generateKeyPair("EdDSA", { extractable: true });
  const environment = await generateKeyPair("EdDSA", { extractable: true });
  const clerk = await generateKeyPair("RS256", { extractable: true });
  const env: RelayBindings = {
    DB: db,
    RELAY_URL: "https://relay.example.test",
    CLERK_ISSUER: `https://clerk-${workerUuid()}.example.test`,
    CLERK_AUDIENCE: "sled-connect",
    CLERK_CLI_CLIENT_ID: "sled-cli",
    OWNER_USER_ID: "user_owner",
    TUNNEL_DOMAIN: "example.test",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_ZONE_ID: "b".repeat(32),
    CLOUDFLARE_API_TOKEN: "test-boundary-token",
    ALLOWED_ORIGINS: "https://app.example.test",
    MINT_PRIVATE_KEY: await exportPKCS8(mint.privateKey),
    MINT_PUBLIC_KEY: await exportSPKI(mint.publicKey),
  };
  const relay = new PersonalRelay(env);
  const capabilities = {
    notificationsEnabled: false,
    liveActivitiesEnabled: false,
    managedTunnelsEnabled: true,
  };
  const publicKey = await exportSPKI(environment.publicKey);
  const now = Math.floor(workerNow() / 1000);
  const makeLink = async (host = "127.0.0.1") => {
    const { challenge } = await relay.challenge(env.OWNER_USER_ID, capabilities);
    const proof = await new SignJWT({
      iss: "t3-env:env-test",
      aud: env.RELAY_URL,
      sub: "env-test",
      jti: workerUuid(),
      iat: now,
      exp: now + 120,
      challenge,
      environmentId: "env-test",
      environmentPublicKey: publicKey,
      descriptor: {
        environmentId: "env-test",
        label: "Test",
        platform: { os: "darwin", arch: "arm64" },
        serverVersion: "test",
        capabilities: { repositoryIdentity: true },
      },
      endpoint: {
        httpBaseUrl: "http://127.0.0.1:3773",
        wsBaseUrl: "ws://127.0.0.1:3773",
        providerKind: "manual",
      },
      origin: { localHttpHost: host, localHttpPort: 3773 },
      scopes: ["managed_tunnels"],
    })
      .setProtectedHeader({ alg: "EdDSA", typ: "t3-env-link+jwt" })
      .sign(environment.privateKey);
    return { ...capabilities, proof };
  };
  const userToken = (sub = env.OWNER_USER_ID, audience = env.CLERK_AUDIENCE) =>
    new SignJWT({ sub, aud: audience, iss: env.CLERK_ISSUER, iat: now, exp: now + 60 })
      .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "JWT" })
      .sign(clerk.privateKey);
  const cliToken = (clientId = env.CLERK_CLI_CLIENT_ID, audience?: string) =>
    new SignJWT({
      sub: env.OWNER_USER_ID,
      client_id: clientId,
      ...(audience ? { aud: audience } : {}),
      iss: env.CLERK_ISSUER,
      iat: now,
      exp: now + 60,
    })
      .setProtectedHeader({ alg: "RS256", kid: "test-key", typ: "at+jwt" })
      .sign(clerk.privateKey);
  const jwk = { ...(await exportJWK(clerk.publicKey)), kid: "test-key", alg: "RS256", use: "sig" };
  return { env, relay, makeLink, userToken, cliToken, jwk, environment };
}

function cloudflareFetch(jwk: object) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
    if (init?.method === "DELETE" && url.includes("dns_records/"))
      return Response.json({ success: false }, { status: 404 });
    if (!url.startsWith("https://api.cloudflare.com/"))
      throw new Error("Unexpected external request");
    let result: unknown = {};
    if (url.includes("?name=") && url.includes("cfd_tunnel")) result = [];
    else if (url.endsWith("cfd_tunnel") && init?.method === "POST") {
      result = { id: "tunnel-test", name: JSON.parse(String(init.body)).name };
    } else if (url.endsWith("/token")) result = "connector-token";
    else if (url.includes("dns_records?")) result = [];
    else if (url.endsWith("dns_records")) result = { id: "dns-test" };
    return Response.json({ success: true, result });
  });
}

describe("personal relay authorization and lifecycle", () => {
  it("verifies the owner using public Clerk keys and rejects other users and audiences", async () => {
    using sql = sqliteD1();
    const f = await fixture(sql.db);
    using _fetch = cloudflareFetch(f.jwk);
    await expect(f.relay.security.user(await f.userToken())).resolves.toBe("user_owner");
    await expect(f.relay.security.user(await f.cliToken())).resolves.toBe("user_owner");
    await expect(f.relay.security.user(await f.cliToken("other-client"))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      f.relay.security.user(await f.cliToken("sled-cli", "other-service")),
    ).rejects.toMatchObject({ status: 403 });
    await expect(f.relay.security.user(await f.userToken("user_other"))).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      f.relay.security.user(await f.userToken("user_owner", "other-service")),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("links a signed host to a managed tunnel and prevents challenge replay", async () => {
    using sql = sqliteD1();
    const f = await fixture(sql.db);
    using _fetch = cloudflareFetch(f.jwk);
    const input = await f.makeLink();
    const linked = await f.relay.link("user_owner", input);
    expect(linked.endpointRuntime.tunnelId).toBe("tunnel-test");
    expect(linked.endpoint.httpBaseUrl).toMatch(/^https:\/\/sled-[a-f0-9]{16}\.example\.test$/u);
    expect((await f.relay.list("user_owner")).environments).toHaveLength(1);
    expect((await f.relay.list("user_other")).environments).toHaveLength(0);
    await expect(f.relay.link("user_owner", input)).rejects.toMatchObject({
      reason: "proof_replayed",
    });
    await expect(
      f.relay.environmentAuthorization(
        new Request("https://relay.example.test", {
          headers: { authorization: `Bearer ${linked.environmentCredential}` },
        }),
        "env-test",
      ),
    ).resolves.toMatchObject({ id: "env-test" });
    await f.relay.remove("user_owner", "env-test", false);
    expect((await f.relay.list("user_owner")).environments).toHaveLength(0);
    await expect(
      f.relay.environmentAuthorization(
        new Request("https://relay.example.test", {
          headers: { authorization: `Bearer ${linked.environmentCredential}` },
        }),
        "env-test",
      ),
    ).rejects.toMatchObject({ status: 403 });
    await expect(f.relay.remove("user_owner", "env-test", false)).resolves.toEqual({ ok: true });
    const expiryWithinClockSkew = Math.floor(workerNow() / 1000) - 1;
    await f.relay.store.consumeNonce("recent-proof", expiryWithinClockSkew);
    await expect(
      f.relay.store.consumeNonce("recent-proof", expiryWithinClockSkew),
    ).rejects.toMatchObject({ reason: "proof_replayed" });
  });

  it("rejects non-loopback origins before making Cloudflare requests", async () => {
    using sql = sqliteD1();
    const f = await fixture(sql.db);
    using fetchMock = cloudflareFetch(f.jwk);
    await expect(
      f.relay.link("user_owner", await f.makeLink("169.254.169.254")),
    ).rejects.toMatchObject({ reason: "origin_not_allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(() => validateOrigin({ localHttpHost: "127.0.0.1", localHttpPort: 0 })).toThrow();
  });

  it("does not allow a simultaneous mutation to enter an environment lease", async () => {
    using sql = sqliteD1();
    const store = new RelayStore(sql.db);
    await store.withLease("env-test", async () => {
      await expect(store.withLease("env-test", async () => true)).rejects.toMatchObject({
        reason: "environment_busy",
      });
    });
    await expect(store.withLease("env-test", async () => "released")).resolves.toBe("released");
  });

  it("binds connection tokens to their DPoP key and rejects replay", async () => {
    using sql = sqliteD1();
    const f = await fixture(sql.db);
    const key = await generateKeyPair("ES256", { extractable: true });
    const jwk = await exportJWK(key.publicKey);
    const thumbprint = await calculateJwkThumbprint(jwk);
    const token = await f.relay.security.sign("t3-relay-dpop-access+jwt", {
      ...f.relay.security.claims("user_owner", 1800),
      cnf: { jkt: thumbprint },
      scope: "environment:connect",
      client_id: "t3-web",
    });
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)),
    );
    const proof = await new SignJWT({
      htm: "POST",
      htu: "https://relay.example.test/v1/environments/env-test/connect",
      jti: "dpop-test",
      iat: Math.floor(workerNow() / 1000),
      ath: Buffer.from(digest).toString("base64url"),
    })
      .setProtectedHeader({ alg: "ES256", typ: "dpop+jwt", jwk })
      .sign(key.privateKey);
    const make = () =>
      new Request("https://relay.example.test/v1/environments/env-test/connect", {
        method: "POST",
        headers: { authorization: `DPoP ${token}`, dpop: proof },
      });
    await expect(f.relay.authorizeConnection(make(), "environment:connect")).resolves.toEqual({
      userId: "user_owner",
      thumbprint,
    });
    await expect(f.relay.authorizeConnection(make(), "environment:connect")).rejects.toMatchObject({
      reason: "proof_replayed",
    });
  });

  it("queues offline hooks and signs their delivery without trusting caller relay headers", async () => {
    using sql = sqliteD1();
    const f = await fixture(sql.db);
    using _cloudflare = cloudflareFetch(f.jwk);
    await f.relay.link("user_owner", await f.makeLink());
    await sql.db
      .prepare("UPDATE environments SET hold_offline=1 WHERE id=?")
      .bind("env-test")
      .run();
    const row = await f.relay.store.environment("env-test", "user_owner");
    using delivery = vi
      .spyOn(globalThis, "fetch")
      .mockClear()
      .mockResolvedValueOnce(new Response("offline", { status: 503 }))
      .mockResolvedValueOnce(new Response("accepted"));
    const hooks = new RelayHooks(f.relay);
    const response = await hooks.forward(
      new Request("https://relay.example.test/v1/hooks/key/hook/secret?q=1", {
        method: "POST",
        body: "payload",
        headers: {
          "x-t3-relay-delivery-id": "forged",
          "x-t3-relay-delivery": "forged",
          "x-forwarded-for": "forged",
        },
      }),
      row.tunnel_name.slice(-16),
      "hook",
      "secret",
    );
    expect(response.status).toBe(202);
    expect(await sql.db.prepare("SELECT count(*) AS total FROM held_hooks").first()).toMatchObject({
      total: 1,
    });
    await hooks.drain("env-test");
    expect(await sql.db.prepare("SELECT count(*) AS total FROM held_hooks").first()).toMatchObject({
      total: 0,
    });
    const [url, init] = delivery.mock.calls[1]!;
    expect(url).toBe(`https://${row.hostname}/api/hooks/hook/secret?q=1`);
    const headers = new Headers(init?.headers);
    expect(headers.has("x-forwarded-for")).toBe(false);
    expect(headers.get("x-t3-relay-delivery-id")).not.toBe("forged");
    await expect(
      f.relay.security.verify(
        headers.get("x-t3-relay-delivery")!,
        "t3-relay-hook-delivery+jwt",
        f.env.MINT_PUBLIC_KEY,
        f.env.RELAY_URL,
        "t3-env:env-test",
      ),
    ).resolves.toMatchObject({ hookId: "hook", deliveryId: headers.get("x-t3-relay-delivery-id") });
    await expect(
      hooks.forward(
        new Request("https://relay.example.test", {
          method: "POST",
          headers: { "content-length": "1048577" },
        }),
        row.tunnel_name.slice(-16),
        "hook",
        "secret",
      ),
    ).rejects.toMatchObject({ status: 413 });
  });

  it("denies unapproved browser origins before reading credentials", async () => {
    using sql = sqliteD1();
    const f = await fixture(sql.db);
    const context = { waitUntil() {} } as unknown as ExecutionContext;
    const response = await worker.fetch(
      new Request("https://relay.example.test/v1/environments", {
        headers: { origin: "https://attacker.example.test" },
      }),
      f.env,
      context,
    );
    expect(response.status).toBe(403);
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
    using _fetch = cloudflareFetch(f.jwk);
    const malformed = await worker.fetch(
      new Request("https://relay.example.test/v1/client/environment-link-challenges", {
        method: "POST",
        headers: {
          authorization: `Bearer ${await f.userToken()}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ managedTunnelsEnabled: "yes" }),
      }),
      f.env,
      context,
    );
    expect(malformed.status).toBe(400);
  });
});
