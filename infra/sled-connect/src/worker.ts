import { errors as joseErrors } from "jose";
import * as Schema from "effect/Schema";
import { RelayError, validateConfiguration, type RelayBindings } from "./config.ts";
import { RelayHooks } from "./hooks.ts";
import { PersonalRelay } from "./relay.ts";
import { bearer } from "./security.ts";

const json = (value: unknown) => Response.json(value, { headers: { "cache-control": "no-store" } });

async function dispatch(
  request: Request,
  env: RelayBindings,
  context: ExecutionContext,
): Promise<Response> {
  validateConfiguration(env);
  const relay = new PersonalRelay(env);
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/health") return json({ ok: true });
  if (request.method === "GET" && path === "/.well-known/sled-connect")
    return json({
      protocolVersion: 1,
      name: "Sled Connect",
      relayUrl: relay.issuer,
      clerkIssuer: env.CLERK_ISSUER,
      notifications: false,
    });
  if (request.method === "POST" && path === "/v1/client/dpop-token")
    return json(await relay.exchange(request));
  const hooks = path.match(/^\/v1\/hooks\/([a-f0-9]{16})\/([^/]+)\/([^/]+)$/u);
  if (
    hooks &&
    hooks[1] &&
    hooks[2] &&
    hooks[3] &&
    ["GET", "POST", "PUT", "PATCH"].includes(request.method)
  ) {
    return new RelayHooks(relay).forward(
      request,
      hooks[1],
      decodeURIComponent(hooks[2]),
      decodeURIComponent(hooks[3]),
    );
  }
  const server = path.match(
    /^\/v1\/environments\/([^/]+)\/(tunnel(?:\/recovery)?|link-preferences|hooks\/wake|threads\/[^/]+\/agent-activity)$/u,
  );
  if (server?.[1] && server[2] && request.method === "POST") {
    const id = decodeURIComponent(server[1]);
    if (server[2] === "tunnel" || server[2] === "tunnel/recovery")
      return json(await relay.recover(request, id, server[2] === "tunnel/recovery"));
    await relay.environmentAuthorization(request, id);
    if (server[2] === "link-preferences") {
      const input: unknown = await request.json();
      if (
        typeof input !== "object" ||
        input === null ||
        !("holdWebhooksWhileOffline" in input) ||
        typeof input.holdWebhooksWhileOffline !== "boolean"
      )
        throw new RelayError(400, "invalid_preferences");
      await env.DB.prepare("UPDATE environments SET hold_offline=? WHERE id=?")
        .bind(input.holdWebhooksWhileOffline ? 1 : 0, id)
        .run();
      return json({ holdWebhooksWhileOffline: input.holdWebhooksWhileOffline });
    }
    if (server[2] === "hooks/wake") {
      context.waitUntil(new RelayHooks(relay).drain(id));
      return json({ pending: true });
    }
    return json({ deliveries: [] });
  }
  const connection = path.match(/^\/v1\/environments\/([^/]+)\/(connect|status)$/u);
  if (connection?.[1] && request.method === "POST")
    return json(
      await relay.connect(request, decodeURIComponent(connection[1]), connection[2] === "status"),
    );
  const userId = await relay.security.user(bearer(request));
  if (request.method === "GET") {
    if (path === "/v1/environments") return json(await relay.list(userId));
    if (["/v1/client/devices", "/v2/client/devices"].includes(path)) return json({ devices: [] });
    if (path === "/v1/client/t3chat-link")
      return json({ available: false, link: null, maxTunnelsOverride: 1000 });
  }
  if (request.method === "POST") {
    if (path === "/v1/client/environment-link-challenges")
      return json(await relay.challenge(userId, await request.json()));
    if (path === "/v1/client/environment-links")
      return json(await relay.link(userId, await request.json()));
  }
  const unlink = path.match(/^\/v1\/client\/environment-links\/([^/]+)(\/tunnel)?$/u);
  if (unlink?.[1] && request.method === "DELETE")
    return json(await relay.remove(userId, decodeURIComponent(unlink[1]), Boolean(unlink[2])));
  throw new RelayError(404, "not_found");
}

export default {
  async fetch(request: Request, env: RelayBindings, context: ExecutionContext): Promise<Response> {
    const origin = request.headers.get("origin");
    const allowed = env.ALLOWED_ORIGINS?.split(",").map((item) => item.trim()) ?? [];
    if (origin && !allowed.includes(origin))
      return Response.json({ error: "origin_not_allowed" }, { status: 403 });
    let response: Response;
    if (request.method === "OPTIONS") response = new Response(null, { status: 204 });
    else {
      try {
        response = await dispatch(request, env, context);
      } catch (error) {
        const invalidInput =
          Schema.isSchemaError(error) || error instanceof SyntaxError || error instanceof URIError;
        if (
          !(error instanceof RelayError) &&
          !(error instanceof joseErrors.JOSEError) &&
          !invalidInput
        ) {
          // @effect-diagnostics-next-line globalConsole:off - Worker entry-point diagnostics omit payloads and exception messages.
          console.error({
            event: "sled_connect_request_failed",
            name: error instanceof Error ? error.name : "unknown",
            frames: error instanceof Error ? error.stack?.split("\n").slice(1, 5) : [],
          });
        }
        const known = error instanceof RelayError;
        const invalidToken = error instanceof joseErrors.JOSEError;
        const status = known ? error.status : invalidToken ? 401 : invalidInput ? 400 : 500;
        response = Response.json(
          {
            error: known
              ? error.reason
              : invalidToken
                ? "invalid_token"
                : invalidInput
                  ? "invalid_request"
                  : "request_failed",
          },
          { status },
        );
      }
    }
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    if (origin) {
      headers.set("access-control-allow-origin", origin);
      headers.set("vary", "origin");
      headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
      headers.set("access-control-allow-headers", "authorization,content-type,dpop");
    }
    return new Response(response.body, { status: response.status, headers });
  },
  async scheduled(_event: ScheduledEvent, env: RelayBindings): Promise<void> {
    validateConfiguration(env);
    await new RelayHooks(new PersonalRelay(env)).drain();
  },
};
