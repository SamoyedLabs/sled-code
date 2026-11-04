import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import { rewriteComputerAsset } from "./ComputerViewAssets.ts";
// @effect-diagnostics preferSchemaOverJson:off - Opaque Moonlight viewer-state JSON is rewritten only at the private HTTP boundary.
import * as ByteSize from "effect/ByteSize";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { requestUrl } from "../requestUrl.ts";
import * as Gateway from "./ComputerViewGateway.ts";

const PREFIX = "/api/openbot/computer-view/v1/remote-screen/sessions";
export const routeLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const gateway = yield* Gateway.ComputerViewGateway;
    yield* router.add(
      "*",
      `${PREFIX}/*`,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = requestUrl(request);
        if (Option.isNone(url)) return HttpServerResponse.empty({ status: 404 });
        const match =
          /^\/api\/openbot\/computer-view\/v1\/remote-screen\/sessions\/([a-f0-9-]{36})(\/.*)$/.exec(
            url.value.pathname,
          );
        if (!match) return HttpServerResponse.empty({ status: 404 });
        if (request.method === "POST" || request.headers.upgrade?.toLowerCase() === "websocket") {
          if (request.headers.origin !== url.value.origin)
            return HttpServerResponse.empty({ status: 403 });
        }
        const id = match[1]!;
        const path = match[2]!;
        const publicBase = `${PREFIX}/${id}`;
        const frameOrigin = yield* Effect.tryPromise({
          try: () => gateway.views.frameOrigin(id),
          catch: () => new Gateway.ComputerViewError({ reason: "unavailable" }),
        });
        const headers = {
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        };
        if (request.method === "GET" && path === "/claim") {
          return HttpServerResponse.text(
            `<!doctype html><meta charset="utf-8"><title>Computer viewer</title><p role="status">Connecting…</p><script>const ticket=location.hash.slice(1);history.replaceState(null,'',location.pathname);fetch('claim',{method:'POST',headers:{'content-type':'text/plain'},body:ticket}).then(r=>{if(!r.ok)throw Error();location.replace('viewer')}).catch(()=>document.querySelector('p').textContent='Computer session expired');</script>`,
            {
              headers: {
                ...headers,
                "content-type": "text/html; charset=utf-8",
                "content-security-policy": `default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'self' ${frameOrigin === "self" ? "" : frameOrigin}`,
              },
            },
          );
        }
        const attempt = <A>(try_: () => Promise<A>) =>
          Effect.tryPromise({
            try: try_,
            catch: () => new Gateway.ComputerViewError({ reason: "unavailable" }),
          });
        if (request.method === "POST" && path === "/claim") {
          if (Number(request.headers["content-length"] ?? 0) > 64)
            return HttpServerResponse.empty({ status: 413 });
          const ticket = yield* request.text;
          const cookie = yield* attempt(() => gateway.views.claim(id, ticket));
          return HttpServerResponse.empty({
            status: 204,
            headers: {
              ...headers,
              "set-cookie": `sled_computer=${cookie}; HttpOnly; ${url.value.protocol === "https:" ? "SameSite=None; Secure" : "SameSite=Strict"}; Path=${publicBase}/; Max-Age=900`,
            },
          });
        }
        const cookie =
          /(?:^|;\s*)sled_computer=([a-f0-9]{64})(?:;|$)/.exec(request.headers.cookie ?? "")?.[1] ??
          "";
        const entry = yield* attempt(() => gateway.views.access(id, cookie));
        if (request.method === "GET" && path === "/viewer")
          return HttpServerResponse.empty({
            status: 302,
            headers: { ...headers, location: `${publicBase}${entry.session.target}` },
          });
        if (
          request.method === "GET" &&
          path === "/stream" &&
          request.headers.upgrade?.toLowerCase() === "websocket"
        ) {
          return yield* Effect.scoped(
            Effect.gen(function* () {
              const connection = yield* gateway.connect(id, cookie);
              const incoming = NodeHttpServerRequest.toIncomingMessage(request);
              delete incoming.headers["sec-websocket-extensions"];
              const socket = yield* request.upgrade;
              yield* connection.run(socket, () => incoming.socket.writableLength);
              return HttpServerResponse.empty();
            }),
          );
        }
        if (request.method !== "GET" && request.method !== "POST")
          return HttpServerResponse.empty({ status: 405 });
        if (request.method === "POST" && request.headers["sec-fetch-site"] !== "same-origin")
          return HttpServerResponse.empty({ status: 403 });
        if (Number(request.headers["content-length"] ?? 0) > 1024 * 1024)
          return HttpServerResponse.empty({ status: 413 });
        let body =
          request.method === "POST" ? new Uint8Array(yield* request.arrayBuffer) : undefined;
        if (body && body.byteLength > 1024 * 1024) return HttpServerResponse.empty({ status: 413 });
        if (body && path === "/viewer-state") {
          const value: unknown = yield* Effect.try(() =>
            JSON.parse(new TextDecoder().decode(body)),
          );
          if (
            !value ||
            typeof value !== "object" ||
            !("sessionId" in value) ||
            value.sessionId !== id
          )
            return HttpServerResponse.empty({ status: 400 });
          body = new TextEncoder().encode(
            JSON.stringify({ ...value, sessionId: entry.session.upstreamId }),
          );
        }
        yield* attempt(() => gateway.views.access(id, cookie));
        const response = yield* attempt(() =>
          entry.session.request(
            `${path}${url.value.search}`,
            request.method === "POST" ? "POST" : "GET",
            body,
          ),
        );
        yield* attempt(() => gateway.views.access(id, cookie));
        const text =
          /(?:javascript|json|text\/|wasm)/.test(response.type) && !response.type.includes("wasm");
        const bytes = text
          ? new TextEncoder().encode(
              rewriteComputerAsset(response.bytes, entry.session.upstreamId, publicBase),
            )
          : response.bytes;
        return HttpServerResponse.uint8Array(bytes, {
          status: response.status,
          headers: {
            ...headers,
            "content-type": response.type,
            "content-security-policy": `frame-ancestors 'self' ${frameOrigin === "self" ? "" : frameOrigin}`,
          },
        });
      }).pipe(
        Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(1024 * 1024)),
        Effect.orElseSucceed(() =>
          HttpServerResponse.text("Computer session unavailable or expired", {
            status: 403,
            headers: { "cache-control": "no-store" },
          }),
        ),
      ),
    );
  }),
);
