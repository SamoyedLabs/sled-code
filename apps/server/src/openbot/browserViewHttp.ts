import * as NodeHttpServerRequest from "@effect/platform-node/NodeHttpServerRequest";
import { AuthPreviewOperateScope, AuthSettingsWriteScope } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { authenticateMediaRequest, failEnvironmentScopeRequired } from "../auth/http.ts";
import { requestUrl } from "../requestUrl.ts";
import * as Gateway from "./BrowserViewGateway.ts";

const PREFIX = "/api/openbot/browser-view";
export const routeLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const gateway = yield* Gateway.BrowserViewGateway;
    yield* router.add(
      "GET",
      `${PREFIX}/*`,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const url = requestUrl(request);
        if (Option.isNone(url) || request.headers.upgrade?.toLowerCase() !== "websocket")
          return HttpServerResponse.text("Not Found", { status: 404 });
        const session = yield* authenticateMediaRequest(AuthSettingsWriteScope);
        if (!session.scopes.includes(AuthPreviewOperateScope))
          return yield* failEnvironmentScopeRequired(AuthPreviewOperateScope);
        const match = /^\/api\/openbot\/browser-view\/([^/]+)\/([^/]+)$/.exec(url.value.pathname);
        const tokens = request.headers["sec-websocket-protocol"]
          ?.split(",")
          .map((value) => value.trim())
          .filter((value) => /^sled-browser-view\.[a-f0-9]{64}$/.test(value));
        if (!match || tokens?.length !== 1)
          return HttpServerResponse.text("Bad Request", { status: 400 });
        const decoded = yield* Effect.try(() => ({
          hostId: decodeURIComponent(match[1]!),
          id: decodeURIComponent(match[2]!),
        })).pipe(Effect.option);
        if (Option.isNone(decoded)) return HttpServerResponse.text("Bad Request", { status: 400 });
        const { hostId, id } = decoded.value;
        if (hostId.length > 128 || id.length > 128)
          return HttpServerResponse.text("Bad Request", { status: 400 });
        return yield* Effect.scoped(
          Effect.gen(function* () {
            const connection = yield* gateway.connect(session.sessionId, {
              hostId,
              id,
              token: tokens[0]!.slice("sled-browser-view.".length),
            });
            const incoming = NodeHttpServerRequest.toIncomingMessage(request);
            delete incoming.headers["sec-websocket-extensions"];
            const socket = yield* request.upgrade;
            yield* connection.run(socket, () => incoming.socket.writableLength);
            return HttpServerResponse.empty();
          }),
        ).pipe(
          Effect.catchTags({
            BrowserViewGatewayError: () =>
              Effect.succeed(HttpServerResponse.text("Forbidden", { status: 403 })),
          }),
        );
      }),
    );
  }),
);
