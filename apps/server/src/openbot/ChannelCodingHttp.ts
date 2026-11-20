import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as EnvironmentAuth from "../auth/EnvironmentAuth.ts";
import * as ChannelCoding from "./ChannelCoding.ts";
const isChannelCodingError = Schema.is(ChannelCoding.ChannelCodingError);
const Input = Schema.Struct({
  credential: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  launch: Schema.Json,
});
export const routeLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const auth = yield* EnvironmentAuth.EnvironmentAuth;
    const coding = yield* ChannelCoding.ChannelCoding;
    yield* router.add(
      "POST",
      "/api/openbot/channel-coding",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const session = yield* auth.authenticateMcpClient(request);
        if (session.peerLink || session.access === "read-only")
          return HttpServerResponse.empty({
            status: 403,
            headers: { "x-sled-coding-outcome": "refused" },
          });
        const length = request.headers["content-length"];
        if (length && Number(length) > 250000) return HttpServerResponse.empty({ status: 413 });
        const input = yield* request.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Input)));
        const result = yield* coding.launch(session.sessionId, input.credential, input.launch);
        return yield* HttpServerResponse.json(result, { headers: { "cache-control": "no-store" } });
      }).pipe(
        Effect.catch((cause) =>
          Effect.succeed(
            HttpServerResponse.empty({
              status: 403,
              headers:
                isChannelCodingError(cause) && cause.definitiveRefusal
                  ? { "x-sled-coding-outcome": "refused" }
                  : {},
            }),
          ),
        ),
      ),
    );
  }),
);
