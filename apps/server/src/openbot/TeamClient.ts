import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

export class TeamClientError extends Schema.TaggedError<TeamClientError>()(
  "OpenbotTeamClientError",
  {
    reason: Schema.Literals(["invalid-configuration", "transport", "http", "decode", "closed"]),
    status: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "The local Openbot connection could not complete the request.";
  }
}

const Identifier = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512));
const Agent = Schema.Struct({
  id: Identifier,
  name: Schema.String.check(Schema.isMaxLength(256)),
  provider: Identifier,
});
const Roster = Schema.Array(Agent).check(Schema.isMaxLength(10_000));
const Login = Schema.Struct({
  sessionToken: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  sessionExpiresAt: Schema.String.check(Schema.isMaxLength(64)),
});

const isTeamClientError = Schema.is(TeamClientError);
const decodeLogin = Schema.decodeUnknownEffect(Login);
const decodeRoster = Schema.decodeUnknownEffect(Roster);
const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

export interface Session {
  readonly listAgents: Effect.Effect<ReadonlyArray<typeof Agent.Type>, TeamClientError>;
  readonly close: Effect.Effect<void, TeamClientError>;
}

export class TeamClient extends Context.Service<
  TeamClient,
  {
    readonly connect: (input: {
      readonly apiUrl: string;
      readonly ownerSecret: string;
    }) => Effect.Effect<Session, TeamClientError>;
  }
>()("t3/openbot/TeamClient") {}

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const localHttpClient = HttpClient.transform(httpClient, (response) =>
    Effect.provideService(response, FetchHttpClient.RequestInit, { redirect: "manual" }),
  );

  const send = Effect.fn("OpenbotTeamClient.send")(function* (
    request: HttpClientRequest.HttpClientRequest,
  ) {
    const response = yield* localHttpClient
      .execute(
        request.pipe(
          HttpClientRequest.setHeaders({
            "OpenBot-Protocol-Version": "9",
            "OpenBot-App-Version": "0.60.0",
          }),
        ),
      )
      .pipe(Effect.mapError((cause) => new TeamClientError({ reason: "transport", cause })));
    if (response.status < 200 || response.status >= 300) {
      return yield* new TeamClientError({ reason: "http", status: response.status });
    }
    return response;
  });

  const readJson = Effect.fn("OpenbotTeamClient.readJson")(function* (
    response: HttpClientResponse.HttpClientResponse,
  ) {
    const decoder = new TextDecoder();
    // Fetch response.json does not honor MaxBodySize; bound bytes while streaming instead.
    const body = yield* response.stream.pipe(
      Stream.runFoldEffect(
        () => ({ size: 0, text: "" }),
        (state, chunk) =>
          state.size + chunk.byteLength > 1_048_576
            ? Effect.fail(new TeamClientError({ reason: "decode" }))
            : Effect.succeed({
                size: state.size + chunk.byteLength,
                text: state.text + decoder.decode(chunk, { stream: true }),
              }),
      ),
      Effect.mapError((cause) =>
        isTeamClientError(cause) ? cause : new TeamClientError({ reason: "decode", cause }),
      ),
    );
    return yield* decodeJson(body.text + decoder.decode()).pipe(
      Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
    );
  });

  const connect = Effect.fn("OpenbotTeamClient.connect")(function* (input: {
    readonly apiUrl: string;
    readonly ownerSecret: string;
  }) {
    const origin = yield* Effect.try({
      try: () => {
        const url = new URL(input.apiUrl);
        if (
          url.protocol !== "http:" ||
          !["127.0.0.1", "[::1]"].includes(url.hostname) ||
          url.username !== "" ||
          url.password !== "" ||
          url.pathname !== "/" ||
          url.search !== "" ||
          url.hash !== "" ||
          input.ownerSecret.length === 0 ||
          input.ownerSecret.length > 256
        )
          throw new Error("Invalid local endpoint");
        return url.origin;
      },
      catch: () => new TeamClientError({ reason: "invalid-configuration" }),
    });

    // Openbot v0.60.0 (0c7753fa): local owner login and roster routes in team-api-server/route-agents.
    const request = yield* HttpClientRequest.post(`${origin}/v1/auth/login`).pipe(
      HttpClientRequest.bodyJson({ username: "owner", password: input.ownerSecret }),
      Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
    );
    const login = yield* send(request).pipe(
      Effect.flatMap(readJson),
      Effect.flatMap(decodeLogin),
      Effect.mapError((cause) =>
        isTeamClientError(cause) ? cause : new TeamClientError({ reason: "decode", cause }),
      ),
      Effect.timeout("10 seconds"),
      Effect.mapError((cause) =>
        isTeamClientError(cause) ? cause : new TeamClientError({ reason: "transport", cause }),
      ),
    );
    let closed = false;
    const authenticated = (path: string, method: "GET" | "POST") =>
      HttpClientRequest.make(method)(`${origin}${path}`).pipe(
        HttpClientRequest.setHeader("authorization", `Bearer ${login.sessionToken}`),
      );
    const listAgents = Effect.fn("OpenbotTeamClient.listAgents")(function* () {
      if (closed) return yield* new TeamClientError({ reason: "closed" });
      const response = yield* send(authenticated("/v1/agents", "GET"));
      return yield* readJson(response).pipe(
        Effect.flatMap(decodeRoster),
        Effect.mapError((cause) => new TeamClientError({ reason: "decode", cause })),
      );
    });
    const close = Effect.fn("OpenbotTeamClient.close")(function* () {
      if (closed) return;
      closed = true;
      yield* send(authenticated("/v1/auth/logout", "POST"));
    });
    return {
      listAgents: listAgents().pipe(
        Effect.timeout("10 seconds"),
        Effect.mapError((cause) =>
          isTeamClientError(cause) ? cause : new TeamClientError({ reason: "transport", cause }),
        ),
      ),
      close: close().pipe(
        Effect.asVoid,
        Effect.timeout("10 seconds"),
        Effect.mapError((cause) =>
          isTeamClientError(cause) ? cause : new TeamClientError({ reason: "transport", cause }),
        ),
      ),
    } satisfies Session;
  });
  return TeamClient.of({ connect });
});

export const layer = Layer.effect(TeamClient, make);
