// @effect-diagnostics nodeBuiltinImport:off -- archive spool path and signing secret encoding.
import * as NodePath from "node:path";
import {
  AuthSessionId,
  OpenbotFilesError,
  type OpenbotArchiveUploadInput,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { AuthSessionRepository, type AuthSessionRecord } from "../persistence/AuthSessions.ts";
import { ImportUploadStore } from "./ImportUploads.ts";
const decodeAuthSessionId = Schema.decodeEffect(AuthSessionId);
const PREFIX = "/api/openbot/archive-upload/";
const failure = (cause: unknown) =>
  new OpenbotFilesError({ operation: "upload", reason: "ownership", cause });
type TransferSession = Pick<AuthSessionRecord, "subject" | "method">;
// Only the private desktop bootstrap credential regains its own unfinished transfer after session rotation.
const isDesktopTransferSuccessor = (current: TransferSession, previous: TransferSession) =>
  current.subject === "desktop-bootstrap" &&
  previous.subject === "desktop-bootstrap" &&
  current.method === "bearer-access-token" &&
  previous.method === "bearer-access-token";
const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const sessions = yield* AuthSessionRepository;
  const secret = yield* secrets.getOrCreateRandom("openbot-archive-upload", 32);
  const store = new ImportUploadStore(
    NodePath.join(config.stateDir, "openbot", "import-uploads"),
    Buffer.from(secret).toString("base64"),
  );
  const checkPrincipal = Effect.fn("ArchiveUploads.checkPrincipal")(function* (principal: string) {
    const sessionId = yield* decodeAuthSessionId(principal);
    const row = yield* sessions.getById({ sessionId });
    const now = yield* Clock.currentTimeMillis;
    if (
      Option.isNone(row) ||
      row.value.revokedAt !== null ||
      row.value.expiresAt.epochMilliseconds <= now
    )
      return yield* failure(new Error("Archive session expired or revoked"));
  }, Effect.mapError(failure));
  const canRecoverTransfer = Effect.fn("ArchiveUploads.canRecoverTransfer")(function* (
    principal: string,
    previous: string,
  ) {
    yield* checkPrincipal(principal);
    const current = yield* sessions.getById({ sessionId: yield* decodeAuthSessionId(principal) });
    const original = yield* sessions.getById({ sessionId: yield* decodeAuthSessionId(previous) });
    return (
      Option.isSome(current) &&
      Option.isSome(original) &&
      isDesktopTransferSuccessor(current.value, original.value)
    );
  }, Effect.mapError(failure));
  return {
    checkPrincipal,
    canRecoverTransfer,
    releaseTransfer: Effect.fn("ArchiveUploads.releaseTransfer")(function* (
      principal: string,
      original: string,
      hostId: string,
      uploadId: string,
    ) {
      yield* checkPrincipal(principal);
      if (principal !== original && !(yield* canRecoverTransfer(principal, original)))
        return yield* failure(new Error("Original transfer owner unavailable"));
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.tryPromise({
        try: () => store.release(original, hostId, uploadId, now),
        catch: failure,
      });
    }),
    issue: Effect.fn("ArchiveUploads.issue")(function* (
      principal: string,
      input: OpenbotArchiveUploadInput,
    ) {
      yield* checkPrincipal(principal);
      const now = yield* Clock.currentTimeMillis;
      const issued = yield* Effect.tryPromise({
        try: () => store.issue({ ...input, principal }, now),
        catch: failure,
      });
      return { uploadId: issued.uploadId, relativeUrl: PREFIX + issued.token };
    }),
    read: Effect.fn("ArchiveUploads.read")(function* (
      principal: string,
      hostId: string,
      uploadId: string,
    ) {
      yield* checkPrincipal(principal);
      const now = yield* Clock.currentTimeMillis;
      return yield* Effect.tryPromise({
        try: () => store.read(principal, hostId, uploadId, now),
        catch: failure,
      });
    }),
    release: Effect.fn("ArchiveUploads.release")(function* (
      principal: string,
      hostId: string,
      uploadId: string,
    ) {
      yield* checkPrincipal(principal);
      const now = yield* Clock.currentTimeMillis;
      yield* Effect.tryPromise({
        try: () => store.release(principal, hostId, uploadId, now),
        catch: failure,
      });
    }),
    store: Effect.fn("ArchiveUploads.store")(function* (
      token: string,
      body: Stream.Stream<Uint8Array, unknown>,
    ) {
      const now = yield* Clock.currentTimeMillis;
      const principal = yield* Effect.try({ try: () => store.owner(token, now), catch: failure });
      yield* checkPrincipal(principal);
      const receipt = yield* Effect.tryPromise({
        try: () => store.store(token, Stream.toAsyncIterable(body), now),
        catch: failure,
      });
      yield* checkPrincipal(principal);
      return receipt;
    }),
  };
});
export class ArchiveUploads extends Context.Service<ArchiveUploads, Effect.Success<typeof make>>()(
  "t3/openbot/ArchiveUploads",
) {}
export const layer = Layer.effect(ArchiveUploads, make).pipe(Layer.orDie);
export const routeLayer = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const archives = yield* ArchiveUploads;
    yield* router.add(
      "PUT",
      "/api/openbot/archive-upload/:token",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const token = request.url.split("?")[0]?.slice(PREFIX.length) ?? "";
        const length = request.headers["content-length"];
        if (
          length !== undefined &&
          (!Number.isSafeInteger(Number(length)) || Number(length) > 104857600)
        )
          return HttpServerResponse.empty({ status: 413 });
        const receipt = yield* archives.store(token, request.stream);
        return yield* HttpServerResponse.json(receipt, {
          headers: { "cache-control": "no-store" },
        });
      }).pipe(Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 403 }))),
    );
  }),
);
