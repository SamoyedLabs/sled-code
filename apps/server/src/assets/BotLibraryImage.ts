import {
  OPENBOT_LIBRARY_AUTOMATIC_IMAGE_LIMIT,
  OpenbotLibraryPictureMime,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpServerResponse } from "effect/http";
import { Integration } from "../openbot/Integration.ts";
import { TeamClientError } from "../openbot/TeamClient.ts";
import type { ResolvedAsset } from "./AssetAccess.ts";

const isImage = Schema.is(OpenbotLibraryPictureMime);
const missing = () =>
  HttpServerResponse.empty({
    status: 404,
    headers: { "cache-control": "private, no-store" },
  });

export const botLibraryImageResponse = Effect.fn("AssetAccess.botLibraryImageResponse")(function* (
  asset: Extract<ResolvedAsset, { kind: "bot-library-image" }>,
) {
  const integration = yield* Integration;
  const source = {
    kind: "library" as const,
    fileId: asset.fileId,
    ...(asset.conversationId ? { conversationId: asset.conversationId } : {}),
  };
  const result = yield* integration
    .withFilesToHost(asset.hostId, (files) =>
      Effect.gen(function* () {
        const metadata = yield* files.attachment(null, source);
        const { size, mimeType } = metadata;
        if (!isImage(mimeType) || size < 1 || size > OPENBOT_LIBRARY_AUTOMATIC_IMAGE_LIMIT)
          return null;
        const download = yield* files.download(null, source);
        if (
          download.size !== size ||
          (download.mimeType !== mimeType && download.mimeType !== "application/octet-stream")
        )
          return null;
        return { size, mimeType, body: download.body };
      }),
    )
    .pipe(Effect.option);
  if (Option.isNone(result) || result.value === null) return missing();
  const { size, mimeType, body } = result.value;
  let bytes = 0;
  const fail = Effect.fail(new TeamClientError({ reason: "decode" }));
  const verified = body.pipe(
    Stream.tap((chunk) => {
      bytes += chunk.length;
      return bytes <= size ? Effect.void : fail;
    }),
    Stream.concat(
      Stream.fromEffect(Effect.suspend(() => (bytes === size ? Effect.void : fail))).pipe(
        Stream.drain,
      ),
    ),
  );
  return HttpServerResponse.stream(verified, {
    headers: {
      "content-type": mimeType,
      "content-length": String(size),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
