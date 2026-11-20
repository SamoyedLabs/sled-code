import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  PRIVILEGED_RESPONSE_CAPABILITY,
  PrivilegedResponseRequest,
  PrivilegedResponseResult,
} from "@t3tools/contracts/openbot-privileged-response";

export class PrivilegedResponseUnavailable extends Schema.TaggedError<PrivilegedResponseUnavailable>()(
  "PrivilegedResponseUnavailable",
  {},
) {}

const paths = {
  "privilegedResponse.context": "/v1/sled/privileged-responses/context",
  "privilegedResponse.respond": "/v1/sled/privileged-responses/respond",
  "privilegedResponse.result": "/v1/sled/privileged-responses/result",
} as const;

const decodeRequest = Schema.decodeUnknownOption(PrivilegedResponseRequest);
const encodeRequest = Schema.encodeEffect(Schema.fromJsonString(PrivilegedResponseRequest));
const decodeResult = Schema.decodeUnknownOption(PrivilegedResponseResult);

export const dispatch = Effect.fn("OpenbotPrivilegedResponse.dispatch")(function* <E>(
  input: unknown,
  ports: {
    readonly capabilities: ReadonlySet<string>;
    readonly authorize: () => Effect.Effect<void, E>;
    readonly post: (path: string, body: string) => Effect.Effect<unknown, E>;
  },
) {
  if (!ports.capabilities.has(PRIVILEGED_RESPONSE_CAPABILITY))
    return yield* new PrivilegedResponseUnavailable({});
  const parsed = decodeRequest(input, {
    onExcessProperty: "error",
  });
  if (parsed._tag === "None") return yield* new PrivilegedResponseUnavailable({});
  const request = parsed.value;
  yield* ports.authorize().pipe(Effect.mapError(() => new PrivilegedResponseUnavailable({})));
  // Serialize once: the dedicated transport signs and sends these exact UTF8 bytes.
  const body = yield* encodeRequest(request).pipe(
    Effect.mapError(() => new PrivilegedResponseUnavailable({})),
  );
  const result = yield* ports
    .post(paths[request.operation], body)
    .pipe(Effect.mapError(() => new PrivilegedResponseUnavailable({})));
  const decoded = decodeResult(result);
  if (decoded._tag === "None" || ("nonce" in request && decoded.value.nonce !== request.nonce))
    return yield* new PrivilegedResponseUnavailable({});
  return decoded.value;
});
